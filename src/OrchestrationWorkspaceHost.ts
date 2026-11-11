import {
  createWorkspaceNativeDispatcher,
  type WorkspaceNativeTickContext,
} from "./OrchestrationNativeDispatch.js";
import type { run } from "./run.js";
import type {
  WorkspaceConfiguration,
  WorkspaceDiscoverySource,
} from "./OrchestrationWorkspaceContract.js";
import {
  evaluateOrchestrationFocus,
  prioritizeOrchestrationProjects,
} from "./OrchestrationFocus.js";
import {
  createOrchestrationDiscoveryAdapter,
  createOrchestrationAdoReadTransport,
  getOrchestrationNativeScopeReadiness,
  type OrchestrationDiscoveryTransport,
} from "./OrchestrationDiscovery.js";
import {
  createConfiguredDevsquadProposalPlanner,
  createOrchestrationLocalExecutionRecorder,
  createOrchestrationNativeTick,
} from "./OrchestrationNativeHost.js";
import {
  createOrchestrationProposalQueue,
  OrchestrationProposalBlockedError,
  priorProposalExecutionHold,
  type OrchestrationIntakeStore,
} from "./OrchestrationProposal.js";
import {
  createGithubWorkflow,
  type GithubWorkflowTransport,
} from "./OrchestrationGithubWorkflow.js";
import { noSandbox } from "./sandboxes/no-sandbox.js";
import { createOrchestrationAzureCliReadTransport } from "./OrchestrationAzureCliTransport.js";
import { digest } from "./MultiProjectProtocol.js";
import type { OrchestrationProposal } from "./OrchestrationProposal.js";
import type { OrchestrationDiscoveredItem } from "./OrchestrationDiscovery.js";

export function workspaceProposalPolicyDecision(
  configuration: WorkspaceConfiguration,
  item: OrchestrationDiscoveredItem,
  proposal: OrchestrationProposal,
) {
  const policy = configuration.runtime.proposalPolicy;
  if (
    configuration.discovery.find((source) => source.id === item.sourceId)
      ?.workflow
  )
    return undefined;
  const rule = policy?.rules.find((rule) => rule.sourceId === item.sourceId);
  const templates = configuration.taskTemplates.filter(
    (task) => task.projectId === item.projectId,
  );
  const template = templates[0];
  if (
    !policy ||
    !rule ||
    !template ||
    templates.length !== 1 ||
    configuration.discovery.find((source) => source.id === item.sourceId)
      ?.projectId !== item.projectId ||
    proposal.source.sourceId !== item.sourceId ||
    proposal.source.id !== item.id ||
    proposal.source.projectId !== item.projectId ||
    !proposal.artifacts ||
    template.id !== rule.taskTemplateId ||
    configuration.runtime.executionTrust !== "trusted-local" ||
    !configuration.runtime.executionControls ||
    configuration.focus.mode !== "execute" ||
    !(["discover", "investigate", "implement"] as const).every(
      (action) =>
        evaluateOrchestrationFocus(configuration.focus, {
          projectId: item.projectId,
          action,
          ...item.scope,
        }).allowed,
    ) ||
    item.kind === "pull-request" ||
    rule?.needsInputTerms?.some((term) =>
      `${item.title}\n${item.body}`.toLowerCase().includes(term.toLowerCase()),
    ) ||
    (item.labels ?? []).some((label) =>
      /^(needs-human|needs-input|do-not-autofix|critical|security|breaking-change)$/i.test(
        label,
      ),
    ) ||
    proposal.configurationRevision !== configuration.revision ||
    proposal.sourceRevision !== item.revision ||
    digest(proposal.artifacts?.acceptance) !==
      digest(
        template.acceptance.map((check) => ({
          criterion: `Trusted host check ${check.label} must pass`,
          verification: `Run configured host check: ${check.command}`,
        })),
      )
  )
    return undefined;
  return { policyDigest: digest(policy), templateDigest: digest(template) };
}

const azureCliTransports = new Map<string, OrchestrationDiscoveryTransport>();

