import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MultiProjectJournal,
  type OrchestrationLease,
} from "./MultiProjectJournal.js";
import { digest, parseOrchestrationCatalog } from "./MultiProjectProtocol.js";
import {
  runMultiProjectOrchestrationPass,
  type MultiProjectHost,
} from "./MultiProjectOrchestrator.js";

const journals: MultiProjectJournal[] = [];
const folders: string[] = [];
afterEach(() => {
  for (const journal of journals.splice(0)) journal.close();
  for (const folder of folders.splice(0))
    rmSync(folder, { recursive: true, force: true });
});
const catalog = (id = "host-records") =>
  parseOrchestrationCatalog({
    id,
    projects: [
      {
        id: "app",
        repositoryRoot: realpathSync(os.tmpdir()),
        mode: "individual",
        hub: { kind: "github", repository: "fixture/app", pullRequest: 1 },
      },
    ],
    tasks: [
      {
        id: "one",
        projectId: "app",
        title: "task",
        brief: "fixture",
        branch: "work/one",
        baseBranch: "main",
        scopes: ["src"],
        acceptance: [{ label: "unit", command: "fixture" }],
      },
    ],
  });
const open = (file = ":memory:", now?: () => number) => {
  const journal = new MultiProjectJournal(file, now);
  journals.push(journal);
  return journal;
};
const database = () => {
  const folder = mkdtempSync(path.join(os.tmpdir(), "sandcastle-host-record-"));
  folders.push(folder);
  return path.join(folder, "journal.sqlite");
};
const key = `factory:${digest("causal-intent")}`;
const reserved = { state: "reserved", intent: digest("intent") };
const completed = { ...reserved, state: "completed", receipt: "host-verified" };
const event = { kind: "publication-reserved", evidence: "fixture" };
const generated = (id = "two", pullRequest = 2) => ({
  ...catalog().tasks[0]!,
  id,
  branch: `work/${id}`,
  pullRequest,
});
const evidence = (
  journal: MultiProjectJournal,
  lease: OrchestrationLease,
  id = "one",
) => {
  const recordKey = `factory:${digest(id)}`;
  const value = { state: "completed", receipt: `host-fixture:${id}` };
  journal.compareAndSwapHostRecord(catalog().id, lease, recordKey, 0, value, {
    kind: "fixture-approved-publication",
  });
  return { recordKey, recordVersion: 1, recordDigest: digest(value) };
};

