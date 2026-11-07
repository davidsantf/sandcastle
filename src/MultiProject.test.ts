import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { MultiProjectJournal } from "./MultiProjectJournal.js";
import {
  runMultiProjectOrchestrationPass,
  type MultiProjectHost,
  type OrchestrationHostRunContext,
  type OrchestrationPolicyEvidence,
} from "./MultiProjectOrchestrator.js";
import {
  digest,
  evaluateOrchestrationChecks,
  parseOrchestrationCatalog,
  parseWorkerReceipt,
  scopesConflict,
  taskKey,
  type OrchestrationCatalog,
  type OrchestrationHubEvidence,
  type OrchestrationTaskState,
} from "./MultiProjectProtocol.js";
import { runMultiProjectDemo } from "./MultiProjectDemo.js";
import { buildMultiProjectWorkerPrompt } from "./MultiProjectWorker.js";
import { DatabaseSync } from "node:sqlite";

const folders: string[] = [];
const journals: MultiProjectJournal[] = [];
afterEach(() => {
  for (const journal of journals.splice(0)) journal.close();
  for (const folder of folders.splice(0))
    rmSync(folder, { recursive: true, force: true });
});
const sha = "a".repeat(40);
const sha2 = "b".repeat(40);
const temp = (): string => {
  const folder = mkdtempSync(path.join(os.tmpdir(), "sandcastle-multi-"));
  folders.push(folder);
  return folder;
};
const open = (
  filename = ":memory:",
  now?: () => number,
): MultiProjectJournal => {
  const journal = new MultiProjectJournal(filename, now);
  journals.push(journal);
  return journal;
};
const catalog = (): OrchestrationCatalog => {
  const root = temp();
  const projects = ["api", "app", "docs"].map((id) => {
    const repositoryRoot = path.join(root, id);
    mkdirSync(repositoryRoot);
    return {
      id,
      repositoryRoot,
      mode: id === "docs" ? "individual" : "integrated",
      hub: { kind: "github", repository: `demo/${id}`, pullRequest: 1 },
    };
  });
  const task = (projectId: string) => ({
    projectId,
    id: "one",
    title: projectId,
    brief: "brief",
    branch: "work/one",
    baseBranch: "main",
    scopes: ["src"],
    acceptance: [{ label: "unit", command: "host-command" }],
  });
  return parseOrchestrationCatalog({
    id: "test",
    projects,
    tasks: [
      { ...task("api"), providesContracts: ["api"] },
      {
        ...task("app"),
        dependsOn: ["api:one"],
        requiresContracts: [{ task: "api:one", name: "api" }],
      },
      task("docs"),
    ],
  });
};
const green = (): OrchestrationHubEvidence => ({
  revision: sha,
  policiesKnown: true,
  required: ["build"],
  checks: [{ name: "build", state: "passed" }],
  labels: [],
});
const host = (overrides: Partial<MultiProjectHost> = {}): MultiProjectHost => ({
  authorize: async () => true,
  execute: async (request) => ({
    kind: "completed",
    artifact: `artifact:${request.stage}`,
    contracts: {},
    findings: [],
  }),
  resolveRevision: async () => sha,
  validate: async (request) => ({
    revision: sha,
    evaluatedScope: 1,
    regressions: 0,
    checks: [{ name: "unit", state: "passed" }],
    contracts: { ...request.contracts, api: digest("API") },
  }),
  observe: async () => green(),
  ...overrides,
});

