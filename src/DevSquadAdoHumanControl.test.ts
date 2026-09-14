import { afterEach, describe, expect, it, vi } from "vitest";
import { runDevSquadAdoHumanControl } from "./DevSquadAdoHumanControl.js";
import { runDevSquadAdoCommentFeedback } from "./DevSquadAdoCommentFeedback.js";
import { runDevSquadAdoPhase } from "./DevSquadAdoPhaseRunner.js";
import { phaseHistory } from "./DevSquadAdoPhaseProtocol.js";
import { makeCommentFeedbackFixture } from "./DevSquadAdoCommentFeedbackTestSupport.js";
import type {
  DevSquadAdoHumanControlDependencies,
  RunDevSquadAdoHumanControlRequest,
} from "./DevSquadAdoHumanControlTypes.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const clean: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(clean.splice(0).map((dispose) => dispose()));
});

async function fixture() {
  const base = await makeCommentFeedbackFixture();
  clean.push(base.dispose);
  const read = await base.ledger.readRecord("137");
  if (!read.ok || !read.value.activeClaim) throw new Error("control-fixture");
  const occurrence = Buffer.alloc(32, 18).toString("base64url");
  const action = {
    kind: "pause" as const,
    occurrence,
    expected: {
      revision: read.value.revision,
      phase: read.value.phase,
      status: read.value.status,
    },
    resulting: { phase: "host-control", status: "paused" },
    authority: base.request.selection.authority,
    decision: {
      actorId: "human-reviewer",
      decisionId: "decision-18",
      evidenceDigest: Buffer.alloc(32, 28).toString("base64url"),
    },
  };
  const request: RunDevSquadAdoHumanControlRequest = {
    workItemId: "137",
    action,
  };
  const verifyHumanDecision = vi.fn<
    NonNullable<DevSquadAdoHumanControlDependencies["verifyHumanDecision"]>
  >(async (verificationRequest) => ({
    kind: "verified",
    request: verificationRequest,
    verifierId: "human-verifier",
    immutableEvidenceId: "human-evidence",
    expiresAt: new Date(base.phaseNow().getTime() + 4_000).toISOString(),
  }));
  const authorizeControl = vi.fn<
    NonNullable<DevSquadAdoHumanControlDependencies["authorizeControl"]>
  >(async (policyRequest) => ({
    kind: "granted",
    request: policyRequest,
    expiresAt: new Date(base.phaseNow().getTime() + 4_000).toISOString(),
  }));
  const verifyRetainedControl = vi.fn<
    NonNullable<DevSquadAdoHumanControlDependencies["verifyRetainedControl"]>
  >(async (retainedRequest) => ({
    kind: "verified",
    request: retainedRequest,
    verifierId: "retained-control-verifier",
    immutableEvidenceId: "retained-control-evidence",
    expiresAt: new Date(base.phaseNow().getTime() + 4_000).toISOString(),
  }));
  const dependencies: DevSquadAdoHumanControlDependencies = {
    ledger: base.ledger,
    verifyHumanDecision,
    authorizeControl,
    verifyRetainedControl,
    phaseRecovery: {
      ledger: base.ledger,
      verifyTerminalReceipt: base.verifyTerminalReceipt,
    },
    utcNow: () => base.phaseNow().getTime(),
    monotonicNow: () => 0,
  };
  return {
    ...base,
    feedbackRequest: base.request,
    feedbackDependencies: base.dependencies,
    action,
    request,
    dependencies,
    verifyHumanDecision,
    authorizeControl,
    verifyRetainedControl,
  };
}

