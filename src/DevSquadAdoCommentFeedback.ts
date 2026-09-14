import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  recoverDevSquadAdoPhase,
  runDevSquadAdoPhase,
  snapshotDevSquadSandcastleRunConfig,
} from "./DevSquadAdoPhaseRunner.js";
import { PhaseLifecycle } from "./DevSquadAdoPhaseLifecycle.js";
import {
  buildCommentFeedbackPhase,
  CommentFeedbackFault,
  commentFeedbackEqual,
  commentFeedbackInput,
  commentFeedbackRecoveryInput,
  verifyCommentFeedbackSource,
} from "./DevSquadAdoCommentFeedbackProtocol.js";
import {
  PhaseFault,
  phaseCopy,
  phaseText,
} from "./DevSquadAdoPhaseProtocol.js";
import type {
  DevSquadAdoCommentFeedbackDependencies,
  DevSquadAdoCommentFeedbackRecoveryDependencies,
  DevSquadAdoCommentFeedbackRecoveryRequest,
  DevSquadAdoCommentFeedbackResult,
  DevSquadAdoCommentFeedbackRouteAuthorizationRequest,
  RunDevSquadAdoCommentFeedbackRequest,
} from "./DevSquadAdoCommentFeedbackTypes.js";
import type { DevSquadAdoPhaseDependencies } from "./DevSquadAdoPhaseTypes.js";

export type * from "./DevSquadAdoCommentFeedbackTypes.js";

function failure(error: unknown): DevSquadAdoCommentFeedbackResult["reason"] {
  if (error instanceof CommentFeedbackFault) return error.reason;
  if (error instanceof PhaseFault) {
    if (
      error.reason === "deadline" ||
      error.reason === "cancelled" ||
      error.reason === "call-limit" ||
      error.reason === "input-limit" ||
      error.reason === "invalid-input"
    )
      return error.reason;
    return "dependency-failed";
  }
  return "invalid-input";
}

function timeout(value: unknown, fallback: number) {
  const result = value ?? fallback;
  if (
    typeof result !== "number" ||
    !Number.isSafeInteger(result) ||
    result < 1 ||
    result > 300000
  )
    throw new CommentFeedbackFault("invalid-input");
  return result;
}

function expiry(value: unknown, now: number) {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  if (
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString() !== value ||
    parsed <= now ||
    parsed - now > 5000
  )
    throw new CommentFeedbackFault("route-denied");
  return parsed;
}

function linkSignals(...signals: Array<AbortSignal | undefined>) {
  const controller = new AbortController();
  const active = signals.filter(
    (signal): signal is AbortSignal => signal !== undefined,
  );
  const abort = () => controller.abort();
  for (const signal of active) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", abort, { once: true });
  }
  return {
    signal: controller.signal,
    close: () => {
      for (const signal of active) signal.removeEventListener("abort", abort);
    },
  };
}

/**
 * Normalize host-observed evidence, require an exact host route grant, then
 * delegate one selected occurrence to slice 16. Comment content is never a grant.
 */
