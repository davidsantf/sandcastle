import type {
  CheckpointDevSquadAdoWorkflowInput,
  DevSquadAdoWorkflowRecord,
} from "./DevSquadAdoWorkflowLedger.js";
import { inspectDesignGateRecord } from "./DevSquadAdoDesignApprovalValidation.js";
import { reduceGateHistory } from "./DevSquadAdoDesignApprovalHistory.js";

/** W050: compare only original semantic submission and independently captured record. */
export function freshGateAcknowledgement(
  response: unknown,
  original: CheckpointDevSquadAdoWorkflowInput,
  before: DevSquadAdoWorkflowRecord,
  now: number,
  lifecycle?: import("./DevSquadAdoDesignApprovalLifecycle.js").GateLifecycle,
): DevSquadAdoWorkflowRecord | null {
  try {
    if (
      !response ||
      typeof response !== "object" ||
      !("ok" in response) ||
      response.ok !== true ||
      !("value" in response)
    )
      return null;
    const v = response.value as Record<string, unknown>;
    if (
      !v ||
      typeof v !== "object" ||
      v.replayed !== false ||
      v.acceptedRevision !== original.expected.revision + 1 ||
      typeof v.acceptedAt !== "string" ||
      !Number.isFinite(Date.parse(v.acceptedAt)) ||
      new Date(v.acceptedAt).toISOString() !== v.acceptedAt ||
      v.acceptedAt < before.updatedAt
    )
      return null;
    const claim = before.activeClaim;
    if (
      !claim ||
      claim.ownerId !== original.authority.ownerId ||
      claim.fencingValue !== original.authority.fencingValue ||
      !Number.isFinite(now) ||
      now >= Date.parse(claim.expiresAt) ||
      Date.parse(v.acceptedAt) >= Date.parse(claim.expiresAt)
    )
      return null;
    const after = inspectDesignGateRecord(
      v.record,
      before.workItemId,
      lifecycle,
    );
    if (
      !after ||
      after.revision !== v.acceptedRevision ||
      after.updatedAt !== v.acceptedAt
    )
      return null;
    const entry = {
      revision: v.acceptedRevision,
      operationId: original.operationId,
      acceptedAt: v.acceptedAt,
      previous: {
        phase: original.expected.phase,
        status: original.expected.status,
      },
      resulting: { phase: original.patch.phase, status: original.patch.status },
    };
    const outcome = v.outcome as {
      kind?: unknown;
      checkpoint?: unknown;
    } | null;
    if (!outcome || outcome.kind !== "checkpointed") return null;
    // Read only fixed checkpoint fields; dependency extensions cannot enter diagnostics.
    const raw = outcome.checkpoint as typeof entry | null;
    if (
      !raw ||
      raw.revision !== entry.revision ||
      raw.operationId !== entry.operationId ||
      raw.acceptedAt !== entry.acceptedAt ||
      raw.previous?.phase !== entry.previous.phase ||
      raw.previous?.status !== entry.previous.status ||
      raw.resulting?.phase !== entry.resulting.phase ||
      raw.resulting?.status !== entry.resulting.status
    )
      return null;
    // W056: compare retained fields in place; do not construct a third full record.
    if (after.checkpoints.length !== before.checkpoints.length + 1) return null;
    lifecycle?.visitHistory(
      before.checkpoints.length +
        before.agent.history.length +
        before.session.history.length,
    );
    for (const key of Object.keys(before) as Array<
      keyof DevSquadAdoWorkflowRecord
    >) {
      if (key === "revision" || key === "updatedAt" || key === "checkpoints")
        continue;
      if (JSON.stringify(after[key]) !== JSON.stringify(before[key]))
        return null;
    }
    for (let i = 0; i < before.checkpoints.length; i++)
      if (
        JSON.stringify(after.checkpoints[i]) !==
        JSON.stringify(before.checkpoints[i])
      )
        return null;
    if (JSON.stringify(after.checkpoints.at(-1)) !== JSON.stringify(entry))
      return null;
    if (
      !reduceGateHistory(after, original.operationId.split(".")[2]!, lifecycle)
        .ok
    )
      return null;
    return after;
  } catch {
    return null;
  }
}

// W054 / FR-020: known CAS/capability rejections are not an invitation to rebase.
export function gateLedgerRejection(
  response: unknown,
):
  | import("./DevSquadAdoDesignApproval.js").DevSquadAdoDesignApprovalResult["reason"]
  | null {
  try {
    const r = response as { ok?: unknown; error?: { kind?: unknown } };
    if (r?.ok !== false) return null;
    switch (r.error?.kind) {
      case "revision-conflict":
        return "revision-conflict";
      case "state-conflict":
        return "state-conflict";
      case "idempotency-conflict":
        return "idempotency-conflict";
      case "claim-expired":
        return "authority-expired";
      case "stale-fencing":
      case "claim-not-held":
      case "claim-token-mismatch":
        return "authority-rejected";
      default:
        return null;
    }
  } catch {
    return null;
  }
}
