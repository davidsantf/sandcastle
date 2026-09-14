import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import { inspectDesignGateRecord } from "./DevSquadAdoDesignApprovalValidation.js";
import { recoverDevSquadAdoPhase } from "./DevSquadAdoPhaseRunner.js";
import { PhaseLifecycle } from "./DevSquadAdoPhaseLifecycle.js";
import {
  PhaseFault,
  phaseCopy,
  phaseEqual,
  phaseFields,
  phaseHistory,
  phaseInput,
  phaseText,
} from "./DevSquadAdoPhaseProtocol.js";
import {
  HumanControlFault,
  humanControlAuthorizedAction,
  humanControlEqual,
  humanControlHistory,
  humanControlInput,
  humanControlIntent,
  humanControlOperation,
  humanControlSnapshot,
} from "./DevSquadAdoHumanControlProtocol.js";
import type {
  DevSquadAdoHumanControlAdjudicationAction,
  DevSquadAdoHumanControlDependencies,
  DevSquadAdoHumanControlMutationAction,
  DevSquadAdoHumanControlResult,
  RunDevSquadAdoHumanControlRequest,
} from "./DevSquadAdoHumanControlTypes.js";
import type { DevSquadAdoWorkflowRecord } from "./DevSquadAdoWorkflowLedger.js";
import type { CheckpointDevSquadAdoWorkflowInput } from "./DevSquadAdoWorkflowLedger.js";

export type * from "./DevSquadAdoHumanControlTypes.js";

function failure(error: unknown): DevSquadAdoHumanControlResult["reason"] {
  if (error instanceof HumanControlFault) return error.reason;
  if (error instanceof PhaseFault) {
    if (
      error.reason === "deadline" ||
      error.reason === "cancelled" ||
      error.reason === "call-limit" ||
      error.reason === "input-limit" ||
      error.reason === "invalid-input" ||
      error.reason === "history-conflict" ||
      error.reason === "intent-conflict" ||
      error.reason === "state-conflict" ||
      error.reason === "authority-rejected" ||
      error.reason === "ledger-unavailable"
    )
      return error.reason;
    return "phase-unverified";
  }
  return "dependency-failed";
}

function timeout(value: unknown) {
  const result = value ?? 10000;
  if (
    typeof result !== "number" ||
    !Number.isSafeInteger(result) ||
    result < 1 ||
    result > 300000
  )
    throw new HumanControlFault("invalid-input");
  return result;
}

function exactKeys(value: object, expected: readonly string[]) {
  const actual = Object.keys(value);
  return (
    actual.length === expected.length &&
    expected.every((key) => actual.includes(key))
  );
}

function fresh(
  value: unknown,
  now: number,
  reason: "human-unverified" | "policy-denied",
) {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  if (
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString() !== value ||
    parsed <= now ||
    parsed - now > 5000
  )
    throw new HumanControlFault(reason);
  return parsed;
}

function projectRecord(value: unknown, workItemId: string) {
  const record = inspectDesignGateRecord(value, workItemId);
  if (!record) throw new HumanControlFault("history-conflict");
  phaseHistory(record);
  return record;
}

function currentRecord(value: unknown, workItemId: string) {
  const response = phaseFields(value, ["ok", "value"]);
  if (response.ok !== true) throw new HumanControlFault("ledger-unavailable");
  return projectRecord(response.value, workItemId);
}

function assertExpected(
  record: DevSquadAdoWorkflowRecord,
  action:
    | DevSquadAdoHumanControlMutationAction
    | DevSquadAdoHumanControlAdjudicationAction,
) {
  if (
    record.revision !== action.expected.revision ||
    record.phase !== action.expected.phase ||
    record.status !== action.expected.status
  )
    throw new HumanControlFault("state-conflict");
  const claim = record.activeClaim;
  if (
    !claim ||
    claim.ownerId !== action.authority.ownerId ||
    claim.fencingValue !== action.authority.fencingValue ||
    record.fencingCounter !== action.authority.fencingValue
  )
    throw new HumanControlFault("authority-rejected");
  return claim.expiresAt;
}

