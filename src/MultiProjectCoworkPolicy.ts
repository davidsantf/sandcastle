import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { runCoworkReview, runCoworkStageCritic } from "./CoworkReview.js";
import type {
  CoworkCriticStage,
  CoworkModelIdentity,
  CoworkReviewContext,
  CoworkReviewHost,
  CoworkReviewPolicy,
  CoworkStageCriticHost,
} from "./CoworkReviewContract.js";
import type { CoworkGovernanceResult } from "./CoworkGovernanceContract.js";
import type {
  MultiProjectHost,
  OrchestrationHostRunContext,
  OrchestrationPolicyEvidence,
  OrchestrationValidationEvidence,
} from "./MultiProjectOrchestrator.js";
import {
  digest,
  parseWorkerReceipt,
  taskKey,
  type OrchestrationTask,
  type OrchestrationWorkerRequest,
  type OrchestrationWorkerReceipt,
} from "./MultiProjectProtocol.js";

export interface CoworkOrchestrationClassification {
  readonly author: CoworkModelIdentity;
  readonly risk: "ordinary" | "critical";
  readonly changedFiles: readonly string[];
}

type WithContext<Callbacks, Context> = {
  readonly [Key in keyof Callbacks]: Callbacks[Key] extends (
    ...args: infer Args
  ) => infer Result
    ? (...args: [...Args, context: Context]) => Result
    : never;
};
export interface CoworkOrchestrationProducerEvidence {
  readonly request: OrchestrationWorkerRequest;
  readonly artifact: unknown;
  readonly revision: string;
}

export interface CoworkOrchestrationHostOptions {
  readonly host: MultiProjectHost;
  readonly policy: CoworkReviewPolicy;
  /** Independent provider identity, risk and actual changed-file inventory. */
  readonly classify: (
    request: OrchestrationWorkerRequest,
    revision: string,
    signal: AbortSignal,
  ) => Promise<CoworkOrchestrationClassification>;
  readonly review: WithContext<
    Pick<
      CoworkReviewHost,
      | "authorizeReview"
      | "executeReview"
      | "attestReview"
      | "verifyHumanApproval"
    >,
    OrchestrationWorkerRequest
  >;
  readonly stage: WithContext<
    Pick<CoworkStageCriticHost, "authorize" | "execute" | "attest">,
    CoworkOrchestrationProducerEvidence
  >;
  /** Supply an existing applicable collector/evaluator, not worker declarations. */
  readonly governance?: {
    readonly collect: (
      request: OrchestrationWorkerRequest,
      evidence: OrchestrationValidationEvidence,
      signal: AbortSignal,
    ) => Promise<unknown>;
    readonly evaluate: (
      collected: unknown,
      signal: AbortSignal,
    ) => Promise<CoworkGovernanceResult>;
  };
}

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const revisionSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const identity = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/);
const classificationSchema = z
  .object({
    author: z.object({ id: identity, family: identity }).strict(),
    risk: z.enum(["ordinary", "critical"]),
    changedFiles: z
      .array(identity)
      .min(1)
      .max(10000)
      .refine(
        (files) =>
          new Set(files).size === files.length &&
          files.every(
            (file) =>
              !file.split("/").some((part) => part === "." || part === ".."),
          ),
      ),
  })
  .strict();

function jsonSnapshot(value: unknown): unknown {
  const visit = (item: unknown, seen: Set<object>): void => {
    if (item === null || typeof item === "string" || typeof item === "boolean")
      return;
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (!item || typeof item !== "object" || seen.has(item))
      throw new Error("non-JSON policy evidence");
    if (
      !Array.isArray(item) &&
      Object.getPrototypeOf(item) !== Object.prototype &&
      Object.getPrototypeOf(item) !== null
    )
      throw new Error("non-plain policy evidence");
    seen.add(item);
    for (const child of Object.values(item)) visit(child, seen);
    seen.delete(item);
  };
  visit(value, new Set());
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json) > 1024 * 1024)
    throw new Error("policy evidence exceeds journal bound");
  return JSON.parse(json) as unknown;
}

const plainJson = z.unknown().transform((value) => jsonSnapshot(value));
const historySchema = z
  .object({
    intent: sha,
    revision: revisionSchema,
    attempt: z.number().int().positive(),
    blockingSignature: sha.nullable(),
  })
  .strict();
