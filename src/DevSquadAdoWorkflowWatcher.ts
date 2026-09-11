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
  /** Optional injected jitter; the only source of randomness permitted. */
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
 * and the cursors it makes durable. Two attempts at the same advance produce
 * the same generation and therefore the same operation identifier; an advance
 * from different anchors, or to different cursors, is a different operation.
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
 * outcome rather than duplicating it.
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
 * Run exactly one bounded, offline, deterministic watch pass.
 *
 * Every external observation is obtained through the injected seam, every
 * mutation goes through the injected ledger under a fenced claim, and the pass
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
export function runDevSquadAdoWorkflowWatchPass(
  options: RunDevSquadAdoDiscoveryWatchPassOptions,
): Promise<DevSquadAdoDiscoveryPassOutcome>;
export function runDevSquadAdoWorkflowWatchPass(
  options: DevSquadAdoWorkflowWatchPassRequest,
): Promise<DevSquadAdoWatchPassOutcome | DevSquadAdoDiscoveryPassOutcome>;
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

/** W039 / FR-061: supported bounded, exact host-normalized matching predicates. */
export type DevSquadAdoDiscoveryFilter =
  | {
      readonly dimension: "state" | "team";
      readonly operator: "one-of";
      readonly values: readonly string[];
    }
  | {
      readonly dimension: "tags";
      readonly operator: "all" | "any" | "none";
      readonly values: readonly string[];
    }
  | {
      readonly dimension: "area" | "iteration";
      readonly operator: "exact" | "subtree";
      readonly segments: readonly string[];
    };

/** Host-versioned policy. Empty filters are unrestricted; at most seven slots. */
export interface DevSquadAdoDiscoveryMatchingPolicy {
  /** Nonsecret correlation label, at most 256 UTF-8 bytes. */
  readonly version: string;
  /** AND predicates; state/team members are OR sets. */
  readonly filters: readonly DevSquadAdoDiscoveryFilter[];
}

/** Complete positive-safe-integer processing limits; all bounds are inclusive. */
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

/** Explicit item-specific host authority; neither matching nor a claim supplies it. */
export type DevSquadAdoDiscoveryAuthorization =
  | {
      readonly workItemId: DevSquadAdoWorkItemId;
      readonly kind: "authorized";
      readonly submissionId: string;
      readonly initial: { readonly phase: string; readonly status: string };
    }
  | {
      readonly workItemId: DevSquadAdoWorkItemId;
      readonly kind: "unavailable";
      readonly reason: "not-authorized" | "initial-state-missing";
    };