function controlAcknowledgement(
  response: unknown,
  original: CheckpointDevSquadAdoWorkflowInput,
  before: DevSquadAdoWorkflowRecord,
  now: number,
) {
  const copied = phaseCopy(response);
  const result = phaseFields(copied, ["ok", "value"]);
  if (result.ok !== true) return null;
  const value = phaseFields(result.value, [
    "replayed",
    "acceptedRevision",
    "acceptedAt",
    "record",
    "outcome",
  ]);
  if (
    value.replayed !== false ||
    value.acceptedRevision !== before.revision + 1 ||
    typeof value.acceptedAt !== "string" ||
    !Number.isFinite(Date.parse(value.acceptedAt)) ||
    new Date(value.acceptedAt).toISOString() !== value.acceptedAt ||
    value.acceptedAt < before.updatedAt ||
    Date.parse(value.acceptedAt) > now ||
    (original.notAfter !== undefined && value.acceptedAt >= original.notAfter)
  )
    return null;
  const claim = before.activeClaim;
  if (
    !claim ||
    claim.ownerId !== original.authority.ownerId ||
    claim.fencingValue !== original.authority.fencingValue ||
    now >= Date.parse(claim.expiresAt) ||
    Date.parse(value.acceptedAt) >= Date.parse(claim.expiresAt)
  )
    return null;
  const after = projectRecord(value.record, before.workItemId);
  const expectedEntry = {
    revision: before.revision + 1,
    operationId: original.operationId,
    acceptedAt: value.acceptedAt,
    previous: { phase: before.phase, status: before.status },
    resulting: {
      phase: original.patch.phase,
      status: original.patch.status,
    },
  };
  const outcome = phaseFields(value.outcome, ["kind", "checkpoint"]);
  if (
    outcome.kind !== "checkpointed" ||
    !phaseEqual(outcome.checkpoint, expectedEntry) ||
    after.revision !== before.revision + 1 ||
    after.updatedAt !== value.acceptedAt ||
    after.phase !== original.patch.phase ||
    after.status !== original.patch.status ||
    after.checkpoints.length !== before.checkpoints.length + 1 ||
    !phaseEqual(after.checkpoints.at(-1), expectedEntry)
  )
    return null;
  for (const key of [
    "schemaVersion",
    "workItemId",
    "createdAt",
    "branch",
    "worktreePath",
    "agent",
    "session",
    "pullRequest",
    "observations",
    "activeClaim",
    "fencingCounter",
  ] as const)
    if (!phaseEqual(after[key], before[key])) return null;
  for (let index = 0; index < before.checkpoints.length; index++)
    if (!phaseEqual(after.checkpoints[index], before.checkpoints[index]))
      return null;
  return after;
}

