import { gateHash } from "./DevSquadAdoDesignApprovalHistory.js";
import {
  canonicalWorkItem,
  isB32,
} from "./DevSquadAdoDesignApprovalValidation.js";
import {
  PhaseFault,
  phaseCopy,
  phaseEqual,
  phaseHistory,
  phaseInput,
  phaseOperation,
  phaseText,
} from "./DevSquadAdoPhaseProtocol.js";
import type {
  DevSquadAdoWorkflowRecord,
  DevSquadAdoWorkflowState,
} from "./DevSquadAdoWorkflowLedger.js";
import type {
  DevSquadAdoHumanControlAction,
  DevSquadAdoHumanControlAdjudicationAction,
  DevSquadAdoHumanControlAuthorizedAction,
  DevSquadAdoHumanControlAuditEntry,
  DevSquadAdoHumanControlMutationAction,
  DevSquadAdoHumanControlSnapshot,
  RunDevSquadAdoHumanControlRequest,
} from "./DevSquadAdoHumanControlTypes.js";

export class HumanControlFault extends Error {
  constructor(
    readonly reason:
      | "invalid-input"
      | "input-limit"
      | "history-conflict"
      | "intent-conflict"
      | "state-conflict"
      | "authority-rejected"
      | "human-unverified"
      | "policy-denied"
      | "phase-unverified"
      | "dependency-failed"
      | "deadline"
      | "cancelled"
      | "call-limit"
      | "mutation-unconfirmed"
      | "ledger-unavailable",
  ) {
    super(reason);
  }
}

function keys(
  value: object,
  required: readonly string[],
  optional: readonly string[] = [],
) {
  const actual = Object.keys(value);
  if (
    !required.every((key) => actual.includes(key)) ||
    actual.some((key) => !required.includes(key) && !optional.includes(key))
  )
    throw new HumanControlFault("invalid-input");
}

function state(
  value: DevSquadAdoWorkflowState & { readonly revision?: number },
) {
  keys(value, ["phase", "status"], ["revision"]);
  if (!phaseText(value.phase) || !phaseText(value.status))
    throw new HumanControlFault("invalid-input");
}

function authority(value: DevSquadAdoHumanControlMutationAction["authority"]) {
  keys(value, ["ownerId", "claimToken", "fencingValue"]);
  if (
    !phaseText(value.ownerId) ||
    !isB32(value.claimToken) ||
    !Number.isSafeInteger(value.fencingValue) ||
    value.fencingValue < 1
  )
    throw new HumanControlFault("invalid-input");
}

function decision(value: DevSquadAdoHumanControlMutationAction["decision"]) {
  keys(value, ["actorId", "decisionId", "evidenceDigest"]);
  if (
    !phaseText(value.actorId) ||
    !phaseText(value.decisionId) ||
    !isB32(value.evidenceDigest)
  )
    throw new HumanControlFault("invalid-input");
}

function mutation(value: DevSquadAdoHumanControlMutationAction) {
  keys(value, [
    "kind",
    "occurrence",
    "expected",
    "resulting",
    "authority",
    "decision",
  ]);
  if (
    !["pause", "resume", "cancel", "finalize"].includes(value.kind) ||
    !isB32(value.occurrence)
  )
    throw new HumanControlFault("invalid-input");
  state(value.expected);
  state(value.resulting);
  if (
    !Number.isSafeInteger(value.expected.revision) ||
    value.expected.revision < 1
  )
    throw new HumanControlFault("invalid-input");
  authority(value.authority);
  decision(value.decision);
  return value;
}

function adjudication(value: DevSquadAdoHumanControlAdjudicationAction) {
  keys(value, [
    "kind",
    "phase",
    "outcome",
    "receiptDigest",
    "expected",
    "authority",
    "decision",
  ]);
  const phase = phaseInput(value.phase).input;
  if (!["completed", "failed"].includes(value.outcome))
    throw new HumanControlFault("invalid-input");
  if (!isB32(value.receiptDigest)) throw new HumanControlFault("invalid-input");
  state(value.expected);
  if (
    !Number.isSafeInteger(value.expected.revision) ||
    value.expected.revision < 1
  )
    throw new HumanControlFault("invalid-input");
  authority(value.authority);
  decision(value.decision);
  return { ...value, phase };
}

export function humanControlInput(value: RunDevSquadAdoHumanControlRequest) {
  const names = Reflect.ownKeys(value);
  const allowed = ["workItemId", "action", "timeoutMs", "signal"];
  if (names.some((key) => typeof key !== "string" || !allowed.includes(key)))
    throw new HumanControlFault("invalid-input");
  const root: Record<string, unknown> = {};
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor || !("value" in descriptor))
      throw new HumanControlFault("invalid-input");
    root[String(name)] = descriptor.value;
  }
  if (
    typeof root.workItemId !== "string" &&
    typeof root.workItemId !== "number"
  )
    throw new HumanControlFault("invalid-input");
  const workItemId = canonicalWorkItem(root.workItemId);
  if (workItemId === null) throw new HumanControlFault("invalid-input");
  let action: DevSquadAdoHumanControlAction;
  try {
    action = phaseCopy(root.action) as DevSquadAdoHumanControlAction;
  } catch (error) {
    if (error instanceof PhaseFault)
      throw new HumanControlFault(
        error.reason === "input-limit" ? "input-limit" : "invalid-input",
      );
    throw error;
  }
  if (!action || typeof action !== "object")
    throw new HumanControlFault("invalid-input");
  if (!Object.prototype.hasOwnProperty.call(action, "kind"))
    throw new HumanControlFault("invalid-input");
  if (action.kind === "status") {
    keys(action, ["kind"]);
  } else if (action.kind === "audit") {
    keys(action, ["kind"], ["limit"]);
    if (
      action.limit !== undefined &&
      (!Number.isSafeInteger(action.limit) ||
        action.limit < 1 ||
        action.limit > 100)
    )
      throw new HumanControlFault("invalid-input");
  } else if (action.kind === "adjudicate") {
    action = adjudication(action);
  } else {
    action = mutation(action);
  }
  if (
    action.kind === "adjudicate" &&
    canonicalWorkItem(action.phase.workItemId) !== workItemId
  )
    throw new HumanControlFault("invalid-input");
  return {
    workItemId,
    action,
    timeoutMs: root.timeoutMs,
    signal: root.signal,
  };
}