const invocationSchema = z
  .object({
    id: z.string().min(1).max(300),
    kind: z.enum(["review", "phase", "verification"]),
    revision: revisionSchema,
    attempt: z.number().int().positive().nullable(),
    status: z.enum(["reserved", "unknown", "completed"]),
    context: plainJson,
    evidence: z.array(
      z.object({ kind: z.string(), value: plainJson }).strict(),
    ),
    result: plainJson,
  })
  .strict();
const projectionSchema = z
  .object({
    schema: z.literal(1),
    scope: sha,
    definition: sha,
    history: z.array(historySchema),
    invocations: z.array(invocationSchema),
  })
  .strict()
  .superRefine((projection, context) => {
    if (
      new Set(projection.invocations.map((entry) => entry.id)).size !==
        projection.invocations.length ||
      projection.history.some(
        (entry, index) =>
          entry.intent !== projection.definition || entry.attempt !== index + 1,
      ) ||
      projection.invocations.filter((entry) => entry.kind === "review")
        .length !== projection.history.length ||
      projection.invocations
        .filter((entry) => entry.kind === "review")
        .some(
          (entry, index) =>
            entry.attempt !== index + 1 ||
            entry.revision !== projection.history[index]?.revision,
        ) ||
      projection.invocations.some(
        (entry) => entry.kind !== "review" && entry.attempt !== null,
      )
    )
      context.addIssue({
        code: "custom",
        message: "noncontiguous policy history",
      });
  });
type Projection = z.infer<typeof projectionSchema>;
type Invocation = z.infer<typeof invocationSchema>;

function snapshot<T>(value: T): T {
  const copy = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (!item || typeof item !== "object") return;
    for (const child of Object.values(item)) freeze(child);
    Object.freeze(item);
  };
  freeze(copy);
  return copy;
}

function acceptedTask(
  run: OrchestrationHostRunContext,
  request: OrchestrationWorkerRequest,
): OrchestrationTask {
  const key = taskKey(request.task);
  const accepted = run.journal
    .catalog(run.runId)
    .tasks.find((task) => taskKey(task) === key);
  const state = run.journal
    .states(run.runId)
    .find((entry) => entry.key === key);
  if (!accepted || !state) throw new Error("accepted task unavailable");
  const effective =
    state.pullRequest === undefined
      ? accepted
      : { ...accepted, pullRequest: state.pullRequest };
  if (!isDeepStrictEqual(effective, request.task))
    throw new Error(
      "request differs from accepted task or registered pull request",
    );
  return snapshot(accepted);
}

class Reservation {
  private version: number;
  private projection: Projection;
  readonly attempt: number;
  readonly history: Projection["history"];
  readonly intent: string;
  private readonly key: string;

  constructor(
    private readonly run: OrchestrationHostRunContext,
    request: OrchestrationWorkerRequest,
    policy: CoworkReviewPolicy,
    private readonly id: string,
    kind: Invocation["kind"],
    revision: string,
    context: unknown,
    private readonly signal: AbortSignal,
  ) {
    const scope = digest({ run: run.runId, task: taskKey(request.task) });
    this.key = `cowork-policy:${scope}`;
    this.intent = digest({
      run: run.runId,
      task: taskKey(request.task),
      acceptedTask: acceptedTask(run, request),
      project: request.project,
      policy,
    });
    const record = run.journal.readHostRecord(this.key);
    this.version = record.version;
    this.projection =
      record.version === 0
        ? {
            schema: 1,
            scope,
            definition: this.intent,
            history: [],
            invocations: [],
          }
        : projectionSchema.parse(record.value);
    if (
      this.projection.scope !== scope ||
      this.projection.definition !== this.intent
    )
      throw new Error(
        "accepted task or policy changed; explicit reconciliation required",
      );
    if (
      this.projection.invocations.some((entry) => entry.status !== "completed")
    )
      throw new Error(
        "unresolved policy invocation; explicit reconciliation required",
      );
    if (this.projection.invocations.some((entry) => entry.id === id))
      throw new Error(
        "completed exact policy invocation requires reconciliation",
      );
    this.history = snapshot(this.projection.history);
    this.attempt = this.history.length + 1;
    const next = structuredClone(this.projection);
    if (kind === "review")
      next.history.push({
        intent: this.intent,
        revision,
        attempt: this.attempt,
        blockingSignature: null,
      });
    next.invocations.push({
      id,
      kind,
      revision,
      attempt: kind === "review" ? this.attempt : null,
      status: "reserved",
      context: jsonSnapshot(context),
      evidence: [],
      result: null,
    });
    this.save(next, "reserved");
  }