export async function runDevSquadAdoCommentFeedback(
  request: RunDevSquadAdoCommentFeedbackRequest,
  dependencies: DevSquadAdoCommentFeedbackDependencies,
): Promise<DevSquadAdoCommentFeedbackResult> {
  let binding: DevSquadAdoCommentFeedbackResult["binding"] = null;
  let life: PhaseLifecycle | undefined;
  try {
    const input = commentFeedbackInput(request);
    const overallTimeout = timeout(input.timeoutMs, 30000);
    if (input.signal !== undefined && !(input.signal instanceof AbortSignal))
      throw new CommentFeedbackFault("invalid-input");
    const normalize = dependencies.normalizeFeedback;
    const authorize = dependencies.authorizeRoute;
    const phase = capturePhaseDependencies(dependencies.phase);
    const utcNow = dependencies.utcNow ?? phase.utcNow ?? Date.now;
    const monotonicNow =
      dependencies.monotonicNow ??
      phase.monotonicNow ??
      (() => performance.now());
    life = new PhaseLifecycle(
      overallTimeout,
      input.signal as AbortSignal | undefined,
      utcNow,
      monotonicNow,
    );
    const lifecycle = life;
    if (
      typeof normalize !== "function" ||
      typeof authorize !== "function" ||
      !phase
    )
      throw new CommentFeedbackFault("invalid-input");

    const source = await lifecycle.call(() =>
      recoverDevSquadAdoPhase(input.source.input, {
        ledger: phase.ledger,
        verifyTerminalReceipt: phase.verifyTerminalReceipt,
        timeoutMs: Math.max(1, Math.floor(lifecycle.check())),
        signal: lifecycle.controller.signal,
        utcNow,
        monotonicNow,
      }),
    );
    verifyCommentFeedbackSource(
      input.source,
      source,
      input.selection.expected.revision,
    );

    const normalizationRequest = phaseCopy(input.normalization);
    let normalized: Awaited<ReturnType<typeof normalize>>;
    try {
      normalized = phaseCopy(
        await lifecycle.call((signal) =>
          normalize(phaseCopy(normalizationRequest), signal),
        ),
      );
    } catch (error) {
      if (
        error instanceof PhaseFault &&
        error.reason !== "deadline" &&
        error.reason !== "cancelled"
      )
        throw new CommentFeedbackFault("normalization-rejected");
      throw error;
    }
    if (
      !normalized ||
      typeof normalized !== "object" ||
      normalized.kind !== "normalized" ||
      !exactKeys(normalized, [
        "kind",
        "request",
        "content",
        "normalizerId",
        "immutableEvidenceId",
      ]) ||
      !commentFeedbackEqual(normalized.request, normalizationRequest) ||
      !phaseText(normalized.normalizerId) ||
      !phaseText(normalized.immutableEvidenceId)
    )
      throw new CommentFeedbackFault("normalization-rejected");
    const prepared = buildCommentFeedbackPhase(
      input.workItemId,
      input.source,
      input.selection,
      input.evidenceDigest,
      normalized.content,
      normalized.normalizerId,
      normalized.immutableEvidenceId,
    );
    binding = prepared.binding;
    const routeRequest: DevSquadAdoCommentFeedbackRouteAuthorizationRequest = {
      workItemId: input.workItemId,
      source: input.source,
      evidenceDigest: input.evidenceDigest,
      normalizerId: normalized.normalizerId,
      normalizedEvidenceId: normalized.immutableEvidenceId,
      normalizedDigest: prepared.normalizedDigest,
      normalizedContent: normalized.content,
      selectedPhase: prepared.selectedPhase,
      challenge: randomBytes(32).toString("base64url"),
      ownerId: input.selection.authority.ownerId,
      fencingValue: input.selection.authority.fencingValue,
    };
    let granted: Awaited<ReturnType<typeof authorize>>;
    try {
      granted = phaseCopy(
        await lifecycle.call((signal) =>
          authorize(phaseCopy(routeRequest), signal),
        ),
      );
    } catch (error) {
      if (
        error instanceof PhaseFault &&
        error.reason !== "deadline" &&
        error.reason !== "cancelled"
      )
        throw new CommentFeedbackFault("route-denied");
      throw error;
    }
    const receivedRemaining = lifecycle.check();
    const receivedUtc = lifecycle.now();
    if (
      !granted ||
      typeof granted !== "object" ||
      granted.kind !== "granted" ||
      !exactKeys(granted, ["kind", "request", "expiresAt"]) ||
      !commentFeedbackEqual(granted.request, routeRequest)
    )
      throw new CommentFeedbackFault("route-denied");
    const expiresAt = expiry(granted.expiresAt, receivedUtc);
    const checkRoute = () => {
      const elapsed = receivedRemaining - lifecycle.check();
      if (lifecycle.now() >= expiresAt || receivedUtc + elapsed >= expiresAt)
        throw new CommentFeedbackFault("route-denied");
    };
    checkRoute();

    const authorizePhase = phase.authorizePhase;
    const phaseWithRouteGrant: DevSquadAdoPhaseDependencies = {
      ...phase,
      authorizePhase: async (phaseRequest, signal) => {
        if (phaseRequest.action !== "reserve")
          return authorizePhase(phaseRequest, signal);
        if (phaseRequest.action === "reserve")
          try {
            checkRoute();
          } catch {
            return { kind: "denied" };
          }
        let result: Awaited<ReturnType<typeof authorizePhase>>;
        try {
          result = phaseCopy(await authorizePhase(phaseRequest, signal));
          checkRoute();
        } catch {
          return { kind: "denied" };
        }
        if (result.kind !== "granted") return result;
        const phaseExpiry = Date.parse(result.expiresAt);
        if (
          !Number.isFinite(phaseExpiry) ||
          new Date(phaseExpiry).toISOString() !== result.expiresAt
        )
          return result;
        return {
          ...result,
          expiresAt: new Date(Math.min(phaseExpiry, expiresAt)).toISOString(),
        };
      },
      utcNow,
      monotonicNow,
    };

    const selectedTimeout = timeout(input.selection.timeoutMs, overallTimeout);
    const phaseSignal = linkSignals(
      input.signal as AbortSignal | undefined,
      lifecycle.controller.signal,
    );
    let phaseResult;
    try {
      phaseResult = await runDevSquadAdoPhase(
        {
          ...prepared.selectedPhase,
          authority: input.selection.authority,
          timeoutMs: Math.max(
            1,
            Math.floor(Math.min(selectedTimeout, lifecycle.check())),
          ),
          signal: phaseSignal.signal,
        },
        phaseWithRouteGrant,
      );
    } finally {
      phaseSignal.close();
    }
    return {
      state: "delegated",
      reason: "delegated",
      binding,
      phase: phaseResult,
    };
  } catch (error) {
    return {
      state: "blocked",
      reason: failure(error),
      binding,
      phase: null,
    };
  } finally {
    life?.close();
  }

  function capturePhaseDependencies(
    value: DevSquadAdoPhaseDependencies,
  ): DevSquadAdoPhaseDependencies {
    if (!value?.ledger) throw new CommentFeedbackFault("invalid-input");
    const ledger = value.ledger;
    return {
      ledger: {
        readRecord: ledger.readRecord.bind(ledger),
        checkpoint: ledger.checkpoint.bind(ledger),
      },
      authorizePhase: value.authorizePhase,
      verifyDesignAuthorization: value.verifyDesignAuthorization,
      verifyCurrentTarget: value.verifyCurrentTarget,
      verifyTerminalReceipt: value.verifyTerminalReceipt,
      prepare: value.prepare,
      execution:
        value.execution === undefined
          ? undefined
          : {
              execute: value.execution.execute,
              runValidationCommand: value.execution.runValidationCommand,
            },
      ...(value.sandcastle === undefined
        ? {}
        : {
            sandcastle: snapshotDevSquadSandcastleRunConfig(value.sandcastle),
          }),
      utcNow: value.utcNow,
      monotonicNow: value.monotonicNow,
    };
  }
}

