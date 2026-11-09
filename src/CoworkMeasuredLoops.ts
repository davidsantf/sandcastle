import { z } from "zod";
import {
  coworkDigest,
  coworkDigestSchema,
  coworkIdSchema,
  coworkRevisionSchema,
  coworkTimeSchema,
  readCoworkRecord,
  writeCoworkRecord,
  type CoworkFactoryStore,
  type CoworkMeasurementRecord,
} from "./CoworkFactoryContract.js";

export interface CoworkMeasuredDecision {
  readonly state: "keep" | "reject" | "inconclusive";
  readonly reason: string;
  readonly evidence: readonly string[];
  readonly improvementPercent?: number;
  readonly wins?: number;
  readonly losses?: number;
  readonly tailSize?: number;
}

const checkSchema = z.strictObject({
  name: coworkIdSchema,
  passed: z.boolean(),
});
const identitySet = z.array(coworkIdSchema).min(1).max(10000);
const unique = (values: readonly string[]) =>
  new Set(values).size === values.length;
const sameSet = (a: readonly string[], b: readonly string[]) =>
  unique(a) &&
  unique(b) &&
  a.length === b.length &&
  [...a].sort().join("\0") === [...b].sort().join("\0");
const sameChecks = (
  a: readonly { name: string }[],
  b: readonly { name: string }[],
) =>
  sameSet(
    a.map((c) => c.name),
    b.map((c) => c.name),
  );
const decision = (
  state: CoworkMeasuredDecision["state"],
  reason: string,
  evidence: readonly string[] = [],
): CoworkMeasuredDecision => ({ state, reason, evidence });

export const coworkExecutionEvidenceSchema = z.strictObject({
  executionId: coworkIdSchema,
  source: coworkIdSchema,
  project: coworkIdSchema,
  revision: coworkRevisionSchema,
  role: z.enum(["baseline", "candidate"]),
  artifact: coworkDigestSchema,
  observedAt: coworkTimeSchema,
  environment: coworkDigestSchema,
  workload: coworkDigestSchema,
  fixtureId: coworkIdSchema,
  isolated: z.literal(true),
  testIds: identitySet,
  assertionIds: identitySet,
  evaluatedScope: z.number().int().positive(),
  targetChecks: z.array(checkSchema).min(1).max(1000),
  protectedChecks: z.array(checkSchema).min(1).max(1000),
  regressions: z.number().int().nonnegative(),
});
export type CoworkExecutionEvidence = z.infer<
  typeof coworkExecutionEvidenceSchema
>;
export interface CoworkAcceptancePair {
  readonly baseline: CoworkExecutionEvidence;
  readonly candidate: CoworkExecutionEvidence;
}

