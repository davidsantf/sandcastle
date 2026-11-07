import type { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdirSync, realpathSync } from "node:fs";
import path from "node:path";
import {
  digest,
  taskKey,
  parseOrchestrationCatalog,
  parseOrchestrationTaskState,
  type OrchestrationCatalog,
  type OrchestrationTaskState,
} from "./MultiProjectProtocol.js";

export interface OrchestrationLease {
  owner: string;
  fence: number;
}

/** Owner-controlled local SQLite, not the private-file ADO ledger boundary. */
export class MultiProjectJournal {
  private readonly db: DatabaseSync;
  constructor(
    filename: string,
    private readonly now: () => number = Date.now,
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
      if (version.length !== 1 || version[0]?.version !== 1) {
        this.db.close();
        throw new Error("unsupported orchestration journal schema");
      }
    }
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      PRAGMA busy_timeout=5000;
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
    `);
    const version = this.db.prepare("SELECT version FROM metadata").all();
    if (version.length !== 1 || version[0]?.version !== 1) {
      this.db.close();
      throw new Error("unsupported orchestration journal schema");
    }
  }

  close(): void {
    this.db.close();
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
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
        const states = this.states(catalog.id);
        if (
          states.length !== catalog.tasks.length ||
          catalog.tasks.some(
            (task) => !states.some((state) => state.key === taskKey(task)),
          )
        )
          throw new Error("orchestration task projection incomplete");
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
        const catalog = parseOrchestrationCatalog(
          JSON.parse(String(row.catalog)),
        );
        const states = this.states(String(row.id));
        return catalog.tasks
          .filter((task) =>
            states.some(
              (s) =>
                s.key === taskKey(task) &&
                ["running", "unknown"].includes(s.status),
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
