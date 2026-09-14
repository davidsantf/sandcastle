import { gateRevisions } from "./DevSquadAdoDesignApprovalHistory.js";
import type { DevSquadAdoDesignApprovalResult } from "./DevSquadAdoDesignApproval.js";
import type {
  DevSquadAdoDesignScope,
  DevSquadAdoDesignEnvelope,
  DevSquadAdoDesignPublicationWitness,
  PublicationContinuation,
  DevSquadAdoDesignMutationRequest,
} from "./DevSquadAdoDesignApprovalPublication.js";
import {
  identifier,
  scopeCopy,
  sameGrant,
} from "./DevSquadAdoDesignApprovalPublication.js";
import {
  gateHash,
  reduceGateHistory,
} from "./DevSquadAdoDesignApprovalHistory.js";
import { GateFault } from "./DevSquadAdoDesignApprovalLifecycle.js";
import {
  inspectDesignGateRecord,
  unicode,
  isB32,
} from "./DevSquadAdoDesignApprovalValidation.js";
import {
  freshGateAcknowledgement,
  gateLedgerRejection,
} from "./DevSquadAdoDesignApprovalLedger.js";
import type { CheckpointDevSquadAdoWorkflowInput } from "./DevSquadAdoWorkflowLedger.js";
/** Immutable authoritative proposal anchor; opaque IDs are equality-only. */
export type DevSquadAdoDesignProposalAnchor = readonly [
  string,
  string,
  number,
  string,
];
/** Event-time version including retained edits/deletions and verified relationship. */
export type DevSquadAdoDesignDecisionEvent = readonly [
  string,
  number,
  string,
  string,
  "create" | "edit" | "delete",
  string,
  string,
  string | null,
  DevSquadAdoDesignScope,
  string,
  string,
  (
    | readonly [
        DevSquadAdoDesignScope,
        string,
        string,
        string,
        string,
        string,
        "answers",
      ]
    | "unrelated"
  ),
  string | null,
  string,
];
/** Certified contiguous prefix of an immutable snapshot. */
export type DevSquadAdoDesignDecisionPage = readonly [
  string,
  DevSquadAdoDesignScope,
  string,
  string,
  DevSquadAdoDesignProposalAnchor,
  string,
  number,
  string | null,
  number,
  number,
  readonly DevSquadAdoDesignDecisionEvent[],
  string | null,
  boolean,
  string,
];
/** Immutable human identity and policy facts bound to one exact decision. */
export type DevSquadAdoDesignHumanWitness = readonly [
  string,
  DevSquadAdoDesignScope,
  string,
  string,
  string,
  string,
  string,
  string,
  number,
  string,
  string,
  string,
  DevSquadAdoDesignScope,
  string,
  "approve-design" | "request-changes",
  "granted" | "denied",
  string,
  string,
  string,
  string,
];
/** Host-normalized offline decision seams, not ADO transport contracts. */
export interface DevSquadAdoDesignDecisionDependencies {
  /** Read a complete immutable prefix at the exact cursor/snapshot. No hidden retries. */
  readonly readDecisionPage: (
    request: {
      readonly envelope: DevSquadAdoDesignEnvelope;
      readonly anchor: DevSquadAdoDesignProposalAnchor;
      readonly snapshot: string | null;
      readonly cursor: string | null;
      readonly limit: 16;
    },
    signal: AbortSignal,
  ) => Promise<
    | {
        readonly kind: "verified";
        readonly page: DevSquadAdoDesignDecisionPage;
      }
    | { readonly kind: "unavailable" }
  >;
  /** Explicit event-specific verdict; unavailable is never a denial. */
  readonly authorizeHumanDecision: (
    request: {
      readonly envelope: DevSquadAdoDesignEnvelope;
      readonly publication: string;
      readonly event: DevSquadAdoDesignDecisionEvent;
      readonly action: "approve-design" | "request-changes";
    },
    signal: AbortSignal,
  ) => Promise<
    | {
        readonly kind: "verified";
        readonly witness: DevSquadAdoDesignHumanWitness;
      }
    | { readonly kind: "unavailable" }
  >;
}
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
// W052 / FR-012–016: bounded primitive-only copies before proportional retention.
function copyTuple(value: unknown, maximum: number): unknown {
  let bytes = 0;
  const copy = (v: unknown, depth: number): unknown => {
    if (depth > 5) throw new GateFault("decision-prefix-incomplete");
    if (Array.isArray(v)) {
      if (v.length > 20) throw new GateFault("input-limit");
      bytes += 2 + Math.max(0, v.length - 1);
      const length = v.length;
      const result: unknown[] = [];
      for (let i = 0; i < length; i++) {
        if (v.length !== length)
          throw new GateFault("decision-prefix-incomplete");
        result.push(copy(v[i], depth + 1));
        if (v.length !== length)
          throw new GateFault("decision-prefix-incomplete");
      }
      return result;
    }
    if (
      v !== null &&
      typeof v !== "string" &&
      typeof v !== "number" &&
      typeof v !== "boolean"
    )
      throw new GateFault("decision-prefix-incomplete");
    if (
      typeof v === "string" &&
      (v.length > 4096 || !unicode(v) || Buffer.byteLength(v) > 4096)
    )
      throw new GateFault("input-limit");
    if (typeof v === "number" && !Number.isSafeInteger(v))
      throw new GateFault("decision-prefix-incomplete");
    bytes += Buffer.byteLength(JSON.stringify(v));
    if (bytes > maximum) throw new GateFault("input-limit");
    return v;
  };
  const result = copy(value, 0);
  if (bytes > maximum) throw new GateFault("input-limit");
  return result;
}
function eventValid(
  e: DevSquadAdoDesignDecisionEvent,
  stream: string,
  ordinal: number,
): boolean {
  try {
    if (
      e.length !== 14 ||
      e[0] !== stream ||
      e[1] !== ordinal ||
      ![e[2], e[3], e[5], e[6], e[9], e[13]].every(identifier) ||
      !["create", "edit", "delete"].includes(e[4])
    )
      return false;
    scopeCopy(e[8]);
    if (
      !Number.isFinite(Date.parse(e[10])) ||
      new Date(e[10]).toISOString() !== e[10]
    )
      return false;
    if (e[4] === "create" ? e[7] !== null : !identifier(e[7])) return false;
    if (e[4] === "delete" ? e[12] !== null : typeof e[12] !== "string")
      return false;
    if (e[11] !== "unrelated") {
      const r = e[11];
      if (
        !Array.isArray(r) ||
        r.length !== 7 ||
        ![r[1], r[2], r[3]].every(identifier) ||
        !isB32(r[4]) ||
        !isB32(r[5]) ||
        r[6] !== "answers"
      )
        return false;
      scopeCopy(r[0]);
    }
    return true;
  } catch {
    return false;
  }
}
/** W052: only a certified prefix and explicit grant may reach a same-state resolution CAS. */
export async function resolveGateDecision(
  initial: DevSquadAdoDesignApprovalResult,
  c: PublicationContinuation,
  w: DevSquadAdoDesignPublicationWitness,
  X: string,
): Promise<DevSquadAdoDesignApprovalResult> {
  let result = initial;
  if (!c.readDecisionPage) return result;
  try {
    const { envelope: q, lifecycle } = c;
    const W = q.workItemId,
      G = q.occurrence,
      D = q.design,
      T = q.target;
    const anchor: DevSquadAdoDesignProposalAnchor = [w[9], w[10], w[11], w[12]];
    let C = gateHash(["dg15.prefix-start.v1", W, G, D, T, X, anchor]);
    let selected:
      | {
          event: DevSquadAdoDesignDecisionEvent;
          grant: DevSquadAdoDesignHumanWitness;
          action: "approve-design" | "request-changes";
          prefix: string;
        }
      | undefined;
    const ids = new Set<string>();
    const versions = new Map<string, string>();
    // W053: semantic prefix survives pagination; transport metadata never enters C.
    let cursor: string | null = null,
      snapshot: string | null = null,
      end: number | null = null;
    let nextOrdinal = w[11] + 1,
      streamBytes = 0,
      events = 0;
    const cursors = new Set<string>();
    while (!selected) {
      const response = await lifecycle.call("page", (signal) =>
        c.readDecisionPage!(
          structuredClone({
            envelope: q,
            anchor,
            snapshot,
            cursor,
            limit: 16,
          }),
          signal,
        ),
      );
      if (!response || response.kind !== "verified")
        throw new GateFault("decision-prefix-incomplete");
      const p = copyTuple(
        response.page,
        262144,
      ) as DevSquadAdoDesignDecisionPage;
      if (
        !Array.isArray(p) ||
        p.length !== 14 ||
        !identifier(p[0]) ||
        !equal(p[1], c.scope) ||
        p[2] !== W ||
        p[3] !== w[9] ||
        !equal(p[4], anchor) ||
        !identifier(p[5]) ||
        !Number.isSafeInteger(p[6]) ||
        p[6] < w[11] ||
        (snapshot !== null && (p[5] !== snapshot || p[6] !== end)) ||
        p[7] !== cursor ||
        p[8] !== nextOrdinal ||
        !Number.isSafeInteger(p[9]) ||
        p[9] > p[6] ||
        p[9] < p[8] - 1 ||
        !Array.isArray(p[10]) ||
        p[10].length > 16 ||
        p[10].length !== p[9] - p[8] + 1 ||
        (p[11] !== null &&
          (typeof p[11] !== "string" ||
            !unicode(p[11]) ||
            !p[11].length ||
            Buffer.byteLength(p[11]) > 1024 ||
            cursors.has(p[11]))) ||
        (p[11] === null
          ? p[12] !== true || p[9] !== p[6]
          : p[12] !== false || p[9] >= p[6] || p[10].length === 0) ||
        !identifier(p[13])
      )
        throw new GateFault("decision-prefix-incomplete");

      snapshot = p[5];
      end = p[6];
      streamBytes += Buffer.byteLength(JSON.stringify(p));
      events += p[10].length;
      if (streamBytes > 262144 || events > 128)
        throw new GateFault("input-limit");
      for (let i = 0; i < p[10].length; i++) {
        const e = p[10][i]!;
        if (
          !eventValid(e, w[9], p[8] + i) ||
          ids.has(e[2]) ||
          (e[4] === "create" ? versions.has(e[5]) : versions.get(e[5]) !== e[7])
        )
          throw new GateFault("decision-prefix-incomplete");
        ids.add(e[2]);
        versions.set(e[5], e[6]);
        let classification = "not-command";
        let grant: DevSquadAdoDesignHumanWitness | null = null;
        let action: "approve-design" | "request-changes" | null = null;
        if (e[4] === "delete") classification = "deleted";
        else if (
          e[11] === "unrelated" ||
          !equal(e[11], [c.scope, W, w[7], w[8], G, D, "answers"])
        )
          classification = "unrelated";
        else {
          const match =
            /^\/devsquad (approve-design|request-changes) ([A-Za-z0-9_-]{43}) ([A-Za-z0-9_-]{43})$/.exec(
              e[12]!,
            );
          if (
            match &&
            isB32(match[2]) &&
            isB32(match[3]) &&
            e[12]!.length === (match[1] === "approve-design" ? 112 : 113)
          ) {
            if (match[2] !== G || match[3] !== D)
              classification = "wrong-binding";
            else {
              action = match[1] as "approve-design" | "request-changes";
              if (!c.authorizeHumanDecision)
                throw new GateFault("decision-authorization-unresolved");
              let a;
              try {
                a = await lifecycle.call("human", (signal) =>
                  c.authorizeHumanDecision!(
                    structuredClone({
                      envelope: q,
                      publication: X,
                      event: e,
                      action: action!,
                    }),
                    signal,
                  ),
                );
              } catch (error) {
                if (
                  error instanceof GateFault &&
                  [
                    "cancelled",
                    "dependency-timeout",
                    "dependency-limit",
                  ].includes(error.reason)
                )
                  throw error;
                throw new GateFault("decision-authorization-unresolved");
              }
              if (!a || a.kind !== "verified")
                throw new GateFault("decision-authorization-unresolved");
              try {
                grant = copyTuple(
                  a.witness,
                  16384,
                ) as DevSquadAdoDesignHumanWitness;
              } catch {
                throw new GateFault("decision-authorization-unresolved");
              }
              const expected = [
                c.scope,
                W,
                G,
                D,
                T,
                X,
                w[9],
                e[1],
                e[2],
                e[5],
                e[6],
                e[8],
                e[9],
                action,
              ];
              if (
                !Array.isArray(grant) ||
                grant.length !== 20 ||
                !equal(grant.slice(1, 15), expected) ||
                ![grant[0], grant[16], grant[17], grant[18], grant[19]].every(
                  identifier,
                ) ||
                !["granted", "denied"].includes(grant[15])
              )
                throw new GateFault("decision-authorization-unresolved");
              classification = grant[15] === "granted" ? "selected" : "denied";
            }
          }
        }
        C = gateHash(["dg15.prefix-step.v1", C, e, classification, grant]);
        if (classification === "selected") {
          selected = { event: e, grant: grant!, action: action!, prefix: C };
          break;
        }
      }
      if (selected) break;
      if (p[11] === null) return { ...result, reason: "no-eligible-decision" };
      cursor = p[11];
      cursors.add(cursor);
      nextOrdinal = p[9] + 1;
    }
    if (!selected) return { ...result, reason: "no-eligible-decision" };
    // W056 follow-up: selected event + grant is one bounded minimized package.
    if (
      Buffer.byteLength(
        JSON.stringify([selected.event, selected.grant, selected.prefix]),
      ) > 16384
    )
      throw new GateFault("input-limit");
    const E = gateHash([
      "dg15.decision.v1",
      W,
      G,
      D,
      T,
      X,
      selected.action,
      selected.event,
      selected.grant,
      selected.prefix,
    ]);
    const read = await lifecycle.call("read", () => c.read(W));
    const before = read?.ok
      ? inspectDesignGateRecord(read.value, W, lifecycle)
      : null;
    if (!before)
      throw new GateFault(gateLedgerRejection(read) ?? "evidence-unavailable");
    const history = reduceGateHistory(before, G, lifecycle);
    if (!history.ok || !history.gate || history.gate.publication !== X)
      throw new GateFault("conflicting-gate-history");
    result = {
      ...result,
      knownRevision: before.revision,
      checkpointRevisions: gateRevisions(history.gate),
    };
    if (history.gate.action)
      return {
        ...result,
        durableState:
          history.gate.action === "approve-design"
            ? "approved"
            : "changes-requested",
        verificationStatus: "evidence-unavailable",
        reason: "publication-evidence-unavailable",
      };
    const authority = c.authority;
    if (!authority) throw new GateFault("authority-required");
    const check = () => {
      lifecycle.check();
      const now = c.utcNow();
      const claim = before.activeClaim;
      if (!Number.isFinite(now)) throw new GateFault("invalid-input");
      if (
        !claim ||
        claim.ownerId !== authority.ownerId ||
        claim.fencingValue !== authority.fencingValue
      )
        throw new GateFault("authority-rejected");
      if (now >= Date.parse(claim.expiresAt))
        throw new GateFault("authority-expired");
      return now;
    };
    check();
    const event = [
      selected.action === "approve-design" ? "a" : "c",
      G,
      D,
      X,
      E,
    ];
    const mutation: DevSquadAdoDesignMutationRequest = {
      workItemId: W,
      event,
      expected: {
        revision: before.revision,
        phase: before.phase,
        status: before.status,
      },
      patch: { phase: before.phase, status: before.status },
    };
    const grant = await lifecycle.call("mutation", (signal) =>
      c.authorize(structuredClone(mutation), signal),
    );
    if (
      !grant ||
      grant.kind !== "granted" ||
      !sameGrant(grant.request, mutation)
    )
      throw new GateFault("host-authorization-unavailable");
    check();
    const J = gateHash([
      "dg15.submission.v1",
      event,
      W,
      before.revision,
      before.phase,
      before.status,
      before.phase,
      before.status,
      authority.ownerId,
      authority.fencingValue,
    ]);
    const original: CheckpointDevSquadAdoWorkflowInput = {
      workItemId: W,
      operationId: `dg15.${event.join(".")}.${J}`,
      authority: { ...authority },
      expected: { ...mutation.expected },
      patch: { ...mutation.patch },
    };
    result = {
      ...result,
      verificationStatus: "mutation-unconfirmed",
      reason: "resolution-outcome-unknown",
    };
    const ack = await lifecycle.call("checkpoint", () =>
      c.checkpoint(structuredClone(original)),
    );
    const rejection = gateLedgerRejection(ack);
    if (rejection) return { ...result, reason: rejection };
    const fresh = freshGateAcknowledgement(
      ack,
      original,
      before,
      check(),
      lifecycle,
    );
    if (!fresh) return result;
    return {
      ...result,
      durableState:
        selected.action === "approve-design" ? "approved" : "changes-requested",
      verificationStatus: "verified",
      reason: "human-decision-confirmed",
      knownRevision: fresh.revision,
      checkpointRevisions: {
        reservation: history.gate.reservationRevision,
        publication: history.gate.publicationRevision,
        resolution: fresh.revision,
      },
    };
  } catch (error) {
    return {
      ...result,
      reason:
        error instanceof GateFault
          ? error.reason
          : "decision-prefix-incomplete",
    };
  }
}
