import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  digest,
  workerReceiptSchema,
  type OrchestrationWorkerReceipt,
  type OrchestrationWorkerRequest,
} from "./MultiProjectProtocol.js";
import type { WorkspaceStore } from "./OrchestrationWorkspaceContract.js";

export interface NativeReviewValidation {
  state: string;
  evaluatedScope: number;
  checks: unknown[];
  diagnostic?: string;
}

export interface NativeReviewResult {
  state: "clean" | "failed" | "unknown" | "exhausted";
  revision: string;
  findings: string[];
  evidence: string;
  /** Implementation attempts, including the implementation supplied by the caller. */
  attempts: number;
}

export interface NativeReviewStage {
  stage: "reviewing" | "implementing" | "blocked";
  revision: string;
  attempt: number;
  findings: string[];
  reason?: string;
}

export interface NativeReviewLoopOptions {
  store: Pick<WorkspaceStore, "read" | "compareAndSwap">;
  namespace: string;
  /** Stable host run identity, not a proposal/configuration revision. */
  runKey: string;
  proposalId: string;
  proposalDigest: string;
  sourceRevision: string;
  configurationRevision: number;
  request: OrchestrationWorkerRequest;
  revision: string;
  /** Includes the already performed initial implementation; defaults to ten. */
  maxIterations?: number;
  timeoutMs: number;
  signal: AbortSignal;
  execute: (
    request: OrchestrationWorkerRequest,
    signal: AbortSignal,
  ) => Promise<OrchestrationWorkerReceipt>;
  resolveRevision: (signal: AbortSignal) => Promise<string>;
  validate: (
    revision: string,
    signal: AbortSignal,
  ) => Promise<NativeReviewValidation | null>;
  assertCurrent: () => Promise<void>;
  onStage?: (event: NativeReviewStage) => Promise<void>;
}

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const commit = z.string().regex(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/);
const bindingSchema = z.strictObject({
  namespace: z.string().min(1),
  runKey: z.string().min(1),
  proposalId: z.string().min(1),
  proposalDigest: z.string().min(1),
  sourceRevision: z.string().min(1),
  configurationRevision: z.number().int().positive(),
  originalRequestDigest: hash,
  taskDigest: hash,
  approvedArtifactsDigest: hash,
});
const recordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  trust: z.literal("trusted-local"),
  backendAttested: z.literal(false),
  binding: bindingSchema,
  bindingDigest: hash,
  initialRevision: commit,
  revision: commit,
  maxIterations: z.number().int().min(1).max(100),
  attempts: z.number().int().min(1).max(100),
  deadline: z.number().int().positive(),
  state: z.enum(["running", "clean", "failed", "unknown", "exhausted"]),
  findings: z.array(z.string()),
  evidence: z.string(),
  history: z
    .array(
      z.strictObject({
        stage: z.enum(["review", "fix"]),
        attempt: z.number().int().min(1).max(100),
        revision: commit,
        bindingDigest: hash,
        invocation: z.string().min(1),
        intent: hash,
        requestDigest: hash,
        state: z.enum(["reserved", "completed", "failed", "unknown"]),
        receipt: workerReceiptSchema.optional(),
        resultingRevision: commit.optional(),
        validationDigest: hash.optional(),
      }),
    )
    .max(199),
  notifications: z.array(hash).max(301),
  blockedNotified: z.boolean(),
});

export type NativeReviewRecord = z.infer<typeof recordSchema>;

export const nativeReviewKey = (namespace: string, runKey: string): string =>
  `native-local-review/${digest([namespace, runKey])}`;

/**
 * Host-only trusted-local review, not independent-backend attestation or acceptance.
 * The supplied executor must route review/fix to the named DevSquad worker.
 * Reservations are deliberately non-replayable, even after an interrupted callback.
 */
