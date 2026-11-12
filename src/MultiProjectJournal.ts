import type { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdirSync, realpathSync } from "node:fs";
import path from "node:path";
import type { WorkspaceStoreGuard } from "./OrchestrationWorkspaceContract.js";
import {
  digest,
  taskKey,
  parseOrchestrationCatalog,
  parseOrchestrationTasks,
  parseOrchestrationTaskState,
  type OrchestrationCatalog,
  type OrchestrationTask,
  type OrchestrationTaskState,
} from "./MultiProjectProtocol.js";

export interface OrchestrationLease {
  owner: string;
  fence: number;
}

export interface OrchestrationHostRecord {
  version: number;
  value: unknown;
}

export interface OrchestrationHostEvent {
  sequence: number;
  run: string;
  key: string;
  version: number;
  value: unknown;
  event: unknown;
  recorded: number;
}

export interface OrchestrationCatalogCause {
  recordKey: string;
  recordVersion: number;
  recordDigest: string;
}

export interface OrchestrationCatalogGeneration {
  generation: number;
  tasks: OrchestrationTask[];
  cause: OrchestrationCatalogCause;
  digest: string;
}

const catalogCause = (cause: unknown): OrchestrationCatalogCause => {
  if (
    !cause ||
    typeof cause !== "object" ||
    Array.isArray(cause) ||
    Object.keys(cause).length !== 3 ||
    !("recordKey" in cause) ||
    typeof cause.recordKey !== "string" ||
    !("recordVersion" in cause) ||
    typeof cause.recordVersion !== "number" ||
    !("recordDigest" in cause) ||
    typeof cause.recordDigest !== "string"
  )
    throw new Error("catalog append requires exact host evidence identity");
  hostRecordKey(cause.recordKey);
  if (
    !Number.isSafeInteger(cause.recordVersion) ||
    cause.recordVersion < 1 ||
    !/^[a-f0-9]{64}$/.test(cause.recordDigest)
  )
    throw new Error("catalog append requires versioned host evidence");
  return {
    recordKey: cause.recordKey,
    recordVersion: cause.recordVersion,
    recordDigest: cause.recordDigest,
  };
};

const hostRecordKey = (key: string): void => {
  if (!/^[a-z][a-z0-9-]{0,47}:[a-f0-9]{64}$/.test(key))
    throw new Error("host record requires a namespaced digest key");
};

const hostJson = (value: unknown): string => {
  let nodes = 0;
  const ancestors = new Set<object>();
  const visit = (value: unknown, depth: number): void => {
    if (++nodes > 100_000 || depth > 64)
      throw new Error("host record JSON exceeds structural limits");
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    )
      return;
    if (typeof value !== "object")
      throw new Error("host record requires JSON data");
    if (
      ancestors.has(value) ||
      (!Array.isArray(value) &&
        ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    )
      throw new Error("host record requires plain acyclic JSON data");
    ancestors.add(value);
    if (Array.isArray(value)) {
      for (const child of value) visit(child, depth + 1);
    } else {
      for (const child of Object.values(value)) {
        if (child !== undefined) visit(child, depth + 1);
      }
    }
    ancestors.delete(value);
  };
  visit(value, 0);
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json, "utf8") > 1_048_576)
    throw new Error("host record JSON exceeds byte limit");
  return json;
};

