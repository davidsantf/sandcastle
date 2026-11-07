import {
  coworkBounded,
  coworkDigest,
  coworkDigestSchema,
  coworkFreeze,
  coworkIdSchema,
  coworkRevisionSchema,
  type CoworkFactoryStore,
} from "./CoworkFactoryContract.js";
import {
  completeCoworkAttempt,
  coworkExecutionEvidenceSchema,
  coworkLoopPolicySchema,
  evaluateCoworkAcceptance,
  reserveCoworkAttempt,
  type CoworkAcceptancePair,
  type CoworkExecutionEvidence,
  type CoworkLoopPolicy,
  type CoworkMeasuredDecision,
} from "./CoworkMeasuredLoops.js";
import type {
  CoworkCriticStage,
  CoworkStageCriticRequest,
  CoworkStageCriticReceipt,
} from "./CoworkReviewContract.js";

export type CoworkMaterialStage = CoworkCriticStage;
export type CoworkStageEvidenceRequest = CoworkStageCriticRequest;
export type CoworkStageEvidenceReceipt = CoworkStageCriticReceipt;
export interface CoworkIsolatedMeasurementRequest {
  readonly intent: string;
  readonly project: string;
  readonly revision: string;
  readonly role: "baseline" | "candidate";
  readonly repeat: number;
  readonly fixtureId: string;
  readonly testIds: readonly string[];
  readonly assertionIds: readonly string[];
}
export interface CoworkEvidenceExecutionHost {
  authorizeStage(
    request: CoworkStageEvidenceRequest,
    signal: AbortSignal,
  ): Promise<boolean>;
  executeStage(
    request: CoworkStageEvidenceRequest,
    signal: AbortSignal,
  ): Promise<{
    readonly state: "completed" | "failed" | "unknown";
    readonly artifact: string;
  }>;
  attestStage(
    request: CoworkStageEvidenceRequest,
    artifact: string,
    signal: AbortSignal,
  ): Promise<boolean>;
  /** Adapt peer runCoworkStageCritic through an independently attested host wrapper. */
  critic(
    request: CoworkStageEvidenceRequest,
    signal: AbortSignal,
  ): Promise<CoworkStageEvidenceReceipt>;
  attestCritic(
    request: CoworkStageEvidenceRequest,
    receipt: CoworkStageEvidenceReceipt,
    signal: AbortSignal,
  ): Promise<boolean>;
  /** Must execute only against distinct isolated fixtures, never revert the user's worktree. */
  measure(
    request: CoworkIsolatedMeasurementRequest,
    signal: AbortSignal,
  ): Promise<CoworkExecutionEvidence>;
  attestMeasurement(
    request: CoworkIsolatedMeasurementRequest,
    receipt: CoworkExecutionEvidence,
    signal: AbortSignal,
  ): Promise<boolean>;
}

export async function runCoworkEvidencePipeline(
  input: {
    readonly loopId: string;
    readonly policy: CoworkLoopPolicy;
    readonly project: string;
    readonly baselineRevision: string;
    readonly candidateRevision: string;
    readonly artifact: string;
    readonly author: { readonly id: string; readonly family: string };
    readonly contracts: Readonly<Record<string, string>>;
    readonly testIds: readonly string[];
    readonly assertionIds: readonly string[];
    readonly requiredRepeats?: number;
  },
  options: {
    readonly store: CoworkFactoryStore;
    readonly host: CoworkEvidenceExecutionHost;
    readonly timeoutMs?: number;
    readonly signal?: AbortSignal;
    readonly maxEvidenceAgeMs?: number;
  },
): Promise<
  | CoworkMeasuredDecision
  | { readonly state: "stopped" | "unknown"; readonly reason: string }
