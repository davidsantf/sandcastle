import { z } from "zod";
import {
  coworkBounded,
  coworkDigest,
  coworkDigestSchema,
  coworkEvidenceSchema,
  coworkFreeze,
  coworkIdSchema,
  coworkRevisionSchema,
  coworkTimeSchema,
  readCoworkRecord,
  writeCoworkRecord,
  type CoworkEvidence,
  type CoworkFactoryStore,
} from "./CoworkFactoryContract.js";
import { evaluateCoworkSignal } from "./CoworkFactory.js";
import type { CoworkCandidate, CoworkRule } from "./CoworkFactoryContract.js";

export const coworkReleaseRegistrationSchema = z.strictObject({
  project: coworkIdSchema,
  provider: z.enum(["github", "azure-devops"]),
  mergedRevision: coworkRevisionSchema,
  mergedAt: coworkTimeSchema,
  originatingCandidate: coworkDigestSchema,
  originatingRevision: coworkRevisionSchema,
  source: coworkIdSchema,
  metric: coworkIdSchema,
  unit: z.enum(["count", "ms", "bytes", "ratio", "score"]),
  direction: z.enum(["at-most", "at-least"]),
  target: z.number().finite(),
  protectedMetric: coworkIdSchema,
  protectedUnit: z.enum(["count", "ms", "bytes", "ratio", "score"]),
  protectedDirection: z.enum(["at-most", "at-least"]),
  protectedTarget: z.number().finite(),
  productionRings: z.array(coworkIdSchema).min(1).max(32),
  maxAgeMs: z.number().int().positive().max(604800000),
  minEvaluatedScope: z.number().int().positive(),
});
export type CoworkReleaseRegistration = z.infer<
  typeof coworkReleaseRegistrationSchema
>;

const buildSchema = z.strictObject({
  id: coworkIdSchema,
  revision: coworkRevisionSchema,
  state: z.enum(["succeeded", "failed", "unknown"]),
  artifact: coworkIdSchema,
  evidence: coworkDigestSchema,
});
const artifactSchema = z.strictObject({
  id: coworkIdSchema,
  build: coworkIdSchema,
  revisions: z.array(coworkRevisionSchema).min(1).max(1000),
  evidence: coworkDigestSchema,
});
const deploymentSchema = z.strictObject({
  id: coworkIdSchema,
  build: coworkIdSchema,
  artifact: coworkIdSchema,
  ring: coworkIdSchema,
  environment: z.enum(["production", "test"]),
  deployedAt: coworkTimeSchema,
  state: z.enum(["succeeded", "failed", "unknown"]),
  evidence: coworkDigestSchema,
});
export const coworkReleaseObservationSchema = z.strictObject({
  project: coworkIdSchema,
  provider: z.enum(["github", "azure-devops"]),
  builds: z.array(buildSchema).max(1000),
  artifacts: z.array(artifactSchema).max(1000),
  deployments: z.array(deploymentSchema).max(1000),
  metrics: z
    .array(
      z.strictObject({
        deployment: coworkIdSchema,
        evidence: coworkEvidenceSchema,
      }),
    )
    .max(1000),
});
export type CoworkReleaseObservation = z.infer<
  typeof coworkReleaseObservationSchema
>;
export interface CoworkReleaseRequest {
  readonly registration: CoworkReleaseRegistration;
  readonly now: string;
}
export interface CoworkReleaseProvider {
  observe(
    request: CoworkReleaseRequest,
    signal: AbortSignal,
  ): Promise<CoworkReleaseObservation>;
  /** Independently attest artifact membership, deployment association and telemetry provenance. */
  attest(
    request: CoworkReleaseRequest,
    observation: CoworkReleaseObservation,
    signal: AbortSignal,
  ): Promise<boolean>;
}

/** No executable write capability is present at this CLI/API boundary. */
export interface CoworkReleaseReadTransport {
  read(
    request: {
      readonly provider: "github" | "azure-devops";
      readonly resource: "builds" | "artifacts" | "deployments" | "metrics";
      readonly project: string;
      readonly revision: string;
      readonly after: string;
    },
    signal: AbortSignal,
  ): Promise<unknown>;
}

/** Executes four injected reads; native provider JSON normalization is host-owned. */
export function createCoworkReleaseProvider(
  transport: CoworkReleaseReadTransport,
  attest: CoworkReleaseProvider["attest"],
): CoworkReleaseProvider {
  return {
    async observe(input, signal) {
      const r = coworkReleaseRegistrationSchema.parse(input.registration);
      const read = (
        resource: "builds" | "artifacts" | "deployments" | "metrics",
      ) =>
        transport.read(
          coworkFreeze({
            provider: r.provider,
            resource,
            project: r.project,
            revision: r.mergedRevision,
            after: r.mergedAt,
          }),
          signal,
        );
      const [builds, artifacts, deployments, metrics] = await Promise.all([
        read("builds"),
        read("artifacts"),
        read("deployments"),
        read("metrics"),
      ]);
      return coworkReleaseObservationSchema.parse({
        project: r.project,
        provider: r.provider,
        builds,
        artifacts,
        deployments,
        metrics,
      });
    },
    attest,
  };
}