export function workspaceDiscoveryTransport(
  source: WorkspaceDiscoverySource,
): OrchestrationDiscoveryTransport | undefined {
  if (
    source.hub.kind === "ado" &&
    source.authentication?.kind === "azure-cli"
  ) {
    const identity = source.authentication.expectedIdentity.toLowerCase();
    let transport = azureCliTransports.get(identity);
    if (!transport) {
      transport = createOrchestrationAzureCliReadTransport(
        source.authentication,
      );
      azureCliTransports.set(identity, transport);
    }
    return transport;
  }
  if (source.hub.kind === "ado" && process.env.AZURE_DEVOPS_EXT_PAT)
    return createOrchestrationAdoReadTransport({
      kind: "pat",
      token: process.env.AZURE_DEVOPS_EXT_PAT,
    });
  return undefined;
}

export function workspaceScopeDiagnostics(
  configuration: WorkspaceConfiguration,
): string[] {
  return getOrchestrationNativeScopeReadiness({
    focus: configuration.focus,
    discovery: configuration.discovery.filter(
      (source) => discoveryReadPolicy(configuration, source).allowed,
    ),
  }).diagnostics;
}

const discoveryReadPolicy = (
  configuration: WorkspaceConfiguration,
  source: WorkspaceDiscoverySource,
) => {
  const {
    team: _team,
    iteration: _iteration,
    query: _query,
    ...focus
  } = configuration.focus;
  // Only provider-filtered preparatory reads: the native adapter must independently verify each item's scope.
  return evaluateOrchestrationFocus(focus, {
    projectId: source.projectId,
    action: "discover",
  });
};

const readyDiscoverySources = (configuration: WorkspaceConfiguration) => {
  const readiness = getOrchestrationNativeScopeReadiness(configuration);
  return configuration.discovery.filter(
    (source) =>
      discoveryReadPolicy(configuration, source).allowed &&
      readiness.sources.some(
        (scope) => scope.sourceId === source.id && scope.supported,
      ),
  );
};

export function configuredWorkspacePlanner(
  configuration: WorkspaceConfiguration,
  transport: (
    source: WorkspaceDiscoverySource,
  ) =>
    | OrchestrationDiscoveryTransport
    | undefined = workspaceDiscoveryTransport,
  store?: OrchestrationIntakeStore,
  invoke?: typeof run,
) {
  const discovery = readyDiscoverySources(configuration);
  const projectIds = new Set(discovery.map((source) => source.projectId));
  return createConfiguredDevsquadProposalPlanner({
    configuration: {
      ...configuration,
      discovery,
      projects: configuration.projects.filter((project) =>
        projectIds.has(project.id),
      ),
    },
    tasks: configuration.taskTemplates.filter((task) =>
      projectIds.has(task.projectId),
    ),
    evaluateFocus: evaluateOrchestrationFocus,
    transport,
    invoke,
    ...(configuration.runtime.executionTrust === "trusted-local"
      ? {
          sandbox: () => noSandbox(),
          ...(store
            ? {
                recordLocalExecution: createOrchestrationLocalExecutionRecorder(
                  {
                    store,
                    namespace: configuration.id,
                    configurationRevision: configuration.revision,
                  },
                ),
              }
            : {}),
        }
      : {}),
  });
}

