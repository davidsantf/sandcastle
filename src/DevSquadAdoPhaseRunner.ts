import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  defaultDevSquadSandcastleExecutionSeam,
  runDevSquadSandcastleExecution,
  validateDevSquadSandcastleExecutionRequest,
} from "./DevSquadSandcastleExecutionAdapter.js";
import {
  gateHash,
  reduceGateHistory,
} from "./DevSquadAdoDesignApprovalHistory.js";
import {
  inspectDesignGateRecord,
  isB32,
} from "./DevSquadAdoDesignApprovalValidation.js";
import { verifyGateTarget } from "./DevSquadAdoDesignApprovalTarget.js";
import { GateLifecycle } from "./DevSquadAdoDesignApprovalLifecycle.js";
import { PhaseLifecycle } from "./DevSquadAdoPhaseLifecycle.js";
import {
  PhaseFault,
  phaseAcknowledgement,
  phaseCopy,
  phaseEqual,
  phaseFields,
  phaseHistory,
  phaseInput,
  phaseOperation,
  phaseText,
  type PhaseHistory,
} from "./DevSquadAdoPhaseProtocol.js";
import type {
  DevSquadAdoPhaseReceiptVerificationRequest,
  DevSquadAdoPhaseDependencies,
  DevSquadAdoPhaseDesignRequest,
  DevSquadAdoPhaseInput,
  DevSquadAdoPhasePolicyRequest,
  DevSquadAdoPhaseRecoveryDependencies,
  DevSquadAdoPhaseResult,
  RunDevSquadAdoPhaseRequest,
} from "./DevSquadAdoPhaseTypes.js";
import type {
  CheckpointDevSquadAdoWorkflowInput,
  DevSquadAdoWorkflowRecord,
} from "./DevSquadAdoWorkflowLedger.js";

export type * from "./DevSquadAdoPhaseTypes.js";

const failure = (error: unknown): DevSquadAdoPhaseResult["reason"] =>
  error instanceof PhaseFault ? error.reason : "invalid-input";

function retained(
  history: PhaseHistory,
  intent: string,
  revision: number,
): DevSquadAdoPhaseResult {
  if (history.intent !== intent)
    return {
      state: "blocked",
      reason: "intent-conflict",
      intent,
      knownRevision: revision,
    };
  return {
    state: history.state,
    reason: history.state === "pending" ? "attempt-consumed" : "recorded",
    intent,
    knownRevision: revision,
    reservationRevision: history.reservationRevision,
    ...(history.terminalRevision === undefined
      ? {}
      : { terminalRevision: history.terminalRevision }),
    ...(history.receiptDigest === undefined
      ? {}
      : { receiptDigest: history.receiptDigest }),
  };
}

/** Read-only historical state, never a dispatch or current design authorization. */
export async function recoverDevSquadAdoPhase(
  request: DevSquadAdoPhaseInput,
  dependencies: DevSquadAdoPhaseRecoveryDependencies,
): Promise<DevSquadAdoPhaseResult> {
  let intent: string | null = null;
  let revision: number | null = null;
  let life: PhaseLifecycle | undefined;
  try {
    const n = phaseInput(request);
    intent = n.intent;
    const read = dependencies.ledger.readRecord.bind(dependencies.ledger);
    const timeout = dependencies.timeoutMs ?? 10000;
    if (
      !Number.isSafeInteger(timeout) ||
      timeout < 1 ||
      timeout > 300000 ||
      (dependencies.signal !== undefined &&
        !(dependencies.signal instanceof AbortSignal))
    )
      throw new PhaseFault("invalid-input");
    life = new PhaseLifecycle(
      timeout,
      dependencies.signal,
      dependencies.utcNow ?? Date.now,
      dependencies.monotonicNow ?? (() => performance.now()),
    );
    const result = phaseFields(await life.call(() => read(n.workItemId)), [
      "ok",
      "value",
    ]);
    if (!result.ok) throw new PhaseFault("ledger-unavailable");
    const record = inspectDesignGateRecord(result.value, n.workItemId);
    if (!record) throw new PhaseFault("history-conflict");
    revision = record.revision;
    const h = phaseHistory(record);
    life.check();
    const own = h.histories.get(n.input.occurrence);
    if (own) {
      if (own.state !== "pending")
        await verifyRetainedReceipt(
          own,
          n.input,
          n.intent,
          dependencies.verifyTerminalReceipt,
          life,
        );
      return retained(own, intent, revision);
    }
    return {
      state: h.pending ? "blocked" : "unreserved",
      reason: h.pending ? "other-attempt-pending" : "unreserved",
      intent,
      knownRevision: revision,
    };
  } catch (error) {
    return {
      state: "blocked",
      reason: failure(error),
      intent,
      knownRevision: revision,
    };
  } finally {
    life?.close();
  }
}

