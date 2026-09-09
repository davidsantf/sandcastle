import type {
  DevSquadAdoPullRequestCursor,
  DevSquadAdoWorkflowLedger,
  DevSquadAdoWorkItemId,
} from "./DevSquadAdoWorkflowLedger.js";
import { runDevSquadAdoWorkflowWatchPassImplementation } from "./DevSquadAdoWorkflowWatcherPass.js";

export {
  deriveDevSquadAdoWatcherOperationId,
  validateDevSquadAdoWorkflowWatchPassOptions,
} from "./DevSquadAdoWorkflowWatcherValidation.js";

/** Observation-seam method names the watcher may structurally require. */
export type DevSquadAdoWatcherSeamMethodName =
  | "observeWorkItemComments"
  | "observePullRequestActivity";

/**
 * Structured pass-level failure detected before any observation or mutation.
 *
 * Cancellation, budget exhaustion, and per-candidate failures never use this
 * channel; they resolve as `ok: true` with a stop reason and full outcomes.
 */
export type DevSquadAdoWatchError =
  | {
      /** Option validation failure category. */
      readonly kind: "validation";
      /** Stable dotted field path of the first offending option. */
      readonly field: string;
      /** Stable redacted validation reason. */
      readonly reason: string;
    }
  | {
      /** Injected-seam structural failure category. */
      readonly kind: "seam-contract";
      /** Offending seam method name. */
      readonly method: DevSquadAdoWatcherSeamMethodName;
      /** Whether the method was absent or present but not callable. */
      readonly reason: "missing" | "not-a-function";
    };

/** Input for one work-item comment observation. */
export interface DevSquadAdoWatcherWorkItemObservationInput {
  /** Canonical ledger work-item identifier. */
  readonly workItemId: string;
  /** Persisted opaque comment cursor, or null when none is durable yet. */
  readonly sinceCommentId: string | null;
  /** Cooperative cancellation signal propagated from the pass. */
  readonly signal?: AbortSignal;
}

/** Ordered opaque work-item comment identifiers returned by the seam. */
export interface DevSquadAdoWatcherWorkItemObservation {
  /** Tracker-ordered opaque comment identifiers, oldest first. */
  readonly commentIds: readonly string[];
}

/** Input for one pull-request activity observation. */
export interface DevSquadAdoWatcherPullRequestObservationInput {
  /** Canonical ledger work-item identifier. */
  readonly workItemId: string;
  /** Opaque pull-request identifier persisted on the record. */
  readonly pullRequestId: string;
  /** Persisted opaque thread/comment cursor, or null when none is durable. */
  readonly sinceCursor: DevSquadAdoPullRequestCursor | null;
  /** Cooperative cancellation signal propagated from the pass. */
  readonly signal?: AbortSignal;
}

/** One opaque pull-request activity entry returned by the seam. */
export interface DevSquadAdoWatcherPullRequestObservationEntry {
  /** Opaque tracker thread identifier. */
  readonly threadId: string;
  /** Opaque tracker comment identifier; absent entries are never persisted. */
  readonly commentId?: string | null;
}

/** Ordered opaque pull-request activity entries returned by the seam. */
export interface DevSquadAdoWatcherPullRequestObservation {
  /** Tracker-ordered activity entries, oldest first. */
  readonly entries: readonly DevSquadAdoWatcherPullRequestObservationEntry[];
}

/**
 * Read-oriented seam through which every external observation passes.
 *
 * Entries must be returned in the tracker's authoritative order, oldest first.
 * The seam either includes the supplied `since` cursor as the first entry or
 * returns only entries strictly after it. The watcher reads only the
 * identifier fields declared above and discards every other property.
 *
 * The anchored entry must stay retrievable for as long as it is a cursor: the
 * watcher compares anchors by equality alone and never parses or orders an
 * identifier, so a response that can no longer contain the anchor is
 * indistinguishable from a post-cursor window and every entry is treated as
 * new. Honouring that obligation is what keeps delivery non-duplicating.
 */
