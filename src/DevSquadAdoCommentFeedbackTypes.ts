import type {
  DevSquadAdoClaimAuthorityInput,
  DevSquadAdoWorkItemId,
  DevSquadAdoWorkflowState,
} from "./DevSquadAdoWorkflowLedger.js";
import type {
  DevSquadAdoPhaseDependencies,
  DevSquadAdoPhaseInput,
  DevSquadAdoPhaseRecoveryDependencies,
  DevSquadAdoPhaseResult,
  DevSquadAdoPhaseTerminalReceiptVerifier,
} from "./DevSquadAdoPhaseTypes.js";

export interface DevSquadAdoCommentFeedbackEvidence {
  readonly kind: "comment" | "review-feedback";
  readonly provider: string;
  readonly containerId: string;
  readonly eventId: string;
  readonly eventVersion: string;
  /** Authoritative host-observed order, not identifier spelling. */
  readonly ordinal: number;
  readonly observedAt: string;
  readonly immutableEvidenceId: string;
  /** Untrusted content for normalization, never authorization. */
  readonly body: string;
}

export interface DevSquadAdoCommentFeedbackSource {
  readonly input: DevSquadAdoPhaseInput;
  readonly receipt: {
    readonly state: "completed" | "failed";
    readonly intent: string;
    readonly reservationRevision: number;
    readonly terminalRevision: number;
    readonly receiptDigest: string;
  };
}

export type DevSquadAdoCommentFeedbackSelectionPhase =
  | { readonly kind: "feedback-prepare" }
  | {
      readonly kind: "phase-reentry";
      readonly phase: DevSquadAdoPhaseInput["phase"];
    };

export interface DevSquadAdoCommentFeedbackSelection {
  readonly occurrence: string;
  readonly plugin: { readonly id: string; readonly version: string };
  readonly expected: DevSquadAdoWorkflowState & { readonly revision: number };
  readonly success: DevSquadAdoWorkflowState;
  readonly failure: DevSquadAdoWorkflowState;
  readonly phase: DevSquadAdoCommentFeedbackSelectionPhase;
  readonly authority: DevSquadAdoClaimAuthorityInput;
  readonly timeoutMs?: number;
}

export interface RunDevSquadAdoCommentFeedbackRequest {
  readonly workItemId: DevSquadAdoWorkItemId;
  readonly source: DevSquadAdoCommentFeedbackSource;
  readonly evidence: readonly DevSquadAdoCommentFeedbackEvidence[];
  readonly selection: DevSquadAdoCommentFeedbackSelection;
  /** 1..300000 milliseconds; default 30000. */
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface DevSquadAdoCommentFeedbackNormalizationRequest {
  readonly workItemId: string;
  readonly source: DevSquadAdoCommentFeedbackSource;
  readonly evidence: readonly DevSquadAdoCommentFeedbackEvidence[];
  readonly evidenceDigest: string;
  readonly selection: Omit<
    DevSquadAdoCommentFeedbackSelection,
    "authority" | "timeoutMs"
  >;
}

export interface DevSquadAdoCommentFeedbackRouteAuthorizationRequest {
  readonly workItemId: string;
  readonly source: DevSquadAdoCommentFeedbackSource;
  readonly evidenceDigest: string;
  readonly normalizerId: string;
  readonly normalizedEvidenceId: string;
  readonly normalizedDigest: string;
  readonly normalizedContent: string;
  readonly selectedPhase: DevSquadAdoPhaseInput;
  readonly challenge: string;
  /** Nonsecret identity only. The capability goes only to slice 16. */
  readonly ownerId: string;
  readonly fencingValue: number;
}

export interface DevSquadAdoCommentFeedbackBinding {
  readonly sourceIntent: string;
  readonly sourceTerminalRevision: number;
  readonly sourceReceiptDigest: string;
  readonly evidenceDigest: string;
  readonly normalizedDigest: string;
  readonly selectedOccurrence: string;
}

export interface DevSquadAdoCommentFeedbackDependencies {
  readonly normalizeFeedback: (
    request: DevSquadAdoCommentFeedbackNormalizationRequest,
    signal: AbortSignal,
  ) => Promise<
    | {
        readonly kind: "normalized";
        readonly request: DevSquadAdoCommentFeedbackNormalizationRequest;
        readonly content: string;
        readonly normalizerId: string;
        readonly immutableEvidenceId: string;
      }
    | { readonly kind: "rejected" }
  >;
  readonly authorizeRoute: (
    request: DevSquadAdoCommentFeedbackRouteAuthorizationRequest,
    signal: AbortSignal,
  ) => Promise<
    | {
        readonly kind: "granted";
        readonly request: DevSquadAdoCommentFeedbackRouteAuthorizationRequest;
        readonly expiresAt: string;
      }
    | { readonly kind: "denied" }
  >;
  /** Slice 16 remains the only mutation/execution protocol. */
  readonly phase: DevSquadAdoPhaseDependencies;
  readonly utcNow?: () => number;
  readonly monotonicNow?: () => number;
}

export interface DevSquadAdoCommentFeedbackRecoveryRequest {
  readonly workItemId: DevSquadAdoWorkItemId;
  readonly source: DevSquadAdoCommentFeedbackSource;
  /** Exact host-retained selected input returned to slice 16 originally. */
  readonly selectedPhase: DevSquadAdoPhaseInput;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface DevSquadAdoCommentFeedbackRecoveryDependencies {
  readonly phase: DevSquadAdoPhaseRecoveryDependencies;
  readonly verifySourceReceipt?: DevSquadAdoPhaseTerminalReceiptVerifier;
  readonly utcNow?: () => number;
  readonly monotonicNow?: () => number;
}

export interface DevSquadAdoCommentFeedbackResult {
  readonly state: "blocked" | "delegated";
  readonly reason:
    | "delegated"
    | "invalid-input"
    | "input-limit"
    | "source-unverified"
    | "normalization-rejected"
    | "route-denied"
    | "dependency-failed"
    | "deadline"
    | "cancelled"
    | "call-limit";
  readonly binding: DevSquadAdoCommentFeedbackBinding | null;
  readonly phase: DevSquadAdoPhaseResult | null;
}