/**
 * One selected phase. A consumed reservation is deliberately not replayed,
 * including when a dependency settles after this bounded call has retired.
 */
export async function runDevSquadAdoPhase(
  request: RunDevSquadAdoPhaseRequest,
  dependencies: DevSquadAdoPhaseDependencies,
): Promise<DevSquadAdoPhaseResult> {
  let intent: string | null = null;
  let knownRevision: number | null = null;
  let reservationRevision: number | undefined;
  let reservationAttempted = false;
  let life: PhaseLifecycle | undefined;
  try {
    // Separate capability and signal without invoking a request accessor.
    const names = Reflect.ownKeys(request);
    const allowed = [
      "workItemId",
      "occurrence",
      "plugin",
      "expected",
      "success",
      "failure",
      "feedback",
      "phase",
      "authority",
      "signal",
      "timeoutMs",
    ];
    if (names.some((key) => typeof key !== "string" || !allowed.includes(key)))
      throw new PhaseFault("invalid-input");
    const root: Record<string, unknown> = {};
    for (const name of names) {
      const d = Object.getOwnPropertyDescriptor(request, name);
      if (!d || !("value" in d)) throw new PhaseFault("invalid-input");
      root[String(name)] = d.value;
    }
    const {
      authority: rawAuthority,
      signal: rawSignal,
      timeoutMs: rawTimeout,
      ...rawInput
    } = root;
    const n = phaseInput(rawInput);
    intent = n.intent;
    const input = n.input;
    const authority = phaseCopy(
      rawAuthority,
    ) as RunDevSquadAdoPhaseRequest["authority"];
    if (
      !authority ||
      !phaseText(authority.ownerId) ||
      !isB32(authority.claimToken) ||
      !Number.isSafeInteger(authority.fencingValue) ||
      authority.fencingValue < 1 ||
      Object.keys(authority).some(
        (key) => !["ownerId", "claimToken", "fencingValue"].includes(key),
      )
    )
      throw new PhaseFault("invalid-input");
    const timeout = rawTimeout === undefined ? 30000 : rawTimeout;
    if (
      typeof timeout !== "number" ||
      !Number.isSafeInteger(timeout) ||
      timeout < 1 ||
      timeout > 300000
    )
      throw new PhaseFault("invalid-input");
    if (rawSignal !== undefined && !(rawSignal instanceof AbortSignal))
      throw new PhaseFault("invalid-input");
    const monotonic = dependencies.monotonicNow ?? (() => performance.now());
    life = new PhaseLifecycle(
      input.phase.kind === "implement"
        ? Math.min(timeout, input.phase.execution.bounds!.timeoutMs!)
        : timeout,
      rawSignal,
      dependencies.utcNow ?? Date.now,
      monotonic,
    );
    const lifecycle = life;
    const readRecord = dependencies.ledger.readRecord.bind(dependencies.ledger);
    const checkpoint = dependencies.ledger.checkpoint.bind(dependencies.ledger);
    const authorize = dependencies.authorizePhase;
    const verifyDesign = dependencies.verifyDesignAuthorization;
    const verifyTarget = dependencies.verifyCurrentTarget;
    const prepare = dependencies.prepare;
    const execute =
      dependencies.execution?.execute ?? defaultDevSquadSandcastleExecutionSeam;
    const validate = dependencies.execution?.runValidationCommand;
    const sandcastle = dependencies.sandcastle;
    if (
      typeof authorize !== "function" ||
      (input.phase.kind === "prepare" && typeof prepare !== "function")
    )
      throw new PhaseFault("invalid-input");
    if (input.phase.kind === "implement") {
      if (
        !verifyDesign ||
        !verifyTarget ||
        !validate ||
        !validateDevSquadSandcastleExecutionRequest(
          { ...input.phase.execution, ...(sandcastle ? { sandcastle } : {}) },
          { execute, runValidationCommand: validate },
        ).ok ||
        (!dependencies.execution?.execute && !sandcastle)
      )
        throw new PhaseFault("invalid-input");
    }
    const capturedSandcastle =
      input.phase.kind === "implement" && sandcastle
        ? snapshotDevSquadSandcastleRunConfig(sandcastle)
        : undefined;
    const executionIdentity =
      input.phase.kind === "implement" && capturedSandcastle
        ? {
            mode: "sandcastle" as const,
            agent: capturedSandcastle.agent.name,
            sandbox: capturedSandcastle.sandbox.name,
            sandboxKind: capturedSandcastle.sandbox.tag,
          }
        : { mode: "supplied" as const };
    let historyVisits = 0;
    const read = async (): Promise<DevSquadAdoWorkflowRecord> => {
      const response = phaseFields(
        await lifecycle.call(() => readRecord(n.workItemId)),
        ["ok", "value"],
      );
      if (!response.ok) throw new PhaseFault("ledger-unavailable");
      const record = inspectDesignGateRecord(response.value, n.workItemId);
      if (!record) throw new PhaseFault("history-conflict");
      historyVisits += record.checkpoints.length;
      if (historyVisits > 500000) throw new PhaseFault("input-limit");
      lifecycle.check();
      knownRevision = record.revision;
      return record;
    };
    const assertAuthority = (record: DevSquadAdoWorkflowRecord) => {
      const claim = record.activeClaim;
      if (
        !claim ||
        claim.ownerId !== authority.ownerId ||
        claim.fencingValue !== authority.fencingValue ||
        record.fencingCounter !== authority.fencingValue
      )
        throw new PhaseFault("authority-rejected");
      lifecycle.setLease(claim.expiresAt);
    };
    let current = await read();
    const history = phaseHistory(current);
    const existing = history.histories.get(input.occurrence);
    if (existing) {
      if (existing.state !== "pending")
        await verifyRetainedReceipt(
          existing,
          input,
          n.intent,
          dependencies.verifyTerminalReceipt,
          lifecycle,
        );
      return retained(existing, n.intent, current.revision);
    }
    if (history.pending) throw new PhaseFault("other-attempt-pending");
    if (
      current.revision !== input.expected.revision ||
      current.phase !== input.expected.phase ||
      current.status !== input.expected.status
    )
      throw new PhaseFault("state-conflict");
    assertAuthority(current);
    const approved = () => {
      if (input.phase.kind !== "implement") return null;
      const reduced = reduceGateHistory(
        current,
        input.phase.approval.occurrence,
      );
      const gate = reduced.ok ? reduced.gate : null;
      if (
        !gate ||
        gate.action !== "approve-design" ||
        !gate.decision ||
        !gate.publication ||
        !gate.resolutionRevision ||
        gate.design !== input.phase.approval.design ||
        gate.target !==
          gateHash([
            "dg15.target.v1",
            n.workItemId,
            input.phase.approval.target,
          ])
      )
        throw new PhaseFault("design-unverified");
      return {
        occurrence: gate.occurrence,
        proposal: gate.proposal,
        manifest: gate.manifest,
        design: gate.design,
        target: gate.target,
        publication: gate.publication,
        decision: gate.decision,
        resolutionRevision: gate.resolutionRevision,
      };
    };
    approved();
    const same = async () => {
      const observed = await read();
      if (
        observed.revision !== current.revision ||
        JSON.stringify(observed) !== JSON.stringify(current)
      )
        throw new PhaseFault("state-conflict");
      assertAuthority(observed);
    };
    const expected = () => ({
      revision: current.revision,
      phase: current.phase,
      status: current.status,
    });
    const policy = async (
      action: DevSquadAdoPhasePolicyRequest["action"],
      operationId: string,
      patch: DevSquadAdoPhaseInput["success"],
    ) => {
      const q: DevSquadAdoPhasePolicyRequest = {
        action,
        input,
        intent: n.intent,
        operationId,
        expected: expected(),
        patch,
        ownerId: authority.ownerId,
        fencingValue: authority.fencingValue,
      };
      const response = phaseCopy(
        await lifecycle.call((signal) => authorize(phaseCopy(q), signal)),
      );
      const received = lifecycle.check();
      const utc = lifecycle.now();
      if (response.kind !== "granted" || !phaseEqual(response.request, q))
        throw new PhaseFault("policy-denied");
      const expiry = freshExpiry(response.expiresAt, utc, "policy-denied");
      return (acceptedAt?: string) => {
        const elapsed = received - lifecycle.check();
        if (
          lifecycle.now() >= expiry ||
          utc + elapsed >= expiry ||
          (acceptedAt !== undefined && Date.parse(acceptedAt) >= expiry)
        )
          throw new PhaseFault("policy-denied");
      };
    };
    const reservePatch = { phase: current.phase, status: current.status };
    const reserveId = phaseOperation(
      input,
      n.intent,
      "r",
      expected(),
      reservePatch,
      null,
    );
    const checkpointPhase = async (
      action: "reserve" | "complete" | "fail",
      operationId: string,
      patch: DevSquadAdoPhaseInput["success"],
    ) => {
      const checkGrant = await policy(action, operationId, patch);
      await same();
      checkGrant();
      const original: CheckpointDevSquadAdoWorkflowInput = {
        workItemId: n.workItemId,
        operationId,
        authority: { ...authority },
        expected: expected(),
        patch: { ...patch },
      };
      if (action === "reserve") reservationAttempted = true;
      let response: unknown;
      try {
        response = await lifecycle.call(() => checkpoint(phaseCopy(original)));
      } catch (error) {
        if (
          error instanceof PhaseFault &&
          (error.reason === "deadline" || error.reason === "cancelled")
        )
          throw error;
        throw new PhaseFault(
          action === "reserve"
            ? "reservation-unconfirmed"
            : "completion-unconfirmed",
        );
      }
      const accepted = phaseAcknowledgement(
        response,
        original,
        current,
        lifecycle.now(),
      );
      lifecycle.check();
      if (!accepted)
        throw new PhaseFault(
          action === "reserve"
            ? "reservation-unconfirmed"
            : "completion-unconfirmed",
        );
      current = accepted;
      knownRevision = accepted.revision;
      if (action === "reserve") reservationRevision = accepted.revision;
      checkGrant(accepted.updatedAt);
    };
    await checkpointPhase("reserve", reserveId, reservePatch);
    const dispatchGuard = async () => {
      const checkGrant = await policy("dispatch", reserveId, reservePatch);
      let checkDesign = () => {};
      let checkTarget = () => {};
      if (input.phase.kind === "implement") {
        const gate = approved()!;
        const q: DevSquadAdoPhaseDesignRequest = {
          input,
          intent: n.intent,
          challenge: randomBytes(32).toString("base64url"),
          execution: executionIdentity,
          gate,
        };
        const proof = phaseCopy(
          await lifecycle.call((signal) => verifyDesign!(phaseCopy(q), signal)),
        );
        const received = lifecycle.check();
        const utc = lifecycle.now();
        if (
          proof.kind !== "verified" ||
          !phaseEqual(proof.request, q) ||
          !phaseText(proof.verifierId) ||
          !phaseText(proof.immutableEvidenceId)
        )
          throw new PhaseFault("design-unverified");
        const expires = freshExpiry(proof.expiresAt, utc, "design-unverified");
        checkDesign = () => {
          const elapsed = received - lifecycle.check();
          if (lifecycle.now() >= expires || utc + elapsed >= expires)
            throw new PhaseFault("design-unverified");
        };
        const targetLife = new GateLifecycle(
          lifecycle.controller.signal,
          monotonic,
        );
        const target = await lifecycle.call(() =>
          verifyGateTarget(
            {
              durableState: "approved",
              verificationStatus: "evidence-unavailable",
              reason: "publication-evidence-unavailable",
              targetHandoff: "not-requested",
              knownRevision: current.revision,
              binding: {
                workItemId: n.workItemId,
                occurrence: gate.occurrence,
                design: gate.design,
                proposal: gate.proposal,
                manifest: gate.manifest,
                target: gate.target,
              },
            },
            {
              challenge: randomBytes(32).toString("base64url"),
              original:
                input.phase.kind === "implement"
                  ? input.phase.approval.target
                  : ["none"],
            },
            async (q, signal) => {
              const result = phaseCopy(await verifyTarget!(q, signal));
              if (result.kind === "verified") {
                const utc = lifecycle.now();
                const remaining = lifecycle.check();
                const observed = Date.parse(result.observedAt);
                checkTarget = () => {
                  const elapsed = remaining - lifecycle.check();
                  if (
                    lifecycle.now() - observed > 5000 ||
                    utc - observed + elapsed > 5000
                  )
                    throw new PhaseFault("target-unverified");
                };
              }
              return result;
            },
            targetLife,
            () => lifecycle.now(),
          ),
        );
        if (target.targetHandoff !== "verified-current")
          throw new PhaseFault("target-unverified");
      }
      await same();
      checkGrant();
      checkDesign();
      checkTarget();
      lifecycle.check();
    };
    let resultKind: "completed" | "failed";
    let receipt: string;
    if (input.phase.kind === "prepare") {
      await dispatchGuard();
      const result = phaseCopy(
        await lifecycle.call((signal) =>
          prepare!(
            {
              input: phaseCopy(input),
              intent: n.intent,
              reservationRevision: reservationRevision!,
            },
            signal,
          ),
        ),
      );
      if (
        !result ||
        !["completed", "failed"].includes(result.kind) ||
        !isB32(result.artifactDigest) ||
        Object.keys(result).some(
          (key) => !["kind", "artifactDigest"].includes(key),
        )
      )
        throw new PhaseFault("dependency-failed");
      resultKind = result.kind;
      receipt = gateHash([
        "dp16.receipt.v1",
        n.workItemId,
        input.occurrence,
        n.intent,
        result.kind,
        result.artifactDigest,
      ]);
    } else {
      const selected = input.phase;
      const seamRequest = () => ({
        ...phaseCopy(selected.execution),
        ...(capturedSandcastle ? { sandcastle: capturedSandcastle } : {}),
        signal: lifecycle.controller.signal,
      });
      let executionEntered = false;
      let commandIndex = 0;
      let adapterFault: PhaseFault | undefined;
      const adapter = await runDevSquadSandcastleExecution(
        {
          ...phaseCopy(selected.execution),
          ...(capturedSandcastle ? { sandcastle: capturedSandcastle } : {}),
          signal: lifecycle.controller.signal,
        },
        {
          execute: async (seam) => {
            try {
              if (executionEntered) throw new PhaseFault("attempt-consumed");
              executionEntered = true;
              await dispatchGuard();
              const raw = phaseFields(
                await lifecycle.call(() =>
                  execute({
                    request: seamRequest(),
                    prompt: seam.prompt,
                  }),
                ),
                ["branch", "commits"],
              );
              // Do not accept or copy logs/session metadata into core evidence.
              const commits = raw.commits ?? [];
              if (!Array.isArray(commits) || commits.length > 256)
                throw new PhaseFault("dependency-failed");
              const projected = Array.from(
                { length: commits.length },
                (_, i) => {
                  const d = Object.getOwnPropertyDescriptor(commits, String(i));
                  if (!d || !("value" in d))
                    throw new PhaseFault("dependency-failed");
                  return phaseFields(d.value, ["sha"]);
                },
              );
              const output = phaseCopy({
                branch: raw.branch,
                commits: projected,
              });
              if (
                output.branch !== selected.execution.branch.sourceBranch ||
                output.commits.some(
                  (commit) =>
                    typeof commit.sha !== "string" ||
                    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit.sha),
                )
              )
                throw new PhaseFault("dependency-failed");
              return {
                branch: selected.execution.branch.sourceBranch,
                commits: output.commits.map((commit) => ({
                  sha: String(commit.sha),
                })),
              };
            } catch (error) {
              adapterFault =
                error instanceof PhaseFault
                  ? error
                  : new PhaseFault("dependency-failed");
              throw adapterFault;
            }
          },
          runValidationCommand: async (seam) => {
            try {
              if (adapterFault) throw adapterFault;
              const original =
                selected.execution.validationCommands[commandIndex++];
              if (!original || !phaseEqual(seam.command, original))
                throw new PhaseFault("dependency-failed");
              await dispatchGuard();
              const result = phaseCopy(
                phaseFields(
                  await lifecycle.call(() =>
                    validate!({
                      command: phaseCopy(original),
                      request: seamRequest(),
                      execution: phaseCopy(seam.execution),
                    }),
                  ),
                  ["exitCode", "status"],
                ),
              );
              if (
                typeof result.exitCode !== "number" ||
                !Number.isSafeInteger(result.exitCode) ||
                result.exitCode < 0 ||
                result.exitCode > 255 ||
                (result.status !== undefined &&
                  result.status !== "passed" &&
                  result.status !== "failed") ||
                (result.status === "passed" && result.exitCode !== 0)
              )
                throw new PhaseFault("dependency-failed");
              return {
                exitCode: result.exitCode,
                ...(result.status === undefined
                  ? {}
                  : { status: result.status }),
              };
            } catch (error) {
              adapterFault =
                error instanceof PhaseFault
                  ? error
                  : new PhaseFault("dependency-failed");
              throw adapterFault;
            }
          },
        },
      );
      if (adapterFault) throw adapterFault;
      lifecycle.check();
      if (
        !executionEntered ||
        commandIndex !== selected.execution.validationCommands.length ||
        !["completed", "validation-failed"].includes(adapter.status)
      )
        throw new PhaseFault("dependency-failed");
      resultKind = adapter.status === "completed" ? "completed" : "failed";
      receipt = gateHash([
        "dp16.receipt.v1",
        n.workItemId,
        input.occurrence,
        n.intent,
        resultKind,
        adapter.branch,
        adapter.commits.map((c) => c.sha),
        adapter.validation.commands.map((c) => [c.label, c.status, c.exitCode]),
      ]);
    }
    lifecycle.check();
    const patch = resultKind === "completed" ? input.success : input.failure;
    const terminalId = phaseOperation(
      input,
      n.intent,
      resultKind === "completed" ? "c" : "f",
      expected(),
      patch,
      receipt,
    );
    await checkpointPhase(
      resultKind === "completed" ? "complete" : "fail",
      terminalId,
      patch,
    );
    return {
      state: resultKind,
      reason: "recorded",
      intent: n.intent,
      knownRevision: current.revision,
      reservationRevision: reservationRevision!,
      terminalRevision: current.revision,
      receiptDigest: receipt,
    };
  } catch (error) {
    return {
      state: reservationAttempted ? "pending" : "blocked",
      reason: failure(error),
      intent,
      knownRevision,
      ...(reservationRevision === undefined ? {} : { reservationRevision }),
    };
  } finally {
    life?.close();
  }
}

