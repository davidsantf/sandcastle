import path from "node:path";
import { z } from "zod";
import type { run } from "./run.js";
import type { LocalOrchestrationTickContext } from "./LocalOrchestrationService.js";
import type {
  WorkspaceConfiguration,
  WorkspaceDiscoverySource,
} from "./OrchestrationWorkspaceContract.js";
import {
  digest,
  humanStop,
  parseOrchestrationCatalog,
  parseOrchestrationTasks,
  taskKey,
} from "./MultiProjectProtocol.js";
import { MultiProjectJournal } from "./MultiProjectJournal.js";
import {
  runMultiProjectOrchestrationPass,
  type MultiProjectHost,
} from "./MultiProjectOrchestrator.js";
import {
  createDevsquadOrchestrationWorker,
  resolveOrchestrationGitRevision,
} from "./MultiProjectWorker.js";
import {
  createOrchestrationLocalExecutionRecorder,
  createOrchestrationNativeSetup,
  createOrchestrationProposalTask,
} from "./OrchestrationNativeHost.js";
import {
  createOrchestrationDiscoveryAdapter,
  type OrchestrationDiscoveryTransport,
  type OrchestrationDiscoveredItem,
} from "./OrchestrationDiscovery.js";
import {
  createOrchestrationProposalQueue,
  parseOrchestrationProposal,
  type OrchestrationProposal,
} from "./OrchestrationProposal.js";
import { evaluateOrchestrationFocus } from "./OrchestrationFocus.js";
import { validateWorkspaceRepositories } from "./OrchestrationWorkspaceRepositories.js";
import { noSandbox } from "./sandboxes/no-sandbox.js";
import {
  nativeValidationKey,
  readNativeLocalValidation,
  runNativeLocalValidation,
} from "./OrchestrationNativeValidation.js";

export type WorkspaceNativeTickContext =
  LocalOrchestrationTickContext<WorkspaceConfiguration> & {
    /** Supplied by the public CLI from its canonical workspace store, not hub text. */
    journalPath?: string;
  };
const indexKey = (id: string) => `native-dispatch-index/${digest(id)}`;
const retainedSchema = z.strictObject({
  schemaVersion: z.literal(1),
  proposal: z.unknown(),
  template: z.unknown(),
  catalog: z.unknown(),
});
const indexSchema = z.array(retainedSchema).max(200);
const bindingFor = (proposal: OrchestrationProposal, template: unknown) => ({
  proposalId: proposal.id,
  proposalDigest: proposal.digest,
  sourceRevision: proposal.sourceRevision,
  configurationRevision: proposal.configurationRevision,
  source: proposal.source,
  artifacts: proposal.artifacts,
  ...(proposal.approval ? { approval: proposal.approval } : {}),
  ...(proposal.policyDecision
    ? { policyDecision: proposal.policyDecision }
    : {}),
  template,
});
function approved(proposal: OrchestrationProposal) {
  const decision = proposal.approval ?? proposal.policyDecision;
  if (
    !proposal.artifacts ||
    !proposal.digest ||
    proposal.digest !==
      digest(
        JSON.stringify({
          id: proposal.id,
          sourceRevision: proposal.sourceRevision,
          configurationRevision: proposal.configurationRevision,
          artifacts: proposal.artifacts,
        }),
      ) ||
    proposal.sourceRevision !== proposal.source.revision ||
    decision?.proposalDigest !== proposal.digest ||
    decision.sourceRevision !== proposal.sourceRevision ||
    decision.configurationRevision !== proposal.configurationRevision ||
    !["approved", "dispatching", "dispatched", "unknown"].includes(
      proposal.status,
    )
  )
    throw new Error(
      "Native implementation requires an exact approved proposal",
    );
  if (proposal.source.kind === "pull-request")
    throw new Error(
      "Native implementation requires an issue or work-item source",
    );
  return proposal.artifacts;
}