describe("fenced same-database host records", () => {
  it("atomically stores a versioned record and append-only evidence", () => {
    const journal = open();
    const lease = journal.claim(1_000);
    journal.initialize(catalog(), lease);
    expect(journal.readHostRecord(key)).toEqual({ version: 0, value: null });
    expect(
      journal.compareAndSwapHostRecord(
        catalog().id,
        lease,
        key,
        0,
        reserved,
        event,
      ),
    ).toBe(true);
    expect(journal.readHostRecord(key)).toEqual({
      version: 1,
      value: reserved,
    });
    expect(journal.hostEvents(catalog().id)).toEqual([
      expect.objectContaining({ key, version: 1, value: reserved, event }),
    ]);
  });

  describe("atomic catalog generations", () => {
    it("retains the immutable base and deduplicates append/restart", () => {
      const file = database();
      const journal = open(file);
      const lease = journal.claim(10_000);
      const base = catalog();
      journal.initialize(base, lease);
      const cause = evidence(journal, lease);
      const task = generated();
      expect(journal.appendCatalogTasks(base.id, lease, [task], cause)).toBe(1);
      expect(journal.catalog(base.id).tasks).toEqual([...base.tasks, task]);
      expect(journal.catalogGenerations(base.id)).toHaveLength(1);
      expect(journal.events(base.id)).toHaveLength(2);
      journal.initialize(base, lease);
      expect(journal.appendCatalogTasks(base.id, lease, [task], cause)).toBe(1);
      expect(() =>
        journal.appendCatalogTasks(
          base.id,
          lease,
          [{ ...task, brief: "changed replay" }],
          cause,
        ),
      ).toThrow(/idempotency conflict/);
      expect(() =>
        journal.initialize(
          {
            ...base,
            tasks: [{ ...base.tasks[0]!, title: "changed base" }],
          },
          lease,
        ),
      ).toThrow(/catalog changed/);
      journal.release(lease);
      const restarted = open(file);
      const nextLease = restarted.claim(10_000);
      restarted.initialize(base, nextLease);
      expect(
        restarted.appendCatalogTasks(base.id, nextLease, [task], cause),
      ).toBe(1);
      expect(restarted.catalog(base.id).tasks).toHaveLength(2);
      expect(restarted.events(base.id)).toHaveLength(2);
    });

    it("requires exact retained host record evidence and live fencing", () => {
      let now = 0;
      const journal = open(":memory:", () => now);
      const lease = journal.claim(100);
      journal.initialize(catalog(), lease);
      const cause = evidence(journal, lease);
      expect(() =>
        journal.appendCatalogTasks(catalog().id, lease, [generated()], {
          ...cause,
          recordDigest: digest("wrong receipt"),
        }),
      ).toThrow(/evidence changed/);
      journal.compareAndSwapHostRecord(
        catalog().id,
        lease,
        cause.recordKey,
        1,
        completed,
        event,
      );
      expect(() =>
        journal.appendCatalogTasks(catalog().id, lease, [generated()], cause),
      ).toThrow(/evidence changed/);
      expect(journal.catalogGenerations(catalog().id)).toHaveLength(0);
      now = 100;
      expect(() =>
        journal.appendCatalogTasks(catalog().id, lease, [generated()], cause),
      ).toThrow(/lease lost/);
    });

    it("keeps an accepted generation valid after later host record updates", () => {
      const journal = open();
      const lease = journal.claim(10_000);
      journal.initialize(catalog(), lease);
      const cause = evidence(journal, lease);
      journal.appendCatalogTasks(catalog().id, lease, [generated()], cause);
      journal.compareAndSwapHostRecord(
        catalog().id,
        lease,
        cause.recordKey,
        1,
        completed,
        event,
      );
      expect(journal.catalog(catalog().id).tasks).toHaveLength(2);
      expect(
        journal.appendCatalogTasks(catalog().id, lease, [generated()], cause),
      ).toBe(1);
    });

    it("rejects invalid IDs/edges/cycles/scopes/branches without partial state", () => {
      const journal = open();
      const lease = journal.claim(10_000);
      journal.initialize(catalog(), lease);
      const cause = evidence(journal, lease);
      const invalid = [
        [generated("one", 2)],
        [{ ...generated(), dependsOn: ["app:absent"] }],
        [
          { ...generated(), dependsOn: ["app:three"] },
          { ...generated("three", 3), dependsOn: ["app:two"] },
        ],
        [{ ...generated(), scopes: ["../escape"] }],
        [{ ...generated(), branch: "work/one" }],
        [generated("two", 1)],
      ];
      for (const tasks of invalid) {
        expect(() =>
          journal.appendCatalogTasks(catalog().id, lease, tasks, cause),
        ).toThrow();
        expect(journal.catalogGenerations(catalog().id)).toHaveLength(0);
        expect(journal.states(catalog().id)).toHaveLength(1);
        expect(journal.events(catalog().id)).toHaveLength(1);
      }
    });

    it("adds a separate follow-up without rewriting a reserved task intent", () => {
      const journal = open();
      const lease = journal.claim(10_000);
      journal.initialize(catalog(), lease);
      journal.appendCatalogTasks(
        catalog().id,
        lease,
        [generated()],
        evidence(journal, lease),
      );
      const initial = journal
        .states(catalog().id)
        .find((state) => state.key === "app:two")!;
      const running = {
        ...initial,
        status: "running" as const,
        invocation: "11111111-1111-4111-8111-111111111111",
        intent: digest("immutable-version-one"),
      };
      journal.checkpoint(
        catalog().id,
        lease,
        initial,
        running,
        "fixture-reservation",
        "reserved",
      );
      journal.appendCatalogTasks(
        catalog().id,
        lease,
        [generated("followup", 3)],
        evidence(journal, lease, "version-two"),
      );
      expect(
        journal.states(catalog().id).find((state) => state.key === running.key),
      ).toEqual(running);
      expect(journal.catalog(catalog().id).tasks[1]).toEqual(generated());
      expect(journal.allReservations()).toEqual([
        expect.objectContaining({ key: running.key, scopes: ["src"] }),
      ]);
      journal.recover(catalog().id, lease);
      expect(
        journal.states(catalog().id).find((state) => state.key === running.key)
          ?.status,
      ).toBe("unknown");
      expect(journal.allReservations()).toHaveLength(1);
    });

    it("rolls back generations and events on intentionally failed task insertion", () => {
      const file = database();
      const journal = open(file);
      const lease = journal.claim(10_000);
      journal.initialize(catalog(), lease);
      const cause = evidence(journal, lease);
      const fixture = new DatabaseSync(file);
      try {
        fixture.exec(`
            CREATE TRIGGER fail_generated_task BEFORE INSERT ON tasks
            WHEN NEW.key='app:two'
            BEGIN SELECT RAISE(ABORT,'fixture generated task failure'); END;
          `);
        expect(() =>
          journal.appendCatalogTasks(catalog().id, lease, [generated()], cause),
        ).toThrow(/fixture generated task failure/);
        expect(journal.catalogGenerations(catalog().id)).toHaveLength(0);
        expect(journal.events(catalog().id)).toHaveLength(1);
        expect(journal.states(catalog().id)).toHaveLength(1);
        fixture.exec("DROP TRIGGER fail_generated_task");
        journal.appendCatalogTasks(catalog().id, lease, [generated()], cause);
        expect(() => fixture.exec("DELETE FROM catalog_generations")).toThrow(
          /append-only/,
        );
        expect(() =>
          fixture.exec("UPDATE catalog_generations SET tasks='[]'"),
        ).toThrow(/append-only/);
        fixture.prepare("DELETE FROM tasks WHERE key=?").run("app:two");
        expect(() => journal.initialize(catalog(), lease)).toThrow(
          /projection incomplete/,
        );
      } finally {
        fixture.close();
      }
    });

    it("dispatches appended tasks from the original config, then performs zero replay work", async () => {
      const journal = open();
      const lease = journal.claim(10_000);
      const base = catalog();
      journal.initialize(base, lease);
      journal.appendCatalogTasks(
        base.id,
        lease,
        [generated()],
        evidence(journal, lease),
      );
      journal.release(lease);
      const calls: string[] = [];
      const revision = "a".repeat(40);
      const host: MultiProjectHost = {
        authorize: async () => true,
        resolveRevision: async () => revision,
        execute: async (request) => {
          calls.push(`${request.task.id}:${request.stage}`);
          return {
            kind: "completed",
            artifact: `fixture:${request.stage}`,
            contracts: {},
            findings: [],
          };
        },
        validate: async () => ({
          revision,
          evaluatedScope: 1,
          regressions: 0,
          checks: [{ name: "unit", state: "passed" }],
          contracts: {},
        }),
        observe: async () => ({
          revision,
          policiesKnown: true,
          required: ["build"],
          checks: [{ name: "build", state: "passed" }],
          labels: [],
        }),
      };
      const result = await runMultiProjectOrchestrationPass({
        catalog: base,
        journal,
        host,
      });
      expect(
        result.tasks.filter((state) => state.status === "completed"),
      ).toHaveLength(2);
      expect(calls).toContain("two:implement");
      const count = journal.events(base.id).length;
      const replay = await runMultiProjectOrchestrationPass({
        catalog: base,
        journal,
        host,
      });
      expect(replay.dispatched).toBe(0);
      expect(journal.events(base.id)).toHaveLength(count);
    });
  });

  it("rejects stale CAS and atomically records completion", () => {
    const journal = open();
    const lease = journal.claim(10_000);
    journal.initialize(catalog(), lease);
    journal.compareAndSwapHostRecord(
      catalog().id,
      lease,
      key,
      0,
      reserved,
      event,
    );
    expect(journal.hostEvents(catalog().id)).toEqual([
      expect.objectContaining({ key, version: 1, value: reserved, event }),
    ]);
    expect(
      journal.compareAndSwapHostRecord(
        catalog().id,
        lease,
        key,
        0,
        completed,
        event,
      ),
    ).toBe(false);
    expect(journal.hostEvents(catalog().id)).toHaveLength(1);
    expect(
      journal.compareAndSwapHostRecord(catalog().id, lease, key, 1, completed, {
        kind: "publication-completed",
      }),
    ).toBe(true);
    expect(journal.readHostRecord(key)).toEqual({
      version: 2,
      value: completed,
    });
    expect(journal.hostEvents(catalog().id)).toHaveLength(2);
    expect(journal.events(catalog().id)).toHaveLength(1);
  });

  it("preserves global causal identity across runs and restart", () => {
    const file = database();
    const journal = open(file);
    const lease = journal.claim(1_000);
    journal.initialize(catalog(), lease);
    journal.compareAndSwapHostRecord(
      catalog().id,
      lease,
      key,
      0,
      reserved,
      event,
    );
    journal.release(lease);
    const restarted = open(file);
    const nextLease = restarted.claim(1_000);
    restarted.initialize(catalog("next-run"), nextLease);
    expect(restarted.readHostRecord(key)).toEqual({
      version: 1,
      value: reserved,
    });
    expect(
      restarted.compareAndSwapHostRecord(
        "next-run",
        nextLease,
        key,
        0,
        reserved,
        event,
      ),
    ).toBe(false);
    expect(
      restarted.compareAndSwapHostRecord(
        "next-run",
        nextLease,
        key,
        1,
        completed,
        event,
      ),
    ).toBe(true);
    expect(restarted.hostEvents(catalog().id)).toHaveLength(1);
    expect(restarted.hostEvents("next-run")).toHaveLength(1);
  });

  it("refuses expired or superseded fencing and uninitialized runs", () => {
    let now = 0;
    const journal = open(":memory:", () => now);
    const lease = journal.claim(100);
    expect(() =>
      journal.compareAndSwapHostRecord(
        "missing",
        lease,
        key,
        0,
        reserved,
        event,
      ),
    ).toThrow(/initialized/);
    journal.initialize(catalog(), lease);
    now = 100;
    expect(() =>
      journal.compareAndSwapHostRecord(
        catalog().id,
        lease,
        key,
        0,
        reserved,
        event,
      ),
    ).toThrow(/lease lost/);
    const nextLease = journal.claim(100);
    expect(() =>
      journal.compareAndSwapHostRecord(
        catalog().id,
        lease,
        key,
        0,
        reserved,
        event,
      ),
    ).toThrow(/lease lost/);
    expect(
      journal.compareAndSwapHostRecord(
        catalog().id,
        nextLease,
        key,
        0,
        reserved,
        event,
      ),
    ).toBe(true);
  });

  it("rolls back evidence when projection persistence intentionally fails", () => {
    const file = database();
    const journal = open(file);
    const lease = journal.claim(10_000);
    journal.initialize(catalog(), lease);
    journal.compareAndSwapHostRecord(
      catalog().id,
      lease,
      key,
      0,
      reserved,
      event,
    );
    const fixture = new DatabaseSync(file);
    try {
      fixture.exec(`
        CREATE TRIGGER fail_host_projection BEFORE UPDATE ON host_records
        BEGIN SELECT RAISE(ABORT,'fixture projection failure'); END;
      `);
      expect(() =>
        journal.compareAndSwapHostRecord(
          catalog().id,
          lease,
          key,
          1,
          completed,
          event,
        ),
      ).toThrow(/fixture projection failure/);
      expect(journal.readHostRecord(key)).toEqual({
        version: 1,
        value: reserved,
      });
      expect(journal.hostEvents(catalog().id)).toHaveLength(1);
      fixture.exec("DROP TRIGGER fail_host_projection");
      expect(
        journal.compareAndSwapHostRecord(
          catalog().id,
          lease,
          key,
          1,
          completed,
          event,
        ),
      ).toBe(true);
    } finally {
      fixture.close();
    }
  });

  it("detects corrupted/missing projections and forbids event mutation", () => {
    const file = database();
    const journal = open(file);
    const lease = journal.claim(10_000);
    journal.initialize(catalog(), lease);
    journal.compareAndSwapHostRecord(
      catalog().id,
      lease,
      key,
      0,
      reserved,
      event,
    );
    const fixture = new DatabaseSync(file);
    try {
      expect(() => fixture.exec("DELETE FROM host_events")).toThrow(
        /append-only/,
      );
      expect(() => fixture.exec("UPDATE host_events SET event='{}'")).toThrow(
        /append-only/,
      );
      fixture
        .prepare("UPDATE host_records SET value=? WHERE key=?")
        .run("{}", key);
      expect(() => journal.readHostRecord(key)).toThrow(/append-only evidence/);
      fixture.prepare("DELETE FROM host_records WHERE key=?").run(key);
      expect(() => journal.readHostRecord(key)).toThrow(/projection missing/);
    } finally {
      fixture.close();
    }
  });

  it("validates namespaced keys, versions and bounded plain JSON", () => {
    const journal = open();
    const lease = journal.claim(10_000);
    journal.initialize(catalog(), lease);
    expect(() => journal.readHostRecord("token")).toThrow(/namespaced/);
    for (const version of [-1, 0.5, NaN, Number.MAX_SAFE_INTEGER]) {
      expect(() =>
        journal.compareAndSwapHostRecord(
          catalog().id,
          lease,
          key,
          version,
          reserved,
          event,
        ),
      ).toThrow(/version/);
    }
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    for (const value of [
      undefined,
      null,
      Infinity,
      () => true,
      new Date(),
      cycle,
      [undefined],
    ]) {
      expect(() =>
        journal.compareAndSwapHostRecord(
          catalog().id,
          lease,
          key,
          0,
          value,
          event,
        ),
      ).toThrow(/JSON|cannot be null/);
    }
    expect(() =>
      journal.compareAndSwapHostRecord(
        catalog().id,
        lease,
        key,
        0,
        "x".repeat(1_048_576),
        event,
      ),
    ).toThrow(/byte limit/);
    expect(journal.hostEvents(catalog().id)).toHaveLength(0);
  });

  it("upgrades schema 1 in place without changing existing task evidence", () => {
    const file = database();
    const old = new DatabaseSync(file);
    old.exec(
      "CREATE TABLE metadata(version INTEGER NOT NULL); INSERT INTO metadata VALUES(1)",
    );
    old.close();
    const journal = open(file);
    const lease = journal.claim(10_000);
    journal.initialize(catalog(), lease);
    const inspection = new DatabaseSync(file);
    try {
      expect(
        inspection.prepare("SELECT version FROM metadata").get()?.version,
      ).toBe(2);
      expect(journal.events(catalog().id)).toHaveLength(1);
      expect(journal.hostEvents(catalog().id)).toHaveLength(0);
    } finally {
      inspection.close();
    }
  });
});
