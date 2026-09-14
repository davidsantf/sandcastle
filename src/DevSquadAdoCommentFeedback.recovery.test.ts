import { afterEach, describe, expect, it } from "vitest";
import {
  recoverDevSquadAdoCommentFeedback,
  runDevSquadAdoCommentFeedback,
} from "./DevSquadAdoCommentFeedback.js";
import {
  feedbackOccurrence,
  makeCommentFeedbackFixture,
} from "./DevSquadAdoCommentFeedbackTestSupport.js";

const clean: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(clean.splice(0).map((dispose) => dispose()));
});
async function fixture() {
  const value = await makeCommentFeedbackFixture();
  clean.push(value.dispose);
  return value;
}

describe("DevSquad ADO comment feedback recovery and concurrency", () => {
  it("does not repeat a completed selected occurrence", async () => {
    const f = await fixture();
    const first = await runDevSquadAdoCommentFeedback(
      f.request,
      f.dependencies,
    );
    const second = await runDevSquadAdoCommentFeedback(
      f.request,
      f.dependencies,
    );
    expect(second.phase).toEqual(first.phase);
    expect(f.prepare).toHaveBeenCalledOnce();
    expect(f.verifyTerminalReceipt).toHaveBeenCalledTimes(3);
  });

  it("replays reconstructed evidence independently of property insertion order", async () => {
    const f = await fixture();
    const first = await runDevSquadAdoCommentFeedback(
      f.request,
      f.dependencies,
    );
    const evidence = f.request.evidence.map((item) => ({
      body: item.body,
      immutableEvidenceId: item.immutableEvidenceId,
      observedAt: item.observedAt,
      ordinal: item.ordinal,
      eventVersion: item.eventVersion,
      eventId: item.eventId,
      containerId: item.containerId,
      provider: item.provider,
      kind: item.kind,
    }));
    const second = await runDevSquadAdoCommentFeedback(
      { ...f.request, evidence },
      f.dependencies,
    );
    expect(second.phase).toEqual(first.phase);
    expect(f.prepare).toHaveBeenCalledOnce();
  });

  it("recovers exact bound source and selected receipts without normalization", async () => {
    const f = await fixture();
    const run = await runDevSquadAdoCommentFeedback(f.request, f.dependencies);
    const selectedPhase = f.authorizeRoute.mock.calls[0]![0].selectedPhase;
    const recovered = await recoverDevSquadAdoCommentFeedback(
      {
        workItemId: f.request.workItemId,
        source: f.request.source,
        selectedPhase,
      },
      {
        phase: {
          ledger: f.ledger,
          verifyTerminalReceipt: f.verifyTerminalReceipt,
          utcNow: f.dependencies.utcNow,
        },
      },
    );
    expect(recovered).toEqual(run);
    expect(f.normalizeFeedback).toHaveBeenCalledOnce();
    expect(f.authorizeRoute).toHaveBeenCalledOnce();
  });

  it("records and recovers a settled feedback preparation failure", async () => {
    const f = await fixture();
    f.prepare.mockResolvedValueOnce({
      kind: "failed",
      artifactDigest: Buffer.alloc(32, 26).toString("base64url"),
    });
    const run = await runDevSquadAdoCommentFeedback(f.request, f.dependencies);
    expect(run.phase).toMatchObject({ state: "failed", reason: "recorded" });
    const selectedPhase = f.authorizeRoute.mock.calls[0]![0].selectedPhase;
    expect(
      await recoverDevSquadAdoCommentFeedback(
        {
          workItemId: f.request.workItemId,
          source: f.request.source,
          selectedPhase,
        },
        {
          phase: {
            ledger: f.ledger,
            verifyTerminalReceipt: f.verifyTerminalReceipt,
            utcNow: f.dependencies.utcNow,
          },
        },
      ),
    ).toEqual(run);
  });

  it("rejects mutated recovery provenance", async () => {
    const f = await fixture();
    await runDevSquadAdoCommentFeedback(f.request, f.dependencies);
    const selectedPhase = structuredClone(
      f.authorizeRoute.mock.calls[0]![0].selectedPhase,
    );
    const mutatedPhase = {
      ...selectedPhase,
      feedback: {
        ...selectedPhase.feedback!,
        evidenceDigest: Buffer.alloc(32, 29).toString("base64url"),
      },
    };
    expect(
      await recoverDevSquadAdoCommentFeedback(
        {
          workItemId: f.request.workItemId,
          source: f.request.source,
          selectedPhase: mutatedPhase,
        },
        {
          phase: {
            ledger: f.ledger,
            verifyTerminalReceipt: f.verifyTerminalReceipt,
            utcNow: f.dependencies.utcNow,
          },
        },
      ),
    ).toMatchObject({
      state: "delegated",
      phase: { state: "blocked", reason: "intent-conflict" },
    });
  });

  it.each(["same", "different"] as const)(
    "allows only one concurrent %s selected occurrence to dispatch",
    async (mode) => {
      const f = await fixture();
      let release!: () => void;
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      let arrivals = 0;
      f.authorizePhase.mockImplementation(async (request) => {
        if (request.action === "reserve" && ++arrivals === 2) release();
        if (request.action === "reserve") await barrier;
        return {
          kind: "granted",
          request,
          expiresAt: new Date(f.phaseNow().getTime() + 4_000).toISOString(),
        };
      });
      const other =
        mode === "same"
          ? f.request
          : {
              ...f.request,
              selection: {
                ...f.request.selection,
                occurrence: Buffer.alloc(32, 24).toString("base64url"),
              },
            };
      const results = await Promise.all([
        runDevSquadAdoCommentFeedback(f.request, f.dependencies),
        runDevSquadAdoCommentFeedback(other, f.dependencies),
      ]);
      expect(
        results.filter((result) => result.phase?.state === "completed"),
      ).toHaveLength(1);
      expect(f.prepare).toHaveBeenCalledOnce();
      expect(
        results.some((result) =>
          ["reservation-unconfirmed", "state-conflict"].includes(
            result.phase?.reason ?? "",
          ),
        ),
      ).toBe(true);
      expect(feedbackOccurrence).toBe(f.request.selection.occurrence);
    },
  );
});
