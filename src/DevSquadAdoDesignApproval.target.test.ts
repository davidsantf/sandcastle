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
  "immutable-source",
  Buffer.alloc(32, 3).toString("base64url"),
  "branch",
  "C:/host/worktree",
  "worktree-id",
  "agent",
  "session",
] as const;
const proof = (f: any, q: any) => ({
  kind: "verified",
  workItemId: q.workItemId,
  occurrence: q.occurrence,
  design: q.design,
  target: q.target,
  challenge: q.challenge,
  descriptor: q.original,
  observedAt: f.now().toISOString(),
  verifierId: "target-verifier",
  immutableEvidenceId: "target-proof",
});
it("W060 approves a bound design with independent descriptive current target proof", async () => {
  const f = await fixture();
  const d = decisionAdapters(f);
  const verifyCurrentTarget = vi.fn(async (q) => proof(f, q));
  const r = await start(
    {
      ...f.request,
      design: { ...f.request.design, target },
      targetVerification: { challenge: "host-challenge", original: target },
    } as any,
    { ...d, verifyCurrentTarget } as any,
  );
  expect(r).toMatchObject({
    durableState: "approved",
    targetHandoff: "verified-current",
  });
  expect(verifyCurrentTarget).toHaveBeenCalledTimes(1);
  expect(r).not.toHaveProperty("resume");
  expect(JSON.stringify(r)).not.toContain("C:/host/worktree");
});
it.each([1, 2, 3, 4, 5, 6, 7, 8, 9])(
  "W060 independently rejects descriptor mismatch at index %i",
  async (index) => {
    const f = await fixture();
    const d = decisionAdapters(f);
    const r = await start(
      {
        ...f.request,
        design: { ...f.request.design, target },
        targetVerification: { challenge: "challenge", original: target },
      } as any,
      {
        ...d,
        verifyCurrentTarget: async (q: any) => {
          const p = proof(f, q);
          const descriptor: any = structuredClone(p.descriptor);
          descriptor[index] =
            index === 1
              ? ["test", "tenant", "other"]
              : index === 4
                ? Buffer.alloc(32, 4).toString("base64url")
                : index === 6
                  ? "C:/other"
                  : "different";
          return { ...p, descriptor };
        },
      } as any,
    );
    expect(r).toMatchObject({
      durableState: "approved",
      targetHandoff: "blocked",
      reason: "target-mismatch",
    });
  },
);
it.each(["missing", "wrong-challenge", "unavailable"])(
  "W060 %s current proof preserves historical approval but blocks handoff",
  async (mode) => {
    const f = await fixture();
    const d = decisionAdapters(f);
    const verifyCurrentTarget =
      mode === "missing"
        ? undefined
        : async (q: any) =>
            mode === "unavailable"
              ? { kind: "unavailable" }
              : { ...proof(f, q), challenge: "wrong" };
    const r = await start(
      {
        ...f.request,
        design: { ...f.request.design, target },
        targetVerification: { challenge: "challenge", original: target },
      } as any,
      { ...d, verifyCurrentTarget } as any,
    );
    expect(r.durableState).toBe("approved");
    expect(r.targetHandoff).toBe("blocked");
  },
);
it("W060 explicit no-target yields not-bound, never current-field historical inference", async () => {
  const f = await fixture();
  const r = await start(
    {
      ...f.request,
      targetVerification: { challenge: "challenge", original: ["none"] },
    } as any,
    decisionAdapters(f) as any,
  );
  expect(r).toMatchObject({
    durableState: "approved",
    targetHandoff: "not-bound",
  });
});
it("W060 read-only recovery verifies original committed target independently", async () => {
  const f = await fixture();
  await start(
    { ...f.request, design: { ...f.request.design, target } } as any,
    decisionAdapters(f) as any,
  );
  const r = await recover(
    {
      ...f.request,
      targetVerification: { challenge: "recovery-challenge", original: target },
    } as any,
    {
      ledger: f.ledger,
      utcNow: () => f.now().getTime(),
      verifyCurrentTarget: async (q: any) => proof(f, q),
    } as any,
  );
  expect(r).toMatchObject({
    durableState: "approved",
    verificationStatus: "evidence-unavailable",
    targetHandoff: "verified-current",
  });
});