describe("fenced host policy lifecycle", () => {
  const passed = (): OrchestrationPolicyEvidence => ({
    state: "passed",
    revision: sha,
    evaluatedScope: 1,
    checks: [{ name: "host-policy", state: "passed" }],
    evidence: "Independently evaluated policy fixture",
  });
  const individual = (): OrchestrationCatalog => {
    const c = catalog();
    return { ...c, tasks: [c.tasks[2]!] };
  };
  it("binds a fresh fenced host each pass and persists non-vacuous phase and verification gates", async () => {
    const c = catalog();
    const journal = open();
    const contexts: OrchestrationHostRunContext[] = [];
    let gates = 0;
    const configured = host({
      bindRun: (context) => {
        contexts.push(context);
        expect(Object.isFrozen(context)).toBe(true);
        expect(Object.isFrozen(context.lease)).toBe(true);
        expect(context.journal).toBe(journal);
        return host({
          assessPhase: async () => {
            gates++;
            return passed();
          },
          validatePolicy: async () => {
            gates++;
            return passed();
          },
        });
      },
    });
    const first = await runMultiProjectOrchestrationPass({
      catalog: c,
      journal,
      host: configured,
    });
    expect(first.status).toBe("completed");
    expect(first.evaluatedChecks).toBe(24);
    expect(gates).toBe(15);
    expect(journal.hostEvents(c.id)).toHaveLength(15);
    const next = await runMultiProjectOrchestrationPass({
      catalog: c,
      journal,
      host: configured,
    });
    expect(next.dispatched).toBe(0);
    expect(contexts).toHaveLength(2);
    expect(contexts[1]!.lease.fence).toBeGreaterThan(contexts[0]!.lease.fence);
    expect(() =>
      journal.compareAndSwapHostRecord(
        c.id,
        contexts[0]!.lease,
        `policy:${digest("stale")}`,
        0,
        { evidence: "late old callback" },
        { kind: "late" },
      ),
    ).toThrow();
  });
  it("does not invoke workers when host binding fails", async () => {
    const execute = vi.fn(host().execute);
    await expect(
      runMultiProjectOrchestrationPass({
        catalog: individual(),
        journal: open(),
        host: host({
          execute,
          bindRun: () => {
            throw new Error("binding failed");
          },
        }),
      }),
    ).rejects.toThrow("binding failed");
    expect(execute).not.toHaveBeenCalled();
  });
  it.each(["scope", "checks", "revision"] as const)(
    "rejects a success-shaped policy with missing %s",
    async (failure) => {
      const c = individual();
      const result = await runMultiProjectOrchestrationPass({
        catalog: c,
        journal: open(),
        host: host({
          validatePolicy: async () => ({
            ...passed(),
            ...(failure === "scope"
              ? { evaluatedScope: 0 }
              : failure === "checks"
                ? { checks: [] }
                : { revision: sha2 }),
          }),
        }),
      });
      expect(result.status).toBe("needs-input");
      expect(result.tasks[0]!.status).toBe("needs-input");
      expect(result.tasks[0]!.attempts).toBe(0);
    },
  );
  it("records implemented source and artifact before a blocked critic, without blocking independent lanes", async () => {
    const c = catalog();
    const journal = open();
    let producer = sha;
    const result = await runMultiProjectOrchestrationPass({
      catalog: c,
      journal,
      host: host({
        execute: async (request) => {
          if (request.project.id === "api" && request.stage === "implement")
            producer = sha2;
          return {
            kind: "completed",
            artifact: `artifact:${request.stage}`,
            contracts: {},
            findings: [],
          };
        },
        resolveRevision: async (project) =>
          project.id === "api" ? producer : sha,
        assessPhase: async (request, receipt, revision) => {
          const state = journal
            .states(c.id)
            .find((item) => item.key === taskKey(request.task))!;
          expect(state.status).toBe("running");
          expect(state.artifacts[request.stage]).toBe(receipt.artifact);
          expect(state.revision).toBe(revision);
          return request.project.id === "api" && request.stage === "implement"
            ? {
                ...passed(),
                state: "blocked",
                revision,
                checks: [{ name: "build-critic", state: "failed" }],
                evidence: "Missing contract compatibility",
              }
            : { ...passed(), revision };
        },
      }),
    });
    const producerState = result.tasks.find((item) => item.key === "api:one")!;
    expect(producerState.status).toBe("needs-input");
    expect(producerState.revision).toBe(sha2);
    expect(producerState.artifacts.implement).toBe("artifact:implement");
    expect(result.tasks.find((item) => item.key === "docs:one")!.status).toBe(
      "completed",
    );
    expect(result.tasks.find((item) => item.key === "app:one")!.status).toBe(
      "needs-input",
    );
  });
  it("retains unknown policy reservations across restart without redispatch", async () => {
    const c = individual();
    const journal = open();
    const execute = vi.fn(host().execute);
    const configured = host({
      execute,
      validatePolicy: async () => ({
        ...passed(),
        state: "unknown",
        checks: [],
        evaluatedScope: 0,
        evidence: "Critic dispatch outcome unresolved",
      }),
    });
    const first = await runMultiProjectOrchestrationPass({
      catalog: c,
      journal,
      host: configured,
    });
    expect(first.tasks[0]!.status).toBe("unknown");
    const count = execute.mock.calls.length;
    const again = await runMultiProjectOrchestrationPass({
      catalog: c,
      journal,
      host: configured,
    });
    expect(again.dispatched).toBe(0);
    expect(execute).toHaveBeenCalledTimes(count);
    expect(journal.allReservations()).toHaveLength(1);
  });
  it("rechecks a completed producer's actual source after consumer review", async () => {
    const c = catalog();
    let producer = sha;
    const result = await runMultiProjectOrchestrationPass({
      catalog: c,
      journal: open(),
      host: host({
        resolveRevision: async (project) =>
          project.id === "api" ? producer : sha,
        execute: async (request) => {
          if (request.project.id === "app" && request.stage === "review")
            producer = sha2;
          return {
            kind: "completed",
            artifact: `artifact:${request.stage}`,
            contracts: {},
            findings: [],
          };
        },
      }),
    });
    expect(result.tasks.find((item) => item.key === "app:one")!.status).toBe(
      "needs-input",
    );
    expect(result.tasks.find((item) => item.key === "docs:one")!.status).toBe(
      "completed",
    );
  });
});

