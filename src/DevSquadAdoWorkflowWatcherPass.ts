import { randomBytes } from "node:crypto";
import type {
  CheckpointDevSquadAdoWorkflowInput,
  DevSquadAdoLedgerError,
  DevSquadAdoLedgerResult,
  DevSquadAdoPullRequestCursor,
  DevSquadAdoWorkflowRecord,
} from "./DevSquadAdoWorkflowLedger.js";
import type {
  DevSquadAdoWatchCandidateOutcome,
  DevSquadAdoWatchClaimMetadata,
  DevSquadAdoWatchCleanup,
  DevSquadAdoWatchLedgerErrorKind,
  DevSquadAdoWatchIntakeSignal,
  DevSquadAdoWatchObservationKind,
  DevSquadAdoWatchPassOutcome,
  DevSquadAdoWatchReasonCode,
  DevSquadAdoWatchStopReason,
  DevSquadAdoWatchValidatedPass,
  DevSquadAdoWatcherObservationGeneration,
  DevSquadAdoWatcherObservationSeam,
  DevSquadAdoWatcherDiscoverySeam,
  RunDevSquadAdoWorkflowWatchPassOptions,
} from "./DevSquadAdoWorkflowWatcher.js";
import { observeDevSquadAdoWatchCandidate } from "./DevSquadAdoWorkflowWatcherObservation.js";
import {
  guardDevSquadAdoWatcherLedger,
  isDevSquadAdoWatcherCheckpointHistoryValid,
} from "./DevSquadAdoWorkflowWatcherLedger.js";
import {
  computeDevSquadAdoWatcherBackoffDelayMs,
  deriveDevSquadAdoWatcherOperationId,
  mintDevSquadAdoWatcherClaimEpoch,
  prepareDevSquadAdoWorkflowWatchPassOptions,
} from "./DevSquadAdoWorkflowWatcherValidation.js";

/** Stable redacted category reported when an injected ledger method faults. */
const LEDGER_FAULT_KIND = "ledger-fault";

interface HeldClaim {
  readonly claimToken: string;
  readonly ownerId: string;
  readonly fencingValue: number;
  /** Random identity of this acquisition, shared by its renew and release. */
  readonly claimEpoch: string;
  expiresAt: string;
}

interface PendingCheckpoint {
  readonly operationId: string;
  /**
   * Latest known record revision under the held claim.
   *
   * Every ledger mutation advances the revision, including a claim renewal, so
   * the optimistic precondition is refreshed whenever the watcher's own claim
   * operations move it. Phase and status stay pinned to the values the
   * decision was derived from, so a foreign state change still conflicts.
   */
  expectedRevision: number;
  /** Acceptance preconditions of the last submission, not the next retry. */
  submittedRequest: CheckpointDevSquadAdoWorkflowInput | null;
  readonly patch: {
    readonly observations: {
      readonly workItemCommentId?: string;
      readonly pullRequest?: DevSquadAdoPullRequestCursor;
    };
  };
  readonly changedKinds: readonly DevSquadAdoWatchObservationKind[];
  readonly phase: string;
  readonly status: string;
}

/** Shared invocation-local candidate state; never a persisted discovery cursor. */
export interface CandidateState {
  readonly workItemId: string;
  resolved: DevSquadAdoWatchCandidateOutcome | null;
  examined: boolean;
  /** W046 SKEP1 / FR-067: only a guarded initial read can authorize admission. */
  initialReadMissing: boolean;
  eligible: boolean;
  pendingReason: DevSquadAdoWatchReasonCode;
  sourceRevision: number | null;
  skippedCursorKinds: readonly DevSquadAdoWatchObservationKind[];
  claim: HeldClaim | null;
  renewOrdinal: number;
  pendingCheckpoint: PendingCheckpoint | null;
  cleanup: DevSquadAdoWatchCleanup;
  suppressed: boolean;
}

/** Shared guarded observation context for both intake modes (W040). */
export interface PassContext {
  readonly ledger: ReturnType<typeof guardDevSquadAdoWatcherLedger>;
  readonly seam:
    | DevSquadAdoWatcherObservationSeam
    | DevSquadAdoWatcherDiscoverySeam;
  /** W042: preserve discovery retention evidence through the shared path. */
  readonly mode: "supplied" | "discovery";
  readonly validated: DevSquadAdoWatchValidatedPass;
  readonly delay: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly signal: AbortSignal | undefined;
  readonly signals: DevSquadAdoWatchIntakeSignal[];
  cancelled: boolean;
}

/**
 * Read the current abort state without narrowing it for later gates.
 *
 * Cancellation is polled at several points across `await` boundaries, so the
 * check has to stay a fresh read of live state.
 */
const isAborted = (signal: AbortSignal | undefined): boolean =>
  signal !== undefined && signal.aborted;

