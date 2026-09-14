import { vi } from "vitest";
import {
  runDevSquadAdoPhase,
  type DevSquadAdoPhaseResult,
} from "./DevSquadAdoPhaseRunner.js";
import { makePhaseFixture } from "./DevSquadAdoPhaseTestSupport.js";
import type {
  DevSquadAdoCommentFeedbackDependencies,
  DevSquadAdoCommentFeedbackEvidence,
  RunDevSquadAdoCommentFeedbackRequest,
} from "./DevSquadAdoCommentFeedbackTypes.js";

export const feedbackOccurrence = Buffer.alloc(32, 23).toString("base64url");

export async function makeCommentFeedbackFixture(
  sourceKind: "prepare" | "implement" = "prepare",
) {
  const phase = await makePhaseFixture(sourceKind);
  const sourceResult = await runDevSquadAdoPhase(
    phase.request,
    phase.dependencies,
  );
  if (
    sourceResult.state !== "completed" ||
    !sourceResult.intent ||
    sourceResult.reservationRevision === undefined ||
    sourceResult.terminalRevision === undefined ||
    !sourceResult.receiptDigest ||
    sourceResult.knownRevision === null
  )
    throw new Error("feedback-source");
  phase.prepare.mockClear();
  phase.execute.mockClear();
  phase.runValidationCommand.mockClear();
  phase.authorizePhase.mockClear();
  phase.verifyTerminalReceipt.mockClear();

  const evidence: readonly DevSquadAdoCommentFeedbackEvidence[] = [
    {
      kind: "comment",
      provider: "host-fake",
      containerId: "pr-42",
      eventId: "comment-7",
      eventVersion: "v1",
      ordinal: 7,
      observedAt: phase.now().toISOString(),
      immutableEvidenceId: "comment-evidence-7",
      body: "Please address the deterministic validation failure.",
    },
    {
      kind: "review-feedback",
      provider: "host-fake",
      containerId: "pr-42",
      eventId: "thread-9",
      eventVersion: "v2",
      ordinal: 9,
      observedAt: phase.now().toISOString(),
      immutableEvidenceId: "thread-evidence-9",
      body: "Re-run the targeted suite after the fix.",
    },
  ];
  const request: RunDevSquadAdoCommentFeedbackRequest = {
    workItemId: phase.input.workItemId,
    source: {
      input: phase.input,
      receipt: receipt(sourceResult),
    },
    evidence,
    selection: {
      occurrence: feedbackOccurrence,
      plugin: { id: "devsquad", version: "17" },
      expected: {
        revision: sourceResult.knownRevision,
        phase: phase.input.success.phase,
        status: phase.input.success.status,
      },
      success: { phase: "host-selected-feedback-ready", status: "ready" },
      failure: { phase: "host-selected-feedback-failed", status: "failed" },
      phase: { kind: "feedback-prepare" },
      authority: phase.request.authority,
    },
  };
  const normalizeFeedback = vi.fn<
    DevSquadAdoCommentFeedbackDependencies["normalizeFeedback"]
  >(async (normalizationRequest) => ({
    kind: "normalized",
    request: normalizationRequest,
    content:
      "Address the deterministic validation failure and re-run the targeted suite.",
    normalizerId: "host-normalizer",
    immutableEvidenceId: "normalized-feedback-evidence",
  }));
  const authorizeRoute = vi.fn<
    DevSquadAdoCommentFeedbackDependencies["authorizeRoute"]
  >(async (routeRequest) => ({
    kind: "granted",
    request: routeRequest,
    expiresAt: new Date(phase.phaseNow().getTime() + 4_000).toISOString(),
  }));
  const dependencies: DevSquadAdoCommentFeedbackDependencies = {
    normalizeFeedback,
    authorizeRoute,
    phase: phase.dependencies,
    utcNow: () => phase.phaseNow().getTime(),
  };
  return {
    ...phase,
    sourceResult,
    evidence,
    request,
    dependencies,
    normalizeFeedback,
    authorizeRoute,
  };
}

function receipt(result: DevSquadAdoPhaseResult) {
  if (result.state !== "completed" && result.state !== "failed")
    throw new Error("feedback-source-receipt");
  return {
    state: result.state,
    intent: result.intent!,
    reservationRevision: result.reservationRevision!,
    terminalRevision: result.terminalRevision!,
    receiptDigest: result.receiptDigest!,
  };
}
