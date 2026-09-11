import { afterEach, describe, expect, it, vi } from "vitest";
import { recoverDevSquadAdoDesignApproval as recover } from "./DevSquadAdoDesignApproval.js";
import { makeDesignGateFixture } from "./DevSquadAdoDesignApprovalTestSupport.js";
const disposals: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(disposals.splice(0).map((dispose) => dispose()));
});
async function fixture() {
  const f = await makeDesignGateFixture();
  disposals.push(f.dispose);
  return f;
}

describe("W048 read-only design recovery, CC-14", () => {
  it("recovers an unreserved seeded public ledger with zero writes or other effects", async () => {
    const f = await fixture();
    const spies = [
      "checkpoint",
      "acquireClaim",
      "renewClaim",
      "releaseClaim",
    ].map((method) => vi.spyOn(f.ledger, method as "checkpoint"));
    const publisher = vi.fn();
    const execute = vi.fn();
    const tracker = vi.fn();
    const dependencies = { ledger: f.ledger, publisher, execute, tracker };
    expect(await recover(f.request, dependencies)).toEqual({
      durableState: "unreserved",
      verificationStatus: "verified",
      targetHandoff: "not-requested",
      reason: "unreserved",
      binding: { workItemId: "137", occurrence: f.request.occurrence },
      knownRevision: 1,
    });
    for (const spy of [...spies, publisher, execute, tracker])
      expect(spy).not.toHaveBeenCalled();
    expect(await f.ledger.readRecord(137)).toEqual({
      ok: true,
      value: f.record,
    });
  });
  it.each([
    "wrong-work-item",
    "missing-history",
    "too-many-checkpoints",
    "invalid-timestamp",
    "missing-agent",
    "secret-error",
    "gate-history",
  ])("fails closed on %s", async (kind) => {
    const f = await fixture();
    const record = structuredClone(f.record) as any;
    if (kind === "wrong-work-item") record.workItemId = "138";
    if (kind === "missing-history") delete record.checkpoints;
    if (kind === "too-many-checkpoints") record.checkpoints = Array(10001);
    if (kind === "invalid-timestamp") record.createdAt = "invalid";
    if (kind === "missing-agent") delete record.agent;
    if (kind === "gate-history") {
      record.revision = 2;
      record.checkpoints = [
        {
          revision: 2,
          operationId: "dg15.unknown",
          acceptedAt: record.updatedAt,
          previous: { phase: record.phase, status: record.status },
          resulting: { phase: record.phase, status: record.status },
        },
      ];
    }
    const readRecord = vi.fn(async () => {
      if (kind === "secret-error") throw new Error("PRIVATE-BODY-TOKEN");
      return { ok: true as const, value: record };
    });
    const result = await recover(f.request, { ledger: { readRecord } });
    expect(result.durableState).toBe("unreadable");
    expect(JSON.stringify(result)).not.toContain("PRIVATE-BODY-TOKEN");
  });
  it("rejects pre-aborted requests without invoking the ledger", async () => {
    const f = await fixture();
    const controller = new AbortController();
    controller.abort();
    const readRecord = vi.fn(f.ledger.readRecord);
    expect(
      (
        await recover(
          { ...f.request, signal: controller.signal },
          { ledger: { readRecord } },
        )
      ).reason,
    ).toBe("cancelled");
    expect(readRecord).not.toHaveBeenCalled();
  });
  it.each(["x".repeat(121), "\ud800", "../137"])(
    "rejects invalid bounded work item %j before reads",
    async (workItemId) => {
      const f = await fixture();
      const readRecord = vi.fn(f.ledger.readRecord);
      expect(
        (
          await recover(
            { ...f.request, workItemId },
            { ledger: { readRecord } },
          )
        ).durableState,
      ).toBe("unreadable");
      expect(readRecord).not.toHaveBeenCalled();
    },
  );
  it("rejects noncallable dependencies without exposing arbitrary data", async () => {
    const f = await fixture();
    expect(
      (
        await recover(f.request, {
          ledger: { readRecord: "PRIVATE-BODY-TOKEN" },
        } as any)
      ).reason,
    ).toBe("invalid-input");
  });
});