export interface DevSquadAdoWatcherObservationSeam {
  /** Required: observe opaque work-item comment identifiers. */
  readonly observeWorkItemComments: (
    input: DevSquadAdoWatcherWorkItemObservationInput,
  ) => Promise<DevSquadAdoWatcherWorkItemObservation>;
  /** Optional: required only for candidates carrying a pull-request id. */
  readonly observePullRequestActivity?: (
    input: DevSquadAdoWatcherPullRequestObservationInput,
  ) => Promise<DevSquadAdoWatcherPullRequestObservation>;
}

/** Observation kinds the watcher tracks with independent durable cursors. */
export type DevSquadAdoWatchObservationKind =
  | "work-item-comment"
  | "pull-request-thread";

/** Caller-owned exact-match sets that admit an intake signal. */
export interface DevSquadAdoWatchIntakeRules {
  /** Exact phases admitted for intake; no wildcard is supported. */
  readonly phases: readonly string[];
  /** Exact statuses admitted for intake; no wildcard is supported. */
  readonly statuses: readonly string[];
}

/** Caller-declared bounds that guarantee pass termination. */
export interface DevSquadAdoWatchBudgets {
  /** Maximum polls performed by the pass; positive integer up to 10,000. */
  readonly maxPolls: number;
  /** Maximum pass duration in milliseconds, measured on the injected clock. */
  readonly maxPassDurationMs: number;
  /** Per-observation timeout in milliseconds, enforced via injected delay. */
  readonly observationTimeoutMs: number;
}

/** Claim lease sizing for watcher-owned mutations. */
export interface DevSquadAdoWatchLeaseConfig {
  /** Lease duration in milliseconds; defaults to 60,000, capped at 24 hours. */
  readonly leaseDurationMs?: number;
  /** Renewal threshold below the lease; defaults to one third of the lease. */
  readonly renewalThresholdMs?: number;
}

/** Deterministic between-poll backoff configuration. */
export interface DevSquadAdoWatchBackoffConfig {
  /** First interval in milliseconds; defaults to 1,000. */
  readonly baseIntervalMs?: number;
  /** Growth multiplier at least 1; defaults to 2. */
  readonly multiplier?: number;
  /** Interval ceiling in milliseconds; defaults to 30,000. */
  readonly maxIntervalMs?: number;
  /** Optional injected jitter; the only source of randomness permitted. */
  readonly jitter?: (baseDelayMs: number, pollIndex: number) => number;
}

/** Complete description of one bounded watch pass. */
export interface RunDevSquadAdoWorkflowWatchPassOptions {
  /** Opened repository-local workflow ledger. */
  readonly ledger: DevSquadAdoWorkflowLedger;
  /** Injected read-oriented observation seam. */
  readonly seam: DevSquadAdoWatcherObservationSeam;
  /** Caller-supplied stable pass identity used to derive operation ids. */
  readonly passId: string;
  /** Diagnostic coordinator identity used for ledger claims. */
  readonly ownerId: string;
  /** Work items to examine; deduplicated and canonically ordered. */
  readonly candidates: readonly DevSquadAdoWorkItemId[];
  /** Exact-match phase and status sets that admit intake signals. */
  readonly intakeRules: DevSquadAdoWatchIntakeRules;
  /** Poll, duration, and per-observation bounds. */
  readonly budgets: DevSquadAdoWatchBudgets;
  /** Optional claim lease sizing. */
  readonly lease?: DevSquadAdoWatchLeaseConfig;
  /** Optional deterministic backoff configuration. */
  readonly backoff?: DevSquadAdoWatchBackoffConfig;
  /** Injected UTC clock; read exactly once per poll. */
  readonly clock: () => Date;
  /** Injected delay source; the watcher never waits on wall-clock time. */
  readonly delay: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Optional cooperative cancellation signal. */
  readonly signal?: AbortSignal;
}

/** Stable per-candidate outcome discriminator. */
export type DevSquadAdoWatchCandidateOutcomeKind =
  | "acted"
  | "no-change"
  | "intake-suppressed"
  | "skipped"
  | "failed";

