import { afterEach, expect, it } from "vitest";
import {
  startDevSquadAdoDesignApproval as start,
  reconcileDevSquadAdoDesignApproval as reconcile,
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
it("W054 reports exact CAS conflict without rebasing or publishing", async () => {
  const f = await fixture();
  let calls = 0;
  const authorizeMutation = async (q: any) => {
    await f.ledger.checkpoint({
      workItemId: 137,
      operationId: "host-cursor",
      authority: f.request.authority!,
      expected: q.expected,
      patch: { observations: { workItemCommentId: "cursor" } },
    });
    return { kind: "granted", request: q };
  };
  const checkpoint = async (q: any) => {
    calls++;
    return f.ledger.checkpoint(q);
  };
  const r = await start(f.request, {
    ...f.dependencies,
    authorizeMutation,
    ledger: { readRecord: f.ledger.readRecord, checkpoint },
  } as any);
  expect(r.reason).toBe("revision-conflict");
  expect(calls).toBe(1);
  expect(f.publishOnce).not.toHaveBeenCalled();
});
it.each([false, true])(
  "W054 concurrent reservations share one slot (different=%s)",
  async (different) => {
    const f = await fixture();
    await Promise.all([
      start(f.request, f.dependencies),
      start(
        {
          ...f.request,
          design: {
            ...f.request.design,
            content: different ? "different" : f.request.design.content,
          },
        },
        f.dependencies,
      ),
    ]);
    expect(f.publishOnce).toHaveBeenCalledTimes(1);
    const r = await f.ledger.readRecord(137);
    if (!r.ok) throw Error("read");
    expect(r.value.checkpoints).toHaveLength(1);
  },
);
it("W054 concurrent opposing resolutions cannot replace durable winner", async () => {
  const f = await fixture();
  const d = decisionAdapters(f);
  await start(f.request, { ...d, readDecisionPage: undefined } as any);
  const other = decisionAdapters(f);
  const page = other.readDecisionPage.getMockImplementation()!;
  other.readDecisionPage.mockImplementation(async (q) => {
    const r = await page(q);
    r.page[10][0][12] = r.page[10][0][12].replace(
      "approve-design",
      "request-changes",
    );
    return r;
  });
  await Promise.all([
    reconcile(f.request, d as any),
    reconcile(f.request, other as any),
  ]);
  const r = await f.ledger.readRecord(137);
  if (!r.ok) throw Error("read");
  expect(
    r.value.checkpoints.filter((c) => /^dg15\.[ac]\./.test(c.operationId)),
  ).toHaveLength(1);
  expect(f.publishOnce).toHaveBeenCalledTimes(1);
});
it.each([
  "method",
  "revision",
  "timestamp",
  "outcome",
  "prior-history",
  "branch",
  "cursor",
  "claim",
  "mutated-request",
])("W054 rejects %s resolution acknowledgement", async (mode) => {
  const f = await fixture();
  const d = decisionAdapters(f);
  const checkpoint = async (q: any) => {
    if (!/^dg15\.[ac]\./.test(q.operationId)) return f.ledger.checkpoint(q);
    if (mode === "mutated-request") q.patch.phase = "changed";
    const raw = await f.ledger.checkpoint(q);
    if (!raw.ok) return raw;
    const r: any = structuredClone(raw);
    if (mode === "method") r.value.outcome.kind = "renewed";
    if (mode === "revision") r.value.record.revision++;
    if (mode === "timestamp") r.value.acceptedAt = "2026-09-11T12:00:01.000Z";
    if (mode === "outcome")
      r.value.outcome.checkpoint.operationId = "different";
    if (mode === "prior-history") r.value.record.checkpoints.shift();
    if (mode === "branch") r.value.record.branch = "different";
    if (mode === "cursor")
      r.value.record.observations.workItemCommentId = "different";
    if (mode === "claim") r.value.record.activeClaim.ownerId = "different";
    return r;
  };
  expect(
    await start(f.request, {
      ...d,
      ledger: { readRecord: f.ledger.readRecord, checkpoint },
    } as any),
  ).toMatchObject({
    durableState: "publication-confirmed",
    verificationStatus: "mutation-unconfirmed",
  });
});
it("W054 nonsecret J does not authorize changed capability exact replay", async () => {
  const f = await fixture();
  let original: any;
  await start(f.request, {
    ...f.dependencies,
    ledger: {
      readRecord: f.ledger.readRecord,
      checkpoint: async (q) => {
        original = structuredClone(q);
        return f.ledger.checkpoint(q);
      },
    },
  });
  const r = await f.ledger.checkpoint({
    ...original,
    authority: {
      ...original.authority,
      claimToken: Buffer.alloc(32, 9).toString("base64url"),
    },
  });
  expect(r).toMatchObject({
    ok: false,
    error: { kind: "idempotency-conflict" },
  });
  expect((await recover(f.request, f.dependencies)).durableState).toBe(
    "attempt-consumed",
  );
  expect(f.publishOnce).toHaveBeenCalledTimes(1);
});