describe("multi-project catalog and non-vacuous checks", () => {
  it("rejects duplicate project/task IDs, repository aliases, and cycles", () => {
    const c = catalog();
    expect(() =>
      parseOrchestrationCatalog({
        ...c,
        projects: [...c.projects, c.projects[0]],
      }),
    ).toThrow(/duplicate/);
    expect(() =>
      parseOrchestrationCatalog({ ...c, tasks: [...c.tasks, c.tasks[0]] }),
    ).toThrow(/duplicate/);
    expect(() =>
      parseOrchestrationCatalog({
        ...c,
        projects: c.projects.map((p) => ({
          ...p,
          repositoryRoot: c.projects[0]!.repositoryRoot,
        })),
      }),
    ).toThrow(/alias/);
    c.tasks[0]!.dependsOn = ["app:one"];
    expect(() => parseOrchestrationCatalog(c)).toThrow(/cycle/);
  });
  it("rejects unknown dependencies, missing contracts, individual edges, unsafe scopes, and ambiguous branches", () => {
    const c = catalog();
    c.tasks[1]!.dependsOn = ["missing:one"];
    expect(() => parseOrchestrationCatalog(c)).toThrow(/dependency/);
    c.tasks[1]!.dependsOn = ["api:one"];
    c.tasks[1]!.requiresContracts[0]!.name = "absent";
    expect(() => parseOrchestrationCatalog(c)).toThrow(/contract/);
    c.tasks[1]!.requiresContracts = [];
    c.tasks[2]!.dependsOn = ["api:one"];
    expect(() => parseOrchestrationCatalog(c)).toThrow(/individual/);
    c.tasks[2]!.dependsOn = [];
    c.tasks[0]!.scopes = ["../secret"];
    expect(() => parseOrchestrationCatalog(c)).toThrow(/scopes/);
    c.tasks[0]!.scopes = ["src"];
    c.tasks[0]!.branch = "main";
    expect(() => parseOrchestrationCatalog(c)).toThrow(/branches/);
  });
  it("distinguishes literal directory conflicts from similar file names", () => {
    const c = catalog();
    const a = c.tasks[0]!;
    expect(scopesConflict(a, { ...a, scopes: ["src/api.ts"] })).toBe(true);
    expect(scopesConflict(a, { ...a, scopes: ["SRC/api.ts"] })).toBe(true);
    expect(scopesConflict(a, { ...a, scopes: ["src-other"] })).toBe(false);
    expect(scopesConflict(a, { ...a, projectId: "docs" })).toBe(false);
  });
  it("allows local individual dependencies while rejecting ambiguous PR and base-branch identities", () => {
    const c = catalog();
    const producer = c.tasks[2]!;
    const consumer = {
      ...producer,
      id: "two",
      branch: "work/two",
      baseBranch: producer.branch,
      pullRequest: 2,
      dependsOn: [taskKey(producer)],
    };
    c.tasks = [producer, consumer];
    expect(parseOrchestrationCatalog(c).tasks).toHaveLength(2);
    expect(() =>
      parseOrchestrationCatalog({
        ...c,
        tasks: [producer, { ...consumer, pullRequest: 1 }],
      }),
    ).toThrow(/change requests/);
    expect(() =>
      parseOrchestrationCatalog({
        ...c,
        tasks: [producer, { ...consumer, dependsOn: [] }],
      }),
    ).toThrow(/producer dependency/);
    expect(() =>
      parseOrchestrationCatalog({
        ...c,
        tasks: [{ ...producer, branch: "MAIN" }],
      }),
    ).toThrow(/branches/);
  });
  it.each([
    { ...green(), required: [] },
    { ...green(), policiesKnown: false },
    { ...green(), revision: sha2 },
    { ...green(), checks: [] },
    { ...green(), checks: [...green().checks, ...green().checks] },
    { ...green(), required: ["build", "build"] },
  ])(
    "fails closed for missing, stale, ambiguous or unknown checks %#",
    (evidence) => {
      expect(evaluateOrchestrationChecks(evidence, sha).state).toBe("unknown");
    },
  );
  it("evaluates a nonzero required scope and an intentionally failing fixture", () => {
    expect(evaluateOrchestrationChecks(green(), sha)).toEqual({
      state: "passed",
      evaluated: 1,
    });
    const failed = {
      ...green(),
      checks: [
        { name: "build", state: "failed" as const, signature: "compile" },
      ],
    };
    expect(evaluateOrchestrationChecks(failed, sha)).toMatchObject({
      state: "failed",
      evaluated: 1,
    });
  });
  it("rejects worker permission fields and empty artifacts", () => {
    expect(() =>
      parseWorkerReceipt({
        kind: "completed",
        artifact: "artifact",
        contracts: {},
        findings: [],
        authorize: true,
      }),
    ).toThrow();
    expect(() =>
      parseWorkerReceipt({
        kind: "completed",
        artifact: "",
        contracts: {},
        findings: [],
      }),
    ).toThrow();
  });
});