/**
 * One guarded ledger invocation.
 *
 * `fault` is deliberately payload-free. It is the outcome of an injected
 * ledger that threw, rejected, or answered with something that is not a typed
 * ledger result — none of which the watcher can describe without quoting a
 * value it does not control.
 */
type LedgerOutcome<T> =
  | { readonly status: "ok"; readonly value: T }
  | { readonly status: "error"; readonly error: DevSquadAdoLedgerError }
  | { readonly status: "fault" };

/**
 * Invoke one injected ledger method and normalize everything it can do.
 *
 * The ledger is caller-supplied and no more trusted than the observation seam.
 * A synchronous throw, a rejected promise, or a malformed result would
 * otherwise escape the pass untyped — taking with it a raw `Error`, its
 * message and stack, and any claim the candidate was holding at the time. Each
 * is converted here, at the single call boundary, into a typed outcome the
 * candidate's normal resolution path can release a claim against.
 *
 * This is not a blanket `catch`: it wraps exactly one injected call and
 * classifies its result, so a genuine typed ledger error still travels its own
 * mapped path and keeps its own stable category.
 */
const callLedger = async <T>(
  invoke: () => Promise<DevSquadAdoLedgerResult<T>>,
): Promise<LedgerOutcome<T>> => {
  let settled: DevSquadAdoLedgerResult<T>;
  try {
    settled = await invoke();
  } catch {
    return { status: "fault" };
  }
  if (typeof settled !== "object" || settled === null)
    return { status: "fault" };
  if (settled.ok === true) return { status: "ok", value: settled.value };
  const error: unknown = settled.error;
  if (
    typeof error !== "object" ||
    error === null ||
    typeof (error as { readonly kind?: unknown }).kind !== "string"
  )
    return { status: "fault" };
  return { status: "error", error: error as DevSquadAdoLedgerError };
};

/**
 * Take one clock reading, or report that the clock is unusable.
 *
 * The clock is caller-supplied and no more trusted than the observation seam,
 * so a throw is treated exactly like an unusable reading rather than escaping
 * as an untyped error. Both cases are fail-closed: the pass stops on the
 * reading it cannot make and releases every claim it still holds.
 */
const readClock = (clock: () => Date): Date | null => {
  let reading: Date;
  try {
    reading = clock();
  } catch {
    return null;
  }
  return reading instanceof Date && Number.isFinite(reading.getTime())
    ? reading
    : null;
};

const claimMetadata = (claim: HeldClaim): DevSquadAdoWatchClaimMetadata => ({
  ownerId: claim.ownerId,
  fencingValue: claim.fencingValue,
  expiresAt: claim.expiresAt,
});

const outcomeFor = (
  state: CandidateState,
  kind: DevSquadAdoWatchCandidateOutcome["kind"],
  reason: DevSquadAdoWatchReasonCode,
  extra?: {
    readonly revision?: number | null;
    readonly cursorChanges?: readonly DevSquadAdoWatchObservationKind[];
    readonly ledgerErrorKind?: DevSquadAdoWatchLedgerErrorKind | null;
  },
): DevSquadAdoWatchCandidateOutcome => ({
  workItemId: state.workItemId,
  kind,
  reason,
  revision: extra?.revision ?? null,
  sourceRevision: state.sourceRevision,
  cursorChanges: extra?.cursorChanges ?? [],
  skippedCursorKinds: state.skippedCursorKinds,
  claim: state.claim === null ? null : claimMetadata(state.claim),
  ledgerErrorKind: extra?.ledgerErrorKind ?? null,
  cleanup: state.cleanup,
});

/**
 * Release a held claim on every exit path.
 *
 * Retain authority through validation and never retry cleanup. Inclusive lease
 * expiry is the backstop when acknowledgement is unavailable.
 */
const releaseClaim = async (
  context: PassContext,
  state: CandidateState,
): Promise<void> => {
  const claim = state.claim;
  if (claim === null) return;
  const released = await callLedger(() =>
    context.ledger.releaseClaim({
      workItemId: state.workItemId,
      operationId: deriveDevSquadAdoWatcherOperationId({
        step: "release",
        passId: context.validated.passId,
        workItemId: state.workItemId,
        ordinal: 0,
        claimEpoch: claim.claimEpoch,
      }),
      authority: {
        ownerId: claim.ownerId,
        claimToken: claim.claimToken,
        fencingValue: claim.fencingValue,
      },
    }),
  );
  state.claim = null;
  state.cleanup =
    released.status === "ok"
      ? {
          status: "released",
          reason: "release-acknowledged",
          ledgerErrorKind: null,
          acceptedRevision: released.value.acceptedRevision,
        }
      : released.status === "fault"
        ? {
            status: "indeterminate",
            reason: "release-indeterminate",
            ledgerErrorKind: LEDGER_FAULT_KIND,
            acceptedRevision: null,
          }
        : {
            status: isAmbiguous(released.error) ? "indeterminate" : "failed",
            reason: isAmbiguous(released.error)
              ? "release-indeterminate"
              : "release-rejected",
            ledgerErrorKind: released.error.kind,
            acceptedRevision: null,
          };
  if (state.resolved !== null)
    state.resolved = withCleanup(state.resolved, state.cleanup);
};

