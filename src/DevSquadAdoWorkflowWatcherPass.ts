import { randomBytes } from "node:crypto";
import type {
  DevSquadAdoLedgerError,
  DevSquadAdoPullRequestCursor,
  DevSquadAdoWorkflowLedger,
} from "./DevSquadAdoWorkflowLedger.js";
import type {
  DevSquadAdoWatchCandidateOutcome,
  DevSquadAdoWatchClaimMetadata,
  DevSquadAdoWatchIntakeSignal,
  DevSquadAdoWatchObservationKind,
  DevSquadAdoWatchPassOutcome,
  DevSquadAdoWatchReasonCode,
  DevSquadAdoWatchStopReason,
  DevSquadAdoWatchValidatedPass,
  DevSquadAdoWatcherObservationSeam,
  RunDevSquadAdoWorkflowWatchPassOptions,
} from "./DevSquadAdoWorkflowWatcher.js";
import { observeDevSquadAdoWatchCandidate } from "./DevSquadAdoWorkflowWatcherObservation.js";
import {
  computeDevSquadAdoWatcherBackoffDelayMs,
  deriveDevSquadAdoWatcherOperationId,
  validateDevSquadAdoWorkflowWatchPassOptions,
} from "./DevSquadAdoWorkflowWatcherValidation.js";

interface HeldClaim {
  readonly claimToken: string;
  readonly ownerId: string;
  readonly fencingValue: number;
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

interface CandidateState {
  readonly workItemId: string;
  resolved: DevSquadAdoWatchCandidateOutcome | null;
  examined: boolean;
  eligible: boolean;
  pendingReason: DevSquadAdoWatchReasonCode;
  sourceRevision: number | null;
  skippedCursorKinds: readonly DevSquadAdoWatchObservationKind[];
  claim: HeldClaim | null;
  renewOrdinal: number;
  pendingCheckpoint: PendingCheckpoint | null;
}

interface PassContext {
  readonly ledger: DevSquadAdoWorkflowLedger;
  readonly seam: DevSquadAdoWatcherObservationSeam;
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
    readonly ledgerErrorKind?: string | null;
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
});

/**
 * Release a held claim on every exit path.
 *
 * Release failure never changes the reported outcome; the inclusive lease
 * expiry is the backstop. Cancellation never suppresses a release, because a
 * cancelled pass must still leave no watcher-held claim behind.
 */
const releaseClaim = async (
  context: PassContext,
  state: CandidateState,
): Promise<void> => {
  const claim = state.claim;
  if (claim === null) return;
  state.claim = null;
  try {
    await context.ledger.releaseClaim({
      workItemId: state.workItemId,
      operationId: deriveDevSquadAdoWatcherOperationId({
        passId: context.validated.passId,
        workItemId: state.workItemId,
        step: "release",
        ordinal: 0,
      }),
      authority: {
        ownerId: claim.ownerId,
        claimToken: claim.claimToken,
        fencingValue: claim.fencingValue,
      },
    });
  } catch {
    /* Release is best-effort; the lease expiry is the backstop. */
  }
};

