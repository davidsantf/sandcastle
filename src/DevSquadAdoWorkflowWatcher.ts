import type {
  DevSquadAdoLedgerError,
  DevSquadAdoPullRequestCursor,
  DevSquadAdoWorkflowLedger,
  DevSquadAdoWorkItemId,
} from "./DevSquadAdoWorkflowLedger.js";
import { runDevSquadAdoDiscoveryWatchPass } from "./DevSquadAdoWorkflowWatcherDiscovery.js";
import { inspectDevSquadAdoWatchMode } from "./DevSquadAdoWorkflowWatcherDiscoveryValidation.js";
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
 * Each window is unique and bounded to 1,000 entries and 1,048,576 aggregate
 * UTF-8 identifier bytes, with at most 1,024 bytes per identifier. PR identity
 * is the exact thread/comment pair, normalizing only missing/null comments.
 * The watcher reads only the identifier fields declared above and discards
 * every other property.
 *
 * The window is **anchor-inclusive**: whenever a `since` anchor is supplied and
 * the returned window is non-empty, the anchor itself must appear in it, and
 * only entries after it are treated as new. A seam with nothing new to report
 * may return either the anchor alone or an empty window.
 *
 * That rule is what makes anchor loss detectable. The watcher compares anchors
 * by equality alone and never parses or orders an identifier, so a non-empty
 * window that omits the anchor is indistinguishable from a window in which
 * every entry is new. Rather than re-deliver the whole window, the watcher
 * fails that candidate closed with `observation-anchor-missing`; keeping an
 * anchored entry retrievable for as long as it is a cursor is the seam's
 * obligation.
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

/**
 * Caller-declared scheduling bounds under cooperating dependencies.
 *
 * Poll counts and per-observation timeouts bound scheduling. Ledger methods
 * and delays must settle; abort cannot forcibly stop noncooperating work.
 * The elapsed bound governs scheduling, not wall-clock duration; see
 * {@link DevSquadAdoWatchBudgets.maxPollStartElapsedMs}.
 */
export interface DevSquadAdoWatchBudgets {
  /** Maximum polls performed by the pass; positive integer up to 10,000. */
  readonly maxPolls: number;
  /**
   * Elapsed-time ceiling, in milliseconds, for *starting* another poll.
   *
   * Read once per poll from the injected clock, before the poll begins. Work
   * already in flight — candidate steps, seam observations, ledger mutations —
   * always runs to completion, so a pass can and does overrun this value. It
   * bounds how long the pass keeps scheduling new work, never how long the
   * pass takes. The first poll always starts.
   *
   * For a bound on any single observation use `observationTimeoutMs`; for a
   * scheduling stop use `maxPolls` or cooperative `signal` cancellation.
   */
  readonly maxPollStartElapsedMs: number;
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
  /** Optional injected jitter; the only source of backoff randomness. */
  readonly jitter?: (baseDelayMs: number, pollIndex: number) => number;
}

