import type { DevSquadAdoDesignApprovalResult } from "./DevSquadAdoDesignApproval.js";
import type { DevSquadAdoDesignScope } from "./DevSquadAdoDesignApprovalPublication.js";
import {
  identifier,
  scopeCopy,
} from "./DevSquadAdoDesignApprovalPublication.js";
import { isB32, unicode } from "./DevSquadAdoDesignApprovalValidation.js";
import { gateHash } from "./DevSquadAdoDesignApprovalHistory.js";
import {
  GateFault,
  type GateLifecycle,
} from "./DevSquadAdoDesignApprovalLifecycle.js";
/** Exact immutable target identity, not a current-ledger historical snapshot. */
export type DevSquadAdoDesignTarget =
  | readonly ["none"]
  | readonly [
      "bound",
      DevSquadAdoDesignScope,
      string,
      string,
      string,
      string,
      string,
      string,
      string | null,
      string | null,
    ];
/** Optional request for descriptive proof only. Host must revalidate before execution. */
export interface DevSquadAdoDesignTargetRequest {
  /** Host-issued nonsecret challenge unique to this request. */ readonly challenge: string;
  /** Original descriptor independently committed by the reservation. */ readonly original: DevSquadAdoDesignTarget;
}
/** Offline independent current observation; no filesystem or execution operations in core. */
export type DevSquadAdoDesignTargetVerifier = (
  request: DevSquadAdoDesignTargetRequest & {
    /** Canonical work item. */ readonly workItemId: string;
    /** Explicit occurrence. */ readonly occurrence: string;
    /** Immutable reviewed design. */ readonly design: string;
    /** Original target commitment. */ readonly target: string;
  },
  signal: AbortSignal,
) => Promise<
  | {
      /** Successful observation, not execution authority. */ readonly kind: "verified";
      /** Exact request work item. */ readonly workItemId: string;
      /** Exact request occurrence. */ readonly occurrence: string;
      /** Exact request design. */ readonly design: string;
      /** Exact request target commitment. */ readonly target: string;
      /** Exact request challenge. */ readonly challenge: string;
      /** Independently observed complete descriptor. */ readonly descriptor: DevSquadAdoDesignTarget;
      /** UTC-millisecond observation timestamp; at most five seconds old at return. */ readonly observedAt: string;
      /** Configured trusted verifier identity. */ readonly verifierId: string;
      /** Immutable observation evidence identity. */ readonly immutableEvidenceId: string;
    }
  | {
      /** Stable non-success without diagnostics. */ readonly kind:
        | "mismatch"
        | "unavailable";
    }