export function evaluateCoworkAcceptance(input: {
  readonly baselineRevision: string;
  readonly candidateRevision: string;
  readonly pairs: readonly CoworkAcceptancePair[];
  readonly requiredRepeats?: number;
  readonly now: string;
  readonly maxAgeMs: number;
}): CoworkMeasuredDecision {
  const repeats = input.requiredRepeats ?? 2;
  if (
    !coworkRevisionSchema.safeParse(input.baselineRevision).success ||
    !coworkRevisionSchema.safeParse(input.candidateRevision).success ||
    input.baselineRevision === input.candidateRevision ||
    !Number.isSafeInteger(repeats) ||
    repeats < 1 ||
    repeats > 20 ||
    input.pairs.length !== repeats
  )
    return decision("inconclusive", "missing-negative-control-evidence");
  const ids = new Set<string>();
  const fixtureIds = new Set<string>();
  const evidence: string[] = [];
  let workloadBinding: string | undefined;
  for (const pair of input.pairs) {
    const b = coworkExecutionEvidenceSchema.safeParse(pair.baseline);
    const c = coworkExecutionEvidenceSchema.safeParse(pair.candidate);
    if (!b.success || !c.success)
      return decision("inconclusive", "invalid-execution-evidence");
    const baseline = b.data,
      candidate = c.data;
    if (
      !fresh(baseline.observedAt, input.now, input.maxAgeMs) ||
      !fresh(candidate.observedAt, input.now, input.maxAgeMs)
    )
      return decision("inconclusive", "stale-execution-evidence", evidence);
    const binding = coworkDigest({
      source: baseline.source,
      project: baseline.project,
      environment: baseline.environment,
      workload: baseline.workload,
      testIds: [...baseline.testIds].sort(),
      assertionIds: [...baseline.assertionIds].sort(),
      targetChecks: baseline.targetChecks.map((check) => check.name).sort(),
      protectedChecks: baseline.protectedChecks
        .map((check) => check.name)
        .sort(),
    });
    if (workloadBinding && workloadBinding !== binding)
      return decision("inconclusive", "changed-repeat-workload", evidence);
    workloadBinding = binding;
    evidence.push(baseline.artifact, candidate.artifact);
    if (
      baseline.revision !== input.baselineRevision ||
      candidate.revision !== input.candidateRevision ||
      baseline.role !== "baseline" ||
      candidate.role !== "candidate" ||
      baseline.source !== candidate.source ||
      baseline.project !== candidate.project ||
      baseline.environment !== candidate.environment ||
      baseline.workload !== candidate.workload ||
      baseline.evaluatedScope !== baseline.testIds.length ||
      candidate.evaluatedScope !== candidate.testIds.length ||
      !sameSet(baseline.testIds, candidate.testIds) ||
      !sameSet(baseline.assertionIds, candidate.assertionIds) ||
      !sameChecks(baseline.targetChecks, candidate.targetChecks) ||
      !sameChecks(baseline.protectedChecks, candidate.protectedChecks)
    )
      return decision(
        "inconclusive",
        "incomparable-execution-evidence",
        evidence,
      );
    for (const run of [baseline, candidate]) {
      if (ids.has(run.executionId) || fixtureIds.has(run.fixtureId))
        return decision(
          "inconclusive",
          "reused-execution-or-fixture",
          evidence,
        );
      ids.add(run.executionId);
      fixtureIds.add(run.fixtureId);
    }
    if (!baseline.targetChecks.some((check) => !check.passed))
      return decision("reject", "negative-control-did-not-fail", evidence);
    if (
      candidate.targetChecks.some((check) => !check.passed) ||
      candidate.regressions !== 0 ||
      baseline.regressions !== 0 ||
      baseline.protectedChecks.some((check) => !check.passed) ||
      candidate.protectedChecks.some((check) => !check.passed)
    )
      return decision("reject", "functional-or-protected-regression", evidence);
  }
  return decision("keep", "executed-fail-before-fix", evidence);
}

const protectedMetricSchema = z.strictObject({
  name: coworkIdSchema,
  unit: z.enum(["count", "ms", "bytes", "ratio", "score"]),
  value: z.number().finite(),
  direction: z.enum(["lower", "higher"]),
});
export const coworkTimingSchema = z.strictObject({
  project: coworkIdSchema,
  source: coworkIdSchema,
  revision: coworkRevisionSchema,
  observedAt: coworkTimeSchema,
  artifact: coworkDigestSchema,
  unit: z.literal("ms"),
  environment: coworkDigestSchema,
  workload: coworkDigestSchema,
  testIds: identitySet,
  assertionIds: identitySet,
  behaviorDigest: coworkDigestSchema,
  evaluatedScope: z.number().int().positive(),
  durations: z.array(z.number().positive().finite()).min(2).max(1000),
  checks: z.array(checkSchema).min(1).max(1000),
  protectedMetric: protectedMetricSchema,
});
export type CoworkTimingEvidence = z.infer<typeof coworkTimingSchema>;

const fresh = (observedAt: string, now: string, maxAgeMs: number) =>
  coworkTimeSchema.safeParse(now).success &&
  Number.isSafeInteger(maxAgeMs) &&
  maxAgeMs > 0 &&
  Date.parse(now) >= Date.parse(observedAt) &&
  Date.parse(now) - Date.parse(observedAt) <= maxAgeMs;
const mean = (numbers: readonly number[]) =>
  numbers.reduce((sum, value) => sum + value / numbers.length, 0);
const regressed = (
  baseline: z.infer<typeof protectedMetricSchema>,
  candidate: z.infer<typeof protectedMetricSchema>,
) =>
  baseline.direction === "lower"
    ? candidate.value > baseline.value
    : candidate.value < baseline.value;