/** Invocation-stable host scope; the library cannot verify host honesty. */
export interface DevSquadAdoWatchDiscoveryConfiguration {
  /** Nonsecret correlation labels, each at most 256 UTF-8 bytes. */
  readonly scope: {
    readonly scopeId: string;
    readonly partitionId: string;
    readonly stabilityId: string;
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
  readonly scopeId: string;
  readonly partitionId: string;
  readonly stabilityId: string;
  readonly policyVersion: string;
}

/** Known empty collections differ from missing facts; values are compared verbatim. */
export type DevSquadAdoDiscoveryFact<T> =
  | { readonly kind: "known"; readonly value: T }
  | { readonly kind: "missing" };

/** Only configured fields are inspected; no assigned-to/team inference is performed. */
export interface DevSquadAdoDiscoveryFacts {
  readonly state?: DevSquadAdoDiscoveryFact<string>;
  readonly teams?: DevSquadAdoDiscoveryFact<readonly string[]>;
  readonly tags?: DevSquadAdoDiscoveryFact<readonly string[]>;
  readonly area?: DevSquadAdoDiscoveryFact<readonly string[]>;
  readonly iteration?: DevSquadAdoDiscoveryFact<readonly string[]>;
}

/** Private traversal correlation; continuation starts null on every invocation. */
export interface DevSquadAdoDiscoveryPageRequest {
  readonly binding: DevSquadAdoDiscoveryBinding;
  readonly traversalId: string;
  readonly pageOrdinal: number;
  readonly continuation: string | null;
  readonly signal: AbortSignal;
}

/** Whole-page atomic input; empty pages are not terminal without explicit evidence. */
export interface DevSquadAdoDiscoveryPage {
  readonly binding: DevSquadAdoDiscoveryBinding;
  readonly traversalId: string;
  readonly pageOrdinal: number;
  readonly items: readonly {
    readonly workItemId: DevSquadAdoWorkItemId;
    readonly facts: DevSquadAdoDiscoveryFacts;
  }[];
  readonly next:
    | { readonly kind: "terminal" }
    | { readonly kind: "continue"; readonly continuation: string };
}

/** Discovery distinguishes known retention loss from an ordinary empty window. */
export type DevSquadAdoDiscoveryWorkItemObservation =
  | ({ readonly kind: "window" } & DevSquadAdoWatcherWorkItemObservation)
  | { readonly kind: "anchor-missing" };

/** Explicit PR retention-loss evidence; either kind's loss forbids checkpointing. */
export type DevSquadAdoDiscoveryPullRequestObservation =
  | ({ readonly kind: "window" } & DevSquadAdoWatcherPullRequestObservation)
  | { readonly kind: "anchor-missing" };

/** Read-only injected host seam; no query, live client or execution lifecycle. */
export interface DevSquadAdoWatcherDiscoverySeam {
  readonly discoverWorkItemsPage: (
    input: DevSquadAdoDiscoveryPageRequest,
  ) => Promise<DevSquadAdoDiscoveryPage>;
  readonly observeWorkItemComments: (
    input: DevSquadAdoWatcherWorkItemObservationInput,
  ) => Promise<DevSquadAdoDiscoveryWorkItemObservation>;
  readonly observePullRequestActivity?: (
    input: DevSquadAdoWatcherPullRequestObservationInput,
  ) => Promise<DevSquadAdoDiscoveryPullRequestObservation>;
}

/** Separate request arm, preserving every legacy supplied signal/result type. */
export interface RunDevSquadAdoDiscoveryWatchPassOptions extends Omit<
  RunDevSquadAdoWorkflowWatchPassOptions,
  "mode" | "candidates" | "seam" | "discovery"
> {
  readonly mode: "discovery";
  readonly candidates?: never;
  readonly seam: DevSquadAdoWatcherDiscoverySeam;
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
      readonly kind: "seam-contract";
      readonly method: "discoverWorkItemsPage";
      readonly reason: "missing" | "not-a-function";
    };

/** Normalized discovery pass, without the supplied candidate field. */
export interface DevSquadAdoDiscoveryValidatedPass extends Omit<
  DevSquadAdoWatchValidatedPass,
  "candidates"
> {
  readonly mode: "discovery";
  readonly binding: DevSquadAdoDiscoveryBinding;
  readonly discovery: DevSquadAdoWatchDiscoveryConfiguration;
}

/** Discovery validation result; no injected dependency is invoked. */
export type DevSquadAdoDiscoveryValidationResult =
  | { readonly ok: true; readonly value: DevSquadAdoDiscoveryValidatedPass }
  | { readonly ok: false; readonly error: DevSquadAdoDiscoveryError };

/** Honest traversal accounting, independent of candidate success. */
export type DevSquadAdoDiscoveryTraversal =
  | {
      readonly status: "complete";
      readonly reason: "terminal-page";
      readonly terminalPageSeen: true;
    }
  | {
      readonly status: "incomplete";
      readonly terminalPageSeen: boolean;
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
  readonly pageCalls: number;
  readonly pagesValidated: number;
  readonly discovered: number;
  readonly evaluated: number;
  readonly admitted: number;
  readonly paused: number;
  readonly processed: number;
  readonly initializationReplayed: number;
}

/** Fixed predicate evidence, ordered independently of caller filter order (W040). */
export interface DevSquadAdoDiscoveryMatchingEvidence {
  readonly policyVersion: string;
  readonly decision: "matched" | "excluded" | "facts-missing";
  readonly predicates: readonly {
    readonly predicate:
      | "state"
      | "team"
      | "tags-all"
      | "tags-any"
      | "tags-none"
      | "area"
      | "iteration";
    readonly outcome: "matched" | "unmatched" | "missing";
  }[];
}
/** Fresh-only claim-free admission; never carries synthetic comment metadata (W041). */
export interface DevSquadAdoDiscoveryAdmissionSignal {
  readonly kind: "discovery-admission";
  readonly workItemId: string;
  readonly acceptedInitializationRevision: 1;
  readonly phase: string;
  readonly status: string;
  readonly matching: DevSquadAdoDiscoveryMatchingEvidence;
  readonly authorization: "host-authorized";
}
/** Discovery signals do not widen the historical supplied signal type. */
export type DevSquadAdoDiscoveryIntakeSignal =
  | (DevSquadAdoWatchIntakeSignal & { readonly kind: "comment-observation" })
  | DevSquadAdoDiscoveryAdmissionSignal;
/** Original durable initialization acceptance, separate from latest record revision. */
export type DevSquadAdoDiscoveryAdmissionAcceptance =
  | {
      readonly kind: "fresh" | "replayed";
      readonly acceptedRevision: 1;
      readonly acceptedAt: string;
    }
  | { readonly kind: "unconfirmed" | "none" };
/** Admission-only disposition: no claim/release obligation, even after uncertainty. */
export interface DevSquadAdoDiscoveryAdmissionOutcome {
  readonly category: "admission";
  readonly workItemId: string;
  readonly kind: "acted" | "no-change" | "skipped" | "failed";
  readonly reason:
    | DevSquadAdoWatchReasonCode
    | "admission-accepted"
    | "admission-intake-rules-unmatched"
    | "admission-replayed"
    | "admission-already-recorded"
    | "admission-not-authorized"
    | "admission-initial-state-missing"
    | "initialization-indeterminate";
  readonly matching: DevSquadAdoDiscoveryMatchingEvidence;
  readonly acceptance: DevSquadAdoDiscoveryAdmissionAcceptance;
  readonly ledgerErrorKind: DevSquadAdoWatchLedgerErrorKind | null;
  readonly cleanup: DevSquadAdoWatchCleanup;
}
/** Discovery outcomes retain minimized matching evidence and truthful cleanup. */
export type DevSquadAdoDiscoveryCandidateOutcome =
  | (DevSquadAdoWatchCandidateOutcome & {
      readonly category: "observation";
      readonly matching: DevSquadAdoDiscoveryMatchingEvidence;
    })
  | DevSquadAdoDiscoveryAdmissionOutcome
  | {
      readonly category: "matching" | "unprocessed";
      readonly workItemId: string;
      readonly kind: "skipped";
      readonly reason:
        | "matching-paused"
        | "matching-facts-missing"
        | "discovery-not-processed";
      readonly matching: DevSquadAdoDiscoveryMatchingEvidence;
      readonly cleanup: DevSquadAdoWatchCleanup;
    };

/** Discovery result for the traversal; item contracts are extended by their owning slices. */
export interface DevSquadAdoDiscoveryPassResult extends Omit<
  DevSquadAdoWatchPassResult,
  "stopReason" | "counts" | "outcomes" | "signals"
> {
  readonly mode: "discovery";
  readonly stopReason:
    | "completed"
    | "discovery-incomplete"
    | "cancelled"
    | "poll-budget-exhausted"
    | "poll-start-budget-exhausted";
  readonly counts: DevSquadAdoDiscoveryPassCounts;
  readonly traversal: DevSquadAdoDiscoveryTraversal;
  readonly outcomes: readonly DevSquadAdoDiscoveryCandidateOutcome[];
  readonly signals: readonly DevSquadAdoDiscoveryIntakeSignal[];
}

/** Separate discovery outcome envelope; never widens a supplied caller's signals. */
export type DevSquadAdoDiscoveryPassOutcome =
  | { readonly ok: true; readonly value: DevSquadAdoDiscoveryPassResult }
  | { readonly ok: false; readonly error: DevSquadAdoDiscoveryError };
