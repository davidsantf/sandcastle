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

export interface MultiProjectHost {
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
  const { journal, host } = options;
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

  const execute = async (
    task: OrchestrationTask,
    initial: OrchestrationTaskState,
  ): Promise<void> => {
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
    const state = update(
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
          if (["implement", "fix"].includes(state.stage)) {
            const evidence = await host.observe(project, task, signal);
            if (evidence.diagnostic || humanStop(evidence.labels)) {
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
            update(state, { status: "completed", artifacts }, "completed");
          } else if (state.stage === "implement" || state.stage === "fix") {
            const revision = await host.resolveRevision(
              project,
              task,
              signal,
              state.baseRevision,
            );
            if (!validRevision(revision)) {
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
            if (!validRevision(revision)) {
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

  try {
    journal.initialize(catalog, lease);
    catalog = journal.catalog(catalog.id);
    journal.recover(catalog.id, lease);
    for (
      let round = 0;
      round < catalog.maxRounds && !controller.signal.aborted;
      round++
    ) {
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
    const tasks = journal.states(catalog.id);
    return {
      runId: catalog.id,
      tasks,
      dispatched,
      evaluatedChecks,
      status: tasks.every((t) => t.status === "completed")
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