/** Complete description of one bounded watch pass. */
export interface RunDevSquadAdoWorkflowWatchPassOptions {
  /** Optional explicit legacy arm; discovery configuration is forbidden. */
  readonly mode?: "supplied";
  /** Supplied mode never discovers or initializes records. */
  readonly discovery?: never;
  /** Opened repository-local workflow ledger. */
  readonly ledger: DevSquadAdoWorkflowLedger;
  /** Injected read-oriented observation seam. */
  readonly seam: DevSquadAdoWatcherObservationSeam;
  /** Caller-supplied stable pass identity used to derive operation ids. */
  readonly passId: string;
  /** Diagnostic coordinator identity used for ledger claims. */
  readonly ownerId: string;
  /** Work items to examine; canonical duplicates are rejected, then byte-ordered. */
  readonly candidates: readonly DevSquadAdoWorkItemId[];
  /** Exact-match phase and status sets that admit intake signals. */
  readonly intakeRules: DevSquadAdoWatchIntakeRules;
  /** Poll, duration, and per-observation bounds. */
  readonly budgets: DevSquadAdoWatchBudgets;
  /** Optional claim lease sizing. */
  readonly lease?: DevSquadAdoWatchLeaseConfig;
  /** Optional deterministic backoff configuration. */
  readonly backoff?: DevSquadAdoWatchBackoffConfig;
  /** Injected UTC clock; read at pass start and once before each poll. */
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
  | "stale-observation"
  | "revision-conflict"
  | "state-conflict"
  | "idempotency-conflict"
  | "checkpoint-indeterminate"
  | "observation-failed"
  | "observation-timeout"
  | "observation-anchor-missing"
  | "pull-request-observation-unavailable"
  | "invalid-observation-identifier"
  | "invalid-observation-window"
  | "claim-cleanup-unconfirmed"
  | "ledger-recovery"
  | "ledger-capacity"
  | "ledger-unavailable"
  | "cancelled";

/** Stable reason a bounded pass stopped. */
export type DevSquadAdoWatchStopReason =
  | "candidates-resolved"
  | "poll-budget-exhausted"
  | "poll-start-budget-exhausted"
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

/** Validated ledger categories only; injected arbitrary text is never exposed. */
export type DevSquadAdoWatchLedgerErrorKind =
  | DevSquadAdoLedgerError["kind"]
  | "ledger-fault";

/** Evidence of the single cleanup attempt, independent of checkpoint acceptance. */
export interface DevSquadAdoWatchCleanup {
  /** Whether release was acknowledged, rejected, uncertain, or unnecessary. */
  readonly status: "released" | "failed" | "indeterminate" | "not-required";
  /** Stable explanation of the cleanup evidence. */
  readonly reason:
    | "release-acknowledged"
    | "release-rejected"
    | "release-indeterminate"
    | "authority-unvalidated"
    | "no-claim-acquired";
  /** Validated error category, never a dependency message or token. */
  readonly ledgerErrorKind: DevSquadAdoWatchLedgerErrorKind | null;
  /** Original accepted release revision, not the checkpoint or latest revision. */
  readonly acceptedRevision: number | null;
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
  readonly ledgerErrorKind: DevSquadAdoWatchLedgerErrorKind | null;
  /** Mandatory independent evidence of claim cleanup. */
  readonly cleanup: DevSquadAdoWatchCleanup;
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
  /** Candidates with acknowledged release. */
  readonly cleanupReleased: number;
  /** Candidates whose release was rejected. */
  readonly cleanupFailed: number;
  /** Candidates whose acquire or release acknowledgement is uncertain. */
  readonly cleanupIndeterminate: number;
  /** Candidates requiring no claim cleanup. */
  readonly cleanupNotRequired: number;
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
  /** Unique canonical, byte-ordered work-item identifiers. */
  readonly candidates: readonly string[];
  /** Exact-match phases admitted for intake. */
  readonly intakePhases: readonly string[];
  /** Exact-match statuses admitted for intake. */
  readonly intakeStatuses: readonly string[];
  /** Maximum polls performed by the pass. */
  readonly maxPolls: number;
  /** Elapsed-time ceiling in milliseconds for starting another poll. */
  readonly maxPollStartElapsedMs: number;
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

/** Claim-lifecycle steps, whose identity is scoped to one claim epoch. */
export type DevSquadAdoWatcherClaimStep = "claim" | "renew" | "release";

/**
 * The exact cursor advance one checkpoint publishes.
 *
 * Both ends are recorded: the persisted anchors the advance was derived from
 * and the cursors it makes durable. Within a fixed namespace, two attempts at
 * the same advance produce the same generation and operation identifier; an
 * advance from different anchors, or to different cursors, is different.
 * This legacy shape carries no PR destination. The checkpoint-only helper
 * overload supplies that namespace separately without changing this type.
 */
export interface DevSquadAdoWatcherObservationGeneration {
  /** Persisted work-item comment anchor the advance starts from. */
  readonly fromWorkItemCommentId: string | null;
  /** Persisted pull-request anchor the advance starts from. */
  readonly fromPullRequest: DevSquadAdoPullRequestCursor | null;
  /** Work-item comment cursor this advance persists, when it advances one. */
  readonly toWorkItemCommentId: string | null;
  /** Pull-request cursor this advance persists, when it advances one. */
  readonly toPullRequest: DevSquadAdoPullRequestCursor | null;
}

/**
 * Stable identity from which a watcher operation identifier is derived.
 *
 * The two arms differ because the two families of step need opposite
 * properties. A claim-lifecycle identifier must be **unique per acquisition**:
 * the ledger folds the capability token into its idempotency digest, and that
 * token is freshly random on every acquisition, so reusing one identifier
 * across acquisitions can only ever produce a permanent `idempotency-conflict`
 * that no retry can clear. A checkpoint identifier must instead be **stable
 * per cursor advance**, so retrying an ambiguous mutation replays the original
 * outcome rather than duplicating it. The legacy one-argument helper cannot
 * isolate PR destinations; its checkpoint-only second argument adds the
 * observed PR namespace while preserving both identity arms here.
 */
export type DevSquadAdoWatcherOperationIdentity =
  | {
      /** Claim-lifecycle step being identified. */
      readonly step: DevSquadAdoWatcherClaimStep;
      /** Caller-supplied stable pass identity. */
      readonly passId: string;
      /** Canonical ledger work-item identifier, never the caller's raw input. */
      readonly workItemId: string;
      /** Zero for one-shot steps; the one-based renewal sequence for `renew`. */
      readonly ordinal: number;
      /**
       * Random identity of one acquisition attempt.
       *
       * Minted immediately before `acquireClaim` and reused by every `renew`
       * and `release` of that same claim. It is an idempotency namespace, not
       * a capability: it grants nothing, authorizes nothing, and is never a
       * claim token.
       */
      readonly claimEpoch: string;
    }
  | {
      /** Checkpoint step being identified. */
      readonly step: "checkpoint";
      /** Caller-supplied stable pass identity. */
      readonly passId: string;
      /** Canonical ledger work-item identifier, never the caller's raw input. */
      readonly workItemId: string;
      /** Zero for the single checkpoint a candidate step publishes. */
      readonly ordinal: number;
      /** The exact cursor advance being published. */
      readonly generation: DevSquadAdoWatcherObservationGeneration;
    };

/**
 * W045 / FR-008/061: run one bounded offline supplied-candidate pass.
 * Omitting `mode` preserves this overload and its original comment signal type.
 * Missing records are skipped; initialization is never required or inspected.
 *
 * Every external observation is obtained through the injected seam, every
 * supplied-mode mutation goes through the ledger under a fenced claim, and the pass
 * terminates at the first of: all candidates resolved, poll budget reached,
 * poll-start elapsed budget reached, or cancellation.
 *
 * Resolves `ok: false` only for option validation and seam-contract failures
 * detected before any observation or ledger operation. An injected ledger
 * method that throws or rejects never escapes: it resolves as a typed,
 * redacted `failed` / `ledger-unavailable` candidate outcome.
 */
export function runDevSquadAdoWorkflowWatchPass(
  options: RunDevSquadAdoWorkflowWatchPassOptions,
): Promise<DevSquadAdoWatchPassOutcome>;
/**
 * W045 / FR-061–069: run one fresh, bounded discovery traversal.
 * Matching precedes item effects. Existing records use fenced checkpoints;
 * explicitly authorized missing records may initialize without acquiring claims.
 * Only fresh acknowledged initialization can return discovery admission intake;
 * replay reconciles acceptance without redelivery. Both modes can permanently
 * lose intake after durable writes. No queue, dispatch or lifecycle authority.
 *
 * At most one page is initiated per poll. Terminal evidence is necessary but
 * insufficient for completion while retries remain. Ledger/delay dependencies
 * must settle; budgets and cancellation do not guarantee physical termination.
 */
export function runDevSquadAdoWorkflowWatchPass(
  options: RunDevSquadAdoDiscoveryWatchPassOptions,
): Promise<DevSquadAdoDiscoveryPassOutcome>;
/** Runtime-selected mode returns the corresponding supplied/discovery union. */
export function runDevSquadAdoWorkflowWatchPass(
  options: DevSquadAdoWorkflowWatchPassRequest,
): Promise<DevSquadAdoWatchPassOutcome | DevSquadAdoDiscoveryPassOutcome>;
/** Dispatch only after fail-closed mode validation; no injected effects on error. */
export async function runDevSquadAdoWorkflowWatchPass(
  options: DevSquadAdoWorkflowWatchPassRequest,
): Promise<DevSquadAdoWatchPassOutcome | DevSquadAdoDiscoveryPassOutcome> {
  const mode = inspectDevSquadAdoWatchMode(options);
  if (!mode.ok) return mode;
  return mode.value === "discovery"
    ? runDevSquadAdoDiscoveryWatchPass(
        options as RunDevSquadAdoDiscoveryWatchPassOptions,
      )
    : runDevSquadAdoWorkflowWatchPassImplementation(
        options as RunDevSquadAdoWorkflowWatchPassOptions,
      );
}

/**
 * W039/W045 / FR-065: AND every configured predicate; values compare exactly and
 * case-sensitively without trimming, Unicode normalization or team inference.
 * State/team members are OR sets; tags combine all/any/none. Configured sets
 * must be nonempty and duplicate-free. At most one of each of seven slots.
 * Paths are segment arrays: exact means equal length/values, subtree means a
 * complete prefix including the root itself. [] is root, never a text prefix.
 */
export type DevSquadAdoDiscoveryFilter =
  | {
      /** Configured host-normalized fact dimension. */
      readonly dimension: "state" | "team";
      /** Exact supported comparison; unknown operators fail preflight. */
      readonly operator: "one-of";
      /** Nonempty duplicate-free opaque set members, within collection/value bounds. */
      readonly values: readonly string[];
    }
  | {
      /** Configured host-normalized fact dimension. */
      readonly dimension: "tags";
      /** Exact supported comparison; unknown operators fail preflight. */
      readonly operator: "all" | "any" | "none";
      /** Nonempty duplicate-free opaque set members, within collection/value bounds. */
      readonly values: readonly string[];
    }
  | {
      /** Configured host-normalized fact dimension. */
      readonly dimension: "area" | "iteration";
      /** Exact supported comparison; unknown operators fail preflight. */
      readonly operator: "exact" | "subtree";
      /** Normalized opaque path segments; [] represents root. */
      readonly segments: readonly string[];
    };

/**
 * Host-versioned policy. Empty filters are unrestricted; at most seven slots.
 * Snapshot once per invocation; hosts must change version when meaning changes.
 * Version is correlation evidence, not a hash or integrity/authorization proof.
 */
export interface DevSquadAdoDiscoveryMatchingPolicy {
  /** Nonsecret correlation label, at most 256 UTF-8 bytes. */
  readonly version: string;
  /** AND predicates; state/team members are OR sets. */
  readonly filters: readonly DevSquadAdoDiscoveryFilter[];
}

/**
 * Complete positive-safe-integer processing limits; all bounds are inclusive.
 * UTF-8 JSON sizes count recognized fields, keys, punctuation, discriminators,
 * escaping and binding/request metadata. Pages count only configured facts and
 * continuation, not unrelated fields. Bounds are conjunctive, never truncating.
 * Hosts must separately bound allocations/transport before returning a page.
 */
export interface DevSquadAdoDiscoveryLimits {
  /** Initiated page calls: default 32, ceiling 1,000. */
  readonly maxPageCalls: number;
  /** Distinct discovered items: default/ceiling 1,000. */
  readonly maxItems: number;
  /** Entries in one page: default 128, ceiling 1,000. */
  readonly maxEntriesPerPage: number;
  /** Values per filter/fact collection: default 128, ceiling 1,024. */
  readonly maxCollectionValues: number;
  /** Path segments: default 32, ceiling 128. */
  readonly maxPathSegments: number;
  /** UTF-8 bytes per opaque value: default 1,024, ceiling 4,096. */
  readonly maxOpaqueValueBytes: number;
  /** UTF-8 continuation bytes: default 4,096, ceiling 16,384. */
  readonly maxContinuationBytes: number;
  /** Canonical recognized policy JSON bytes: default 65,536, ceiling 262,144. */
  readonly maxPolicyBytes: number;
  /** Canonical recognized page JSON bytes: default 1,048,576, ceiling 4,194,304. */
  readonly maxPageBytes: number;
  /** Canonical authorization array JSON bytes: default 262,144, ceiling 1,048,576. */
  readonly maxAuthorizationBytes: number;
}

/** Approved processing defaults; callers must still supply a complete declaration. */
export const DEFAULT_DEVSQUAD_ADO_DISCOVERY_LIMITS: DevSquadAdoDiscoveryLimits =
  Object.freeze({
    maxPageCalls: 32,
    maxItems: 1000,
    maxEntriesPerPage: 128,
    maxCollectionValues: 128,
    maxPathSegments: 32,
    maxOpaqueValueBytes: 1024,
    maxContinuationBytes: 4096,
    maxPolicyBytes: 65536,
    maxPageBytes: 1048576,
    maxAuthorizationBytes: 262144,
  });

/**
 * Explicit item-specific host authority; neither matching nor a claim supplies it.
 * Initialization identity binds canonical item, submissionId and initial state,
 * independently of pass/traversal/continuation/claim identities; retain on retry.
 * No authorization or unavailable initial state means no initialization.
 */
export type DevSquadAdoDiscoveryAuthorization =
  | {
      /** Canonicalized ledger identity; never inferred from facts or array position. */
      readonly workItemId: DevSquadAdoWorkItemId;
      /** Discriminator for this contract arm. */
      readonly kind: "authorized";
      /** Host submission identity, at most 256 UTF-8 bytes; never public evidence. */
      readonly submissionId: string;
      /** Exact authorized initial phase/status, each within the ledger 256-byte limit. */
      readonly initial: { readonly phase: string; readonly status: string };
    }
  | {
      /** Canonicalized ledger identity; never inferred from facts or array position. */
      readonly workItemId: DevSquadAdoWorkItemId;
      /** Discriminator for this contract arm. */
      readonly kind: "unavailable";
      /** Stable machine-readable category, never dependency-controlled text. */
      readonly reason: "not-authorized" | "initial-state-missing";
    };

/**
 * Invocation-stable host scope; the library cannot verify host honesty.
 * The host owns stable partitions, normalized facts, resolved teams, policy
 * meaning/version, explicit item authority/state, transport and credentials.
 * None of these declarations grants execution, transition or external-write authority.
 */
export interface DevSquadAdoWatchDiscoveryConfiguration {
  /** Nonsecret correlation labels, each at most 256 UTF-8 bytes. */
  readonly scope: {
    /** Host-declared nonsecret scope correlation label. */
    readonly scopeId: string;
    /** Host-declared stable bounded partition correlation label. */
    readonly partitionId: string;
    /** Host-declared stable enumeration/fact-view identity for this invocation. */
    readonly stabilityId: string;
    /** Required true assertion of stable enumeration and facts, not proof. */
    readonly stableForInvocation: true;
  };
  /** Matching runs before projection and before item effects. */
  readonly policy: DevSquadAdoDiscoveryMatchingPolicy;
  /** Required complete processing bounds. */
  readonly limits: DevSquadAdoDiscoveryLimits;
  /** At most 1,000 canonical-unique declarations; omission is unauthorized. */
  readonly authorizations?: readonly DevSquadAdoDiscoveryAuthorization[];
}

/** Correlation binding echoed exactly by every page. */
export interface DevSquadAdoDiscoveryBinding {
  /** Host-declared nonsecret scope correlation label. */
  readonly scopeId: string;
  /** Host-declared stable bounded partition correlation label. */
  readonly partitionId: string;
  /** Host-declared stable enumeration/fact-view identity for this invocation. */
  readonly stabilityId: string;
  /** Exact public host policy-version label, not integrity proof. */
  readonly policyVersion: string;
}

/**
 * Known empty collections differ from missing facts; values compare verbatim.
 * Missing/omitted required facts pause only the item; malformed required facts
 * invalidate the whole page. Empty tags match none, not nonempty all/any;
 * empty teams do not match a configured team predicate.
 */
export type DevSquadAdoDiscoveryFact<T> =
  | { readonly kind: "known"; readonly value: T }
  | { readonly kind: "missing" };

/** Only configured fields are inspected; no assigned-to/team inference is performed. */
export interface DevSquadAdoDiscoveryFacts {
  /** Optional known opaque state or explicit missing fact. */
  readonly state?: DevSquadAdoDiscoveryFact<string>;
  /** Optional host-resolved team membership; no assignedTo inference. */
  readonly teams?: DevSquadAdoDiscoveryFact<readonly string[]>;
  /** Optional known opaque tag set or explicit missing fact. */
  readonly tags?: DevSquadAdoDiscoveryFact<readonly string[]>;
  /** Optional normalized area path segments; known [] is root. */
  readonly area?: DevSquadAdoDiscoveryFact<readonly string[]>;
  /** Optional normalized iteration path segments; known [] is root. */
  readonly iteration?: DevSquadAdoDiscoveryFact<readonly string[]>;
}

/** Private traversal correlation; continuation starts null on every invocation. */
export interface DevSquadAdoDiscoveryPageRequest {
  /** Captured scope/partition/stability/policy-version binding, echoed exactly. */
  readonly binding: DevSquadAdoDiscoveryBinding;
  /** Private invocation correlation, never authority or durable mutation identity. */
  readonly traversalId: string;
  /** One-based page-call ordinal; every new invocation starts at one. */
  readonly pageOrdinal: number;
  /** Opaque token forwarded verbatim, initially null; never persisted or exposed. */
  readonly continuation: string | null;
  /** Child cancellation signal retired when this page call settles/aborts/times out. */
  readonly signal: AbortSignal;
}

/**
 * Whole-page atomic input; empty pages are not terminal without explicit evidence.
 * Validate every entry/binding/bound before item effects, including the last entry.
 * Reject canonical duplicates within/across pages and repeated continuations.
 * Retain host page order and canonical UTF-8 item order within each accepted page.
 */
export interface DevSquadAdoDiscoveryPage {
  /** Captured scope/partition/stability/policy-version binding, echoed exactly. */
  readonly binding: DevSquadAdoDiscoveryBinding;
  /** Private invocation correlation, never authority or durable mutation identity. */
  readonly traversalId: string;
  /** One-based page-call ordinal; every new invocation starts at one. */
  readonly pageOrdinal: number;
  /** Bounded canonical-unique items; the entire page must validate before effects. */
  readonly items: readonly {
    /** Canonicalized ledger identity; never inferred from facts or array position. */
    readonly workItemId: DevSquadAdoWorkItemId;
    /** Host-normalized facts; only configured dimensions are read and byte-counted. */
    readonly facts: DevSquadAdoDiscoveryFacts;
  }[];
  /** Explicit terminal evidence or a bounded nonempty opaque continuation. */
  readonly next:
    | { readonly kind: "terminal" }
    | { readonly kind: "continue"; readonly continuation: string };
}

/**
 * W042 / FR-066: discovery distinguishes known retention loss from an ordinary
 * empty no-new-events window. Loss is valid only with a supplied durable anchor
 * and prevents checkpointing either observation kind.
 */
export type DevSquadAdoDiscoveryWorkItemObservation =
  | ({ readonly kind: "window" } & DevSquadAdoWatcherWorkItemObservation)
  | { readonly kind: "anchor-missing" };

/**
 * W042: PR retention loss requires a supplied cursor and forbids checkpointing
 * either kind; an ordinary empty window preserves the existing cursor.
 */
export type DevSquadAdoDiscoveryPullRequestObservation =
  | ({ readonly kind: "window" } & DevSquadAdoWatcherPullRequestObservation)
  | { readonly kind: "anchor-missing" };

/** Read-only injected host seam; no query, live client or execution lifecycle. */
export interface DevSquadAdoWatcherDiscoverySeam {
  /** Required read-only page call; at most one initiated per poll, including empty/failing calls. */
  readonly discoverWorkItemsPage: (
    input: DevSquadAdoDiscoveryPageRequest,
  ) => Promise<DevSquadAdoDiscoveryPage>;
  /** Required anchor-inclusive discovery observation; empty window means known no-new-events. */
  readonly observeWorkItemComments: (
    input: DevSquadAdoWatcherWorkItemObservationInput,
  ) => Promise<DevSquadAdoDiscoveryWorkItemObservation>;
  /** Optional; required during processing only when the durable record carries a PR ID. */
  readonly observePullRequestActivity?: (
    input: DevSquadAdoWatcherPullRequestObservationInput,
  ) => Promise<DevSquadAdoDiscoveryPullRequestObservation>;
}

/** Separate request arm, preserving every legacy supplied signal/result type. */
export interface RunDevSquadAdoDiscoveryWatchPassOptions extends Omit<
  RunDevSquadAdoWorkflowWatchPassOptions,
  "mode" | "candidates" | "seam" | "discovery"
> {
  /** Explicit discovery discriminator; supplied callers retain their historical shapes. */
  readonly mode: "discovery";
  /** Forbidden in discovery mode; candidates come only from validated pages. */
  readonly candidates?: never;
  /** Injected read-only page and observation methods, never a live client owned by the watcher. */
  readonly seam: DevSquadAdoWatcherDiscoverySeam;
  /** Complete immutable-at-preflight discovery configuration. */
  readonly discovery: DevSquadAdoWatchDiscoveryConfiguration;
}

/** Explicit request union for callers selecting a mode at runtime. */
export type DevSquadAdoWorkflowWatchPassRequest =
  | RunDevSquadAdoWorkflowWatchPassOptions
  | RunDevSquadAdoDiscoveryWatchPassOptions;

/** Discovery-only preflight errors do not widen historical seam-name unions. */
export type DevSquadAdoDiscoveryError =
  | DevSquadAdoWatchError
  | {
      /** Discriminator for this contract arm. */
      readonly kind: "seam-contract";
      /** Required discovery seam method whose structural validation failed. */
      readonly method: "discoverWorkItemsPage";
      /** Stable machine-readable category, never dependency-controlled text. */
      readonly reason: "missing" | "not-a-function";
    };

/** Minimized discovery validation summary; prepared policy/authorization stay private. */
export interface DevSquadAdoDiscoveryValidatedPass extends Omit<
  DevSquadAdoWatchValidatedPass,
  "candidates"
> {
  /** Explicit discovery discriminator; supplied callers retain their historical shapes. */
  readonly mode: "discovery";
  /** Captured scope/partition/stability/policy-version binding, echoed exactly. */
  readonly binding: DevSquadAdoDiscoveryBinding;
}

/** Discovery validation result; no injected dependency is invoked. */
export type DevSquadAdoDiscoveryValidationResult =
  | { readonly ok: true; readonly value: DevSquadAdoDiscoveryValidatedPass }
  | { readonly ok: false; readonly error: DevSquadAdoDiscoveryError };

/**
 * Honest traversal accounting, independent of candidate success.
 * Complete requires terminal evidence and finalized accepted-item dispositions,
 * not universal item success. Terminal evidence never erases pending retries,
 * cancellation or budget exhaustion. Earlier accepted effects survive bad pages.
 * Every invocation restarts at ordinal 1/null; no durable continuation or eventual
 * tail-progress guarantee for repeated bounded prefix rescans.
 */
export type DevSquadAdoDiscoveryTraversal =
  | {
      /** Stable outcome status; workflow state values remain entirely host-defined. */
      readonly status: "complete";
      /** Stable machine-readable category, never dependency-controlled text. */
      readonly reason: "terminal-page";
      /** Whether an accepted terminal page was seen, independent of unfinished retries. */
      readonly terminalPageSeen: true;
    }
  | {
      /** Stable outcome status; workflow state values remain entirely host-defined. */
      readonly status: "incomplete";
      /** Whether an accepted terminal page was seen, independent of unfinished retries. */
      readonly terminalPageSeen: boolean;
      /** Stable machine-readable category, never dependency-controlled text. */
      readonly reason:
        | "page-budget-exhausted"
        | "item-budget-exhausted"
        | "poll-budget-exhausted"
        | "poll-start-budget-exhausted"
        | "page-failed"
        | "page-timeout"
        | "invalid-page"
        | "duplicate-item"
        | "repeated-continuation"
        | "unstable-scope"
        | "cancelled";
    };

/** Discovery counts extend, rather than redefine, supplied observation accounting. */
export interface DevSquadAdoDiscoveryPassCounts extends DevSquadAdoWatchPassCounts {
  /** Actual initiated page calls, including empty, failed and timed-out calls. */
  readonly pageCalls: number;
  /** Whole pages accepted after complete validation. */
  readonly pagesValidated: number;
  /** Distinct canonical items in accepted pages; rejected-page IDs do not count. */
  readonly discovered: number;
  /** Accepted items whose required matching facts were evaluated. */
  readonly evaluated: number;
  /** Fresh acknowledged initializations, whether or not intake rules allow a signal. */
  readonly admitted: number;
  /** Accepted matching-excluded/fact-missing items, including those not scheduled. */
  readonly paused: number;
  /** Finalized accepted dispositions, including matching; unprocessed items are excluded. */
  readonly processed: number;
  /** Validated replayed initialization acceptances, never redelivered admission signals. */
  readonly initializationReplayed: number;
}

/**
 * Fixed predicate evidence in state/team/tags-all/tags-any/tags-none/area/iteration
 * order, independently of caller filter order (W040/W045). No raw facts, operands,
 * authorization submission IDs, capabilities, continuations or sensitive hashes.
 * Missing required facts take precedence over unmatched predicates.
 */
export interface DevSquadAdoDiscoveryMatchingEvidence {
  /** Exact public host policy-version label, not integrity proof. */
  readonly policyVersion: string;
  /** Missing facts take precedence; otherwise all predicates must match. */
  readonly decision: "matched" | "excluded" | "facts-missing";
  /** Configured predicates only, in the documented fixed evidence order. */
  readonly predicates: readonly {
    /** Fixed non-sensitive predicate category, without operands or hashes. */
    readonly predicate:
      | "state"
      | "team"
      | "tags-all"
      | "tags-any"
      | "tags-none"
      | "area"
      | "iteration";
    /** Fixed non-sensitive predicate result, without actual/expected fact values. */
    readonly outcome: "matched" | "unmatched" | "missing";
  }[];
}
/**
 * Fresh-only claim-free admission; never carries synthetic comment metadata (W041).
 * Requires validated fresh durable acceptance plus matching intake phase/status.
 * At most one signal per item per invocation. Replay/restart cannot reconstruct
 * this signal; lost acknowledgements or crashes can permanently lose intake.
 */
export interface DevSquadAdoDiscoveryAdmissionSignal {
  /** Discriminator for this contract arm. */
  readonly kind: "discovery-admission";
  /** Canonicalized ledger identity; never inferred from facts or array position. */
  readonly workItemId: string;
  /** Original initialization revision one, never the latest record revision. */
  readonly acceptedInitializationRevision: 1;
  /** Exact host-defined workflow phase; no ordering or lifecycle semantics imposed. */
  readonly phase: string;
  /** Exact authorized initial workflow status; no lifecycle semantics imposed. */
  readonly status: string;
  /** Minimized policy-versioned evidence; no raw policy/facts/authorization identifiers. */
  readonly matching: DevSquadAdoDiscoveryMatchingEvidence;
  /** Fixed indication of explicit host authority, not the submission ID. */
  readonly authorization: "host-authorized";
}
/** Discovery signals do not widen the historical supplied signal type. */
export type DevSquadAdoDiscoveryIntakeSignal =
  | (DevSquadAdoWatchIntakeSignal & { readonly kind: "comment-observation" })
  | DevSquadAdoDiscoveryAdmissionSignal;
/** Original durable initialization acceptance, separate from latest record revision. */
export type DevSquadAdoDiscoveryAdmissionAcceptance =
  | {
      /** Discriminator for this contract arm. */
      readonly kind: "fresh" | "replayed";
      /** Original accepted initialization revision one, even with a later latest record. */
      readonly acceptedRevision: 1;
      /** Canonical UTC time of original acceptance, not the latest record timestamp. */
      readonly acceptedAt: string;
    }
  | { readonly kind: "unconfirmed" | "none" };
/**
 * Admission-only disposition: no claim/release obligation, even after uncertainty.
 * Cleanup is not-required / no-claim-acquired with null category/revision. It
 * proves no acquisition, not initialization success. No same-invocation fallback
 * to comment observation after initialization starts, including replay/already-exists.
 */
export interface DevSquadAdoDiscoveryAdmissionOutcome {
  /** Discovery disposition category; supplied outcomes have no category field. */
  readonly category: "admission";
  /** Canonicalized ledger identity; never inferred from facts or array position. */
  readonly workItemId: string;
  /** Discriminator for this contract arm. */
  readonly kind: "acted" | "no-change" | "skipped" | "failed";
  /** Stable machine-readable category, never dependency-controlled text. */
  readonly reason:
    | DevSquadAdoWatchReasonCode
    | "admission-accepted"
    | "admission-intake-rules-unmatched"
    | "admission-replayed"
    | "admission-already-recorded"
    | "admission-not-authorized"
    | "admission-initial-state-missing"
    | "initialization-indeterminate";
  /** Minimized policy-versioned evidence; no raw policy/facts/authorization identifiers. */
  readonly matching: DevSquadAdoDiscoveryMatchingEvidence;
  /** Validated original acceptance, or explicit none/unconfirmed without fabricated durability. */
  readonly acceptance: DevSquadAdoDiscoveryAdmissionAcceptance;
  /** Validated ledger category or ledger-fault; never a raw dependency error. */
  readonly ledgerErrorKind: DevSquadAdoWatchLedgerErrorKind | null;
  /** Independent claim cleanup evidence; initialization-only paths never acquire or release. */
  readonly cleanup: DevSquadAdoWatchCleanup;
}
/** Discovery outcomes retain minimized matching evidence and truthful cleanup. */
export type DevSquadAdoDiscoveryCandidateOutcome =
  | (DevSquadAdoWatchCandidateOutcome & {
      /** Discovery disposition category; supplied outcomes have no category field. */
      readonly category: "observation";
      /** Minimized policy-versioned evidence; no raw policy/facts/authorization identifiers. */
      readonly matching: DevSquadAdoDiscoveryMatchingEvidence;
    })
  | DevSquadAdoDiscoveryAdmissionOutcome
  | {
      /** Discovery disposition category; supplied outcomes have no category field. */
      readonly category: "matching" | "unprocessed";
      /** Canonicalized ledger identity; never inferred from facts or array position. */
      readonly workItemId: string;
      /** Discriminator for this contract arm. */
      readonly kind: "skipped";
      /** Stable machine-readable category, never dependency-controlled text. */
      readonly reason:
        | "matching-paused"
        | "matching-facts-missing"
        | "discovery-not-processed";
      /** Minimized policy-versioned evidence; no raw policy/facts/authorization identifiers. */
      readonly matching: DevSquadAdoDiscoveryMatchingEvidence;
      /** Independent claim cleanup evidence; initialization-only paths never acquire or release. */
      readonly cleanup: DevSquadAdoWatchCleanup;
    };

/**
 * Complete discovery accounting and minimized item dispositions (W045 / FR-069).
 * Outcomes retain first-discovery/page-local order; signals use acknowledgement
 * order. Rejected-page identities never enter accepted outcomes/counts. Inspect
 * traversal separately from candidate failures and acknowledged actions.
 */
export interface DevSquadAdoDiscoveryPassResult extends Omit<
  DevSquadAdoWatchPassResult,
  "stopReason" | "counts" | "outcomes" | "signals"
> {
  /** Explicit discovery discriminator; supplied callers retain their historical shapes. */
  readonly mode: "discovery";
  /** Scheduling stop; consult traversal and item outcomes independently. */
  readonly stopReason:
    | "completed"
    | "discovery-incomplete"
    | "cancelled"
    | "poll-budget-exhausted"
    | "poll-start-budget-exhausted";
  /** Independent tallies; acted includes either signal, eligible remains observation-only. */
  readonly counts: DevSquadAdoDiscoveryPassCounts;
  /** Explicit completion/incompletion and terminal-page evidence. */
  readonly traversal: DevSquadAdoDiscoveryTraversal;
  /** Accepted items in first-discovery/page-local order, including unprocessed dispositions. */
  readonly outcomes: readonly DevSquadAdoDiscoveryCandidateOutcome[];
  /** At most one signal per item, in acknowledgement order; failures may overlap actions. */
  readonly signals: readonly DevSquadAdoDiscoveryIntakeSignal[];
}

/** Separate discovery outcome envelope; never widens a supplied caller's signals. */
export type DevSquadAdoDiscoveryPassOutcome =
  | { readonly ok: true; readonly value: DevSquadAdoDiscoveryPassResult }
  | { readonly ok: false; readonly error: DevSquadAdoDiscoveryError };