const withCleanup = (
  outcome: DevSquadAdoWatchCandidateOutcome,
  cleanup: DevSquadAdoWatchCleanup,
): DevSquadAdoWatchCandidateOutcome => {
  if (
    (cleanup.status === "failed" || cleanup.status === "indeterminate") &&
    outcome.kind !== "failed"
  )
    return {
      ...outcome,
      cleanup,
      kind: "failed",
      reason:
        cleanup.ledgerErrorKind === LEDGER_FAULT_KIND
          ? "ledger-unavailable"
          : "claim-cleanup-unconfirmed",
      ledgerErrorKind: cleanup.ledgerErrorKind,
    };
  return { ...outcome, cleanup };
};

const resolveCandidate = async (
  context: PassContext,
  state: CandidateState,
  kind: DevSquadAdoWatchCandidateOutcome["kind"],
  reason: DevSquadAdoWatchReasonCode,
  extra?: {
    readonly revision?: number | null;
    readonly cursorChanges?: readonly DevSquadAdoWatchObservationKind[];
    readonly ledgerErrorKind?: DevSquadAdoWatchLedgerErrorKind | null;
  },
): Promise<void> => {
  state.resolved = outcomeFor(state, kind, reason, extra);
  state.pendingCheckpoint = null;
  await releaseClaim(context, state);
};

/** Map a read failure to a stable candidate outcome without leaking payloads. */
const mapReadError = (
  error: DevSquadAdoLedgerError,
): {
  readonly kind: DevSquadAdoWatchCandidateOutcome["kind"];
  readonly reason: DevSquadAdoWatchReasonCode;
  readonly ledgerErrorKind: DevSquadAdoWatchLedgerErrorKind | null;
} => {
  if (error.kind === "record-not-found")
    return {
      kind: "skipped",
      reason: "record-not-found",
      ledgerErrorKind: null,
    };
  if (error.kind === "capacity-exceeded")
    return {
      kind: "failed",
      reason: "ledger-capacity",
      ledgerErrorKind: "capacity-exceeded",
    };
  return {
    kind: "failed",
    reason: "ledger-recovery",
    ledgerErrorKind: error.kind,
  };
};

/** Map a claim-acquisition failure to a stable candidate outcome. */
const mapAcquireError = (
  error: DevSquadAdoLedgerError,
): {
  readonly kind: DevSquadAdoWatchCandidateOutcome["kind"];
  readonly reason: DevSquadAdoWatchReasonCode;
  readonly ledgerErrorKind: DevSquadAdoWatchLedgerErrorKind | null;
} => {
  switch (error.kind) {
    case "claim-conflict":
      return {
        kind: "skipped",
        reason: "claim-conflict",
        ledgerErrorKind: null,
      };
    case "claim-expired":
      return {
        kind: "skipped",
        reason: "claim-expired",
        ledgerErrorKind: null,
      };
    case "claim-authorization":
      return {
        kind: "skipped",
        reason: "claim-authorization",
        ledgerErrorKind: null,
      };
    case "stale-fencing":
      return {
        kind: "skipped",
        reason: "stale-fencing",
        ledgerErrorKind: null,
      };
    case "idempotency-conflict":
      return {
        kind: "failed",
        reason: "idempotency-conflict",
        ledgerErrorKind: null,
      };
    case "capacity-exceeded":
      return {
        kind: "failed",
        reason: "ledger-capacity",
        ledgerErrorKind: "capacity-exceeded",
      };
    default:
      return {
        kind: "failed",
        reason: "ledger-recovery",
        ledgerErrorKind: error.kind,
      };
  }
};

/**
 * Map a claimed-mutation failure to a stable candidate outcome.
 *
 * `contention` and an `indeterminate` storage outcome are not mapped here:
 * they leave the candidate pending under its existing claim so the identical
 * request can replay on a later poll.
 */
