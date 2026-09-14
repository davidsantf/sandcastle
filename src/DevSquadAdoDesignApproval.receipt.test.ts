import { afterEach, expect, it, vi } from "vitest";
import {
  startDevSquadAdoDesignApproval as start,
  reconcileDevSquadAdoDesignApproval as reconcile,
  recoverDevSquadAdoDesignApproval as recover,
} from "./DevSquadAdoDesignApproval.js";
import { makeDesignGateFixture } from "./DevSquadAdoDesignApprovalTestSupport.js";
import type {
  DevSquadAdoDesignEnvelope,
  DevSquadAdoDesignPublicationWitness,
  DevSquadAdoDesignStartRequest,
  DevSquadAdoDesignStartDependencies,
} from "./DevSquadAdoDesignApprovalPublication.js";
const disposals: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(disposals.splice(0).map((f) => f()));
});
async function fixture() {
  const f = await makeDesignGateFixture();
  disposals.push(f.dispose);
  const claim = await f.ledger.acquireClaim({
    workItemId: 137,
    operationId: "host-claim",
    ownerId: "host",
    claimToken: Buffer.alloc(32, 7).toString("base64url"),
    leaseDurationMs: 60000,
  });
  if (!claim.ok) throw new Error("fixture-claim");
  const a = claim.value.outcome.authority;
  const request: DevSquadAdoDesignStartRequest = {
    ...f.request,
    scope: ["test", "tenant", "project"],
    design: { content: "reviewed", artifacts: [], target: ["none"] },
    authority: {
      ownerId: a.ownerId,
      claimToken: a.claimToken,
      fencingValue: a.fencingValue,
    },
  };
  let envelope: DevSquadAdoDesignEnvelope | undefined;
  const publishOnce = vi.fn<DevSquadAdoDesignStartDependencies["publishOnce"]>(
    async (value) => {
      envelope = value;
      return "untrusted-hint";
    },
  );
  const dependencies: DevSquadAdoDesignStartDependencies = {
    ledger: f.ledger,
    publishOnce,
    utcNow: () => f.now().getTime(),
    authorizeMutation: async (request) => ({ kind: "granted", request }),
    verifyDesign: async ({ envelope }) => ({
      kind: "verified",
      workItemId: envelope.workItemId,
      occurrence: envelope.occurrence,
      design: envelope.design,
      target: envelope.target,
      verifierId: "design-verifier",
      immutableEvidenceId: "design-proof",
    }),
  };
  const receipt = (): DevSquadAdoDesignPublicationWitness => {
    if (!envelope) throw new Error("missing-publication");
    return [
      "publication-verifier",
      request.scope,
      "137",
      envelope.occurrence,
      envelope.design,
      envelope.target,
      envelope.envelope,
      "proposal-object",
      "immutable-version",
      "stream",
      "proposal-event",
      5,
      "event-version",
      "immutable-receipt",
    ];
  };
  return { ...f, request, dependencies, publishOnce, receipt };
}
function emptyDecisionPage(f: Awaited<ReturnType<typeof fixture>>) {
  return vi.fn<
    NonNullable<DevSquadAdoDesignStartDependencies["readDecisionPage"]>
  >(async (q) => ({
    kind: "verified",
    page: [
      "page-verifier",
      f.request.scope,
      "137",
      "stream",
      q.anchor,
      "empty-snapshot",
      5,
      q.cursor,
      6,
      5,
      [],
      null,
      true,
      "page-proof",
    ],
  }));
}
// W065-01 / FR-004, FR-019, CC-04: accepted stage revisions must agree with recovery.
it.each([false, true])(
  "W065-01 start projects publication revision (certified empty page=%s)",
  async (emptyPage) => {
    const f = await fixture();
    const verifyPublication = vi.fn<
      NonNullable<DevSquadAdoDesignStartDependencies["verifyPublication"]>
    >(async () => ({ kind: "verified", witness: f.receipt() }));
    const readDecisionPage = emptyDecisionPage(f);
    const result = await start(f.request, {
      ...f.dependencies,
      verifyPublication,
      ...(emptyPage ? { readDecisionPage } : {}),
    });
    expect(result).toMatchObject({
      durableState: "publication-confirmed",
      verificationStatus: "decision-pending",
      reason: emptyPage ? "no-eligible-decision" : "decision-prefix-incomplete",
      knownRevision: 4,
      checkpointRevisions: { reservation: 3, publication: 4, resolution: null },
    });
    const recovered = await recover(f.request, f.dependencies);
    expect(recovered).toMatchObject({
      durableState: result.durableState,
      knownRevision: result.knownRevision,
      checkpointRevisions: result.checkpointRevisions,
    });
    expect(f.publishOnce).toHaveBeenCalledTimes(1);
    expect(verifyPublication).toHaveBeenCalledTimes(1);
    expect(readDecisionPage).toHaveBeenCalledTimes(emptyPage ? 1 : 0);
    expect(await f.ledger.readRecord(137)).toMatchObject({
      ok: true,
      value: { revision: 4, checkpoints: [{ revision: 3 }, { revision: 4 }] },
    });
  },
);
it.each([false, true])(
  "W065-01 late receipt reconcile projects publication revision (certified empty page=%s)",
  async (emptyPage) => {
    const f = await fixture();
    await start(f.request, f.dependencies);
    const readDecisionPage = emptyDecisionPage(f);
    const result = await reconcile(f.request, {
      ...f.dependencies,
      verifyPublication: async () => ({
        kind: "verified",
        witness: f.receipt(),
      }),
      ...(emptyPage ? { readDecisionPage } : {}),
    });
    expect(result).toMatchObject({
      durableState: "publication-confirmed",
      verificationStatus: "decision-pending",
      reason: emptyPage ? "no-eligible-decision" : "decision-prefix-incomplete",
      knownRevision: 4,
      checkpointRevisions: { reservation: 3, publication: 4, resolution: null },
    });
    const recovered = await recover(f.request, f.dependencies);
    expect(recovered).toMatchObject({
      durableState: result.durableState,
      knownRevision: result.knownRevision,
      checkpointRevisions: result.checkpointRevisions,
    });
    expect(f.publishOnce).toHaveBeenCalledTimes(1);
    expect(readDecisionPage).toHaveBeenCalledTimes(emptyPage ? 1 : 0);
    expect(await f.ledger.readRecord(137)).toMatchObject({
      ok: true,
      value: { revision: 4, checkpoints: [{ revision: 3 }, { revision: 4 }] },
    });
  },
);
it.each([
  "wrong-work-item",
  "wrong-design",
  "wrong-target",
  "wrong-content",
  "wrong-scope",
  "missing-version",
  "bare-id",
  "echo",
  "ambiguous",
])("W051 blocks %s receipt", async (mode) => {
  const f = await fixture();
  await start(f.request, f.dependencies);
  const witness = structuredClone(f.receipt()) as any;
  if (mode === "wrong-work-item") witness[2] = "138";
  if (mode === "wrong-design") witness[4] = witness[3];
  if (mode === "wrong-target") witness[5] = witness[3];
  if (mode === "wrong-content") witness[6] = witness[3];
  if (mode === "wrong-scope") witness[1] = ["test", "tenant", "other"];
  if (mode === "missing-version") witness[8] = null;
  const verifyPublication: any = async () =>
    mode === "ambiguous"
      ? { kind: "ambiguous" }
      : mode === "bare-id"
        ? "proposal-object"
        : mode === "echo"
          ? { ok: true, commentId: "proposal-object" }
          : { kind: "verified", witness };
  const result = await reconcile(f.request, {
    ...f.dependencies,
    verifyPublication,
  });
  expect(result.durableState).toBe("attempt-consumed");
  expect(f.publishOnce).toHaveBeenCalledTimes(1);
  expect(await f.ledger.readRecord(137)).toMatchObject({
    ok: true,
    value: { revision: 3 },
  });
});
it("W051 recovers a durable publication after an unconfirmed write response", async () => {
  const f = await fixture();
  await start(f.request, f.dependencies);
  const checkpoint = async (request: any) => {
    await f.ledger.checkpoint(request);
    throw new Error("SECRET-RECEIPT");
  };
  const result = await reconcile(f.request, {
    ...f.dependencies,
    ledger: { readRecord: f.ledger.readRecord, checkpoint },
    verifyPublication: async () => ({ kind: "verified", witness: f.receipt() }),
  });
  expect(result.verificationStatus).toBe("mutation-unconfirmed");
  expect(JSON.stringify(result)).not.toContain("SECRET-RECEIPT");
  expect((await recover(f.request, f.dependencies)).durableState).toBe(
    "publication-confirmed",
  );
  expect(f.publishOnce).toHaveBeenCalledTimes(1);
});
it("W051 reconcile cannot reserve a new occurrence", async () => {
  const f = await fixture();
  const checkpoint = vi.spyOn(f.ledger, "checkpoint");
  expect((await reconcile(f.request, f.dependencies)).durableState).toBe(
    "unreserved",
  );
  expect(checkpoint).not.toHaveBeenCalled();
  expect(f.publishOnce).not.toHaveBeenCalled();
});
