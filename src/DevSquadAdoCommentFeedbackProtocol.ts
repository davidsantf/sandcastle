import { gateHash } from "./DevSquadAdoDesignApprovalHistory.js";
import {
  canonicalWorkItem,
  isB32,
  unicode,
} from "./DevSquadAdoDesignApprovalValidation.js";
import {
  PhaseFault,
  phaseCopy,
  phaseEqual,
  phaseInput,
  phaseText,
} from "./DevSquadAdoPhaseProtocol.js";
import type {
  DevSquadAdoPhaseFeedbackBinding,
  DevSquadAdoPhaseInput,
  DevSquadAdoPhaseResult,
} from "./DevSquadAdoPhaseTypes.js";
import type {
  DevSquadAdoCommentFeedbackBinding,
  DevSquadAdoCommentFeedbackEvidence,
  DevSquadAdoCommentFeedbackNormalizationRequest,
  DevSquadAdoCommentFeedbackSelection,
  DevSquadAdoCommentFeedbackSource,
  DevSquadAdoCommentFeedbackRecoveryRequest,
  RunDevSquadAdoCommentFeedbackRequest,
} from "./DevSquadAdoCommentFeedbackTypes.js";

export class CommentFeedbackFault extends Error {
  constructor(
    readonly reason:
      | "invalid-input"
      | "input-limit"
      | "source-unverified"
      | "normalization-rejected"
      | "route-denied"
      | "dependency-failed"
      | "deadline"
      | "cancelled"
      | "call-limit",
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
    throw new CommentFeedbackFault("invalid-input");
}

function canonicalUtc(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function boundedText(value: unknown, maximumBytes: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.normalize("NFC") === value &&
    unicode(value) &&
    !value.includes("\u0000") &&
    Buffer.byteLength(value) <= maximumBytes
  );
}

function evidence(
  values: readonly DevSquadAdoCommentFeedbackEvidence[],
): readonly DevSquadAdoCommentFeedbackEvidence[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > 64)
    throw new CommentFeedbackFault("input-limit");
  let previous = -1;
  let total = 0;
  const identities = new Set<string>();
  const immutableIdentities = new Set<string>();
  for (const value of values) {
    keys(value, [
      "kind",
      "provider",
      "containerId",
      "eventId",
      "eventVersion",
      "ordinal",
      "observedAt",
      "immutableEvidenceId",
      "body",
    ]);
    if (
      !["comment", "review-feedback"].includes(value.kind) ||
      !phaseText(value.provider) ||
      !phaseText(value.containerId) ||
      !phaseText(value.eventId) ||
      !phaseText(value.eventVersion) ||
      !phaseText(value.immutableEvidenceId) ||
      !Number.isSafeInteger(value.ordinal) ||
      value.ordinal < 0 ||
      value.ordinal <= previous ||
      !canonicalUtc(value.observedAt) ||
      !boundedText(value.body, 4096)
    )
      throw new CommentFeedbackFault("invalid-input");
    total += Buffer.byteLength(value.body);
    if (total > 131072) throw new CommentFeedbackFault("input-limit");
    previous = value.ordinal;
    const identity = [
      value.provider,
      value.containerId,
      value.eventId,
      value.eventVersion,
    ].join("\u0000");
    if (identities.has(identity))
      throw new CommentFeedbackFault("invalid-input");
    identities.add(identity);
    const immutableIdentity = [value.provider, value.immutableEvidenceId].join(
      "\u0000",
    );
    if (immutableIdentities.has(immutableIdentity))
      throw new CommentFeedbackFault("invalid-input");
    immutableIdentities.add(immutableIdentity);
  }
  return values;
}

export function commentFeedbackSource(value: DevSquadAdoCommentFeedbackSource) {
  keys(value, ["input", "receipt"]);
  const normalized = phaseInput(value.input).input;
  const receipt = value.receipt;
  keys(receipt, [
    "state",
    "intent",
    "reservationRevision",
    "terminalRevision",
    "receiptDigest",
  ]);
  if (
    !["completed", "failed"].includes(receipt.state) ||
    !isB32(receipt.intent) ||
    !isB32(receipt.receiptDigest) ||
    !Number.isSafeInteger(receipt.reservationRevision) ||
    receipt.reservationRevision < 1 ||
    !Number.isSafeInteger(receipt.terminalRevision) ||
    receipt.terminalRevision !== receipt.reservationRevision + 1 ||
    phaseInput(normalized).intent !== receipt.intent
  )
    throw new CommentFeedbackFault("invalid-input");
  return { input: normalized, receipt: { ...receipt } };
}