describe("durable journal", () => {
  it("excludes other hosts, fences stale owners, and deduplicates exact checkpoints", () => {
    let time = 1000;
    const filename = path.join(temp(), "journal.sqlite");
    const j = open(filename, () => time);
    const second = open(filename, () => time);
    const c = catalog();
    const lease = j.claim(100);
    j.initialize(c, lease);
    expect(() => second.claim(100)).toThrow(/active/);
    const state = j.states(c.id)[0]!;
    const next: OrchestrationTaskState = {
      ...state,
      status: "running",
      invocation: "invocation",
    };
    j.checkpoint(c.id, lease, state, next, "reserve", "reserved");
    j.checkpoint(c.id, lease, state, next, "reserve", "reserved");
    expect(j.events(c.id).filter((e) => e.kind === "reserved")).toHaveLength(1);
    expect(() =>
      j.checkpoint(
        c.id,
        lease,
        state,
        { ...next, reason: "different" },
        "reserve",
        "reserved",
      ),
    ).toThrow(/idempotency/);
    time += 101;
    const newer = second.claim(100);
    expect(newer.fence).toBeGreaterThan(lease.fence);
    expect(() =>
      j.checkpoint(c.id, lease, next, state, "stale", "stale"),
    ).toThrow(/lease/);
    second.recover(c.id, newer);
    expect(second.states(c.id).find((s) => s.key === state.key)?.status).toBe(
      "unknown",
    );
    second.recover(c.id, newer);
    expect(
      second.events(c.id).filter((e) => e.kind === "unknown"),
    ).toHaveLength(1);
    second.release(newer);
  });
  it("requires explicit evidence for host reconciliation and binds catalog content", () => {
    const j = open();
    const c = catalog();
    const lease = j.claim(1000);
    j.initialize(c, lease);
    expect(() => j.initialize({ ...c, maxConcurrency: 3 }, lease)).toThrow(
      /catalog changed/,
    );
    const state = j.states(c.id)[0]!;
    j.checkpoint(
      c.id,
      lease,
      state,
      { ...state, status: "unknown" },
      "unknown",
      "unknown",
    );
    expect(() =>
      j.reconcile(c.id, lease, state.key, "not-executed", ""),
    ).toThrow(/evidence/);
    j.reconcile(
      c.id,
      lease,
      state.key,
      "not-executed",
      "host process audit confirms no invocation",
    );
    expect(j.states(c.id).find((s) => s.key === state.key)?.status).toBe(
      "pending",
    );
  });
  it("rejects task projection corruption and incomplete task sets", () => {
    const filename = path.join(temp(), "journal.sqlite");
    const j = open(filename);
    const c = catalog();
    const lease = j.claim(1000);
    j.initialize(c, lease);
    const state = j.states(c.id)[0]!;
    const external = new DatabaseSync(filename);
    try {
      external
        .prepare("UPDATE tasks SET state=? WHERE run=? AND key=?")
        .run(
          JSON.stringify({ ...state, status: "completed" }),
          c.id,
          state.key,
        );
      expect(() => j.states(c.id)).toThrow(/append-only/);
      external
        .prepare("DELETE FROM tasks WHERE run=? AND key=?")
        .run(c.id, state.key);
      expect(() => j.initialize(c, lease)).toThrow(/incomplete/);
      expect(() =>
        external.prepare("DELETE FROM events WHERE run=?").run(c.id),
      ).toThrow(/append-only/);
    } finally {
      external.close();
    }
  });
  it("refuses an unsupported journal schema without creating product tables", () => {
    const filename = path.join(temp(), "unsupported.sqlite");
    const external = new DatabaseSync(filename);
    try {
      external.exec(
        "CREATE TABLE metadata(version INTEGER); INSERT INTO metadata VALUES(99)",
      );
      expect(() => new MultiProjectJournal(filename)).toThrow(/unsupported/);
      expect(
        external
          .prepare("SELECT name FROM sqlite_master WHERE name='tasks'")
          .get(),
      ).toBeUndefined();
    } finally {
      external.close();
    }
  });
});