const mapClaimedMutationError = (
  error: DevSquadAdoLedgerError,
): {
  readonly kind: DevSquadAdoWatchCandidateOutcome["kind"];
  readonly reason: DevSquadAdoWatchReasonCode;
  readonly ledgerErrorKind: DevSquadAdoWatchLedgerErrorKind | null;
} => {
  switch (error.kind) {
    case "revision-conflict":
      return {
        kind: "failed",
        reason: "revision-conflict",
        ledgerErrorKind: null,
      };
    case "state-conflict":
      return {
        kind: "failed",
        reason: "state-conflict",
        ledgerErrorKind: null,
      };
    case "idempotency-conflict":
      return {
        kind: "failed",
        reason: "idempotency-conflict",
        ledgerErrorKind: null,
      };
    case "stale-fencing":
      return { kind: "failed", reason: "stale-fencing", ledgerErrorKind: null };
    case "claim-expired":
    case "claim-not-held":
      return { kind: "failed", reason: "claim-expired", ledgerErrorKind: null };
    case "claim-authorization":
      return {
        kind: "failed",
        reason: "claim-authorization",
        ledgerErrorKind: null,
      };
    case "record-not-found":
      return {
        kind: "failed",
        reason: "record-not-found",
        ledgerErrorKind: null,
      };
    case "capacity-exceeded":
      return {
        kind: "failed",
        reason: "ledger-capacity",
        ledgerErrorKind: "capacity-exceeded",
      };
    default:
      return {
        kind: "failed",
        reason: "ledger-recovery",
        ledgerErrorKind: error.kind,
      };
  }
};

const isAmbiguous = (error: DevSquadAdoLedgerError): boolean =>
  error.kind === "contention" ||
  (error.kind === "storage" && error.outcome === "indeterminate");

const pullRequestCursorMatches = (
  left: DevSquadAdoPullRequestCursor | null,
  right: DevSquadAdoPullRequestCursor | null,
): boolean =>
  left === null || right === null
    ? left === right
    : left.threadId === right.threadId && left.commentId === right.commentId;

/**
 * Decide whether an observation is still anchored to durable reality.
 *
 * Compares the record the observation was computed from against the record
 * returned by the acquisition. Only the inputs the selection actually depended
 * on are compared: the two cursor anchors, and the pull-request identity that
 * decided which pull request was observed at all. Phase and status are
 * deliberately excluded — they are read fresh from the claimed record and
 * carried into the checkpoint precondition, so a foreign change to them still
 * conflicts rather than silently passing.
 */
const observationAnchorsMatch = (
  observed: DevSquadAdoWorkflowRecord,
  claimed: DevSquadAdoWorkflowRecord,
): boolean =>
  observed.observations.workItemCommentId ===
    claimed.observations.workItemCommentId &&
  pullRequestCursorMatches(
    observed.observations.pullRequest,
    claimed.observations.pullRequest,
  ) &&
  observed.pullRequest.id === claimed.pullRequest.id;

const reasonForChangedKinds = (
  changedKinds: readonly DevSquadAdoWatchObservationKind[],
): DevSquadAdoWatchReasonCode => {
  if (changedKinds.length > 1) return "new-observations";
  return changedKinds[0] === "pull-request-thread"
    ? "new-pull-request-activity"
    : "new-work-item-comment";
};

/**
 * Finish a candidate whose cursor advance is durable at `acceptedRevision`.
 *
 * The intake decision runs only after the checkpoint response is accepted, so
 * no signal can exist for a cursor that is not durable.
 */
const completeCheckpoint = async (
  context: PassContext,
  state: CandidateState,
  pending: PendingCheckpoint,
  acceptedRevision: number,
  claim: HeldClaim,
): Promise<void> => {
  const admitted =
    context.validated.intakePhases.includes(pending.phase) &&
    context.validated.intakeStatuses.includes(pending.status);

  if (!admitted) {
    state.suppressed = true;
    await resolveCandidate(
      context,
      state,
      "intake-suppressed",
      "intake-rules-unmatched",
      { revision: acceptedRevision, cursorChanges: pending.changedKinds },
    );
    return;
  }

  context.signals.push({
    workItemId: state.workItemId,
    sourceRevision: state.sourceRevision ?? pending.expectedRevision,
    changedKinds: pending.changedKinds,
    phase: pending.phase,
    status: pending.status,
    claim: claimMetadata(claim),
  });
  await resolveCandidate(
    context,
    state,
    "acted",
    reasonForChangedKinds(pending.changedKinds),
    { revision: acceptedRevision, cursorChanges: pending.changedKinds },
  );
};

/**
 * Renew when the inclusive expiry is within the threshold, then checkpoint.
 *
 * The checkpoint always carries the derived `checkpoint` operation identifier,
 * so an already-durable attempt replays instead of duplicating. A renewal
 * advances the record revision, so the optimistic precondition is refreshed
 * from the renewal response before the mutation is issued.
 */
