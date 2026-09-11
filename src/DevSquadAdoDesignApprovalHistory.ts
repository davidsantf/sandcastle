import { createHash } from "node:crypto";
import type { DevSquadAdoWorkflowRecord } from "./DevSquadAdoWorkflowLedger.js";
import { isB32 } from "./DevSquadAdoDesignApprovalValidation.js";

// W049 / SEC-001: full domain-separated commitments, no truncated identities.
export const gateHash = (tuple: readonly unknown[]): string =>
  createHash("sha256")
    .update(JSON.stringify(tuple), "utf8")
    .digest("base64url");

export interface GateHistory {
  readonly occurrence: string;
  readonly proposal: string;
  readonly manifest: string;
  readonly target: string;
  readonly design: string;
  readonly publication: string | null;
  readonly decision: string | null;
  readonly action: "approve-design" | "request-changes" | null;
  readonly reservationRevision: number;
  readonly publicationRevision: number | null;
  readonly resolutionRevision: number | null;
}

/** Complete retained history is eligibility evidence, never a publication ticket. */
export function reduceGateHistory(
  record: DevSquadAdoWorkflowRecord,
  occurrence: string,
):
  | { readonly ok: true; readonly gate: GateHistory | null }
  | { readonly ok: false } {
  const gates = new Map<string, GateHistory>();
  for (const checkpoint of record.checkpoints) {
    const id = checkpoint.operationId;
    if (!id.startsWith("dg15")) continue;
    const fields = id.split(".");
    const [namespace, kind, G] = fields;
    const count = kind === "p" ? 6 : 7;
    if (
      namespace !== "dg15" ||
      !["r", "p", "a", "c"].includes(kind!) ||
      fields.length !== count ||
      !fields.slice(2).every(isB32) ||
      fields.join(".") !== id ||
      checkpoint.previous.phase !== checkpoint.resulting.phase ||
      checkpoint.previous.status !== checkpoint.resulting.status
    )
      return { ok: false };
    const previous = gates.get(G!);
    if (kind === "r") {
      if (previous) return { ok: false };
      const [, , , P, A, T] = fields;
      gates.set(G!, {
        occurrence: G!,
        proposal: P!,
        manifest: A!,
        target: T!,
        design: gateHash(["dg15.design.v1", record.workItemId, P, A]),
        publication: null,
        decision: null,
        action: null,
        reservationRevision: checkpoint.revision,
        publicationRevision: null,
        resolutionRevision: null,
      });
    } else {
      if (!previous || fields[3] !== previous.design) return { ok: false };
      const X = fields[4]!;
      if (kind === "p") {
        if (previous.publication !== null) return { ok: false };
        gates.set(G!, {
          ...previous,
          publication: X,
          publicationRevision: checkpoint.revision,
        });
      } else {
        if (previous.publication !== X || previous.decision !== null)
          return { ok: false };
        gates.set(G!, {
          ...previous,
          decision: fields[5]!,
          action: kind === "a" ? "approve-design" : "request-changes",
          resolutionRevision: checkpoint.revision,
        });
      }
    }
  }
  return { ok: true, gate: gates.get(occurrence) ?? null };
}

/** W055: retained stage revisions are distinct from the latest read revision. */
export const gateRevisions = (gate: GateHistory) => ({
  reservation: gate.reservationRevision,
  publication: gate.publicationRevision,
  resolution: gate.resolutionRevision,
});
