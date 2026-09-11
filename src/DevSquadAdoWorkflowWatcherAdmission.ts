import type {
  InitializeDevSquadAdoWorkflowRecordInput,
  DevSquadAdoWorkflowLedger,
} from "./DevSquadAdoWorkflowLedger.js";
import type {
  DevSquadAdoDiscoveryAdmissionOutcome,
  DevSquadAdoDiscoveryAdmissionSignal,
  DevSquadAdoDiscoveryAuthorization,
  DevSquadAdoDiscoveryMatchingEvidence,
} from "./DevSquadAdoWorkflowWatcher.js";
import { deriveDiscoveryInitializationId } from "./DevSquadAdoWorkflowWatcherValidation.js";

/** Initialization processing never switches back to observation in this invocation. */
export interface DiscoveryAdmissionState {
  readonly request: InitializeDevSquadAdoWorkflowRecordInput | null;
  outcome: DevSquadAdoDiscoveryAdmissionOutcome;
  pending: boolean;
}
/** W041 / SEC-A01: matching alone never supplies authorization or workflow state. */
export const createDiscoveryAdmission = (
  workItemId: string,
  matching: DevSquadAdoDiscoveryMatchingEvidence,
  authorization: DevSquadAdoDiscoveryAuthorization | undefined,
): DiscoveryAdmissionState => {
  const authorized = authorization?.kind === "authorized";
  return {
    request: authorized
      ? Object.freeze({
          workItemId,
          operationId: deriveDiscoveryInitializationId({
            workItemId,
            submissionId: authorization.submissionId,
            ...authorization.initial,
          }),
          ...authorization.initial,
        })
      : null,
    pending: authorized,
    outcome: {
      category: "admission",
      workItemId,
      kind: authorized ? "failed" : "skipped",
      reason: authorized
        ? "initialization-indeterminate"
        : authorization?.kind === "unavailable" &&
            authorization.reason === "initial-state-missing"
          ? "admission-initial-state-missing"
          : "admission-not-authorized",
      matching,
      acceptance: authorized ? { kind: "unconfirmed" } : { kind: "none" },
      ledgerErrorKind: null,
      cleanup: {
        status: "not-required",
        reason: "no-claim-acquired",
        ledgerErrorKind: null,
        acceptedRevision: null,
      },
    },
  };
};
/** W041 / FR-068: report only fresh validated publication, never replay delivery. */
export const runDiscoveryAdmission = async (
  state: DiscoveryAdmissionState,
  initialize: DevSquadAdoWorkflowLedger["initializeRecord"],
  intakePhases: readonly string[],
  intakeStatuses: readonly string[],
  signal: AbortSignal | undefined,
): Promise<DevSquadAdoDiscoveryAdmissionSignal | null> => {
  if (!state.pending || state.request === null) return null;
  if (signal?.aborted) {
    state.pending = false;
    state.outcome = {
      ...state.outcome,
      reason: "cancelled",
      acceptance: { kind: "none" },
    };
    return null;
  }
  let result: Awaited<ReturnType<typeof initialize>>;
  try {
    result = await initialize(state.request);
  } catch {
    state.pending = false;
    state.outcome = {
      ...state.outcome,
      kind: "failed",
      reason: "ledger-unavailable",
      ledgerErrorKind: "ledger-fault",
      acceptance: { kind: "unconfirmed" },
    };
    return null;
  }
  if (!result.ok) {
    const error = result.error;
    state.pending =
      error.kind === "contention" ||
      (error.kind === "storage" && error.outcome === "indeterminate");
    state.outcome = {
      ...state.outcome,
      kind: error.kind === "record-already-exists" ? "skipped" : "failed",
      reason: state.pending
        ? "initialization-indeterminate"
        : error.kind === "record-already-exists"
          ? "admission-already-recorded"
          : error.kind === "idempotency-conflict"
            ? "idempotency-conflict"
            : error.kind === "capacity-exceeded"
              ? "ledger-capacity"
              : "ledger-recovery",
      ledgerErrorKind: error.kind,
      acceptance: { kind: state.pending ? "unconfirmed" : "none" },
    };
    return null;
  }
  state.pending = false;
  const accepted = result.value,
    replayed = accepted.replayed;
  // W046-001 / FR-041/043/068: consume only independently validated snapshots.
  const matches =
    intakePhases.includes(state.request.phase) &&
    intakeStatuses.includes(state.request.status);
  state.outcome = {
    ...state.outcome,
    kind: replayed || !matches ? "no-change" : "acted",
    reason: replayed
      ? "admission-replayed"
      : matches
        ? "admission-accepted"
        : "admission-intake-rules-unmatched",
    ledgerErrorKind: null,
    acceptance: {
      kind: replayed ? "replayed" : "fresh",
      acceptedRevision: 1,
      acceptedAt: accepted.acceptedAt,
    },
  };
  return replayed || !matches
    ? null
    : {
        kind: "discovery-admission",
        workItemId: state.outcome.workItemId,
        acceptedInitializationRevision: 1,
        phase: state.request.phase,
        status: state.request.status,
        matching: state.outcome.matching,
        authorization: "host-authorized",
      };
};