/** Read-only source/selection correlation. It never normalizes or routes again. */
export async function recoverDevSquadAdoCommentFeedback(
  request: DevSquadAdoCommentFeedbackRecoveryRequest,
  dependencies: DevSquadAdoCommentFeedbackRecoveryDependencies,
): Promise<DevSquadAdoCommentFeedbackResult> {
  let binding: DevSquadAdoCommentFeedbackResult["binding"] = null;
  let life: PhaseLifecycle | undefined;
  try {
    const input = commentFeedbackRecoveryInput(request);
    binding = input.binding;
    const timeoutMs = timeout(input.timeoutMs, 10000);
    if (input.signal !== undefined && !(input.signal instanceof AbortSignal))
      throw new CommentFeedbackFault("invalid-input");
    const phase = captureRecoveryDependencies(dependencies.phase);
    const verifySource =
      dependencies.verifySourceReceipt ?? phase.verifyTerminalReceipt;
    const utcNow = dependencies.utcNow ?? phase.utcNow ?? Date.now;
    const monotonicNow =
      dependencies.monotonicNow ??
      phase.monotonicNow ??
      (() => performance.now());
    life = new PhaseLifecycle(
      timeoutMs,
      input.signal as AbortSignal | undefined,
      utcNow,
      monotonicNow,
    );
    const lifecycle = life;
    const sourceResult = await lifecycle.call(() =>
      recoverDevSquadAdoPhase(input.source.input, {
        ledger: phase.ledger,
        verifyTerminalReceipt: verifySource,
        timeoutMs: Math.max(1, Math.floor(lifecycle.check())),
        signal: lifecycle.controller.signal,
        utcNow,
        monotonicNow,
      }),
    );
    verifyCommentFeedbackSource(
      input.source,
      sourceResult,
      input.selectedPhase.expected.revision,
    );
    const selectedResult = await lifecycle.call(() =>
      recoverDevSquadAdoPhase(input.selectedPhase, {
        ledger: phase.ledger,
        verifyTerminalReceipt: phase.verifyTerminalReceipt,
        timeoutMs: Math.max(1, Math.floor(lifecycle.check())),
        signal: lifecycle.controller.signal,
        utcNow,
        monotonicNow,
      }),
    );
    return {
      state: "delegated",
      reason: "delegated",
      binding,
      phase: selectedResult,
    };
  } catch (error) {
    return {
      state: "blocked",
      reason: failure(error),
      binding,
      phase: null,
    };
  } finally {
    life?.close();
  }

  function captureRecoveryDependencies(
    value: DevSquadAdoCommentFeedbackRecoveryDependencies["phase"],
  ): DevSquadAdoCommentFeedbackRecoveryDependencies["phase"] {
    if (!value?.ledger) throw new CommentFeedbackFault("invalid-input");
    return {
      ledger: {
        readRecord: value.ledger.readRecord.bind(value.ledger),
      },
      verifyTerminalReceipt: value.verifyTerminalReceipt,
      utcNow: value.utcNow,
      monotonicNow: value.monotonicNow,
    };
  }
}

function exactKeys(value: object, expected: readonly string[]) {
  const actual = Object.keys(value);
  return (
    actual.length === expected.length &&
    expected.every((key) => actual.includes(key))
  );
}