export async function inspectWorkspaceReadiness(
  configuration: WorkspaceConfiguration,
  signal: AbortSignal,
  live = false,
  store?: OrchestrationIntakeStore,
) {
  const native = await configuredWorkspacePlanner(
    configuration,
    workspaceDiscoveryTransport,
    store,
  ).preflight(signal);
  const diagnostics = workspaceScopeDiagnostics(configuration);
  const scopeReadiness = getOrchestrationNativeScopeReadiness(configuration);
  const sources: {
    sourceId: string;
    status: "configured" | "ready" | "blocked";
    diagnostic: string;
  }[] = [];
  for (const source of configuration.discovery) {
    const policy = discoveryReadPolicy(configuration, source);
    const scope = scopeReadiness.sources.find(
      (value) => value.sourceId === source.id,
    )!;
    if (!scope.supported || !policy.allowed) {
      sources.push({
        sourceId: source.id,
        status: "blocked",
        diagnostic: !policy.allowed
          ? policy.reason
          : scope.diagnostics.join("; "),
      });
      continue;
    }
    if (
      source.hub.kind === "ado" &&
      !source.authentication &&
      !process.env.AZURE_DEVOPS_EXT_PAT
    ) {
      sources.push({
        sourceId: source.id,
        status: "blocked",
        diagnostic:
          "ADO read transport requires host-only AZURE_DEVOPS_EXT_PAT, explicit identity-bound Azure CLI authentication, or an injected trusted transport",
      });
      continue;
    }
    if (!live) {
      sources.push({
        sourceId: source.id,
        status: "configured",
        diagnostic:
          "Explicit source configured; remote access has not been verified",
      });
      continue;
    }
    try {
      await createOrchestrationDiscoveryAdapter(
        source,
        workspaceDiscoveryTransport(source),
        configuration.focus,
      ).preflight(signal);
      sources.push({
        sourceId: source.id,
        status: "ready",
        diagnostic:
          "Registered repository read access verified; item scope, worker execution and writes remain unverified",
      });
    } catch {
      signal.throwIfAborted();
      sources.push({
        sourceId: source.id,
        status: "blocked",
        diagnostic:
          "Scoped remote read access could not be verified; inspect host authentication and source selection",
      });
    }
  }
  return {
    native,
    sources,
    diagnostics,
    evaluatedSources: sources.length,
    liveReadSources: live
      ? sources.filter((source) => source.status === "ready").length
      : 0,
    liveExecutionVerified: false,
  };
}

