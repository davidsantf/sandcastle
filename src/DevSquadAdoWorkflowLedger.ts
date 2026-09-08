import { openDevSquadAdoWorkflowLedgerStorage } from "./DevSquadAdoWorkflowLedgerStorage.js";

/** A caller-supplied Azure DevOps or GitHub work-item identifier. */
export type DevSquadAdoWorkItemId = string | number;

/** Options used to open the repository-local workflow ledger. */
export interface OpenDevSquadAdoWorkflowLedgerInput {
  /** Explicit host repository root; Sandcastle never discovers it with git. */
  readonly repositoryRoot: string;
}

/** A successful or structured failed ledger operation. */
export type DevSquadAdoLedgerResult<T> =
  | {
      /** Success discriminator. */
      readonly ok: true;
      /** Successful operation value. */
      readonly value: T;
    }
  | {
      /** Failure discriminator. */
      readonly ok: false;
      /** Stable token-free structured failure. */
      readonly error: DevSquadAdoLedgerError;
    };

/** One activation in an agent or session reference history. */
export interface DevSquadAdoReferenceActivation {
  /** Opaque caller-supplied reference identifier. */
  readonly id: string;
  /** Record revision that activated the reference. */
  readonly revision: number;
  /** UTC timestamp at which the activation was accepted. */
  readonly activatedAt: string;
}

/** Current and append-only historical references for an agent or session. */
export interface DevSquadAdoReferenceHistory {
  /** Current reference, or null after the caller clears it. */
  readonly current: string | null;
  /** Ordered activation history; clearing does not erase prior entries. */
  readonly history: readonly DevSquadAdoReferenceActivation[];
}

/** Independently optional pull-request identity fields. */
export interface DevSquadAdoPullRequestReference {
  /** Opaque pull-request identifier. */
  readonly id: string | null;
  /** Minimized absolute HTTP(S) URL without credentials, query, or fragment. */
  readonly url: string | null;
}

/** Opaque pull-request observation cursor. */
export interface DevSquadAdoPullRequestCursor {
  /** Opaque tracker thread identifier. */
  readonly threadId: string;
  /** Opaque tracker comment identifier. */
  readonly commentId: string;
}

/** Last externally observed work-item and pull-request cursors. */
export interface DevSquadAdoObservationCursors {
  /** Opaque work-item comment identifier. */
  readonly workItemCommentId: string | null;
  /** Opaque pull-request thread/comment cursor. */
  readonly pullRequest: DevSquadAdoPullRequestCursor | null;
}

/** Workflow phase and status captured in a checkpoint. */
export interface DevSquadAdoWorkflowState {
  /** Caller-defined DevSquad phase. */
  readonly phase: string;
  /** Caller-defined workflow status. */
  readonly status: string;
}

/** Ordered metadata for one accepted workflow checkpoint. */
export interface DevSquadAdoCheckpointEntry {
  /** Revision created by the checkpoint. */
  readonly revision: number;
  /** Caller-stable operation identifier. */
  readonly operationId: string;
  /** UTC timestamp at which the checkpoint was accepted. */
  readonly acceptedAt: string;
  /** Exact workflow state before the checkpoint. */
  readonly previous: DevSquadAdoWorkflowState;
  /** Exact workflow state after the checkpoint. */
  readonly resulting: DevSquadAdoWorkflowState;
}

/** Token-free metadata for the current or previously accepted claim. */
export interface DevSquadAdoClaimMetadata {
  /** Canonical work-item identifier. */
  readonly workItemId: string;
  /** Diagnostic coordinator owner identifier. */
  readonly ownerId: string;
  /** Monotonically increasing stale-owner fence. */
  readonly fencingValue: number;
  /** UTC claim acquisition time. */
  readonly acquiredAt: string;
  /** UTC last successful acquisition or renewal time. */
  readonly heartbeatAt: string;
  /** UTC inclusive lease expiry time. */
  readonly expiresAt: string;
}

/** Caller-held claim authority returned only by claim acquisition. */
export interface DevSquadAdoClaimAuthority extends DevSquadAdoClaimMetadata {
  /** Opaque 32-byte base64url capability; never persisted in plaintext. */
  readonly claimToken: string;
}