const issueCheckpoint = async (
  context: PassContext,
  state: CandidateState,
  now: Date,
  pending: PendingCheckpoint,
): Promise<void> => {
  const claim = state.claim;
  if (claim === null) {
    await resolveCandidate(context, state, "failed", "claim-expired");
    return;
  }

  if (isAborted(context.signal)) {
    context.cancelled = true;
    await resolveCandidate(context, state, "failed", "cancelled");
    return;
  }

  const expiresAt = Date.parse(claim.expiresAt);
  // An unreadable expiry renews rather than risking a mutation under a lease
  // the watcher cannot reason about.
  if (
    Number.isNaN(expiresAt) ||
    now.getTime() + context.validated.renewalThresholdMs >= expiresAt
  ) {
    state.renewOrdinal += 1;
    const renewed = await callLedger(() =>
      context.ledger.renewClaim({
        workItemId: state.workItemId,
        operationId: deriveDevSquadAdoWatcherOperationId({
          step: "renew",
          passId: context.validated.passId,
          workItemId: state.workItemId,
          ordinal: state.renewOrdinal,
          claimEpoch: claim.claimEpoch,
        }),
        authority: {
          ownerId: claim.ownerId,
          claimToken: claim.claimToken,
          fencingValue: claim.fencingValue,
        },
        leaseDurationMs: context.validated.leaseDurationMs,
      }),
    );
    if (renewed.status === "fault") {
      await resolveCandidate(context, state, "failed", "ledger-unavailable", {
        ledgerErrorKind: LEDGER_FAULT_KIND,
      });
      return;
    }
    if (renewed.status === "error") {
      const mapped = mapClaimedMutationError(renewed.error);
      await resolveCandidate(context, state, mapped.kind, mapped.reason, {
        ledgerErrorKind: mapped.ledgerErrorKind,
      });
      return;
    }
    claim.expiresAt = renewed.value.outcome.claim.expiresAt;
    pending.expectedRevision = renewed.value.record.revision;
  }

  if (isAborted(context.signal)) {
    context.cancelled = true;
    await resolveCandidate(context, state, "failed", "cancelled");
    return;
  }

  const request: CheckpointDevSquadAdoWorkflowInput = {
    workItemId: state.workItemId,
    operationId: pending.operationId,
    authority: {
      ownerId: claim.ownerId,
      claimToken: claim.claimToken,
      fencingValue: claim.fencingValue,
    },
    expected: {
      revision: pending.expectedRevision,
      phase: pending.phase,
      status: pending.status,
    },
    patch: pending.patch,
  };
  pending.submittedRequest = structuredClone(request);
  const checkpointed = await callLedger(() =>
    context.ledger.checkpoint(request),
  );

  if (checkpointed.status === "fault") {
    // The claim is still held here, so resolution — not an escaping throw — is
    // what gets it released.
    await resolveCandidate(context, state, "failed", "ledger-unavailable", {
      ledgerErrorKind: LEDGER_FAULT_KIND,
    });
    return;
  }
  if (checkpointed.status === "error") {
    if (isAmbiguous(checkpointed.error)) {
      state.pendingReason = "checkpoint-indeterminate";
      return;
    }
    const mapped = mapClaimedMutationError(checkpointed.error);
    await resolveCandidate(context, state, mapped.kind, mapped.reason, {
      ledgerErrorKind: mapped.ledgerErrorKind,
    });
    return;
  }

  await completeCheckpoint(
    context,
    state,
    pending,
    checkpointed.value.acceptedRevision,
    claim,
  );
};

/**
 * Retry an ambiguous checkpoint on a later poll under the same held claim.
 *
 * The durable checkpoint history is consulted first: if the derived operation
 * identifier is already recorded, the earlier attempt was durable and the
 * candidate completes from that entry instead of mutating again. Otherwise the
 * generation was never published, so re-issuing the same operation identifier
 * against the current revision cannot duplicate anything.
 */
const resumeCheckpoint = async (
  context: PassContext,
  state: CandidateState,
  now: Date,
  pending: PendingCheckpoint,
): Promise<void> => {
  const claim = state.claim;
  if (claim === null) {
    await resolveCandidate(context, state, "failed", "claim-expired");
    return;
  }
  const read = await callLedger(() =>
    context.ledger.readRecord(state.workItemId),
  );
  if (read.status === "fault") {
    await resolveCandidate(context, state, "failed", "ledger-unavailable", {
      ledgerErrorKind: LEDGER_FAULT_KIND,
    });
    return;
  }
  if (read.status === "error") {
    state.initialReadMissing =
      state.sourceRevision === null && read.error.kind === "record-not-found";
    const mapped = mapReadError(read.error);
    await resolveCandidate(context, state, mapped.kind, mapped.reason, {
      ledgerErrorKind: mapped.ledgerErrorKind,
    });
    return;
  }
  const durable = read.value.checkpoints.find(
    (checkpoint) => checkpoint.operationId === pending.operationId,
  );
  if (durable !== undefined) {
    if (
      pending.submittedRequest === null ||
      !isDevSquadAdoWatcherCheckpointHistoryValid(
        pending.submittedRequest,
        read.value,
        durable,
      )
    ) {
      await resolveCandidate(context, state, "failed", "ledger-unavailable", {
        ledgerErrorKind: LEDGER_FAULT_KIND,
      });
      return;
    }
    await completeCheckpoint(context, state, pending, durable.revision, claim);
    return;
  }
  pending.expectedRevision = read.value.revision;
  await issueCheckpoint(context, state, now, pending);
};

