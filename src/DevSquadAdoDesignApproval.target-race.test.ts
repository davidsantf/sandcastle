import { afterEach, expect, it, vi } from "vitest";
import {
  startDevSquadAdoDesignApproval as start,
  recoverDevSquadAdoDesignApproval as recover,
} from "./DevSquadAdoDesignApproval.js";
import {
  makeDecisionFixture,
  decisionAdapters,
} from "./DevSquadAdoDesignApprovalTestSupport.js";
const clean: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(clean.splice(0).map((f) => f()));
});
async function fixture() {
  const f = await makeDecisionFixture();
  clean.push(f.dispose);
  return f;
}
const target = [
  "bound",
  ["test", "tenant", "project"],
  "repo",
  "source",
  Buffer.alloc(32, 5).toString("base64url"),
  "branch",
  "C:/host/worktree",
  "worktree",
  "agent",
  "session",
] as const;
const request = (f: any) => ({
  ...f.request,
  design: { ...f.request.design, target },
  targetVerification: { challenge: "request-challenge", original: target },
});
const proof = (f: any, q: any, age = 0) => ({
  ...q,
  kind: "verified",
  descriptor: q.original,
  observedAt: new Date(f.now().getTime() - age).toISOString(),
  verifierId: "verifier",
  immutableEvidenceId: "proof",
});
it("W061 cancellation during final authority-clock observation cannot upgrade handoff", async () => {
  const f = await fixture();
  const controller = new AbortController();
  let final = false;
  const r = await start({ ...request(f), signal: controller.signal }, {
    ...decisionAdapters(f),
    verifyCurrentTarget: async (q: any) => ({
      ...proof(f, q),
      get descriptor() {
        final = true;
        return q.original;
      },
    }),
    utcNow: () => {
      if (final) controller.abort();
      return f.now().getTime();
    },
  } as any);
  expect(r).toMatchObject({
    durableState: "approved",
    targetHandoff: "blocked",
    reason: "cancelled",
  });
});
it.each([5000, 5001])(
  "W061 proof age %i milliseconds is enforced at return",
  async (age) => {
    const f = await fixture();
    const r = await start(request(f), {
      ...decisionAdapters(f),
      monotonicNow: () => 0,
      verifyCurrentTarget: async (q: any) => proof(f, q, age),
    } as any);
    expect(r.durableState).toBe("approved");
    expect(r.targetHandoff).toBe(age === 5000 ? "verified-current" : "blocked");
  },
);
it("W061 retired whole deadline during final clock cannot upgrade handoff", async () => {
  const f = await fixture();
  let mono = 0,
    final = false;
  const r = await start(request(f), {
    ...decisionAdapters(f),
    monotonicNow: () => mono,
    verifyCurrentTarget: async (q: any) => ({
      ...proof(f, q),
      get descriptor() {
        final = true;
        return q.original;
      },
    }),
    utcNow: () => {
      if (final) mono = 180000;
      return f.now().getTime();
    },
  } as any);
  expect(r).toMatchObject({
    durableState: "approved",
    targetHandoff: "blocked",
    reason: "dependency-timeout",
  });
});
it("W061 late current proof cannot change completed result", async () => {
  const f = await fixture();
  let entered!: () => void;
  const ready = new Promise<void>((r) => (entered = r));
  let settle!: (v: any) => void;
  let saved: any;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const pending = start(request(f), {
    ...decisionAdapters(f),
    verifyCurrentTarget: async (q: any) => {
      saved = proof(f, q);
      entered();
      return new Promise((r) => (settle = r));
    },
  } as any);
  await ready;
  await vi.advanceTimersByTimeAsync(5000);
  const r = await pending;
  expect(r).toMatchObject({
    durableState: "approved",
    targetHandoff: "blocked",
    reason: "dependency-timeout",
  });
  settle(saved);
  await Promise.resolve();
  expect(r.targetHandoff).toBe("blocked");
});
it("W061 cursor-only advancement after approval does not invalidate independent target", async () => {
  const f = await fixture();
  const r = await start(request(f), {
    ...decisionAdapters(f),
    verifyCurrentTarget: async (q: any) => {
      const read = await f.ledger.readRecord(137);
      if (!read.ok) throw Error("read");
      await f.ledger.checkpoint({
        workItemId: 137,
        operationId: "host-observation",
        authority: f.request.authority!,
        expected: {
          revision: read.value.revision,
          phase: read.value.phase,
          status: read.value.status,
        },
        patch: { observations: { workItemCommentId: "new-cursor" } },
      });
      return proof(f, q);
    },
  } as any);
  expect(r).toMatchObject({
    durableState: "approved",
    targetHandoff: "verified-current",
  });
  expect((await recover(f.request, f.dependencies)).durableState).toBe(
    "approved",
  );
});