  private save(next: Projection, kind: string): void {
    this.signal.throwIfAborted();
    const projection = projectionSchema.parse(jsonSnapshot(next));
    if (
      !this.run.journal.compareAndSwapHostRecord(
        this.run.runId,
        this.run.lease,
        this.key,
        this.version,
        projection,
        { kind, invocation: this.id },
      )
    )
      throw new Error("policy projection CAS conflict");
    this.version += 1;
    this.projection = projection;
    this.signal.throwIfAborted();
  }

  add(kind: string, value: unknown): void {
    const next = structuredClone(this.projection);
    next.invocations
      .at(-1)!
      .evidence.push({ kind, value: jsonSnapshot(value) });
    this.save(next, kind);
  }

  finish(
    result: unknown,
    uncertain: boolean,
    blockingSignature: string | null = null,
  ): void {
    const next = structuredClone(this.projection);
    const entry = next.invocations.at(-1)!;
    entry.status = uncertain ? "unknown" : "completed";
    entry.result = jsonSnapshot(result);
    if (entry.attempt !== null)
      next.history[entry.attempt - 1]!.blockingSignature = blockingSignature;
    this.save(next, "outcome");
  }

  artifact(): string {
    return JSON.stringify(this.projection.invocations.at(-1));
  }
}

const unknownReceipt = (): OrchestrationWorkerReceipt => ({
  kind: "unknown",
  reason: "cowork policy evidence unresolved; explicit reconciliation required",
});
const policyEvidence = (
  state: OrchestrationPolicyEvidence["state"],
  revision: string,
  evidence: string,
  evaluatedScope = 0,
  checks: OrchestrationPolicyEvidence["checks"] = [],
): OrchestrationPolicyEvidence => ({
  state,
  revision,
  evaluatedScope,
  checks,
  evidence,
});

const stageForPhase: Partial<
  Record<OrchestrationWorkerRequest["stage"], CoworkCriticStage>
> = {
  specify: "research",
  plan: "design",
  decompose: "design",
  implement: "build",
  fix: "build",
};
const governanceSchema = z
  .object({
    state: z.enum(["passed", "failed"]),
    evaluatedScope: z.number().int().nonnegative(),
    checks: z.array(
      z
        .object({
          name: z.string().min(1),
          state: z.enum(["passed", "failed"]),
          evidence: z.array(z.string().min(1)),
        })
        .strict(),
    ),
  })
  .strict();

