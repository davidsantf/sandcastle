import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  parseWorkspaceConfiguration,
  type WorkspaceConfiguration,
  type WorkspaceStore,
  type WorkspaceStoreGuard,
  type WorkspaceEvent,
  type WorkspaceContractRoute,
} from "./OrchestrationWorkspaceContract.js";
import { digest, type OrchestrationProject } from "./MultiProjectProtocol.js";

export const workspaceConfigurationKey = "workspace:configuration";
const validKey = (key: string) => {
  if (!/^[A-Za-z][A-Za-z0-9._:/-]{0,255}$/.test(key))
    throw new Error("invalid workspace record key");
};
const json = (value: unknown) => {
  let nodes = 0;
  const ancestors = new Set<object>();
  const visit = (item: unknown, depth: number) => {
    if (++nodes > 100_000 || depth > 64)
      throw new Error("workspace JSON structural limit");
    if (
      item === null ||
      typeof item === "string" ||
      typeof item === "boolean" ||
      (typeof item === "number" && Number.isFinite(item))
    )
      return;
    if (
      !item ||
      typeof item !== "object" ||
      ancestors.has(item) ||
      (!Array.isArray(item) &&
        ![null, Object.prototype].includes(Object.getPrototypeOf(item)))
    )
      throw new Error("workspace records require acyclic plain JSON");
    ancestors.add(item);
    for (const child of Object.values(item)) visit(child, depth + 1);
    ancestors.delete(item);
  };
  visit(value, 0);
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized) > 1_048_576)
    throw new Error("workspace JSON byte limit");
  return serialized;
};