// W065 SKEP02 / FR-022 / SEC-007: advance clocks during actual proof validation,
// not inside an isolated age helper. Wall age and elapsed must be charged once.
it.each([
  [
    "coupled clocks, age 4960",
    60,
    60,
    "verified-current",
    "human-decision-confirmed",
  ],
  [
    "coupled clocks, inclusive age 5000",
    100,
    100,
    "verified-current",
    "human-decision-confirmed",
  ],
  [
    "coupled clocks, stale age 5001",
    101,
    101,
    "blocked",
    "target-proof-unavailable",
  ],
  [
    "frozen UTC, age 4960",
    0,
    60,
    "verified-current",
    "human-decision-confirmed",
  ],
  [
    "frozen UTC, inclusive age 5000",
    0,
    100,
    "verified-current",
    "human-decision-confirmed",
  ],
  ["frozen UTC, stale age 5001", 0, 101, "blocked", "target-proof-unavailable"],
  [
    "UTC forward beyond five seconds",
    101,
    60,
    "blocked",
    "target-proof-unavailable",
  ],
  [
    "UTC rollback cannot conceal stale elapsed age",
    -1,
    101,
    "blocked",
    "target-proof-unavailable",
  ],
  ["monotonic rollback", 60, -1, "blocked", "invalid-input"],
] as const)(
  "SKEP02 %s at final target handoff",
  async (_name, wallAdvance, monoAdvance, handoff, reason) => {
    const f = await fixture();
    let wall = 0;
    let mono = 0;
    let observations = 0;
    const r = await start(request(f), {
      ...decisionAdapters(f),
      monotonicNow: () => mono,
      utcNow: () => f.now().getTime() + wall,
      verifyCurrentTarget: async (q: any) => ({
        ...proof(f, q, 4900),
        get descriptor() {
          observations++;
          wall += wallAdvance;
          mono += monoAdvance;
          return q.original;
        },
      }),
    } as Parameters<typeof start>[1]);
    expect(observations).toBe(1);
    expect(r).toMatchObject({
      durableState: "approved",
      targetHandoff: handoff,
      reason,
      knownRevision: 5,
      checkpointRevisions: { reservation: 3, publication: 4, resolution: 5 },
    });
    expect(f.publishOnce).toHaveBeenCalledTimes(1);
    expect((await recover(f.request, f.dependencies)).durableState).toBe(
      "approved",
    );
  },
);
it.each(["future", "noncanonical", "invalid-UTC"] as const)(
  "SKEP02 rejects %s target time independently of identity",
  async (mode) => {
    const f = await fixture();
    let targetStage = false;
    const r = await start(request(f), {
      ...decisionAdapters(f),
      monotonicNow: () => 0,
      utcNow: () =>
        targetStage && mode === "invalid-UTC" ? NaN : f.now().getTime(),
      verifyCurrentTarget: async (q: any) => {
        targetStage = true;
        return {
          ...proof(f, q),
          observedAt:
            mode === "future"
              ? new Date(f.now().getTime() + 1).toISOString()
              : mode === "noncanonical"
                ? "2026-09-11T12:00:00Z"
                : f.now().toISOString(),
        };
      },
    } as Parameters<typeof start>[1]);
    expect(r).toMatchObject({
      durableState: "approved",
      targetHandoff: "blocked",
      reason: "target-proof-unavailable",
    });
  },
);
