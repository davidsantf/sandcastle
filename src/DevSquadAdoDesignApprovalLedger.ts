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
    const after = inspectDesignGateRecord(v.record, before.workItemId);
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
    const expected = {
      ...before,
      revision: v.acceptedRevision,
      updatedAt: v.acceptedAt,
      checkpoints: [...before.checkpoints, entry],
    };
    if (JSON.stringify(after) !== JSON.stringify(expected)) return null;
    if (!reduceGateHistory(after, original.operationId.split(".")[2]!).ok)
      return null;
    return after;
  } catch {
    return null;
  }
}
