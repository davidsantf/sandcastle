import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MultiProjectJournal } from "./MultiProjectJournal.js";
import {
  runMultiProjectOrchestrationPass,
  type MultiProjectHost,
} from "./MultiProjectOrchestrator.js";
import {
  parseOrchestrationCatalog,
  taskKey,
  digest,
  type OrchestrationTask,
} from "./MultiProjectProtocol.js";
import { coworkDigest } from "./CoworkFactoryContract.js";
import {
  createCoworkJournalStore,
  createCoworkOrchestrationFactory,
  type CoworkOrchestrationFactoryOptions,
} from "./MultiProjectCoworkFactory.js";

const before = "1".repeat(64),
  after = "2".repeat(64),
  initial = "a".repeat(40);
const folders: string[] = [],
  journals: MultiProjectJournal[] = [];
afterEach(() => {
  for (const journal of journals.splice(0)) journal.close();
  for (const folder of folders.splice(0))
    fs.rmSync(folder, { recursive: true, force: true });
});
const fixture = () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "cowork-composed-"));
  folders.push(folder);
  for (const project of ["api", "app", "web", "docs"])
    fs.mkdirSync(path.join(folder, project));
  const journal = new MultiProjectJournal(path.join(folder, "journal.sqlite"));
  journals.push(journal);
  const task = (projectId: string): OrchestrationTask => ({
    id: "one",
    projectId,
    title: projectId,
    brief: "Preserve protected behavior",
    branch: `${projectId}-work`,
    baseBranch: "main",
    scopes: ["src"],
    dependsOn: [],
    requiresContracts: [],
    providesContracts: projectId === "api" ? ["api"] : [],
    acceptance: [{ label: "test", command: "fixture:test" }],
    labels: [],
  });
  const catalog = parseOrchestrationCatalog({
    id: "composed",
    projects: [
      {
        id: "api",
        mode: "integrated",
        repositoryRoot: path.join(folder, "api"),
        hub: { kind: "github", repository: "example/api", pullRequest: 7 },
      },
      {
        id: "app",
        mode: "integrated",
        repositoryRoot: path.join(folder, "app"),
        hub: {
          kind: "ado",
          organization: "example",
          project: "App",
          repository: "app",
          pullRequest: 9,
        },
      },
      {
        id: "web",
        mode: "integrated",
        repositoryRoot: path.join(folder, "web"),
        hub: { kind: "github", repository: "example/web", pullRequest: 10 },
      },
      {
        id: "docs",
        mode: "individual",
        repositoryRoot: path.join(folder, "docs"),
        hub: { kind: "github", repository: "example/docs", pullRequest: 8 },
      },
    ],
    tasks: [task("api"), task("docs")],
    maxConcurrency: 2,
    maxRounds: 30,
    maxRepairAttempts: 3,
    invocationTimeoutMs: 30000,
  });
  const sources = new Map<string, string>();
  const requests: {
    task: OrchestrationTask;
    stage: string;
    contracts: Record<string, string>;
  }[] = [];
  const observations: { task: string; pullRequest: number | undefined }[] = [];
  const source = (task: OrchestrationTask) =>
    sources.get(taskKey(task)) ?? initial;
  const base: MultiProjectHost = {
    authorize: async () => true,
    execute: async (request) => {
      requests.push({
        task: request.task,
        stage: request.stage,
        contracts: request.contracts,
      });
      if (request.stage === "implement")
        sources.set(
          taskKey(request.task),
          (request.project.id === "api"
            ? "b"
            : request.project.id === "docs"
              ? "d"
              : "c"
          ).repeat(40),
        );
      return {
        kind: "completed",
        artifact: `${request.stage}:${taskKey(request.task)}`,
        contracts: {},
        findings: [],
      };
    },
    resolveRevision: async (_project, task) => source(task),
    validate: async (request) => ({
      revision: source(request.task),
      evaluatedScope: 2,
      regressions: 0,
      checks: [{ name: "test", state: "passed" }],
      contracts: {
        ...request.contracts,
        ...(request.project.id === "api" ? { api: after } : {}),
      },
    }),
    observe: async (_project, task) => {
      if (task.sourceItem && !task.pullRequest)
        throw new Error("Never borrow the project's existing PR");
      observations.push({ task: taskKey(task), pullRequest: task.pullRequest });
      return {
        revision: source(task),
        policiesKnown: true,
        required: ["ci"],
        checks: [{ name: "ci", state: "passed" }],
        labels: [],
      };
    },
  };
  const writes: string[] = [];
  const create = vi.fn<
    CoworkOrchestrationFactoryOptions["changeRequests"]["create"]
  >(async (request, intent) => ({
    state: "completed",
    receipt: {
      pullRequest: 17,
      revision: request.revision!,
      intent,
      url: `https://example.invalid/${request.project.id}/pull/17`,
    },
  }));
  const options: CoworkOrchestrationFactoryOptions = {
    base,
    routes: [
      {
        mapping: {
          producer: "api",
          consumer: "app",
          contract: "api",
          consumedDigest: before,
          target: {
            provider: "azure-devops",
            organization: "example",
            project: "App",
            workItemType: "Task",
          },
          rule: { id: "api-match", version: "1" },
          mappingDigest: coworkDigest("route"),
        },
        scopes: ["src/client"],
        baseBranch: "main",
        acceptance: [{ label: "test", command: "fixture:compatibility" }],
      },
    ],
    impactHost: {
      verifyChange: async () => true,
      verifyMapping: async () => true,
    },
    inspectChange: async (_project, task, state) => ({
      project: "api",
      task: taskKey(task),
      change: "https://example.invalid/api/pull/7",
      revision: state.revision!,
      baseRevision: state.baseRevision!,
      observedAt: new Date().toISOString(),
      artifact: coworkDigest(state.artifacts),
      contracts: [{ name: "api", before, after }],
      lineage: ["api"],
      depth: 0,
      budget: 4,
    }),
    itemHost: {
      authorize: async () => true,
      verifyEvidence: async () => true,
      audit: async () => true,
      create: async (item, intent) => {
        writes.push(item.provider);
        const target =
          item.provider === "github"
            ? { provider: item.provider, repository: item.repository }
            : {
                provider: item.provider,
                organization: item.organization,
                project: item.project,
                workItemType: item.workItemType,
              };
        return {
          state: "completed",
          receipt: {
            id: `item-${writes.length}`,
            url: `https://example.invalid/items/${writes.length}`,
            intent,
            targetDigest: coworkDigest(target),
          },
        };
      },
      verifyReceipt: async (proposal, receipt) =>
        receipt.intent === proposal.intent &&
        receipt.targetDigest === coworkDigest(proposal.candidate.target),
    },
    authorizeRegistration: async () => true,
    observeSourceItem: async () => ({
      labels: [],
      evidence: "Fixture issue labels independently read",
    }),
    changeRequests: {
      authorize: async () => true,
      create,
      attest: async () => true,
    },
    validateTask: async (_request, evidence) => ({
      state: "passed",
      revision: evidence.revision,
      evaluatedScope: 2,
      checks: [{ name: "measured-fixture", state: "passed" }],
      evidence: "Injected policy fixture, not live measurements",
    }),
  };
  return {
    journal,
    catalog,
    options,
    requests,
    writes,
    create,
    observations,
    folder,
    sources,
  };
};

