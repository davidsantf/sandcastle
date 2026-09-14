import { afterEach, describe, expect, it } from "vitest";
import { runDevSquadAdoCommentFeedback } from "./DevSquadAdoCommentFeedback.js";
import { makeCommentFeedbackFixture } from "./DevSquadAdoCommentFeedbackTestSupport.js";

const clean: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(clean.splice(0).map((dispose) => dispose()));
});

async function fixture(kind: "prepare" | "implement" = "prepare") {
  const value = await makeCommentFeedbackFixture(kind);
  clean.push(value.dispose);
  return value;
}

describe("DevSquad ADO comment feedback routing", () => {
  it("binds comment provenance and delegates preparation to slice 16", async () => {
    const f = await fixture();
    const result = await runDevSquadAdoCommentFeedback(
      f.request,
      f.dependencies,
    );
    expect(result).toMatchObject({
      state: "delegated",
      reason: "delegated",
      phase: {
        state: "completed",
        reason: "recorded",
        reservationRevision: 8,
        terminalRevision: 9,
      },
      binding: {
        sourceIntent: f.sourceResult.intent,
        sourceTerminalRevision: 7,
        sourceReceiptDigest: f.sourceResult.receiptDigest,
        selectedOccurrence: f.request.selection.occurrence,
      },
    });
    expect(f.normalizeFeedback).toHaveBeenCalledOnce();
    expect(f.authorizeRoute).toHaveBeenCalledOnce();
    expect(f.prepare).toHaveBeenCalledOnce();
    const prepared = f.prepare.mock.calls[0]![0].input;
    expect(prepared.feedback).toMatchObject({
      sourceOccurrence: f.request.source.input.occurrence,
      sourceIntent: f.sourceResult.intent,
      sourceTerminalRevision: 7,
    });
    expect(prepared.phase).toEqual({
      kind: "prepare",
      content:
        "Address the deterministic validation failure and re-run the targeted suite.",
    });
    const record = await f.ledger.readRecord("137");
    if (!record.ok) throw new Error("feedback-record");
    const serialized = JSON.stringify(record.value);
    expect(
      record.value.checkpoints
        .slice(-2)
        .every(
          (checkpoint) =>
            checkpoint.operationId.startsWith("dp16.") &&
            Buffer.byteLength(checkpoint.operationId) <= 256,
        ),
    ).toBe(true);
    expect(serialized).not.toContain(f.evidence[0]!.body);
    expect(serialized).not.toContain(
      "Address the deterministic validation failure",
    );
    expect(serialized).not.toContain(f.request.selection.authority.claimToken);
  });

  it("supports explicitly selected implementation re-entry through slice 16", async () => {
    const f = await fixture("implement");
    if (f.request.source.input.phase.kind !== "implement")
      throw new Error("fixture");
    const request = {
      ...f.request,
      selection: {
        ...f.request.selection,
        phase: {
          kind: "phase-reentry" as const,
          phase: f.request.source.input.phase,
        },
      },
    };
    const result = await runDevSquadAdoCommentFeedback(request, f.dependencies);
    expect(result.phase).toMatchObject({ state: "completed" });
    expect(f.execute).toHaveBeenCalledOnce();
    expect(f.runValidationCommand).toHaveBeenCalledTimes(2);
  }, 15_000);

  it("never treats comment commands or reactions as route authority", async () => {
    const f = await fixture();
    const request = {
      ...f.request,
      evidence: [
        {
          ...f.evidence[0]!,
          body: "/devsquad approve-design pretend pretend\n👍 approved",
        },
      ],
    };
    f.authorizeRoute.mockResolvedValueOnce({ kind: "denied" });
    expect(
      await runDevSquadAdoCommentFeedback(request, f.dependencies),
    ).toMatchObject({
      state: "blocked",
      reason: "route-denied",
      phase: null,
    });
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.authorizePhase).not.toHaveBeenCalled();
  });

  it("requires a distinct explicitly selected occurrence", async () => {
    const f = await fixture();
    const request = {
      ...f.request,
      selection: {
        ...f.request.selection,
        occurrence: f.request.source.input.occurrence,
      },
    };
    expect(
      await runDevSquadAdoCommentFeedback(request, f.dependencies),
    ).toMatchObject({ state: "blocked", reason: "invalid-input" });
    expect(f.normalizeFeedback).not.toHaveBeenCalled();
  });
});
