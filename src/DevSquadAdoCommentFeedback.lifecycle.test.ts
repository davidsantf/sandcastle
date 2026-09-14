import { afterEach, describe, expect, it } from "vitest";
import { runDevSquadAdoCommentFeedback } from "./DevSquadAdoCommentFeedback.js";
import { makeCommentFeedbackFixture } from "./DevSquadAdoCommentFeedbackTestSupport.js";

const clean: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(clean.splice(0).map((dispose) => dispose()));
});
async function fixture() {
  const value = await makeCommentFeedbackFixture();
  clean.push(value.dispose);
  return value;
}

describe("DevSquad ADO comment feedback bounds and retirement", () => {
  it("rejects malformed ordering, duplicate provenance, and oversized evidence", async () => {
    for (const evidence of [
      [awaitEvidence(2), awaitEvidence(1)],
      [awaitEvidence(1), awaitEvidence(1)],
      [
        awaitEvidence(1, "first", "event-1", "immutable-duplicate"),
        awaitEvidence(2, "second", "event-2", "immutable-duplicate"),
      ],
      [awaitEvidence(1, "x".repeat(4097))],
      Array.from({ length: 65 }, (_, index) =>
        awaitEvidence(index + 1, "feedback", `event-${index}`),
      ),
    ]) {
      const f = await fixture();
      expect(
        await runDevSquadAdoCommentFeedback(
          { ...f.request, evidence },
          f.dependencies,
        ),
      ).toMatchObject({ state: "blocked" });
      expect(f.normalizeFeedback).not.toHaveBeenCalled();
    }
  }, 15_000);

  it("retires timed-out normalization and ignores late settlement", async () => {
    const f = await fixture();
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let settle!: (
      value: Awaited<ReturnType<typeof f.normalizeFeedback>>,
    ) => void;
    f.normalizeFeedback.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settle = resolve;
          markStarted();
        }),
    );
    const running = runDevSquadAdoCommentFeedback(
      { ...f.request, timeoutMs: 2_000 },
      f.dependencies,
    );
    await started;
    const result = await running;
    expect(result).toMatchObject({ state: "blocked", reason: "deadline" });
    settle({ kind: "rejected" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(f.authorizeRoute).not.toHaveBeenCalled();
    expect(f.prepare).not.toHaveBeenCalled();
  }, 10_000);

  it("retires cancellation before route authorization", async () => {
    const f = await fixture();
    const controller = new AbortController();
    f.normalizeFeedback.mockImplementationOnce(async () => {
      controller.abort();
      return { kind: "rejected" };
    });
    expect(
      await runDevSquadAdoCommentFeedback(
        { ...f.request, signal: controller.signal },
        f.dependencies,
      ),
    ).toMatchObject({ state: "blocked", reason: "cancelled" });
    expect(f.authorizeRoute).not.toHaveBeenCalled();
  });

  it("surfaces selected-phase timeout and prevents late terminal mutation", async () => {
    const f = await fixture();
    let settle!: (value: { kind: "completed"; artifactDigest: string }) => void;
    f.prepare.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    const result = await runDevSquadAdoCommentFeedback(
      {
        ...f.request,
        selection: { ...f.request.selection, timeoutMs: 500 },
      },
      f.dependencies,
    );
    expect(result).toMatchObject({
      state: "delegated",
      phase: { state: "pending", reason: "deadline" },
    });
    settle({
      kind: "completed",
      artifactDigest: Buffer.alloc(32, 28).toString("base64url"),
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const read = await f.ledger.readRecord("137");
    expect(read.ok && read.value.revision).toBe(8);
  });

  it("propagates caller cancellation throughout the delegated phase", async () => {
    const f = await fixture();
    const controller = new AbortController();
    let settle!: (value: { kind: "completed"; artifactDigest: string }) => void;
    f.prepare.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    const pending = runDevSquadAdoCommentFeedback(
      { ...f.request, signal: controller.signal },
      f.dependencies,
    );
    while (!f.prepare.mock.calls.length)
      await new Promise((resolve) => setTimeout(resolve, 1));
    controller.abort();
    expect(await pending).toMatchObject({
      state: "delegated",
      phase: { state: "pending", reason: "cancelled" },
    });
    settle({
      kind: "completed",
      artifactDigest: Buffer.alloc(32, 28).toString("base64url"),
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const read = await f.ledger.readRecord("137");
    expect(read.ok && read.value.revision).toBe(8);
  });

  it("rejects malformed normalizer output without exposing diagnostics", async () => {
    const f = await fixture();
    f.normalizeFeedback.mockResolvedValueOnce({
      kind: "normalized",
      request: f.normalizeFeedback.mock.calls[0]?.[0] as never,
      content: "",
      normalizerId: "",
      immutableEvidenceId: "",
    });
    const result = await runDevSquadAdoCommentFeedback(
      f.request,
      f.dependencies,
    );
    expect(result).toMatchObject({
      state: "blocked",
      reason: "normalization-rejected",
    });
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it("rejects accessor-backed recovery input without reading it", async () => {
    const f = await fixture();
    let accessed = false;
    const request = {
      workItemId: f.request.workItemId,
      source: f.request.source,
      get selectedPhase() {
        accessed = true;
        return f.request.source.input;
      },
    };
    const { recoverDevSquadAdoCommentFeedback } =
      await import("./DevSquadAdoCommentFeedback.js");
    expect(
      await recoverDevSquadAdoCommentFeedback(request as never, {
        phase: {
          ledger: f.ledger,
          verifyTerminalReceipt: f.verifyTerminalReceipt,
          utcNow: f.dependencies.utcNow,
        },
      }),
    ).toMatchObject({ state: "blocked", reason: "invalid-input" });
    expect(accessed).toBe(false);
  });

  it("bounds both recovery reads under one coordinator deadline", async () => {
    const f = await fixture();
    await runDevSquadAdoCommentFeedback(f.request, f.dependencies);
    const selectedPhase = f.authorizeRoute.mock.calls[0]![0].selectedPhase;
    const { recoverDevSquadAdoCommentFeedback } =
      await import("./DevSquadAdoCommentFeedback.js");
    expect(
      await recoverDevSquadAdoCommentFeedback(
        {
          workItemId: f.request.workItemId,
          source: f.request.source,
          selectedPhase,
          timeoutMs: 50,
        },
        {
          verifySourceReceipt: f.verifyTerminalReceipt,
          phase: {
            ledger: f.ledger,
            verifyTerminalReceipt: async () =>
              new Promise(() => {
                // The shared recovery lifecycle must retire this dependency.
              }),
            utcNow: f.dependencies.utcNow,
          },
        },
      ),
    ).toMatchObject({ state: "blocked", reason: "deadline" });
  });
});

function awaitEvidence(
  ordinal: number,
  body = "feedback",
  eventId = "event",
  immutableEvidenceId = `evidence-${ordinal}`,
) {
  return {
    kind: "comment" as const,
    provider: "host-fake",
    containerId: "pr-42",
    eventId,
    eventVersion: "v1",
    ordinal,
    observedAt: "2026-09-13T15:00:00.000Z",
    immutableEvidenceId,
    body,
  };
}