>;
/** W060: validate scalar bounds before copying the fixed target tuple. */
export function copyDesignTarget(value: unknown): DevSquadAdoDesignTarget {
  if (!Array.isArray(value)) throw new GateFault("target-mismatch");
  if (value.length === 1 && value[0] === "none") return ["none"];
  if (value.length !== 10 || value[0] !== "bound")
    throw new GateFault("target-mismatch");
  const scope = scopeCopy(value[1]);
  if (
    ![value[2], value[3], value[5], value[7]].every(identifier) ||
    !isB32(value[4]) ||
    !(value[8] === null || identifier(value[8])) ||
    !(value[9] === null || identifier(value[9]))
  )
    throw new GateFault("target-mismatch");
  const path = value[6];
  if (
    typeof path !== "string" ||
    path.length > 4096 ||
    !unicode(path) ||
    Buffer.byteLength(path) > 4096 ||
    !(
      path.startsWith("/") ||
      /^[A-Za-z]:[\\/]/.test(path) ||
      /^\\\\[^\\/]+[\\/][^\\/]+/.test(path)
    ) ||
    /[\u0000-\u001f]/.test(path)
  )
    throw new GateFault("target-mismatch");
  const copy: DevSquadAdoDesignTarget = [
    "bound",
    scope,
    value[2],
    value[3],
    value[4],
    value[5],
    path,
    value[7],
    value[8],
    value[9],
  ];
  if (Buffer.byteLength(JSON.stringify(copy)) > 8192)
    throw new GateFault("input-limit");
  return copy;
}
export function copyTargetRequest(
  value: DevSquadAdoDesignTargetRequest | undefined,
): DevSquadAdoDesignTargetRequest | undefined {
  if (value === undefined) return undefined;
  if (!identifier(value.challenge)) throw new GateFault("invalid-input");
  return {
    challenge: value.challenge,
    original: copyDesignTarget(value.original),
  };
}
/** W060 / SEC-007: independent current proof never rewrites historical approval. */
export async function verifyGateTarget(
  result: DevSquadAdoDesignApprovalResult,
  request: DevSquadAdoDesignTargetRequest | undefined,
  verify: DevSquadAdoDesignTargetVerifier | undefined,
  lifecycle: GateLifecycle,
  utcNow: () => number,
): Promise<DevSquadAdoDesignApprovalResult> {
  if (!request) return result;
  const blocked = (
    reason: DevSquadAdoDesignApprovalResult["reason"],
  ): DevSquadAdoDesignApprovalResult => ({
    ...result,
    targetHandoff: "blocked",
    reason,
  });
  try {
    const b = result.binding;
    if (!b?.target || !b.design) return blocked("target-proof-unavailable");
    if (result.verificationStatus === "conflicting-evidence")
      return blocked(result.reason);
    if (
      gateHash(["dg15.target.v1", b.workItemId, request.original]) !== b.target
    )
      return blocked("target-mismatch");
    if (request.original[0] === "none")
      return { ...result, targetHandoff: "not-bound" };
    if (!verify) return blocked("target-proof-unavailable");
    const response = await lifecycle.call("target", (signal) =>
      verify(
        structuredClone({
          ...request,
          workItemId: b.workItemId,
          occurrence: b.occurrence,
          design: b.design!,
          target: b.target!,
        }),
        signal,
      ),
    );
    if (!response || response.kind !== "verified")
      return blocked(
        response?.kind === "mismatch"
          ? "target-mismatch"
          : "target-proof-unavailable",
      );
    const receivedRemaining = lifecycle.check();
    // W065 SKEP02 / FR-022 / SEC-007: pair receipt age with validation elapsed.
    const receivedNow = utcNow();
    const p = {
      workItemId: response.workItemId,
      occurrence: response.occurrence,
      design: response.design,
      target: response.target,
      challenge: response.challenge,
      descriptor: copyDesignTarget(response.descriptor),
      observedAt: response.observedAt,
      verifierId: response.verifierId,
      immutableEvidenceId: response.immutableEvidenceId,
    };
    if (
      p.workItemId !== b.workItemId ||
      p.occurrence !== b.occurrence ||
      p.design !== b.design ||
      p.target !== b.target ||
      p.challenge !== request.challenge ||
      JSON.stringify(p.descriptor) !== JSON.stringify(request.original) ||
      !identifier(p.verifierId) ||
      !identifier(p.immutableEvidenceId)
    )
      return blocked("target-mismatch");
    const now = utcNow();
    const observed = Date.parse(p.observedAt);
    if (
      !Number.isFinite(receivedNow) ||
      !Number.isFinite(now) ||
      !Number.isFinite(observed) ||
      new Date(observed).toISOString() !== p.observedAt ||
      observed > receivedNow ||
      now < receivedNow ||
      now - observed > 5000
    )
      return blocked("target-proof-unavailable");
    // W061: no awaited or host-supplied code after this final retirement check.
    const remaining = lifecycle.check();
    // UTC final age already includes validation. Independently charge monotonic
    // elapsed to receipt age, not final age, so a stalled clock cannot hide staleness.
    const elapsedAge = receivedNow - observed + receivedRemaining - remaining;
    if (Math.max(now - observed, elapsedAge) > 5000)
      return blocked("target-proof-unavailable");
    return { ...result, targetHandoff: "verified-current" };
  } catch (error) {
    return blocked(
      error instanceof GateFault ? error.reason : "target-proof-unavailable",
    );
  }
}
