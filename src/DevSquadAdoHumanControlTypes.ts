import type {
  CheckpointDevSquadAdoWorkflowInput,
  DevSquadAdoClaimAuthorityInput,
  DevSquadAdoWorkflowLedger,
  DevSquadAdoWorkflowState,
  DevSquadAdoWorkItemId,
} from "./DevSquadAdoWorkflowLedger.js";
import type {
  DevSquadAdoPhaseInput,
  DevSquadAdoPhaseRecoveryDependencies,
  DevSquadAdoPhaseResult,
} from "./DevSquadAdoPhaseTypes.js";

export interface DevSquadAdoHumanDecision {
  readonly actorId: string;
  readonly decisionId: string;
  /** SHA-256 of immutable host-retained human evidence; canonical B32. */
  readonly evidenceDigest: string;
}

export type DevSquadAdoHumanControlReadAction =
  | { readonly kind: "status" }
  | { readonly kind: "audit"; readonly limit?: number };

export type DevSquadAdoHumanControlMutationKind =
  | "pause"
  | "resume"
  | "cancel"
  | "finalize";

export interface DevSquadAdoHumanControlMutationAction {
  readonly kind: DevSquadAdoHumanControlMutationKind;
  readonly occurrence: string;
  readonly expected: DevSquadAdoWorkflowState & { readonly revision: number };
  readonly resulting: DevSquadAdoWorkflowState;
  readonly authority: DevSquadAdoClaimAuthorityInput;
  readonly decision: DevSquadAdoHumanDecision;
}

export interface DevSquadAdoHumanControlAdjudicationAction {
  readonly kind: "adjudicate";
  /** Exact host-retained input for the already reserved uncertain occurrence. */
  readonly phase: DevSquadAdoPhaseInput;
  readonly outcome: "completed" | "failed";
  /** SHA-256 of immutable host-retained effect evidence; canonical B32. */
  readonly receiptDigest: string;
  readonly expected: DevSquadAdoWorkflowState & { readonly revision: number };
  readonly authority: DevSquadAdoClaimAuthorityInput;
  readonly decision: DevSquadAdoHumanDecision;
}

export type DevSquadAdoHumanControlAction =
  | DevSquadAdoHumanControlReadAction
  | DevSquadAdoHumanControlMutationAction
  | DevSquadAdoHumanControlAdjudicationAction;

export type DevSquadAdoHumanControlAuthorizedAction =
  | (Omit<DevSquadAdoHumanControlMutationAction, "authority"> & {
      readonly ownerId: string;
      readonly fencingValue: number;
    })
  | (Omit<DevSquadAdoHumanControlAdjudicationAction, "authority"> & {
      readonly ownerId: string;
      readonly fencingValue: number;
    });

export interface RunDevSquadAdoHumanControlRequest {
  readonly workItemId: DevSquadAdoWorkItemId;
  readonly action: DevSquadAdoHumanControlAction;
  /** 1..300000 milliseconds; default 10000. */
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface DevSquadAdoHumanControlVerificationRequest {
  readonly workItemId: string;
  readonly action: DevSquadAdoHumanControlAuthorizedAction;
  readonly intent: string;
  readonly challenge: string;
}

export interface DevSquadAdoHumanControlPolicyRequest {
  readonly workItemId: string;
  readonly action: DevSquadAdoHumanControlAuthorizedAction;
  readonly intent: string;
  readonly operationId: string;
}

export interface DevSquadAdoHumanControlRetainedVerificationRequest extends DevSquadAdoHumanControlPolicyRequest {
  readonly acceptedRevision: number;
  readonly acceptedAt: string;
}

export interface DevSquadAdoHumanControlDependencies {
  readonly ledger: Pick<DevSquadAdoWorkflowLedger, "readRecord"> &
    Partial<Pick<DevSquadAdoWorkflowLedger, "checkpoint">>;
  readonly verifyHumanDecision?: (
    request: DevSquadAdoHumanControlVerificationRequest,
    signal: AbortSignal,
  ) => Promise<
    | {
        readonly kind: "verified";
        readonly request: DevSquadAdoHumanControlVerificationRequest;
        readonly verifierId: string;
        readonly immutableEvidenceId: string;
        readonly expiresAt: string;
      }
    | { readonly kind: "unavailable" | "denied" }
  >;
  readonly authorizeControl?: (
    request: DevSquadAdoHumanControlPolicyRequest,
    signal: AbortSignal,
  ) => Promise<
    | {
        readonly kind: "granted";
        readonly request: DevSquadAdoHumanControlPolicyRequest;
        readonly expiresAt: string;
      }
    | { readonly kind: "denied" }
  >;
  readonly verifyRetainedControl?: (
    request: DevSquadAdoHumanControlRetainedVerificationRequest,
    signal: AbortSignal,
  ) => Promise<
    | {
        readonly kind: "verified";
        readonly request: DevSquadAdoHumanControlRetainedVerificationRequest;
        readonly verifierId: string;
        readonly immutableEvidenceId: string;
        readonly expiresAt: string;
      }
    | { readonly kind: "unavailable" | "denied" }
  >;
  readonly phaseRecovery?: DevSquadAdoPhaseRecoveryDependencies;
  readonly utcNow?: () => number;
  readonly monotonicNow?: () => number;
}

export interface DevSquadAdoHumanControlAuditEntry {
  readonly revision: number;
  readonly operationId: string;
  readonly acceptedAt: string;
  readonly previous: DevSquadAdoWorkflowState;
  readonly resulting: DevSquadAdoWorkflowState;
}

export interface DevSquadAdoHumanControlSnapshot {
  readonly revision: number;
  readonly phase: string;
  readonly status: string;
  readonly activeClaim: {
    readonly ownerId: string;
    readonly fencingValue: number;
    readonly expiresAt: string;
  } | null;
  readonly pendingPhaseOccurrence: string | null;
  readonly audit: readonly DevSquadAdoHumanControlAuditEntry[];
}

export interface DevSquadAdoHumanControlResult {
  readonly state: "observed" | "recorded" | "blocked" | "pending";
  readonly reason:
    | "observed"
    | "recorded"
    | "invalid-input"
    | "input-limit"
    | "history-conflict"
    | "intent-conflict"
    | "state-conflict"
    | "authority-rejected"
    | "human-unverified"
    | "policy-denied"
    | "phase-unverified"
    | "dependency-failed"
    | "deadline"
    | "cancelled"
    | "call-limit"
    | "mutation-unconfirmed"
    | "ledger-unavailable";
  readonly intent: string | null;
  readonly knownRevision: number | null;
  readonly snapshot: DevSquadAdoHumanControlSnapshot | null;
  readonly phase: DevSquadAdoPhaseResult | null;
}

export type DevSquadAdoHumanControlCheckpoint =
  CheckpointDevSquadAdoWorkflowInput;