describe("composed durable compatibility orchestration", () => {
  it("propagates an ADO producer change into a GitHub consumer item and agent", async () => {
    const f = fixture();
    f.catalog = parseOrchestrationCatalog({
      ...f.catalog,
      projects: f.catalog.projects.map((project) =>
        project.id === "api"
          ? {
              ...project,
              hub: {
                kind: "ado",
                organization: "example",
                project: "API",
                repository: "api",
                pullRequest: 7,
              },
            }
          : project,
      ),
    });
    const route = f.options.routes[0]!;
    const host = createCoworkOrchestrationFactory({
      ...f.options,
      routes: [
        {
          ...route,
          mapping: {
            ...route.mapping,
            consumer: "web",
            target: { provider: "github", repository: "example/web" },
            mappingDigest: coworkDigest("ado-to-github-route"),
          },
        },
      ],
    });
    const result = await runMultiProjectOrchestrationPass({
      catalog: f.catalog,
      journal: f.journal,
      host,
    });
    expect(result.status).toBe("completed");
    expect(f.writes).toEqual(["github"]);
    const generated = f.journal
      .catalog(f.catalog.id)
      .tasks.find((task) => task.sourceItem)!;
    expect(generated.projectId).toBe("web");
    expect(generated.sourceItem!.provider).toBe("github");
    expect(
      f.requests.some(
        (request) =>
          request.task.id === generated.id && request.stage === "implement",
      ),
    ).toBe(true);
  });
  it("persists unknown root intake evidence while independent tasks finish", async () => {
    const f = fixture();
    const host = createCoworkOrchestrationFactory({
      ...f.options,
      routes: [],
      base: {
        ...f.options.base,
        beforeTasks: async () => {
          throw new Error("Signal source unavailable");
        },
      },
    });
    const result = await runMultiProjectOrchestrationPass({
      catalog: f.catalog,
      journal: f.journal,
      host,
    });
    expect(result.status).toBe("needs-input");
    expect(result.tasks.every((task) => task.status === "completed")).toBe(
      true,
    );
    expect(
      f.journal.readHostRecord(`run-preparation:${digest(f.catalog.id)}`).value,
    ).toMatchObject({ outcome: { state: "unknown" } });
    expect(
      f.journal
        .hostEvents(f.catalog.id)
        .some(
          (event) => event.key === `run-preparation:${digest(f.catalog.id)}`,
        ),
    ).toBe(true);
  });
  it("schedules an explicitly superseding upstream revision as a separate immutable downstream follow-up", async () => {
    const f = fixture();
    const first = await runMultiProjectOrchestrationPass({
      catalog: f.catalog,
      journal: f.journal,
      host: createCoworkOrchestrationFactory(f.options),
    });
    expect(first.status).toBe("completed");
    const original = f.journal
      .catalog(f.catalog.id)
      .tasks.find((task) => task.sourceItem)!;
    const oldIntent = JSON.stringify(original);
    const supersedes = original.branch.slice("compat/".length);
    expect(supersedes).toHaveLength(64);
    const lease = f.journal.claim(30000);
    const key = `fixture-generation:${coworkDigest("second-upstream-task")}`;
    const value = { authorization: "Fixture-approved new API task" };
    expect(
      f.journal.compareAndSwapHostRecord(f.catalog.id, lease, key, 0, value, {
        kind: "fixture-approved",
      }),
    ).toBe(true);
    const producer = f.catalog.tasks.find((task) => task.projectId === "api")!;
    f.journal.appendCatalogTasks(
      f.catalog.id,
      lease,
      [{ ...producer, id: "two", branch: "api-second", pullRequest: 27 }],
      { recordKey: key, recordVersion: 1, recordDigest: digest(value) },
    );
    f.journal.release(lease);
    const nextDigest = "3".repeat(64);
    const base = f.options.base;
    const options: CoworkOrchestrationFactoryOptions = {
      ...f.options,
      base: {
        ...base,
        execute: async (request, signal) => {
          const receipt = await base.execute(request, signal);
          if (request.task.id === "two" && request.stage === "implement")
            f.sources.set(taskKey(request.task), "e".repeat(40));
          return receipt;
        },
        validate: async (request, signal) => {
          const receipt = await base.validate(request, signal);
          return request.task.id === "two"
            ? {
                ...receipt,
                contracts: { ...receipt.contracts, api: nextDigest },
              }
            : receipt;
        },
      },
      routes: [
        {
          ...f.options.routes[0]!,
          mapping: {
            ...f.options.routes[0]!.mapping,
            consumedDigest: after,
            mappingDigest: coworkDigest("updated-consumer-mapping"),
            supersedes,
          },
        },
      ],
      inspectChange: async (project, task, state, signal) => {
        const inspected = await f.options.inspectChange(
          project,
          task,
          state,
          signal,
        );
        if ("state" in inspected || task.id !== "two") return inspected;
        return {
          ...inspected,
          change: "https://example.invalid/api/pull/27",
          contracts: [{ name: "api", before: after, after: nextDigest }],
        };
      },
      changeRequests: {
        ...f.options.changeRequests,
        create: async (request, intent) => ({
          state: "completed",
          receipt: {
            intent,
            revision: request.revision!,
            pullRequest: 28,
            url: "https://example.invalid/app/pull/28",
          },
        }),
      },
    };
    const second = await runMultiProjectOrchestrationPass({
      catalog: f.catalog,
      journal: f.journal,
      host: createCoworkOrchestrationFactory(options),
    });
    expect(second.status, JSON.stringify(second)).toBe("completed");
    expect(second.tasks).toHaveLength(5);
    const consumers = f.journal
      .catalog(f.catalog.id)
      .tasks.filter((task) => task.sourceItem);
    expect(consumers).toHaveLength(2);
    expect(
      JSON.stringify(consumers.find((task) => task.id === original.id)),
    ).toBe(oldIntent);
    expect(consumers.find((task) => task.id !== original.id)!.brief).toContain(
      nextDigest,
    );
    expect(
      second.tasks.find((task) => task.key === taskKey(original))!.pullRequest,
    ).toBe(17);
    expect(
      second.tasks.find(
        (task) =>
          task.key ===
          taskKey(consumers.find((task) => task.id !== original.id)!),
      )!.pullRequest,
    ).toBe(28);
    expect(f.writes).toHaveLength(2);
  });
  it("rolls back an interrupted same-DB record transaction and recovers without redispatch", async () => {
    const f = fixture();
    const host = createCoworkOrchestrationFactory(f.options);
    const first = await runMultiProjectOrchestrationPass({
      catalog: f.catalog,
      journal: f.journal,
      host,
    });
    expect(first.status).toBe("completed");
    const events = f.journal.hostEvents(f.catalog.id).length;
    journals.splice(journals.indexOf(f.journal), 1);
    f.journal.close();
    const key = `crash-fixture:${"f".repeat(64)}`;
    const crashed = spawnSync(
      process.execPath,
      [
        "-e",
        `
      const { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync(process.argv[1]);
      db.exec("BEGIN IMMEDIATE");
      db.prepare("INSERT INTO host_records(key,version,value,digest) VALUES(?,1,?,?)")
        .run(process.argv[2], "{}", "f".repeat(64));
      process.exit(23);
    `,
        path.join(f.folder, "journal.sqlite"),
        key,
      ],
      { encoding: "utf8", timeout: 30000 },
    );
    expect(crashed.status, crashed.stderr).toBe(23);
    const reopened = new MultiProjectJournal(
      path.join(f.folder, "journal.sqlite"),
    );
    journals.push(reopened);
    expect(reopened.readHostRecord(key)).toEqual({ version: 0, value: null });
    expect(reopened.hostEvents(f.catalog.id)).toHaveLength(events);
    const recovered = await runMultiProjectOrchestrationPass({
      catalog: f.catalog,
      journal: reopened,
      host,
    });
    expect(recovered.status).toBe("completed");
    expect(recovered.dispatched).toBe(0);
    expect(f.writes).toHaveLength(1);
    expect(f.create).toHaveBeenCalledTimes(1);
  });
  it("creates an ADO B item, appends once, dispatches its narrow worker and separately registers its immutable PR", async () => {
    const f = fixture();
    const configured = createCoworkOrchestrationFactory(f.options);
    const first = await runMultiProjectOrchestrationPass({
      catalog: f.catalog,
      journal: f.journal,
      host: configured,
    });
    expect(first.status).toBe("completed");
    expect(first.tasks).toHaveLength(3);
    expect(f.writes).toEqual(["azure-devops"]);
    expect(f.create).toHaveBeenCalledTimes(1);
    const generated = f.journal
      .catalog(f.catalog.id)
      .tasks.find((task) => task.sourceItem)!;
    expect(generated.pullRequest).toBeUndefined();
    expect(generated.scopes).toEqual(["src/client"]);
    expect(generated.dependsOn).toEqual(["api:one"]);
    expect(generated.brief).toContain(after);
    expect(generated.brief).toContain("b".repeat(40));
    const calls = f.requests.filter(
      (request) => request.task.projectId === "app",
    );
    expect(calls.map((request) => request.stage)).toEqual([
      "specify",
      "plan",
      "decompose",
      "implement",
      "review",
    ]);
    expect(calls[0]!.contracts["api:one:api"]).toBe(after);
    expect(calls[0]!.task.pullRequest).toBeUndefined();
    expect(calls.at(-1)!.task.pullRequest).toBe(17);
    expect(
      f.observations
        .filter((entry) => entry.task.startsWith("app:"))
        .every((entry) => entry.pullRequest === 17),
    ).toBe(true);
    expect(
      first.tasks.find((task) => task.key.startsWith("app:"))!.pullRequest,
    ).toBe(17);
    expect(f.journal.catalogGenerations(f.catalog.id)).toHaveLength(1);
    journals.splice(journals.indexOf(f.journal), 1);
    f.journal.close();
    const reopened = new MultiProjectJournal(
      path.join(f.folder, "journal.sqlite"),
    );
    journals.push(reopened);
    const second = await runMultiProjectOrchestrationPass({
      catalog: f.catalog,
      journal: reopened,
      host: configured,
    });
    expect(second.status).toBe("completed");
    expect(second.dispatched).toBe(0);
    expect(f.create).toHaveBeenCalledTimes(1);
    expect(f.writes).toHaveLength(1);
    expect(reopened.catalogGenerations(f.catalog.id)).toHaveLength(1);
  });
  it("fans out through both provider routes without inflating the shared budget", async () => {
    const f = fixture();
    const route = f.options.routes[0]!;
    const host = createCoworkOrchestrationFactory({
      ...f.options,
      routes: [
        route,
        {
          ...route,
          mapping: {
            ...route.mapping,
            consumer: "web",
            target: { provider: "github", repository: "example/web" },
            mappingDigest: coworkDigest("web-route"),
          },
        },
      ],
    });
    const result = await runMultiProjectOrchestrationPass({
      catalog: f.catalog,
      journal: f.journal,
      host,
    });
    expect(result.status).toBe("completed");
    expect(f.writes.sort()).toEqual(["azure-devops", "github"]);
    expect(result.tasks).toHaveLength(4);
    expect(f.create).toHaveBeenCalledTimes(2);
  });
  it("consumes deterministic signals through item publication, catalog generation and agent readiness", async () => {
    const f = fixture();
    const observedAt = new Date().toISOString();
    const host = createCoworkOrchestrationFactory({
      ...f.options,
      routes: [],
      signals: {
        read: async () => [
          {
            project: "app",
            source: "main-build",
            revision: initial,
            observedAt,
            metric: "failures",
            unit: "count",
            value: 2,
            evaluatedScope: 3,
            artifact: after,
            state: "known",
          },
        ],
        routes: [
          {
            rule: {
              id: "main-failures",
              version: "1",
              kind: "main-build",
              project: "app",
              source: "main-build",
              metric: "failures",
              unit: "count",
              direction: "above",
              threshold: 0,
              maxAgeMs: 60000,
              protectedMetric: "assertions",
              target: {
                provider: "azure-devops",
                organization: "example",
                project: "App",
                workItemType: "Task",
              },
            },
            scopes: ["src"],
            baseBranch: "main",
            acceptance: [{ label: "test", command: "fixture:fail-before-fix" }],
          },
        ],
        authorizeRegistration: async () => true,
      },
    });
    const run = () =>
      runMultiProjectOrchestrationPass({
        catalog: f.catalog,
        journal: f.journal,
        host,
      });
    const first = await run();
    expect(first.status).toBe("completed");
    expect(first.tasks).toHaveLength(3);
    expect(f.writes).toEqual(["azure-devops"]);
    const task = f.journal
      .catalog(f.catalog.id)
      .tasks.find((task) => task.id.startsWith("signal-"))!;
    expect(task.brief).toContain("preserve assertions");
    expect(
      f.requests.some(
        (request) =>
          request.task.id === task.id && request.stage === "implement",
      ),
    ).toBe(true);
    const again = await run();
    expect(again.dispatched).toBe(0);
    expect(f.writes).toHaveLength(1);
    expect(f.create).toHaveBeenCalledTimes(1);
  });
  it("does not publish unaffected consumers or unknown impacts", async () => {
    const f = fixture();
    const host = createCoworkOrchestrationFactory({
      ...f.options,
      routes: [
        {
          ...f.options.routes[0]!,
          mapping: { ...f.options.routes[0]!.mapping, consumedDigest: after },
        },
      ],
    });
    const result = await runMultiProjectOrchestrationPass({
      catalog: f.catalog,
      journal: f.journal,
      host,
    });
    expect(result.status).toBe("completed");
    expect(f.writes).toHaveLength(0);
    const unknown = createCoworkOrchestrationFactory({
      ...f.options,
      inspectChange: async () => ({
        state: "unknown",
        evidence: "Contract manifest unavailable",
      }),
    });
    const blocked = await runMultiProjectOrchestrationPass({
      catalog: f.catalog,
      journal: f.journal,
      host: unknown,
    });
    expect(blocked.status).toBe("needs-input");
    expect(blocked.tasks.every((task) => task.status === "completed")).toBe(
      true,
    );
    expect(
      blocked.followUps!.some((outcome) => outcome.state === "unknown"),
    ).toBe(true);
    expect(f.writes).toHaveLength(0);
  });
  it("retains uncertain PR publication across restart and keeps the independent lane completed", async () => {
    const f = fixture();
    f.create.mockImplementation(async () => {
      throw new Error("Lost reply after external publication");
    });
    const host = createCoworkOrchestrationFactory(f.options);
    const first = await runMultiProjectOrchestrationPass({
      catalog: f.catalog,
      journal: f.journal,
      host,
    });
    expect(first.status).toBe("needs-input");
    expect(
      first.tasks.find((task) => task.key.startsWith("app:"))!.status,
    ).toBe("unknown");
    expect(first.tasks.find((task) => task.key === "docs:one")!.status).toBe(
      "completed",
    );
    const again = await runMultiProjectOrchestrationPass({
      catalog: f.catalog,
      journal: f.journal,
      host,
    });
    expect(again.dispatched).toBe(0);
    expect(f.create).toHaveBeenCalledTimes(1);
    expect(f.writes).toHaveLength(1);
    expect(f.journal.allReservations()).toHaveLength(1);
  });
  it("cannot schedule an unapproved publication or silently borrow a PR when the required quality capability is absent", async () => {
    const f = fixture();
    const denied = createCoworkOrchestrationFactory({
      ...f.options,
      authorizeRegistration: async () => false,
    });
    const result = await runMultiProjectOrchestrationPass({
      catalog: f.catalog,
      journal: f.journal,
      host: denied,
    });
    expect(result.status).toBe("needs-input");
    expect(f.writes).toHaveLength(1);
    expect(f.journal.catalogGenerations(f.catalog.id)).toHaveLength(0);
    const missing = createCoworkOrchestrationFactory({
      ...f.options,
      validateTask: undefined,
    });
    const second = await runMultiProjectOrchestrationPass({
      catalog: f.catalog,
      journal: f.journal,
      host: missing,
    });
    expect(second.status).toBe("needs-input");
    expect(
      second.tasks.find((task) => task.key.startsWith("app:"))!.reason,
    ).toContain("negative-control capability");
  });
  it("rejects cycles, ambiguous routes and mismatched configured destinations", async () => {
    const f = fixture(),
      route = f.options.routes[0]!;
    expect(() =>
      createCoworkOrchestrationFactory({
        ...f.options,
        routes: [route, route],
      }),
    ).toThrow("Ambiguous");
    expect(() =>
      createCoworkOrchestrationFactory({
        ...f.options,
        routes: [
          route,
          {
            ...route,
            mapping: { ...route.mapping, producer: "app", consumer: "api" },
          },
        ],
      }),
    ).toThrow("cycle");
    const wrong = createCoworkOrchestrationFactory({
      ...f.options,
      routes: [
        {
          ...route,
          mapping: {
            ...route.mapping,
            target: { provider: "github", repository: "elsewhere/app" },
          },
        },
      ],
    });
    await expect(
      runMultiProjectOrchestrationPass({
        catalog: f.catalog,
        journal: f.journal,
        host: wrong,
      }),
    ).rejects.toThrow("target differs");
    expect(f.writes).toHaveLength(0);
  });
  it("rejects factory event forgery and old-fence writes", async () => {
    const f = fixture();
    const lease = f.journal.claim(30000);
    f.journal.initialize(f.catalog, lease);
    const store = createCoworkJournalStore({
      journal: f.journal,
      runId: f.catalog.id,
      lease,
    });
    const record = {
      kind: "intake" as const,
      intent: coworkDigest("intent"),
      state: "no-match" as const,
      reason: "fixture",
      evidence: {
        source: "fixture",
        project: "api",
        revision: initial,
        observedAt: new Date().toISOString(),
        metric: "errors",
        unit: "count" as const,
        value: 0,
        evaluatedScope: 1,
        artifact: before,
        state: "known" as const,
      },
    };
    const key = `factory:${coworkDigest("record")}`;
    const event = {
      kind: "intake" as const,
      intent: record.intent,
      at: new Date().toISOString(),
      recordDigest: coworkDigest(record),
    };
    await expect(
      store.compareAndSwap(key, 0, record, { ...event, recordDigest: after }),
    ).rejects.toThrow("does not bind");
    expect(await store.compareAndSwap(key, 0, record, event)).toBe(true);
    expect(f.journal.hostEvents(f.catalog.id)).toHaveLength(1);
    f.journal.release(lease);
    const next = f.journal.claim(30000);
    await expect(store.compareAndSwap(key, 1, record, event)).rejects.toThrow();
    expect((await store.read(key)).version).toBe(1);
    expect(f.journal.hostEvents(f.catalog.id)).toHaveLength(1);
    f.journal.release(next);
  });
});