/** Host-only bridge. A dispatch receipt acknowledges admission, never completion. */
export function createWorkspaceNativeDispatcher(options: {
  context: WorkspaceNativeTickContext;
  transport: (
    source: WorkspaceDiscoverySource,
  ) => OrchestrationDiscoveryTransport | undefined;
  invoke?: typeof run;
}) {
  const { context } = options;
  const { configuration, store } = context;
  const guards = store.guards?.() ?? [];
  const available =
    !!context.journalPath &&
    path.isAbsolute(context.journalPath) &&
    guards.some((g) => g.key.startsWith("service-owner/")) &&
    guards.some((g) => g.key.startsWith("service-control/")) &&
    guards.some((g) => g.key === "workspace:configuration");
  const write = (key: string, value: unknown, kind: string) => {
    const previous = store.read(key);
    if (
      !store.compareAndSwap(key, previous.version, value, {
        kind,
        at: new Date().toISOString(),
      })
    )
      throw new Error("Native lifecycle evidence conflict");
  };
  const records = () =>
    indexSchema.parse(store.read(indexKey(configuration.id)).value ?? []);
  const ids = () =>
    records().map((record) => parseOrchestrationProposal(record.proposal).id);
  const setup = createOrchestrationNativeSetup(configuration.runtime);
  const queue = createOrchestrationProposalQueue({
    store,
    namespace: configuration.id,
  });
  const read = (id: string) => {
    const record = records().find(
      (entry) => parseOrchestrationProposal(entry.proposal).id === id,
    );
    if (!record) throw new Error("Native lifecycle binding is missing");
    const proposal = parseOrchestrationProposal(record.proposal);
    const template = parseOrchestrationTasks([record.template])[0]!;
    approved(proposal);
    if (proposal.id !== id)
      throw new Error("Native lifecycle identity mismatch");
    const binding = bindingFor(proposal, template);
    const cause = {
      recordKey: `native-proposal:${digest(binding)}`,
      recordVersion: 1,
      recordDigest: digest(binding),
    };
    const catalog = parseOrchestrationCatalog(record.catalog);
    const task = catalog.tasks[0];
    if (
      catalog.id !== `native-${digest([configuration.id, id]).slice(0, 32)}` ||
      catalog.tasks.length !== 1 ||
      catalog.projects.length !== 1 ||
      !task ||
      digest(task) !==
        digest(
          parseOrchestrationTasks([
            {
              ...createOrchestrationProposalTask(
                template,
                proposal.source,
                proposal.configurationRevision,
              ),
              sourceItem: {
                provider:
                  proposal.source.kind === "issue" ? "github" : "azure-devops",
                id: proposal.source.id,
                url: proposal.source.url,
                cause,
              },
            },
          ])[0],
        )
    )
      throw new Error("Native lifecycle catalog binding mismatch");
    return { proposal, template, binding, cause, catalog, task };
  };
  const advance = async (id: string, signal: AbortSignal) => {
    if (!available)
      throw new Error("Native dispatch requires the fenced same-file journal");
    const retained = read(id);
    const { proposal, template, binding, cause, catalog, task } = retained;
    const project = catalog.projects[0]!;
    const currentSource = configuration.discovery.find(
      (source) =>
        source.id === proposal.source.sourceId &&
        source.projectId === project.id,
    );
    const assertCurrent = async () => {
      signal.throwIfAborted();
      const current = queue.get(id).proposal;
      const policy = configuration.runtime.proposalPolicy;
      const policyMatches =
        !proposal.policyDecision ||
        (policy &&
          digest(policy) === proposal.policyDecision.policyDigest &&
          digest(template) === proposal.policyDecision.templateDigest &&
          policy.rules.some(
            (rule) =>
              rule.sourceId === proposal.source.sourceId &&
              rule.taskTemplateId === template.id,
          ));
      if (
        configuration.revision !== proposal.configurationRevision ||
        configuration.runtime.executionTrust !== "trusted-local" ||
        !currentSource ||
        !policyMatches ||
        !current ||
        !["approved", "dispatching", "dispatched", "unknown"].includes(
          current.status,
        ) ||
        digest(bindingFor(current, template)) !== digest(binding) ||
        digest(configuration.projects.find((p) => p.id === project.id)) !==
          digest(project) ||
        configuration.taskTemplates.filter((t) => t.projectId === project.id)
          .length !== 1 ||
        digest(
          configuration.taskTemplates.find((t) => t.projectId === project.id),
        ) !== digest(template)
      )
        throw new Error(
          "Native lifecycle approval, configuration or trust changed",
        );
      const item: OrchestrationDiscoveredItem =
        await createOrchestrationDiscoveryAdapter(
          currentSource,
          options.transport(currentSource),
          configuration.focus,
        ).refresh(proposal.source, signal);
      if (
        item.revision !== proposal.sourceRevision ||
        humanStop(template.labels) ||
        humanStop(item.labels ?? []) ||
        !evaluateOrchestrationFocus(configuration.focus, {
          projectId: project.id,
          action: "implement",
          ...item.scope,
        }).allowed
      )
        throw new Error(
          "Native lifecycle source or implementation scope changed",
        );
      if (
        validateWorkspaceRepositories({
          ...configuration,
          projects: [project],
        })[0]?.status !== "ready"
      )
        throw new Error(
          "Native lifecycle Git root/origin no longer matches registration",
        );
      return item;
    };
    const execute = createDevsquadOrchestrationWorker({
      ...setup,
      authorizeCapability: async (request, capability, abort) => {
        await assertCurrent();
        return setup.authorizeCapability(request, capability, abort);
      },
      sandbox: () => noSandbox(),
      invoke: options.invoke,
      recordLocalExecution: createOrchestrationLocalExecutionRecorder({
        store,
        namespace: configuration.id,
        configurationRevision: configuration.revision,
      }),
    });
    await assertCurrent();
    const journal = new MultiProjectJournal(
      context.journalPath!,
      Date.now,
      guards,
    );
    const host: MultiProjectHost = {
      bindRun({ lease }) {
        const previous = journal.readHostRecord(cause.recordKey);
        if (previous.version === 0) {
          if (
            !journal.compareAndSwapHostRecord(
              catalog.id,
              lease,
              cause.recordKey,
              0,
              binding,
              {
                kind: "native-approved-proposal-bound",
              },
            )
          )
            throw new Error("Native proposal cause conflict");
        } else if (
          previous.version !== 1 ||
          digest(previous.value) !== cause.recordDigest
        ) {
          throw new Error("Native proposal cause changed");
        }
        const state = journal.states(catalog.id)[0]!;
        const seed = {
          specify: proposal.artifacts!.specification,
          plan: proposal.artifacts!.plan,
          decompose: JSON.stringify({
            investigationDigest: digest(proposal.artifacts!.investigation),
            acceptanceDigest: digest(proposal.artifacts!.acceptance),
            templateDigest: digest(template),
            taskId: task.id,
          }),
        };
        if (
          state.stage === "specify" &&
          state.status === "pending" &&
          !Object.keys(state.artifacts).length
        ) {
          journal.checkpoint(
            catalog.id,
            lease,
            state,
            { ...state, stage: "implement", artifacts: seed },
            `native-seed:${catalog.id}`,
            "native-approved-artifacts-seeded",
          );
        } else if (
          Object.entries(seed).some(
            ([stage, artifact]) =>
              state.artifacts[stage as "specify" | "plan" | "decompose"] !==
              artifact,
          )
        ) {
          throw new Error("Native lifecycle seed evidence changed");
        }
        return this;
      },
      async authorize(request) {
        if (
          request.stage !== "implement" ||
          request.task.id !== task.id ||
          request.task.projectId !== project.id ||
          digest(request.task) !== digest(task)
        )
          return false;
        await assertCurrent();
        return true;
      },
      execute,
      resolveRevision: resolveOrchestrationGitRevision,
      async observeSourceItem() {
        const item = await assertCurrent();
        return {
          labels: item.labels ?? [],
          evidence: `native-source:${proposal.sourceRevision}`,
        };
      },
      async assessPhase(request, _receipt, revision, abort) {
        const validation = await runNativeLocalValidation({
          configuration,
          proposalId: id,
          projectId: project.id,
          repositoryRoot: project.repositoryRoot,
          revision,
          signal: abort,
          store,
          write,
          assertCurrent: async () => {
            await assertCurrent();
            if (
              (await resolveOrchestrationGitRevision(
                project,
                task,
                abort,
                request.baseRevision,
              )) !== revision
            )
              throw new Error("Implementation changed during local validation");
          },
        });
        return {
          state:
            validation && validation.state !== "passed"
              ? validation.state === "failed"
                ? "blocked"
                : "unknown"
              : "needs-human",
          revision,
          evaluatedScope: validation?.evaluatedScope ?? 0,
          checks:
            validation?.checks.map(({ name, state }) => ({ name, state })) ??
            [],
          evidence:
            (validation
              ? `Local validation ${validation.state}; evaluated scope ${validation.evaluatedScope}. ${validation.diagnostic ?? ""} `
              : "") +
            "Native implementation recorded; independent phase-critic/critical approval proof is unavailable. Verification, publication and completion remain blocked.",
        };
      },
      async validate() {
        throw new Error(
          "Native acceptance requires independently verified host evidence",
        );
      },
      async observe() {
        throw new Error(
          "Native hub gates require explicit change-request binding and current policy evidence",
        );
      },
      async registerChangeRequest() {
        return {
          state: "blocked",
          evidence: "Native dispatch does not grant publication authority",
        };
      },
    };
    try {
      return await runMultiProjectOrchestrationPass({
        catalog,
        journal,
        host,
        signal,
      });
    } finally {
      journal.close();
    }
  };
  return {
    available,
    async dispatch(
      item: OrchestrationDiscoveredItem,
      proposal: OrchestrationProposal,
      signal: AbortSignal,
    ) {
      approved(proposal);
      if (
        !available ||
        item.sourceId !== proposal.source.sourceId ||
        item.projectId !== proposal.source.projectId ||
        item.id !== proposal.source.id ||
        item.kind !== proposal.source.kind ||
        item.revision !== proposal.sourceRevision
      )
        throw new Error("Native dispatch source/journal binding unavailable");
      const templates = configuration.taskTemplates.filter(
        (t) => t.projectId === item.projectId,
      );
      if (templates.length !== 1)
        throw new Error(
          "Native implementation requires one trusted project template",
        );
      const template = templates[0]!;
      if (
        proposal.policyDecision &&
        (!configuration.runtime.proposalPolicy ||
          digest(configuration.runtime.proposalPolicy) !==
            proposal.policyDecision.policyDigest ||
          digest(template) !== proposal.policyDecision.templateDigest ||
          !configuration.runtime.proposalPolicy.rules.some(
            (rule) =>
              rule.sourceId === item.sourceId &&
              rule.taskTemplateId === template.id,
          ))
      )
        throw new Error(
          "Native proposal policy/template changed before admission",
        );
      const binding = bindingFor(proposal, template);
      const project = configuration.projects.find(
        (p) => p.id === item.projectId,
      );
      if (!project)
        throw new Error("Native implementation project is unregistered");
      const catalog = parseOrchestrationCatalog({
        id: `native-${digest([configuration.id, proposal.id]).slice(0, 32)}`,
        projects: [project],
        tasks: [
          {
            ...createOrchestrationProposalTask(
              template,
              item,
              configuration.revision,
            ),
            sourceItem: {
              provider: item.kind === "issue" ? "github" : "azure-devops",
              id: item.id,
              url: item.url,
              cause: {
                recordKey: `native-proposal:${digest(binding)}`,
                recordVersion: 1,
                recordDigest: digest(binding),
              },
            },
          },
        ],
        maxConcurrency: configuration.focus.maxConcurrency,
        maxRounds: 1,
        maxRepairAttempts: Math.min(3, configuration.focus.budgets.maxAttempts),
        invocationTimeoutMs: Math.min(
          3_600_000,
          configuration.focus.budgets.maxRuntimeMs,
        ),
      });
      const retained = records();
      if (
        retained.some(
          (entry) =>
            parseOrchestrationProposal(entry.proposal).id === proposal.id,
        )
      )
        throw new Error(
          "Native proposal was already admitted; use retained lifecycle recovery",
        );
      retained.push({ schemaVersion: 1, proposal, template, catalog });
      indexSchema.parse(retained);
      write(indexKey(configuration.id), retained, "native-lifecycle-admitted");
      const result = await advance(proposal.id, signal);
      return { receipt: `native-admission:${catalog.id}:${result.status}` };
    },
    async recover(signal: AbortSignal) {
      const diagnostics: string[] = [];
      if (!available) return diagnostics;
      for (const id of ids()) {
        try {
          const { catalog } = read(id);
          const journal = new MultiProjectJournal(context.journalPath!);
          let resumable: boolean;
          try {
            const exists = journal.hasRun(catalog.id);
            const states = exists ? journal.states(catalog.id) : [];
            resumable =
              !exists ||
              states.some((s) => ["pending", "running"].includes(s.status));
          } finally {
            journal.close();
          }
          if (resumable) await advance(id, signal);
        } catch {
          signal.throwIfAborted();
          diagnostics.push(
            `Native lifecycle ${id} requires reconciliation: current approval/source/configuration, journal lease or ownership could not be established; no dispatch is replayed.`,
          );
        }
      }
      return diagnostics;
    },
    summaries() {
      if (!available) return [];
      const journal = new MultiProjectJournal(context.journalPath!);
      try {
        return ids().map((id) => {
          const { catalog, proposal } = read(id);
          return {
            proposalId: id,
            runId: catalog.id,
            configurationRevision: proposal.configurationRevision,
            currentConfiguration:
              proposal.configurationRevision === configuration.revision,
            tasks: journal.hasRun(catalog.id)
              ? journal.states(catalog.id).map((state) => ({
                  key: taskKey(catalog.tasks[0]!),
                  stage: state.stage,
                  status: state.status,
                  reason: state.reason,
                  implementationRecorded: Boolean(state.artifacts.implement),
                  ...(readNativeLocalValidation(
                    store,
                    nativeValidationKey(configuration.id, id),
                  )
                    ? {
                        localValidation: readNativeLocalValidation(
                          store,
                          nativeValidationKey(configuration.id, id),
                        ),
                      }
                    : {}),
                }))
              : [],
          };
        });
      } finally {
        journal.close();
      }
    },
  };
}