export interface CoworkReleaseResult {
  readonly state:
    | "awaiting-evidence"
    | "blocked"
    | "verified"
    | "resurfaced"
    | "inconclusive";
  readonly reason: string;
  readonly evidence: readonly string[];
  readonly deployment?: string;
  readonly metric?: CoworkEvidence;
  readonly recurrence?: string;
}

export function evaluateCoworkRelease(
  registrationInput: CoworkReleaseRegistration,
  observationInput: CoworkReleaseObservation,
  now: string,
): CoworkReleaseResult {
  const r = coworkReleaseRegistrationSchema.safeParse(registrationInput);
  const o = coworkReleaseObservationSchema.safeParse(observationInput);
  const result = (
    state: CoworkReleaseResult["state"],
    reason: string,
  ): CoworkReleaseResult => ({ state, reason, evidence: [] });
  if (!r.success || !o.success || !coworkTimeSchema.safeParse(now).success)
    return result("blocked", "invalid-release-evidence");
  const registration = r.data,
    observation = o.data;
  if (
    registration.project !== observation.project ||
    registration.provider !== observation.provider ||
    new Set(registration.productionRings).size !==
      registration.productionRings.length
  )
    return result("blocked", "release-project-or-policy-mismatch");
  for (const records of [
    observation.builds,
    observation.artifacts,
    observation.deployments,
  ]) {
    if (new Set(records.map((record) => record.id)).size !== records.length)
      return result("blocked", "ambiguous-release-records");
  }
  // Select by exact provenance before ring/time ordering, never by a nearby successful build.
  const relevant = observation.deployments.filter((deployment) => {
    const build = observation.builds.find((b) => b.id === deployment.build);
    const artifact = observation.artifacts.find(
      (a) => a.id === deployment.artifact,
    );
    return (
      build?.revision === registration.mergedRevision &&
      build.state === "succeeded" &&
      artifact?.build === build.id &&
      artifact.id === build.artifact &&
      artifact.revisions.includes(registration.mergedRevision) &&
      deployment.environment === "production" &&
      deployment.state === "succeeded" &&
      Date.parse(deployment.deployedAt) >= Date.parse(registration.mergedAt) &&
      Date.parse(deployment.deployedAt) <= Date.parse(now) &&
      registration.productionRings.includes(deployment.ring)
    );
  });
  const firstRing = registration.productionRings[0];
  const first = relevant
    .filter((deployment) => deployment.ring === firstRing)
    .sort(
      (a, b) =>
        a.deployedAt.localeCompare(b.deployedAt) || a.id.localeCompare(b.id),
    )[0];
  if (!first)
    return result(
      "awaiting-evidence",
      "first-production-ring-provenance-missing",
    );
  const evidence = [
    observation.builds.find((build) => build.id === first.build)!.evidence,
    observation.artifacts.find((artifact) => artifact.id === first.artifact)!
      .evidence,
    first.evidence,
  ];
  const eligibleMetrics = observation.metrics.filter(
    (m) =>
      m.deployment === first.id &&
      m.evidence.project === registration.project &&
      m.evidence.revision === registration.mergedRevision &&
      m.evidence.source === registration.source &&
      m.evidence.state === "known" &&
      m.evidence.evaluatedScope >= registration.minEvaluatedScope &&
      Date.parse(m.evidence.observedAt) >= Date.parse(first.deployedAt) &&
      Date.parse(m.evidence.observedAt) <= Date.parse(now) &&
      Date.parse(now) - Date.parse(m.evidence.observedAt) <=
        registration.maxAgeMs,
  );
  const latest = (metric: string, unit: CoworkEvidence["unit"]) =>
    eligibleMetrics
      .filter((m) => m.evidence.metric === metric && m.evidence.unit === unit)
      .sort((a, b) =>
        b.evidence.observedAt.localeCompare(a.evidence.observedAt),
      );
  const metrics = latest(registration.metric, registration.unit);
  const protectedMetrics = latest(
    registration.protectedMetric,
    registration.protectedUnit,
  );
  if (!metrics.length || !protectedMetrics.length)
    return {
      ...result("awaiting-evidence", "post-release-metrics-missing"),
      evidence,
      deployment: first.id,
    };
  for (const group of [metrics, protectedMetrics]) {
    if (
      group.length > 1 &&
      group[0]!.evidence.observedAt === group[1]!.evidence.observedAt &&
      coworkDigest(group[0]!.evidence) !== coworkDigest(group[1]!.evidence)
    )
      return {
        ...result("inconclusive", "conflicting-post-release-metrics"),
        evidence,
        deployment: first.id,
      };
  }
  const metric = metrics[0]!.evidence,
    protectedMetric = protectedMetrics[0]!.evidence;
  evidence.push(metric.artifact, protectedMetric.artifact);
  if (
    metric.observedAt !== protectedMetric.observedAt ||
    metric.evaluatedScope !== protectedMetric.evaluatedScope
  )
    return {
      state: "inconclusive",
      reason: "incomparable-protected-metric-window",
      evidence,
      deployment: first.id,
      metric,
    };
  const meets = (
    value: number,
    target: number,
    direction: "at-most" | "at-least",
  ) => (direction === "at-most" ? value <= target : value >= target);
  if (
    !meets(
      protectedMetric.value,
      registration.protectedTarget,
      registration.protectedDirection,
    )
  )
    return {
      state: "inconclusive",
      reason: "protected-release-metric-regressed",
      evidence,
      deployment: first.id,
      metric,
    };
  if (meets(metric.value, registration.target, registration.direction))
    return {
      state: "verified",
      reason: "post-release-objective-met",
      evidence,
      deployment: first.id,
      metric,
    };
  const recurrence = coworkDigest({
    origin: registration.originatingCandidate,
    revision: registration.mergedRevision,
    deployment: first.id,
    metric: registration.metric,
    source: registration.source,
  });
  return {
    state: "resurfaced",
    reason: "post-release-objective-not-met",
    evidence,
    deployment: first.id,
    metric,
    recurrence,
  };
}

