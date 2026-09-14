import {
  canonicalWorkItem,
  inspectDesignGateRecord,
  isB32,
  unicode,
} from "./DevSquadAdoDesignApprovalValidation.js";
import { copyDesignTarget } from "./DevSquadAdoDesignApprovalTarget.js";
import {
  gateHash,
  reduceGateHistory,
} from "./DevSquadAdoDesignApprovalHistory.js";
import type {
  CheckpointDevSquadAdoWorkflowInput,
  DevSquadAdoWorkflowRecord,
} from "./DevSquadAdoWorkflowLedger.js";
import type {
  DevSquadAdoPhaseFeedbackBinding,
  DevSquadAdoPhaseInput,
  DevSquadAdoPhaseResult,
} from "./DevSquadAdoPhaseTypes.js";

export class PhaseFault extends Error {
  constructor(readonly reason: DevSquadAdoPhaseResult["reason"]) {
    super(reason);
  }
}

/** Bounded plain-data projection: never invoke dependency getters/toJSON methods. */
export function phaseCopy<T>(value: T): T {
  let bytes = 0;
  let nodes = 0;
  const active = new Set<object>();
  const visit = (v: unknown, depth: number): unknown => {
    if (++nodes > 8192 || depth > 16) throw new PhaseFault("input-limit");
    if (typeof v === "string") {
      if (v.length > 65536 || !unicode(v)) throw new PhaseFault("input-limit");
      bytes += Buffer.byteLength(v);
      if (bytes > 262144) throw new PhaseFault("input-limit");
      return v;
    }
    if (v === null || typeof v === "boolean") return v;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v !== "object" || v === null || active.has(v))
      throw new PhaseFault("invalid-input");
    const array = Array.isArray(v);
    const prototype = Object.getPrototypeOf(v);
    if (
      prototype !== (array ? Array.prototype : Object.prototype) &&
      prototype !== null
    )
      throw new PhaseFault("invalid-input");
    const keys = Reflect.ownKeys(v);
    if (keys.length > 4096) throw new PhaseFault("input-limit");
    active.add(v);
    const output: Record<string, unknown> | unknown[] = array ? [] : {};
    let count = 0;
    for (const key of keys) {
      if (array && key === "length") continue;
      if (
        typeof key !== "string" ||
        key === "__proto__" ||
        (array && key !== String(count++))
      )
        throw new PhaseFault("invalid-input");
      const descriptor = Object.getOwnPropertyDescriptor(v, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
        throw new PhaseFault("invalid-input");
      bytes += Buffer.byteLength(key);
      if (bytes > 262144) throw new PhaseFault("input-limit");
      Object.defineProperty(output, key, {
        value: visit(descriptor.value, depth + 1),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    if (array && count !== v.length) throw new PhaseFault("invalid-input");
    active.delete(v);
    return output;
  };
  return visit(value, 0) as T;
}

export function phaseText(value: unknown, max = 256): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    value.trim() === value &&
    value.normalize("NFC") === value &&
    unicode(value) &&
    Buffer.byteLength(value) <= max &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function keys(
  value: object,
  required: readonly string[],
  optional: readonly string[] = [],
) {
  const actual = Object.keys(value);
  if (
    !required.every((k) => actual.includes(k)) ||
    actual.some((k) => !required.includes(k) && !optional.includes(k))
  )
    throw new PhaseFault("invalid-input");
}

function state(value: { readonly phase: string; readonly status: string }) {
  if (!value || !phaseText(value.phase, 120) || !phaseText(value.status, 120))
    throw new PhaseFault("invalid-input");
}

export function phaseInput(value: unknown) {
  const input = phaseCopy(value) as DevSquadAdoPhaseInput;
  keys(
    input,
    [
      "workItemId",
      "occurrence",
      "plugin",
      "expected",
      "success",
      "failure",
      "phase",
    ],
    ["feedback"],
  );
  const workItemId = canonicalWorkItem(input.workItemId);
  if (workItemId === null || !isB32(input.occurrence))
    throw new PhaseFault("invalid-input");
  keys(input.plugin, ["id", "version"]);
  if (!phaseText(input.plugin.id) || !phaseText(input.plugin.version))
    throw new PhaseFault("invalid-input");
  state(input.expected);
  state(input.success);
  state(input.failure);
  keys(input.expected, ["revision", "phase", "status"]);
  keys(input.success, ["phase", "status"]);
  keys(input.failure, ["phase", "status"]);
  if (
    !Number.isSafeInteger(input.expected.revision) ||
    input.expected.revision < 1
  )
    throw new PhaseFault("invalid-input");
  if (input.feedback !== undefined) feedbackBinding(input.feedback);
  if (input.phase.kind === "prepare") {
    keys(input.phase, ["kind", "content"]);
    if (typeof input.phase.content !== "string" || !input.phase.content.trim())
      throw new PhaseFault("invalid-input");
  } else if (input.phase.kind === "implement") {
    keys(input.phase, ["kind", "execution", "approval"]);
    const e = input.phase.execution;
    keys(
      e,
      [
        "repo",
        "branch",
        "workItem",
        "specContent",
        "planContent",
        "agentRole",
        "validationCommands",
        "bounds",
      ],
      ["relatedSummaries"],
    );
    keys(e.repo, ["hostRepoPath", "worktreePath", "workingDirectory"]);
    keys(e.branch, ["sourceBranch", "targetBranch"]);
    keys(e.workItem, ["id", "title"], ["description", "url", "metadata"]);
    keys(input.phase.approval, ["occurrence", "design", "target"]);
    const a = input.phase.approval;
    const t = copyDesignTarget(a.target);
    if (
      !isB32(a.occurrence) ||
      !isB32(a.design) ||
      t[0] !== "bound" ||
      canonicalWorkItem(e.workItem.id) !== workItemId ||
      e.repo.worktreePath !== t[6] ||
      e.branch.sourceBranch !== t[5]
    )
      throw new PhaseFault("invalid-input");
    if (
      !Array.isArray(e.validationCommands) ||
      e.validationCommands.length < 1 ||
      e.validationCommands.length > 32
    )
      throw new PhaseFault("input-limit");
    for (const command of e.validationCommands) {
      keys(command, ["label", "command"], ["description", "cwd"]);
      if (!phaseText(command.label) || !phaseText(command.command, 4096))
        throw new PhaseFault("invalid-input");
    }
    if (!e.bounds) throw new PhaseFault("invalid-input");
    keys(
      e.bounds,
      ["maxIterations", "timeoutMs"],
      ["idleTimeoutSeconds", "completionTimeoutSeconds"],
    );
    if (
      !Number.isSafeInteger(e.bounds.maxIterations) ||
      e.bounds.maxIterations! < 1 ||
      e.bounds.maxIterations! > 64 ||
      !Number.isSafeInteger(e.bounds.timeoutMs) ||
      e.bounds.timeoutMs! < 1 ||
      e.bounds.timeoutMs! > 300000
    )
      throw new PhaseFault("invalid-input");
  } else throw new PhaseFault("invalid-input");
  const canonical: DevSquadAdoPhaseInput = { ...input, workItemId };
  // Explicit field order makes insertion-order differences irrelevant.
  const intentFields = [
    canonical.workItemId,
    canonical.occurrence,
    canonical.plugin.id,
    canonical.plugin.version,
    canonical.expected.revision,
    canonical.expected.phase,
    canonical.expected.status,
    canonical.success.phase,
    canonical.success.status,
    canonical.failure.phase,
    canonical.failure.status,
  ];
  const intent =
    canonical.feedback === undefined
      ? gateHash([
          "dp16.intent.v1",
          ...intentFields,
          sortedData(canonical.phase),
        ])
      : gateHash([
          "dp16.intent.v2",
          ...intentFields,
          sortedData(canonical.feedback),
          sortedData(canonical.phase),
        ]);
  return { input: canonical, workItemId, intent };
}

function feedbackBinding(value: DevSquadAdoPhaseFeedbackBinding) {
  keys(value, [
    "sourceOccurrence",
    "sourceIntent",
    "sourceState",
    "sourceReservationRevision",
    "sourceTerminalRevision",
    "sourceReceiptDigest",
    "evidenceDigest",
    "normalizedDigest",
  ]);
  if (
    !isB32(value.sourceOccurrence) ||
    !isB32(value.sourceIntent) ||
    !isB32(value.sourceReceiptDigest) ||
    !isB32(value.evidenceDigest) ||
    !isB32(value.normalizedDigest) ||
    !["completed", "failed"].includes(value.sourceState) ||
    !Number.isSafeInteger(value.sourceReservationRevision) ||
    value.sourceReservationRevision < 1 ||
    !Number.isSafeInteger(value.sourceTerminalRevision) ||
    value.sourceTerminalRevision !== value.sourceReservationRevision + 1
  )
    throw new PhaseFault("invalid-input");
}

function sortedData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedData);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, v]) => [key, sortedData(v)]),
    );
  return value;
}