/** Run the common claimed/fenced observation step, retaining pending recovery. */
export const runCandidateStep = async (
  context: PassContext,
  state: CandidateState,
  now: Date,
): Promise<void> => {
  if (isAborted(context.signal)) {
    context.cancelled = true;
    state.pendingReason = "cancelled";
    if (state.claim !== null)
      await resolveCandidate(context, state, "failed", "cancelled");
    return;
  }
  state.examined = true;

  const pending = state.pendingCheckpoint;
  if (pending !== null && state.claim !== null) {
    await resumeCheckpoint(context, state, now, pending);
    return;
  }

  const read = await callLedger(() =>
    context.ledger.readRecord(state.workItemId),
  );
  if (read.status === "fault") {
    await resolveCandidate(context, state, "failed", "ledger-unavailable", {
      ledgerErrorKind: LEDGER_FAULT_KIND,
    });
    return;
  }
  if (read.status === "error") {
    state.initialReadMissing =
      state.sourceRevision === null && read.error.kind === "record-not-found";
    const mapped = mapReadError(read.error);
    await resolveCandidate(context, state, mapped.kind, mapped.reason, {
      ledgerErrorKind: mapped.ledgerErrorKind,
    });
    return;
  }
  const record = read.value;
  state.sourceRevision = record.revision;

  const activeClaim = record.activeClaim;
  if (
    activeClaim !== null &&
    activeClaim.ownerId !== context.validated.ownerId
  ) {
    const expiresAt = Date.parse(activeClaim.expiresAt);
    // An unreadable expiry is treated as unexpired: a foreign claim is never
    // stepped over on the strength of a timestamp the watcher cannot parse.
    if (Number.isNaN(expiresAt) || now.getTime() < expiresAt) {
      await resolveCandidate(context, state, "skipped", "claim-conflict");
      return;
    }
  }

  if (isAborted(context.signal)) {
    context.cancelled = true;
    state.pendingReason = "cancelled";
    return;
  }

  const observed = await observeDevSquadAdoWatchCandidate({
    seam: context.seam,
    mode: context.mode,
    record,
    observationTimeoutMs: context.validated.observationTimeoutMs,
    delay: context.delay,
    signal: context.signal,
  });
  if (!observed.ok) {
    if (observed.reason === "cancelled") {
      context.cancelled = true;
      await resolveCandidate(context, state, "failed", "cancelled");
      return;
    }
    await resolveCandidate(context, state, "failed", observed.reason);
    return;
  }
  const selection = observed.value;
  state.skippedCursorKinds = selection.skippedCursorKinds;

  const changedKinds: DevSquadAdoWatchObservationKind[] = [];
  const observations: {
    workItemCommentId?: string;
    pullRequest?: DevSquadAdoPullRequestCursor;
  } = {};
  if (selection.nextWorkItemCommentId !== null) {
    changedKinds.push("work-item-comment");
    observations.workItemCommentId = selection.nextWorkItemCommentId;
  }
  if (selection.nextPullRequestCursor !== null) {
    changedKinds.push("pull-request-thread");
    observations.pullRequest = selection.nextPullRequestCursor;
  }

  if (changedKinds.length === 0) {
    state.pendingReason =
      selection.newWorkItemCommentIds.length === 0 &&
      selection.skippedCursorKinds.includes("pull-request-thread")
        ? "incomplete-pull-request-cursor"
        : "no-new-observations";
    return;
  }
  state.eligible = true;

  if (isAborted(context.signal)) {
    context.cancelled = true;
    state.pendingReason = "cancelled";
    return;
  }

  const claimEpoch = mintDevSquadAdoWatcherClaimEpoch();
  const acquired = await callLedger(() =>
    context.ledger.acquireClaim({
      workItemId: state.workItemId,
      operationId: deriveDevSquadAdoWatcherOperationId({
        step: "claim",
        passId: context.validated.passId,
        workItemId: state.workItemId,
        ordinal: 0,
        claimEpoch,
      }),
      ownerId: context.validated.ownerId,
      claimToken: randomBytes(32).toString("base64url"),
      leaseDurationMs: context.validated.leaseDurationMs,
    }),
  );
  if (acquired.status === "fault") {
    state.cleanup = {
      status: "indeterminate",
      reason: "authority-unvalidated",
      ledgerErrorKind: LEDGER_FAULT_KIND,
      acceptedRevision: null,
    };
    // No claim was recorded locally, so there is nothing to release; if the
    // ledger did publish one before faulting, its lease expiry retires it.
    await resolveCandidate(context, state, "failed", "ledger-unavailable", {
      ledgerErrorKind: LEDGER_FAULT_KIND,
    });
    return;
  }
  if (acquired.status === "error") {
    if (isAmbiguous(acquired.error))
      state.cleanup = {
        status: "indeterminate",
        reason: "authority-unvalidated",
        ledgerErrorKind: acquired.error.kind,
        acceptedRevision: null,
      };
    const mapped = mapAcquireError(acquired.error);
    await resolveCandidate(context, state, mapped.kind, mapped.reason, {
      ledgerErrorKind: mapped.ledgerErrorKind,
    });
    return;
  }

  const authority = acquired.value.outcome.authority;
  state.claim = {
    claimToken: authority.claimToken,
    ownerId: authority.ownerId,
    fencingValue: authority.fencingValue,
    claimEpoch,
    expiresAt: authority.expiresAt,
  };
  state.renewOrdinal = 0;
  const claimed = acquired.value.record;

  // The observation was anchored to the record read *before* the claim. Another
  // owner can acquire, advance the cursor, and release inside that window, and
  // the acquisition here would still succeed. Checkpointing the pre-claim
  // selection would then write a cursor derived from anchors that are no longer
  // durable — moving the cursor backwards and re-delivering everything between
  // the two positions. The advance is only safe if the anchors it was computed
  // from survived the acquisition unchanged.
  if (!observationAnchorsMatch(record, claimed)) {
    state.eligible = false;
    state.skippedCursorKinds = [];
    state.pendingReason = "stale-observation";
    const stale = outcomeFor(state, "no-change", "stale-observation");
    await releaseClaim(context, state);
    if (state.cleanup.status !== "released")
      state.resolved = withCleanup(stale, state.cleanup);
    return;
  }

  const generation: DevSquadAdoWatcherObservationGeneration = {
    fromWorkItemCommentId: record.observations.workItemCommentId,
    fromPullRequest: record.observations.pullRequest,
    toWorkItemCommentId: selection.nextWorkItemCommentId,
    toPullRequest: selection.nextPullRequestCursor,
  };
  const checkpoint: PendingCheckpoint = {
    operationId: deriveDevSquadAdoWatcherOperationId({
      step: "checkpoint",
      passId: context.validated.passId,
      workItemId: state.workItemId,
      ordinal: 0,
      generation,
    }),
    expectedRevision: claimed.revision,
    submittedRequest: null,
    patch: { observations },
    changedKinds,
    phase: claimed.phase,
    status: claimed.status,
  };
  state.pendingCheckpoint = checkpoint;
  await issueCheckpoint(context, state, now, checkpoint);
};