export async function observeCoworkRelease(
  registrationInput: CoworkReleaseRegistration,
  options: {
    readonly provider: CoworkReleaseProvider;
    readonly store: CoworkFactoryStore;
    readonly now: string;
    readonly signal?: AbortSignal;
    readonly timeoutMs?: number;
    readonly recurrenceRule?: CoworkRule;
  },
): Promise<CoworkReleaseResult> {
  const registration = coworkFreeze(
    coworkReleaseRegistrationSchema.parse(registrationInput),
  );
  const request = coworkFreeze({
    registration,
    now: coworkTimeSchema.parse(options.now),
  });
  const signal = options.signal ?? new AbortController().signal;
  if (signal.aborted)
    return {
      state: "blocked",
      reason: "release-observation-cancelled",
      evidence: [],
    };
  const observation = coworkFreeze(
    coworkReleaseObservationSchema.parse(
      await coworkBounded(
        (signal) => options.provider.observe(request, signal),
        options.timeoutMs ?? 30000,
        signal,
      ),
    ),
  );
  if (
    signal.aborted ||
    !(await coworkBounded(
      (signal) => options.provider.attest(request, observation, signal),
      options.timeoutMs ?? 30000,
      signal,
    ))
  )
    return {
      state: "blocked",
      reason: "release-provenance-unverified",
      evidence: [],
    };
  const result = evaluateCoworkRelease(registration, observation, options.now);
  const candidate = options.recurrenceRule
    ? coworkReleaseRecurrenceCandidate(
        registration,
        result,
        options.recurrenceRule,
        options.now,
      )
    : undefined;
  const identity = coworkDigest({ release: registration });
  const prior = await readCoworkRecord(options.store, identity);
  const record = {
    kind: "release" as const,
    intent: identity,
    project: registration.project,
    mergedRevision: registration.mergedRevision,
    originatingCandidate: registration.originatingCandidate,
    state: result.state,
    evidence: [...result.evidence],
    reason: result.reason,
    ...(result.recurrence ? { recurrence: result.recurrence } : {}),
  };
  if (
    (!prior.value || coworkDigest(prior.value) !== coworkDigest(record)) &&
    !(await writeCoworkRecord(
      options.store,
      identity,
      prior.version,
      record,
      options.now,
    ))
  )
    return {
      state: "blocked",
      reason: "release-observation-conflict",
      evidence: result.evidence,
    };
  if (candidate) {
    const retained = await readCoworkRecord(options.store, candidate.key);
    if (
      retained.value &&
      (retained.value.kind !== "candidate" ||
        retained.value.candidate.key !== candidate.key)
    )
      return {
        state: "blocked",
        reason: "release-recurrence-conflict",
        evidence: result.evidence,
      };
    if (
      !retained.value &&
      !(await writeCoworkRecord(
        options.store,
        candidate.key,
        0,
        { kind: "candidate", intent: candidate.key, candidate },
        options.now,
      ))
    )
      return {
        state: "blocked",
        reason: "release-recurrence-conflict",
        evidence: result.evidence,
      };
  }
  return result;
}

export function coworkReleaseRecurrenceCandidate(
  registration: CoworkReleaseRegistration,
  result: CoworkReleaseResult,
  rule: CoworkRule,
  now: string,
): CoworkCandidate | undefined {
  if (result.state !== "resurfaced" || !result.metric || !result.recurrence)
    return undefined;
  if (
    rule.kind !== "release-recurrence" ||
    rule.project !== registration.project ||
    rule.metric !== registration.metric ||
    rule.source !== registration.source ||
    rule.unit !== registration.unit ||
    rule.threshold !== registration.target ||
    rule.direction !==
      (registration.direction === "at-most" ? "above" : "below")
  )
    throw new Error(
      "Recurrence rule must match the originating release signal",
    );
  const decision = evaluateCoworkSignal(result.metric, rule, now);
  if (decision.state !== "candidate") return undefined;
  return {
    ...decision.candidate,
    key: coworkDigest({
      recurrence: result.recurrence,
      rule: { id: rule.id, version: rule.version },
      target: rule.target,
    }),
  };
}