/** Public token-free projection of one durable workflow aggregate. */
export interface DevSquadAdoWorkflowRecord {
  /** Persisted schema version. */
  readonly schemaVersion: 1;
  /** Canonical work-item identifier. */
  readonly workItemId: string;
  /** Monotonically increasing optimistic-concurrency revision. */
  readonly revision: number;
  /** UTC record creation time. */
  readonly createdAt: string;
  /** UTC last accepted mutation time. */
  readonly updatedAt: string;
  /** Caller-defined DevSquad phase, preserved exactly. */
  readonly phase: string;
  /** Caller-defined workflow status, preserved exactly. */
  readonly status: string;
  /** Current branch, or null when unavailable or cleared. */
  readonly branch: string | null;
  /** Current host worktree path, or null when unavailable or cleared. */
  readonly worktreePath: string | null;
  /** Current and historical agent identifiers. */
  readonly agent: DevSquadAdoReferenceHistory;
  /** Current and historical session identifiers. */
  readonly session: DevSquadAdoReferenceHistory;
  /** Pull-request identifier and URL. */
  readonly pullRequest: DevSquadAdoPullRequestReference;
  /** Opaque external observation cursors. */
  readonly observations: DevSquadAdoObservationCursors;
  /** Ordered accepted workflow checkpoint history. */
  readonly checkpoints: readonly DevSquadAdoCheckpointEntry[];
  /** Current token-free claim metadata, or null. */
  readonly activeClaim: DevSquadAdoClaimMetadata | null;
  /** Highest fencing value ever issued for this record. */
  readonly fencingCounter: number;
}

/** Common metadata returned for an accepted mutation or exact replay. */
export interface DevSquadAdoMutationSuccess<TOutcome> {
  /** Revision originally accepted for this operation. */
  readonly acceptedRevision: number;
  /** UTC timestamp originally accepted for this operation. */
  readonly acceptedAt: string;
  /** Whether this response came from a durable idempotency receipt. */
  readonly replayed: boolean;
  /** Operation-specific token-minimized outcome. */
  readonly outcome: TOutcome;
  /** Latest durable public record at response time. */
  readonly record: DevSquadAdoWorkflowRecord;
}

/** Outcome of an accepted record initialization. */
export interface DevSquadAdoInitializedOutcome {
  /** Stable initialization outcome discriminator. */
  readonly kind: "initialized";
}

/** Outcome of an accepted workflow checkpoint. */
export interface DevSquadAdoCheckpointedOutcome {
  /** Stable checkpoint outcome discriminator. */
  readonly kind: "checkpointed";
  /** Checkpoint metadata stored at the accepted revision. */
  readonly checkpoint: DevSquadAdoCheckpointEntry;
}

/** Outcome of an accepted claim acquisition. */
export interface DevSquadAdoClaimAcquiredOutcome {
  /** Stable acquisition outcome discriminator. */
  readonly kind: "claim-acquired";
  /** Caller-held authority including the original plaintext claim token. */
  readonly authority: DevSquadAdoClaimAuthority;
}

/** Outcome of an accepted claim renewal. */
export interface DevSquadAdoClaimRenewedOutcome {
  /** Stable renewal outcome discriminator. */
  readonly kind: "claim-renewed";
  /** Renewed token-free claim metadata. */
  readonly claim: DevSquadAdoClaimMetadata;
}

/** Token-free metadata for a released claim. */
export interface DevSquadAdoReleasedClaimMetadata {
  /** Diagnostic owner identifier of the released claim. */
  readonly ownerId: string;
  /** Fencing value of the released claim. */
  readonly fencingValue: number;
  /** UTC release acceptance timestamp. */
  readonly releasedAt: string;
}

/** Outcome of an accepted claim release. */
export interface DevSquadAdoClaimReleasedOutcome {
  /** Stable release outcome discriminator. */
  readonly kind: "claim-released";
  /** Token-free metadata for the released claim. */
  readonly releasedClaim: DevSquadAdoReleasedClaimMetadata;
}

/** Result of listing all valid records and isolated recovery diagnostics. */
export interface DevSquadAdoResumableRecordList {
  /** Every valid initialized record, without lifecycle-based filtering. */
  readonly records: readonly DevSquadAdoWorkflowRecord[];
  /** Deterministically ordered diagnostics isolated from valid records. */
  readonly recoveryErrors: readonly DevSquadAdoRecoveryError[];
}

