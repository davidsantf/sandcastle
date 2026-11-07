import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";
import {
  digest,
  evaluateOrchestrationChecks,
  humanStop,
  normalizeOrchestrationFailure,
  parseOrchestrationCatalog,
  parseWorkerReceipt,
  taskKey,
  type OrchestrationCatalog,
  type OrchestrationCheck,
  type OrchestrationHubEvidence,
  type OrchestrationProject,
  type OrchestrationTask,
  type OrchestrationTaskState,
  type OrchestrationWorkerRequest,
  type OrchestrationWorkerReceipt,
} from "./MultiProjectProtocol.js";
import {
  MultiProjectJournal,
  type OrchestrationLease,
} from "./MultiProjectJournal.js";

export interface OrchestrationValidationEvidence {
  revision: string;
  evaluatedScope: number;
  regressions: number;
  checks: OrchestrationCheck[];
  contracts: Record<string, string>;
}

export interface OrchestrationHostRunContext {
  readonly runId: string;
  readonly journal: MultiProjectJournal;
  readonly lease: OrchestrationLease;
}

export interface OrchestrationPolicyEvidence {
  state: "passed" | "blocked" | "needs-human" | "unknown" | "stale";
  revision: string;
  evaluatedScope: number;
  checks: OrchestrationCheck[];
  evidence: string;
}

export interface MultiProjectHost {
  bindRun?(context: OrchestrationHostRunContext): MultiProjectHost;
  beforeTasks?(signal: AbortSignal): Promise<OrchestrationPolicyEvidence>;
  observeSourceItem?(
    project: OrchestrationProject,
    task: OrchestrationTask,
    signal: AbortSignal,
  ): Promise<{ labels: string[]; evidence: string }>;
  registerChangeRequest?(
    request: OrchestrationWorkerRequest,
    signal: AbortSignal,
  ): Promise<
    | {
        state: "registered";
        pullRequest: number;
        revision: string;
        evidence: string;
      }
    | { state: "blocked" | "unknown"; evidence: string }
  >;
  afterTask?(
    project: OrchestrationProject,
    task: OrchestrationTask,
    state: OrchestrationTaskState,
    signal: AbortSignal,
  ): Promise<OrchestrationPolicyEvidence>;
  assessPhase?(
    request: OrchestrationWorkerRequest,
    receipt: Extract<OrchestrationWorkerReceipt, { kind: "completed" }>,
    revision: string,
    signal: AbortSignal,
  ): Promise<OrchestrationPolicyEvidence>;
  validatePolicy?(
    request: OrchestrationWorkerRequest,
    evidence: OrchestrationValidationEvidence,
    signal: AbortSignal,
  ): Promise<OrchestrationPolicyEvidence>;
  /** Explicit trusted host policy; no serializable worker proposal grants authority. */
  authorize(
    request: OrchestrationWorkerRequest,
    signal: AbortSignal,
  ): Promise<boolean>;
  execute(
    request: OrchestrationWorkerRequest,
    signal: AbortSignal,
  ): Promise<OrchestrationWorkerReceipt>;
  resolveRevision(
    project: OrchestrationProject,
    task: OrchestrationTask,
    signal: AbortSignal,
    baseRevision?: string,
  ): Promise<string>;
  validate(
    request: OrchestrationWorkerRequest,
    signal: AbortSignal,
  ): Promise<OrchestrationValidationEvidence>;
  observe(
    project: OrchestrationProject,
    task: OrchestrationTask,
    signal: AbortSignal,
  ): Promise<OrchestrationHubEvidence>;
}

export interface MultiProjectPassResult {
  runId: string;
  status: "completed" | "pending" | "needs-input";
  tasks: OrchestrationTaskState[];
  dispatched: number;
  evaluatedChecks: number;
  followUps?: OrchestrationPolicyEvidence[];
}

const nextStage = {
  specify: "plan",
  plan: "decompose",
  decompose: "implement",
  implement: "verify",
  fix: "verify",
  verify: "review",
  review: "review",
} as const;