/** Shares the core journal file; workspace tables have their own schema version. */
export class OrchestrationWorkspaceStore implements WorkspaceStore {
  private readonly db: DatabaseSync;
  constructor(
    filename: string,
    private readonly now: () => number = Date.now,
  ) {
    if (filename !== ":memory:") {
      if (!path.isAbsolute(filename) || filename.startsWith("\\\\"))
        throw new Error("workspace requires absolute local database path");
      fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
      if (
        path.resolve(fs.realpathSync(path.dirname(filename))).toLowerCase() !==
        path.resolve(path.dirname(filename)).toLowerCase()
      )
        throw new Error("workspace directory must be canonical");
      if (
        fs.existsSync(filename) &&
        (!fs.lstatSync(filename).isFile() ||
          fs.lstatSync(filename).isSymbolicLink())
      )
        throw new Error("workspace database must be a regular local file");
    }
    const sqlite: typeof import("node:sqlite") = createRequire(import.meta.url)(
      "node:sqlite",
    );
    this.db = new sqlite.DatabaseSync(filename);
    try {
      this.db.exec(
        "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;",
      );
      this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS workspace_metadata(version INTEGER NOT NULL);
        INSERT INTO workspace_metadata SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM workspace_metadata);
        CREATE TABLE IF NOT EXISTS workspace_records(
          key TEXT PRIMARY KEY, version INTEGER NOT NULL CHECK(version>0), value TEXT NOT NULL, digest TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS workspace_events(
          sequence INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, version INTEGER NOT NULL,
          kind TEXT NOT NULL, at TEXT NOT NULL, value TEXT NOT NULL, digest TEXT NOT NULL, UNIQUE(key,version));
        CREATE TRIGGER IF NOT EXISTS workspace_events_no_update BEFORE UPDATE ON workspace_events
          BEGIN SELECT RAISE(ABORT,'workspace events are append-only'); END;
        CREATE TRIGGER IF NOT EXISTS workspace_events_no_delete BEFORE DELETE ON workspace_events
          BEGIN SELECT RAISE(ABORT,'workspace events are append-only'); END;
      `);
      const versions = this.db
        .prepare("SELECT version FROM workspace_metadata")
        .all();
      if (versions.length !== 1 || Number(versions[0]!.version) !== 1)
        throw new Error("unsupported workspace schema");
      this.db.exec("COMMIT");
      if (filename !== ":memory:" && process.platform !== "win32")
        fs.chmodSync(filename, 0o600);
    } catch (error) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      this.db.close();
      throw error;
    }
  }
  close() {
    this.db.close();
  }
  guards(): readonly WorkspaceStoreGuard[] {
    return [];
  }
  read(key: string) {
    validKey(key);
    const row = this.db
      .prepare("SELECT version,value,digest FROM workspace_records WHERE key=?")
      .get(key);
    if (!row) return { version: 0, value: null };
    const value: unknown = JSON.parse(String(row.value));
    if (digest(value) !== row.digest)
      throw new Error("workspace record integrity failure");
    const event = this.db
      .prepare(
        "SELECT value,digest FROM workspace_events WHERE key=? AND version=?",
      )
      .get(key, Number(row.version));
    if (!event || event.value !== row.value || event.digest !== row.digest)
      throw new Error("workspace projection lacks matching evidence");
    return { version: Number(row.version), value };
  }
  compareAndSwap(
    key: string,
    expectedVersion: number,
    value: unknown,
    event: { kind: string; at: string },
  ) {
    return this.write([], key, expectedVersion, value, event);
  }
  private write(
    guards: WorkspaceStoreGuard[],
    key: string,
    expectedVersion: number,
    value: unknown,
    event: { kind: string; at: string },
  ) {
    validKey(key);
    if (
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 0 ||
      !/^[a-z][a-z0-9-]{0,99}$/.test(event.kind) ||
      !Number.isFinite(Date.parse(event.at))
    )
      throw new Error("invalid workspace CAS evidence");
    const serialized = json(value),
      valueDigest = digest(value);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const guard of guards) {
        const held = this.read(guard.key);
        if (
          held.version !== guard.version ||
          digest(held.value) !== guard.valueDigest ||
          (guard.expiresAt !== undefined && guard.expiresAt <= this.now())
        )
          throw new Error("workspace ownership guard is stale");
      }
      if (this.read(key).version !== expectedVersion) {
        this.db.exec("ROLLBACK");
        return false;
      }
      this.db
        .prepare(
          `INSERT INTO workspace_records VALUES(?,?,?,?)
        ON CONFLICT(key) DO UPDATE SET version=excluded.version,value=excluded.value,digest=excluded.digest`,
        )
        .run(key, expectedVersion + 1, serialized, valueDigest);
      this.db
        .prepare(
          "INSERT INTO workspace_events(key,version,kind,at,value,digest) VALUES(?,?,?,?,?,?)",
        )
        .run(
          key,
          expectedVersion + 1,
          event.kind,
          event.at,
          serialized,
          valueDigest,
        );
      this.db.exec("COMMIT");
      return true;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      throw error;
    }
  }
  events(after = 0): WorkspaceEvent[] {
    if (!Number.isSafeInteger(after) || after < 0)
      throw new Error("invalid event cursor");
    return this.db
      .prepare(
        "SELECT sequence,key,version,kind,at,digest,value FROM workspace_events WHERE sequence>? ORDER BY sequence LIMIT 10000",
      )
      .all(after)
      .map((row) => {
        if (digest(JSON.parse(String(row.value))) !== row.digest)
          throw new Error("workspace event integrity failure");
        return {
          sequence: Number(row.sequence),
          key: String(row.key),
          version: Number(row.version),
          kind: String(row.kind),
          at: String(row.at),
          valueDigest: String(row.digest),
        };
      });
  }
  withGuard(guard: WorkspaceStoreGuard): WorkspaceStore {
    return this.guarded([guard]);
  }
  private guarded(guards: WorkspaceStoreGuard[]): WorkspaceStore {
    const captured = guards.map((guard) => {
      validKey(guard.key);
      if (
        !Number.isSafeInteger(guard.version) ||
        guard.version < 1 ||
        !/^[a-f0-9]{64}$/.test(guard.valueDigest) ||
        (guard.expiresAt !== undefined && !Number.isFinite(guard.expiresAt))
      )
        throw new Error("invalid ownership guard");
      return Object.freeze({ ...guard });
    });
    return {
      guards: () => captured.map((guard) => ({ ...guard })),
      read: (key) => this.read(key),
      compareAndSwap: (key, version, value, event) =>
        this.write(captured, key, version, value, event),
      events: (after) => this.events(after),
      withGuard: (guard) => this.guarded([...captured, guard]),
    };
  }
}

export function defaultWorkspaceConfiguration(
  id = "local",
): WorkspaceConfiguration {
  return parseWorkspaceConfiguration({
    schemaVersion: 1,
    revision: 1,
    id,
    projects: [],
    routes: [],
    focus: {
      mode: "observe",
      projectIds: [],
      priorities: {},
      maxConcurrency: 2,
      budgets: { maxItems: 20, maxAttempts: 3, maxRuntimeMs: 300000 },
      permissions: [],
    },
    runtime: {
      framework: "devsquad",
      agent: "devsquad",
      model: "default",
      command: "copilot",
    },
    pollIntervalMs: 60000,
  });
}
export function initializeWorkspace(
  store: WorkspaceStore,
  id?: string,
): WorkspaceConfiguration {
  const configuration = defaultWorkspaceConfiguration(id);
  if (
    !store.compareAndSwap(workspaceConfigurationKey, 0, configuration, {
      kind: "workspace-initialized",
      at: new Date().toISOString(),
    })
  )
    throw new Error("workspace already initialized");
  return configuration;
}
export function readWorkspaceConfiguration(
  store: WorkspaceStore,
): WorkspaceConfiguration {
  const record = store.read(workspaceConfigurationKey);
  if (!record.version)
    throw new Error(
      "workspace not initialized; run orchestrate workspace init",
    );
  const config = parseWorkspaceConfiguration(record.value);
  if (record.version !== config.revision)
    throw new Error("workspace configuration version mismatch");
  return config;
}
export function updateWorkspaceConfiguration(
  store: WorkspaceStore,
  expectedRevision: number,
  update: (configuration: WorkspaceConfiguration) => WorkspaceConfiguration,
): WorkspaceConfiguration {
  const previous = readWorkspaceConfiguration(store);
  if (previous.revision !== expectedRevision)
    throw new Error("workspace configuration changed; reload before editing");
  const next = parseWorkspaceConfiguration({
    ...update(structuredClone(previous)),
    revision: expectedRevision + 1,
  });
  if (next.id !== previous.id)
    throw new Error("workspace identity is immutable");
  if (
    !store.compareAndSwap(workspaceConfigurationKey, expectedRevision, next, {
      kind: "workspace-configured",
      at: new Date().toISOString(),
    })
  )
    throw new Error("workspace configuration changed concurrently");
  return next;
}
export function migrateWorkspaceConfiguration(
  store: WorkspaceStore,
): WorkspaceConfiguration {
  const record = store.read(workspaceConfigurationKey);
  const normalized = readWorkspaceConfiguration(store);
  if (digest(record.value) === digest(normalized)) return normalized;
  return updateWorkspaceConfiguration(
    store,
    normalized.revision,
    () => normalized,
  );
}
export function registerWorkspaceProject(
  store: WorkspaceStore,
  revision: number,
  project: OrchestrationProject,
) {
  const canonical = fs.realpathSync(project.repositoryRoot);
  if (!fs.statSync(canonical).isDirectory())
    throw new Error("repository root must be a directory");
  return updateWorkspaceConfiguration(store, revision, (config) => ({
    ...config,
    projects: [...config.projects, { ...project, repositoryRoot: canonical }],
  }));
}
export function removeWorkspaceProject(
  store: WorkspaceStore,
  revision: number,
  id: string,
) {
  return updateWorkspaceConfiguration(store, revision, (config) => {
    if (!config.projects.some((project) => project.id === id))
      throw new Error("unknown project registration");
    if (
      config.routes.some(
        (route) => route.producer === id || route.consumer === id,
      )
    )
      throw new Error(
        "remove referencing contract routes before removing project registration",
      );
    const priorities = { ...config.focus.priorities };
    delete priorities[id];
    return {
      ...config,
      projects: config.projects.filter((project) => project.id !== id),
      discovery: config.discovery.filter((source) => source.projectId !== id),
      taskTemplates: config.taskTemplates.filter(
        (task) => task.projectId !== id,
      ),
      focus: {
        ...config.focus,
        projectIds: config.focus.projectIds.filter((value) => value !== id),
        priorities,
        permissions: config.focus.permissions.filter(
          (grant) => grant.projectId !== id,
        ),
      },
    };
  });
}
export function registerWorkspaceRoute(
  store: WorkspaceStore,
  revision: number,
  route: WorkspaceContractRoute,
) {
  return updateWorkspaceConfiguration(store, revision, (config) => ({
    ...config,
    routes: [...config.routes, route],
  }));
}
export function removeWorkspaceRoute(
  store: WorkspaceStore,
  revision: number,
  id: string,
) {
  return updateWorkspaceConfiguration(store, revision, (config) => {
    if (!config.routes.some((route) => route.id === id))
      throw new Error("unknown contract route");
    return {
      ...config,
      routes: config.routes.filter((route) => route.id !== id),
    };
  });
}