> {
  const snapshot = coworkFreeze(input);
  coworkIdSchema.parse(snapshot.loopId);
  coworkIdSchema.parse(snapshot.project);
  coworkRevisionSchema.parse(snapshot.baselineRevision);
  coworkRevisionSchema.parse(snapshot.candidateRevision);
  coworkDigestSchema.parse(snapshot.artifact);
  coworkIdSchema.parse(snapshot.author.id);
  coworkIdSchema.parse(snapshot.author.family);
  for (const [name, digest] of Object.entries(snapshot.contracts)) {
    coworkIdSchema.parse(name);
    coworkDigestSchema.parse(digest);
  }
  const repeats = snapshot.requiredRepeats ?? 2;
  if (
    !snapshot.testIds.length ||
    !snapshot.assertionIds.length ||
    new Set(snapshot.testIds).size !== snapshot.testIds.length ||
    new Set(snapshot.assertionIds).size !== snapshot.assertionIds.length ||
    !Number.isSafeInteger(repeats) ||
    repeats < 1 ||
    repeats > 20 ||
    snapshot.baselineRevision === snapshot.candidateRevision
  )
    return { state: "stopped", reason: "invalid-evaluated-scope" };
  snapshot.testIds.forEach((id) => coworkIdSchema.parse(id));
  snapshot.assertionIds.forEach((id) => coworkIdSchema.parse(id));
  const policy = coworkLoopPolicySchema.parse(snapshot.policy);
  const timeoutMs = options.timeoutMs ?? 30000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 300000)
    return { state: "stopped", reason: "invalid-execution-timeout" };
  const reserved = await reserveCoworkAttempt(
    snapshot.loopId,
    policy,
    options.store,
    new Date().toISOString(),
    {
      project: snapshot.project,
      baseRevision: snapshot.baselineRevision,
      revision: snapshot.candidateRevision,
      artifact: snapshot.artifact,
    },
  );
  if (reserved.state === "stopped") return reserved;
  const intent = coworkDigest({
    reservation: reserved.record.intent,
    input: snapshot,
  });
  let artifact = snapshot.artifact;
  const artifacts: string[] = [];
  const call = <T>(operation: (signal: AbortSignal) => Promise<T>) =>
    coworkBounded(operation, timeoutMs, options.signal, policy.deadline);
  const finish = async (result: CoworkMeasuredDecision) => {
    await completeCoworkAttempt(
      reserved.record,
      result,
      coworkDigest({
        state: result.state,
        reason: result.reason,
      }),
      options.store,
      new Date().toISOString(),
    );
    return result;
  };
  const stage = async (
    name: CoworkMaterialStage,
  ): Promise<string | undefined> => {
    let request: CoworkStageEvidenceRequest = coworkFreeze({
      stage: name,
      intent,
      revision: snapshot.candidateRevision,
      artifact,
      author: snapshot.author,
      contracts: snapshot.contracts,
    });
    if (!(await call((signal) => options.host.authorizeStage(request, signal))))
      return "stage-not-authorized";
    const output = await call((signal) =>
      options.host.executeStage(request, signal),
    );
    if (
      output.state !== "completed" ||
      !coworkDigestSchema.safeParse(output.artifact).success
    )
      return output.state === "unknown"
        ? "stage-outcome-unknown"
        : "stage-failed";
    if (
      !(await call((signal) =>
        options.host.attestStage(request, output.artifact, signal),
      ))
    )
      return "stage-evidence-unverified";
    artifact = output.artifact;
    request = coworkFreeze({ ...request, artifact });
    const receipt = await call((signal) =>
      options.host.critic(request, signal),
    );
    if (receipt.state === "unknown") return "stage-outcome-unknown";
    if (
      receipt.stage !== name ||
      receipt.intent !== intent ||
      receipt.revision !== snapshot.candidateRevision ||
      receipt.artifact !== artifact ||
      receipt.critic.family === snapshot.author.family ||
      receipt.critic.id === snapshot.author.id ||
      !coworkIdSchema.safeParse(receipt.critic.id).success ||
      !coworkIdSchema.safeParse(receipt.critic.family).success ||
      receipt.state !== "passed" ||
      receipt.findings.length !== 0 ||
      !(await call((signal) =>
        options.host.attestCritic(request, coworkFreeze(receipt), signal),
      ))
    )
      return "independent-critic-not-passed";
    artifacts.push(artifact);
    return undefined;
  };
  try {
    for (const name of ["research", "design", "build"] as const) {
      const reason = await stage(name);
      if (reason === "stage-outcome-unknown")
        return { state: "unknown", reason };
      if (reason)
        return await finish({
          state: "inconclusive",
          reason,
          evidence: artifacts,
        });
    }
    const pairs: CoworkAcceptancePair[] = [];
    for (let repeat = 1; repeat <= repeats; repeat++) {
      const measure = async (role: "baseline" | "candidate") => {
        const request: CoworkIsolatedMeasurementRequest = coworkFreeze({
          intent,
          project: snapshot.project,
          revision:
            role === "baseline"
              ? snapshot.baselineRevision
              : snapshot.candidateRevision,
          role,
          repeat,
          fixtureId: `fixture-${coworkDigest({ intent, role, repeat })}`,
          testIds: snapshot.testIds,
          assertionIds: snapshot.assertionIds,
        });
        const receipt = coworkExecutionEvidenceSchema.parse(
          await call((signal) => options.host.measure(request, signal)),
        );
        if (
          receipt.revision !== request.revision ||
          receipt.role !== role ||
          receipt.project !== request.project ||
          receipt.fixtureId !== request.fixtureId ||
          coworkDigest([...receipt.testIds].sort()) !==
            coworkDigest([...request.testIds].sort()) ||
          coworkDigest([...receipt.assertionIds].sort()) !==
            coworkDigest([...request.assertionIds].sort()) ||
          !(await call((signal) =>
            options.host.attestMeasurement(
              request,
              coworkFreeze(receipt),
              signal,
            ),
          ))
        )
          throw new Error("Cowork host measurement provenance is unavailable");
        return receipt;
      };
      pairs.push({
        baseline: await measure("baseline"),
        candidate: await measure("candidate"),
      });
    }
    const acceptance = evaluateCoworkAcceptance({
      baselineRevision: snapshot.baselineRevision,
      candidateRevision: snapshot.candidateRevision,
      pairs,
      requiredRepeats: repeats,
      now: new Date().toISOString(),
      maxAgeMs: options.maxEvidenceAgeMs ?? 60000,
    });
    if (acceptance.state !== "keep") return await finish(acceptance);
    artifact = coworkDigest(pairs);
    artifacts.push(...acceptance.evidence);
    for (const name of [
      "verification",
      "review",
      "change-request-proposal",
    ] as const) {
      const reason = await stage(name);
      if (reason === "stage-outcome-unknown")
        return { state: "unknown", reason };
      if (reason)
        return await finish({
          state: "inconclusive",
          reason,
          evidence: artifacts,
        });
    }
    return await finish({ ...acceptance, evidence: artifacts });
  } catch {
    // Unsettled host effects retain the reservation; restart cannot reset the attempt.
    return { state: "unknown", reason: "execution-or-persistence-unresolved" };
  }
}
