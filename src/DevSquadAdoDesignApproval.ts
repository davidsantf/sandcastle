import { gateLedgerRejection } from "./DevSquadAdoDesignApprovalLedger.js";
import {
  GateFault,
  GateLifecycle,
} from "./DevSquadAdoDesignApprovalLifecycle.js";
import { gateRevisions } from "./DevSquadAdoDesignApprovalHistory.js";
import { startGatePublication } from "./DevSquadAdoDesignApprovalPublication.js";
import { reduceGateHistory } from "./DevSquadAdoDesignApprovalHistory.js";
import {
  canonicalWorkItem,
  isB32,
  inspectDesignGateRecord,
} from "./DevSquadAdoDesignApprovalValidation.js";
import type {
  DevSquadAdoWorkItemId,
  DevSquadAdoWorkflowLedger,
} from "./DevSquadAdoWorkflowLedger.js";

/** One host-selected occurrence to inspect without mutation (W048, FR-019). */
export interface DevSquadAdoDesignRecoveryRequest {
  /** Canonical ledger work-item identity. */
  readonly workItemId: DevSquadAdoWorkItemId;
  /** Host-selected canonical 32-byte occurrence identity. */
  readonly occurrence: string;
  /** Live cooperative cancellation; never authority. */
  readonly signal?: AbortSignal;
}
/** Read-only host dependency boundary. */
export interface DevSquadAdoDesignRecoveryDependencies {
  /** Monotonic deadline clock; defaults to performance.now. */
  readonly monotonicNow?: () => number;
  /** Public read only; no claim or checkpoint operations are needed. */
  readonly ledger: Pick<DevSquadAdoWorkflowLedger, "readRecord">;
}
/** Minimized recovery result; no external evidence or execution permission. */
export interface DevSquadAdoDesignApprovalResult {
  /** State established by bounded durable history inspection. */
  readonly durableState:
    | "unreserved"
    | "unreadable"
    | "attempt-consumed"
    | "publication-confirmed"
    | "approved"
    | "changes-requested"
    | "reservation-unconfirmed";
  /** Whether the inspected evidence supports the reported state. */
  readonly verificationStatus:
    | "verified"
    | "evidence-unavailable"
    | "publication-unverified"
    | "mutation-unconfirmed"
    | "decision-pending"
    | "conflicting-evidence";
  /** Recovery does not infer an execution target. */
  readonly targetHandoff: "not-requested";
  /** Stable category, never dependency-controlled diagnostics. */
  readonly reason:
    | "unreserved"
    | "input-limit"
    | "invalid-input"
    | "cancelled"
    | "dependency-timeout"
    | "evidence-unavailable"
    | "conflicting-gate-history"
    | "publication-evidence-unavailable"
    | "authority-required"
    | "authority-expired"
    | "authority-rejected"
    | "host-authorization-unavailable"
    | "design-mismatch"
    | "reservation-outcome-unknown"
    | "publication-outcome-unknown"
    | "dependency-limit"
    | "publication-mismatch"
    | "publication-ambiguous"
    | "no-eligible-decision"
    | "decision-prefix-incomplete"
    | "decision-authorization-unresolved"
    | "resolution-outcome-unknown"
    | "human-decision-confirmed"
    | "revision-conflict"
    | "state-conflict"
    | "idempotency-conflict"
    | "capacity-exceeded"
    | "corrupt-ledger"
    | "unsupported-schema"
    | "unsupported-platform";
  /** Canonical requested binding, only after validation. */
  readonly binding: {
    readonly workItemId: string;
    readonly occurrence: string;
    /** Recovered immutable design commitment; not reconstructed content. */
    readonly design?: string;
    /** Reviewed content commitment. */
    readonly proposal?: string;
    /** Immutable artifact manifest commitment. */
    readonly manifest?: string;
    /** Explicit target commitment, independent of current ledger fields. */
    readonly target?: string;
  } | null;
  /** Known accepted stage revisions; absent when no gate history is established. */
  readonly checkpointRevisions?: {
    /** Sole attempt reservation. */
    readonly reservation: number;
    /** Matching publication confirmation, or null. */
    readonly publication: number | null;
    /** Combined human resolution slot, or null. */
    readonly resolution: number | null;
  };
  /** Latest validated record revision, otherwise null. */
  readonly knownRevision: number | null;
}
/** Inspect one occurrence without writing, publishing, claiming, or executing. */
export async function recoverDevSquadAdoDesignApproval(
  request: DevSquadAdoDesignRecoveryRequest,
  dependencies: DevSquadAdoDesignRecoveryDependencies,
): Promise<DevSquadAdoDesignApprovalResult> {
  const failed = (
    reason: DevSquadAdoDesignApprovalResult["reason"],
  ): DevSquadAdoDesignApprovalResult => ({
    durableState: "unreadable",
    verificationStatus: "evidence-unavailable",
    targetHandoff: "not-requested",
    reason,
    binding: null,
    knownRevision: null,
  });
  try {
    const workItemId = canonicalWorkItem(request.workItemId);
    const occurrence = request.occurrence;
    const signal = request.signal;
    const ledger = dependencies.ledger;
    const readRecord = ledger.readRecord;
    if (
      workItemId === null ||
      !isB32(occurrence) ||
      typeof readRecord !== "function" ||
      (signal !== undefined &&
        (typeof signal.aborted !== "boolean" ||
          typeof signal.addEventListener !== "function" ||
          typeof signal.removeEventListener !== "function"))
    )
      return failed("invalid-input");
    if (signal?.aborted) return failed("cancelled");
    // W056: read-only recovery uses the same budgets and continuation retirement.
    const lifecycle = new GateLifecycle(
      signal,
      dependencies.monotonicNow ?? (() => performance.now()),
    );
    const response: unknown = await lifecycle.call("read", () =>
      readRecord.call(ledger, workItemId),
    );
    if (signal?.aborted || response === "cancelled") return failed("cancelled");
    if (response === "dependency-timeout") return failed("dependency-timeout");
    if (
      typeof response !== "object" ||
      response === null ||
      !("ok" in response) ||
      response.ok !== true ||
      !("value" in response)
    )
      return failed(gateLedgerRejection(response) ?? "evidence-unavailable");
    const record = inspectDesignGateRecord(
      response.value,
      workItemId,
      lifecycle,
    );
    if (!record) return failed("evidence-unavailable");
    const history = reduceGateHistory(record, occurrence, lifecycle);
    if (!history.ok) return failed("conflicting-gate-history");
    const gate = history.gate;
    if (gate)
      return {
        durableState:
          gate.action === "approve-design"
            ? "approved"
            : gate.action === "request-changes"
              ? "changes-requested"
              : gate.publication
                ? "publication-confirmed"
                : "attempt-consumed",
        verificationStatus: gate.publication
          ? "evidence-unavailable"
          : "publication-unverified",
        targetHandoff: "not-requested",
        reason: "publication-evidence-unavailable",
        binding: {
          workItemId,
          occurrence,
          design: gate.design,
          proposal: gate.proposal,
          manifest: gate.manifest,
          target: gate.target,
        },
        knownRevision: record.revision,
        checkpointRevisions: gateRevisions(gate),
      };
    return {
      durableState: "unreserved",
      verificationStatus: "verified",
      targetHandoff: "not-requested",
      reason: "unreserved",
      binding: { workItemId, occurrence },
      knownRevision: record.revision,
    };
  } catch (error) {
    return failed(error instanceof GateFault ? error.reason : "invalid-input");
  }
}

/** Start an explicitly selected occurrence; development approval is not a grant. */
export async function startDevSquadAdoDesignApproval(
  request: import("./DevSquadAdoDesignApprovalPublication.js").DevSquadAdoDesignStartRequest,
  dependencies: import("./DevSquadAdoDesignApprovalPublication.js").DevSquadAdoDesignStartDependencies,
): Promise<DevSquadAdoDesignApprovalResult> {
  return startGatePublication(request, dependencies);
}

/** Reconcile evidence for an existing reservation, with zero publisher invocations. */
export async function reconcileDevSquadAdoDesignApproval(
  request: import("./DevSquadAdoDesignApprovalPublication.js").DevSquadAdoDesignStartRequest,
  dependencies: import("./DevSquadAdoDesignApprovalPublication.js").DevSquadAdoDesignStartDependencies,
): Promise<DevSquadAdoDesignApprovalResult> {
  return startGatePublication(request, dependencies, "reconcile");
}