/** Stable machine-readable reason for a candidate outcome. */
export type DevSquadAdoWatchReasonCode =
  | "new-work-item-comment"
  | "new-pull-request-activity"
  | "new-observations"
  | "no-new-observations"
  | "intake-rules-unmatched"
  | "incomplete-pull-request-cursor"
  | "record-not-found"
  | "claim-conflict"
  | "claim-expired"
  | "claim-authorization"
  | "stale-fencing"
  | "revision-conflict"
  | "state-conflict"
  | "idempotency-conflict"
  | "checkpoint-indeterminate"
  | "observation-failed"
  | "observation-timeout"
  | "pull-request-observation-unavailable"
  | "invalid-observation-identifier"
  | "ledger-recovery"
  | "ledger-capacity"
  | "cancelled";

/** Stable reason a bounded pass stopped. */
export type DevSquadAdoWatchStopReason =
  | "candidates-resolved"
  | "poll-budget-exhausted"
  | "duration-budget-exhausted"
  | "cancelled";

/** Token-free claim metadata under which a candidate step ran. */
export interface DevSquadAdoWatchClaimMetadata {
  /** Diagnostic owner identifier of the claim. */
  readonly ownerId: string;
  /** Monotonic fencing value carried on every mutation of the step. */
  readonly fencingValue: number;
  /** UTC inclusive lease expiry at the last accepted acquisition or renewal. */
  readonly expiresAt: string;
}

/** Stable per-work-item result of one watch pass. */
export interface DevSquadAdoWatchCandidateOutcome {
  /** Canonical ledger work-item identifier. */
  readonly workItemId: string;
  /** Stable outcome discriminator. */
  readonly kind: DevSquadAdoWatchCandidateOutcomeKind;
  /** Stable reason code; never empty. */
  readonly reason: DevSquadAdoWatchReasonCode;
  /** Durable revision accepted by this pass, or null when nothing mutated. */
  readonly revision: number | null;
  /** Durable revision the decision was derived from, when a record was read. */
  readonly sourceRevision: number | null;
  /** Observation cursors advanced durably by this pass. */
  readonly cursorChanges: readonly DevSquadAdoWatchObservationKind[];
  /** Observation kinds observed but not persistable as a cursor. */
  readonly skippedCursorKinds: readonly DevSquadAdoWatchObservationKind[];
  /** Token-free claim metadata, or null when no claim was acquired. */
  readonly claim: DevSquadAdoWatchClaimMetadata | null;
  /** Stable ledger error category, or null when no ledger error occurred. */
  readonly ledgerErrorKind: string | null;
}

/** Token-free intake proposal handed back to the DevSquad host. */
export interface DevSquadAdoWatchIntakeSignal {
  /** Canonical ledger work-item identifier. */
  readonly workItemId: string;
  /** Durable revision the signal was derived from. */
  readonly sourceRevision: number;
  /** Observation kinds whose cursors advanced durably. */
  readonly changedKinds: readonly DevSquadAdoWatchObservationKind[];
  /** Exact caller-defined phase read from the record. */
  readonly phase: string;
  /** Exact caller-defined status read from the record. */
  readonly status: string;
  /** Token-free claim metadata under which the signal was produced. */
  readonly claim: DevSquadAdoWatchClaimMetadata;
}

/** Pass-level tallies over candidate outcomes. */
export interface DevSquadAdoWatchPassCounts {
  /** Candidates examined at least once. */
  readonly examined: number;
  /** Candidates with at least one new observation relative to their cursor. */
  readonly eligible: number;
  /** Candidates that produced an intake signal. */
  readonly acted: number;
  /** Candidates that resolved without any durable change. */
  readonly noChange: number;
  /** Candidates whose cursors advanced without matching intake rules. */
  readonly suppressed: number;
  /** Candidates skipped before any mutation was attempted. */
  readonly skipped: number;
  /** Candidates that failed in isolation. */
  readonly failed: number;
}

