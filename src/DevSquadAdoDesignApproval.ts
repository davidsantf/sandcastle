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
    | "changes-requested";
  /** Whether the inspected evidence supports the reported state. */
  readonly verificationStatus:
    | "verified"
    | "evidence-unavailable"
    | "publication-unverified";
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
    | "publication-evidence-unavailable";
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
    // W048: retire read continuation on timeout/abort, including late rejection.
    const response = await new Promise<unknown>((resolve) => {
      let active = true;
      const finish = (value: unknown) => {
        if (!active) return;
        active = false;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        resolve(value);
      };
      const abort = () => finish("cancelled");
      const timer = setTimeout(() => finish("dependency-timeout"), 5000);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) {
        abort();
        return;
      }
      try {
        Promise.resolve(readRecord.call(ledger, workItemId)).then(finish, () =>
          finish(null),
        );
      } catch {
        finish(null);
      }
    });
    if (signal?.aborted || response === "cancelled") return failed("cancelled");
    if (response === "dependency-timeout") return failed("dependency-timeout");
    if (
      typeof response !== "object" ||
      response === null ||
      !("ok" in response) ||
      response.ok !== true ||
      !("value" in response)
    )
      return failed("evidence-unavailable");
    const record = inspectDesignGateRecord(response.value, workItemId);
    if (!record) return failed("evidence-unavailable");
    const history = reduceGateHistory(record, occurrence);
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
      };
    return {
      durableState: "unreserved",
      verificationStatus: "verified",
      targetHandoff: "not-requested",
      reason: "unreserved",
      binding: { workItemId, occurrence },
      knownRevision: record.revision,
    };
  } catch {
    return failed("invalid-input");
  }
}
