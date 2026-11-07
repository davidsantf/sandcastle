import {
  coworkBounded,
  coworkDigest,
  coworkFreeze,
  readCoworkRecord,
  type CoworkFactoryStore,
  type CoworkMeasurementRecord,
} from "./CoworkFactoryContract.js";
import {
  completeCoworkAttempt,
  coworkDocumentSchema,
  coworkTimingSchema,
  evaluateCoworkDocumentQuality,
  evaluateCoworkTestSpeed,
  reserveCoworkAttempt,
  type CoworkDocumentEvidence,
  type CoworkLoopPolicy,
  type CoworkMeasuredDecision,
  type CoworkTimingEvidence,
} from "./CoworkMeasuredLoops.js";

export type CoworkQualityComparison =
  | {
      readonly kind: "test-speed";
      readonly baseline: CoworkTimingEvidence;
      readonly candidate: CoworkTimingEvidence;
      readonly maxSpreadRatio: number;
    }
  | {
      readonly kind: "document-quality";
      readonly baseline: CoworkDocumentEvidence;
      readonly candidate: CoworkDocumentEvidence;
    };

export interface CoworkQualityHost {
  /** Check executed six-stage criticism and negative control, not an agent's summary. */
  attestPipeline(
    record: CoworkMeasurementRecord,
    comparison: CoworkQualityComparison,
    signal: AbortSignal,
  ): Promise<boolean>;
  attestComparison(
    comparison: CoworkQualityComparison,
    signal: AbortSignal,
  ): Promise<boolean>;
}

export async function runCoworkQualityComparison(
  input: {
    readonly loopId: string;
    readonly policy: CoworkLoopPolicy;
    readonly negativeControl: {
      readonly loopId: string;
      readonly attempt: number;
    };
    readonly comparison: CoworkQualityComparison;
    readonly now: string;
    readonly maxAgeMs: number;
  },
  options: {
    readonly store: CoworkFactoryStore;
    readonly host: CoworkQualityHost;
    readonly signal?: AbortSignal;
    readonly timeoutMs?: number;
  },
): Promise<
  | CoworkMeasuredDecision
  | { readonly state: "stopped"; readonly reason: string }
> {
  const comparison = coworkFreeze(input.comparison);
  const schema =
    comparison.kind === "test-speed"
      ? coworkTimingSchema
      : coworkDocumentSchema;
  const baseline = schema.safeParse(comparison.baseline),
    candidate = schema.safeParse(comparison.candidate);
  if (!baseline.success || !candidate.success)
    return { state: "stopped", reason: "invalid-comparison-evidence" };
  const control = await readCoworkRecord(
    options.store,
    coworkDigest(input.negativeControl),
  );
  const context =
    control.value?.kind === "measurement" ? control.value.context : undefined;
  const signal = options.signal ?? new AbortController().signal;
  if (
    !control.value ||
    control.value.kind !== "measurement" ||
    control.value.state !== "keep" ||
    control.value.reason !== "executed-fail-before-fix" ||
    !context ||
    context.project !== baseline.data.project ||
    context.baseRevision !== baseline.data.revision ||
    context.revision !== candidate.data.revision ||
    control.value.evidence.length < 6 ||
    signal.aborted
  )
    return {
      state: "stopped",
      reason: "executed-pipeline-or-comparison-unverified",
    };
  const controlRecord = control.value;
  if (
    !(await coworkBounded(
      (signal) =>
        options.host.attestPipeline(controlRecord, comparison, signal),
      options.timeoutMs ?? 30000,
      signal,
      input.policy.deadline,
    )) ||
    !(await coworkBounded(
      (signal) => options.host.attestComparison(comparison, signal),
      options.timeoutMs ?? 30000,
      signal,
      input.policy.deadline,
    )) ||
    signal.aborted
  )
    return {
      state: "stopped",
      reason: "executed-pipeline-or-comparison-unverified",
    };
  if (
    comparison.kind === "test-speed" &&
    input.policy.protectedMetric !== comparison.baseline.protectedMetric.name
  )
    return { state: "stopped", reason: "protected-metric-policy-mismatch" };
  const reserve = await reserveCoworkAttempt(
    input.loopId,
    input.policy,
    options.store,
    input.now,
    {
      project: baseline.data.project,
      baseRevision: baseline.data.revision,
      revision: candidate.data.revision,
      artifact: coworkDigest(comparison),
    },
  );
  if (reserve.state === "stopped") return reserve;
  const outcome =
    comparison.kind === "test-speed"
      ? evaluateCoworkTestSpeed(comparison.baseline, comparison.candidate, {
          now: input.now,
          maxAgeMs: input.maxAgeMs,
          maxSpreadRatio: comparison.maxSpreadRatio,
        })
      : evaluateCoworkDocumentQuality(
          comparison.baseline,
          comparison.candidate,
          {
            now: input.now,
            maxAgeMs: input.maxAgeMs,
          },
        );
  await completeCoworkAttempt(
    reserve.record,
    outcome,
    coworkDigest({ state: outcome.state, reason: outcome.reason }),
    options.store,
    input.now,
  );
  return outcome;
}