describe("DevSquad ADO human control", () => {
  it("observes minimized status and bounded audit without mutation authority", async () => {
    const f = await fixture();
    const readOnly: DevSquadAdoHumanControlDependencies = {
      ledger: { readRecord: f.ledger.readRecord },
      utcNow: () => f.phaseNow().getTime(),
      monotonicNow: () => 0,
    };
    const status = await runDevSquadAdoHumanControl(
      { workItemId: 137, action: { kind: "status" } },
      readOnly,
    );
    const audit = await runDevSquadAdoHumanControl(
      { workItemId: "137", action: { kind: "audit", limit: 2 } },
      readOnly,
    );
    expect(status).toMatchObject({
      state: "observed",
      snapshot: { revision: f.action.expected.revision, audit: [] },
    });
    expect(audit.state).toBe("observed");
    expect(audit.snapshot?.audit).toHaveLength(2);
    expect(f.verifyHumanDecision).not.toHaveBeenCalled();
    expect(f.authorizeControl).not.toHaveBeenCalled();
  });

  it("records one exact human-authorized control transition and replays it", async () => {
    const f = await fixture();
    const first = await runDevSquadAdoHumanControl(f.request, f.dependencies);
    const second = await runDevSquadAdoHumanControl(f.request, f.dependencies);
    expect(first).toMatchObject({
      state: "recorded",
      reason: "recorded",
      knownRevision: f.action.expected.revision + 1,
      snapshot: { phase: "host-control", status: "paused" },
    });
    expect(second).toMatchObject({
      state: "recorded",
      reason: "recorded",
      knownRevision: f.action.expected.revision + 1,
    });
    expect(f.verifyHumanDecision).toHaveBeenCalledOnce();
    expect(f.authorizeControl).toHaveBeenCalledOnce();
    expect(f.verifyRetainedControl).toHaveBeenCalledOnce();
    expect(
      JSON.stringify(f.verifyHumanDecision.mock.calls[0]![0]),
    ).not.toContain(f.action.authority.claimToken);
    expect(JSON.stringify(f.authorizeControl.mock.calls[0]![0])).not.toContain(
      f.action.authority.claimToken,
    );
  });

  it("fails closed on denied human evidence, stale fence, and reused occurrence", async () => {
    const denied = await fixture();
    denied.verifyHumanDecision.mockResolvedValueOnce({ kind: "denied" });
    expect(
      await runDevSquadAdoHumanControl(denied.request, denied.dependencies),
    ).toMatchObject({ state: "blocked", reason: "human-unverified" });

    const stale = await fixture();
    expect(
      await runDevSquadAdoHumanControl(
        {
          ...stale.request,
          action: {
            ...stale.action,
            authority: { ...stale.action.authority, fencingValue: 99 },
          },
        },
        stale.dependencies,
      ),
    ).toMatchObject({ state: "blocked", reason: "authority-rejected" });

    const reused = await fixture();
    const first = await runDevSquadAdoHumanControl(
      reused.request,
      reused.dependencies,
    );
    expect(first.state).toBe("recorded");
    const read = await reused.ledger.readRecord("137");
    if (!read.ok) throw new Error("control-read");
    expect(
      await runDevSquadAdoHumanControl(
        {
          workItemId: "137",
          action: {
            ...reused.action,
            expected: {
              revision: read.value.revision,
              phase: read.value.phase,
              status: read.value.status,
            },
            resulting: { phase: "other", status: "other" },
          },
        },
        reused.dependencies,
      ),
    ).toMatchObject({ state: "blocked", reason: "intent-conflict" });
  });

  it("rejects malformed verification, denied policy, and late acknowledgement", async () => {
    const malformed = await fixture();
    malformed.verifyHumanDecision.mockImplementationOnce(async (request) => ({
      kind: "verified",
      request,
      verifierId: "human-verifier",
      immutableEvidenceId: "human-evidence",
      expiresAt: new Date(malformed.phaseNow().getTime() + 4_000).toISOString(),
      diagnostic: "must-not-be-accepted",
    }));
    expect(
      await runDevSquadAdoHumanControl(
        malformed.request,
        malformed.dependencies,
      ),
    ).toMatchObject({ state: "blocked", reason: "human-unverified" });

    const denied = await fixture();
    denied.authorizeControl.mockResolvedValueOnce({ kind: "denied" });
    expect(
      await runDevSquadAdoHumanControl(denied.request, denied.dependencies),
    ).toMatchObject({ state: "blocked", reason: "policy-denied" });

    const late = await fixture();
    const checkpoint = late.ledger.checkpoint;
    const dependencies = {
      ...late.dependencies,
      ledger: {
        readRecord: late.ledger.readRecord,
        checkpoint: async (input: Parameters<typeof checkpoint>[0]) => {
          return checkpoint({
            ...input,
            notAfter: new Date(late.phaseNow().getTime() - 1).toISOString(),
          });
        },
      },
    };
    expect(
      await runDevSquadAdoHumanControl(late.request, dependencies),
    ).toMatchObject({ state: "pending", reason: "mutation-unconfirmed" });
    const read = await late.ledger.readRecord("137");
    expect(read.ok && read.value.revision).toBe(late.action.expected.revision);
  });

  it("expires human evidence by monotonic time even when UTC stalls", async () => {
    const f = await fixture();
    let monotonic = 0;
    const authorizeControl = vi.fn<
      NonNullable<DevSquadAdoHumanControlDependencies["authorizeControl"]>
    >(async (request) => {
      monotonic = 5_000;
      return {
        kind: "granted",
        request,
        expiresAt: new Date(f.phaseNow().getTime() + 4_000).toISOString(),
      };
    });
    expect(
      await runDevSquadAdoHumanControl(f.request, {
        ...f.dependencies,
        authorizeControl,
        monotonicNow: () => monotonic,
      }),
    ).toMatchObject({ state: "blocked", reason: "human-unverified" });
  });

  it("recovers an accepted control while a later phase is pending", async () => {
    const f = await fixture();
    expect(
      await runDevSquadAdoHumanControl(f.request, f.dependencies),
    ).toMatchObject({ state: "recorded" });
    const read = await f.ledger.readRecord("137");
    if (!read.ok) throw new Error("later-phase-read");
    f.prepare.mockRejectedValueOnce(new Error("uncertain later phase"));
    const laterPhase = {
      ...f.feedbackRequest.source.input,
      occurrence: Buffer.alloc(32, 30).toString("base64url"),
      expected: {
        revision: read.value.revision,
        phase: read.value.phase,
        status: read.value.status,
      },
      success: { phase: "later-complete", status: "ready" },
      failure: { phase: "later-failed", status: "failed" },
      phase: { kind: "prepare" as const, content: "later work" },
    };
    expect(
      await runDevSquadAdoPhase(
        { ...laterPhase, authority: f.action.authority },
        f.feedbackDependencies.phase,
      ),
    ).toMatchObject({ state: "pending", reason: "dependency-failed" });
    expect(
      await runDevSquadAdoHumanControl(f.request, f.dependencies),
    ).toMatchObject({ state: "recorded", reason: "recorded" });
  });

  it("adjudicates one uncertain phase only with explicit human evidence", async () => {
    const f = await fixture();
    f.prepare.mockRejectedValueOnce(new Error("unknown external outcome"));
    const delegated = await runDevSquadAdoCommentFeedback(
      f.feedbackRequest,
      f.feedbackDependencies,
    );
    expect(delegated.phase).toMatchObject({
      state: "pending",
      reason: "dependency-failed",
    });
    const selectedPhase = f.authorizeRoute.mock.calls[0]![0].selectedPhase;
    const read = await f.ledger.readRecord("137");
    if (!read.ok) throw new Error("adjudication-read");
    const action = {
      kind: "adjudicate" as const,
      phase: selectedPhase,
      outcome: "failed" as const,
      receiptDigest: Buffer.alloc(32, 29).toString("base64url"),
      expected: {
        revision: read.value.revision,
        phase: read.value.phase,
        status: read.value.status,
      },
      authority: f.action.authority,
      decision: f.action.decision,
    };
    const result = await runDevSquadAdoHumanControl(
      { workItemId: "137", action },
      f.dependencies,
    );
    const after = await f.ledger.readRecord("137");
    expect(result).toMatchObject({
      state: "recorded",
      snapshot: {
        phase: selectedPhase.failure.phase,
        status: selectedPhase.failure.status,
        pendingPhaseOccurrence: null,
      },
    });
    expect(after.ok && phaseHistory(after.value).pending).toBeNull();
  });

  it("does not interleave ordinary controls with an uncertain phase", async () => {
    const f = await fixture();
    f.prepare.mockRejectedValueOnce(new Error("unknown external outcome"));
    await runDevSquadAdoCommentFeedback(
      f.feedbackRequest,
      f.feedbackDependencies,
    );
    const read = await f.ledger.readRecord("137");
    if (!read.ok) throw new Error("pending-read");
    expect(
      await runDevSquadAdoHumanControl(
        {
          workItemId: "137",
          action: {
            ...f.action,
            expected: {
              revision: read.value.revision,
              phase: read.value.phase,
              status: read.value.status,
            },
          },
        },
        f.dependencies,
      ),
    ).toMatchObject({ state: "blocked", reason: "state-conflict" });
  });
});