export function humanControlIntent(
  workItemId: string,
  action:
    | DevSquadAdoHumanControlMutationAction
    | DevSquadAdoHumanControlAdjudicationAction,
) {
  return gateHash([
    "dc18.intent.v1",
    workItemId,
    action.kind,
    action.kind === "adjudicate" ? action.phase.occurrence : action.occurrence,
    action.expected.revision,
    action.expected.phase,
    action.expected.status,
    action.kind === "adjudicate"
      ? action.outcome === "completed"
        ? action.phase.success
        : action.phase.failure
      : action.resulting,
    action.decision.actorId,
    action.decision.decisionId,
    action.decision.evidenceDigest,
    ...(action.kind === "adjudicate"
      ? [phaseInput(action.phase).intent, action.receiptDigest]
      : []),
  ]);
}

export function humanControlAuthorizedAction(
  action:
    | DevSquadAdoHumanControlMutationAction
    | DevSquadAdoHumanControlAdjudicationAction,
): DevSquadAdoHumanControlAuthorizedAction {
  const { authority, ...semantic } = action;
  return {
    ...semantic,
    ownerId: authority.ownerId,
    fencingValue: authority.fencingValue,
  };
}

export function humanControlOperation(
  workItemId: string,
  action:
    | DevSquadAdoHumanControlMutationAction
    | DevSquadAdoHumanControlAdjudicationAction,
  intent: string,
) {
  if (action.kind === "adjudicate") {
    return phaseOperation(
      action.phase,
      phaseInput(action.phase).intent,
      action.outcome === "completed" ? "c" : "f",
      action.expected,
      action.outcome === "completed"
        ? action.phase.success
        : action.phase.failure,
      action.receiptDigest,
    );
  }
  const event = gateHash([
    "dc18.event.v1",
    workItemId,
    action.kind,
    action.occurrence,
    intent,
    action.expected.revision,
    action.expected.phase,
    action.expected.status,
    action.resulting.phase,
    action.resulting.status,
  ]);
  return ["dc18", action.kind, action.occurrence, intent, event].join(".");
}

export function humanControlSnapshot(
  record: DevSquadAdoWorkflowRecord,
  limit = 0,
): DevSquadAdoHumanControlSnapshot {
  humanControlHistory(record);
  const history = phaseHistory(record);
  const audit: DevSquadAdoHumanControlAuditEntry[] =
    limit === 0
      ? []
      : record.checkpoints.slice(-limit).map((entry) => ({
          revision: entry.revision,
          operationId: entry.operationId,
          acceptedAt: entry.acceptedAt,
          previous: { ...entry.previous },
          resulting: { ...entry.resulting },
        }));
  return {
    revision: record.revision,
    phase: record.phase,
    status: record.status,
    activeClaim: record.activeClaim
      ? {
          ownerId: record.activeClaim.ownerId,
          fencingValue: record.activeClaim.fencingValue,
          expiresAt: record.activeClaim.expiresAt,
        }
      : null,
    pendingPhaseOccurrence: history.pending,
    audit,
  };
}

export function humanControlHistory(record: DevSquadAdoWorkflowRecord) {
  const occurrences = new Map<string, string>();
  for (const checkpoint of record.checkpoints) {
    if (!checkpoint.operationId.startsWith("dc18.")) continue;
    const [namespace, kind, occurrence, intent, event, ...extra] =
      checkpoint.operationId.split(".");
    if (
      namespace !== "dc18" ||
      !["pause", "resume", "cancel", "finalize"].includes(kind!) ||
      !isB32(occurrence) ||
      !isB32(intent) ||
      !isB32(event) ||
      extra.length
    )
      throw new HumanControlFault("history-conflict");
    const expectedEvent = gateHash([
      "dc18.event.v1",
      record.workItemId,
      kind,
      occurrence,
      intent,
      checkpoint.revision - 1,
      checkpoint.previous.phase,
      checkpoint.previous.status,
      checkpoint.resulting.phase,
      checkpoint.resulting.status,
    ]);
    if (expectedEvent !== event || occurrences.has(occurrence!))
      throw new HumanControlFault("history-conflict");
    occurrences.set(occurrence!, checkpoint.operationId);
  }
  return occurrences;
}

export function humanControlEqual(left: unknown, right: unknown) {
  return phaseEqual(left, right);
}