/** Complete token-free result of one bounded watch pass. */
export interface DevSquadAdoWatchPassResult {
  /** Caller-supplied pass identity echoed back for correlation. */
  readonly passId: string;
  /** Diagnostic coordinator identity used for ledger claims. */
  readonly ownerId: string;
  /** Stable reason the pass stopped. */
  readonly stopReason: DevSquadAdoWatchStopReason;
  /** Number of polls performed. */
  readonly polls: number;
  /** UTC pass-start reading of the injected clock. */
  readonly startedAt: string;
  /** UTC reading of the injected clock when the pass stopped. */
  readonly completedAt: string;
  /** Pass-level tallies. */
  readonly counts: DevSquadAdoWatchPassCounts;
  /** Candidate outcomes in canonical work-item order. */
  readonly outcomes: readonly DevSquadAdoWatchCandidateOutcome[];
  /** Intake signals in durable acknowledgement order. */
  readonly signals: readonly DevSquadAdoWatchIntakeSignal[];
}

/** Successful or structurally failed watch pass. */
export type DevSquadAdoWatchPassOutcome =
  | {
      /** Success discriminator. */
      readonly ok: true;
      /** Complete token-free pass result. */
      readonly value: DevSquadAdoWatchPassResult;
    }
  | {
      /** Failure discriminator. */
      readonly ok: false;
      /** Structured pass-level failure. */
      readonly error: DevSquadAdoWatchError;
    };

/** Normalized, defaulted view of validated pass options. */
export interface DevSquadAdoWatchValidatedPass {
  /** Caller-supplied stable pass identity. */
  readonly passId: string;
  /** Diagnostic coordinator identity. */
  readonly ownerId: string;
  /** Canonical, deduplicated, byte-ordered work-item identifiers. */
  readonly candidates: readonly string[];
  /** Exact-match phases admitted for intake. */
  readonly intakePhases: readonly string[];
  /** Exact-match statuses admitted for intake. */
  readonly intakeStatuses: readonly string[];
  /** Maximum polls performed by the pass. */
  readonly maxPolls: number;
  /** Maximum pass duration in milliseconds. */
  readonly maxPassDurationMs: number;
  /** Per-observation timeout in milliseconds. */
  readonly observationTimeoutMs: number;
  /** Resolved claim lease duration in milliseconds. */
  readonly leaseDurationMs: number;
  /** Resolved renewal threshold in milliseconds. */
  readonly renewalThresholdMs: number;
  /** Resolved backoff base interval in milliseconds. */
  readonly baseIntervalMs: number;
  /** Resolved backoff multiplier. */
  readonly multiplier: number;
  /** Resolved backoff interval ceiling in milliseconds. */
  readonly maxIntervalMs: number;
}

/** Result of structurally validating watch pass options. */
export type DevSquadAdoWatchValidationResult =
  | {
      /** Success discriminator. */
      readonly ok: true;
      /** Normalized, defaulted options. */
      readonly value: DevSquadAdoWatchValidatedPass;
    }
  | {
      /** Failure discriminator. */
      readonly ok: false;
      /** First structural failure, with a stable field path or method name. */
      readonly error: DevSquadAdoWatchError;
    };

/** Ledger mutation step whose operation identifier is derived. */
export type DevSquadAdoWatcherOperationStep =
  | "claim"
  | "renew"
  | "checkpoint"
  | "release";

/** Stable identity from which a watcher operation identifier is derived. */
export interface DevSquadAdoWatcherOperationIdentity {
  /** Caller-supplied stable pass identity. */
  readonly passId: string;
  /** Canonical ledger work-item identifier, never the caller's raw input. */
  readonly workItemId: string;
  /** Mutation step being identified. */
  readonly step: DevSquadAdoWatcherOperationStep;
  /** Zero for one-shot steps; the one-based renewal sequence for `renew`. */
  readonly ordinal: number;
}

/**
 * Run exactly one bounded, offline, deterministic watch pass.
 *
 * Every external observation is obtained through the injected seam, every
 * mutation goes through the injected ledger under a fenced claim, and the pass
 * terminates at the first of: all candidates resolved, poll budget reached,
 * duration budget reached, or cancellation.
 *
 * Resolves `ok: false` only for option validation and seam-contract failures
 * detected before any observation or ledger operation.
 */
export const runDevSquadAdoWorkflowWatchPass: (
  options: RunDevSquadAdoWorkflowWatchPassOptions,
) => Promise<DevSquadAdoWatchPassOutcome> =
  runDevSquadAdoWorkflowWatchPassImplementation;
