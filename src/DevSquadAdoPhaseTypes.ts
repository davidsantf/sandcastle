import type {
  DevSquadAdoClaimAuthorityInput,
  DevSquadAdoWorkflowLedger,
  DevSquadAdoWorkflowState,
  DevSquadAdoWorkItemId,
} from "./DevSquadAdoWorkflowLedger.js";
import type {
  DevSquadSandcastleExecutionRequest,
  DevSquadSandcastleRunConfig,
  RunDevSquadSandcastleExecutionOptions,
} from "./DevSquadSandcastleExecutionAdapter.js";
import type {
  DevSquadAdoDesignTarget,
  DevSquadAdoDesignTargetVerifier,
} from "./DevSquadAdoDesignApprovalTarget.js";

/** Optional provenance binding supplied by a higher-level host coordinator. */
export interface DevSquadAdoPhaseFeedbackBinding {
  readonly sourceOccurrence: string;
  readonly sourceIntent: string;
  readonly sourceState: "completed" | "failed";
  readonly sourceReservationRevision: number;
  readonly sourceTerminalRevision: number;
  readonly sourceReceiptDigest: string;
  readonly evidenceDigest: string;
  readonly normalizedDigest: string;
}

/** The host chooses phase vocabulary, ordering, plugin version, and transitions. */
export interface DevSquadAdoPhaseInput {
  readonly workItemId: DevSquadAdoWorkItemId;
  /** Stable canonical B32 occurrence; never rotate it to retry an unknown effect. */
  readonly occurrence: string;
  readonly plugin: { readonly id: string; readonly version: string };
  readonly expected: DevSquadAdoWorkflowState & { readonly revision: number };
  readonly success: DevSquadAdoWorkflowState;
  readonly failure: DevSquadAdoWorkflowState;
  /** Integrity provenance only. It is never execution or lifecycle authority. */
  readonly feedback?: DevSquadAdoPhaseFeedbackBinding;
  readonly phase:
    | {
        readonly kind: "prepare";
        /** Content-only engineering phase; not a publication/control-plane action. */
        readonly content: string;
      }
    | {
        readonly kind: "implement";
        readonly execution: Omit<
          DevSquadSandcastleExecutionRequest,
          "sandcastle" | "signal"
        >;
        readonly approval: {
          readonly occurrence: string;
          readonly design: string;
          readonly target: DevSquadAdoDesignTarget;
        };
      };
}