export async function runNativeReviewLoop(
  options: NativeReviewLoopOptions,
): Promise<NativeReviewResult> {
  const maxIterations = z
    .number()
    .int()
    .min(1)
    .max(100)
    .parse(options.maxIterations === undefined ? 10 : options.maxIterations);
  z.number().int().positive().max(3_600_000).parse(options.timeoutMs);
  commit.parse(options.revision);
  const original = structuredClone(options.request);
  if (original.stage !== "implement" || !original.artifacts.plan?.trim())
    throw new Error(
      "Native review requires the original approved implementation plan",
    );
  const binding = bindingSchema.parse({
    namespace: options.namespace,
    runKey: options.runKey,
    proposalId: options.proposalId,
    proposalDigest: options.proposalDigest,
    sourceRevision: options.sourceRevision,
    configurationRevision: options.configurationRevision,
    originalRequestDigest: digest(original),
    taskDigest: digest(original.task),
    approvedArtifactsDigest: digest(original.artifacts),
  });
  const bindingDigest = digest(binding);
  const key = nativeReviewKey(options.namespace, options.runKey);
  const snapshot = options.store.read(key);
  let version = snapshot.version;
  let record: NativeReviewRecord =
    snapshot.value == null
      ? {
          schemaVersion: 1,
          trust: "trusted-local",
          backendAttested: false,
          binding,
          bindingDigest,
          initialRevision: options.revision,
          revision: options.revision,
          maxIterations,
          attempts: 1,
          deadline: Date.now() + options.timeoutMs,
          state: "running",
          findings: [],
          evidence:
            "Initial implementation supplied by host; validation pending",
          history: [],
          notifications: [],
          blockedNotified: false,
        }
      : recordSchema.parse(snapshot.value);
  const write = () => {
    if (
      !options.store.compareAndSwap(key, version, structuredClone(record), {
        kind: "native-local-review",
        at: new Date().toISOString(),
      })
    )
      throw new Error("Native review reservation/result conflict");
    version++;
  };
  const result = (): NativeReviewResult => ({
    state: record.state === "running" ? "unknown" : record.state,
    revision: record.revision,
    findings: [...record.findings],
    evidence: record.evidence,
    attempts: record.attempts,
  });
  const remaining = Math.min(
    options.timeoutMs,
    Math.max(0, record.deadline - Date.now()),
  );
  const signal = AbortSignal.any([
    options.signal,
    AbortSignal.timeout(remaining),
  ]);
  const wait = async <T>(promise: Promise<T>): Promise<T> => {
    if (signal.aborted) {
      void promise.catch(() => {});
      throw new Error("Native review canceled or deadline exhausted");
    }
    let aborted: (() => void) | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          aborted = () =>
            reject(new Error("Native review canceled or deadline exhausted"));
          signal.addEventListener("abort", aborted, { once: true });
        }),
      ]);
    } finally {
      if (aborted) signal.removeEventListener("abort", aborted);
    }
  };
  const current = async () => {
    if (signal.aborted || Date.now() >= record.deadline)
      throw new Error("Native review canceled or deadline exhausted");
    await wait(options.assertCurrent());
    if (signal.aborted || Date.now() >= record.deadline)
      throw new Error("Native review canceled or deadline exhausted");
  };
  const notify = async (stage: NativeReviewStage["stage"], reason?: string) => {
    if (!options.onStage) return;
    const event: NativeReviewStage = {
      stage,
      revision: record.revision,
      attempt: record.attempts,
      findings: [...record.findings],
      ...(reason ? { reason } : {}),
    };
    const eventDigest = digest(event);
    if (
      stage === "blocked"
        ? record.blockedNotified
        : record.notifications.includes(eventDigest)
    )
      return;
    if (stage === "blocked") record.blockedNotified = true;
    else record.notifications.push(eventDigest);
    // At-most-once notification admission: a failed comment/label write cannot replay a model.
    write();
    await wait(options.onStage(event));
  };
  const block = async (
    state: "failed" | "unknown" | "exhausted",
    evidence: string,
  ) => {
    record.state = state;
    record.evidence = evidence;
    write();
    try {
      await notify("blocked", evidence);
    } catch (error) {
      record.state = "unknown";
      record.evidence = `${evidence}; blocked notification failed: ${String(error)}`;
      write();
    }
    return result();
  };
  const exactRevision = async (expected: string) => {
    await current();
    const actual = await wait(options.resolveRevision(signal));
    await current();
    commit.parse(actual);
    if (actual !== expected)
      throw new Error(
        "Native review commit changed; stale or editing reviewer rejected",
      );
  };
  const validationFor = async (revision: string) => {
    await exactRevision(revision);
    const validation = await wait(options.validate(revision, signal));
    await exactRevision(revision);
    if (
      !validation ||
      validation.state !== "passed" ||
      !Number.isInteger(validation.evaluatedScope) ||
      validation.evaluatedScope <= 0 ||
      !Array.isArray(validation.checks) ||
      validation.checks.length === 0
    )
      throw new Error(
        "Native review requires positive host local validation with evaluated scope",
      );
    return structuredClone(validation);
  };
  const invoke = async (
    stage: "review" | "fix",
    validation: NativeReviewValidation,
  ) => {
    await exactRevision(record.revision);
    const request: OrchestrationWorkerRequest = {
      ...structuredClone(original),
      stage,
      task: {
        ...structuredClone(original.task),
        ...(stage === "review"
          ? {
              brief: `${original.task.brief}\n\nReview instruction: Prefix any finding requiring changes to the approved plan or task scopes with APPROVAL_REQUIRED:. Do not change approved artifacts or widen scopes.`,
            }
          : {}),
      },
      revision: record.revision,
      invocation: `native-${stage}-${randomUUID()}`,
      intent: digest({
        bindingDigest,
        revision: record.revision,
        attempt: record.attempts,
        stage,
        validation,
        findings: record.findings,
      }),
      artifacts: {
        ...structuredClone(original.artifacts),
        verify: JSON.stringify({
          revision: record.revision,
          validation,
          approvedArtifacts: original.artifacts,
          originalImplementationInvocation: original.invocation,
          originalImplementationRequestDigest: binding.originalRequestDigest,
          trust: "trusted-local",
          backendAttested: false,
        }),
      },
      failures:
        stage === "fix"
          ? [...original.failures, ...record.findings]
          : [...original.failures],
    };
    const entry: NativeReviewRecord["history"][number] = {
      stage,
      attempt: record.attempts,
      revision: record.revision,
      bindingDigest,
      invocation: request.invocation,
      intent: request.intent,
      requestDigest: digest(request),
      validationDigest: digest(validation),
      state: "reserved",
    };
    record.history.push(entry);
    record.state = "running";
    write();
    await notify(stage === "review" ? "reviewing" : "implementing");
    await exactRevision(record.revision);
    write();
    const receipt = workerReceiptSchema.parse(
      await wait(options.execute(request, signal)),
    );
    if (digest(request) !== entry.requestDigest)
      throw new Error("Native review invocation request binding changed");
    await current();
    const actual = await wait(options.resolveRevision(signal));
    commit.parse(actual);
    entry.receipt = receipt;
    entry.state = receipt.kind;
    entry.resultingRevision = actual;
    // Retain the completed receipt before comments or any next invocation.
    write();
    if (stage === "review" && actual !== record.revision)
      throw new Error(
        "Native review commit changed; editing reviewer rejected",
      );
    return { receipt, actual, entry };
  };

  try {
    if (
      record.bindingDigest !== digest(record.binding) ||
      record.bindingDigest !== bindingDigest ||
      record.maxIterations !== maxIterations ||
      record.revision !== options.revision
    )
      return await block(
        "failed",
        "Native review binding changed; retained attempt budget cannot reset",
      );
    if (snapshot.value != null) {
      if (record.state === "running")
        return await block(
          "unknown",
          "Native review reservation outcome unknown; no replay",
        );
      if (record.state !== "clean") {
        await notify("blocked", record.evidence);
        return result();
      }
      await exactRevision(record.revision);
      const last = record.history.at(-1);
      if (
        last?.stage !== "review" ||
        last.state !== "completed" ||
        last.bindingDigest !== bindingDigest ||
        last.revision !== record.revision ||
        last.resultingRevision !== record.revision ||
        last.receipt?.kind !== "completed" ||
        last.receipt.findings.length !== 0 ||
        record.findings.length !== 0
      )
        return await block(
          "unknown",
          "Retained clean review lacks exact completed invocation evidence",
        );
      return result();
    }
    write();
    let validation = await validationFor(record.revision);
    while (true) {
      const reviewed = await invoke("review", validation);
      if (reviewed.receipt.kind !== "completed")
        return await block(
          reviewed.receipt.kind,
          reviewed.receipt.kind === "failed"
            ? `${reviewed.receipt.signature}: ${reviewed.receipt.evidence}`
            : reviewed.receipt.reason,
        );
      record.findings = [...reviewed.receipt.findings];
      record.evidence = reviewed.receipt.artifact;
      write();
      await notify("reviewing");
      await exactRevision(record.revision);
      if (
        Object.keys(reviewed.receipt.amendments ?? {}).length ||
        record.findings.some((finding) =>
          finding.trimStart().startsWith("APPROVAL_REQUIRED:"),
        )
      )
        return await block(
          "failed",
          "Approved plan/scope expansion requires new user approval",
        );
      if (!record.findings.length) {
        record.state = "clean";
        write();
        return result();
      }
      if (record.attempts >= record.maxIterations)
        return await block(
          "exhausted",
          `Iteration limit reached (${record.maxIterations}); remaining findings require human input. ${record.evidence}`,
        );
      record.attempts++;
      const fixed = await invoke("fix", validation);
      if (fixed.receipt.kind !== "completed")
        return await block(
          fixed.receipt.kind,
          fixed.receipt.kind === "failed"
            ? `${fixed.receipt.signature}: ${fixed.receipt.evidence}`
            : fixed.receipt.reason,
        );
      if (Object.keys(fixed.receipt.amendments ?? {}).length)
        return await block(
          "failed",
          "Approved plan/scope expansion requires new user approval",
        );
      if (fixed.actual === record.revision)
        return await block(
          "failed",
          "Fix did not produce a new committed revision",
        );
      record.revision = fixed.actual;
      write();
      validation = await validationFor(record.revision);
    }
  } catch (error) {
    try {
      return await block("unknown", String(error));
    } catch {
      // A stale CAS owner must never overwrite a winner's reservation or report clean.
      return {
        ...result(),
        state: "unknown",
        evidence: `Native review result could not be persisted: ${String(error)}`,
      };
    }
  }
}
