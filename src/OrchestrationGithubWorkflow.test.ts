import { expect, it, vi } from "vitest";
import { digest } from "./MultiProjectProtocol.js";
import {
  createGithubWorkflow,
  attributedWorkflowApproval,
  attributedWorkflowCommentApproval,
  githubWorkflowKey,
  type GithubWorkflowTransport,
} from "./OrchestrationGithubWorkflow.js";
import {
  orchestrationWorkflowLabels,
  retainedGithubWorkflowAdmission,
} from "./OrchestrationWorkflowContract.js";
import { createOrchestrationNativeTick } from "./OrchestrationNativeHost.js";
import { evaluateOrchestrationFocus } from "./OrchestrationFocus.js";
import { defaultWorkspaceConfiguration } from "./OrchestrationWorkspace.js";
import {
  orchestrationDiscoverySourceSchema,
  createOrchestrationDiscoveryAdapter,
} from "./OrchestrationDiscovery.js";
import {
  createOrchestrationProposalQueue,
  retainedGithubWorkflowRevision,
  OrchestrationProposalBlockedError,
} from "./OrchestrationProposal.js";
import {
  intakeTestStore,
  intakeTestArtifacts,
  intakeTestItem,
} from "./OrchestrationProposal.test.js";
const signal = () => new AbortController().signal;
async function fixture(labelOnly = false, legacyRevision = false) {
  const store = intakeTestStore();
  const config = defaultWorkspaceConfiguration("workflow");
  const source = orchestrationDiscoverySourceSchema.parse({
    id: "github",
    projectId: "api",
    hub: { kind: "github", repository: "org/api" },
    selector: {
      assignedToOrLabel: {
        assignedTo: "owner",
        optedInLabel: "orchestration-ready",
      },
    },
    workflow: { kind: "github-labels", approver: "owner" },
    includeReviewFeedback: false,
    includeDependencies: false,
  });
  config.discovery = [source];
  config.focus.mode = "execute";
  config.focus.projectIds = ["api"];
  config.focus.permissions = [
    { projectId: "api", action: "discover" },
    { projectId: "api", action: "investigate" },
    { projectId: "api", action: "implement" },
    { projectId: "api", action: "publish-item" },
  ];
  const names = new Set(["orchestration-ready", "unrelated"]);
  const created = new Set<string>();
  const comments: {
    id: number;
    body: string;
    user: { login: string };
    created_at: string;
    updated_at?: string;
  }[] = [];
  const events: {
    id: number;
    event: string;
    actor: { login: string };
    label: { name: string };
    created_at: string;
  }[] = [];
  let uncertainComment = false;
  let uncertainRemoval = false;
  let refusedRemoval = false;
  const raw = {
    number: 1,
    html_url: "https://github.com/org/api/issues/1",
    title: "Scoped correction",
    body: "untrusted issue",
    state: "open",
    updated_at: "2026-11-11T20:00:00Z",
    assignees: labelOnly ? [] : [{ login: "owner" }],
  };
  const discoveryTransport = vi.fn(async ({ url }: { url: string }) => ({
    status: 200,
    body: url.includes("/issues?")
      ? []
      : { ...raw, labels: [...names].map((name) => ({ name })) },
  }));
  const item = await createOrchestrationDiscoveryAdapter(
    source,
    discoveryTransport,
  ).refresh(intakeTestItem(), signal());
  if (legacyRevision) {
    const { revision: _, ...snapshot } = item;
    item.revision = digest(
      JSON.stringify({
        ...snapshot,
        updatedAt: undefined,
        labels: snapshot.labels,
        assignees: raw.assignees.map((actor) => actor.login).sort(),
      }),
    );
  }
  const queue = createOrchestrationProposalQueue({
    store,
    namespace: config.id,
  });
  const proposal = queue.ingest(item, config.revision);
  const planned = await queue.plan(
    proposal.id,
    async () => intakeTestArtifacts,
    signal(),
  );
  const transport = vi.fn<GithubWorkflowTransport>(
    async (endpoint, method, body) => {
      if (method === "GET") {
        if (endpoint === "user") return { login: "owner" };
        if (endpoint === "repos/org/api")
          return { permissions: { push: true } };
        if (endpoint.startsWith("repos/org/api/labels?"))
          return [...created].map((name) => ({ name }));
        if (endpoint === "repos/org/api/issues/1/labels")
          return [...names].map((name) => ({ name }));
        if (endpoint.includes("/comments?")) return comments;
        if (endpoint.includes("/events?")) return events;
        if (endpoint.startsWith("repos/org/api/issues/comments/"))
          return comments.find((comment) =>
            endpoint.endsWith(`/${comment.id}`),
          );
      }
      if (method === "POST") {
        if (endpoint === "repos/org/api/labels") {
          created.add((body as { name: string }).name);
          return {};
        }
        if (endpoint.endsWith("/labels")) {
          for (const name of (body as { labels: string[] }).labels)
            names.add(name);
          return [];
        }
        if (endpoint.endsWith("/comments")) {
          comments.push({
            id: comments.length + 1,
            body: (body as { body: string }).body,
            user: { login: "owner" },
            created_at: "2026-11-11T21:00:00Z",
            updated_at: "2026-11-11T21:00:00Z",
          });
          if (uncertainComment) {
            uncertainComment = false;
            throw new Error("transport lost after remote commit");
          }
          return comments.at(-1);
        }
      }
      if (method === "DELETE" && endpoint.includes("/labels/")) {
        if (refusedRemoval) {
          refusedRemoval = false;
          throw new Error("label removal rejected without confirmation");
        }
        names.delete(decodeURIComponent(endpoint.split("/labels/")[1]!));
        if (uncertainRemoval) {
          uncertainRemoval = false;
          throw new Error("transport lost after label removal");
        }
        return null;
      }
      throw new Error(`Unexpected fixture request ${method} ${endpoint}`);
    },
  );
  const workflow = () =>
    createGithubWorkflow({
      configuration: config,
      store,
      transport,
      discoveryTransport: () => discoveryTransport,
    });
  return {
    store,
    config,
    queue,
    planned,
    names,
    created,
    comments,
    events,
    transport,
    discoveryTransport,
    raw,
    workflow,
    uncertain: () => {
      uncertainComment = true;
    },
    uncertainRemoval: () => {
      uncertainRemoval = true;
    },
    refuseRemoval: () => {
      refusedRemoval = true;
    },
  };
}
const approvingComment = () => ({
  id: 100,
  body: "plan approved",
  user: { login: "OWNER" },
  created_at: "2026-11-11T21:01:00Z",
  updated_at: "2026-11-11T21:01:00Z",
});
it("carries the source account binding through every workflow read/write without substituting the approver", async () => {
  const f = await fixture();
  const authentication = {
    kind: "github-cli" as const,
    account: "owner",
    allowedAccounts: ["owner"],
  };
  f.config.discovery[0]!.authentication = authentication;
  await f.workflow().ready(f.planned, signal());
  expect(f.comments).toHaveLength(1);
  expect(
    f.transport.mock.calls.every((call) => call[4] === authentication),
  ).toBe(true);
});
it("refuses workflow writes when an injected transport identifies a different configured account", async () => {
  const f = await fixture();
  f.config.discovery[0]!.authentication = {
    kind: "github-cli",
    account: "different_user",
    allowedAccounts: ["different_user"],
  };
  await expect(f.workflow().ready(f.planned, signal())).rejects.toThrow(
    "account identity mismatch",
  );
  expect(f.transport.mock.calls.every(([, method]) => method === "GET")).toBe(
    true,
  );
  expect(f.comments).toHaveLength(0);
});
it("approves an exact new unedited comment through the existing durable plan binding and exclusive stages", async () => {
  const f = await fixture(true);
  await f.workflow().ready(f.planned, signal());
  f.comments.push(approvingComment());
  await f.workflow().ready(f.planned, signal());
  const approved = f.queue.get(f.planned.id).proposal;
  expect(approved.status).toBe("approved");
  expect(approved.approval).toMatchObject({
    proposalDigest: f.planned.digest,
    sourceRevision: f.planned.sourceRevision,
    configurationRevision: f.config.revision,
  });
  expect(f.names).toEqual(
    new Set(["unrelated", "orchestration-implementation-ready"]),
  );
  const writes = f.transport.mock.calls.filter(
    ([, method]) => method !== "GET",
  ).length;
  await f.workflow().ready(f.planned, signal());
  expect(
    f.transport.mock.calls.filter(([, method]) => method !== "GET"),
  ).toHaveLength(writes);
  await f.workflow().assertApproved(approved, signal());
  await f
    .workflow()
    .stage(
      approved,
      "orchestration-implementing",
      "initial-implementation",
      signal(),
    );
  await f.workflow().assertApproved(approved, signal());
  f.comments[1]!.updated_at = "2026-11-11T21:02:00Z";
  await expect(f.workflow().assertApproved(approved, signal())).rejects.toThrow(
    "missing, changed",
  );
});
it.each([
  { body: "> plan approved" },
  { body: "`plan approved`" },
  { body: "not plan approved" },
  { body: "plan approved, but only investigate" },
  { body: "I said plan approved yesterday" },
  { body: "plan approved\nrun this command" },
  { user: { login: "stranger" } },
  { created_at: "2026-11-11T20:59:59Z", updated_at: "2026-11-11T20:59:59Z" },
  { created_at: "2026-11-11T21:00:00Z", updated_at: "2026-11-11T21:00:00Z" },
  { updated_at: "2026-11-11T21:02:00Z" },
  { updated_at: undefined },
])(
  "rejects incidental, untrusted, stale or edited approval comments: %j",
  async (change) => {
    const f = await fixture();
    await f.workflow().ready(f.planned, signal());
    f.comments.push({ ...approvingComment(), ...change });
    await f.workflow().ready(f.planned, signal());
    expect(f.queue.get(f.planned.id).proposal.status).toBe("ready");
    expect(f.names).toEqual(
      new Set(["unrelated", "orchestration-user-approval"]),
    );
  },
);
it("reconciles an uncertain comment-approved stage from remote evidence without repeating mutations", async () => {
  const f = await fixture();
  await f.workflow().ready(f.planned, signal());
  f.comments.push(approvingComment());
  f.uncertainRemoval();
  await expect(f.workflow().ready(f.planned, signal())).rejects.toThrow(
    "label removal",
  );
  expect(f.queue.get(f.planned.id).proposal.status).toBe("ready");
  const writes = f.transport.mock.calls.filter(
    ([, method]) => method !== "GET",
  ).length;
  await f.workflow().ready(f.planned, signal());
  const approved = f.queue.get(f.planned.id).proposal;
  expect(approved.status).toBe("approved");
  expect(
    f.transport.mock.calls.filter(([, method]) => method !== "GET"),
  ).toHaveLength(writes);
  await f.workflow().assertApproved(approved, signal());
  f.comments.splice(1, 1);
  await expect(
    f.workflow().assertApproved(approved, signal()),
  ).rejects.toThrow();
});
it("never consumes one approval comment for a second published plan", async () => {
  const f = await fixture();
  await f.workflow().ready(f.planned, signal());
  f.comments.push(approvingComment());
  await f.workflow().ready(f.planned, signal());
  f.raw.body = "Changed source requiring a new plan";
  f.names.delete("orchestration-implementation-ready");
  const fresh = await createOrchestrationDiscoveryAdapter(
    f.config.discovery[0]!,
    f.discoveryTransport,
  ).refresh(intakeTestItem(), signal());
  const next = f.queue.ingest(fresh, f.config.revision);
  const planned = await f.queue.plan(
    next.id,
    async () => intakeTestArtifacts,
    signal(),
  );
  // Even indistinguishable coarse provider clocks cannot reuse the old comment.
  await expect(f.workflow().ready(planned, signal())).rejects.toThrow(
    "already bound",
  );
  expect(f.queue.get(next.id).proposal.approval).toBeUndefined();
  expect(f.names.has("orchestration-implementation-ready")).toBe(false);
});
it("binds comment approval to the current source, configuration, digest and exact published body", async () => {
  const f = await fixture();
  await f.workflow().ready(f.planned, signal());
  const publication = f.store.read(
    `${githubWorkflowKey(f.config.id, "github", "1")}/plan/${f.planned.id}`,
  ).value as Parameters<
    typeof attributedWorkflowCommentApproval
  >[0]["publication"];
  const input = {
    publication,
    proposal: f.planned,
    publishedBody: f.comments[0]!.body,
    comments: [{ ...approvingComment(), body: " \nPLAN APPROVED \n" }],
  };
  expect(attributedWorkflowCommentApproval(input)?.approvalCommentId).toBe(100);
  for (const change of [
    { sourceRevision: "changed" },
    { configurationRevision: f.config.revision + 1 },
    { digest: "different-plan" },
    { id: "another-proposal" },
    {
      artifacts: { ...f.planned.artifacts!, plan: "Changed after publication" },
    },
  ])
    expect(
      attributedWorkflowCommentApproval({
        ...input,
        proposal: { ...f.planned, ...change },
      }),
    ).toBeNull();
  expect(
    attributedWorkflowCommentApproval({
      ...input,
      publishedBody: `${input.publishedBody} changed`,
    }),
  ).toBeNull();
  f.comments.push(approvingComment());
  f.raw.body = "Changed requested scope";
  await expect(f.workflow().ready(f.planned, signal())).rejects.toThrow(
    "Source changed",
  );
  expect(f.queue.get(f.planned.id).proposal.approval).toBeUndefined();
});
it("does not turn a journaled host comment-approval label into independent user approval after revocation", async () => {
  const f = await fixture();
  await f.workflow().ready(f.planned, signal());
  f.comments.push(approvingComment());
  const original = f.transport.getMockImplementation()!;
  f.transport.mockImplementation(async (...args) => {
    const result = await original(...args);
    if (
      args[1] === "POST" &&
      args[0].endsWith("/labels") &&
      (args[2] as { labels?: string[] })?.labels?.includes(
        "orchestration-implementation-ready",
      )
    ) {
      f.comments[1]!.updated_at = "2026-11-11T21:02:00Z";
      f.events.push({
        id: 200,
        event: "labeled",
        actor: { login: "owner" },
        label: { name: "orchestration-implementation-ready" },
        created_at: "2026-11-11T21:01:00Z",
      });
    }
    return result;
  });
  await expect(f.workflow().ready(f.planned, signal())).rejects.toThrow(
    "changed during",
  );
  await f.workflow().ready(f.planned, signal());
  expect(f.queue.get(f.planned.id).proposal.status).toBe("ready");
  expect(f.queue.get(f.planned.id).proposal.approval).toBeUndefined();
});
it("keeps investigation-only work blocked even after an otherwise valid comment approval", async () => {
  const f = await fixture();
  f.config.runtime.planningOverrides = [
    {
      sourceId: "github",
      itemId: "1",
      investigationOnly: true,
      template: {} as never,
    },
  ];
  await f.workflow().ready(f.planned, signal());
  f.comments.push(approvingComment());
  await f.workflow().ready(f.planned, signal());
  expect(f.queue.get(f.planned.id).proposal.approval).toBeUndefined();
  expect(f.names.has("orchestration-implementation-ready")).toBe(false);
});
async function supersededLegacyPlan() {
  const f = await fixture(false, true);
  await f.workflow().ready(f.planned, signal());
  f.names.delete("orchestration-user-approval");
  f.names.add("orchestration-implementation-ready");
  const normalized = await createOrchestrationDiscoveryAdapter(
    f.config.discovery[0]!,
    f.discoveryTransport,
  ).refresh(intakeTestItem(), signal());
  const replacement = f.queue.ingest(normalized, f.config.revision);
  await f.queue.plan(
    replacement.id,
    async () => {
      throw new OrchestrationProposalBlockedError(
        "GitHub planning stage synchronization failed or is uncertain; no worker launched",
      );
    },
    signal(),
  );
  return { ...f, replacement };
}
it("restores the exact legacy published plan after stage-only supersession without replanning, approval or provider writes", async () => {
  const f = await supersededLegacyPlan();
  expect(f.queue.get(f.planned.id).proposal.status).toBe("superseded");
  const effectId = `${f.planned.id}:planning:add:orchestration-planning`;
  const uncertainKey = `hub-workflow-effect/${digest([f.config.id, "github", "1", effectId])}`;
  const reservation = { state: "reserved", id: effectId };
  f.store.compareAndSwap(uncertainKey, 0, reservation, {
    kind: "fixture-uncertainty",
    at: "2026-11-11T21:00:00Z",
  });
  f.config.focus.permissions = f.config.focus.permissions.filter(
    (p) => p.action !== "publish-item",
  );
  const writes = f.transport.mock.calls.filter(
    ([, method]) => method !== "GET",
  ).length;
  expect(
    await f
      .workflow()
      .reconcilePublishedPlan(f.queue.get(f.planned.id).proposal, signal()),
  ).toBe(true);
  const restored = f.queue.get(f.planned.id).proposal;
  expect(restored).toMatchObject({
    status: "ready",
    digest: f.planned.digest,
    sourceRevision: f.planned.sourceRevision,
    workflowPlanRestoration: { publicationDigest: expect.any(String) },
  });
  expect(restored.approval).toBeUndefined();
  expect(f.queue.get(f.replacement.id).proposal.status).toBe("superseded");
  expect(f.comments).toHaveLength(1);
  expect(f.store.read(uncertainKey).value).toEqual(reservation);
  expect(
    f.transport.mock.calls.filter(([, method]) => method !== "GET"),
  ).toHaveLength(writes);
  const poll = createOrchestrationDiscoveryAdapter(
    f.config.discovery[0]!,
    async ({ url }) => ({
      status: 200,
      body: url.includes("assignee=")
        ? [{ ...f.raw, labels: [...f.names].map((name) => ({ name })) }]
        : [],
    }),
    f.config.focus,
    retainedGithubWorkflowAdmission(f.config, f.store),
    retainedGithubWorkflowRevision(f.config, f.store),
  );
  const observed = (await poll.poll(null, signal())).items[0]!;
  expect(observed.revision).toBe(f.planned.sourceRevision);
  expect(f.queue.ingest(observed, f.config.revision).id).toBe(f.planned.id);
  await expect(f.workflow().ready(restored, signal())).rejects.toThrow(
    "publish-item",
  );
  expect(f.queue.get(f.planned.id).proposal.status).toBe("ready");
});
it.each([
  "body",
  "assignment",
  "unrelated-label",
  "publication",
  "configuration",
  "unknown",
] as const)(
  "never restores a legacy plan across changed facts or unresolved execution: %s",
  async (change) => {
    const f = await supersededLegacyPlan();
    if (change === "body") f.raw.body = "New scope";
    if (change === "assignment") f.raw.assignees = [];
    if (change === "unrelated-label") f.names.add("new-scope");
    if (change === "publication") f.comments[0]!.body += "changed";
    if (change === "configuration") f.config.revision++;
    if (change === "unknown") {
      const current = f.queue.ingest(
        { ...f.replacement.source, revision: digest("another-revision") },
        f.config.revision,
      );
      await f.queue.plan(
        current.id,
        async () => {
          throw new Error("possibly launched");
        },
        signal(),
      );
    }
    const result = f
      .workflow()
      .reconcilePublishedPlan(f.queue.get(f.planned.id).proposal, signal());
    if (change === "configuration") await expect(result).resolves.toBe(false);
    else await expect(result).rejects.toThrow();
    expect(f.queue.get(f.planned.id).proposal.status).toBe("superseded");
    expect(f.queue.get(f.planned.id).proposal.approval).toBeUndefined();
  },
);
it("publishes one reviewable exact plan, creates only authorized labels, and approves only an attributed later action", async () => {
  const f = await fixture();
  await f.workflow().ready(f.planned, signal());
  expect(f.comments).toHaveLength(1);
  expect([...f.created].sort()).toEqual(
    [...orchestrationWorkflowLabels].sort(),
  );
  expect(f.names).toEqual(
    new Set(["unrelated", "orchestration-user-approval"]),
  );
  expect(f.queue.get(f.planned.id).proposal.status).toBe("ready");
  f.names.add("orchestration-implementation-ready");
  f.events.push({
    id: 100,
    event: "labeled",
    actor: { login: "stranger" },
    label: { name: "orchestration-implementation-ready" },
    created_at: "2026-11-11T21:01:00Z",
  });
  await f.workflow().ready(f.planned, signal());
  expect(f.queue.get(f.planned.id).proposal.status).toBe("ready");
  expect(
    f.store.read(githubWorkflowKey(f.config.id, "github", "1")).value,
  ).toMatchObject({
    sync: "blocked",
  });
  f.events.push({ ...f.events[0]!, id: 101, actor: { login: "owner" } });
  await f.workflow().ready(f.planned, signal());
  const approved = f.queue.get(f.planned.id).proposal;
  expect(approved.status).toBe("approved");
  expect(f.names).toEqual(
    new Set(["unrelated", "orchestration-implementation-ready"]),
  );
  expect(
    f.transport.mock.calls.some(
      ([, method, body]) =>
        method === "POST" &&
        (body as { labels?: string[] } | undefined)?.labels?.includes(
          "orchestration-implementation-ready",
        ),
    ),
  ).toBe(false);
  await f.workflow().assertApproved(approved, signal());
  f.events.push({
    ...f.events[0]!,
    id: 102,
    event: "unlabeled",
    actor: { login: "owner" },
  });
  await expect(f.workflow().assertApproved(approved, signal())).rejects.toThrow(
    "removed",
  );
  expect(f.comments).toHaveLength(1);
  await expect(
    f.workflow().stage(approved, "orchestration-finished", "fake", signal()),
  ).rejects.toThrow("proof");
  await expect(
    f
      .workflow()
      .stage(approved, "orchestration-implementation-ready", "fake", signal()),
  ).rejects.toThrow("approval");
});
it("keeps stages exclusive through planning, approval, implementation and review/fix transitions", async () => {
  const f = await fixture(true);
  for (const [next, cycle] of [
    ["orchestration-planning", "planning"],
    ["orchestration-user-approval", "plan-published"],
    ["orchestration-implementing", "initial-implementation"],
    ["orchestration-reviewing", "review-1"],
    ["orchestration-implementing", "fix-1"],
  ]) {
    await f.workflow().stage(f.planned, next!, cycle!, signal());
    expect(f.names).toEqual(new Set(["unrelated", next]));
  }
});
it("retains label-only admitted work across restart and fresh intake without admitting arbitrary stage labels", async () => {
  const f = await fixture(true);
  await f
    .workflow()
    .stage(f.planned, "orchestration-planning", "planning", signal());
  const source = f.config.discovery[0]!;
  const ordinary = createOrchestrationDiscoveryAdapter(
    source,
    f.discoveryTransport,
  );
  await expect(ordinary.refresh(f.planned.source, signal())).rejects.toThrow(
    "access",
  );
  const unadmitted = createOrchestrationDiscoveryAdapter(
    source,
    f.discoveryTransport,
    f.config.focus,
    retainedGithubWorkflowAdmission(f.config, intakeTestStore()),
  );
  await expect(unadmitted.refresh(f.planned.source, signal())).rejects.toThrow(
    "access",
  );
  const retained = createOrchestrationDiscoveryAdapter(
    source,
    f.discoveryTransport,
    f.config.focus,
    retainedGithubWorkflowAdmission(f.config, f.store),
  );
  expect((await retained.refresh(f.planned.source, signal())).revision).toBe(
    f.planned.sourceRevision,
  );
  await f.workflow().ready(f.planned, signal());
  const planner = vi.fn();
  const dispatch = vi.fn(async () => ({ receipt: "fixture-only-dispatch" }));
  const tick = createOrchestrationNativeTick({
    evaluateFocus: evaluateOrchestrationFocus,
    transport: () => f.discoveryTransport,
    planner,
    dispatch,
  });
  const context = {
    configuration: f.config,
    store: f.store,
    signal: signal(),
    operations: {
      perform: async <T>(
        _request: unknown,
        execute: (signal: AbortSignal) => Promise<T>,
      ) => ({ state: "ready" as const, value: await execute(signal()) }),
    },
  };
  await tick(context);
  expect(planner).not.toHaveBeenCalled();
  expect(dispatch).not.toHaveBeenCalled();
  expect(f.queue.get(f.planned.id).proposal.status).toBe("ready");
  f.names.add("orchestration-implementation-ready");
  f.events.push({
    id: 101,
    event: "labeled",
    actor: { login: "owner" },
    label: { name: "orchestration-implementation-ready" },
    created_at: "2026-11-11T21:01:00Z",
  });
  await f.workflow().ready(f.planned, signal());
  await tick(context);
  expect(dispatch).toHaveBeenCalledOnce();
  expect(f.queue.get(f.planned.id).proposal.status).toBe("dispatched");
});
it("continues only inside the admitted configuration, retaining fresh revision and open-issue checks", async () => {
  const f = await fixture(true);
  await f.workflow().ready(f.planned, signal());
  f.raw.body = "Changed requested scope";
  await expect(
    f
      .workflow()
      .stage(f.planned, "orchestration-implementing", "changed", signal()),
  ).rejects.toThrow("Source changed");
  expect(f.queue.get(f.planned.id).proposal.status).toBe("ready");
  f.raw.body = "untrusted issue";
  f.config.revision++;
  const changed = createOrchestrationDiscoveryAdapter(
    f.config.discovery[0]!,
    f.discoveryTransport,
    f.config.focus,
    retainedGithubWorkflowAdmission(f.config, f.store),
  );
  await expect(changed.refresh(f.planned.source, signal())).rejects.toThrow(
    "access",
  );
  f.config.revision--;
  f.raw.state = "closed";
  await expect(f.workflow().ready(f.planned, signal())).rejects.toThrow(
    "access",
  );
});
it("reconciles an uncertain ready removal using remote evidence without deleting twice", async () => {
  const f = await fixture(true);
  f.uncertainRemoval();
  await expect(
    f
      .workflow()
      .stage(f.planned, "orchestration-planning", "planning", signal()),
  ).rejects.toThrow("label removal");
  expect(f.names).toEqual(new Set(["unrelated", "orchestration-planning"]));
  await f
    .workflow()
    .stage(f.planned, "orchestration-planning", "planning", signal());
  expect(
    f.transport.mock.calls.filter(([, method]) => method === "DELETE"),
  ).toHaveLength(1);
  await f.workflow().ready(f.planned, signal());
  expect(f.names).toEqual(
    new Set(["unrelated", "orchestration-user-approval"]),
  );
});
it("holds an unconfirmed removal without blind replay or claiming an exclusive stage", async () => {
  const f = await fixture(true);
  f.refuseRemoval();
  await expect(
    f
      .workflow()
      .stage(f.planned, "orchestration-planning", "planning", signal()),
  ).rejects.toThrow("without confirmation");
  await expect(
    f
      .workflow()
      .stage(f.planned, "orchestration-planning", "planning", signal()),
  ).rejects.toThrow("no blind retry");
  expect(f.names).toEqual(
    new Set(["orchestration-ready", "orchestration-planning", "unrelated"]),
  );
  expect(
    f.transport.mock.calls.filter(([, method]) => method === "DELETE"),
  ).toHaveLength(1);
  expect(
    f.store.read(githubWorkflowKey(f.config.id, "github", "1")).value,
  ).toMatchObject({
    sync: "blocked",
  });
});
it("reserves a shared stage effect once when callers race across fresh authority checks", async () => {
  const f = await fixture(true);
  for (const name of orchestrationWorkflowLabels) f.created.add(name);
  const results = await Promise.allSettled([
    f
      .workflow()
      .stage(f.planned, "orchestration-planning", "planning", signal()),
    f
      .workflow()
      .stage(f.planned, "orchestration-planning", "planning", signal()),
  ]);
  expect(results.some((result) => result.status === "fulfilled")).toBe(true);
  expect(
    f.transport.mock.calls.filter(
      ([endpoint, method]) =>
        endpoint === "repos/org/api/issues/1/labels" && method === "POST",
    ),
  ).toHaveLength(1);
  expect(f.names).toEqual(new Set(["orchestration-planning", "unrelated"]));
});
it.each(["observe", "propose", "missing-grant"] as const)(
  "does not mutate workflow labels/comments without configured write authority (%s)",
  async (mode) => {
    const f = await fixture();
    if (mode === "missing-grant")
      f.config.focus.permissions = f.config.focus.permissions.filter(
        (grant) => grant.action !== "publish-item",
      );
    else f.config.focus.mode = mode;
    await expect(
      f
        .workflow()
        .stage(f.planned, "orchestration-planning", "planning", signal()),
    ).rejects.toThrow("write authority");
    await expect(f.workflow().ready(f.planned, signal())).rejects.toThrow(
      "write authority",
    );
    expect(f.transport.mock.calls.every(([, method]) => method === "GET")).toBe(
      true,
    );
    expect(f.names).toEqual(new Set(["orchestration-ready", "unrelated"]));
  },
);
it("returns material review expansion to user approval without granting a wider plan", async () => {
  const f = await fixture();
  await f.workflow().ready(f.planned, signal());
  await f.workflow().reviewEvent(
    f.planned,
    {
      stage: "blocked",
      attempt: 2,
      revision: "a".repeat(40),
      findings: ["APPROVAL_REQUIRED: integration needs another module."],
      reason: "Approved plan/scope expansion requires new user approval",
    },
    signal(),
  );
  expect(f.names.has("orchestration-user-approval")).toBe(true);
  expect(f.queue.get(f.planned.id).proposal.status).toBe("ready");
  expect(f.comments.at(-1)?.body).toContain("requires new user approval");
});
it("reconciles an uncertain comment by exact marker/body/actor without reposting on reopen", async () => {
  const f = await fixture();
  f.uncertain();
  await expect(f.workflow().ready(f.planned, signal())).rejects.toThrow();
  await f.workflow().ready(f.planned, signal());
  expect(f.comments).toHaveLength(1);
  expect(f.names.has("orchestration-user-approval")).toBe(true);
});
it("keeps investigation-only work behind its real scope gate and posts deduplicated review findings", async () => {
  const f = await fixture();
  await f.workflow().ready(f.planned, signal());
  f.config.runtime.planningOverrides = [
    {
      sourceId: "github",
      itemId: "1",
      investigationOnly: true,
      template: {} as never,
    },
  ];
  f.names.add("orchestration-implementation-ready");
  f.events.push({
    id: 101,
    event: "labeled",
    actor: { login: "owner" },
    label: { name: "orchestration-implementation-ready" },
    created_at: "2026-11-11T21:01:00Z",
  });
  await f.workflow().ready(f.planned, signal());
  expect(f.queue.get(f.planned.id).proposal.status).toBe("ready");
  expect(f.comments.at(-1)?.body).toContain("investigation/planning only");
  const event = {
    stage: "reviewing" as const,
    attempt: 1,
    revision: "a".repeat(40),
    findings: ["Handle the empty input; add a regression test."],
  };
  await f.workflow().reviewEvent(f.planned, event, signal());
  const count = f.comments.length;
  await f.workflow().reviewEvent(f.planned, event, signal());
  expect(f.comments).toHaveLength(count);
  expect(f.comments.at(-1)?.body).toContain(event.revision);
});
it("rejects stale configuration/source/plan, altered plan comments, and pre-existing or removed approval", async () => {
  const f = await fixture();
  const publication = {
    proposalId: f.planned.id,
    proposalDigest: f.planned.digest!,
    sourceRevision: f.planned.sourceRevision,
    configurationRevision: f.planned.configurationRevision,
    commentId: 1,
    publishedAt: "2026-11-11T21:00:00Z",
    eventFloor: 100,
    bodyDigest: digest("plan"),
    approver: "owner",
  };
  const event = {
    id: 101,
    event: "labeled",
    actor: { login: "owner" },
    label: { name: "orchestration-implementation-ready" },
    created_at: "2026-11-11T21:01:00Z",
  };
  const input = {
    publication,
    proposal: f.planned,
    publishedBody: "plan",
    labels: ["orchestration-implementation-ready"],
    events: [event],
  };
  expect(attributedWorkflowApproval(input)?.eventId).toBe(101);
  for (const patch of [
    { sourceRevision: "wrong" },
    { proposalDigest: "wrong" },
    { configurationRevision: 7 },
    { eventFloor: 101 },
    { bodyDigest: digest("changed") },
  ])
    expect(
      attributedWorkflowApproval({
        ...input,
        publication: { ...publication, ...patch },
      }),
    ).toBeNull();
  expect(
    attributedWorkflowApproval({
      ...input,
      events: [{ ...event, event: "unlabeled" }],
    }),
  ).toBeNull();
});