function selection(
  workItemId: string,
  value: DevSquadAdoCommentFeedbackSelection,
) {
  keys(
    value,
    [
      "occurrence",
      "plugin",
      "expected",
      "success",
      "failure",
      "phase",
      "authority",
    ],
    ["timeoutMs"],
  );
  if (!isB32(value.occurrence)) throw new CommentFeedbackFault("invalid-input");
  keys(value.phase, ["kind"], ["phase"]);
  if (
    value.phase.kind !== "feedback-prepare" &&
    value.phase.kind !== "phase-reentry"
  )
    throw new CommentFeedbackFault("invalid-input");
  if (value.phase.kind === "feedback-prepare" && "phase" in value.phase)
    throw new CommentFeedbackFault("invalid-input");
  if (
    value.phase.kind === "phase-reentry" &&
    (!value.phase.phase || value.phase.phase.kind === undefined)
  )
    throw new CommentFeedbackFault("invalid-input");
  keys(value.authority, ["ownerId", "claimToken", "fencingValue"]);
  if (
    !phaseText(value.authority.ownerId) ||
    !isB32(value.authority.claimToken) ||
    !Number.isSafeInteger(value.authority.fencingValue) ||
    value.authority.fencingValue < 1 ||
    (value.timeoutMs !== undefined &&
      (!Number.isSafeInteger(value.timeoutMs) ||
        value.timeoutMs < 1 ||
        value.timeoutMs > 300000))
  )
    throw new CommentFeedbackFault("invalid-input");
  const phase =
    value.phase.kind === "feedback-prepare"
      ? ({ kind: "prepare", content: "feedback-validation" } as const)
      : value.phase.phase;
  const normalized = phaseInput({
    workItemId,
    occurrence: value.occurrence,
    plugin: value.plugin,
    expected: value.expected,
    success: value.success,
    failure: value.failure,
    phase,
  }).input;
  return {
    occurrence: normalized.occurrence,
    plugin: normalized.plugin,
    expected: normalized.expected,
    success: normalized.success,
    failure: normalized.failure,
    phase:
      value.phase.kind === "feedback-prepare"
        ? value.phase
        : { kind: "phase-reentry" as const, phase: normalized.phase },
    authority: { ...value.authority },
    ...(value.timeoutMs === undefined ? {} : { timeoutMs: value.timeoutMs }),
  } satisfies DevSquadAdoCommentFeedbackSelection;
}