describe("bounded host lifecycle", () => {
  it("orders integrated contract consumers and runs independent projects concurrently", async () => {
    const c = catalog();
    const j = open();
    let active = 0;
    let maximum = 0;
    const dispatched: string[] = [];
    const result = await runMultiProjectOrchestrationPass({
      catalog: c,
      journal: j,
      host: host({
        execute: async (request) => {
          active++;
          maximum = Math.max(maximum, active);
          dispatched.push(`${taskKey(request.task)}:${request.stage}`);
          if (request.task.projectId === "app")
            expect(
              j.states(c.id).find((s) => s.key === "api:one")?.status,
            ).toBe("completed");
          await new Promise((resolve) => setTimeout(resolve, 2));
          active--;
          return {
            kind: "completed",
            artifact: "substantive",
            contracts: {},
            findings: [],
          };
        },
      }),
    });
    expect(result.status).toBe("completed");
    expect(maximum).toBe(2);
    expect(result.evaluatedChecks).toBeGreaterThan(0);
    expect(dispatched.indexOf("docs:one:specify")).toBeLessThan(
      dispatched.indexOf("app:one:specify"),
    );
    const before = j.events(c.id).length;
    const again = await runMultiProjectOrchestrationPass({
      catalog: c,
      journal: j,
      host: host(),
    });
    expect(again.dispatched).toBe(0);
    expect(j.events(c.id)).toHaveLength(before);
  });
  it("excludes overlapping task scopes and allows disjoint scopes", async () => {
    const c = catalog();
    c.tasks = [
      c.tasks[2]!,
      {
        ...c.tasks[2]!,
        id: "two",
        branch: "work/two",
        pullRequest: 2,
        scopes: ["src/file.ts"],
      },
      {
        ...c.tasks[2]!,
        id: "three",
        branch: "work/three",
        pullRequest: 3,
        scopes: ["docs"],
      },
    ];
    const active: string[][] = [];
    let disjoint = false;
    const result = await runMultiProjectOrchestrationPass({
      catalog: c,
      journal: open(),
      host: host({
        execute: async (request) => {
          for (const scopes of active)
            expect(
              scopes.some((s) =>
                request.task.scopes.some(
                  (t) =>
                    s === t || s.startsWith(`${t}/`) || t.startsWith(`${s}/`),
                ),
              ),
            ).toBe(false);
          active.push(request.task.scopes);
          if (active.length === 2) disjoint = true;
          await new Promise((resolve) => setTimeout(resolve, 2));
          active.splice(active.indexOf(request.task.scopes), 1);
          return {
            kind: "completed",
            artifact: "artifact",
            contracts: {},
            findings: [],
          };
        },
      }),
    });
    expect(result.status).toBe("completed");
    expect(disjoint).toBe(true);
  });
  it("blocks a dependency but preserves an independent lane on failure", async () => {
    const result = await runMultiProjectOrchestrationPass({
      catalog: catalog(),
      journal: open(),
      host: host({
        execute: async (request) =>
          request.task.projectId === "api"
            ? {
                kind: "failed",
                signature: "compile",
                evidence: "compiler diagnostic",
              }
            : {
                kind: "completed",
                artifact: "artifact",
                contracts: {},
                findings: [],
              },
      }),
    });
    expect(result.tasks.find((s) => s.key === "docs:one")?.status).toBe(
      "completed",
    );
    expect(result.tasks.find((s) => s.key === "app:one")?.reason).toContain(
      "prerequisite",
    );
  });
  it("never dispatches under denied host authority", async () => {
    const execute = vi.fn(host().execute);
    const result = await runMultiProjectOrchestrationPass({
      catalog: catalog(),
      journal: open(),
      host: host({ authorize: async () => false, execute }),
    });
    expect(result.dispatched).toBe(0);
    expect(execute).not.toHaveBeenCalled();
    expect(result.status).toBe("needs-input");
  });
  it("prevents in-process worker proposals from broadening the immutable authorized scopes", async () => {
    const c = catalog();
    c.tasks = [c.tasks[2]!];
    const j = open();
    const result = await runMultiProjectOrchestrationPass({
      catalog: c,
      journal: j,
      host: host({
        execute: async (request) => {
          request.task.scopes.push(".");
          return {
            kind: "completed",
            artifact: "artifact",
            contracts: {},
            findings: [],
          };
        },
      }),
    });
    expect(result.tasks[0]?.status).toBe("unknown");
    expect(j.allReservations()[0]?.scopes).toEqual(["src"]);
  });
  it("passes no hub credentials or transport configuration to the worker", async () => {
    const c = catalog();
    const result = await runMultiProjectOrchestrationPass({
      catalog: c,
      journal: open(),
      host: host({
        execute: async (request) => {
          expect(request.project).not.toHaveProperty("hub");
          expect(buildMultiProjectWorkerPrompt(request)).not.toContain(
            "demo/api",
          );
          expect(request.intent).toBe(
            digest({
              stage: request.stage,
              project: request.project,
              task: request.task,
              artifacts: request.artifacts,
              contracts: request.contracts,
              revision: request.revision,
              baseRevision: request.baseRevision,
              failures: request.failures,
            }),
          );
          return {
            kind: "completed",
            artifact: "artifact",
            contracts: {},
            findings: [],
          };
        },
      }),
    });
    expect(result.status).toBe("completed");
  });
  it("retains timed-out reservations, never redispatches them on recovery", async () => {
    const c = catalog();
    c.invocationTimeoutMs = 100;
    const j = open();
    const execute = vi.fn(async () => new Promise<never>(() => {}));
    const result = await runMultiProjectOrchestrationPass({
      catalog: c,
      journal: j,
      host: host({ execute }),
    });
    expect(result.tasks.some((s) => s.status === "unknown")).toBe(true);
    const count = execute.mock.calls.length;
    await runMultiProjectOrchestrationPass({
      catalog: c,
      journal: j,
      host: host({ execute }),
    });
    expect(execute).toHaveBeenCalledTimes(count);
    expect(j.allReservations().length).toBeGreaterThan(0);
  });
  it("keeps outstanding reservations across run IDs and releases only with audited reconciliation", async () => {
    const c = catalog();
    c.tasks = [c.tasks[2]!];
    c.maxConcurrency = 1;
    const j = open();
    const lease = j.claim(1000);
    j.initialize(c, lease);
    const state = j.states(c.id)[0]!;
    j.checkpoint(
      c.id,
      lease,
      state,
      { ...state, status: "unknown", invocation: "prior" },
      "prior",
      "unknown",
    );
    j.release(lease);
    const next = { ...c, id: "next" };
    const execute = vi.fn(host().execute);
    const result = await runMultiProjectOrchestrationPass({
      catalog: next,
      journal: j,
      host: host({ execute }),
    });
    expect(result.status).toBe("pending");
    expect(result.dispatched).toBe(0);
    expect(execute).not.toHaveBeenCalled();
    const owner = j.claim(1000);
    j.reconcile(
      c.id,
      owner,
      state.key,
      "abandon",
      "host audit confirms process exited and branch work was abandoned",
    );
    j.release(owner);
    const resumed = await runMultiProjectOrchestrationPass({
      catalog: next,
      journal: j,
      host: host({ execute }),
    });
    expect(resumed.status).toBe("completed");
  });
  it("persists canonical roots so aliases cannot evade outstanding cross-run scope exclusion", async () => {
    const c = catalog();
    c.tasks = [c.tasks[2]!];
    const p = c.projects[2]!;
    const canonical = realpathSync(p.repositoryRoot);
    const alias = path.join(path.dirname(p.repositoryRoot), "alias-docs");
    symlinkSync(p.repositoryRoot, alias, "junction");
    p.repositoryRoot = alias;
    const j = open();
    await runMultiProjectOrchestrationPass({
      catalog: c,
      journal: j,
      host: host({
        execute: async () => ({
          kind: "unknown",
          reason: "external process outcome unknown",
        }),
      }),
    });
    expect(j.allReservations()[0]?.projectRoot).toBe(canonical);
    p.repositoryRoot = canonical;
    const execute = vi.fn(host().execute);
    const result = await runMultiProjectOrchestrationPass({
      catalog: { ...c, id: "next" },
      journal: j,
      host: host({ execute }),
    });
    expect(result.dispatched).toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });
  it("checks its lease again after asynchronous preflight and cannot dispatch when fenced", async () => {
    const c = catalog();
    c.tasks = [c.tasks[2]!];
    let time = 1000;
    const j = open(":memory:", () => time);
    const execute = vi.fn(host().execute);
    await expect(
      runMultiProjectOrchestrationPass({
        catalog: c,
        journal: j,
        host: host({
          execute,
          observe: async () => {
            time += 31_000;
            return green();
          },
        }),
      }),
    ).rejects.toThrow(/lease lost/);
    expect(execute.mock.calls.map(([request]) => request.stage)).toEqual([
      "specify",
      "plan",
      "decompose",
    ]);
    const result = await runMultiProjectOrchestrationPass({
      catalog: c,
      journal: j,
      host: host({ execute }),
    });
    expect(result.tasks[0]?.status).toBe("unknown");
    expect(execute).toHaveBeenCalledTimes(3);
  });
  it("persists artifact amendments and binds the next host authorization to them", async () => {
    const c = catalog();
    c.tasks = [c.tasks[2]!];
    const j = open();
    const authorizations: string[] = [];
    const result = await runMultiProjectOrchestrationPass({
      catalog: c,
      journal: j,
      host: host({
        authorize: async (request) => {
          if (request.stage === "implement") {
            expect(request.artifacts.specify).toBe("amended spec");
            authorizations.push(request.intent);
          }
          return true;
        },
        execute: async (request) => ({
          kind: "completed",
          artifact: `artifact:${request.stage}`,
          contracts: {},
          findings: [],
          ...(request.stage === "plan"
            ? { amendments: { specify: "amended spec" } }
            : {}),
        }),
      }),
    });
    expect(result.status).toBe("completed");
    expect(authorizations).toHaveLength(1);
    expect(
      j
        .events(c.id)
        .some((event) => event.state.artifacts.specify === "artifact:specify"),
    ).toBe(true);
    expect(
      j.events(c.id).some((event) => event.state.intent === authorizations[0]),
    ).toBe(true);
  });
  it("does not let a reviewer amend previously verified artifacts", async () => {
    const c = catalog();
    c.tasks = [c.tasks[2]!];
    const result = await runMultiProjectOrchestrationPass({
      catalog: c,
      journal: open(),
      host: host({
        execute: async (request) => ({
          kind: "completed",
          artifact: "artifact",
          contracts: {},
          findings: [],
          ...(request.stage === "review"
            ? { amendments: { specify: "unverified replacement" } }
            : {}),
        }),
      }),
    });
    expect(result.tasks[0]?.reason).toContain("amendments require");
  });
  it("bounds repeated review findings even when line numbers change", async () => {
    const c = catalog();
    c.tasks = [c.tasks[2]!];
    let reviews = 0;
    const result = await runMultiProjectOrchestrationPass({
      catalog: c,
      journal: open(),
      host: host({
        execute: async (request) => ({
          kind: "completed",
          artifact: "artifact",
          contracts: {},
          findings:
            request.stage === "review"
              ? [`Missing guard in src/api.ts line ${++reviews}`]
              : [],
        }),
      }),
    });
    expect(reviews).toBe(2);
    expect(result.tasks[0]?.attempts).toBe(1);
    expect(result.tasks[0]?.reason).toContain("repeated");
  });
  it("repairs actionable CI failure detected during final review instead of accepting stale green", async () => {
    const c = catalog();
    c.tasks = [c.tasks[2]!];
    let reviewing = false;
    let fixes = 0;
    const result = await runMultiProjectOrchestrationPass({
      catalog: c,
      journal: open(),
      host: host({
        execute: async (request) => {
          if (request.stage === "review") reviewing = true;
          if (request.stage === "fix") {
            fixes++;
            reviewing = false;
          }
          return {
            kind: "completed",
            artifact: "artifact",
            contracts: {},
            findings: [],
          };
        },
        observe: async () =>
          reviewing && !fixes
            ? {
                ...green(),
                checks: [
                  {
                    name: "build",
                    state: "failed",
                    signature: "late-compiler",
                    evidence: "TS2322 src/api.ts",
                  },
                ],
              }
            : green(),
      }),
    });
    expect(result.status).toBe("completed");
    expect(fixes).toBe(1);
  });
  it("does not dispatch a repair when the CI failure has no diagnostic evidence", async () => {
    const c = catalog();
    c.tasks = [c.tasks[2]!];
    const execute = vi.fn(host().execute);
    const result = await runMultiProjectOrchestrationPass({
      catalog: c,
      journal: open(),
      host: host({
        execute,
        observe: async () => ({
          ...green(),
          checks: [{ name: "build", state: "failed" }],
        }),
      }),
    });
    expect(result.tasks[0]?.reason).toContain("actionable evidence");
    expect(
      execute.mock.calls.some(([request]) => request.stage === "fix"),
    ).toBe(false);
  });
  it("stops repeated normalized CI failures after one repair", async () => {
    const c = catalog();
    c.tasks = [c.tasks[2]!];
    let fixes = 0;
    const result = await runMultiProjectOrchestrationPass({
      catalog: c,
      journal: open(),
      host: host({
        execute: async (request) => {
          if (request.stage === "fix") fixes++;
          return {
            kind: "completed",
            artifact: "artifact",
            contracts: {},
            findings: [],
          };
        },
        observe: async () => ({
          ...green(),
          checks: [
            {
              name: "build",
              state: "failed",
              signature: "compile:type-error",
              evidence: "TS2322 in src/api.ts",
            },
          ],
        }),
      }),
    });
    expect(fixes).toBe(1);
    expect(result.tasks[0]?.reason).toContain("repeated failure");
  });
  it("exhausts three distinct repair attempts without silent success", async () => {
    const c = catalog();
    c.tasks = [c.tasks[2]!];
    let attempt = 0;
    const result = await runMultiProjectOrchestrationPass({
      catalog: c,
      journal: open(),
      host: host({
        execute: async (request) => {
          if (request.stage === "fix") attempt++;
          return {
            kind: "completed",
            artifact: "artifact",
            contracts: {},
            findings: [],
          };
        },
        observe: async () => ({
          ...green(),
          checks: [
            {
              name: "build",
              state: "failed",
              signature: `error-${attempt}`,
              evidence: `compiler error ${attempt}`,
            },
          ],
        }),
      }),
    });
    expect(attempt).toBe(3);
    expect(result.tasks[0]?.reason).toContain("exhausted");
  });
  it.each([
    "zero-scope",
    "regression",
    "missing-check",
    "stale-validation",
    "missing-contract",
  ])("stops invalid host evidence: %s", async (failure) => {
    const c = catalog();
    c.tasks = [c.tasks[0]!];
    const validate = host().validate;
    const result = await runMultiProjectOrchestrationPass({
      catalog: c,
      journal: open(),
      host: host({
        validate: async (request, signal) => {
          const evidence = await validate(request, signal);
          if (failure === "zero-scope") evidence.evaluatedScope = 0;
          if (failure === "regression") evidence.regressions = 1;
          if (failure === "missing-check") evidence.checks = [];
          if (failure === "stale-validation") evidence.revision = sha2;
          if (failure === "missing-contract") evidence.contracts = {};
          return evidence;
        },
      }),
    });
    expect(result.status).toBe("needs-input");
  });
  it("stops consumer validation that does not bind prerequisite hashes", async () => {
    const validate = host().validate;
    const result = await runMultiProjectOrchestrationPass({
      catalog: catalog(),
      journal: open(),
      host: host({
        validate: async (request, signal) => ({
          ...(await validate(request, signal)),
          contracts: { api: digest("API") },
        }),
      }),
    });
    expect(result.tasks.find((s) => s.key === "app:one")?.reason).toContain(
      "prerequisite contract",
    );
  });
  it("stops human labels before implementation and never trusts a worker authority field", async () => {
    const c = catalog();
    c.tasks = [c.tasks[2]!];
    const execute = vi.fn(host().execute);
    const result = await runMultiProjectOrchestrationPass({
      catalog: c,
      journal: open(),
      host: host({
        execute,
        observe: async () => ({ ...green(), labels: ["do-not-autofix"] }),
      }),
    });
    expect(result.tasks[0]?.status).toBe("needs-input");
    expect(
      execute.mock.calls.some(([request]) => request.stage === "implement"),
    ).toBe(false);
  });
  it("returns pending without spinning and stops after the pending timeout", async () => {
    const c = catalog();
    c.tasks = [c.tasks[2]!];
    c.invocationTimeoutMs = 100;
    const j = open();
    let now = 1000;
    const h = host({
      observe: async () => ({
        ...green(),
        checks: [{ name: "build", state: "pending" }],
      }),
    });
    const result = await runMultiProjectOrchestrationPass({
      catalog: c,
      journal: j,
      host: h,
      now: () => now,
    });
    expect(result.status).toBe("pending");
    now += 101;
    const again = await runMultiProjectOrchestrationPass({
      catalog: c,
      journal: j,
      host: h,
      now: () => now,
    });
    expect(again.status).toBe("needs-input");
    expect(again.tasks[0]?.reason).toContain("pending timeout");
  });
  it("does not accept a source changed by review", async () => {
    const c = catalog();
    c.tasks = [c.tasks[2]!];
    let current = sha;
    const result = await runMultiProjectOrchestrationPass({
      catalog: c,
      journal: open(),
      host: host({
        resolveRevision: async () => current,
        execute: async (request) => {
          if (request.stage === "review") current = sha2;
          return {
            kind: "completed",
            artifact: "artifact",
            contracts: {},
            findings: [],
          };
        },
      }),
    });
    expect(result.tasks[0]?.status).toBe("unknown");
  });
  it("runs the persistent fake GitHub/ADO demo and resumes with no dispatch", async () => {
    const folder = temp();
    const result = await runMultiProjectDemo(folder);
    expect(result.status).toBe("completed");
    expect(result.tasks).toHaveLength(3);
    const again = await runMultiProjectDemo(folder);
    expect(again.dispatched).toBe(0);
    expect(again.eventCount).toBe(result.eventCount);
  });
});