/** Input for creating revision one of a workflow record. */
export interface InitializeDevSquadAdoWorkflowRecordInput {
  /** Work item to initialize. */
  readonly workItemId: DevSquadAdoWorkItemId;
  /** Stable idempotency identifier scoped to the work item. */
  readonly operationId: string;
  /** Initial caller-defined phase. */
  readonly phase: string;
  /** Initial caller-defined status. */
  readonly status: string;
  /** Initial branch. */
  readonly branch?: string;
  /** Initial absolute host worktree path. */
  readonly worktreePath?: string;
  /** Initial agent reference. */
  readonly agentId?: string;
  /** Initial session reference. */
  readonly sessionId?: string;
  /** Initial pull-request reference. */
  readonly pullRequest?: {
    /** Opaque pull-request identifier. */
    readonly id?: string;
    /** Minimized absolute HTTP(S) pull-request URL. */
    readonly url?: string;
  };
  /** Initial opaque observation cursors. */
  readonly observations?: {
    /** Opaque work-item comment cursor. */
    readonly workItemCommentId?: string;
    /** Opaque pull-request thread/comment cursor. */
    readonly pullRequest?: DevSquadAdoPullRequestCursor;
  };
}

/** Input for atomically acquiring or taking over a local ledger claim. */
export interface AcquireDevSquadAdoWorkflowClaimInput {
  /** Work item whose local record will be claimed. */
  readonly workItemId: DevSquadAdoWorkItemId;
  /** Stable idempotency identifier. */
  readonly operationId: string;
  /** Diagnostic coordinator owner identifier. */
  readonly ownerId: string;
  /** Canonical unpadded base64url token decoding to exactly 32 bytes. */
  readonly claimToken: string;
  /** Positive lease duration no greater than 24 hours. */
  readonly leaseDurationMs: number;
}

/** Input for extending the current claim from accepted renewal time. */
export interface RenewDevSquadAdoWorkflowClaimInput {
  /** Claimed work item. */
  readonly workItemId: DevSquadAdoWorkItemId;
  /** Stable idempotency identifier. */
  readonly operationId: string;
  /** Current claim authority. */
  readonly authority: DevSquadAdoClaimAuthorityInput;
  /** Positive lease duration no greater than 24 hours. */
  readonly leaseDurationMs: number;
}

/** Input for releasing the current local claim. */
export interface ReleaseDevSquadAdoWorkflowClaimInput {
  /** Claimed work item. */
  readonly workItemId: DevSquadAdoWorkItemId;
  /** Stable idempotency identifier. */
  readonly operationId: string;
  /** Current claim authority. */
  readonly authority: DevSquadAdoClaimAuthorityInput;
}

/** Capability fields supplied for a claimed mutation. */
export interface DevSquadAdoClaimAuthorityInput {
  /** Diagnostic owner identifier. */
  readonly ownerId: string;
  /** Opaque 32-byte base64url claim token. */
  readonly claimToken: string;
  /** Current monotonic fencing value. */
  readonly fencingValue: number;
}

/** Input for one optimistic, claimed workflow checkpoint. */
export interface CheckpointDevSquadAdoWorkflowInput {
  /** Claimed work item. */
  readonly workItemId: DevSquadAdoWorkItemId;
  /** Stable idempotency identifier. */
  readonly operationId: string;
  /** Current claim authority. */
  readonly authority: DevSquadAdoClaimAuthorityInput;
  /** Exact optimistic revision and workflow-state preconditions. */
  readonly expected: {
    /** Expected positive record revision. */
    readonly revision: number;
    /** Exact expected phase. */
    readonly phase: string;
    /** Exact expected status. */
    readonly status: string;
  };
  /** Structurally validated fields to record without lifecycle interpretation. */
  readonly patch: {
    /** Resulting caller-defined phase. */
    readonly phase?: string;
    /** Resulting caller-defined status. */
    readonly status?: string;
    /** Resulting branch, or null to clear. */
    readonly branch?: string | null;
    /** Resulting absolute host worktree path, or null to clear. */
    readonly worktreePath?: string | null;
    /** Resulting agent reference, or null to clear. */
    readonly agentId?: string | null;
    /** Resulting session reference, or null to clear. */
    readonly sessionId?: string | null;
    /** Independently patchable pull-request identity fields. */
    readonly pullRequest?: {
      /** Resulting opaque pull-request identifier, or null to clear. */
      readonly id?: string | null;
      /** Resulting minimized URL, or null to clear. */
      readonly url?: string | null;
    };
    /** Patch for opaque external observation cursors. */
    readonly observations?: {
      /** Resulting work-item comment cursor, or null to clear. */
      readonly workItemCommentId?: string | null;
      /** Resulting PR cursor, or null to clear. */
      readonly pullRequest?: DevSquadAdoPullRequestCursor | null;
    };
  };
}