export function commentFeedbackInput(
  value: RunDevSquadAdoCommentFeedbackRequest,
) {
  const names = Reflect.ownKeys(value);
  const allowed = [
    "workItemId",
    "source",
    "evidence",
    "selection",
    "timeoutMs",
    "signal",
  ];
  if (names.some((key) => typeof key !== "string" || !allowed.includes(key)))
    throw new CommentFeedbackFault("invalid-input");
  const root: Record<string, unknown> = {};
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor || !("value" in descriptor))
      throw new CommentFeedbackFault("invalid-input");
    root[String(name)] = descriptor.value;
  }
  if (
    typeof root.workItemId !== "string" &&
    typeof root.workItemId !== "number"
  )
    throw new CommentFeedbackFault("invalid-input");
  const workItemId = canonicalWorkItem(root.workItemId);
  if (workItemId === null) throw new CommentFeedbackFault("invalid-input");
  let copied: {
    source: DevSquadAdoCommentFeedbackSource;
    evidence: readonly DevSquadAdoCommentFeedbackEvidence[];
    selection: DevSquadAdoCommentFeedbackSelection;
  };
  try {
    copied = phaseCopy({
      source: root.source,
      evidence: root.evidence,
      selection: root.selection,
    }) as typeof copied;
  } catch (error) {
    if (error instanceof PhaseFault)
      throw new CommentFeedbackFault(
        error.reason === "input-limit" ? "input-limit" : "invalid-input",
      );
    throw error;
  }
  const normalizedSource = commentFeedbackSource(copied.source);
  const normalizedSelection = selection(workItemId, copied.selection);
  const terminalState =
    normalizedSource.receipt.state === "completed"
      ? normalizedSource.input.success
      : normalizedSource.input.failure;
  if (
    canonicalWorkItem(normalizedSource.input.workItemId) !== workItemId ||
    normalizedSelection.occurrence === normalizedSource.input.occurrence ||
    normalizedSelection.expected.phase !== terminalState.phase ||
    normalizedSelection.expected.status !== terminalState.status
  )
    throw new CommentFeedbackFault("invalid-input");
  if (
    normalizedSelection.expected.revision <
    normalizedSource.receipt.terminalRevision
  )
    throw new CommentFeedbackFault("invalid-input");
  const normalizedEvidence = evidence(copied.evidence);
  const evidenceDigest = gateHash([
    "df17.evidence.v1",
    workItemId,
    normalizedSource.receipt.intent,
    normalizedSource.receipt.receiptDigest,
    normalizedEvidence.map((item) => [
      item.kind,
      item.provider,
      item.containerId,
      item.eventId,
      item.eventVersion,
      item.ordinal,
      item.observedAt,
      item.immutableEvidenceId,
      item.body,
    ]),
  ]);
  const normalization: DevSquadAdoCommentFeedbackNormalizationRequest = {
    workItemId,
    source: normalizedSource,
    evidence: normalizedEvidence,
    evidenceDigest,
    selection: {
      occurrence: normalizedSelection.occurrence,
      plugin: normalizedSelection.plugin,
      expected: normalizedSelection.expected,
      success: normalizedSelection.success,
      failure: normalizedSelection.failure,
      phase: normalizedSelection.phase,
    },
  };
  return {
    workItemId,
    source: normalizedSource,
    selection: normalizedSelection,
    normalization,
    evidenceDigest,
    timeoutMs: root.timeoutMs,
    signal: root.signal,
  };
}

export function buildCommentFeedbackPhase(
  workItemId: string,
  sourceValue: DevSquadAdoCommentFeedbackSource,
  selectionValue: DevSquadAdoCommentFeedbackSelection,
  evidenceDigest: string,
  normalizedContent: string,
  normalizerId: string,
  normalizedEvidenceId: string,
) {
  if (
    !boundedText(normalizedContent, 32768) ||
    !phaseText(normalizerId) ||
    !phaseText(normalizedEvidenceId)
  )
    throw new CommentFeedbackFault("normalization-rejected");
  const normalizedDigest = gateHash([
    "df17.normalized.v1",
    workItemId,
    evidenceDigest,
    normalizerId,
    normalizedEvidenceId,
    normalizedContent,
  ]);
  const feedback: DevSquadAdoPhaseFeedbackBinding = {
    sourceOccurrence: sourceValue.input.occurrence,
    sourceIntent: sourceValue.receipt.intent,
    sourceState: sourceValue.receipt.state,
    sourceReservationRevision: sourceValue.receipt.reservationRevision,
    sourceTerminalRevision: sourceValue.receipt.terminalRevision,
    sourceReceiptDigest: sourceValue.receipt.receiptDigest,
    evidenceDigest,
    normalizedDigest,
  };
  const candidate: DevSquadAdoPhaseInput = {
    workItemId,
    occurrence: selectionValue.occurrence,
    plugin: selectionValue.plugin,
    expected: selectionValue.expected,
    success: selectionValue.success,
    failure: selectionValue.failure,
    feedback,
    phase:
      selectionValue.phase.kind === "feedback-prepare"
        ? { kind: "prepare", content: normalizedContent }
        : selectionValue.phase.phase,
  };
  const selectedPhase = phaseInput(candidate).input;
  const binding: DevSquadAdoCommentFeedbackBinding = {
    sourceIntent: sourceValue.receipt.intent,
    sourceTerminalRevision: sourceValue.receipt.terminalRevision,
    sourceReceiptDigest: sourceValue.receipt.receiptDigest,
    evidenceDigest,
    normalizedDigest,
    selectedOccurrence: selectedPhase.occurrence,
  };
  return { selectedPhase, binding, normalizedDigest };
}