const resolveCandidate = async (
  context: PassContext,
  state: CandidateState,
  kind: DevSquadAdoWatchCandidateOutcome["kind"],
  reason: DevSquadAdoWatchReasonCode,
  extra?: {
    readonly revision?: number | null;
    readonly cursorChanges?: readonly DevSquadAdoWatchObservationKind[];
    readonly ledgerErrorKind?: string | null;
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
  readonly ledgerErrorKind: string | null;
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
  readonly ledgerErrorKind: string | null;
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
  readonly ledgerErrorKind: string | null;
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
    const renewed = await context.ledger.renewClaim({
      workItemId: state.workItemId,
      operationId: deriveDevSquadAdoWatcherOperationId({
        passId: context.validated.passId,
        workItemId: state.workItemId,
        step: "renew",
        ordinal: state.renewOrdinal,
      }),
      authority: {
        ownerId: claim.ownerId,
        claimToken: claim.claimToken,
        fencingValue: claim.fencingValue,
      },
      leaseDurationMs: context.validated.leaseDurationMs,
    });
    if (!renewed.ok) {
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

  const checkpointed = await context.ledger.checkpoint({
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
  });

  if (!checkpointed.ok) {
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
  const read = await context.ledger.readRecord(state.workItemId);
  if (!read.ok) {
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
    await completeCheckpoint(context, state, pending, durable.revision, claim);
    return;
  }
  pending.expectedRevision = read.value.revision;
  await issueCheckpoint(context, state, now, pending);
};

const runCandidateStep = async (
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

  const read = await context.ledger.readRecord(state.workItemId);
  if (!read.ok) {
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
    record,
    observationTimeoutMs: context.validated.observationTimeoutMs,
    delay: context.delay,
    signal: context.signal,
  });
  if (!observed.ok) {
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

  const acquired = await context.ledger.acquireClaim({
    workItemId: state.workItemId,
    operationId: deriveDevSquadAdoWatcherOperationId({
      passId: context.validated.passId,
      workItemId: state.workItemId,
      step: "claim",
      ordinal: 0,
    }),
    ownerId: context.validated.ownerId,
    claimToken: randomBytes(32).toString("base64url"),
    leaseDurationMs: context.validated.leaseDurationMs,
  });
  if (!acquired.ok) {
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
    expiresAt: authority.expiresAt,
  };
  const claimed = acquired.value.record;
  const checkpoint: PendingCheckpoint = {
    operationId: deriveDevSquadAdoWatcherOperationId({
      passId: context.validated.passId,
      workItemId: state.workItemId,
      step: "checkpoint",
      ordinal: 0,
    }),
    expectedRevision: claimed.revision,
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
  options: RunDevSquadAdoWorkflowWatchPassOptions,
): Promise<DevSquadAdoWatchPassOutcome> => {
  const validation = validateDevSquadAdoWorkflowWatchPassOptions(options);
  if (!validation.ok) return { ok: false, error: validation.error };
  const validated = validation.value;

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
    ledger: options.ledger,
    seam: options.seam,
    validated,
    delay: options.delay,
    signal: options.signal,
    signals: [],
    cancelled: false,
  };

  const states = new Map<string, CandidateState>();
  for (const workItemId of validated.candidates) {
    states.set(workItemId, {
      workItemId,
      resolved: null,
      examined: false,
      eligible: false,
      pendingReason: "no-new-observations",
      sourceRevision: null,
      skippedCursorKinds: [],
      claim: null,
      renewOrdinal: 0,
      pendingCheckpoint: null,
    });
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
      stopReason = "duration-budget-exhausted";
      break;
    }
    lastReading = now;
    if (
      polls > 0 &&
      now.getTime() - startedAtDate.getTime() >= validated.maxPassDurationMs
    ) {
      stopReason = "duration-budget-exhausted";
      break;
    }
    polls += 1;

    for (const workItemId of validated.candidates) {
      const state = states.get(workItemId);
      if (state === undefined || state.resolved !== null) continue;
      await runCandidateStep(context, state, now);
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
    outcomes.push(state.resolved);
  }

  const counts = {
    examined: outcomes.filter(
      (outcome) => states.get(outcome.workItemId)?.examined === true,
    ).length,
    eligible: outcomes.filter(
      (outcome) => states.get(outcome.workItemId)?.eligible === true,
    ).length,
    acted: outcomes.filter((outcome) => outcome.kind === "acted").length,
    noChange: outcomes.filter((outcome) => outcome.kind === "no-change").length,
    suppressed: outcomes.filter(
      (outcome) => outcome.kind === "intake-suppressed",
    ).length,
    skipped: outcomes.filter((outcome) => outcome.kind === "skipped").length,
    failed: outcomes.filter((outcome) => outcome.kind === "failed").length,
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