export function createWorkspaceNativeTick(
  options: {
    transport?: (
      source: WorkspaceDiscoverySource,
    ) => OrchestrationDiscoveryTransport | undefined;
    /** Trusted test/embedding seam; public CLI uses the actual installed runner. */
    invoke?: typeof run;
    githubWorkflowTransport?: GithubWorkflowTransport;
  } = {},
) {
  return async (context: WorkspaceNativeTickContext) => {
    const { configuration, signal } = context;
    const transport = options.transport ?? workspaceDiscoveryTransport;
    const workflow = createGithubWorkflow({
      configuration,
      store: context.store,
      transport: options.githubWorkflowTransport,
      discoveryTransport: transport,
    });
    const dispatcher = createWorkspaceNativeDispatcher({
      context,
      transport,
      invoke: options.invoke,
      workflow,
    });
    const retained = dispatcher.summaries();
    const diagnostics = [
      ...(!configuration.projects.length ? ["No repositories registered"] : []),
      ...(!configuration.focus.projectIds.length
        ? ["No focused repositories selected"]
        : []),
      ...(!configuration.discovery.length
        ? ["No explicit discovery sources configured"]
        : []),
    ];
    if (diagnostics.length)
      return {
        status: "blocked",
        evaluatedSources: 0,
        proposals: [],
        lifecycles: retained,
        diagnostics,
      };
    const order = prioritizeOrchestrationProjects(
      configuration.focus,
      configuration.projects.map((project) => project.id),
    );
    diagnostics.push(...workspaceScopeDiagnostics(configuration));
    const selected = readyDiscoverySources(configuration).sort(
      (a, b) =>
        order.indexOf(a.projectId) - order.indexOf(b.projectId) ||
        a.id.localeCompare(b.id),
    );
    if (!selected.length)
      return {
        status: "blocked",
        evaluatedSources: 0,
        proposals: [],
        lifecycles: retained,
        diagnostics: [
          ...diagnostics,
          "No supported discovery source has an active exact discover grant",
        ],
      };
    const planner = configuredWorkspacePlanner(
      configuration,
      transport,
      context.store,
      options.invoke,
    );
    const readiness =
      configuration.focus.mode === "observe"
        ? null
        : await planner.preflight(signal);
    if (readiness && !readiness.executionReady)
      diagnostics.push(...readiness.diagnostics);
    const queue = createOrchestrationProposalQueue({
      store: context.store,
      namespace: configuration.id,
    });
    if (configuration.focus.mode === "execute")
      for (const { proposal } of queue.list()) {
        if (
          proposal.status !== "ready" ||
          !workflow.enabled(proposal) ||
          proposal.configurationRevision !== configuration.revision ||
          priorProposalExecutionHold(
            proposal,
            queue.list().map((entry) => entry.proposal),
          )
        )
          continue;
        try {
          await workflow.ready(proposal, signal);
        } catch {
          signal.throwIfAborted();
          workflow.syncFailure(proposal);
          diagnostics.push(
            `Proposal ${proposal.id}: GitHub plan/approval synchronization failed or is uncertain; no approval inferred`,
          );
        }
      }
    if (
      configuration.focus.mode === "execute" &&
      readiness?.executionReady &&
      dispatcher.available
    ) {
      diagnostics.push(...(await dispatcher.recover(signal)));
    }
    const tick = createOrchestrationNativeTick({
      evaluateFocus: evaluateOrchestrationFocus,
      transport,
      ...(configuration.runtime.proposalPolicy
        ? {
            policyDecision: (item, proposal) =>
              workspaceProposalPolicyDecision(configuration, item, proposal),
          }
        : {}),
      // Missing capabilities must not consume implementation or planning reservations.
      planner: readiness?.executionReady
        ? async (item, config, abort) => {
            const proposal = queue
              .list()
              .find(
                ({ proposal }) =>
                  proposal.source.sourceId === item.sourceId &&
                  proposal.source.id === item.id &&
                  proposal.configurationRevision === config.revision &&
                  proposal.sourceRevision === item.revision,
              )?.proposal;
            if (proposal && workflow.enabled(proposal)) {
              try {
                await workflow.stage(
                  proposal,
                  "orchestration-planning",
                  "planning",
                  abort,
                );
              } catch {
                abort.throwIfAborted();
                throw new OrchestrationProposalBlockedError(
                  "GitHub planning stage synchronization failed or is uncertain; no worker launched",
                );
              }
            }
            return planner.plan(item, config, abort);
          }
        : undefined,
      dispatch:
        readiness?.executionReady && dispatcher.available
          ? async (item, proposal, _context, signal) => {
              if (workflow.enabled(proposal)) {
                await workflow.assertApproved(proposal, signal);
                await workflow.stage(
                  proposal,
                  "orchestration-implementing",
                  "initial-implementation",
                  signal,
                );
              }
              return dispatcher.dispatch(item, proposal, signal);
            }
          : undefined,
    });
    const result = await tick({
      ...context,
      configuration: { ...configuration, discovery: selected },
    });
    diagnostics.push(...result.diagnostics);
    for (const { proposal } of result.proposals) {
      if (
        proposal.status !== "unknown" ||
        proposal.planningSettlement ||
        proposal.configurationRevision !== configuration.revision ||
        !workflow.enabled(proposal)
      )
        continue;
      try {
        await workflow.blocked(
          proposal,
          proposal.diagnostic ??
            "Worker outcome is unresolved; retained evidence must be reconciled before any retry.",
          signal,
        );
      } catch {
        signal.throwIfAborted();
        workflow.syncFailure(proposal);
        diagnostics.push(
          `Proposal ${proposal.id}: blocked-status synchronization failed or is uncertain; no retry authorized`,
        );
      }
    }
    if (
      result.proposals.some(({ proposal }) =>
        ["unknown", "dispatching", "planning"].includes(proposal.status),
      )
    ) {
      diagnostics.push(
        "Unresolved proposal outcome retained: inspect canonical operation/lifecycle evidence; automatic dispatch retry is suppressed.",
      );
    }
    const lifecycles = dispatcher.summaries();
    if (
      lifecycles.some((run) =>
        run.tasks.some((task) => task.status !== "completed"),
      )
    ) {
      diagnostics.push(
        "Native lifecycle is admitted, not complete: inspect retained task state; independent proof, acceptance and publication gates remain enforced.",
      );
    }
    return {
      status:
        readiness && !readiness.executionReady
          ? "blocked"
          : diagnostics.length
            ? "partial"
            : "observed",
      evaluatedSources: selected.length,
      proposals: result.proposals.map(({ proposal }) => ({
        id: proposal.id,
        status: proposal.status,
        ...(proposal.diagnostic !== undefined
          ? { diagnostic: proposal.diagnostic }
          : {}),
      })),
      lifecycles,
      diagnostics: [...new Set(diagnostics)],
      ...(readiness ? { readiness } : {}),
    };
  };
}

export const runWorkspaceNativeTick = createWorkspaceNativeTick();