/** A deterministic token-free recovery diagnostic. */
export interface DevSquadAdoRecoveryError {
  /** Stable recovery category. */
  readonly kind:
    | "corrupt-artifact"
    | "unsupported-schema-version"
    | "path-boundary"
    | "unsupported-permissions"
    | "scan-limit"
    | "leftover-candidate"
    | "superseded-generation";
  /** Whether the artifact invalidates a record or is retained evidence only. */
  readonly severity: "error" | "warning";
  /** Path relative to `.sandcastle/devsquad-ado`, never raw artifact data. */
  readonly artifact: string;
}

/** Stable, token-free structured errors returned by ledger operations. */
export type DevSquadAdoLedgerError =
  | {
      /** Validation error category. */
      readonly kind: "validation";
      /** Stable request field path. */
      readonly field: string;
      /** Stable redacted validation reason. */
      readonly reason: string;
    }
  | {
      /** The explicit repository root does not exist. */
      readonly kind: "repository-not-found";
    }
  | {
      /** The explicit repository root is not a directory. */
      readonly kind: "repository-not-directory";
    }
  | {
      /** A path, link, or artifact crossed the trusted ledger boundary. */
      readonly kind: "path-boundary";
      /** Optional path relative to the ledger root. */
      readonly artifact?: string;
    }
  | {
      /** The filesystem cannot provide required atomic or durability semantics. */
      readonly kind: "unsupported-filesystem";
    }
  | {
      /** Required private filesystem permissions could not be established. */
      readonly kind: "unsupported-permissions";
      /** Optional path relative to the ledger root. */
      readonly artifact?: string;
    }
  | {
      /** No initialized record exists for the canonical work-item identifier. */
      readonly kind: "record-not-found";
    }
  | {
      /** A different initialization already created this record. */
      readonly kind: "record-already-exists";
    }
  | {
      /** Another unexpired local claim currently owns the record. */
      readonly kind: "claim-conflict";
      /** Token-free current claim metadata. */
      readonly claim: DevSquadAdoClaimMetadata;
    }
  | {
      /** The record has no active local claim. */
      readonly kind: "claim-not-held";
    }
  | {
      /** The supplied current claim reached its inclusive expiry. */
      readonly kind: "claim-expired";
      /** UTC expiry timestamp. */
      readonly expiredAt: string;
    }
  | {
      /** The supplied fencing value is no longer current. */
      readonly kind: "stale-fencing";
      /** Current token-free fencing value. */
      readonly currentFencingValue: number;
    }
  | {
      /** The claim token or diagnostic owner did not authorize the mutation. */
      readonly kind: "claim-authorization";
    }
  | {
      /** The optimistic record revision no longer matches. */
      readonly kind: "revision-conflict";
      /** Revision requested by the caller. */
      readonly expectedRevision: number;
      /** Current durable revision. */
      readonly currentRevision: number;
    }
  | {
      /** The exact expected caller-defined phase or status no longer matches. */
      readonly kind: "state-conflict";
      /** Current token-free workflow state. */
      readonly current: DevSquadAdoWorkflowState;
    }
  | {
      /** An operation ID was reused for a different kind or semantic request. */
      readonly kind: "idempotency-conflict";
    }
  | {
      /** A durable artifact is malformed, inconsistent, or corrupt. */
      readonly kind: "corrupt-artifact";
      /** Path relative to the ledger root. */
      readonly artifact: string;
    }
  | {
      /** A durable artifact uses a schema newer than this package supports. */
      readonly kind: "unsupported-schema-version";
      /** Path relative to the ledger root. */
      readonly artifact: string;
      /** Unsupported persisted schema number. */
      readonly schemaVersion: number;
    }
  | {
      /** A fail-closed schema-v1 capacity ceiling was reached. */
      readonly kind: "capacity-exceeded";
      /** Bounded aggregate resource. */
      readonly resource:
        | "records"
        | "operations"
        | "checkpoints"
        | "agent-history"
        | "session-history"
        | "generation-bytes";
      /** Fixed schema-v1 capacity ceiling. */
      readonly limit: number;
    }
  | {
      /** A bounded directory or recovery scan reached its ceiling. */
      readonly kind: "scan-limit";
      /** Fixed schema-v1 scan ceiling. */
      readonly limit: number;
    }
  | {
      /** Compare-and-publish did not converge within the retry bound. */
      readonly kind: "contention";
      /** Number of bounded publication attempts. */
      readonly attempts: number;
    }
  | {
      /** A redacted local storage operation failed. */
      readonly kind: "storage";
      /** Whether durable state is unchanged or may require exact retry. */
      readonly outcome: "unchanged" | "indeterminate";
    };