/** Per-invocation capability and cancellation are never part of the semantic intent. */
export interface RunDevSquadAdoPhaseRequest extends DevSquadAdoPhaseInput {
  readonly authority: DevSquadAdoClaimAuthorityInput;
  /** 1..300000 milliseconds; default 30000. No autonomous renewal. */
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface DevSquadAdoPhasePolicyRequest {
  readonly action: "reserve" | "dispatch" | "complete" | "fail";
  readonly input: DevSquadAdoPhaseInput;
  readonly intent: string;
  readonly operationId: string;
  readonly expected: DevSquadAdoWorkflowState & { readonly revision: number };
  readonly patch: DevSquadAdoWorkflowState;
  /** Nonsecret identity only. The capability goes exclusively to the ledger. */
  readonly ownerId: string;
  readonly fencingValue: number;
}

/** Trusted host evidence, rehydrated independently of historical gate status. */
export interface DevSquadAdoPhaseDesignRequest {
  readonly input: DevSquadAdoPhaseInput;
  readonly intent: string;
  readonly challenge: string;
  /** Captured provider identity for the exact capability that will be invoked. */
  readonly execution:
    | { readonly mode: "supplied" }
    | {
        readonly mode: "sandcastle";
        readonly agent: string;
        readonly sandbox: string;
        readonly sandboxKind: "bind-mount" | "isolated" | "none";
      };
  readonly gate: {
    readonly occurrence: string;
    readonly proposal: string;
    readonly manifest: string;
    readonly design: string;
    readonly target: string;
    readonly publication: string;
    readonly decision: string;
    readonly resolutionRevision: number;
  };
}

/** Exact terminal history presented to a trusted host audit verifier. */
export interface DevSquadAdoPhaseReceiptVerificationRequest {
  readonly input: DevSquadAdoPhaseInput;
  readonly intent: string;
  readonly challenge: string;
  readonly receipt: {
    readonly state: "completed" | "failed";
    readonly reservationRevision: number;
    readonly terminalRevision: number;
    readonly receiptDigest: string;
  };
}

export type DevSquadAdoPhaseTerminalReceiptVerifier = (
  request: DevSquadAdoPhaseReceiptVerificationRequest,
  signal: AbortSignal,
) => Promise<
  | {
      readonly kind: "verified";
      readonly request: DevSquadAdoPhaseReceiptVerificationRequest;
      readonly verifierId: string;
      readonly immutableEvidenceId: string;
      /** Canonical UTC ISO; fresh verification lasts at most five seconds. */
      readonly expiresAt: string;
    }
  | { readonly kind: "unavailable" | "denied" }
>;

/** A settled preparation result; no raw artifact, diagnostic, or session body. */
export interface DevSquadAdoPhasePreparationReceipt {
  readonly kind: "completed" | "failed";
  /** SHA-256 of the host-retained immutable output; canonical B32. */
  readonly artifactDigest: string;
}

export interface DevSquadAdoPhaseDependencies {
  readonly ledger: Pick<DevSquadAdoWorkflowLedger, "readRecord" | "checkpoint">;
  readonly authorizePhase: (
    request: DevSquadAdoPhasePolicyRequest,
    signal: AbortSignal,
  ) => Promise<
    | {
        readonly kind: "granted";
        readonly request: DevSquadAdoPhasePolicyRequest;
        /** Canonical UTC ISO; fresh authorization lasts at most five seconds. */
        readonly expiresAt: string;
      }
    | { readonly kind: "denied" }
  >;
  /**
   * Verify the immutable publication, exact recorded human grant/decision and
   * approved artifacts against the ACTUAL executable spec/plan/commands/target.
   * Never implement as `gate.action === "approve-design"` or engineering approval.
   */
  readonly verifyDesignAuthorization?: (
    request: DevSquadAdoPhaseDesignRequest,
    signal: AbortSignal,
  ) => Promise<
    | {
        readonly kind: "verified";
        readonly request: DevSquadAdoPhaseDesignRequest;
        readonly verifierId: string;
        readonly immutableEvidenceId: string;
        readonly expiresAt: string;
      }
    | { readonly kind: "unavailable" | "denied" }
  >;
  readonly verifyCurrentTarget?: DevSquadAdoDesignTargetVerifier;
  /**
   * Rehydrate the exact policy/design/execution audit trail behind a retained
   * terminal checkpoint. The public ledger commitment alone is forgeable by
   * another holder of generic workflow-ledger mutation authority.
   */
  readonly verifyTerminalReceipt?: DevSquadAdoPhaseTerminalReceiptVerifier;
  readonly prepare?: (
    request: {
      readonly input: DevSquadAdoPhaseInput;
      readonly intent: string;
      readonly reservationRevision: number;
    },
    signal: AbortSignal,
  ) => Promise<DevSquadAdoPhasePreparationReceipt>;
  /** Existing adapter configuration, not serializable workflow data. */
  readonly execution?: RunDevSquadSandcastleExecutionOptions;
  readonly sandcastle?: DevSquadSandcastleRunConfig;
  readonly utcNow?: () => number;
  readonly monotonicNow?: () => number;
}

/** Recovery has no ledger mutation capability and never dispatches work. */
export interface DevSquadAdoPhaseRecoveryDependencies {
  readonly ledger: Pick<DevSquadAdoWorkflowLedger, "readRecord">;
  readonly verifyTerminalReceipt?: DevSquadAdoPhaseTerminalReceiptVerifier;
  /** 1..300000 milliseconds; default 10000. */
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly utcNow?: () => number;
  readonly monotonicNow?: () => number;
}

export interface DevSquadAdoPhaseResult {
  readonly state: "unreserved" | "pending" | "completed" | "failed" | "blocked";
  readonly reason:
    | "unreserved"
    | "recorded"
    | "attempt-consumed"
    | "invalid-input"
    | "input-limit"
    | "history-conflict"
    | "intent-conflict"
    | "other-attempt-pending"
    | "state-conflict"
    | "authority-rejected"
    | "policy-denied"
    | "design-unverified"
    | "target-unverified"
    | "receipt-unverified"
    | "dependency-failed"
    | "deadline"
    | "cancelled"
    | "call-limit"
    | "reservation-unconfirmed"
    | "completion-unconfirmed"
    | "ledger-unavailable";
  readonly intent: string | null;
  readonly knownRevision: number | null;
  readonly reservationRevision?: number;
  readonly terminalRevision?: number;
  readonly receiptDigest?: string;
}