export function evaluateCoworkTestSpeed(
  baselineInput: CoworkTimingEvidence,
  candidateInput: CoworkTimingEvidence,
  options: {
    readonly now: string;
    readonly maxAgeMs: number;
    readonly maxSpreadRatio?: number;
  },
): CoworkMeasuredDecision {
  const b = coworkTimingSchema.safeParse(baselineInput),
    c = coworkTimingSchema.safeParse(candidateInput);
  if (!b.success || !c.success)
    return decision("inconclusive", "invalid-timing-evidence");
  const baseline = b.data,
    candidate = c.data;
  const evidence = [baseline.artifact, candidate.artifact];
  const noiseLimit = options.maxSpreadRatio ?? 0.05;
  if (
    !Number.isFinite(noiseLimit) ||
    noiseLimit < 0 ||
    noiseLimit > 1 ||
    !fresh(baseline.observedAt, options.now, options.maxAgeMs) ||
    !fresh(candidate.observedAt, options.now, options.maxAgeMs) ||
    baseline.project !== candidate.project ||
    baseline.source !== candidate.source ||
    baseline.revision === candidate.revision ||
    baseline.environment !== candidate.environment ||
    baseline.workload !== candidate.workload ||
    baseline.behaviorDigest !== candidate.behaviorDigest ||
    baseline.durations.length !== candidate.durations.length ||
    baseline.evaluatedScope !== baseline.testIds.length ||
    candidate.evaluatedScope !== candidate.testIds.length ||
    !sameSet(baseline.testIds, candidate.testIds) ||
    !sameSet(baseline.assertionIds, candidate.assertionIds) ||
    !sameChecks(baseline.checks, candidate.checks) ||
    baseline.protectedMetric.name !== candidate.protectedMetric.name ||
    baseline.protectedMetric.unit !== candidate.protectedMetric.unit ||
    baseline.protectedMetric.direction !== candidate.protectedMetric.direction
  )
    return decision("inconclusive", "incomparable-timing-evidence", evidence);
  if (
    baseline.checks.some((check) => !check.passed) ||
    candidate.checks.some((check) => !check.passed) ||
    regressed(baseline.protectedMetric, candidate.protectedMetric)
  )
    return decision("reject", "protected-regression", evidence);
  for (const run of [baseline, candidate]) {
    const spread =
      (Math.max(...run.durations) - Math.min(...run.durations)) /
      mean(run.durations);
    if (!Number.isFinite(spread) || spread > noiseLimit)
      return decision("inconclusive", "noisy-timing-evidence", evidence);
  }
  const baselineMs = mean(baseline.durations),
    candidateMs = mean(candidate.durations);
  if (!Number.isFinite(baselineMs) || !Number.isFinite(candidateMs))
    return decision("inconclusive", "nonfinite-timing-aggregate", evidence);
  return {
    state: candidateMs <= baselineMs * 0.95 ? "keep" : "reject",
    reason:
      candidateMs <= baselineMs * 0.95
        ? "at-least-five-percent-faster"
        : "below-five-percent",
    improvementPercent: ((baselineMs - candidateMs) / baselineMs) * 100,
    evidence,
  };
}

export const coworkDocumentSchema = z.strictObject({
  project: coworkIdSchema,
  source: coworkIdSchema,
  revision: coworkRevisionSchema,
  observedAt: coworkTimeSchema,
  artifact: coworkDigestSchema,
  benchmark: coworkIdSchema,
  benchmarkVersion: coworkIdSchema,
  evaluator: coworkIdSchema,
  evaluatorVersion: coworkIdSchema,
  tasks: z
    .array(
      z.strictObject({
        id: coworkIdSchema,
        output: coworkDigestSchema,
        score: z.number().finite(),
        hardChecks: z.array(checkSchema).min(1).max(1000),
      }),
    )
    .min(1)
    .max(10000),
});
export type CoworkDocumentEvidence = z.infer<typeof coworkDocumentSchema>;

/** Lowest ceil(N/10) scores, each included once; ties never enlarge the decile. */
export function coworkBottomDecile(scores: readonly number[]): {
  size: number;
  mean: number;
} {
  if (!scores.length || scores.some((score) => !Number.isFinite(score)))
    throw new Error("Bottom decile requires nonempty finite scores");
  const size = Math.ceil(scores.length / 10);
  return { size, mean: mean([...scores].sort((a, b) => a - b).slice(0, size)) };
}