/** Owner-controlled local SQLite, not the private-file ADO ledger boundary. */
export class MultiProjectJournal {
  private readonly db: DatabaseSync;
  constructor(
    filename: string,
    private readonly now: () => number = Date.now,
    private readonly workspaceGuards: readonly WorkspaceStoreGuard[] = [],
  ) {
    if (filename !== ":memory:") {
      if (!path.isAbsolute(filename) || filename.startsWith("\\\\"))
        throw new Error("journal requires an absolute trusted local path");
      mkdirSync(path.dirname(filename), { recursive: true });
      const canonical = realpathSync(path.dirname(filename));
      if (
        path.resolve(canonical).toLowerCase() !==
        path.resolve(path.dirname(filename)).toLowerCase()
      )
        throw new Error(
          "journal directory must be canonical, not a symlink alias",
        );
    }
    const sqlite: typeof import("node:sqlite") = createRequire(import.meta.url)(
      "node:sqlite",
    );
    this.db = new sqlite.DatabaseSync(filename);
    const metadata = this.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='metadata'",
      )
      .get();
    if (metadata) {
      const version = this.db.prepare("SELECT version FROM metadata").all();
      if (
        version.length !== 1 ||
        ![1, 2].includes(Number(version[0]?.version))
      ) {
        this.db.close();
        throw new Error("unsupported orchestration journal schema");
      }
    }
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      PRAGMA busy_timeout=5000;
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS metadata(version INTEGER NOT NULL);
      INSERT INTO metadata SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM metadata);
      CREATE TABLE IF NOT EXISTS lease(
        singleton INTEGER PRIMARY KEY CHECK(singleton=1),
        owner TEXT NOT NULL, fence INTEGER NOT NULL, expires INTEGER NOT NULL);
      INSERT OR IGNORE INTO lease VALUES(1,'',0,0);
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, catalog TEXT NOT NULL, digest TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks(
        run TEXT NOT NULL, key TEXT NOT NULL, state TEXT NOT NULL, PRIMARY KEY(run,key));
      CREATE TABLE IF NOT EXISTS events(
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        run TEXT NOT NULL, key TEXT NOT NULL, operation TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL, body TEXT NOT NULL, recorded INTEGER NOT NULL);
      CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events
        BEGIN SELECT RAISE(ABORT,'events are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events
        BEGIN SELECT RAISE(ABORT,'events are append-only'); END;
      CREATE INDEX IF NOT EXISTS events_by_task ON events(run,key,sequence);
      CREATE TABLE IF NOT EXISTS host_records(
        key TEXT PRIMARY KEY, version INTEGER NOT NULL CHECK(version>0),
        value TEXT NOT NULL, digest TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS host_events(
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        run TEXT NOT NULL, key TEXT NOT NULL,
        version INTEGER NOT NULL CHECK(version>0),
        value TEXT NOT NULL, event TEXT NOT NULL, digest TEXT NOT NULL,
        recorded INTEGER NOT NULL, UNIQUE(key,version));
      CREATE TRIGGER IF NOT EXISTS host_events_no_update BEFORE UPDATE ON host_events
        BEGIN SELECT RAISE(ABORT,'host events are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS host_events_no_delete BEFORE DELETE ON host_events
        BEGIN SELECT RAISE(ABORT,'host events are append-only'); END;
      CREATE INDEX IF NOT EXISTS host_events_by_run ON host_events(run,sequence);
      CREATE TABLE IF NOT EXISTS catalog_generations(
        run TEXT NOT NULL, generation INTEGER NOT NULL CHECK(generation>0),
        tasks TEXT NOT NULL, cause TEXT NOT NULL,
        parent_digest TEXT NOT NULL, digest TEXT NOT NULL,
        operation TEXT NOT NULL UNIQUE, recorded INTEGER NOT NULL,
        PRIMARY KEY(run,generation));
      CREATE TRIGGER IF NOT EXISTS catalog_generations_no_update BEFORE UPDATE ON catalog_generations
        BEGIN SELECT RAISE(ABORT,'catalog generations are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS catalog_generations_no_delete BEFORE DELETE ON catalog_generations
        BEGIN SELECT RAISE(ABORT,'catalog generations are append-only'); END;
      UPDATE metadata SET version=2;
      COMMIT;
    `);
    const version = this.db.prepare("SELECT version FROM metadata").all();
    if (version.length !== 1 || version[0]?.version !== 2) {
      this.db.close();
      throw new Error("unsupported orchestration journal schema");
    }
  }

  close(): void {
    this.db.close();
  }

  hasRun(run: string): boolean {
    const exists = !!this.db.prepare("SELECT id FROM runs WHERE id=?").get(run);
    if (exists) this.catalog(run);
    return exists;
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const guard of this.workspaceGuards) {
        const row = this.db
          .prepare(
            "SELECT r.version,r.value,r.digest,e.value AS evidence,e.digest AS evidenceDigest FROM workspace_records r JOIN workspace_events e ON e.key=r.key AND e.version=r.version WHERE r.key=?",
          )
          .get(guard.key);
        if (
          !row ||
          Number(row.version) !== guard.version ||
          digest(JSON.parse(String(row.value))) !== guard.valueDigest ||
          row.digest !== guard.valueDigest ||
          row.evidence !== row.value ||
          row.evidenceDigest !== row.digest ||
          (guard.expiresAt !== undefined && guard.expiresAt <= this.now())
        )
          throw new Error("workspace ownership guard is stale");
      }
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private assertLease(lease: OrchestrationLease): void {
    const held = this.db
      .prepare("SELECT owner,fence,expires FROM lease WHERE singleton=1")
      .get();
    if (
      !held ||
      held.owner !== lease.owner ||
      held.fence !== lease.fence ||
      Number(held.expires) <= this.now()
    )
      throw new Error("orchestration lease lost");
  }

  claim(durationMs: number): OrchestrationLease {
    if (
      !Number.isSafeInteger(durationMs) ||
      durationMs < 100 ||
      durationMs > 86_400_000
    )
      throw new Error("invalid lease duration");
    return this.transaction(() => {
      const row = this.db
        .prepare("SELECT fence,expires FROM lease WHERE singleton=1")
        .get()!;
      if (Number(row.expires) > this.now())
        throw new Error("orchestration host already active");
      const lease = { owner: randomUUID(), fence: Number(row.fence) + 1 };
      this.db
        .prepare("UPDATE lease SET owner=?,fence=?,expires=? WHERE singleton=1")
        .run(lease.owner, lease.fence, this.now() + durationMs);
      return lease;
    });
  }

  renew(lease: OrchestrationLease, durationMs: number): void {
    if (
      !Number.isSafeInteger(durationMs) ||
      durationMs < 100 ||
      durationMs > 86_400_000
    )
      throw new Error("invalid lease duration");
    this.transaction(() => {
      this.assertLease(lease);
      this.db
        .prepare("UPDATE lease SET expires=? WHERE singleton=1")
        .run(this.now() + durationMs);
    });
  }

  release(lease: OrchestrationLease): void {
    this.transaction(() => {
      this.assertLease(lease);
      this.db.prepare("UPDATE lease SET expires=0 WHERE singleton=1").run();
    });
  }

  readHostRecord(key: string): OrchestrationHostRecord {
    hostRecordKey(key);
    const row = this.db
      .prepare("SELECT version,value,digest FROM host_records WHERE key=?")
      .get(key);
    const latest = this.db
      .prepare(
        "SELECT run,key,version,value,event,digest FROM host_events WHERE key=? ORDER BY version DESC LIMIT 1",
      )
      .get(key);
    if (!row) {
      if (latest) throw new Error("host record projection missing");
      return { version: 0, value: null };
    }
    const version = Number(row.version);
    const value: unknown = JSON.parse(String(row.value));
    if (
      !Number.isSafeInteger(version) ||
      version < 1 ||
      row.digest !== digest({ key, version, value }) ||
      !latest ||
      latest.version !== row.version ||
      latest.value !== row.value ||
      latest.digest !==
        digest({
          run: String(latest.run),
          key,
          version,
          value,
          event: JSON.parse(String(latest.event)),
        })
    )
      throw new Error(
        "host record projection differs from append-only evidence",
      );
    return { version, value };
  }

  /** Trusted-host adapter boundary; never expose the lease or store to a worker. */
  compareAndSwapHostRecord(
    run: string,
    lease: OrchestrationLease,
    key: string,
    expectedVersion: number,
    value: unknown,
    event: unknown,
  ): boolean {
    hostRecordKey(key);
    if (
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 0 ||
      expectedVersion >= Number.MAX_SAFE_INTEGER
    )
      throw new Error("invalid host record version");
    if (value === null || event === null)
      throw new Error("host record and evidence cannot be null");
    const json = hostJson(value);
    const eventJson = hostJson(event);
    const snapshot: unknown = JSON.parse(json);
    const evidence: unknown = JSON.parse(eventJson);
    return this.transaction(() => {
      this.assertLease(lease);
      if (!this.db.prepare("SELECT id FROM runs WHERE id=?").get(run))
        throw new Error("host record requires an initialized run");
      if (this.readHostRecord(key).version !== expectedVersion) return false;
      const version = expectedVersion + 1;
      this.db
        .prepare(
          "INSERT INTO host_events(run,key,version,value,event,digest,recorded) VALUES(?,?,?,?,?,?,?)",
        )
        .run(
          run,
          key,
          version,
          json,
          eventJson,
          digest({ run, key, version, value: snapshot, event: evidence }),
          this.now(),
        );
      this.db
        .prepare(
          "INSERT INTO host_records VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET version=excluded.version,value=excluded.value,digest=excluded.digest",
        )
        .run(key, version, json, digest({ key, version, value: snapshot }));
      return true;
    });
  }

  hostEvents(run: string): OrchestrationHostEvent[] {
    return this.db
      .prepare(
        "SELECT sequence,run,key,version,value,event,digest,recorded FROM host_events WHERE run=? ORDER BY sequence",
      )
      .all(run)
      .map((row) => {
        const entry: OrchestrationHostEvent = {
          sequence: Number(row.sequence),
          run: String(row.run),
          key: String(row.key),
          version: Number(row.version),
          value: JSON.parse(String(row.value)),
          event: JSON.parse(String(row.event)),
          recorded: Number(row.recorded),
        };
        if (
          row.digest !==
          digest({
            run: entry.run,
            key: entry.key,
            version: entry.version,
            value: entry.value,
            event: entry.event,
          })
        )
          throw new Error("host event evidence corrupted");
        return entry;
      });
  }

  initialize(catalog: OrchestrationCatalog, lease: OrchestrationLease): void {
    this.transaction(() => {
      this.assertLease(lease);
      const hash = digest(catalog);
      const previous = this.db
        .prepare("SELECT catalog,digest FROM runs WHERE id=?")
        .get(catalog.id);
      if (previous) {
        if (
          previous.digest !== hash ||
          digest(JSON.parse(String(previous.catalog))) !== hash
        )
          throw new Error(
            "catalog changed: use explicit reconciliation or a new run ID",
          );
        this.catalog(catalog.id);
        return;
      }
      this.db
        .prepare("INSERT INTO runs VALUES(?,?,?)")
        .run(catalog.id, JSON.stringify(catalog), hash);
      for (const task of catalog.tasks) {
        const state: OrchestrationTaskState = {
          key: taskKey(task),
          stage: "specify",
          status: "pending",
          attempts: 0,
          failures: [],
          artifacts: {},
          contracts: {},
        };
        this.db
          .prepare("INSERT INTO tasks VALUES(?,?,?)")
          .run(catalog.id, state.key, JSON.stringify(state));
        this.append(
          catalog.id,
          state,
          `initialize:${catalog.id}:${state.key}`,
          "initialized",
        );
      }
    });
  }

  catalogGenerations(run: string): OrchestrationCatalogGeneration[] {
    const base = this.db
      .prepare("SELECT catalog,digest FROM runs WHERE id=?")
      .get(run);
    if (!base || digest(JSON.parse(String(base.catalog))) !== base.digest)
      throw new Error("orchestration catalog evidence missing or corrupted");
    let parent = String(base.digest);
    let generation = 0;
    return this.db
      .prepare(
        "SELECT generation,tasks,cause,parent_digest,digest,operation FROM catalog_generations WHERE run=? ORDER BY generation",
      )
      .all(run)
      .map((row) => {
        const tasks = parseOrchestrationTasks(JSON.parse(String(row.tasks)));
        const cause = catalogCause(JSON.parse(String(row.cause)));
        const receipt = this.db
          .prepare("SELECT value FROM host_events WHERE key=? AND version=?")
          .get(cause.recordKey, cause.recordVersion);
        generation++;
        const hash = digest({ run, generation, tasks, cause, parent });
        if (
          row.generation !== generation ||
          row.parent_digest !== parent ||
          row.digest !== hash ||
          row.operation !== cause.recordKey ||
          !receipt ||
          digest(JSON.parse(String(receipt.value))) !== cause.recordDigest
        )
          throw new Error("catalog generation evidence corrupted");
        parent = hash;
        return { generation, tasks, cause, digest: hash };
      });
  }

  catalog(run: string): OrchestrationCatalog {
    const base = this.db
      .prepare("SELECT catalog FROM runs WHERE id=?")
      .get(run);
    if (!base) throw new Error("orchestration run missing");
    const configured = parseOrchestrationCatalog(
      JSON.parse(String(base.catalog)),
    );
    const generations = this.catalogGenerations(run);
    const catalog = parseOrchestrationCatalog({
      ...configured,
      tasks: [
        ...configured.tasks,
        ...generations.flatMap((entry) => entry.tasks),
      ],
    });
    const states = this.states(run);
    const keys = new Set(states.map((state) => state.key));
    if (
      states.length !== catalog.tasks.length ||
      catalog.tasks.some((task) => !keys.has(taskKey(task)))
    )
      throw new Error("orchestration task projection incomplete");
    return catalog;
  }

  /** Caller validates the concrete factory evidence and authority before this atomic append. */
  appendCatalogTasks(
    run: string,
    lease: OrchestrationLease,
    proposed: unknown,
    evidence: OrchestrationCatalogCause,
  ): number {
    const tasks = parseOrchestrationTasks(proposed);
    const cause = catalogCause(evidence);
    return this.transaction(() => {
      this.assertLease(lease);
      const previous = this.db
        .prepare(
          "SELECT run,generation,tasks,cause FROM catalog_generations WHERE operation=?",
        )
        .get(cause.recordKey);
      const current = this.catalog(run);
      if (previous) {
        if (
          previous.run !== run ||
          previous.tasks !== JSON.stringify(tasks) ||
          previous.cause !== JSON.stringify(cause)
        )
          throw new Error("catalog append idempotency conflict");
        return Number(previous.generation);
      }
      const record = this.readHostRecord(cause.recordKey);
      if (
        record.version !== cause.recordVersion ||
        record.value === null ||
        digest(record.value) !== cause.recordDigest
      )
        throw new Error("catalog append host evidence changed or missing");
      parseOrchestrationCatalog({
        ...current,
        tasks: [...current.tasks, ...tasks],
      });
      const generations = this.catalogGenerations(run);
      const generation = generations.length + 1;
      const parent =
        generations.at(-1)?.digest ??
        String(
          this.db.prepare("SELECT digest FROM runs WHERE id=?").get(run)!
            .digest,
        );
      const hash = digest({ run, generation, tasks, cause, parent });
      this.db
        .prepare("INSERT INTO catalog_generations VALUES(?,?,?,?,?,?,?,?)")
        .run(
          run,
          generation,
          JSON.stringify(tasks),
          JSON.stringify(cause),
          parent,
          hash,
          cause.recordKey,
          this.now(),
        );
      for (const task of tasks) {
        const state: OrchestrationTaskState = {
          key: taskKey(task),
          stage: "specify",
          status: "pending",
          attempts: 0,
          failures: [],
          artifacts: {},
          contracts: {},
        };
        this.db
          .prepare("INSERT INTO tasks VALUES(?,?,?)")
          .run(run, state.key, JSON.stringify(state));
        this.append(run, state, `generated:${run}:${state.key}`, "generated");
      }
      return generation;
    });
  }

  states(run: string): OrchestrationTaskState[] {
    return this.db
      .prepare(
        `SELECT state,
      (SELECT body FROM events WHERE events.run=tasks.run AND events.key=tasks.key
       ORDER BY sequence DESC LIMIT 1) AS latest
      FROM tasks WHERE run=? ORDER BY key`,
      )
      .all(run)
      .map((row) => {
        const state = parseOrchestrationTaskState(
          JSON.parse(String(row.state)),
        );
        if (
          !row.latest ||
          JSON.stringify(state) !==
            JSON.stringify(
              parseOrchestrationTaskState(JSON.parse(String(row.latest))),
            )
        )
          throw new Error(
            "orchestration projection differs from append-only evidence",
          );
        return state;
      });
  }

  allReservations(): {
    run: string;
    key: string;
    projectRoot: string;
    scopes: string[];
  }[] {
    return this.db
      .prepare("SELECT id,catalog,digest FROM runs")
      .all()
      .flatMap((row) => {
        if (digest(JSON.parse(String(row.catalog))) !== row.digest)
          throw new Error("orchestration catalog evidence corrupted");
        const catalog = this.catalog(String(row.id));
        const states = this.states(String(row.id));
        return catalog.tasks
          .filter((task) =>
            states.some(
              (s) =>
                s.key === taskKey(task) &&
                (["running", "unknown"].includes(s.status) ||
                  (s.status === "needs-input" &&
                    task.sourceItem?.cause.recordKey.startsWith(
                      "native-proposal:",
                    ) &&
                    Boolean(s.invocation))),
            ),
          )
          .map((task) => ({
            run: catalog.id,
            key: taskKey(task),
            projectRoot: catalog.projects.find((p) => p.id === task.projectId)!
              .repositoryRoot,
            scopes: task.scopes,
          }));
      });
  }

  private append(
    run: string,
    state: OrchestrationTaskState,
    operation: string,
    kind: string,
  ): void {
    this.db
      .prepare(
        "INSERT INTO events(run,key,operation,kind,body,recorded) VALUES(?,?,?,?,?,?)",
      )
      .run(run, state.key, operation, kind, JSON.stringify(state), this.now());
  }

  checkpoint(
    run: string,
    lease: OrchestrationLease,
    expected: OrchestrationTaskState,
    next: OrchestrationTaskState,
    operation: string,
    kind: string,
  ): void {
    next = parseOrchestrationTaskState(next);
    expected = parseOrchestrationTaskState(expected);
    this.transaction(() => {
      this.assertLease(lease);
      const receipt = this.db
        .prepare("SELECT run,key,kind,body FROM events WHERE operation=?")
        .get(operation);
      if (receipt) {
        if (
          receipt.run !== run ||
          receipt.key !== next.key ||
          receipt.kind !== kind ||
          receipt.body !== JSON.stringify(next)
        )
          throw new Error("idempotency conflict");
        return;
      }
      const row = this.db
        .prepare("SELECT state FROM tasks WHERE run=? AND key=?")
        .get(run, expected.key);
      if (
        !row ||
        JSON.stringify(
          parseOrchestrationTaskState(JSON.parse(String(row.state))),
        ) !== JSON.stringify(expected) ||
        next.key !== expected.key
      )
        throw new Error("orchestration state conflict");
      this.append(run, next, operation, kind);
      this.db
        .prepare("UPDATE tasks SET state=? WHERE run=? AND key=?")
        .run(JSON.stringify(next), run, next.key);
    });
  }

  recover(run: string, lease: OrchestrationLease): void {
    for (const state of this.states(run)) {
      if (state.status === "running")
        this.checkpoint(
          run,
          lease,
          state,
          {
            ...state,
            status: "unknown",
            reason: "reserved invocation has unknown external outcome",
          },
          `recover:${run}:${state.key}:${state.invocation}`,
          "unknown",
        );
    }
  }

  events(
    run: string,
  ): { sequence: number; kind: string; state: OrchestrationTaskState }[] {
    return this.db
      .prepare(
        "SELECT sequence,kind,body FROM events WHERE run=? ORDER BY sequence",
      )
      .all(run)
      .map((row) => ({
        sequence: Number(row.sequence),
        kind: String(row.kind),
        state: parseOrchestrationTaskState(JSON.parse(String(row.body))),
      }));
  }

  /** Host-only reconciliation, never called from worker output or scheduler. */
  reconcile(
    run: string,
    lease: OrchestrationLease,
    key: string,
    outcome: "not-executed" | "abandon",
    evidence: string,
  ): void {
    if (!evidence.trim())
      throw new Error("reconciliation requires external evidence");
    const state = this.states(run).find((s) => s.key === key);
    if (!state || !["unknown", "needs-input"].includes(state.status))
      throw new Error("task is not awaiting reconciliation");
    this.checkpoint(
      run,
      lease,
      state,
      {
        ...state,
        status: outcome === "not-executed" ? "pending" : "needs-input",
        reason: `host reconciliation ${outcome}: ${evidence}`,
        invocation: undefined,
        intent: undefined,
      },
      `reconcile:${randomUUID()}`,
      "reconciled",
    );
  }
}