export async function runDevSquadAdoHumanControl(
  request: RunDevSquadAdoHumanControlRequest,
  dependencies: DevSquadAdoHumanControlDependencies,
): Promise<DevSquadAdoHumanControlResult> {
  let life: PhaseLifecycle | undefined;
  let intent: string | null = null;
  let knownRevision: number | null = null;
  let mutationAttempted = false;
  let phaseResult: DevSquadAdoHumanControlResult["phase"] = null;
  try {
    const input = humanControlInput(request);
    if (input.signal !== undefined && !(input.signal instanceof AbortSignal))
      throw new HumanControlFault("invalid-input");
    if (!dependencies?.ledger) throw new HumanControlFault("invalid-input");
    const read = dependencies.ledger.readRecord.bind(dependencies.ledger);
    const utcNow = dependencies.utcNow ?? Date.now;
    const monotonicNow = dependencies.monotonicNow ?? (() => performance.now());
    life = new PhaseLifecycle(
      timeout(input.timeoutMs),
      input.signal as AbortSignal | undefined,
      utcNow,
      monotonicNow,
    );
    const lifecycle = life;
    let record = currentRecord(
      await lifecycle.call(() => read(input.workItemId)),
      input.workItemId,
    );
    knownRevision = record.revision;
    if (input.action.kind === "status" || input.action.kind === "audit") {
      return {
        state: "observed",
        reason: "observed",
        intent: null,
        knownRevision,
        snapshot: humanControlSnapshot(
          record,
          input.action.kind === "audit" ? (input.action.limit ?? 20) : 0,
        ),
        phase: null,
      };
    }
    const action = input.action;
    intent = humanControlIntent(input.workItemId, action);
    const operationId = humanControlOperation(input.workItemId, action, intent);
    const controlHistory = humanControlHistory(record);
    const occurrence =
      action.kind === "adjudicate"
        ? action.phase.occurrence
        : action.occurrence;
    const priorControl = controlHistory.get(occurrence);
    if (priorControl && priorControl !== operationId)
      throw new HumanControlFault("intent-conflict");
    const existing = record.checkpoints.find(
      (entry) => entry.operationId === operationId,
    );
    if (existing) {
      const verifyRetained = dependencies.verifyRetainedControl;
      if (typeof verifyRetained !== "function")
        throw new HumanControlFault("human-unverified");
      if (action.kind === "adjudicate") {
        if (!dependencies.phaseRecovery)
          throw new HumanControlFault("phase-unverified");
        phaseResult = await lifecycle.call(() =>
          recoverDevSquadAdoPhase(action.phase, {
            ...dependencies.phaseRecovery!,
            timeoutMs: Math.max(1, Math.floor(lifecycle.check())),
            signal: lifecycle.controller.signal,
            utcNow,
            monotonicNow,
          }),
        );
        if (
          phaseResult.state !== action.outcome ||
          phaseResult.reason !== "recorded" ||
          phaseResult.receiptDigest !== action.receiptDigest
        )
          throw new HumanControlFault("phase-unverified");
      }
      const retainedRequest = {
        workItemId: input.workItemId,
        action: humanControlAuthorizedAction(action),
        intent,
        operationId,
        acceptedRevision: existing.revision,
        acceptedAt: existing.acceptedAt,
      };
      const retained = phaseCopy(
        await lifecycle.call((signal) =>
          verifyRetained(phaseCopy(retainedRequest), signal),
        ),
      );
      const retainedAt = lifecycle.now();
      if (
        retained.kind !== "verified" ||
        !exactKeys(retained, [
          "kind",
          "request",
          "verifierId",
          "immutableEvidenceId",
          "expiresAt",
        ]) ||
        !humanControlEqual(retained.request, retainedRequest) ||
        !phaseText(retained.verifierId) ||
        !phaseText(retained.immutableEvidenceId)
      )
        throw new HumanControlFault("human-unverified");
      fresh(retained.expiresAt, retainedAt, "human-unverified");
      return {
        state: "recorded",
        reason: "recorded",
        intent,
        knownRevision,
        snapshot: humanControlSnapshot(record),
        phase: phaseResult,
      };
    }
    const pendingPhase = phaseHistory(record).pending;
    if (pendingPhase !== null && action.kind !== "adjudicate")
      throw new HumanControlFault("state-conflict");
    const checkpointMethod = dependencies.ledger.checkpoint;
    const verify = dependencies.verifyHumanDecision;
    const authorize = dependencies.authorizeControl;
    if (
      typeof checkpointMethod !== "function" ||
      typeof verify !== "function" ||
      typeof authorize !== "function"
    )
      throw new HumanControlFault("invalid-input");
    const checkpoint = checkpointMethod.bind(dependencies.ledger);
    assertExpected(record, action);
    if (action.kind === "adjudicate") {
      const history = phaseHistory(record).histories.get(
        action.phase.occurrence,
      );
      if (
        !history ||
        history.state !== "pending" ||
        history.intent !== phaseInput(action.phase).intent ||
        history.reservationRevision !== action.expected.revision
      )
        throw new HumanControlFault("phase-unverified");
      if (!dependencies.phaseRecovery)
        throw new HumanControlFault("phase-unverified");
      phaseResult = await lifecycle.call(() =>
        recoverDevSquadAdoPhase(action.phase, {
          ...dependencies.phaseRecovery!,
          timeoutMs: Math.max(1, Math.floor(lifecycle.check())),
          signal: lifecycle.controller.signal,
          utcNow,
          monotonicNow,
        }),
      );
      if (
        phaseResult.state !== "pending" ||
        phaseResult.reason !== "attempt-consumed" ||
        phaseResult.reservationRevision !== history.reservationRevision
      )
        throw new HumanControlFault("phase-unverified");
    }
    lifecycle.setLease(assertExpected(record, action));
    const verificationRequest = {
      workItemId: input.workItemId,
      action: humanControlAuthorizedAction(action),
      intent,
      challenge: randomBytes(32).toString("base64url"),
    };
    const verified = phaseCopy(
      await lifecycle.call((signal) =>
        verify(phaseCopy(verificationRequest), signal),
      ),
    );
    const verifiedAt = lifecycle.now();
    if (
      verified.kind !== "verified" ||
      !exactKeys(verified, [
        "kind",
        "request",
        "verifierId",
        "immutableEvidenceId",
        "expiresAt",
      ]) ||
      !humanControlEqual(verified.request, verificationRequest) ||
      !phaseText(verified.verifierId) ||
      !phaseText(verified.immutableEvidenceId)
    )
      throw new HumanControlFault("human-unverified");
    const humanReceived = lifecycle.check();
    const humanExpiry = fresh(
      verified.expiresAt,
      verifiedAt,
      "human-unverified",
    );
    const policyRequest = {
      workItemId: input.workItemId,
      action: humanControlAuthorizedAction(action),
      intent,
      operationId,
    };
    const granted = phaseCopy(
      await lifecycle.call((signal) =>
        authorize(phaseCopy(policyRequest), signal),
      ),
    );
    const grantedAt = lifecycle.now();
    if (
      granted.kind !== "granted" ||
      !exactKeys(granted, ["kind", "request", "expiresAt"]) ||
      !humanControlEqual(granted.request, policyRequest)
    )
      throw new HumanControlFault("policy-denied");
    const policyReceived = lifecycle.check();
    const policyExpiry = fresh(granted.expiresAt, grantedAt, "policy-denied");
    const observed = currentRecord(
      await lifecycle.call(() => read(input.workItemId)),
      input.workItemId,
    );
    assertExpected(observed, action);
    const checkGrant = (
      expiry: number,
      receivedRemaining: number,
      receivedUtc: number,
      reason: "human-unverified" | "policy-denied",
      acceptedAt?: string,
    ) => {
      const elapsed = receivedRemaining - lifecycle.check();
      if (
        lifecycle.now() >= expiry ||
        receivedUtc + elapsed >= expiry ||
        (acceptedAt !== undefined && Date.parse(acceptedAt) >= expiry)
      )
        throw new HumanControlFault(reason);
    };
    checkGrant(humanExpiry, humanReceived, verifiedAt, "human-unverified");
    checkGrant(policyExpiry, policyReceived, grantedAt, "policy-denied");
    let receiptExpiry = Infinity;
    let receiptReceived = Infinity;
    let receiptReceivedAt = Infinity;
    if (action.kind === "adjudicate") {
      const verifyReceipt = dependencies.phaseRecovery?.verifyTerminalReceipt;
      if (typeof verifyReceipt !== "function")
        throw new HumanControlFault("phase-unverified");
      const receiptRequest = {
        input: action.phase,
        intent: phaseInput(action.phase).intent,
        challenge: randomBytes(32).toString("base64url"),
        receipt: {
          state: action.outcome,
          reservationRevision: action.expected.revision,
          terminalRevision: action.expected.revision + 1,
          receiptDigest: action.receiptDigest,
        },
      };
      const receiptProof = phaseCopy(
        await lifecycle.call((signal) =>
          verifyReceipt(phaseCopy(receiptRequest), signal),
        ),
      );
      receiptReceivedAt = lifecycle.now();
      if (
        receiptProof.kind !== "verified" ||
        !exactKeys(receiptProof, [
          "kind",
          "request",
          "verifierId",
          "immutableEvidenceId",
          "expiresAt",
        ]) ||
        !humanControlEqual(receiptProof.request, receiptRequest) ||
        !phaseText(receiptProof.verifierId) ||
        !phaseText(receiptProof.immutableEvidenceId)
      )
        throw new HumanControlFault("phase-unverified");
      receiptReceived = lifecycle.check();
      receiptExpiry = fresh(
        receiptProof.expiresAt,
        receiptReceivedAt,
        "human-unverified",
      );
      checkGrant(
        receiptExpiry,
        receiptReceived,
        receiptReceivedAt,
        "human-unverified",
      );
    }
    const resulting =
      action.kind === "adjudicate"
        ? action.outcome === "completed"
          ? action.phase.success
          : action.phase.failure
        : action.resulting;
    const original = {
      workItemId: input.workItemId,
      operationId,
      authority: { ...action.authority },
      expected: { ...action.expected },
      notAfter: new Date(
        Math.min(humanExpiry, policyExpiry, receiptExpiry),
      ).toISOString(),
      patch: { ...resulting },
    };
    mutationAttempted = true;
    const response = await lifecycle.call(() =>
      checkpoint(phaseCopy(original)),
    );
    const accepted = controlAcknowledgement(
      response,
      original,
      observed,
      lifecycle.now(),
    );
    if (!accepted) throw new HumanControlFault("mutation-unconfirmed");
    record = accepted;
    knownRevision = record.revision;
    if (action.kind === "adjudicate") {
      phaseResult = await lifecycle.call(() =>
        recoverDevSquadAdoPhase(action.phase, {
          ...dependencies.phaseRecovery!,
          timeoutMs: Math.max(1, Math.floor(lifecycle.check())),
          signal: lifecycle.controller.signal,
          utcNow,
          monotonicNow,
        }),
      );
      if (
        phaseResult.state !== action.outcome ||
        phaseResult.reason !== "recorded" ||
        phaseResult.receiptDigest !== action.receiptDigest
      )
        throw new HumanControlFault("phase-unverified");
    }
    return {
      state: "recorded",
      reason: "recorded",
      intent,
      knownRevision,
      snapshot: humanControlSnapshot(record),
      phase: phaseResult,
    };
  } catch (error) {
    return {
      state: mutationAttempted ? "pending" : "blocked",
      reason: failure(error),
      intent,
      knownRevision,
      snapshot: null,
      phase: null,
    };
  } finally {
    life?.close();
  }
}
