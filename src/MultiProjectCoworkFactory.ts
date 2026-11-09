import { z } from "zod";
import {
  coworkContractChangeSchema,
  coworkCompatibilityTask,
  evaluateCoworkImpact,
  persistCoworkImpact,
  type CoworkCompatibilityTask,
  type CoworkConsumerMapping,
  type CoworkContractChange,
  type CoworkImpactHost,
} from "./CoworkFactoryImpact.js";
import {
  coworkDigest,
  coworkFactoryRecordSchema,
  coworkFreeze,
  coworkTimeSchema,
  type CoworkFactoryStore,
  type CoworkEvidence,
  type CoworkRule,
  type CoworkCandidate,
  coworkEvidenceSchema,
} from "./CoworkFactoryContract.js";
import {
  proposeCoworkItem,
  publishCoworkItem,
  type CoworkItemHost,
  intakeCoworkSignal,
} from "./CoworkFactory.js";
import type {
  MultiProjectHost,
  OrchestrationHostRunContext,
  OrchestrationPolicyEvidence,
  OrchestrationValidationEvidence,
} from "./MultiProjectOrchestrator.js";
import {
  parseOrchestrationTasks,
  digest,
  taskKey,
  type OrchestrationProject,
  type OrchestrationTask,
  type OrchestrationTaskState,
  type OrchestrationWorkerRequest,
} from "./MultiProjectProtocol.js";

/** Each instance captures the original pass fence, never a mutable current lease. */
export function createCoworkJournalStore(
  context: OrchestrationHostRunContext,
): CoworkFactoryStore {
  const { journal, runId } = context;
  const lease = Object.freeze({ ...context.lease });
  const keyPattern = /^factory:[a-f0-9]{64}$/;
  return {
    async read(key) {
      if (!keyPattern.test(key)) throw new Error("Invalid factory record key");
      const row = journal.readHostRecord(key);
      if (row.value !== null) coworkFactoryRecordSchema.parse(row.value);
      return row;
    },
    async compareAndSwap(key, version, record, event) {
      if (!keyPattern.test(key)) throw new Error("Invalid factory record key");
      const snapshot = coworkFreeze(coworkFactoryRecordSchema.parse(record));
      coworkTimeSchema.parse(event.at);
      if (
        event.kind !== snapshot.kind ||
        event.intent !== snapshot.intent ||
        event.recordDigest !== coworkDigest(snapshot)
      )
        throw new Error("Factory event does not bind its record");
      return journal.compareAndSwapHostRecord(
        runId,
        lease,
        key,
        version,
        snapshot,
        { kind: `factory-${event.kind}`, factory: event },
      );
    },
  };
}

export interface CoworkCompatibilityRoute {
  readonly mapping: CoworkConsumerMapping;
  readonly scopes: readonly string[];
  readonly baseBranch: string;
  readonly acceptance: readonly { label: string; command: string }[];
}

export interface CoworkChangeRequestReceipt {
  readonly pullRequest: number;
  readonly revision: string;
  readonly intent: string;
  readonly url: string;
}

export interface CoworkOrchestrationFactoryOptions {
  readonly base: MultiProjectHost;
  readonly routes: readonly CoworkCompatibilityRoute[];
  readonly impactHost: CoworkImpactHost;
  readonly itemHost: CoworkItemHost;
  readonly inspectChange: (
    project: OrchestrationProject,
    task: OrchestrationTask,
    state: OrchestrationTaskState,
    signal: AbortSignal,
  ) => Promise<
    CoworkContractChange | { state: "unaffected" | "unknown"; evidence: string }
  >;
  readonly authorizeRegistration: (
    task: CoworkCompatibilityTask,
    route: CoworkCompatibilityRoute,
    signal: AbortSignal,
  ) => Promise<boolean>;
  readonly observeSourceItem: NonNullable<
    MultiProjectHost["observeSourceItem"]
  >;
  readonly changeRequests: {
    authorize(
      request: OrchestrationWorkerRequest,
      intent: string,
      signal: AbortSignal,
    ): Promise<boolean>;
    create(
      request: OrchestrationWorkerRequest,
      intent: string,
      signal: AbortSignal,
    ): Promise<
      | { state: "completed"; receipt: CoworkChangeRequestReceipt }
      | { state: "unknown" | "failed" }
    >;
    attest(
      request: OrchestrationWorkerRequest,
      receipt: CoworkChangeRequestReceipt,
      signal: AbortSignal,
    ): Promise<boolean>;
  };
  /** Configure executed measured gates here; a missing capability fails closed for generated work. */
  readonly validateTask?: (
    request: OrchestrationWorkerRequest,
    evidence: OrchestrationValidationEvidence,
    store: CoworkFactoryStore,
    signal: AbortSignal,
  ) => Promise<OrchestrationPolicyEvidence>;
  /** Read-only merged/release/first-ring observation, never a deployment method. */
  readonly observeRelease?: (
    project: OrchestrationProject,
    task: OrchestrationTask,
    state: OrchestrationTaskState,
    store: CoworkFactoryStore,
    signal: AbortSignal,
  ) => Promise<OrchestrationPolicyEvidence>;
  readonly maxDepth?: number;
  readonly maxBudget?: number;
  readonly maxAgeMs?: number;
  readonly signals?: {
    read(signal: AbortSignal): Promise<readonly CoworkEvidence[]>;
    readonly routes: readonly {
      readonly rule: CoworkRule;
      readonly scopes: readonly string[];
      readonly baseBranch: string;
      readonly acceptance: readonly { label: string; command: string }[];
    }[];
    authorizeRegistration(
      candidate: CoworkCandidate,
      signal: AbortSignal,
    ): Promise<boolean>;
  };
}

