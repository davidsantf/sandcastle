import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { recoverDevSquadAdoDesignApproval as recover } from "./DevSquadAdoDesignApproval.js";
import {
  makeDesignGateFixture,
  gateOccurrence as G,
} from "./DevSquadAdoDesignApprovalTestSupport.js";
const hash = (tuple: unknown[]) =>
  createHash("sha256").update(JSON.stringify(tuple)).digest("base64url");
const P = hash(["dg15.proposal.v1", "137", "reviewed"]);
const A = hash(["dg15.manifest.v1", "137", []]);
const D = hash(["dg15.design.v1", "137", P, A]);
const T = hash(["dg15.target.v1", "137", ["none"]]);
const X = hash(["publication-fixture"]);
const E = hash(["decision-fixture"]);
const J = hash(["submission-fixture"]);
const r = `dg15.r.${G}.${P}.${A}.${T}.${J}`;
const p = `dg15.p.${G}.${D}.${X}.${J}`;
const a = `dg15.a.${G}.${D}.${X}.${E}.${J}`;
const c = `dg15.c.${G}.${D}.${X}.${E}.${J}`;
const disposals: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(disposals.splice(0).map((f) => f()));
});
async function fixture(operations: readonly string[]) {
  const f = await makeDesignGateFixture();
  disposals.push(f.dispose);
  const acquired = await f.ledger.acquireClaim({
    workItemId: 137,
    operationId: "host-claim",
    ownerId: "host",
    claimToken: Buffer.alloc(32, 23).toString("base64url"),
    leaseDurationMs: 60000,
  });
  if (!acquired.ok) throw new Error("claim-fixture-failed");
  let record = acquired.value.record;
  for (const operationId of operations) {
    const accepted = await f.ledger.checkpoint({
      workItemId: 137,
      operationId,
      authority: {
        ownerId: acquired.value.outcome.authority.ownerId,
        claimToken: acquired.value.outcome.authority.claimToken,
        fencingValue: acquired.value.outcome.authority.fencingValue,
      },
      expected: {
        revision: record.revision,
        phase: record.phase,
        status: record.status,
      },
      patch: { phase: record.phase, status: record.status },
    });
    if (!accepted.ok) throw new Error("checkpoint-fixture-failed");
    record = accepted.value.record;
  }
  return { ...f, record };
}
describe("W049 canonical history recovery", () => {
  it.each([
    [r, "attempt-consumed"],
    [p, "publication-confirmed"],
    [a, "approved"],
    [c, "changes-requested"],
  ])("recovers durable %s", async (last, state) => {
    const operations = last === r ? [r] : last === p ? [r, p] : [r, p, last!];
    const f = await fixture(operations);
    const checkpoint = vi.spyOn(f.ledger, "checkpoint");
    const result = await recover(f.request, { ledger: f.ledger });
    expect(result).toMatchObject({
      durableState: state,
      binding: {
        workItemId: "137",
        occurrence: G,
        design: D,
        proposal: P,
        manifest: A,
        target: T,
      },
      knownRevision: f.record.revision,
    });
    expect(checkpoint).not.toHaveBeenCalled();
  });
  it("preserves ordinary unrelated checkpoints and other gate occurrences", async () => {
    const other = r.replace(G, hash(["other-occurrence"]));
    const f = await fixture(["ordinary", other]);
    expect((await recover(f.request, { ledger: f.ledger })).durableState).toBe(
      "unreserved",
    );
  });
  it.each([137, "137"])("canonicalizes work item %j", async (workItemId) => {
    const f = await fixture([r]);
    expect(
      (await recover({ ...f.request, workItemId }, { ledger: f.ledger }))
        .durableState,
    ).toBe("attempt-consumed");
  });
  it("keeps leading-zero identity distinct", async () => {
    const f = await fixture([r]);
    expect(
      (
        await recover(
          { ...f.request, workItemId: "0137" },
          { ledger: f.ledger },
        )
      ).durableState,
    ).toBe("unreadable");
  });
  it("recovers exact 226/182/226/226-byte schema-v1 identities", async () => {
    expect([r, p, a, c].map((id) => Buffer.byteLength(id))).toEqual([
      226, 182, 226, 226,
    ]);
    const f = await fixture([r, p, a]);
    expect((await recover(f.request, { ledger: f.ledger })).durableState).toBe(
      "approved",
    );
  });
  it.each([
    [[p]],
    [[a]],
    [[r, a]],
    [[r, p, a, c]],
    [[r, r.replace(J, hash(["different-J"]))]],
    [[r, p, p.replace(J, hash(["different-J"]))]],
    [[r, p.replace(D, P)]],
    [[r, p, a.replace(X, E)]],
    [[r.replace("dg15.r.", "dg15.z.")]],
    [[r + "."]],
    [[r.replace(G, G.slice(0, -1) + "9")]],
    [[r.replace(G, G + "=")]],
    [[r.replace("dg15.", "dg15v2.")]],
    [[r.replace(P, "x".repeat(42))]],
  ])("rejects conflicting or noncanonical history %j", async (operations) => {
    const f = await fixture(operations);
    expect((await recover(f.request, { ledger: f.ledger })).durableState).toBe(
      "unreadable",
    );
  });
  it("rejects a gate checkpoint that changes state", async () => {
    const f = await fixture([r]);
    const record = structuredClone(f.record) as any;
    record.checkpoints[0].resulting.status = "other";
    record.status = "other";
    expect(
      (
        await recover(f.request, {
          ledger: { readRecord: async () => ({ ok: true, value: record }) },
        })
      ).durableState,
    ).toBe("unreadable");
  });
  it("does not treat current execution fields or cursor as design evidence", async () => {
    const f = await fixture([r]);
    const record = {
      ...f.record,
      branch: "unrelated-current-branch",
      observations: {
        ...f.record.observations,
        workItemCommentId: "new-cursor",
      },
    };
    expect(
      await recover(f.request, {
        ledger: { readRecord: async () => ({ ok: true, value: record }) },
      }),
    ).toMatchObject({
      durableState: "attempt-consumed",
      binding: { design: D, target: T },
    });
  });
});