/** Adds engineering gates only. The existing trusted host still owns authority. */
export function createCoworkOrchestrationHost(
  options: CoworkOrchestrationHostOptions,
): MultiProjectHost {
  const trustedHost = options.host;
  const policy = snapshot(options.policy);
  if (
    policy.routing.requiredDiversity !== true ||
    !Number.isInteger(policy.maxAttempts) ||
    policy.maxAttempts < 2 ||
    policy.maxAttempts > 3 ||
    !Number.isInteger(policy.repeatedSignatureLimit) ||
    policy.repeatedSignatureLimit < 2 ||
    policy.repeatedSignatureLimit > policy.maxAttempts
  )
    throw new Error("explicit diverse bounded cowork policy required");
  const classify = options.classify;
  const review = Object.freeze({ ...options.review });
  const stage = Object.freeze({ ...options.stage });
  const governance =
    options.governance && Object.freeze({ ...options.governance });
  for (const callback of [
    classify,
    review.authorizeReview,
    review.executeReview,
    review.attestReview,
    review.verifyHumanApproval,
    stage.authorize,
    stage.execute,
    stage.attest,
  ])
    if (typeof callback !== "function")
      throw new Error("trusted cowork callbacks required");

  const wrap = (
    base: MultiProjectHost,
    run?: OrchestrationHostRunContext,
  ): MultiProjectHost => {
    const catalog = run && snapshot(run.journal.catalog(run.runId));
    const resolve = (
      request: OrchestrationWorkerRequest,
      signal: AbortSignal,
    ): Promise<string> =>
      base.resolveRevision(
        catalog?.projects.find(
          (project) => project.id === request.project.id,
        ) ??
          (() => {
            throw new Error("accepted project unavailable");
          })(),
        request.task,
        signal,
        request.baseRevision,
      );
    const currentContext = async (
      request: OrchestrationWorkerRequest,
      revision: string,
      signal: AbortSignal,
    ): Promise<Omit<CoworkReviewContext, "intent">> => {
      const accepted = run && acceptedTask(run, request);
      const project = catalog?.projects.find(
        (entry) => entry.id === request.project.id,
      );
      if (
        !accepted ||
        !project ||
        project.repositoryRoot !== request.project.repositoryRoot ||
        request.task.projectId !== project.id
      )
        throw new Error("request differs from accepted catalog");
      const classification = classificationSchema.parse(
        await classify(snapshot(request), revision, signal),
      );
      signal.throwIfAborted();
      return snapshot({
        revision,
        projectId: request.project.id,
        taskId: request.task.id,
        author: classification.author,
        risk: classification.risk,
        changedFiles: classification.changedFiles,
        artifacts: Object.fromEntries([
          ...Object.entries(request.artifacts).map(([name, artifact]) => [
            name,
            digest(artifact),
          ]),
          ["host-request", request.intent],
        ]),
        contracts: request.contracts,
      });
    };

    const reviewWorker = async (
      request: OrchestrationWorkerRequest,
      signal: AbortSignal,
    ): Promise<OrchestrationWorkerReceipt> => {
      if (!run) return unknownReceipt();
      let reservation: Reservation | undefined;
      try {
        const revision = revisionSchema.parse(await resolve(request, signal));
        const context = await currentContext(request, revision, signal);
        reservation = new Reservation(
          run,
          request,
          policy,
          `review:${request.invocation}`,
          "review",
          revision,
          { request, context },
          signal,
        );
        const bound = reservation;
        const fullContext = snapshot({ ...context, intent: bound.intent });
        let audited = false;
        const result = await runCoworkReview(
          fullContext,
          policy,
          {
            authorizeReview: async (invocation, s) => {
              s.throwIfAborted();
              const allowed = await review.authorizeReview(
                invocation,
                s,
                request,
              );
              bound.add("authorization", { pass: invocation.pass, allowed });
              return allowed === true;
            },
            executeReview: async (invocation, s) => {
              bound.add("review-dispatch", invocation);
              const receipt = await review.executeReview(
                invocation,
                s,
                request,
              );
              bound.add("unverified-review-receipt", receipt);
              return receipt;
            },
            attestReview: async (invocation, receipt, s) => {
              const attested = await review.attestReview(
                invocation,
                receipt,
                s,
                request,
              );
              bound.add("review-attestation", {
                pass: invocation.pass,
                attested,
              });
              return attested === true;
            },
            resolveRevision: async (_, s) => resolve(request, s),
            verifyHumanApproval: async (c, reviewers, s) => {
              const approved = await review.verifyHumanApproval(
                c,
                reviewers,
                s,
                request,
              );
              bound.add("human-approval", { context: c, reviewers, approved });
              return approved === true;
            },
            audit: async (audit) => {
              bound.add("review-audit", audit);
              audited = true;
            },
          },
          bound.history,
          signal,
        );
        const uncertain =
          result.state === "unknown" ||
          result.state === "stale" ||
          signal.aborted;
        bound.finish(result, uncertain, result.blockingSignature);
        if (uncertain) return unknownReceipt();
        if (result.state === "ready" && audited)
          return parseWorkerReceipt({
            kind: "completed",
            artifact: bound.artifact(),
            contracts: {},
            findings: [],
          });
        const blocking = result.findings.filter(
          (finding) => finding.category !== "advisory",
        );
        if (
          result.state === "blocked" &&
          result.reason === "blocking-findings" &&
          audited &&
          blocking.length > 0
        )
          return parseWorkerReceipt({
            kind: "completed",
            artifact: bound.artifact(),
            contracts: {},
            findings: [
              ...new Set(
                blocking.map(
                  (finding) =>
                    `${finding.category}:${finding.signature} evidence:${finding.evidence}`,
                ),
              ),
            ].sort(),
          });
        return {
          kind: "failed",
          signature: `cowork-${result.state}`,
          evidence: result.reason,
        };
      } catch {
        try {
          reservation?.finish(
            { state: "unknown", reason: "adapter-evidence-unconfirmed" },
            true,
          );
        } catch {
          /* Original reservation remains unresolved. */
        }
        return unknownReceipt();
      }
    };

    const critic = async (
      request: OrchestrationWorkerRequest,
      revision: string,
      artifact: unknown,
      criticStage: CoworkCriticStage,
      signal: AbortSignal,
      validation?: OrchestrationValidationEvidence,
    ): Promise<OrchestrationPolicyEvidence> => {
      if (!run)
        return policyEvidence("unknown", revision, "unbound cowork policy");
      let reservation: Reservation | undefined;
      try {
        const context = await currentContext(
          request,
          revisionSchema.parse(revision),
          signal,
        );
        reservation = new Reservation(
          run,
          request,
          policy,
          `${validation ? "verification" : "phase"}:${request.invocation}`,
          validation ? "verification" : "phase",
          revision,
          {
            request,
            context,
            artifact,
            sourceRevision: revision,
            validation: validation ?? null,
          },
          signal,
        );
        const bound = reservation;
        const producer = snapshot({ request, artifact, revision });
        // The producer's real artifact and independently resolved source precede any external critic.
        bound.add("producer-evidence", { artifact, revision });
        if (
          validation &&
          (validation.evaluatedScope <= 0 ||
            validation.checks.length === 0 ||
            validation.revision !== revision ||
            validation.checks.some((check) => check.state !== "passed"))
        )
          throw new Error("non-vacuous measured acceptance evidence required");
        let governanceResult: CoworkGovernanceResult | undefined;
        if (validation && governance) {
          bound.add("governance-collection-reserved", { revision });
          const collected = jsonSnapshot(
            await governance.collect(
              snapshot(request),
              snapshot(validation),
              signal,
            ),
          );
          bound.add("governance-applicability", collected);
          governanceResult = governanceSchema.parse(
            await governance.evaluate(snapshot(collected), signal),
          );
          bound.add("governance-evaluation", governanceResult);
          if (
            governanceResult.evaluatedScope <= 0 ||
            governanceResult.checks.length === 0 ||
            new Set(governanceResult.checks.map((check) => check.name)).size !==
              governanceResult.checks.length ||
            (governanceResult.state === "passed" &&
              governanceResult.checks.some(
                (check) => check.state !== "passed",
              )) ||
            (governanceResult.state === "failed" &&
              !governanceResult.checks.some(
                (check) => check.state === "failed",
              ))
          )
            throw new Error("non-vacuous governance evidence required");
          if (governanceResult.state === "failed") {
            const state =
              (await resolve(request, signal)) === revision
                ? "blocked"
                : "stale";
            const result = policyEvidence(
              state,
              revision,
              "applicable governance blocked",
              governanceResult.evaluatedScope,
              governanceResult.checks.map((check) => ({
                name: `cowork-governance:${check.name}`,
                state: check.state,
                evidence: check.evidence.join("\n"),
              })),
            );
            bound.finish(result, state === "stale");
            return result;
          }
        }
        const result = await runCoworkStageCritic(
          {
            stage: criticStage,
            intent: bound.intent,
            revision,
            artifact: digest({
              artifact,
              context,
              hostRequest: request.intent,
            }),
            author: context.author,
            contracts: request.contracts,
          },
          policy.routing,
          {
            authorize: async (invocation, s) => {
              s.throwIfAborted();
              const allowed = await stage.authorize(invocation, s, producer);
              bound.add("critic-authorization", { invocation, allowed });
              return allowed === true;
            },
            execute: async (invocation, s) => {
              bound.add("critic-dispatch", invocation);
              const receipt = await stage.execute(invocation, s, producer);
              bound.add("unverified-critic-receipt", receipt);
              return receipt;
            },
            attest: async (invocation, receipt, s) => {
              const attested = await stage.attest(
                invocation,
                receipt,
                s,
                producer,
              );
              bound.add("critic-attestation", { attested });
              return attested === true;
            },
            resolveRevision: async (_, s) => resolve(request, s),
            audit: async (criticRequest, outcome) =>
              bound.add("critic-audit", { request: criticRequest, outcome }),
          },
          signal,
        );
        let state = result.state;
        let reason = result.reason;
        if (
          state === "passed" &&
          context.risk === "critical" &&
          result.receipt
        ) {
          const approvalContext = snapshot({
            ...context,
            intent: bound.intent,
          });
          const approved = await review.verifyHumanApproval(
            approvalContext,
            [result.receipt.critic],
            signal,
            request,
          );
          bound.add("human-approval", {
            context: approvalContext,
            reviewers: [result.receipt.critic],
            approved,
          });
          if (approved !== true) {
            state = "needs-human";
            reason = "critical-human-gate";
          }
        }
        if ((await resolve(request, signal)) !== revision) state = "stale";
        const checks = [
          ...(validation?.checks ?? []),
          ...(governanceResult?.checks.map((check) => ({
            name: `cowork-governance:${check.name}`,
            state: check.state,
            evidence: check.evidence.join("\n"),
          })) ?? []),
          {
            name: `cowork-${criticStage}`,
            state:
              state === "passed"
                ? ("passed" as const)
                : state === "blocked" || state === "needs-human"
                  ? ("failed" as const)
                  : ("unknown" as const),
            evidence: reason,
          },
        ];
        const evidence = policyEvidence(
          state,
          revision,
          reason,
          validation?.evaluatedScope ?? (result.receipt ? 1 : 0),
          checks,
        );
        bound.finish(
          evidence,
          state === "unknown" || state === "stale" || signal.aborted,
        );
        return signal.aborted
          ? policyEvidence("unknown", revision, "cancelled")
          : evidence;
      } catch {
        try {
          reservation?.finish(
            { state: "unknown", reason: "adapter-evidence-unconfirmed" },
            true,
          );
        } catch {
          /* Keep the reserved external outcome. */
        }
        return policyEvidence(
          "unknown",
          revision,
          "cowork policy evidence unresolved",
        );
      }
    };

    const compose = async (
      inherited: OrchestrationPolicyEvidence | undefined,
      revision: string,
      evaluate: () => Promise<OrchestrationPolicyEvidence>,
    ): Promise<OrchestrationPolicyEvidence> => {
      if (inherited) {
        if (inherited.state !== "passed") return inherited;
        if (
          inherited.revision !== revision ||
          !Number.isSafeInteger(inherited.evaluatedScope) ||
          inherited.evaluatedScope <= 0 ||
          !Array.isArray(inherited.checks) ||
          inherited.checks.length === 0 ||
          new Set(inherited.checks.map((check) => check.name)).size !==
            inherited.checks.length ||
          inherited.checks.some((check) => check.state !== "passed") ||
          !inherited.evidence?.trim()
        )
          return policyEvidence(
            "unknown",
            revision,
            "inherited host policy lacks current non-vacuous evidence",
          );
      }
      const own = await evaluate();
      return inherited
        ? {
            ...own,
            checks: [
              ...inherited.checks.map((check) => ({
                ...check,
                name: `inherited:${check.name}`,
              })),
              ...own.checks,
            ],
            evidence: JSON.stringify({ inherited, cowork: own.evidence }),
          }
        : own;
    };

    return {
      bindRun(context) {
        const captured = Object.freeze({
          runId: context.runId,
          journal: context.journal,
          lease: Object.freeze({ ...context.lease }),
        });
        return wrap(trustedHost.bindRun?.(captured) ?? trustedHost, captured);
      },
      authorize: (request, signal) => base.authorize(request, signal),
      execute: (request, signal) =>
        request.stage === "review"
          ? reviewWorker(snapshot(request), signal)
          : base.execute(request, signal),
      resolveRevision: (project, task, signal, baseRevision) =>
        base.resolveRevision(project, task, signal, baseRevision),
      validate: (request, signal) => base.validate(request, signal),
      observe: (project, task, signal) => base.observe(project, task, signal),
      async assessPhase(request, receipt, revision, signal) {
        const selected = stageForPhase[request.stage];
        if (!selected)
          return policyEvidence(
            "passed",
            revision,
            "review evidence handled by execute wrapper",
          );
        return compose(
          await base.assessPhase?.(request, receipt, revision, signal),
          revision,
          () => critic(snapshot(request), revision, receipt, selected, signal),
        );
      },
      async validatePolicy(request, evidence, signal) {
        return compose(
          await base.validatePolicy?.(request, evidence, signal),
          evidence.revision,
          () =>
            critic(
              snapshot(request),
              evidence.revision,
              evidence,
              "verification",
              signal,
              snapshot(evidence),
            ),
        );
      },
    };
  };
  return wrap(trustedHost);
}