/**
 * Run exactly one bounded, offline, deterministic watch pass.
 *
 * See {@link runDevSquadAdoWorkflowWatchPass} for the public contract.
 */
export const runDevSquadAdoWorkflowWatchPassImplementation = async (
  input: RunDevSquadAdoWorkflowWatchPassOptions,
): Promise<DevSquadAdoWatchPassOutcome> => {
  const validation = prepareDevSquadAdoWorkflowWatchPassOptions(input);
  if (!validation.ok) return { ok: false, error: validation.error };
  const validated = validation.value;
  const options = validation.options;

  const startedAtDate = readClock(options.clock);
  if (startedAtDate === null) {
    return {
      ok: false,
      error: {
        kind: "validation",
        field: "clock",
        reason: "must return a valid Date",
      },
    };
  }

  const context: PassContext = {
    ledger: guardDevSquadAdoWatcherLedger(options.ledger),
    seam: options.seam,
    mode: "supplied",
    validated,
    delay: options.delay,
    signal: options.signal,
    signals: [],
    cancelled: false,
  };

  const states = new Map<string, CandidateState>();
  for (const workItemId of validated.candidates) {
    states.set(workItemId, createWatcherCandidateState(workItemId));
  }

  let lastReading = startedAtDate;
  let polls = 0;
  let stopReason: DevSquadAdoWatchStopReason = "candidates-resolved";

  for (;;) {
    if (isAborted(options.signal)) {
      context.cancelled = true;
      stopReason = "cancelled";
      break;
    }
    if (polls >= validated.maxPolls) {
      stopReason = "poll-budget-exhausted";
      break;
    }
    const now = readClock(options.clock);
    if (now === null) {
      // The pass cannot establish that another poll is within budget, so it
      // stops scheduling work and finalizes on the last usable reading.
      stopReason = "poll-start-budget-exhausted";
      break;
    }
    lastReading = now;
    if (
      polls > 0 &&
      now.getTime() - startedAtDate.getTime() >= validated.maxPollStartElapsedMs
    ) {
      stopReason = "poll-start-budget-exhausted";
      break;
    }
    polls += 1;

    for (const workItemId of validated.candidates) {
      const state = states.get(workItemId);
      if (state === undefined || state.resolved !== null) continue;
      await runCandidateStep(context, state, now);
      if (isAborted(context.signal)) context.cancelled = true;
      if (context.cancelled) break;
    }

    if (context.cancelled) {
      stopReason = "cancelled";
      break;
    }
    if (
      validated.candidates.every(
        (workItemId) => states.get(workItemId)?.resolved !== null,
      )
    ) {
      stopReason = "candidates-resolved";
      break;
    }
    if (polls >= validated.maxPolls) {
      stopReason = "poll-budget-exhausted";
      break;
    }
    if (isAborted(options.signal)) {
      context.cancelled = true;
      stopReason = "cancelled";
      break;
    }

    try {
      await options.delay(
        computeDevSquadAdoWatcherBackoffDelayMs({
          pollIndex: polls,
          baseIntervalMs: validated.baseIntervalMs,
          multiplier: validated.multiplier,
          maxIntervalMs: validated.maxIntervalMs,
          jitter: options.backoff?.jitter,
        }),
        options.signal,
      );
    } catch {
      context.cancelled = true;
      stopReason = "cancelled";
      break;
    }
  }

  const outcomes: DevSquadAdoWatchCandidateOutcome[] = [];
  for (const workItemId of validated.candidates) {
    const state = states.get(workItemId);
    if (state === undefined) continue;
    if (state.resolved === null) {
      if (state.claim !== null) {
        state.resolved = outcomeFor(
          state,
          "failed",
          context.cancelled ? "cancelled" : "checkpoint-indeterminate",
        );
        state.pendingCheckpoint = null;
        await releaseClaim(context, state);
      } else {
        state.resolved = outcomeFor(
          state,
          "no-change",
          context.cancelled && !state.examined
            ? "cancelled"
            : state.pendingReason,
        );
      }
    }
    outcomes.push(withCleanup(state.resolved, state.cleanup));
    if (isAborted(context.signal)) {
      context.cancelled = true;
      stopReason = "cancelled";
    }
  }

  const counts = {
    examined: outcomes.filter(
      (outcome) => states.get(outcome.workItemId)?.examined === true,
    ).length,
    eligible: outcomes.filter(
      (outcome) => states.get(outcome.workItemId)?.eligible === true,
    ).length,
    acted: context.signals.length,
    noChange: outcomes.filter((outcome) => outcome.kind === "no-change").length,
    suppressed: outcomes.filter(
      (outcome) => states.get(outcome.workItemId)?.suppressed === true,
    ).length,
    skipped: outcomes.filter((outcome) => outcome.kind === "skipped").length,
    failed: outcomes.filter((outcome) => outcome.kind === "failed").length,
    cleanupReleased: outcomes.filter(
      (outcome) => outcome.cleanup.status === "released",
    ).length,
    cleanupFailed: outcomes.filter(
      (outcome) => outcome.cleanup.status === "failed",
    ).length,
    cleanupIndeterminate: outcomes.filter(
      (outcome) => outcome.cleanup.status === "indeterminate",
    ).length,
    cleanupNotRequired: outcomes.filter(
      (outcome) => outcome.cleanup.status === "not-required",
    ).length,
  };

  return {
    ok: true,
    value: {
      passId: validated.passId,
      ownerId: validated.ownerId,
      stopReason,
      polls,
      startedAt: startedAtDate.toISOString(),
      completedAt: lastReading.toISOString(),
      counts,
      outcomes,
      signals: [...context.signals],
    },
  };
};