function freshExpiry(
  value: string,
  now: number,
  reason: "policy-denied" | "design-unverified" | "receipt-unverified",
) {
  const expires = Date.parse(value);
  if (
    !Number.isFinite(expires) ||
    new Date(expires).toISOString() !== value ||
    expires <= now ||
    expires - now > 5000
  )
    throw new PhaseFault(reason);
  return expires;
}

async function verifyRetainedReceipt(
  history: PhaseHistory,
  input: DevSquadAdoPhaseInput,
  intent: string,
  verify: DevSquadAdoPhaseDependencies["verifyTerminalReceipt"],
  lifecycle: PhaseLifecycle,
) {
  if (
    history.state === "pending" ||
    history.terminalRevision === undefined ||
    history.receiptDigest === undefined ||
    typeof verify !== "function"
  )
    throw new PhaseFault("receipt-unverified");
  const request: DevSquadAdoPhaseReceiptVerificationRequest = {
    input,
    intent,
    challenge: randomBytes(32).toString("base64url"),
    receipt: {
      state: history.state,
      reservationRevision: history.reservationRevision,
      terminalRevision: history.terminalRevision,
      receiptDigest: history.receiptDigest,
    },
  };
  const response = phaseCopy(
    await lifecycle.call((signal) => verify(phaseCopy(request), signal)),
  );
  const now = lifecycle.now();
  if (
    response.kind !== "verified" ||
    !phaseEqual(response.request, request) ||
    !phaseText(response.verifierId) ||
    !phaseText(response.immutableEvidenceId)
  )
    throw new PhaseFault("receipt-unverified");
  freshExpiry(response.expiresAt, now, "receipt-unverified");
}