export function evaluateCoworkDocumentQuality(
  baselineInput: CoworkDocumentEvidence,
  candidateInput: CoworkDocumentEvidence,
  options: { readonly now: string; readonly maxAgeMs: number },
): CoworkMeasuredDecision {
  const b = coworkDocumentSchema.safeParse(baselineInput),
    c = coworkDocumentSchema.safeParse(candidateInput);
  if (!b.success || !c.success)
    return decision("inconclusive", "invalid-document-evidence");
  const baseline = b.data,
    candidate = c.data;
  const evidence = [baseline.artifact, candidate.artifact];
  if (
    !fresh(baseline.observedAt, options.now, options.maxAgeMs) ||
    !fresh(candidate.observedAt, options.now, options.maxAgeMs) ||
    baseline.project !== candidate.project ||
    baseline.source !== candidate.source ||
    baseline.revision === candidate.revision ||
    baseline.benchmark !== candidate.benchmark ||
    baseline.benchmarkVersion !== candidate.benchmarkVersion ||
    baseline.evaluator !== candidate.evaluator ||
    baseline.evaluatorVersion !== candidate.evaluatorVersion ||
    !sameSet(
      baseline.tasks.map((t) => t.id),
      candidate.tasks.map((t) => t.id),
    )
  )
    return decision(
      "inconclusive",
      "benchmark-or-evaluator-mismatch",
      evidence,
    );
  let wins = 0,
    losses = 0;
  for (const original of baseline.tasks) {
    const changed = candidate.tasks.find((task) => task.id === original.id)!;
    if (original.output === changed.output && original.score !== changed.score)
      return decision(
        "inconclusive",
        "inconsistent-evaluator-output",
        evidence,
      );
    if (!sameChecks(original.hardChecks, changed.hardChecks))
      return decision(
        "inconclusive",
        "hard-check-membership-mismatch",
        evidence,
      );
    if (
      original.hardChecks.some((check) => !check.passed) ||
      changed.hardChecks.some((check) => !check.passed)
    )
      return decision("reject", "hard-check-regression", evidence);
    if (changed.score > original.score) wins++;
    if (changed.score < original.score) losses++;
  }
  const bottom = coworkBottomDecile(baseline.tasks.map((t) => t.score));
  const changedBottom = coworkBottomDecile(candidate.tasks.map((t) => t.score));
  if (!Number.isFinite(bottom.mean) || !Number.isFinite(changedBottom.mean))
    return decision("inconclusive", "nonfinite-quality-aggregate", evidence);
  const keep = wins > losses && changedBottom.mean >= bottom.mean;
  return {
    state: keep ? "keep" : "reject",
    reason:
      wins <= losses
        ? "wins-not-greater-than-losses"
        : changedBottom.mean < bottom.mean
          ? "bottom-decile-regression"
          : "quality-improved",
    wins,
    losses,
    tailSize: bottom.size,
    evidence,
  };
}

export const coworkLoopPolicySchema = z.strictObject({
  id: coworkIdSchema,
  version: coworkIdSchema,
  maxAttempts: z.number().int().positive().max(20).default(3),
  repeatedSignatureLimit: z.number().int().positive().max(20).default(2),
  deadline: coworkTimeSchema,
  target: z.string().min(1).max(1000),
  protectedMetric: coworkIdSchema,
  humanActions: z.array(z.string().min(1).max(1000)).min(1).max(10),
});
export type CoworkLoopPolicy = z.infer<typeof coworkLoopPolicySchema>;

export function evaluateCoworkLoopBounds(
  policyInput: CoworkLoopPolicy,
  history: readonly CoworkMeasurementRecord[],
  now: string,
): { readonly state: "continue" | "stopped"; readonly reason: string } {
  const parsed = coworkLoopPolicySchema.safeParse(policyInput);
  if (!parsed.success || !coworkTimeSchema.safeParse(now).success)
    return { state: "stopped", reason: "invalid-loop-policy" };
  const p = parsed.data;
  if (Date.parse(now) >= Date.parse(p.deadline))
    return { state: "stopped", reason: "deadline" };
  if (
    history.some(
      (record, index) =>
        record.attempt !== index + 1 ||
        record.policy.id !== p.id ||
        record.policy.version !== p.version ||
        record.policyDigest !== coworkDigest(p) ||
        record.deadline !== p.deadline ||
        record.target !== p.target ||
        record.protectedMetric !== p.protectedMetric,
    )
  )
    return { state: "stopped", reason: "policy-or-history-mismatch" };
  if (history.some((record) => record.state === "reserved"))
    return { state: "stopped", reason: "uncertain-attempt" };
  if (history.at(-1)?.state === "keep")
    return { state: "stopped", reason: "target-met" };
  if (history.some((record) => record.state === "stopped"))
    return { state: "stopped", reason: "previously-stopped" };
  if (history.length >= p.maxAttempts)
    return { state: "stopped", reason: "attempt-limit" };
  const signatures = new Map<string, number>();
  for (const record of history) {
    signatures.set(
      record.signature,
      (signatures.get(record.signature) ?? 0) + 1,
    );
    if (signatures.get(record.signature)! >= p.repeatedSignatureLimit)
      return { state: "stopped", reason: "repeated-signature" };
  }
  return { state: "continue", reason: "within-policy" };
}