const scopeOverlap = (a: string[], b: string[]): boolean =>
  a
    .map((v) => v.toLowerCase())
    .some((x) =>
      b
        .map((v) => v.toLowerCase())
        .some(
          (y) =>
            x === "." ||
            y === "." ||
            x === y ||
            x.startsWith(`${y}/`) ||
            y.startsWith(`${x}/`),
        ),
    );

const validRevision = (revision: string): boolean =>
  /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(revision);
const freezeRequest = (value: unknown): void => {
  if (!value || typeof value !== "object") return;
  for (const child of Object.values(value)) freezeRequest(child);
  Object.freeze(value);
};

async function bounded<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeout: number,
  parent: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const abort = (): void => controller.abort(parent.reason);
  parent.addEventListener("abort", abort, { once: true });
  if (parent.aborted) abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return fn(controller.signal);
      }),
      new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error("orchestration invocation cancelled"));
        controller.signal.addEventListener("abort", onAbort, { once: true });
        if (controller.signal.aborted) onAbort();
        timer = setTimeout(() => {
          reject(new Error("orchestration invocation deadline"));
          controller.abort();
        }, timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (onAbort) controller.signal.removeEventListener("abort", onAbort);
    parent.removeEventListener("abort", abort);
  }
}

export async function runMultiProjectOrchestrationPass(options: {
  catalog: unknown;
  journal: MultiProjectJournal;
  host: MultiProjectHost;
  signal?: AbortSignal;
  now?: () => number;
}): Promise<MultiProjectPassResult> {
  const parsed = parseOrchestrationCatalog(options.catalog);
  let catalog = {
    ...parsed,
    projects: parsed.projects.map((project) => ({
      ...project,
      repositoryRoot: realpathSync(project.repositoryRoot),
    })),
  };
  const { journal } = options;
  let host = options.host;
  const now = options.now ?? Date.now;
  const projects = new Map(catalog.projects.map((p) => [p.id, p]));
  const roots = new Map(
    catalog.projects.map((p) => [p.id, realpathSync(p.repositoryRoot)]),
  );
  if (
    new Set([...roots.values()].map((v) => v.toLowerCase())).size !== roots.size
  )
    throw new Error("canonical repository aliases are not permitted");
  const controller = new AbortController();
  const abort = (): void => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const leaseMs = 30_000;
  const lease = journal.claim(leaseMs);
  let leaseError: unknown;
  const heartbeat = setInterval(() => {
    try {
      journal.renew(lease, leaseMs);
    } catch (error) {
      leaseError = error;
      controller.abort();
    }
  }, 10_000);
  let dispatched = 0;
  let evaluatedChecks = 0;
  const update = (
    old: OrchestrationTaskState,
    patch: Partial<OrchestrationTaskState>,
    kind: string,
  ): OrchestrationTaskState => {
    const state = { ...old, ...patch };
    journal.checkpoint(catalog.id, lease, old, state, randomUUID(), kind);
    return state;
  };
  const stop = (
    state: OrchestrationTaskState,
    reason: string,
    unknown = false,
  ): void => {
    update(
      state,
      { status: unknown ? "unknown" : "needs-input", reason },
      "blocked",
    );
  };
  const repair = (
    state: OrchestrationTaskState,
    signature: string,
    evidence: string,
  ): void => {
    if (
      state.failures.includes(signature) ||
      state.attempts >= catalog.maxRepairAttempts
    ) {
      stop(
        state,
        state.failures.includes(signature)
          ? `repeated failure: ${evidence}`
          : `repair attempts exhausted: ${evidence}`,
      );
    } else {
      update(
        state,
        {
          stage: "fix",
          status: "pending",
          attempts: state.attempts + 1,
          failures: [...state.failures, signature],
          reason: evidence,
          pendingSince: undefined,
        },
        "repair-proposed",
      );
    }
  };
  const repairHubFailure = (
    state: OrchestrationTaskState,
    hub: OrchestrationHubEvidence,
    signature: string,
  ): void => {
    const failures = hub.checks.filter(
      (check) => check.state === "failed" && hub.required.includes(check.name),
    );
    if (failures.some((check) => !check.evidence?.trim())) {
      stop(state, "CI failure lacks actionable evidence");
      return;
    }
    repair(
      state,
      signature,
      failures.map((check) => `${check.name}: ${check.evidence}`).join("\n"),
    );
  };
  const makeRequest = (
    task: OrchestrationTask,
    state: OrchestrationTaskState,
  ): OrchestrationWorkerRequest => {
    const contracts: Record<string, string> = {};
    const states = journal.states(catalog.id);
    for (const prerequisite of task.requiresContracts) {
      const hash = states.find((s) => s.key === prerequisite.task)?.contracts[
        prerequisite.name
      ];
      if (hash) contracts[`${prerequisite.task}:${prerequisite.name}`] = hash;
    }
    const payload = {
      stage: state.stage,
      project: {
        id: task.projectId,
        repositoryRoot: roots.get(task.projectId)!,
      },
      task,
      artifacts: state.artifacts,
      contracts,
      revision: state.revision,
      baseRevision: state.baseRevision,
      failures: state.failures,
    };
    const request = {
      ...structuredClone(payload),
      invocation: randomUUID(),
      intent: digest(payload),
    };
    freezeRequest(request);
    return request;
  };
  const prerequisitesCurrent = async (
    task: OrchestrationTask,
    request: OrchestrationWorkerRequest,
    signal: AbortSignal,
  ): Promise<boolean> => {
    const states = journal.states(catalog.id);
    for (const key of task.dependsOn) {
      const producer = catalog.tasks.find((item) => taskKey(item) === key);
      const state = states.find((item) => item.key === key);
      if (!producer || !state || state.status !== "completed") return false;
      const revision = await host.resolveRevision(
        projects.get(producer.projectId)!,
        producer,
        signal,
        state.baseRevision,
      );
      if (!validRevision(revision) || revision !== state.revision) return false;
    }
    return task.requiresContracts.every(
      (prerequisite) =>
        states.find((item) => item.key === prerequisite.task)?.contracts[
          prerequisite.name
        ] === request.contracts[`${prerequisite.task}:${prerequisite.name}`],
    );
  };
  const acceptPolicy = (
    state: OrchestrationTaskState,
    request: OrchestrationWorkerRequest,
    policy: OrchestrationPolicyEvidence,
    revision: string,
  ): boolean => {
    if (
      !policy ||
      !["passed", "blocked", "needs-human", "unknown", "stale"].includes(
        policy.state,
      ) ||
      typeof policy.evidence !== "string" ||
      !policy.evidence.trim() ||
      !Array.isArray(policy.checks) ||
      !Number.isSafeInteger(policy.evaluatedScope) ||
      policy.evaluatedScope < 0
    ) {
      stop(state, "host policy returned invalid evidence");
      return false;
    }
    const recorded = journal.compareAndSwapHostRecord(
      catalog.id,
      lease,
      `policy:${digest({ run: catalog.id, invocation: state.invocation, stage: state.stage })}`,
      0,
      { intent: request.intent, revision, policy },
      { kind: "host-policy-evaluated", task: state.key },
    );
    if (!recorded) throw new Error("host policy evidence conflict");
    evaluatedChecks += policy.checks.length;
    if (policy.state === "unknown" || policy.state === "stale") {
      stop(state, `host policy ${policy.state}: ${policy.evidence}`, true);
      return false;
    }
    if (policy.state !== "passed") {
      stop(state, `host policy ${policy.state}: ${policy.evidence}`);
      return false;
    }
    const checks = evaluateOrchestrationChecks(
      {
        revision: policy.revision,
        policiesKnown: true,
        required: policy.checks.map((check) => check.name),
        checks: policy.checks,
        labels: [],
      },
      revision,
    );
    if (
      policy.revision !== revision ||
      policy.evaluatedScope === 0 ||
      checks.state !== "passed"
    ) {
      stop(state, "host policy lacks current non-vacuous passing evidence");
      return false;
    }
    return true;
  };

  const execute = async (
    catalogTask: OrchestrationTask,
    initial: OrchestrationTaskState,
  ): Promise<void> => {
    const task = initial.pullRequest
      ? { ...catalogTask, pullRequest: initial.pullRequest }
      : catalogTask;
    const project = projects.get(task.projectId)!;
    try {
      const current = await bounded(
        (signal) =>
          host.resolveRevision(project, task, signal, initial.baseRevision),
        catalog.invocationTimeoutMs,
        controller.signal,
      );
      if (
        !validRevision(current) ||
        (initial.revision && initial.revision !== current)
      ) {
        stop(initial, "source revision changed outside recorded work");
        return;
      }
      if (!initial.revision)
        initial = update(
          initial,
          { revision: current, baseRevision: current },
          "source-bound",
        );
    } catch {
      stop(initial, "host source/scope verification unavailable");
      return;
    }
    const request = makeRequest(task, initial);
    let authorized: boolean;
    try {
      authorized = await bounded(
        (signal) => host.authorize(request, signal),
        catalog.invocationTimeoutMs,
        controller.signal,
      );
    } catch {
      stop(initial, "host authorization unavailable");
      return;
    }
    if (authorized !== true) {
      stop(initial, "host authorization denied");
      return;
    }
    let state = update(
      initial,
      {
        status: "running",
        invocation: request.invocation,
        intent: request.intent,
        reason: undefined,
      },
      "reserved",
    );
    dispatched++;
    try {
      await bounded(
        async (signal) => {
          if (!(await prerequisitesCurrent(task, request, signal))) {
            stop(state, "prerequisite revision or contract changed");
            return;
          }
          if (["implement", "fix"].includes(state.stage)) {
            const evidence =
              task.sourceItem && !task.pullRequest
                ? host.observeSourceItem
                  ? await host.observeSourceItem(project, task, signal)
                  : {
                      labels: [],
                      evidence: "",
                      diagnostic: "source item policy reader unavailable",
                    }
                : await host.observe(project, task, signal);
            if (
              ("diagnostic" in evidence && evidence.diagnostic) ||
              ("evidence" in evidence && !evidence.evidence) ||
              humanStop(evidence.labels)
            ) {
              stop(
                state,
                "hub labels unavailable or require human intervention",
              );
              return;
            }
          }
          if (["verify", "review", "fix"].includes(state.stage)) {
            const revision = await host.resolveRevision(
              project,
              task,
              signal,
              state.baseRevision,
            );
            if (!validRevision(revision) || revision !== state.revision) {
              stop(
                state,
                "source revision changed outside recorded implementation",
              );
              return;
            }
          }
          if (state.stage === "verify") {
            if (task.sourceItem && !task.pullRequest) {
              if (!host.registerChangeRequest) {
                stop(
                  state,
                  "issue-backed work requires host-owned change request registration",
                );
                return;
              }
              const registration = await host.registerChangeRequest(
                request,
                signal,
              );
              if (registration.state !== "registered") {
                stop(
                  state,
                  registration.evidence,
                  registration.state === "unknown",
                );
                return;
              }
              const conflicts = journal.states(catalog.id).some((other) => {
                const configured = catalog.tasks.find(
                  (item) => taskKey(item) === other.key,
                )!;
                return (
                  other.key !== state.key &&
                  configured.projectId === task.projectId &&
                  (other.pullRequest ??
                    configured.pullRequest ??
                    (configured.sourceItem
                      ? undefined
                      : project.hub.pullRequest)) === registration.pullRequest
                );
              });
              if (
                !Number.isSafeInteger(registration.pullRequest) ||
                registration.pullRequest <= 0 ||
                registration.revision !== state.revision ||
                !registration.evidence ||
                conflicts ||
                (await host.resolveRevision(
                  project,
                  task,
                  signal,
                  state.baseRevision,
                )) !== registration.revision ||
                !(await prerequisitesCurrent(task, request, signal))
              ) {
                stop(
                  state,
                  "change request registration lacks current, distinct revision-bound evidence",
                  true,
                );
                return;
              }
              update(
                state,
                {
                  status: "pending",
                  pullRequest: registration.pullRequest,
                  changeRequestEvidence: registration.evidence,
                },
                "change-request-registered",
              );
              return;
            }
            const evidence = await host.validate(request, signal);
            const revision = await host.resolveRevision(
              project,
              task,
              signal,
              state.baseRevision,
            );
            const acceptance = evaluateOrchestrationChecks(
              {
                revision: evidence.revision,
                policiesKnown: true,
                required: task.acceptance.map((c) => c.label),
                checks: evidence.checks,
                labels: [],
              },
              state.revision ?? "",
            );
            evaluatedChecks += acceptance.evaluated;
            if (
              revision !== state.revision ||
              !Number.isSafeInteger(evidence.evaluatedScope) ||
              evidence.evaluatedScope <= 0 ||
              evidence.regressions !== 0 ||
              evidence.revision !== state.revision
            ) {
              stop(
                state,
                "missing revision-bound non-regression or evaluated-scope evidence",
              );
              return;
            }
            if (acceptance.state === "failed") {
              repair(state, acceptance.signature!, "host acceptance failed");
              return;
            }
            if (acceptance.state !== "passed") {
              stop(state, "host acceptance checks missing or unresolved");
              return;
            }
            const contracts = evidence.contracts;
            if (
              task.providesContracts.some(
                (name) => !/^[a-f0-9]{64}$/.test(contracts[name] ?? ""),
              )
            ) {
              stop(state, "shared contract evidence missing");
              return;
            }
            if (
              Object.entries(request.contracts).some(
                ([name, hash]) => contracts[name] !== hash,
              )
            ) {
              stop(
                state,
                "consumer validation did not verify prerequisite contract hashes",
              );
              return;
            }
            if (host.validatePolicy) {
              const policy = await host.validatePolicy(
                request,
                evidence,
                signal,
              );
              if (!acceptPolicy(state, request, policy, revision)) return;
              const current = await host.resolveRevision(
                project,
                task,
                signal,
                state.baseRevision,
              );
              if (
                current !== revision ||
                !(await prerequisitesCurrent(task, request, signal))
              ) {
                stop(
                  state,
                  "source or prerequisites changed during host policy",
                  true,
                );
                return;
              }
            }
            const hub = await host.observe(project, task, signal);
            if (humanStop(hub.labels)) {
              stop(state, "hub requires human intervention");
              return;
            }
            const result = evaluateOrchestrationChecks(
              hub,
              state.revision ?? "",
            );
            evaluatedChecks += result.evaluated;
            if (result.state === "failed") {
              repairHubFailure(state, hub, result.signature!);
            } else if (result.state === "passed") {
              if (
                (await host.resolveRevision(
                  project,
                  task,
                  signal,
                  state.baseRevision,
                )) !== revision ||
                !(await prerequisitesCurrent(task, request, signal))
              ) {
                stop(
                  state,
                  "source or prerequisites changed before verification checkpoint",
                  true,
                );
                return;
              }
              update(
                state,
                {
                  stage: "review",
                  status: "pending",
                  contracts,
                  pendingSince: undefined,
                  artifacts: {
                    ...state.artifacts,
                    verify: JSON.stringify({ acceptance: evidence, hub }),
                  },
                },
                "verified",
              );
            } else if (result.state === "pending") {
              const since = state.pendingSince ?? now();
              if (now() - since >= catalog.invocationTimeoutMs)
                stop(state, "required checks pending timeout");
              else
                update(
                  state,
                  { status: "pending", pendingSince: since },
                  "checks-pending",
                );
            } else stop(state, "hub revision, requirements, or checks unknown");
            return;
          }
          signal.throwIfAborted();
          journal.renew(lease, leaseMs);
          const receipt = parseWorkerReceipt(
            await host.execute(request, signal),
          );
          signal.throwIfAborted();
          if (receipt.kind === "unknown") {
            stop(state, `worker outcome unknown: ${receipt.reason}`, true);
            return;
          }
          if (receipt.kind === "failed") {
            stop(
              state,
              `worker failed: ${receipt.signature}: ${receipt.evidence}`,
            );
            return;
          }
          if (
            receipt.amendments &&
            !["plan", "decompose", "fix"].includes(state.stage)
          ) {
            stop(
              state,
              "artifact amendments require a planning or authorized repair stage",
            );
            return;
          }
          const artifacts = {
            ...state.artifacts,
            ...receipt.amendments,
            [state.stage]: receipt.artifact,
          };
          if (host.assessPhase && state.stage !== "review") {
            const revision = await host.resolveRevision(
              project,
              task,
              signal,
              state.baseRevision,
            );
            if (!validRevision(revision)) {
              stop(state, "phase source revision unavailable", true);
              return;
            }
            state = update(
              state,
              { artifacts, revision },
              "phase-outcome-recorded",
            );
            const policy = await host.assessPhase(
              request,
              receipt,
              revision,
              signal,
            );
            if (!acceptPolicy(state, request, policy, revision)) return;
            const current = await host.resolveRevision(
              project,
              task,
              signal,
              state.baseRevision,
            );
            if (
              current !== revision ||
              !(await prerequisitesCurrent(task, request, signal))
            ) {
              stop(
                state,
                "source or prerequisites changed during phase critic",
                true,
              );
              return;
            }
          }
          if (state.stage === "review") {
            const revision = await host.resolveRevision(
              project,
              task,
              signal,
              state.baseRevision,
            );
            if (revision !== state.revision) {
              stop(state, "review changed the source revision", true);
              return;
            }
            if (receipt.findings.length) {
              repair(
                state,
                digest(
                  receipt.findings.map(normalizeOrchestrationFailure).sort(),
                ),
                receipt.findings.join("\n"),
              );
              return;
            }
            // Re-read remote evidence after review; never accept stale green CI.
            const evidence = await host.observe(project, task, signal);
            const result = evaluateOrchestrationChecks(evidence, revision);
            evaluatedChecks += result.evaluated;
            if (humanStop(evidence.labels)) {
              stop(state, "hub requires human intervention");
              return;
            }
            if (result.state === "failed") {
              repairHubFailure(state, evidence, result.signature!);
              return;
            }
            if (result.state === "pending") {
              update(
                state,
                {
                  status: "pending",
                  stage: "verify",
                  pendingSince: state.pendingSince ?? now(),
                },
                "review-checks-pending",
              );
              return;
            }
            if (result.state !== "passed") {
              stop(state, "final review readiness changed or is unresolved");
              return;
            }
            if (
              (await host.resolveRevision(
                project,
                task,
                signal,
                state.baseRevision,
              )) !== revision ||
              !(await prerequisitesCurrent(task, request, signal))
            ) {
              stop(state, "prerequisite evidence changed during review");
              return;
            }
            update(state, { status: "completed", artifacts }, "completed");
          } else if (state.stage === "implement" || state.stage === "fix") {
            const revision = await host.resolveRevision(
              project,
              task,
              signal,
              state.baseRevision,
            );
            if (
              !validRevision(revision) ||
              (host.assessPhase && revision !== state.revision)
            ) {
              stop(state, "implemented revision unavailable", true);
              return;
            }
            update(
              state,
              {
                status: "pending",
                stage: nextStage[state.stage],
                revision,
                artifacts,
              },
              "implemented",
            );
          } else {
            const revision = await host.resolveRevision(
              project,
              task,
              signal,
              state.baseRevision,
            );
            if (
              !validRevision(revision) ||
              (host.assessPhase && revision !== state.revision)
            ) {
              stop(state, "artifact source revision unavailable", true);
              return;
            }
            update(
              state,
              {
                status: "pending",
                stage: nextStage[state.stage],
                artifacts,
                revision,
              },
              "artifact-accepted",
            );
          }
        },
        catalog.invocationTimeoutMs,
        controller.signal,
      );
    } catch {
      // Transport failures may follow external side effects; keep the reservation.
      const current = journal
        .states(catalog.id)
        .find((s) => s.key === state.key)!;
      if (current.status === "running")
        stop(current, "invocation interrupted; external outcome unknown", true);
    }
  };

  const followUps: OrchestrationPolicyEvidence[] = [];
  const followed = new Set<string>();
  const reconcileCompleted = async (): Promise<void> => {
    if (!host.afterTask) return;
    const active = journal.catalog(catalog.id);
    for (const state of journal.states(catalog.id)) {
      if (state.status !== "completed" || !state.revision) continue;
      const key = digest({
        run: catalog.id,
        task: state.key,
        revision: state.revision,
      });
      if (followed.has(key)) continue;
      followed.add(key);
      const configured = active.tasks.find(
        (task) => taskKey(task) === state.key,
      )!;
      const task = structuredClone(
        state.pullRequest
          ? { ...configured, pullRequest: state.pullRequest }
          : configured,
      );
      const retained = structuredClone(state);
      freezeRequest(task);
      freezeRequest(retained);
      let outcome: OrchestrationPolicyEvidence;
      try {
        const current = await bounded(
          (signal) =>
            host.resolveRevision(
              projects.get(task.projectId)!,
              task,
              signal,
              state.baseRevision,
            ),
          catalog.invocationTimeoutMs,
          controller.signal,
        );
        if (current !== state.revision)
          throw new Error("Completed source changed before follow-up");
        outcome = await bounded(
          (signal) =>
            host.afterTask!(
              projects.get(task.projectId)!,
              task,
              retained,
              signal,
            ),
          catalog.invocationTimeoutMs,
          controller.signal,
        );
        const checks = evaluateOrchestrationChecks(
          {
            revision: outcome.revision,
            policiesKnown: true,
            required: outcome.checks.map((check) => check.name),
            checks: outcome.checks,
            labels: [],
          },
          state.revision,
        );
        evaluatedChecks += checks.evaluated;
        if (
          outcome.state === "passed" &&
          (outcome.revision !== state.revision ||
            checks.state !== "passed" ||
            !Number.isSafeInteger(outcome.evaluatedScope) ||
            outcome.evaluatedScope <= 0)
        ) {
          outcome = {
            ...outcome,
            state: "blocked",
            evidence:
              "Follow-up gate lacks non-vacuous revision-bound evidence",
          };
        }
      } catch {
        outcome = {
          state: "unknown",
          revision: state.revision,
          evaluatedScope: 0,
          checks: [],
          evidence:
            "Follow-up operation interrupted; external outcome unresolved",
        };
      }
      const recordKey = `follow-up:${key}`;
      const prior = journal.readHostRecord(recordKey);
      if (
        !journal.compareAndSwapHostRecord(
          catalog.id,
          lease,
          recordKey,
          prior.version,
          { task: state.key, revision: state.revision, outcome },
          { kind: "follow-up-outcome" },
        )
      )
        throw new Error("Follow-up outcome CAS conflict");
      followUps.push(outcome);
    }
  };

  try {
    journal.initialize(catalog, lease);
    catalog = journal.catalog(catalog.id);
    if (host.bindRun) {
      host = host.bindRun(
        Object.freeze({
          runId: catalog.id,
          journal,
          lease: Object.freeze({ ...lease }),
        }),
      );
    }
    journal.recover(catalog.id, lease);
    if (host.beforeTasks) {
      let preparation: OrchestrationPolicyEvidence;
      try {
        preparation = await bounded(
          (signal) => host.beforeTasks!(signal),
          catalog.invocationTimeoutMs,
          controller.signal,
        );
        const checks = evaluateOrchestrationChecks(
          {
            revision: preparation.revision,
            policiesKnown: true,
            required: preparation.checks.map((check) => check.name),
            checks: preparation.checks,
            labels: [],
          },
          preparation.revision,
        );
        evaluatedChecks += checks.evaluated;
        if (
          preparation.state === "passed" &&
          (!validRevision(preparation.revision) ||
            !Number.isSafeInteger(preparation.evaluatedScope) ||
            preparation.evaluatedScope <= 0 ||
            !preparation.evidence?.trim() ||
            checks.state !== "passed")
        )
          preparation = {
            ...preparation,
            state: "blocked",
            evidence: "Signal intake lacks non-vacuous evidence",
          };
      } catch {
        preparation = {
          state: "unknown",
          revision: "",
          evaluatedScope: 0,
          checks: [],
          evidence:
            "Signal intake interrupted; retained reservations require reconciliation",
        };
      }
      const preparationKey = `run-preparation:${digest(catalog.id)}`;
      const previous = journal.readHostRecord(preparationKey);
      if (
        !journal.compareAndSwapHostRecord(
          catalog.id,
          lease,
          preparationKey,
          previous.version,
          { outcome: preparation },
          { kind: "run-preparation-outcome" },
        )
      )
        throw new Error("Run preparation evidence changed concurrently");
      followUps.push(preparation);
    }
    for (
      let round = 0;
      round < catalog.maxRounds && !controller.signal.aborted;
      round++
    ) {
      await reconcileCompleted();
      catalog = journal.catalog(catalog.id);
      const states = journal.states(catalog.id);
      const selected: {
        task: OrchestrationTask;
        state: OrchestrationTaskState;
      }[] = [];
      const reservations = journal.allReservations();
      const capacity = Math.max(
        0,
        catalog.maxConcurrency - reservations.length,
      );
      for (const task of catalog.tasks) {
        const state = states.find((s) => s.key === taskKey(task))!;
        if (state.status !== "pending") continue;
        if (humanStop(task.labels)) {
          stop(state, "task requires human intervention");
          continue;
        }
        const dependencies = task.dependsOn.map(
          (key) => states.find((s) => s.key === key)!,
        );
        if (
          dependencies.some((s) =>
            ["needs-input", "unknown"].includes(s.status),
          )
        ) {
          stop(state, "prerequisite blocked");
          continue;
        }
        if (dependencies.some((s) => s.status !== "completed")) continue;
        if (
          task.requiresContracts.some(
            (c) => !states.find((s) => s.key === c.task)?.contracts[c.name],
          )
        ) {
          stop(state, "shared-contract prerequisite unavailable");
          continue;
        }
        const root = roots.get(task.projectId)!;
        const conflict =
          reservations.some(
            (r) =>
              path.resolve(r.projectRoot).toLowerCase() ===
                root.toLowerCase() && scopeOverlap(r.scopes, task.scopes),
          ) ||
          selected.some(
            (s) =>
              s.task.projectId === task.projectId &&
              scopeOverlap(s.task.scopes, task.scopes),
          );
        if (!conflict && selected.length < capacity)
          selected.push({ task, state });
      }
      if (!selected.length) break;
      await Promise.all(
        selected.map(({ task, state }) => execute(task, state)),
      );
      if (leaseError) throw leaseError;
      const after = journal.states(catalog.id);
      if (
        selected.every(({ state }) => {
          const current = after.find((s) => s.key === state.key)!;
          return (
            current.status === "pending" &&
            current.stage === state.stage &&
            current.pendingSince !== undefined
          );
        })
      )
        break;
    }
    if (leaseError) throw leaseError;
    await reconcileCompleted();
    const tasks = journal.states(catalog.id);
    return {
      runId: catalog.id,
      tasks,
      dispatched,
      evaluatedChecks,
      ...(host.afterTask ? { followUps } : {}),
      status: followUps.some((outcome) => outcome.state !== "passed")
        ? "needs-input"
        : tasks.every((t) => t.status === "completed")
          ? "completed"
          : tasks.some((t) => ["needs-input", "unknown"].includes(t.status))
            ? "needs-input"
            : "pending",
    };
  } finally {
    clearInterval(heartbeat);
    options.signal?.removeEventListener("abort", abort);
    if (!leaseError) journal.release(lease);
  }
}