export const phaseEqual = (a: unknown, b: unknown): boolean =>
  JSON.stringify(sortedData(phaseCopy(a))) ===
  JSON.stringify(sortedData(phaseCopy(b)));

/** Project only known data properties before copying potentially large dependency output. */
export function phaseFields(
  value: unknown,
  names: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object")
    throw new PhaseFault("dependency-failed");
  const result: Record<string, unknown> = {};
  for (const name of names) {
    const d = Object.getOwnPropertyDescriptor(value, name);
    if (!d) continue;
    if (!("value" in d)) throw new PhaseFault("dependency-failed");
    if (d.value !== undefined) result[name] = d.value;
  }
  return result;
}

export interface PhaseHistory {
  readonly occurrence: string;
  readonly intent: string;
  readonly reservationRevision: number;
  readonly terminalRevision?: number;
  readonly state: "pending" | "completed" | "failed";
  readonly receiptDigest?: string;
}

export function phaseHistory(record: DevSquadAdoWorkflowRecord) {
  if (!reduceGateHistory(record, "").ok)
    throw new PhaseFault("history-conflict");
  const histories = new Map<string, PhaseHistory>();
  let pending: string | null = null;
  for (const checkpoint of record.checkpoints) {
    if (!checkpoint.operationId.startsWith("dp16")) continue;
    const [ns, kind, occurrence, intent, receipt, event, ...extra] =
      checkpoint.operationId.split(".");
    const reservation = kind === "r";
    if (
      ns !== "dp16" ||
      !["r", "c", "f"].includes(kind!) ||
      !isB32(occurrence) ||
      !isB32(intent) ||
      !isB32(receipt) ||
      (reservation ? event !== undefined : !isB32(event)) ||
      extra.length
    )
      throw new PhaseFault("history-conflict");
    const expected = {
      revision: checkpoint.revision - 1,
      ...checkpoint.previous,
    };
    const commitment = gateHash([
      "dp16.event.v1",
      record.workItemId,
      kind,
      occurrence,
      intent,
      reservation ? null : receipt,
      expected.revision,
      expected.phase,
      expected.status,
      checkpoint.resulting.phase,
      checkpoint.resulting.status,
    ]);
    if (commitment !== (reservation ? receipt : event))
      throw new PhaseFault("history-conflict");
    const previous = histories.get(occurrence!);
    if (reservation) {
      if (
        previous ||
        pending ||
        checkpoint.previous.phase !== checkpoint.resulting.phase ||
        checkpoint.previous.status !== checkpoint.resulting.status
      )
        throw new PhaseFault("history-conflict");
      pending = occurrence!;
      histories.set(occurrence!, {
        occurrence: occurrence!,
        intent: intent!,
        reservationRevision: checkpoint.revision,
        state: "pending",
      });
    } else {
      if (
        !previous ||
        previous.state !== "pending" ||
        previous.intent !== intent ||
        pending !== occurrence ||
        checkpoint.revision !== previous.reservationRevision + 1
      )
        throw new PhaseFault("history-conflict");
      pending = null;
      histories.set(occurrence!, {
        ...previous,
        state: kind === "c" ? "completed" : "failed",
        terminalRevision: checkpoint.revision,
        receiptDigest: receipt!,
      });
    }
  }
  return { histories, pending };
}