export async function readCoworkLoopHistory(
  loopId: string,
  policy: CoworkLoopPolicy,
  store: CoworkFactoryStore,
): Promise<readonly CoworkMeasurementRecord[]> {
  coworkIdSchema.parse(loopId);
  const p = coworkLoopPolicySchema.parse(policy);
  const records: CoworkMeasurementRecord[] = [];
  for (let attempt = 1; attempt <= p.maxAttempts; attempt++) {
    const row = await readCoworkRecord(
      store,
      coworkDigest({ loopId, attempt }),
    );
    if (!row.value) break;
    if (
      row.value.kind !== "measurement" ||
      row.value.loopId !== loopId ||
      row.value.attempt !== attempt
    )
      throw new Error("Conflicting measured loop record");
    records.push(row.value);
  }
  return records;
}

export async function reserveCoworkAttempt(
  loopId: string,
  policyInput: CoworkLoopPolicy,
  store: CoworkFactoryStore,
  now: string,
  context?: CoworkMeasurementRecord["context"],
): Promise<
  | { readonly state: "reserved"; readonly record: CoworkMeasurementRecord }
  | { readonly state: "stopped"; readonly reason: string }
> {
  const policy = coworkLoopPolicySchema.parse(policyInput);
  const history = await readCoworkLoopHistory(loopId, policy, store);
  const bounds = evaluateCoworkLoopBounds(policy, history, now);
  if (bounds.state === "stopped")
    return { state: "stopped", reason: bounds.reason };
  const attempt = history.length + 1;
  const intent = coworkDigest({ loopId, policy, attempt, context });
  const record: CoworkMeasurementRecord = {
    kind: "measurement",
    intent,
    loopId,
    policy: { id: policy.id, version: policy.version },
    policyDigest: coworkDigest(policy),
    attempt,
    signature: coworkDigest({ intent, state: "reserved" }),
    deadline: policy.deadline,
    target: policy.target,
    protectedMetric: policy.protectedMetric,
    state: "reserved",
    evidence: [],
    reason: "execution-pending",
    humanActions: policy.humanActions,
    ...(context ? { context } : {}),
  };
  if (
    !(await writeCoworkRecord(
      store,
      coworkDigest({ loopId, attempt }),
      0,
      record,
      now,
    ))
  )
    return { state: "stopped", reason: "attempt-reservation-conflict" };
  return { state: "reserved", record };
}

export async function completeCoworkAttempt(
  reservation: CoworkMeasurementRecord,
  outcome: CoworkMeasuredDecision,
  signature: string,
  store: CoworkFactoryStore,
  now: string,
): Promise<CoworkMeasurementRecord> {
  coworkDigestSchema.parse(signature);
  const key = coworkDigest({
    loopId: reservation.loopId,
    attempt: reservation.attempt,
  });
  const row = await readCoworkRecord(store, key);
  if (
    row.version !== 1 ||
    !row.value ||
    row.value.kind !== "measurement" ||
    row.value.state !== "reserved" ||
    coworkDigest(row.value) !== coworkDigest(reservation)
  )
    throw new Error("Measured attempt reservation is stale or unresolved");
  const record: CoworkMeasurementRecord = {
    ...reservation,
    state: outcome.state,
    signature,
    reason: outcome.reason,
    evidence: [...outcome.evidence],
  };
  if (!(await writeCoworkRecord(store, key, row.version, record, now)))
    throw new Error("Measured attempt completion is uncertain");
  return record;
}
