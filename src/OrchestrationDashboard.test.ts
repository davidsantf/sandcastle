import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { get as httpGet } from "node:http";
import { afterEach, expect, it } from "vitest";
import {
  dashboardHealth,
  readDashboardWorkspace,
  startOrchestrationDashboard,
  dashboardConfigurationSchema,
} from "./OrchestrationDashboard.js";
import {
  OrchestrationWorkspaceStore,
  initializeWorkspace,
  updateWorkspaceConfiguration,
} from "./OrchestrationWorkspace.js";
import { createOrchestrationProposalQueue } from "./OrchestrationProposal.js";
import { orchestrationServiceDigest } from "./OrchestrationOperations.js";
import { nativePollKey } from "./OrchestrationNativeHost.js";
import { githubWorkflowKey } from "./OrchestrationGithubWorkflow.js";

const folders: string[] = [];
afterEach(() =>
  folders
    .splice(0)
    .forEach((f) => fs.rmSync(f, { recursive: true, force: true })),
);
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-"));
  folders.push(directory);
  const database = path.join(directory, "workspace.sqlite");
  const store = new OrchestrationWorkspaceStore(database);
  initializeWorkspace(store, "fixture");
  const source = {
    id: "github",
    projectId: "api",
    hub: { kind: "github" as const, repository: "fixture/api" },
    selector: {
      assignedToOrLabel: {
        assignedTo: "fixture-user",
        optedInLabel: "orchestration-ready",
      },
    },
    pageSize: 10,
    maxPages: 5,
    includeReviewFeedback: true,
    includeDependencies: true,
  };
  const config = updateWorkspaceConfiguration(store, 1, (c) => ({
    ...c,
    projects: [
      {
        id: "api",
        mode: "individual",
        repositoryRoot: directory,
        hub: source.hub,
      },
    ],
    discovery: [source],
  }));
  const put = (key: string, value: unknown, at = "2026-11-11T21:00:00.000Z") =>
    store.compareAndSwap(key, store.read(key).version, value, {
      kind: "fixture-event",
      at,
    });
  return { database, store, config, source, put };
}
it("shows an earlier unknown hold across source revisions without changing observed state, then exposes actual review findings", async () => {
  const f = fixture();
  const queue = createOrchestrationProposalQueue({
    store: f.store,
    namespace: f.config.id,
  });
  const item = {
    sourceId: "github",
    projectId: "api",
    id: "306",
    kind: "issue" as const,
    title: "Scoped correction",
    body: "untrusted",
    updatedAt: "2026-11-11T20:00:00Z",
    url: "https://github.com/fixture/api/issues/306",
    revision: "a".repeat(64),
    feedback: [],
    dependencies: [],
  };
  const original = queue.ingest(item, f.config.revision);
  await queue.plan(
    original.id,
    async () => {
      throw new Error("uncertain");
    },
    new AbortController().signal,
  );
  f.put(githubWorkflowKey(f.config.id, "github", "306"), {
    proposalId: original.id,
    stage: "orchestration-planning",
    sync: "confirmed",
  });
  const unknown = await readDashboardWorkspace({
    name: "Fixture",
    database: f.database,
  });
  expect(
    unknown.proposals.find((proposal) => proposal.id === original.id),
  ).toMatchObject({
    state: "unknown",
    effectiveState: "blocked",
  });
  const current = queue.ingest(
    { ...item, revision: "b".repeat(64) },
    f.config.revision,
  );
  f.put(githubWorkflowKey(f.config.id, "github", "306"), {
    proposalId: current.id,
    stage: "orchestration-reviewing",
    sync: "confirmed",
    review: {
      attempt: 10,
      revision: "c".repeat(40),
      findings: ["Handle empty input"],
    },
  });
  f.store.close();
  const result = await readDashboardWorkspace({
    name: "Fixture",
    database: f.database,
  });
  expect(
    result.proposals.find((proposal) => proposal.id === current.id),
  ).toMatchObject({
    state: "observed",
    effectiveState: "blocked",
    unresolvedPrior: true,
    stageOwner: "agent",
    review: { iteration: 10, limit: 10, findings: ["Handle empty input"] },
  });
});
it("maps real proposal and launch shapes; keeps unknown outcomes and local-proof boundaries without bodies or paths", async () => {
  const f = fixture();
  const queue = createOrchestrationProposalQueue({
    store: f.store,
    namespace: f.config.id,
  });
  queue.ingest(
    {
      sourceId: "github",
      projectId: "api",
      id: "306",
      url: "https://github.com/fixture/api/issues/306",
      kind: "issue",
      title: "<img src=x onerror=alert(1)>",
      body: "secret-body-not-for-dashboard",
      updatedAt: "2026-11-11T20:00:00Z",
      revision: "a".repeat(64),
      feedback: [],
      dependencies: [],
    },
    f.config.revision,
  );
  const suffix = orchestrationServiceDigest(f.config.id);
  f.put(`service-owner/${suffix}`, { state: "active", pid: 12345 });
  f.put(nativePollKey(f.config, f.source), {
    failures: 0,
    diagnostic: "",
    cursor: { page: 1 },
  });
  f.put("local-execution/fixture", {
    stage: "specify",
    outcome: "unknown",
    requestedAgent: "devsquad:devsquad.specify",
    taskId: "fixture-task",
    configurationRevision: f.config.revision,
    pluginDirectory: "C:\\private",
    secret: "never-expose",
  });
  f.put("native-local-validation/fixture", {
    state: "failed",
    evaluatedScope: 4,
    diagnostic: "token=abc C:\\private\\path",
  });
  const before = f.store.events();
  f.store.close();
  const result = await readDashboardWorkspace(
    { name: "Fixture", database: f.database },
    {
      now: Date.parse("2026-11-11T21:00:20Z"),
      control: async () => ({
        state: "idle",
        ownerId: "fixture-owner",
        passes: 1,
        diagnostic: "",
        focus: f.config.focus,
        operations: { reserved: 0, completed: 0 },
        evidence: [],
        lastFailure: null,
        failureEvidence: "none",
      }),
    },
  );
  expect(result.health).toBe("online");
  expect(result.proposals[0]).toMatchObject({
    issue: "306",
    title: "<img src=x onerror=alert(1)>",
    currentConfiguration: true,
  });
  expect(result.phases[0]).toMatchObject({
    stage: "specify",
    outcome: "unknown",
  });
  expect(result.validations[0]).toMatchObject({
    state: "failed",
    evaluatedScope: 4,
    independentReview: false,
  });
  expect(JSON.stringify(result)).not.toMatch(
    /secret-body|never-expose|C:\\\\private|token=abc/,
  );
  const unreachable = await readDashboardWorkspace(
    { name: "Fixture", database: f.database },
    {
      control: async () => {
        throw new Error("token=must-not-leak");
      },
    },
  );
  expect(unreachable.health).toBe("offline");
  expect(unreachable.blockers[0]).toContain("control is unreachable");
  expect(JSON.stringify(unreachable)).not.toContain("must-not-leak");
  const readOnly = new OrchestrationWorkspaceStore(f.database, Date.now, {
    readOnly: true,
  });
  expect(readOnly.events()).toEqual(before);
  expect(readOnly.recentEvents(2)).toHaveLength(2);
  expect(readOnly.recentEvents(2)[1]?.sequence).toBe(before.at(-1)?.sequence);
  expect(() =>
    readOnly.compareAndSwap(
      "write",
      0,
      {},
      { kind: "forbidden", at: new Date().toISOString() },
    ),
  ).toThrow("read-only");
  readOnly.close();
});
it("distinguishes stale polling from stopped services and exposes retained failure without claiming active work", async () => {
  const f = fixture();
  f.put(`service-failure/${orchestrationServiceDigest(f.config.id)}`, {
    classification: "host-callback-failed",
    phase: "tick",
    at: "2026-11-11T21:00:00Z",
  });
  f.store.close();
  const result = await readDashboardWorkspace({
    name: "Stopped",
    database: f.database,
  });
  expect(result.health).toBe("offline");
  expect(result.blockers[0]).toContain("host-callback-failed");
  expect(result.activePhases).toBe(0);
  expect(
    dashboardHealth(
      "idle",
      "2026-11-11T20:00:00Z",
      60000,
      Date.parse("2026-11-11T21:00:00Z"),
    ),
  ).toBe("stale");
  expect(dashboardHealth("idle", undefined, 60000, Date.now())).toBe("stale");
});
it("serves only same-origin GET routes, rejects control/path requests, isolates unavailable projects and bounds collection", async () => {
  let calls = 0;
  const service = await startOrchestrationDashboard({
    workspaces: [
      { name: "Unavailable", database: path.resolve("not-a-database") },
    ],
    port: 0,
    read: async () => {
      calls++;
      throw new Error("token=private C:\\private");
    },
  });
  try {
    const get = await fetch(service.url + "/api/state");
    const body = await get.text();
    expect(body).toContain("Canonical journal unavailable");
    expect(body).not.toContain("token=private");
    expect(get.headers.get("access-control-allow-origin")).toBeNull();
    expect(
      (await fetch(service.url + "/api/state", { method: "POST" })).status,
    ).toBe(405);
    expect(
      (
        await fetch(service.url + "/api/state", {
          headers: { Origin: "https://evil.example" },
        })
      ).status,
    ).toBe(403);
    const navigation = await new Promise<number | undefined>(
      (resolve, reject) => {
        httpGet(
          service.url + "/",
          {
            headers: {
              "Sec-Fetch-Site": "cross-site",
              "Sec-Fetch-Mode": "navigate",
            },
          },
          (response) => {
            response.resume();
            resolve(response.statusCode);
          },
        ).on("error", reject);
      },
    );
    expect(navigation).toBe(200);
    const invalidHost = await new Promise<number | undefined>(
      (resolve, reject) => {
        httpGet(
          service.url + "/api/state",
          { headers: { Host: "evil.example" } },
          (response) => {
            response.resume();
            resolve(response.statusCode);
          },
        ).on("error", reject);
      },
    );
    expect(invalidHost).toBe(403);
    expect(
      (
        await fetch(service.url + "/api/state", {
          headers: { "Sec-Fetch-Site": "cross-site" },
        })
      ).status,
    ).toBe(403);
    expect((await fetch(service.url + "/execute")).status).toBe(404);
    expect(
      (await fetch(service.url + "/api/state?database=C:\\private")).status,
    ).toBe(404);
    await Promise.all([
      fetch(service.url + "/api/state"),
      fetch(service.url + "/api/state"),
    ]);
    expect(calls).toBe(1);
    expect(service.server.address()).toMatchObject({ address: "127.0.0.1" });
  } finally {
    await service.close();
  }
});
it("rejects duplicated canonical input paths", () => {
  const database = path.resolve("fixture.sqlite");
  expect(() =>
    dashboardConfigurationSchema.parse({
      workspaces: [
        { name: "A", database },
        { name: "B", database },
      ],
    }),
  ).toThrow("duplicate database");
});
it("does not create directories or a ledger when a configured journal is missing", async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "dashboard-missing-"),
  );
  folders.push(directory);
  const parent = path.join(directory, "absent");
  await expect(
    readDashboardWorkspace({
      name: "Missing",
      database: path.join(parent, "missing.sqlite"),
    }),
  ).rejects.toThrow();
  expect(fs.existsSync(parent)).toBe(false);
});