export function snapshotDevSquadSandcastleRunConfig(
  value: NonNullable<DevSquadAdoPhaseDependencies["sandcastle"]>,
): NonNullable<DevSquadAdoPhaseDependencies["sandcastle"]> {
  const agent = value.agent;
  const sandbox = value.sandbox;
  if (
    !agent ||
    !sandbox ||
    !phaseText(agent.name) ||
    !phaseText(sandbox.name) ||
    !["bind-mount", "isolated", "none"].includes(sandbox.tag)
  )
    throw new PhaseFault("invalid-input");

  const session = agent.sessionStorage;
  const capturedSession = session
    ? {
        captureToHost: session.captureToHost,
        resumeIntoSandbox: session.resumeIntoSandbox,
        readHostSession: session.readHostSession,
        existsOnHost: session.existsOnHost,
        hostSessionFilePath: session.hostSessionFilePath,
        findByIdOnHost: session.findByIdOnHost,
      }
    : undefined;
  const capturedAgent = {
    name: agent.name,
    env: Object.freeze({ ...phaseCopy(agent.env) }),
    captureSessions: agent.captureSessions,
    ...(capturedSession
      ? { sessionStorage: Object.freeze(capturedSession) }
      : {}),
    buildPrintCommand: agent.buildPrintCommand,
    ...(agent.buildInteractiveArgs
      ? { buildInteractiveArgs: agent.buildInteractiveArgs }
      : {}),
    parseStreamLine: agent.parseStreamLine,
    ...(agent.parseSessionUsage
      ? { parseSessionUsage: agent.parseSessionUsage }
      : {}),
  };
  const capturedSandbox = Object.freeze({
    tag: sandbox.tag,
    name: sandbox.name,
    env: Object.freeze({ ...phaseCopy(sandbox.env) }),
    ...("sandboxHomedir" in sandbox
      ? { sandboxHomedir: sandbox.sandboxHomedir }
      : {}),
    create: sandbox.create,
  }) as typeof sandbox;

  return Object.freeze({
    agent: Object.freeze(capturedAgent),
    sandbox: capturedSandbox,
    ...(value.name === undefined ? {} : { name: value.name }),
    ...(value.logging === undefined
      ? {}
      : { logging: Object.freeze({ ...value.logging }) }),
    ...(value.completionSignal === undefined
      ? {}
      : {
          completionSignal:
            typeof value.completionSignal === "string"
              ? value.completionSignal
              : Object.freeze([...value.completionSignal]),
        }),
    ...(value.copyToWorktree === undefined
      ? {}
      : { copyToWorktree: Object.freeze([...value.copyToWorktree]) }),
    ...(value.branchStrategy === undefined
      ? {}
      : { branchStrategy: Object.freeze({ ...value.branchStrategy }) }),
    ...(value.timeouts === undefined
      ? {}
      : { timeouts: Object.freeze({ ...value.timeouts }) }),
  });
}
