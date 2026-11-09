import type { LocalOrchestrationTickContext } from "./LocalOrchestrationService.js";
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
  createOrchestrationNativeTick,
} from "./OrchestrationNativeHost.js";

export function workspaceDiscoveryTransport(
  source: WorkspaceDiscoverySource,
): OrchestrationDiscoveryTransport | undefined {
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
  });
}

export async function inspectWorkspaceReadiness(
  configuration: WorkspaceConfiguration,
  signal: AbortSignal,
  live = false,
) {
  const native =
    await configuredWorkspacePlanner(configuration).preflight(signal);
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
    if (source.hub.kind === "ado" && !process.env.AZURE_DEVOPS_EXT_PAT) {
      sources.push({
        sourceId: source.id,
        status: "blocked",
        diagnostic:
          "ADO read transport requires host-only AZURE_DEVOPS_EXT_PAT or an injected trusted transport",
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
  } = {},
) {
  return async (
    context: LocalOrchestrationTickContext<WorkspaceConfiguration>,
  ) => {
    const { configuration, signal } = context;
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
        diagnostics: [
          ...diagnostics,
          "No supported discovery source has an active exact discover grant",
        ],
      };
    const transport = options.transport ?? workspaceDiscoveryTransport;
    const planner = configuredWorkspacePlanner(configuration, transport);
    const readiness =
      configuration.focus.mode === "observe"
        ? null
        : await planner.preflight(signal);
    if (readiness && !readiness.executionReady)
      diagnostics.push(...readiness.diagnostics);
    const tick = createOrchestrationNativeTick({
      evaluateFocus: evaluateOrchestrationFocus,
      transport,
      // Missing capabilities must not consume implementation or planning reservations.
      planner: readiness?.executionReady ? planner.plan : undefined,
    });
    const result = await tick({
      ...context,
      configuration: { ...configuration, discovery: selected },
    });
    diagnostics.push(...result.diagnostics);
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
        diagnostic: proposal.diagnostic,
      })),
      diagnostics: [...new Set(diagnostics)],
      ...(readiness ? { readiness } : {}),
    };
  };
}

export const runWorkspaceNativeTick = createWorkspaceNativeTick();