const registrationSchema = z.strictObject({
  intent: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.enum(["reserved", "completed", "unknown", "blocked"]),
  receipt: z
    .strictObject({
      pullRequest: z.number().int().positive(),
      revision: z.string().regex(/^[a-f0-9]{40}([a-f0-9]{24})?$/),
      intent: z.string().regex(/^[a-f0-9]{64}$/),
      url: z
        .string()
        .url()
        .refine((value) => {
          const url = new URL(value);
          return (
            url.protocol === "https:" &&
            !url.username &&
            !url.password &&
            !url.search &&
            !url.hash
          );
        }),
    })
    .optional(),
});

export function createCoworkOrchestrationFactory(
  options: CoworkOrchestrationFactoryOptions,
): MultiProjectHost {
  const routes = coworkFreeze(options.routes);
  const signals = options.signals
    ? Object.freeze({
        read: options.signals.read,
        authorizeRegistration: options.signals.authorizeRegistration,
        routes: coworkFreeze(options.signals.routes),
      })
    : undefined;
  if (
    signals &&
    (signals.routes.length < 1 ||
      signals.routes.length > 100 ||
      new Set(
        signals.routes.map(
          (route) =>
            `${route.rule.project}:${route.rule.id}:${route.rule.version}`,
        ),
      ).size !== signals.routes.length)
  )
    throw new Error("Signal routes require nonzero unambiguous rule scope");
  const routeIds = new Set<string>();
  const edges = new Map<string, string[]>();
  for (const route of routes) {
    const identity = `${route.mapping.producer}:${route.mapping.consumer}:${route.mapping.contract}:${route.mapping.rule.id}`;
    if (routeIds.has(identity))
      throw new Error("Ambiguous compatibility route");
    routeIds.add(identity);
    edges.set(route.mapping.producer, [
      ...(edges.get(route.mapping.producer) ?? []),
      route.mapping.consumer,
    ]);
  }
  const visiting = new Set<string>(),
    visited = new Set<string>();
  const visit = (project: string): void => {
    if (visiting.has(project)) throw new Error("Compatibility route cycle");
    if (visited.has(project)) return;
    visiting.add(project);
    for (const consumer of edges.get(project) ?? []) visit(consumer);
    visiting.delete(project);
    visited.add(project);
  };
  for (const project of edges.keys()) visit(project);
  const maxBudget = options.maxBudget ?? 8;
  if (!Number.isSafeInteger(maxBudget) || maxBudget < 1 || maxBudget > 1000)
    throw new Error("Invalid propagation budget");
  const unbound = (): never => {
    throw new Error("Cowork factory requires a fenced orchestration run");
  };
  return {
    ...options.base,
    afterTask: unbound,
    registerChangeRequest: unbound,
    bindRun(context) {
      const lease = Object.freeze({ ...context.lease });
      const fixed = Object.freeze({ ...context, lease });
      const base = options.base.bindRun?.(fixed) ?? options.base;
      const store = createCoworkJournalStore(fixed);
      const { journal, runId } = fixed;
      const active = journal.catalog(runId);
      for (const route of routes) {
        const producer = active.projects.find(
          (project) => project.id === route.mapping.producer,
        );
        const consumer = active.projects.find(
          (project) => project.id === route.mapping.consumer,
        );
        const target = route.mapping.target;
        if (
          !producer ||
          !consumer ||
          producer.mode !== "integrated" ||
          consumer.mode !== "integrated"
        )
          throw new Error(
            "Compatibility routes require configured integrated projects",
          );
        if (
          target.provider === "github"
            ? consumer.hub.kind !== "github" ||
              consumer.hub.repository !== target.repository
            : consumer.hub.kind !== "ado" ||
              consumer.hub.organization !== target.organization ||
              consumer.hub.project !== target.project
        )
          throw new Error(
            "Compatibility route target differs from configured hub",
          );
      }
      const result = (
        revision: string,
        evidence: string,
        state: OrchestrationPolicyEvidence["state"] = "passed",
      ): OrchestrationPolicyEvidence => ({
        state,
        revision,
        evaluatedScope: 1,
        checks: [
          {
            name: "factory-route",
            state:
              state === "passed"
                ? "passed"
                : state === "unknown"
                  ? "unknown"
                  : "failed",
          },
        ],
        evidence,
      });
      const retainedPublication = async (
        task: OrchestrationTask,
        signal: AbortSignal,
      ): Promise<boolean> => {
        if (!task.sourceItem) return false;
        const cause = task.sourceItem.cause;
        const row = await store.read(cause.recordKey);
        const record = coworkFactoryRecordSchema.safeParse(row.value);
        return (
          row.version === cause.recordVersion &&
          digest(row.value) === cause.recordDigest &&
          record.success &&
          record.data.kind === "publication" &&
          record.data.state === "completed" &&
          !!record.data.receipt &&
          record.data.receipt.id === task.sourceItem.id &&
          record.data.receipt.url === task.sourceItem.url &&
          record.data.proposal.candidate.project === task.projectId &&
          (await options.itemHost.verifyReceipt(
            record.data.proposal,
            record.data.receipt,
            signal,
          ))
        );
      };
      return {
        ...base,
        observeSourceItem: options.observeSourceItem,
        ...(signals
          ? {
              async beforeTasks(
                signal: AbortSignal,
              ): Promise<OrchestrationPolicyEvidence> {
                const inherited = await base.beforeTasks?.(signal);
                if (inherited && inherited.state !== "passed") return inherited;
                const stream = await signals.read(signal);
                if (!Array.isArray(stream) || stream.length > 1000)
                  return result("", "Signal stream is invalid", "unknown");
                if (!coworkEvidenceSchema.array().safeParse(stream).success)
                  return result("", "Signal evidence is malformed", "unknown");
                const now = new Date().toISOString();
                for (const route of signals.routes) {
                  const project = active.projects.find(
                    (item) => item.id === route.rule.project,
                  );
                  const target = route.rule.target;
                  if (
                    !project ||
                    (target.provider === "github"
                      ? project.hub.kind !== "github" ||
                        project.hub.repository !== target.repository
                      : project.hub.kind !== "ado" ||
                        project.hub.organization !== target.organization ||
                        project.hub.project !== target.project)
                  )
                    return result(
                      "",
                      "Signal route does not match configured project",
                      "blocked",
                    );
                  for (const evidence of stream.filter(
                    (item) =>
                      item.project === route.rule.project &&
                      item.source === route.rule.source &&
                      item.metric === route.rule.metric,
                  )) {
                    const intake = await intakeCoworkSignal(
                      { evidence, rule: route.rule, now },
                      store,
                    );
                    if (intake.state === "blocked" || !intake.persisted)
                      return result(
                        evidence.revision,
                        intake.state === "candidate"
                          ? "Signal persistence failed"
                          : intake.reason,
                        "blocked",
                      );
                    if (intake.state !== "candidate") continue;
                    const candidate = intake.candidate;
                    const proposal = proposeCoworkItem(candidate);
                    const publication = await publishCoworkItem(proposal, {
                      mode: "publish",
                      now,
                      store,
                      host: options.itemHost,
                      signal,
                    });
                    if (publication.state !== "completed")
                      return result(
                        evidence.revision,
                        publication.state === "preview"
                          ? "Signal only previewed"
                          : publication.reason,
                        publication.state === "unknown" ? "unknown" : "blocked",
                      );
                    if (
                      !(await signals.authorizeRegistration(candidate, signal))
                    )
                      return result(
                        evidence.revision,
                        "Signal task registration denied",
                        "blocked",
                      );
                    const row = await store.read(publication.recordKey);
                    const retained = coworkFactoryRecordSchema.safeParse(
                      row.value,
                    );
                    if (
                      row.version !== publication.recordVersion ||
                      coworkDigest(row.value) !== publication.recordDigest ||
                      !retained.success ||
                      retained.data.kind !== "publication" ||
                      retained.data.state !== "completed" ||
                      coworkDigest(retained.data.proposal) !==
                        coworkDigest(proposal)
                    )
                      return result(
                        evidence.revision,
                        "Signal publication changed before scheduling",
                        "unknown",
                      );
                    if (
                      signal.aborted ||
                      !(await options.itemHost.verifyEvidence(
                        candidate,
                        signal,
                      )) ||
                      !(await options.itemHost.authorize(proposal, signal)) ||
                      !(await options.itemHost.verifyReceipt(
                        proposal,
                        publication.receipt,
                        signal,
                      ))
                    )
                      return result(
                        evidence.revision,
                        "Signal scheduling provenance or authority is unavailable",
                        "blocked",
                      );
                    const cause = {
                      recordKey: publication.recordKey,
                      recordVersion: row.version,
                      recordDigest: digest(row.value),
                    };
                    journal.appendCatalogTasks(
                      runId,
                      lease,
                      parseOrchestrationTasks([
                        {
                          id: `signal-${candidate.key.slice(0, 40)}`,
                          projectId: candidate.project,
                          title: proposeCoworkItem(candidate).title,
                          brief: proposeCoworkItem(candidate).body,
                          branch: `signal/${candidate.key}`,
                          baseBranch: route.baseBranch,
                          scopes: [...route.scopes],
                          dependsOn: [],
                          requiresContracts: [],
                          providesContracts: [],
                          acceptance: [...route.acceptance],
                          labels: [],
                          sourceItem: {
                            provider: candidate.target.provider,
                            id: publication.receipt.id,
                            url: publication.receipt.url,
                            cause,
                          },
                        },
                      ]),
                      cause,
                    );
                  }
                }
                return {
                  ...result(
                    stream[0]?.revision ?? "0".repeat(40),
                    `Evaluated ${signals.routes.length} signal rules against ${stream.length} retained inputs`,
                  ),
                  evaluatedScope: signals.routes.length,
                };
              },
            }
          : {}),
        async validatePolicy(request, evidence, signal) {
          const upstream = await base.validatePolicy?.(
            request,
            evidence,
            signal,
          );
          if (upstream && upstream.state !== "passed") return upstream;
          if (!options.validateTask)
            return request.task.sourceItem
              ? result(
                  evidence.revision,
                  "Executed negative-control capability is unavailable",
                  "blocked",
                )
              : (upstream ??
                  result(
                    evidence.revision,
                    "No generated-task measured gate applies",
                  ));
          const measured = await options.validateTask(
            request,
            evidence,
            store,
            signal,
          );
          return upstream && measured.state === "passed"
            ? {
                ...measured,
                evaluatedScope:
                  measured.evaluatedScope + upstream.evaluatedScope,
                checks: [...upstream.checks, ...measured.checks],
                evidence: `${upstream.evidence}; ${measured.evidence}`,
              }
            : measured;
        },
        async registerChangeRequest(request, signal) {
          const task = request.task;
          if (!(await retainedPublication(task, signal)))
            return {
              state: "blocked",
              evidence: "Source item publication is not retained and attested",
            };
          const intent = coworkDigest({
            task: taskKey(task),
            source: task.sourceItem,
            branch: task.branch,
            revision: request.revision,
            baseRevision: request.baseRevision,
            artifacts: request.artifacts,
          });
          const key = `change-request:${coworkDigest({ runId, task: taskKey(task), source: task.sourceItem })}`;
          const prior = journal.readHostRecord(key);
          if (prior.value !== null) {
            const record = registrationSchema.parse(prior.value);
            if (record.intent !== intent)
              return {
                state: "unknown",
                evidence:
                  "Immutable change request intent differs; explicit reconciliation required",
              };
            if (
              record.state === "completed" &&
              record.receipt &&
              (await options.changeRequests.attest(
                request,
                record.receipt,
                signal,
              ))
            )
              return { state: "registered", ...record.receipt, evidence: key };
            return {
              state: record.state === "blocked" ? "blocked" : "unknown",
              evidence: "Retained registration cannot be redispatched",
            };
          }
          const reserved = { intent, state: "reserved" as const };
          if (
            !journal.compareAndSwapHostRecord(runId, lease, key, 0, reserved, {
              kind: "change-request-reserved",
            })
          )
            return {
              state: "unknown",
              evidence: "Change request reservation conflict",
            };
          if (
            !(await options.changeRequests.authorize(request, intent, signal))
          ) {
            journal.compareAndSwapHostRecord(
              runId,
              lease,
              key,
              1,
              { intent, state: "blocked" },
              { kind: "change-request-denied" },
            );
            return {
              state: "blocked",
              evidence: "Host denied change request publication",
            };
          }
          let outcome: Awaited<
            ReturnType<typeof options.changeRequests.create>
          >;
          try {
            outcome = await options.changeRequests.create(
              request,
              intent,
              signal,
            );
          } catch {
            return {
              state: "unknown",
              evidence: "Change request transport outcome is unresolved",
            };
          }
          if (
            outcome.state !== "completed" ||
            signal.aborted ||
            outcome.receipt.intent !== intent ||
            outcome.receipt.revision !== request.revision ||
            !registrationSchema.safeParse({
              intent,
              state: "completed",
              receipt: outcome.receipt,
            }).success ||
            !(await options.changeRequests.attest(
              request,
              outcome.receipt,
              signal,
            ))
          ) {
            journal.compareAndSwapHostRecord(
              runId,
              lease,
              key,
              1,
              { intent, state: "unknown" },
              { kind: "change-request-unknown" },
            );
            return {
              state: "unknown",
              evidence:
                "Change request creation lacks independent current attestation",
            };
          }
          if (
            !journal.compareAndSwapHostRecord(
              runId,
              lease,
              key,
              1,
              { intent, state: "completed", receipt: outcome.receipt },
              { kind: "change-request-completed" },
            )
          )
            return {
              state: "unknown",
              evidence: "Change request receipt checkpoint failed",
            };
          return { state: "registered", ...outcome.receipt, evidence: key };
        },
        async afterTask(project, task, state, signal) {
          const inherited = await base.afterTask?.(
            project,
            task,
            state,
            signal,
          );
          if (inherited && inherited.state !== "passed") return inherited;
          const relevant = routes.filter(
            (route) => route.mapping.producer === project.id,
          );
          if (relevant.length) {
            const input = await options.inspectChange(
              project,
              task,
              state,
              signal,
            );
            if (
              !input ||
              ("state" in input &&
                (input.state !== "unaffected" || !input.evidence))
            )
              return result(
                state.revision!,
                input && "evidence" in input
                  ? input.evidence
                  : "Impact evidence is unavailable",
                "unknown",
              );
            if (!("state" in input)) {
              let change = coworkContractChangeSchema.parse(input);
              if (
                change.project !== project.id ||
                change.task !== state.key ||
                change.revision !== state.revision ||
                change.baseRevision !== state.baseRevision ||
                change.contracts.some(
                  (contract) =>
                    state.contracts[contract.name] !== contract.after,
                ) ||
                (await base.resolveRevision(
                  project,
                  task,
                  signal,
                  state.baseRevision,
                )) !== change.revision ||
                !(await options.impactHost.verifyChange(change, signal))
              )
                return result(
                  state.revision!,
                  "Upstream change is not bound to completed host evidence",
                  "blocked",
                );
              if (task.sourceItem) {
                const row = await store.read(task.sourceItem.cause.recordKey);
                const parent = coworkFactoryRecordSchema.parse(row.value);
                const origin =
                  parent.kind === "publication"
                    ? parent.proposal.candidate.impact
                    : undefined;
                if (
                  !(await retainedPublication(task, signal)) ||
                  !origin ||
                  coworkDigest(change.lineage) !==
                    coworkDigest(origin.lineage) ||
                  change.depth !== origin.depth ||
                  change.budget > origin.budget
                )
                  return result(
                    state.revision!,
                    "Propagation lineage or remaining budget differs from retained origin",
                    "blocked",
                  );
              } else if (
                change.depth !== 0 ||
                coworkDigest(change.lineage) !== coworkDigest([project.id])
              ) {
                return result(
                  state.revision!,
                  "Root change has invalid propagation lineage",
                  "blocked",
                );
              }
              change = coworkFreeze({
                ...change,
                budget: Math.min(change.budget, maxBudget),
              });
              const key = `impact:${coworkDigest({ runId, task: state.key, revision: state.revision })}`;
              const prior = journal.readHostRecord(key);
              if (prior.value !== null) {
                const retained = coworkContractChangeSchema.parse(prior.value);
                if (
                  coworkDigest({ ...retained, observedAt: undefined }) !==
                  coworkDigest({ ...change, observedAt: undefined })
                )
                  return result(
                    state.revision!,
                    "Retained impact intent differs",
                    "blocked",
                  );
                change = retained;
              } else if (
                !journal.compareAndSwapHostRecord(
                  runId,
                  lease,
                  key,
                  0,
                  change,
                  { kind: "impact-source-retained" },
                )
              )
                return result(
                  state.revision!,
                  "Impact retention conflict",
                  "unknown",
                );
              const now = new Date().toISOString();
              const impact = await evaluateCoworkImpact(
                change,
                relevant.map((route) => route.mapping),
                {
                  now,
                  maxAgeMs: options.maxAgeMs ?? 86400000,
                  maxDepth: options.maxDepth ?? 8,
                  host: options.impactHost,
                  signal,
                },
              );
              if (impact.blocked.length)
                return result(
                  state.revision!,
                  impact.blocked
                    .map((item) => `${item.consumer}: ${item.reason}`)
                    .join("; "),
                  "blocked",
                );
              for (const candidate of await persistCoworkImpact(
                impact,
                store,
                now,
              )) {
                const published = await publishCoworkItem(
                  proposeCoworkItem(candidate),
                  {
                    mode: "publish",
                    now,
                    store,
                    host: options.itemHost,
                    signal,
                  },
                );
                if (published.state !== "completed")
                  return result(
                    state.revision!,
                    published.state === "preview"
                      ? "Publication was previewed"
                      : published.reason,
                    published.state === "unknown" ? "unknown" : "blocked",
                  );
                const compatibility = coworkCompatibilityTask(
                  candidate,
                  published,
                );
                const route = relevant.find(
                  (entry) =>
                    entry.mapping.consumer === candidate.project &&
                    entry.mapping.contract === candidate.impact!.contract &&
                    entry.mapping.rule.id === candidate.rule.id,
                )!;
                if (
                  !(await options.authorizeRegistration(
                    compatibility,
                    route,
                    signal,
                  )) ||
                  !(await options.impactHost.verifyChange(change, signal)) ||
                  !(await options.impactHost.verifyMapping(
                    route.mapping,
                    signal,
                  )) ||
                  (await base.resolveRevision(
                    project,
                    task,
                    signal,
                    state.baseRevision,
                  )) !== change.revision
                )
                  return result(
                    state.revision!,
                    "Compatibility catalog registration is not authorized and current",
                    "blocked",
                  );
                const retained = await store.read(published.recordKey);
                if (
                  retained.version !== published.recordVersion ||
                  coworkDigest(retained.value) !== published.recordDigest
                )
                  return result(
                    state.revision!,
                    "Publication changed before catalog append",
                    "unknown",
                  );
                const cause = {
                  ...compatibility.cause,
                  recordDigest: digest(retained.value),
                };
                const appended = parseOrchestrationTasks([
                  {
                    id: `compat-${candidate.key.slice(0, 40)}`,
                    projectId: candidate.project,
                    title: `Match ${project.id} ${candidate.impact!.contract}`,
                    brief: `${proposeCoworkItem(candidate).body}\nUpstream artifact: ${change.artifact}`,
                    branch: `compat/${candidate.key}`,
                    baseBranch: route.baseBranch,
                    scopes: [...route.scopes],
                    dependsOn: [state.key],
                    requiresContracts: [
                      { task: state.key, name: candidate.impact!.contract },
                    ],
                    providesContracts: [],
                    acceptance: [...route.acceptance],
                    labels: [],
                    sourceItem: {
                      provider: candidate.target.provider,
                      id: published.receipt.id,
                      url: published.receipt.url,
                      cause,
                    },
                  },
                ]);
                journal.appendCatalogTasks(runId, lease, appended, cause);
              }
            }
          }
          const release = await options.observeRelease?.(
            project,
            task,
            state,
            store,
            signal,
          );
          return (
            release ??
            inherited ??
            result(
              state.revision!,
              `Evaluated ${relevant.length} compatibility routes`,
            )
          );
        },
      };
    },
  };
}
