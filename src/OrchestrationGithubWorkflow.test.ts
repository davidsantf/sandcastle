import { expect, it, vi } from "vitest";
import { digest } from "./MultiProjectProtocol.js";
import {
  createGithubWorkflow,
  attributedWorkflowApproval,
  type GithubWorkflowTransport,
} from "./OrchestrationGithubWorkflow.js";
import { orchestrationWorkflowLabels } from "./OrchestrationWorkflowContract.js";
import { defaultWorkspaceConfiguration } from "./OrchestrationWorkspace.js";
import {
  orchestrationDiscoverySourceSchema,
  createOrchestrationDiscoveryAdapter,
} from "./OrchestrationDiscovery.js";
import { createOrchestrationProposalQueue } from "./OrchestrationProposal.js";
import {
  intakeTestStore,
  intakeTestArtifacts,
  intakeTestItem,
} from "./OrchestrationProposal.test.js";
const signal = () => new AbortController().signal;
async function fixture() {
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
  const names = new Set(["orchestration-ready", "unrelated"]);
  const created = new Set<string>();
  const comments: {
    id: number;
    body: string;
    user: { login: string };
    created_at: string;
  }[] = [];
  const events: {
    id: number;
    event: string;
    actor: { login: string };
    label: { name: string };
    created_at: string;
  }[] = [];
  let uncertainComment = false;
  const discoveryTransport = vi.fn(async () => ({
    status: 200,
    body: {
      number: 1,
      html_url: "https://github.com/org/api/issues/1",
      title: "Scoped correction",
      body: "untrusted issue",
      state: "open",
      updated_at: "2026-11-11T20:00:00Z",
      assignees: [{ login: "owner" }],
      labels: [...names].map((name) => ({ name })),
    },
  }));
  const item = await createOrchestrationDiscoveryAdapter(
    source,
    discoveryTransport,
  ).refresh(intakeTestItem(), signal());
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
          });
          if (uncertainComment) {
            uncertainComment = false;
            throw new Error("transport lost after remote commit");
          }
          return comments.at(-1);
        }
      }
      if (method === "DELETE" && endpoint.includes("/labels/")) {
        names.delete(decodeURIComponent(endpoint.split("/labels/")[1]!));
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
    workflow,
    uncertain: () => {
      uncertainComment = true;
    },
  };
}
it("publishes one reviewable exact plan, creates only authorized labels, and approves only an attributed later action", async () => {
  const f = await fixture();
  await f.workflow().ready(f.planned, signal());
  expect(f.comments).toHaveLength(1);
  expect([...f.created].sort()).toEqual(
    [...orchestrationWorkflowLabels].sort(),
  );
  expect(f.names).toEqual(
    new Set([
      "orchestration-ready",
      "unrelated",
      "orchestration-user-approval",
    ]),
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
  f.events.push({ ...f.events[0]!, id: 101, actor: { login: "owner" } });
  await f.workflow().ready(f.planned, signal());
  const approved = f.queue.get(f.planned.id).proposal;
  expect(approved.status).toBe("approved");
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
});
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