export function verifyCommentFeedbackSource(
  sourceValue: DevSquadAdoCommentFeedbackSource,
  result: DevSquadAdoPhaseResult,
  expectedCurrentRevision: number,
) {
  const receipt = sourceValue.receipt;
  if (
    result.state !== receipt.state ||
    result.reason !== "recorded" ||
    result.intent !== receipt.intent ||
    result.reservationRevision !== receipt.reservationRevision ||
    result.terminalRevision !== receipt.terminalRevision ||
    result.receiptDigest !== receipt.receiptDigest ||
    result.knownRevision === null ||
    result.knownRevision < expectedCurrentRevision
  )
    throw new CommentFeedbackFault("source-unverified");
}

export function verifyRecoveryBinding(
  sourceValue: DevSquadAdoCommentFeedbackSource,
  selectedPhase: DevSquadAdoPhaseInput,
) {
  const normalized = phaseInput(selectedPhase).input;
  const binding = normalized.feedback;
  if (
    !binding ||
    binding.sourceOccurrence !== sourceValue.input.occurrence ||
    binding.sourceIntent !== sourceValue.receipt.intent ||
    binding.sourceState !== sourceValue.receipt.state ||
    binding.sourceReservationRevision !==
      sourceValue.receipt.reservationRevision ||
    binding.sourceTerminalRevision !== sourceValue.receipt.terminalRevision ||
    binding.sourceReceiptDigest !== sourceValue.receipt.receiptDigest
  )
    throw new CommentFeedbackFault("invalid-input");
  return {
    selectedPhase: normalized,
    binding: {
      sourceIntent: binding.sourceIntent,
      sourceTerminalRevision: binding.sourceTerminalRevision,
      sourceReceiptDigest: binding.sourceReceiptDigest,
      evidenceDigest: binding.evidenceDigest,
      normalizedDigest: binding.normalizedDigest,
      selectedOccurrence: normalized.occurrence,
    } satisfies DevSquadAdoCommentFeedbackBinding,
  };
}

export function commentFeedbackRecoveryInput(
  value: DevSquadAdoCommentFeedbackRecoveryRequest,
) {
  const names = Reflect.ownKeys(value);
  const allowed = [
    "workItemId",
    "source",
    "selectedPhase",
    "timeoutMs",
    "signal",
  ];
  if (names.some((key) => typeof key !== "string" || !allowed.includes(key)))
    throw new CommentFeedbackFault("invalid-input");
  const root: Record<string, unknown> = {};
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor || !("value" in descriptor))
      throw new CommentFeedbackFault("invalid-input");
    root[String(name)] = descriptor.value;
  }
  if (
    typeof root.workItemId !== "string" &&
    typeof root.workItemId !== "number"
  )
    throw new CommentFeedbackFault("invalid-input");
  const workItemId = canonicalWorkItem(root.workItemId);
  if (workItemId === null) throw new CommentFeedbackFault("invalid-input");
  let copied: {
    source: DevSquadAdoCommentFeedbackSource;
    selectedPhase: DevSquadAdoPhaseInput;
  };
  try {
    copied = phaseCopy({
      source: root.source,
      selectedPhase: root.selectedPhase,
    }) as typeof copied;
  } catch (error) {
    if (error instanceof PhaseFault)
      throw new CommentFeedbackFault(
        error.reason === "input-limit" ? "input-limit" : "invalid-input",
      );
    throw error;
  }
  const source = commentFeedbackSource(copied.source);
  const selectedPhase = phaseInput(copied.selectedPhase).input;
  if (
    source.input.workItemId !== workItemId ||
    selectedPhase.workItemId !== workItemId
  )
    throw new CommentFeedbackFault("invalid-input");
  return {
    workItemId,
    source,
    ...verifyRecoveryBinding(source, selectedPhase),
    timeoutMs: root.timeoutMs,
    signal: root.signal,
  };
}

export const commentFeedbackEqual = phaseEqual;