/** W040: shared state construction; discovery never forks checkpoint authority. */
export const createWatcherCandidateState = (
  workItemId: string,
): CandidateState => ({
  workItemId,
  resolved: null,
  examined: false,
  initialReadMissing: false,
  eligible: false,
  pendingReason: "no-new-observations",
  sourceRevision: null,
  skippedCursorKinds: [],
  claim: null,
  renewOrdinal: 0,
  pendingCheckpoint: null,
  cleanup: {
    status: "not-required",
    reason: "no-claim-acquired",
    ledgerErrorKind: null,
    acceptedRevision: null,
  },
  suppressed: false,
});
/** W040: shared finalization preserves mandatory cleanup and accepted effects. */
export const finalizeWatcherCandidate = async (
  context: PassContext,
  state: CandidateState,
): Promise<DevSquadAdoWatchCandidateOutcome> => {
  // W044 / FR-052: an earlier candidate's awaited cleanup may abort the
  // parent. Read it afresh without retracting already acknowledged outcomes.
  if (isAborted(context.signal)) context.cancelled = true;
  if (state.resolved === null) {
    state.resolved = outcomeFor(
      state,
      state.claim !== null ? "failed" : "no-change",
      state.claim !== null
        ? context.cancelled
          ? "cancelled"
          : "checkpoint-indeterminate"
        : state.pendingReason,
    );
    state.pendingCheckpoint = null;
    await releaseClaim(context, state);
  }
  return withCleanup(state.resolved, state.cleanup);
};