export function phaseOperation(
  input: DevSquadAdoPhaseInput,
  intent: string,
  kind: "r" | "c" | "f",
  expected: DevSquadAdoPhaseInput["expected"],
  patch: DevSquadAdoPhaseInput["success"],
  receipt: string | null,
) {
  const event = gateHash([
    "dp16.event.v1",
    input.workItemId,
    kind,
    input.occurrence,
    intent,
    receipt,
    expected.revision,
    expected.phase,
    expected.status,
    patch.phase,
    patch.status,
  ]);
  return [
    "dp16",
    kind,
    input.occurrence,
    intent,
    ...(receipt ? [receipt] : []),
    event,
  ].join(".");
}

/** General runner CAS acknowledgement: exact phase/status delta, no unrelated mutation. */
export function phaseAcknowledgement(
  response: unknown,
  original: CheckpointDevSquadAdoWorkflowInput,
  before: DevSquadAdoWorkflowRecord,
  now: number,
): DevSquadAdoWorkflowRecord | null {
  const r = phaseFields(response, ["ok", "value"]);
  if (r.ok !== true) return null;
  const v = phaseFields(r.value, [
    "replayed",
    "acceptedRevision",
    "acceptedAt",
    "record",
    "outcome",
  ]);
  if (
    !v ||
    v.replayed !== false ||
    v.acceptedRevision !== original.expected.revision + 1 ||
    typeof v.acceptedAt !== "string" ||
    !Number.isFinite(Date.parse(v.acceptedAt)) ||
    new Date(v.acceptedAt).toISOString() !== v.acceptedAt ||
    v.acceptedAt < before.updatedAt ||
    Date.parse(v.acceptedAt) > now
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
    previous: { phase: before.phase, status: before.status },
    resulting: { phase: original.patch.phase, status: original.patch.status },
  };
  const outcome = phaseFields(v.outcome, ["kind", "checkpoint"]);
  if (
    !outcome ||
    outcome.kind !== "checkpointed" ||
    !phaseEqual(outcome.checkpoint, entry) ||
    after.checkpoints.length !== before.checkpoints.length + 1
  )
    return null;
  for (const key of Object.keys(before) as Array<
    keyof DevSquadAdoWorkflowRecord
  >) {
    if (
      key === "revision" ||
      key === "updatedAt" ||
      key === "checkpoints" ||
      key === "phase" ||
      key === "status"
    )
      continue;
    if (JSON.stringify(after[key]) !== JSON.stringify(before[key])) return null;
  }
  if (
    after.phase !== original.patch.phase ||
    after.status !== original.patch.status
  )
    return null;
  for (let i = 0; i < before.checkpoints.length; i++)
    if (
      JSON.stringify(after.checkpoints[i]) !==
      JSON.stringify(before.checkpoints[i])
    )
      return null;
  if (!phaseEqual(after.checkpoints.at(-1), entry)) return null;
  phaseHistory(after);
  return after;
}
