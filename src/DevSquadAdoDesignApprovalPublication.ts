import {
  copyDesignTarget,
  copyTargetRequest,
  verifyGateTarget,
} from "./DevSquadAdoDesignApprovalTarget.js";
import { gateRevisions } from "./DevSquadAdoDesignApprovalHistory.js";
import { resolveGateDecision } from "./DevSquadAdoDesignApprovalDecision.js";
import type {
  DevSquadAdoClaimAuthorityInput,
  DevSquadAdoWorkflowLedger,
} from "./DevSquadAdoWorkflowLedger.js";
import type { DevSquadAdoDesignRecoveryRequest } from "./DevSquadAdoDesignApproval.js";

/** Reconciliation cannot invoke publication or require an initial-design verification seam. */
export type DevSquadAdoDesignReconcileDependencies = Omit<
  DevSquadAdoDesignStartDependencies,
  "publishOnce" | "verifyDesign"
>;

/** Nonsecret host tracker or repository namespace. */
export type DevSquadAdoDesignScope = readonly [
  trackerKind: string,
  tenantId: string,
  projectId: string,
];
/** One independently verifiable immutable artifact version. */
export type DevSquadAdoDesignArtifact = readonly [
  scope: DevSquadAdoDesignScope,
  artifactId: string,
  immutableVersionId: string,
  contentSha256: string,
];
/** Exact reviewed material; mutable artifact pointers are insufficient. */
export interface DevSquadAdoDesignInput {
  /** Exact proposal; no Unicode or whitespace normalization. */
  readonly content: string;
  /** Immutable version witnesses, sorted canonically by the gate. */
  readonly artifacts: readonly DevSquadAdoDesignArtifact[];
  /** Explicit no-target or independently verified immutable target descriptor. */
  readonly target: import("./DevSquadAdoDesignApprovalTarget.js").DevSquadAdoDesignTarget;
}
/** Host-authorized request to consume one publication attempt. */
export interface DevSquadAdoDesignStartRequest extends DevSquadAdoDesignRecoveryRequest {
  /** Tracker namespace independently supplied by the host. */
  readonly scope: DevSquadAdoDesignScope;
  /** Immutable material to verify before reservation. */
  readonly design: DevSquadAdoDesignInput;
  /** Current capability independent of watcher provenance. */
  readonly authority?: DevSquadAdoClaimAuthorityInput;
}
/** Nonsecret exact publication binding; carries no reusable permission. */
export interface DevSquadAdoDesignEnvelope {
  /** Canonical work item. */
  readonly workItemId: string;
  /** Host-issued occurrence. */
  readonly occurrence: string;
  /** Proposal commitment. */
  readonly proposal: string;
  /** Artifact commitment. */
  readonly manifest: string;
  /** Design commitment. */
  readonly design: string;
  /** Target commitment. */
  readonly target: string;
  /** Rendered envelope commitment. */
  readonly envelope: string;
  /** Exact rendered bytes; transient and host-approved for publication. */
  readonly rendered: string;
}
/** Exact nonsecret authorization request for one phase/status-only mutation. */
export interface DevSquadAdoDesignMutationRequest {
  /** Canonical work item. */
  readonly workItemId: string;
  /** Exact stage identity tuple, excluding J and capability. */
  readonly event: readonly string[];
  /** Freshly read preconditions. */
  readonly expected: {
    readonly revision: number;
    readonly phase: string;
    readonly status: string;
  };
  /** Same-value workflow state patch. */
  readonly patch: { readonly phase: string; readonly status: string };
}
/** Trusted offline adapters; no hidden retries or live clients are constructed. */
export interface DevSquadAdoDesignStartDependencies {
  /** Independent current target observation; descriptive only. */
  readonly verifyCurrentTarget?: import("./DevSquadAdoDesignApprovalTarget.js").DevSquadAdoDesignTargetVerifier;
  /** Certified immutable event pages; never current-comments-only evidence. */
  readonly readDecisionPage?: import("./DevSquadAdoDesignApprovalDecision.js").DevSquadAdoDesignDecisionDependencies["readDecisionPage"];
  /** Immutable event-specific human authorization, independent of mutation authority. */
  readonly authorizeHumanDecision?: import("./DevSquadAdoDesignApprovalDecision.js").DevSquadAdoDesignDecisionDependencies["authorizeHumanDecision"];
  /** Verify an original attempt without automatically publishing again. */
  readonly verifyPublication?: DevSquadAdoDesignPublicationVerifier;
  /** Existing public read and checkpoint operations only. */
  readonly ledger: Pick<DevSquadAdoWorkflowLedger, "readRecord" | "checkpoint">;
  /** Host authorizes the exact stage and fresh state, independently of capability. */
  readonly authorizeMutation: (
    request: DevSquadAdoDesignMutationRequest,
    signal: AbortSignal,
  ) => Promise<
    | {
        readonly kind: "granted";
        readonly request: DevSquadAdoDesignMutationRequest;
      }
    | { readonly kind: "denied" | "unavailable" }
  >;
  /** Independently verifies exact proposal, immutable artifacts and original target. */
  readonly verifyDesign: (
    request: {
      readonly envelope: DevSquadAdoDesignEnvelope;
      readonly material: DevSquadAdoDesignInput;
    },
    signal: AbortSignal,
  ) => Promise<
    | {
        readonly kind: "verified";
        readonly workItemId: string;
        readonly occurrence: string;
        readonly design: string;
        readonly target: string;
        readonly verifierId: string;
        readonly immutableEvidenceId: string;
      }
    | { readonly kind: "mismatch" | "unavailable" }
  >;
  /** One application-level publication invocation, never an automatic retry. */
  readonly publishOnce: (
    request: DevSquadAdoDesignEnvelope,
    signal: AbortSignal,
  ) => Promise<unknown>;
  /** Authority time in UTC milliseconds, independent of monotonic deadlines. */
  readonly utcNow?: () => number;
  /** Monotonic elapsed time; host clocks must not run backwards. */
  readonly monotonicNow?: () => number;
}
import type { DevSquadAdoDesignApprovalResult } from "./DevSquadAdoDesignApproval.js";
import type { CheckpointDevSquadAdoWorkflowInput } from "./DevSquadAdoWorkflowLedger.js";
import {
  canonicalWorkItem,
  validGateProvenance,
  inspectDesignGateRecord,
  isB32,
  unicode,
} from "./DevSquadAdoDesignApprovalValidation.js";
import {
  gateHash,
  reduceGateHistory,
} from "./DevSquadAdoDesignApprovalHistory.js";
import {
  GateFault,
  GateLifecycle,
} from "./DevSquadAdoDesignApprovalLifecycle.js";
import {
  freshGateAcknowledgement,
  gateLedgerRejection,
} from "./DevSquadAdoDesignApprovalLedger.js";