/** Offline handle for one explicit repository-local workflow ledger. */
export interface DevSquadAdoWorkflowLedger {
  /** Create revision one without requiring a claim. */
  readonly initializeRecord: (
    input: InitializeDevSquadAdoWorkflowRecordInput,
  ) => Promise<
    DevSquadAdoLedgerResult<
      DevSquadAdoMutationSuccess<DevSquadAdoInitializedOutcome>
    >
  >;
  /** Read one complete validated token-free record. */
  readonly readRecord: (
    workItemId: DevSquadAdoWorkItemId,
  ) => Promise<DevSquadAdoLedgerResult<DevSquadAdoWorkflowRecord>>;
  /** List all valid initialized records without applying lifecycle policy. */
  readonly listResumableRecords: () => Promise<
    DevSquadAdoLedgerResult<DevSquadAdoResumableRecordList>
  >;
  /** Persist one optimistic workflow checkpoint under current claim authority. */
  readonly checkpoint: (
    input: CheckpointDevSquadAdoWorkflowInput,
  ) => Promise<
    DevSquadAdoLedgerResult<
      DevSquadAdoMutationSuccess<DevSquadAdoCheckpointedOutcome>
    >
  >;
  /** Atomically acquire an absent or expired local mutation claim. */
  readonly acquireClaim: (
    input: AcquireDevSquadAdoWorkflowClaimInput,
  ) => Promise<
    DevSquadAdoLedgerResult<
      DevSquadAdoMutationSuccess<DevSquadAdoClaimAcquiredOutcome>
    >
  >;
  /** Renew the current unexpired claim without changing its fence. */
  readonly renewClaim: (
    input: RenewDevSquadAdoWorkflowClaimInput,
  ) => Promise<
    DevSquadAdoLedgerResult<
      DevSquadAdoMutationSuccess<DevSquadAdoClaimRenewedOutcome>
    >
  >;
  /** Release the current unexpired claim while preserving its fence and history. */
  readonly releaseClaim: (
    input: ReleaseDevSquadAdoWorkflowClaimInput,
  ) => Promise<
    DevSquadAdoLedgerResult<
      DevSquadAdoMutationSuccess<DevSquadAdoClaimReleasedOutcome>
    >
  >;
  /** Perform a bounded read-only deep scan for deterministic recovery diagnostics. */
  readonly inspectRecoveryErrors: () => Promise<
    DevSquadAdoLedgerResult<readonly DevSquadAdoRecoveryError[]>
  >;
}

/**
 * Open or create an offline workflow ledger beneath
 * `<repositoryRoot>/.sandcastle/devsquad-ado/`.
 */
export const openDevSquadAdoWorkflowLedger: (
  input: OpenDevSquadAdoWorkflowLedgerInput,
) => Promise<DevSquadAdoLedgerResult<DevSquadAdoWorkflowLedger>> =
  openDevSquadAdoWorkflowLedgerStorage;
