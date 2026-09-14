import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("DevSquad ADO comment feedback authority", () => {
  it("requires exact source receipt and current ledger correlation", async () => {
    const f = await fixture();
    const wrongReceipt = {
      ...f.request,
      source: {
        ...f.request.source,
        receipt: {
          ...f.request.source.receipt,
          receiptDigest: Buffer.alloc(32, 31).toString("base64url"),
        },
      },
    };
    expect(
      await runDevSquadAdoCommentFeedback(wrongReceipt, f.dependencies),
    ).toMatchObject({ state: "blocked", reason: "source-unverified" });
    expect(f.normalizeFeedback).not.toHaveBeenCalled();

    const stale = {
      ...f.request,
      selection: {
        ...f.request.selection,
        expected: {
          ...f.request.selection.expected,
          revision: f.request.selection.expected.revision + 1,
        },
      },
    };
    expect(
      await runDevSquadAdoCommentFeedback(stale, f.dependencies),
    ).toMatchObject({ state: "blocked", reason: "source-unverified" });
  });

  it("rejects mutated normalization output before host authorization", async () => {
    const f = await fixture();
    f.normalizeFeedback.mockImplementationOnce(async (request) => ({
      kind: "normalized",
      request: {
        ...request,
        evidenceDigest: Buffer.alloc(32).toString("base64url"),
      },
      content: "mutated",
      normalizerId: "host-normalizer",
      immutableEvidenceId: "evidence",
    }));
    expect(
      await runDevSquadAdoCommentFeedback(f.request, f.dependencies),
    ).toMatchObject({ state: "blocked", reason: "normalization-rejected" });
    expect(f.authorizeRoute).not.toHaveBeenCalled();
  });

  it("commits normalizer identity and immutable output evidence", async () => {
    const first = await fixture();
    await runDevSquadAdoCommentFeedback(first.request, first.dependencies);
    const firstRoute = first.authorizeRoute.mock.calls[0]![0];
    expect(firstRoute).toMatchObject({
      normalizerId: "host-normalizer",
      normalizedEvidenceId: "normalized-feedback-evidence",
    });

    const second = await fixture();
    second.normalizeFeedback.mockImplementationOnce(async (request) => ({
      kind: "normalized",
      request,
      content:
        "Address the deterministic validation failure and re-run the targeted suite.",
      normalizerId: "different-normalizer",
      immutableEvidenceId: "different-output-evidence",
    }));
    await runDevSquadAdoCommentFeedback(second.request, second.dependencies);
    expect(second.authorizeRoute.mock.calls[0]![0].normalizedDigest).not.toBe(
      firstRoute.normalizedDigest,
    );
  });

  it("captures the selected preparation seam before asynchronous dependencies", async () => {
    const f = await fixture();
    const original = f.prepare;
    const replacement = vi.fn(async () => ({
      kind: "completed" as const,
      artifactDigest: Buffer.alloc(32, 27).toString("base64url"),
    }));
    f.authorizeRoute.mockImplementationOnce(async (request) => {
      Object.defineProperty(f.dependencies.phase, "prepare", {
        value: replacement,
        configurable: true,
        enumerable: true,
        writable: true,
      });
      return {
        kind: "granted",
        request,
        expiresAt: new Date(f.phaseNow().getTime() + 4_000).toISOString(),
      };
    });
    expect(
      await runDevSquadAdoCommentFeedback(f.request, f.dependencies),
    ).toMatchObject({
      state: "delegated",
      phase: { state: "completed" },
    });
    expect(original).toHaveBeenCalledOnce();
    expect(replacement).not.toHaveBeenCalled();
  });

  it.each(["denied", "mismatch", "stale"] as const)(
    "rejects %s route authorization",
    async (mode) => {
      const f = await fixture();
      f.authorizeRoute.mockImplementationOnce(async (request) => {
        if (mode === "denied") return { kind: "denied" };
        return {
          kind: "granted",
          request:
            mode === "mismatch"
              ? {
                  ...request,
                  selectedPhase: {
                    ...request.selectedPhase,
                    occurrence: Buffer.alloc(32, 30).toString("base64url"),
                  },
                }
              : request,
          expiresAt: new Date(
            f.phaseNow().getTime() + (mode === "stale" ? -1 : 4_000),
          ).toISOString(),
        };
      });
      expect(
        await runDevSquadAdoCommentFeedback(f.request, f.dependencies),
      ).toMatchObject({ state: "blocked", reason: "route-denied" });
      expect(f.prepare).not.toHaveBeenCalled();
    },
  );

  it("rejects noncanonical route grants before phase authorization", async () => {
    const f = await fixture();
    f.authorizeRoute.mockImplementationOnce(async (request) => ({
      kind: "granted",
      request,
      expiresAt: new Date(f.phaseNow().getTime() + 4_000).toISOString(),
      diagnostic: "must-not-be-accepted",
    }));
    expect(
      await runDevSquadAdoCommentFeedback(f.request, f.dependencies),
    ).toMatchObject({ state: "blocked", reason: "route-denied" });
    expect(f.authorizePhase).not.toHaveBeenCalled();
  });

  it("delegates stale revision, fence, and lease rejection to slice 16", async () => {
    const staleRevision = await fixture();
    const revisionRequest = {
      ...staleRevision.request,
      selection: {
        ...staleRevision.request.selection,
        expected: {
          ...staleRevision.request.selection.expected,
          revision: staleRevision.request.selection.expected.revision + 1,
        },
      },
    };
    expect(
      await runDevSquadAdoCommentFeedback(
        revisionRequest,
        staleRevision.dependencies,
      ),
    ).toMatchObject({ state: "blocked", reason: "source-unverified" });

    const staleFence = await fixture();
    const fenceRequest = {
      ...staleFence.request,
      selection: {
        ...staleFence.request.selection,
        authority: {
          ...staleFence.request.selection.authority,
          fencingValue: 99,
        },
      },
    };
    expect(
      await runDevSquadAdoCommentFeedback(
        fenceRequest,
        staleFence.dependencies,
      ),
    ).toMatchObject({
      state: "delegated",
      phase: { state: "blocked", reason: "authority-rejected" },
    });

    const expired = await fixture();
    expired.authorizeRoute.mockImplementationOnce(async (request) => {
      expired.setNow(expired.phaseNow().getTime() + 60_000);
      return {
        kind: "granted",
        request,
        expiresAt: new Date(expired.phaseNow().getTime() + 4_000).toISOString(),
      };
    });
    const expiredResult = await runDevSquadAdoCommentFeedback(
      expired.request,
      expired.dependencies,
    );
    expect(expiredResult).toMatchObject({
      state: "delegated",
      phase: { state: "blocked", reason: "deadline" },
    });
  }, 15_000);

  it("uses route freshness only to authorize the selected reservation", async () => {
    const f = await fixture();
    f.prepare.mockImplementationOnce(async () => {
      f.setNow(f.phaseNow().getTime() + 6_000);
      return {
        kind: "completed",
        artifactDigest: Buffer.alloc(32, 25).toString("base64url"),
      };
    });
    const result = await runDevSquadAdoCommentFeedback(
      f.request,
      f.dependencies,
    );
    const read = await f.ledger.readRecord("137");
    expect({
      result,
      actions: f.authorizePhase.mock.calls.map(([request]) => request.action),
      revision: read.ok ? read.value.revision : null,
    }).toMatchObject({
      result: {
        state: "delegated",
        phase: { state: "completed", reason: "recorded" },
      },
      actions: ["reserve", "dispatch", "complete"],
      revision: 9,
    });
  });

  it("does not dispatch when durable reservation lands after route expiry", async () => {
    const f = await fixture();
    const checkpoint = f.ledger.checkpoint;
    f.authorizeRoute.mockImplementationOnce(async (request) => ({
      kind: "granted",
      request,
      expiresAt: new Date(f.phaseNow().getTime() + 2_000).toISOString(),
    }));
    const dependencies = {
      ...f.dependencies,
      phase: {
        ...f.dependencies.phase,
        ledger: {
          readRecord: f.ledger.readRecord,
          checkpoint: async (request: Parameters<typeof checkpoint>[0]) => {
            f.setNow(f.phaseNow().getTime() + 3_000);
            return checkpoint(request);
          },
        },
      },
    };
    expect(
      await runDevSquadAdoCommentFeedback(f.request, dependencies),
    ).toMatchObject({
      state: "delegated",
      phase: {
        state: "pending",
        reason: "policy-denied",
        reservationRevision: 8,
      },
    });
    expect(f.prepare).not.toHaveBeenCalled();
  });

  it("does not canonicalize malformed slice-16 policy expiry", async () => {
    const f = await fixture();
    f.authorizePhase.mockImplementationOnce(async (request) => ({
      kind: "granted",
      request,
      expiresAt: new Date(f.phaseNow().getTime() + 4_000)
        .toISOString()
        .replace(".000Z", "Z"),
    }));
    expect(
      await runDevSquadAdoCommentFeedback(f.request, f.dependencies),
    ).toMatchObject({
      state: "delegated",
      phase: { state: "blocked", reason: "policy-denied" },
    });
    expect(f.prepare).not.toHaveBeenCalled();
  });
});