export const identifier = (v: unknown): v is string =>
  typeof v === "string" &&
  v.length <= 256 &&
  unicode(v) &&
  v.trim().length > 0 &&
  Buffer.byteLength(v, "utf8") <= 256;
export const scopeCopy = (
  value: DevSquadAdoDesignScope,
): DevSquadAdoDesignScope => {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    ![value[0], value[1], value[2]].every(identifier)
  )
    throw new GateFault("invalid-input");
  return [value[0], value[1], value[2]];
};
function materialCopy(input: DevSquadAdoDesignInput): DevSquadAdoDesignInput {
  const content = input.content;
  if (
    typeof content !== "string" ||
    content.length > 32768 ||
    !unicode(content) ||
    Buffer.byteLength(content, "utf8") > 32768
  )
    throw new GateFault("input-limit");
  const entries = input.artifacts;
  if (!Array.isArray(entries) || entries.length > 64)
    throw new GateFault("input-limit");
  const count = entries.length;
  const artifacts: DevSquadAdoDesignArtifact[] = [];
  let bytes = 2;
  const seen = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (entries.length !== count) throw new GateFault("invalid-input");
    const entry = entries[i];
    if (
      !Array.isArray(entry) ||
      entry.length !== 4 ||
      !identifier(entry[1]) ||
      !identifier(entry[2]) ||
      !isB32(entry[3])
    )
      throw new GateFault("invalid-input");
    const copy: DevSquadAdoDesignArtifact = [
      scopeCopy(entry[0]),
      entry[1],
      entry[2],
      entry[3],
    ];
    bytes += Buffer.byteLength(JSON.stringify(copy), "utf8") + (i ? 1 : 0);
    if (bytes > 16384) throw new GateFault("input-limit");
    const key = JSON.stringify([copy[0], copy[1]]);
    if (seen.has(key)) throw new GateFault("invalid-input");
    seen.add(key);
    artifacts.push(copy);
  }
  artifacts.sort((a, b) =>
    Buffer.compare(
      Buffer.from(JSON.stringify([a[0], a[1]])),
      Buffer.from(JSON.stringify([b[0], b[1]])),
    ),
  );
  return { content, artifacts, target: copyDesignTarget(input.target) };
}
function makeEnvelope(
  W: string,
  G: string,
  scope: DevSquadAdoDesignScope,
  material: DevSquadAdoDesignInput,
): DevSquadAdoDesignEnvelope {
  const P = gateHash(["dg15.proposal.v1", W, material.content]);
  const A = gateHash(["dg15.manifest.v1", W, material.artifacts]);
  const D = gateHash(["dg15.design.v1", W, P, A]);
  const T = gateHash(["dg15.target.v1", W, material.target]);
  const rendered = [
    "DevSquad immutable design review",
    `Work item: ${JSON.stringify([scope, W])}`,
    `Occurrence: ${G}`,
    `Design: ${D}`,
    `Proposal: ${P}`,
    `Manifest: ${A}`,
    `Target: ${T}`,
    `Artifacts: ${JSON.stringify(material.artifacts)}`,
    `Execution target: ${JSON.stringify(material.target)}`,
    "Approval applies only to this occurrence and immutable design; it does not execute a phase or approve revised content.",
    "Submit exactly one of these commands as the entire comment:",
    `/devsquad approve-design ${G} ${D}`,
    `/devsquad request-changes ${G} ${D}`,
    `Reviewed proposal UTF-8 bytes: ${Buffer.byteLength(material.content, "utf8")}`,
    "",
    material.content,
    "",
  ].join("\n");
  if (Buffer.byteLength(rendered, "utf8") > 65536)
    throw new GateFault("input-limit");
  return {
    workItemId: W,
    occurrence: G,
    proposal: P,
    manifest: A,
    design: D,
    target: T,
    envelope: gateHash(["dg15.envelope.v1", W, G, D, T, rendered]),
    rendered,
  };
}
export const sameGrant = (
  value: unknown,
  original: DevSquadAdoDesignMutationRequest,
): boolean => {
  try {
    const v = value as DevSquadAdoDesignMutationRequest;
    return (
      v.workItemId === original.workItemId &&
      Array.isArray(v.event) &&
      v.event.length === original.event.length &&
      v.event.every((entry, index) => entry === original.event[index]) &&
      v.expected.revision === original.expected.revision &&
      v.expected.phase === original.expected.phase &&
      v.expected.status === original.expected.status &&
      v.patch.phase === original.patch.phase &&
      v.patch.status === original.patch.status
    );
  } catch {
    return false;
  }
};

