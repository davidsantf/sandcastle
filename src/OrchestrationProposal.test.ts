import { describe, expect, it, vi } from "vitest";
import { digest } from "./MultiProjectProtocol.js";
import {
  createOrchestrationProposalQueue,
  priorProposalExecutionHold,
  OrchestrationProposalBlockedError,
  type OrchestrationIntakeStore,
  type OrchestrationProposalArtifacts,
} from "./OrchestrationProposal.js";
import type { OrchestrationDiscoveredItem } from "./OrchestrationDiscovery.js";

export function intakeTestStore(): OrchestrationIntakeStore {
  const entries = new Map<string, { version: number; value: unknown }>();
  return {
    read: (key) =>
      structuredClone(entries.get(key) ?? { version: 0, value: null }),
    compareAndSwap(key, version, value) {
      if ((entries.get(key)?.version ?? 0) !== version) return false;
      entries.set(key, { version: version + 1, value: structuredClone(value) });
      return true;
    },
  };
}
export const intakeTestItem = (
  revision = "one",
): OrchestrationDiscoveredItem => ({
  sourceId: "github",
  projectId: "api",
  id: "1",
  url: "https://github.com/org/api/issues/1",
  kind: "issue",
  title: "Reproducible failure",
  body: "Hub text does not grant authorization",
  updatedAt: "2026-11-09T08:00:00Z",
  revision: digest(revision),
  feedback: [],
  dependencies: [],
});
export const intakeTestArtifacts: OrchestrationProposalArtifacts = {
  investigation: "Investigated the concrete call path and found evidence.",
  specification:
    "Preserve existing behavior and correct this specific failure.",
  plan: "Change the failing call path and add a focused regression test.",
  acceptance: [
    {
      criterion: "Original failing case is fixed",
      verification: "Run the trusted regression command",
    },
  ],
};
const signal = () => new AbortController().signal;
const setup = () => {
  const store = intakeTestStore();
  const queue = createOrchestrationProposalQueue({
    store,
    namespace: "workspace",
    now: () => 10,
  });
  return { store, queue };
};
it("retains cross-revision unknown holds until proven unstarted without reopening the launch", async () => {
  const { queue } = setup();
  const original = queue.ingest(intakeTestItem(), 1);
  expect(
    (
      await queue.plan(
        original.id,
        async () => {
          throw new Error("transport unknown");
        },
        signal(),
      )
    ).status,
  ).toBe("unknown");
  const current = queue.ingest(intakeTestItem("new"), 2);
  expect(
    priorProposalExecutionHold(
      current,
      queue.list().map((entry) => entry.proposal),
    ),
  ).toBeTruthy();
  queue.settlePlanningOutcome(original.id, digest("host verified no worker"));
  expect(queue.get(original.id).proposal.status).toBe("superseded");
  expect(
    priorProposalExecutionHold(
      current,
      queue.list().map((entry) => entry.proposal),
    ),
  ).toBeUndefined();
  const replay = vi.fn(async () => intakeTestArtifacts);
  expect((await queue.plan(original.id, replay, signal())).status).toBe(
    "superseded",
  );
  expect(replay).not.toHaveBeenCalled();
  expect(() =>
    queue.settlePlanningOutcome(original.id, digest("different")),
  ).toThrow();
});
const approve = async (
  queue: ReturnType<typeof createOrchestrationProposalQueue>,
) => {
  const proposal = queue.ingest(intakeTestItem(), 1);
  const ready = await queue.plan(
    proposal.id,
    async () => intakeTestArtifacts,
    signal(),
  );
  return queue.review({
    proposalId: ready.id,
    proposalDigest: ready.digest!,
    sourceRevision: ready.sourceRevision,
    configurationRevision: 1,
    decision: "approve",
  });
};
describe("durable revision-bound proposal queue", () => {
  it("persists policy authority separately, rejects stale bindings and retains unknown holds through revision changes", async () => {
    const { store, queue } = setup();
    const observed = queue.ingest(intakeTestItem(), 1);
    const ready = await queue.plan(
      observed.id,
      async () => intakeTestArtifacts,
      signal(),
    );
    const decision = {
      proposalId: ready.id,
      proposalDigest: ready.digest!,
      sourceRevision: ready.sourceRevision,
      configurationRevision: 1,
      policyDigest: digest("policy"),
      templateDigest: digest("template"),
    };
    expect(() =>
      queue.decideByPolicy({ ...decision, proposalDigest: digest("other") }),
    ).toThrow("Stale");
    const authorized = queue.decideByPolicy(decision);
    expect(authorized.approval).toBeUndefined();
    expect(authorized.policyDecision?.kind).toBe("bounded-local");
    expect(() => queue.decideByPolicy(decision)).toThrow("Stale");
    const dispatch = vi.fn(async () => {
      throw new Error("Unacknowledged effect");
    });
    await queue.execute(
      { proposalId: ready.id, configurationRevision: 1 },
      {
        authorize: () => true,
        refresh: async () => intakeTestItem(),
        dispatch,
      },
      signal(),
    );
    const reopened = createOrchestrationProposalQueue({
      store,
      namespace: "workspace",
    });
    expect(reopened.get(ready.id).proposal.status).toBe("unknown");
    reopened.ingest(intakeTestItem("next"), 2);
    expect(reopened.get(ready.id).proposal).toMatchObject({
      status: "superseded",
      supersededFrom: "unknown",
      policyDecision: { kind: "bounded-local" },
    });
    await reopened.execute(
      { proposalId: ready.id, configurationRevision: 2 },
      {
        authorize: () => true,
        refresh: async () => intakeTestItem("next"),
        dispatch,
      },
      signal(),
    );
    expect(dispatch).toHaveBeenCalledOnce();
  });
  it("deduplicates replay and resumes retained state after restart", async () => {
    const { store, queue } = setup();
    const approved = await approve(queue);
    const restarted = createOrchestrationProposalQueue({
      store,
      namespace: "workspace",
    });
    expect(restarted.ingest(intakeTestItem(), 1)).toEqual(approved);
    expect(restarted.list()).toHaveLength(1);
  });
  it("executes planner once, retaining substantive artifacts and bound digest", async () => {
    const { queue } = setup();
    const observed = queue.ingest(intakeTestItem(), 1);
    const planner = vi.fn(async () => intakeTestArtifacts);
    const proposal = await queue.plan(observed.id, planner, signal());
    await queue.plan(observed.id, planner, signal());
    expect(planner).toHaveBeenCalledOnce();
    expect(proposal.status).toBe("ready");
    expect(proposal.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(proposal.artifacts).toEqual(intakeTestArtifacts);
  });
  it("supersedes changed revisions and rejects stale review bindings", async () => {
    const { queue } = setup();
    const approved = await approve(queue);
    const next = queue.ingest(intakeTestItem("two"), 1);
    expect(next.id).not.toBe(approved.id);
    expect(queue.get(approved.id).proposal.status).toBe("superseded");
    expect(() =>
      queue.review({
        proposalId: approved.id,
        proposalDigest: approved.digest!,
        sourceRevision: approved.sourceRevision,
        configurationRevision: 1,
        decision: "approve",
      }),
    ).toThrow("Stale");
    expect(queue.ingest(intakeTestItem(), 1).status).toBe("superseded");
    expect(queue.get(next.id).proposal.status).toBe("observed");
  });
  it("rejects a proposal and never dispatches rejected work", async () => {
    const { queue } = setup();
    const initial = queue.ingest(intakeTestItem(), 1);
    const ready = await queue.plan(
      initial.id,
      async () => intakeTestArtifacts,
      signal(),
    );
    queue.review({
      proposalId: ready.id,
      proposalDigest: ready.digest!,
      sourceRevision: ready.sourceRevision,
      configurationRevision: 1,
      decision: "reject",
    });
    const dispatch = vi.fn();
    const result = await queue.execute(
      { proposalId: ready.id, configurationRevision: 1 },
      {
        authorize: () => true,
        refresh: async () => intakeTestItem(),
        dispatch,
      },
      signal(),
    );
    expect(result.status).toBe("rejected");
    expect(dispatch).not.toHaveBeenCalled();
  });
  it("checks current source revision and current policy before dispatch", async () => {
    const { queue } = setup();
    const approved = await approve(queue);
    const dispatch = vi.fn();
    await expect(
      queue.execute(
        { proposalId: approved.id, configurationRevision: 1 },
        {
          authorize: () => false,
          refresh: async () => intakeTestItem(),
          dispatch,
        },
        signal(),
      ),
    ).rejects.toThrow("denied");
    expect(dispatch).not.toHaveBeenCalled();
    const stale = await queue.execute(
      { proposalId: approved.id, configurationRevision: 1 },
      {
        authorize: () => true,
        refresh: async () => intakeTestItem("new"),
        dispatch,
      },
      signal(),
    );
    expect(stale.status).toBe("superseded");
    expect(dispatch).not.toHaveBeenCalled();
  });
  it("binds approval to the configuration revision", async () => {
    const { queue } = setup();
    const approved = await approve(queue);
    const dispatch = vi.fn();
    await expect(
      queue.execute(
        { proposalId: approved.id, configurationRevision: 2 },
        {
          authorize: () => true,
          refresh: async () => intakeTestItem(),
          dispatch,
        },
        signal(),
      ),
    ).rejects.toThrow("Stale");
    expect(dispatch).not.toHaveBeenCalled();
  });
  it("persists dispatch intent before callback and never retries unknown outcomes", async () => {
    const { store, queue } = setup();
    const approved = await approve(queue);
    const dispatch = vi.fn(async () => {
      expect(queue.get(approved.id).proposal.status).toBe("dispatching");
      throw new Error("Remote response lost");
    });
    const controls = {
      authorize: () => true,
      refresh: async () => intakeTestItem(),
      dispatch,
    };
    expect(
      (
        await queue.execute(
          { proposalId: approved.id, configurationRevision: 1 },
          controls,
          signal(),
        )
      ).status,
    ).toBe("unknown");
    const restarted = createOrchestrationProposalQueue({
      store,
      namespace: "workspace",
    });
    await restarted.execute(
      { proposalId: approved.id, configurationRevision: 1 },
      controls,
      signal(),
    );
    expect(dispatch).toHaveBeenCalledOnce();
  });
  it("retains a real dispatch receipt without treating it as publication permission", async () => {
    const { queue } = setup();
    const approved = await approve(queue);
    const result = await queue.execute(
      { proposalId: approved.id, configurationRevision: 1 },
      {
        authorize: () => true,
        refresh: async () => intakeTestItem(),
        dispatch: async () => ({
          receipt: "Canonical executor accepted exact proposal intent",
        }),
      },
      signal(),
    );
    expect(result.status).toBe("dispatched");
    expect(result.dispatchReceipt).toContain("exact proposal");
    expect(result).not.toHaveProperty("publishAuthorized");
  });
  it("does not repeat interrupted planning, or accept invalid artifacts", async () => {
    const { queue } = setup();
    const observed = queue.ingest(intakeTestItem(), 1);
    const planner = vi.fn(async () => {
      throw new Error("Interrupted");
    });
    expect((await queue.plan(observed.id, planner, signal())).status).toBe(
      "unknown",
    );
    await queue.plan(observed.id, planner, signal());
    expect(planner).toHaveBeenCalledOnce();
  });
  it("detects supersession while a planner is running", async () => {
    const { queue } = setup();
    const observed = queue.ingest(intakeTestItem(), 1);
    const result = await queue.plan(
      observed.id,
      async () => {
        queue.ingest(intakeTestItem("two"), 1);
        return intakeTestArtifacts;
      },
      signal(),
    );
    expect(result.status).toBe("superseded");
    expect(result.artifacts).toBeUndefined();
  });
  it("does not downgrade to an older item timestamp", () => {
    const { queue } = setup();
    const observed = queue.ingest(intakeTestItem(), 1);
    queue.ingest(
      { ...intakeTestItem("old"), updatedAt: "2026-11-08T08:00:00Z" },
      1,
    );
    expect(queue.list()).toHaveLength(1);
    expect(queue.get(observed.id).proposal.status).toBe("observed");
  });
  it("retains a known readiness block without claiming an unknown worker outcome", async () => {
    const { queue } = setup();
    const observed = queue.ingest(intakeTestItem(), 1);
    const blocked = await queue.plan(
      observed.id,
      async () => {
        throw new OrchestrationProposalBlockedError(
          "Independent backend identity is unavailable",
        );
      },
      signal(),
    );
    expect(blocked).toMatchObject({
      status: "blocked",
      diagnostic: "Independent backend identity is unavailable",
    });
    expect(queue.get(observed.id).item.revision).toBe(
      intakeTestItem().revision,
    );
  });
  it("never dispatches when current source eligibility cannot be verified", async () => {
    const { queue } = setup(),
      approved = await approve(queue);
    const dispatch = vi.fn();
    const blocked = await queue.execute(
      { proposalId: approved.id, configurationRevision: 1 },
      {
        authorize: () => true,
        refresh: async () => {
          throw new Error("Secret transport response");
        },
        dispatch,
      },
      signal(),
    );
    expect(blocked.status).toBe("blocked");
    expect(blocked.diagnostic).not.toContain("Secret");
    expect(dispatch).not.toHaveBeenCalled();
  });
  it("suppresses duplicate planning and dispatch while a restarted caller observes reservations", async () => {
    const { store, queue } = setup(),
      observed = queue.ingest(intakeTestItem(), 1);
    let releasePlan!: (value: OrchestrationProposalArtifacts) => void;
    const gate = new Promise<OrchestrationProposalArtifacts>((resolve) => {
      releasePlan = resolve;
    });
    const planner = vi.fn(() => gate);
    const first = queue.plan(observed.id, planner, signal());
    const restarted = createOrchestrationProposalQueue({
      store,
      namespace: "workspace",
    });
    expect((await restarted.plan(observed.id, planner, signal())).status).toBe(
      "planning",
    );
    releasePlan(intakeTestArtifacts);
    const ready = await first;
    expect(planner).toHaveBeenCalledOnce();
    queue.review({
      proposalId: ready.id,
      proposalDigest: ready.digest!,
      sourceRevision: ready.sourceRevision,
      configurationRevision: 1,
      decision: "approve",
    });
    let releaseDispatch!: (value: { receipt: string }) => void;
    const dispatchGate = new Promise<{ receipt: string }>((resolve) => {
      releaseDispatch = resolve;
    });
    const dispatch = vi.fn(() => dispatchGate);
    const controls = {
      authorize: () => true,
      refresh: async () => intakeTestItem(),
      dispatch,
    };
    const execution = queue.execute(
      { proposalId: ready.id, configurationRevision: 1 },
      controls,
      signal(),
    );
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce());
    expect(
      (
        await restarted.execute(
          { proposalId: ready.id, configurationRevision: 1 },
          controls,
          signal(),
        )
      ).status,
    ).toBe("dispatching");
    releaseDispatch({ receipt: "Canonical lifecycle accepted exact intent" });
    expect((await execution).status).toBe("dispatched");
    expect(dispatch).toHaveBeenCalledOnce();
  });
});
