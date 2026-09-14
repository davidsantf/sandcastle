import { afterEach, expect, it, vi } from "vitest";
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
// Defensive contradictory-adapter CAS coverage, not the shared-stream CC-12 scenario.
it("W054 defensive opposing resolutions cannot replace durable winner", async () => {
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
// W065-02 / CC-12, FR-015/016, INV-004, SEC-004: shared ordered evidence at one CAS revision.
it("W065-02 same-stream contenders preserve the earlier approval through replay", async () => {
  const f = await fixture();
  const initial = decisionAdapters(f);
  await start(f.request, { ...initial, readDecisionPage: undefined } as any);
  const envelope = f.publishOnce.mock.calls[0]![0];
  const bodies = [
    `/devsquad approve-design ${envelope.occurrence} ${envelope.design}`,
    `/devsquad request-changes ${envelope.occurrence} ${envelope.design}`,
  ];
  const first = decisionAdapters(f, bodies);
  const second = decisionAdapters(f, bodies);
  const w = f.receipt();
  // Both coordinators receive copies of exactly this complete immutable snapshot.
  const shared = await first.readDecisionPage({
    envelope,
    anchor: [w[9], w[10], w[11], w[12]],
    cursor: null,
    snapshot: null,
    limit: 16,
  });
  expect(shared.page[10].map((event: any[]) => [event[1], event[12]])).toEqual([
    [6, bodies[0]],
    [7, bodies[1]],
  ]);
  expect(shared.page.slice(11, 13)).toEqual([null, true]);
  const readers = [
    vi.fn(async () => structuredClone(shared)),
    vi.fn(async () => structuredClone(shared)),
  ];
  type CheckpointInput = Parameters<typeof f.ledger.checkpoint>[0];
  const arrivals: CheckpointInput[] = [];
  let release!: () => void;
  const bothAtBoundary = new Promise<void>((resolve) => {
    release = resolve;
  });
  const checkpoint: typeof f.ledger.checkpoint = async (q) => {
    if (!/^dg15\.[ac]\./.test(q.operationId)) return f.ledger.checkpoint(q);
    arrivals.push(structuredClone(q));
    if (arrivals.length === 2) release();
    // Neither real resolution CAS starts until both have submitted their original revision.
    await bothAtBoundary;
    return f.ledger.checkpoint(q);
  };
  const coordinators = [first, second].map((adapter, i) => ({
    ...adapter,
    readDecisionPage: readers[i]!,
    ledger: { readRecord: f.ledger.readRecord, checkpoint },
  }));
  const results = await Promise.all(
    coordinators.map((d) => reconcile(f.request, d as any)),
  );
  expect(arrivals).toHaveLength(2);
  expect(arrivals.map((q) => q.expected?.revision)).toEqual([4, 4]);
  expect(arrivals[0]!.operationId).toMatch(/^dg15\.a\./);
  expect(arrivals[1]!.operationId).toBe(arrivals[0]!.operationId);
  expect(results.some((r) => r.durableState === "approved")).toBe(true);
  for (const adapter of [first, second]) {
    expect(adapter.authorizeHumanDecision).toHaveBeenCalledTimes(1);
    expect(adapter.authorizeHumanDecision.mock.calls[0]![0]).toMatchObject({
      action: "approve-design",
      event: shared.page[10][0],
    });
  }
  for (const reader of readers) expect(reader).toHaveBeenCalledTimes(1);
  const durable = await f.ledger.readRecord(137);
  if (!durable.ok) throw Error("read");
  expect(durable.value.revision).toBe(5);
  const resolutions = durable.value.checkpoints.filter((c) =>
    /^dg15\.[ac]\./.test(c.operationId),
  );
  expect(resolutions).toHaveLength(1);
  expect(resolutions[0]).toMatchObject({
    operationId: arrivals[0]!.operationId,
    revision: 5,
  });
  const expected = {
    durableState: "approved",
    knownRevision: 5,
    checkpointRevisions: { reservation: 3, publication: 4, resolution: 5 },
  };
  expect(await recover(f.request, f.dependencies)).toMatchObject(expected);
  for (const d of coordinators)
    expect(await reconcile(f.request, d as any)).toMatchObject(expected);
  expect(await recover(f.request, f.dependencies)).toMatchObject(expected);
  expect(await f.ledger.readRecord(137)).toEqual(durable);
  expect(arrivals).toHaveLength(2);
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