/** W050: invocation-local fresh reservation permission is consumed before publishOnce. */
export async function startGatePublication(
  request: DevSquadAdoDesignStartRequest,
  dependencies:
    | DevSquadAdoDesignStartDependencies
    | DevSquadAdoDesignReconcileDependencies,
  mode: "start" | "reconcile" = "start",
): Promise<DevSquadAdoDesignApprovalResult> {
  let result: DevSquadAdoDesignApprovalResult = {
    durableState: "unreadable",
    verificationStatus: "evidence-unavailable",
    targetHandoff: "not-requested",
    reason: "invalid-input",
    binding: null,
    knownRevision: null,
  };
  try {
    const W = canonicalWorkItem(request.workItemId);
    const G = request.occurrence;
    if (W === null || !isB32(G) || !validGateProvenance(request.provenance, W))
      throw new GateFault("invalid-input");
    const targetRequest = copyTargetRequest(request.targetVerification);
    const verifyCurrentTarget =
      dependencies.verifyCurrentTarget?.bind(dependencies);
    const scope = scopeCopy(request.scope);
    const material = materialCopy(request.design);
    const envelope = makeEnvelope(W, G, scope, material);
    const rawAuthority = request.authority;
    const authority =
      rawAuthority === undefined
        ? null
        : {
            ownerId: rawAuthority.ownerId,
            claimToken: rawAuthority.claimToken,
            fencingValue: rawAuthority.fencingValue,
          };
    if (
      authority &&
      (!identifier(authority.ownerId) ||
        !isB32(authority.claimToken) ||
        !Number.isSafeInteger(authority.fencingValue) ||
        authority.fencingValue <= 0)
    )
      throw new GateFault("invalid-input");
    const ledger = dependencies.ledger;
    const read = ledger.readRecord.bind(ledger);
    const checkpoint = ledger.checkpoint.bind(ledger);
    const authorize = dependencies.authorizeMutation.bind(dependencies);
    const startDependencies =
      dependencies as Partial<DevSquadAdoDesignStartDependencies>;
    const verify =
      mode === "start"
        ? startDependencies.verifyDesign?.bind(dependencies)
        : undefined;
    const publish =
      mode === "start"
        ? startDependencies.publishOnce?.bind(dependencies)
        : undefined;
    if (mode === "start" && (!verify || !publish))
      throw new GateFault("invalid-input");
    const verifyPublication =
      dependencies.verifyPublication?.bind(dependencies);
    const readDecisionPage = dependencies.readDecisionPage?.bind(dependencies);
    const authorizeHumanDecision =
      dependencies.authorizeHumanDecision?.bind(dependencies);
    const utcNow = dependencies.utcNow ?? Date.now;
    const lifecycle = new GateLifecycle(
      request.signal,
      dependencies.monotonicNow ?? (() => performance.now()),
    );
    const finish = (value: DevSquadAdoDesignApprovalResult) =>
      verifyGateTarget(
        value,
        targetRequest,
        verifyCurrentTarget,
        lifecycle,
        utcNow,
      );
    if (typeof utcNow !== "function") throw new GateFault("invalid-input");
    const response = await lifecycle.call("read", () => read(W));
    if (!response || response.ok !== true)
      throw new GateFault(
        gateLedgerRejection(response) ?? "evidence-unavailable",
      );
    const record = inspectDesignGateRecord(response.value, W, lifecycle);
    if (!record) throw new GateFault("evidence-unavailable");
    const history = reduceGateHistory(record, G, lifecycle);
    if (!history.ok) throw new GateFault("conflicting-gate-history");
    const binding = {
      workItemId: W,
      occurrence: G,
      proposal: envelope.proposal,
      manifest: envelope.manifest,
      design: envelope.design,
      target: envelope.target,
    };
    result = {
      ...result,
      durableState: "unreserved",
      verificationStatus: "verified",
      reason: "unreserved",
      binding,
      knownRevision: record.revision,
    };
    if (history.gate) {
      const gate = history.gate;
      result = { ...result, checkpointRevisions: gateRevisions(gate) };
      result = {
        ...result,
        durableState:
          gate.action === "approve-design"
            ? "approved"
            : gate.action === "request-changes"
              ? "changes-requested"
              : gate.publication
                ? "publication-confirmed"
                : "attempt-consumed",
        verificationStatus: "evidence-unavailable",
        reason: "publication-evidence-unavailable",
        binding: {
          workItemId: W,
          occurrence: G,
          proposal: gate.proposal,
          manifest: gate.manifest,
          design: gate.design,
          target: gate.target,
        },
      };
      if (gate.design !== envelope.design || gate.target !== envelope.target)
        return {
          ...result,
          verificationStatus: "conflicting-evidence",
          reason: "design-mismatch",
        };
      return finish(
        await confirmGatePublication(result, {
          lifecycle,
          envelope,
          scope,
          authority,
          read,
          checkpoint,
          authorize,
          verifyPublication,
          readDecisionPage,
          authorizeHumanDecision,
          utcNow,
        }),
      );
    }
    if (mode === "reconcile") return result;
    if (!authority) throw new GateFault("authority-required");
    const claim = record.activeClaim;
    const checkAuthority = () => {
      lifecycle.check();
      const now = utcNow();
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
    checkAuthority();
    const proof = await lifecycle.call("design", (signal) =>
      verify!(structuredClone({ envelope, material }), signal),
    );
    if (
      !proof ||
      proof.kind !== "verified" ||
      proof.workItemId !== W ||
      proof.occurrence !== G ||
      proof.design !== envelope.design ||
      proof.target !== envelope.target ||
      !identifier(proof.verifierId) ||
      !identifier(proof.immutableEvidenceId)
    )
      throw new GateFault("design-mismatch");
    const event = [
      "r",
      G,
      envelope.proposal,
      envelope.manifest,
      envelope.target,
    ];
    const mutation: DevSquadAdoDesignMutationRequest = {
      workItemId: W,
      event,
      expected: {
        revision: record.revision,
        phase: record.phase,
        status: record.status,
      },
      patch: { phase: record.phase, status: record.status },
    };
    const grant = await lifecycle.call("mutation", (signal) =>
      authorize(structuredClone(mutation), signal),
    );
    if (
      !grant ||
      grant.kind !== "granted" ||
      !sameGrant(grant.request, mutation)
    )
      throw new GateFault("host-authorization-unavailable");
    checkAuthority();
    const J = gateHash([
      "dg15.submission.v1",
      event,
      W,
      record.revision,
      record.phase,
      record.status,
      record.phase,
      record.status,
      authority.ownerId,
      authority.fencingValue,
    ]);
    const original: CheckpointDevSquadAdoWorkflowInput = {
      workItemId: W,
      operationId: `dg15.r.${G}.${envelope.proposal}.${envelope.manifest}.${envelope.target}.${J}`,
      authority,
      expected: mutation.expected,
      patch: mutation.patch,
    };
    result = {
      ...result,
      durableState: "reservation-unconfirmed",
      verificationStatus: "mutation-unconfirmed",
      reason: "reservation-outcome-unknown",
    };
    const accepted = await lifecycle.call("checkpoint", () =>
      checkpoint(structuredClone(original)),
    );
    const rejection = gateLedgerRejection(accepted);
    if (rejection) return { ...result, reason: rejection };
    const fresh = freshGateAcknowledgement(
      accepted,
      original,
      record,
      checkAuthority(),
      lifecycle,
    );
    if (!fresh) return result;
    result = {
      ...result,
      durableState: "attempt-consumed",
      verificationStatus: "publication-unverified",
      reason: "publication-evidence-unavailable",
      knownRevision: fresh.revision,
      checkpointRevisions: {
        reservation: fresh.revision,
        publication: null,
        resolution: null,
      },
    };
    checkAuthority();
    // No ticket escapes. There is exactly one call site, reached only via this direct acknowledgement.
    const hint = await lifecycle.call("publisher", (signal) =>
      publish!(structuredClone(envelope), signal),
    );
    return finish(
      await confirmGatePublication(result, {
        lifecycle,
        envelope,
        scope,
        authority,
        read,
        checkpoint,
        authorize,
        verifyPublication,
        readDecisionPage,
        authorizeHumanDecision,
        utcNow,
        hint,
      }),
    );
  } catch (error) {
    const reason = error instanceof GateFault ? error.reason : "invalid-input";
    return {
      ...result,
      reason:
        result.durableState === "attempt-consumed" &&
        reason === "evidence-unavailable"
          ? "publication-outcome-unknown"
          : reason,
    };
  }
}

/** Immutable normalized publication evidence, independently verified by the host. */
export type DevSquadAdoDesignPublicationWitness = readonly [
  verifierId: string,
  scope: DevSquadAdoDesignScope,
  workItemId: string,
  occurrence: string,
  design: string,
  target: string,
  envelope: string,
  proposalObjectId: string,
  proposalVersionId: string,
  streamId: string,
  proposalEventId: string,
  proposalOrdinal: number,
  proposalEventVersionId: string,
  immutableEvidenceId: string,
];
/** Independent publication verifier; a publisher echo or bare locator is insufficient. */
export type DevSquadAdoDesignPublicationVerifier = (
  request: {
    readonly envelope: DevSquadAdoDesignEnvelope;
    readonly scope: DevSquadAdoDesignScope;
    readonly hint?: string;
  },
  signal: AbortSignal,
) => Promise<
  | {
      readonly kind: "verified";
      readonly witness: DevSquadAdoDesignPublicationWitness;
    }
  | { readonly kind: "mismatch" | "ambiguous" | "unavailable" }
>;
export interface PublicationContinuation {
  readonly readDecisionPage?: DevSquadAdoDesignStartDependencies["readDecisionPage"];
  readonly authorizeHumanDecision?: DevSquadAdoDesignStartDependencies["authorizeHumanDecision"];
  readonly lifecycle: GateLifecycle;
  readonly envelope: DevSquadAdoDesignEnvelope;
  readonly scope: DevSquadAdoDesignScope;
  readonly authority: DevSquadAdoClaimAuthorityInput | null;
  readonly read: DevSquadAdoWorkflowLedger["readRecord"];
  readonly checkpoint: DevSquadAdoWorkflowLedger["checkpoint"];
  readonly authorize: DevSquadAdoDesignStartDependencies["authorizeMutation"];
  readonly verifyPublication: DevSquadAdoDesignPublicationVerifier | undefined;
  readonly utcNow: () => number;
  readonly hint?: unknown;
}
function publicationWitness(
  value: unknown,
  envelope: DevSquadAdoDesignEnvelope,
  scope: DevSquadAdoDesignScope,
): DevSquadAdoDesignPublicationWitness | null {
  try {
    if (!Array.isArray(value) || value.length !== 14) return null;
    const copy: unknown[] = [];
    for (let index = 0; index < 14; index++) {
      const item = value[index];
      if (index === 1) copy.push(scopeCopy(item));
      else if (index === 11) {
        if (!Number.isSafeInteger(item) || item <= 0) return null;
        copy.push(item);
      } else {
        if (!identifier(item)) return null;
        copy.push(item);
      }
    }
    if (
      JSON.stringify(copy[1]) !== JSON.stringify(scope) ||
      copy[2] !== envelope.workItemId ||
      copy[3] !== envelope.occurrence ||
      copy[4] !== envelope.design ||
      copy[5] !== envelope.target ||
      copy[6] !== envelope.envelope ||
      Buffer.byteLength(JSON.stringify(copy), "utf8") > 16384
    )
      return null;
    return copy as unknown as DevSquadAdoDesignPublicationWitness;
  } catch {
    return null;
  }
}
/** W051: receipt verification confirms the original attempt, never publication permission. */
async function confirmGatePublication(
  initial: DevSquadAdoDesignApprovalResult,
  context: PublicationContinuation,
): Promise<DevSquadAdoDesignApprovalResult> {
  let result = initial;
  const {
    lifecycle,
    envelope,
    scope,
    authority,
    read,
    checkpoint,
    authorize,
    verifyPublication,
    utcNow,
  } = context;
  if (!verifyPublication) return result;
  try {
    const hint =
      typeof context.hint === "string" &&
      context.hint.length <= 1024 &&
      unicode(context.hint) &&
      Buffer.byteLength(context.hint, "utf8") <= 1024
        ? context.hint
        : undefined;
    const proof = await lifecycle.call("publication", (signal) =>
      verifyPublication(
        structuredClone({
          envelope,
          scope,
          ...(hint === undefined ? {} : { hint }),
        }),
        signal,
      ),
    );
    if (!proof || proof.kind !== "verified")
      return {
        ...result,
        reason:
          proof?.kind === "ambiguous"
            ? "publication-ambiguous"
            : proof?.kind === "mismatch"
              ? "publication-mismatch"
              : "publication-evidence-unavailable",
      };
    const witness = publicationWitness(proof.witness, envelope, scope);
    if (!witness) return { ...result, reason: "publication-mismatch" };
    const W = envelope.workItemId;
    const G = envelope.occurrence;
    const D = envelope.design;
    const X = gateHash([
      "dg15.publication.v1",
      W,
      G,
      D,
      envelope.target,
      envelope.envelope,
      witness,
    ]);
    const response = await lifecycle.call("read", () => read(W));
    if (!response || response.ok !== true)
      throw new GateFault(
        gateLedgerRejection(response) ?? "evidence-unavailable",
      );
    const before = inspectDesignGateRecord(response.value, W, lifecycle);
    if (!before) throw new GateFault("evidence-unavailable");
    const history = reduceGateHistory(before, G, lifecycle);
    if (
      !history.ok ||
      !history.gate ||
      history.gate.design !== D ||
      history.gate.target !== envelope.target
    )
      throw new GateFault("conflicting-gate-history");
    result = {
      ...result,
      knownRevision: before.revision,
      checkpointRevisions: gateRevisions(history.gate),
    };
    if (history.gate.publication) {
      if (history.gate.publication !== X)
        return { ...result, reason: "publication-mismatch" };
      if (history.gate.action)
        return {
          ...result,
          durableState:
            history.gate.action === "approve-design"
              ? "approved"
              : "changes-requested",
          verificationStatus: "evidence-unavailable",
        };
      return resolveGateDecision(
        {
          ...result,
          durableState: "publication-confirmed",
          verificationStatus: "decision-pending",
          reason: "decision-prefix-incomplete",
        },
        context,
        witness,
        X,
      );
    }
    if (!authority) throw new GateFault("authority-required");
    const checkAuthority = () => {
      lifecycle.check();
      const now = utcNow();
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
    checkAuthority();
    const event = ["p", G, D, X];
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
      authorize(structuredClone(mutation), signal),
    );
    if (
      !grant ||
      grant.kind !== "granted" ||
      !sameGrant(grant.request, mutation)
    )
      throw new GateFault("host-authorization-unavailable");
    checkAuthority();
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
      operationId: `dg15.p.${G}.${D}.${X}.${J}`,
      authority: { ...authority },
      expected: { ...mutation.expected },
      patch: { ...mutation.patch },
    };
    result = {
      ...result,
      verificationStatus: "mutation-unconfirmed",
      reason: "publication-outcome-unknown",
    };
    const accepted = await lifecycle.call("checkpoint", () =>
      checkpoint(structuredClone(original)),
    );
    const rejection = gateLedgerRejection(accepted);
    if (rejection) return { ...result, reason: rejection };
    const fresh = freshGateAcknowledgement(
      accepted,
      original,
      before,
      checkAuthority(),
      lifecycle,
    );
    if (!fresh) return result;
    return resolveGateDecision(
      {
        ...result,
        durableState: "publication-confirmed",
        verificationStatus: "decision-pending",
        reason: "decision-prefix-incomplete",
        knownRevision: fresh.revision,
      },
      context,
      witness,
      X,
    );
  } catch (error) {
    return {
      ...result,
      reason:
        error instanceof GateFault
          ? error.reason
          : "publication-evidence-unavailable",
    };
  }
}
