import type { AgentProvider } from "./AgentProvider.js";
import type { SandboxProvider } from "./SandboxProvider.js";
import {
  createSandcastleOrchestrationWorker,
  resolveOrchestrationGitRevision,
} from "./MultiProjectWorker.js";
import {
  createAdoOrchestrationHub,
  createGitHubOrchestrationHub,
  type OrchestrationHubTransport,
} from "./MultiProjectHubs.js";
import type { MultiProjectHost } from "./MultiProjectOrchestrator.js";
import type { OrchestrationWorkerRequest } from "./MultiProjectProtocol.js";

export function createMultiProjectSandcastleHost(options: {
  agent: AgentProvider;
  sandbox: (request: OrchestrationWorkerRequest) => SandboxProvider;
  authorize: MultiProjectHost["authorize"];
  validate: MultiProjectHost["validate"];
  githubTransport?: OrchestrationHubTransport;
  adoTransport?: OrchestrationHubTransport;
}): MultiProjectHost {
  const github = createGitHubOrchestrationHub(options.githubTransport);
  const ado = options.adoTransport
    ? createAdoOrchestrationHub(options.adoTransport)
    : undefined;
  return {
    authorize: options.authorize,
    validate: options.validate,
    execute: createSandcastleOrchestrationWorker(options),
    resolveRevision: resolveOrchestrationGitRevision,
    observe: async (project, task, signal) => {
      const boundProject = {
        ...project,
        hub: {
          ...project.hub,
          pullRequest: task.pullRequest ?? project.hub.pullRequest,
        },
      };
      const binding = {
        sourceBranch: task.branch,
        targetBranch: task.baseBranch,
      };
      if (project.hub.kind === "github")
        return github(boundProject, signal, binding);
      if (!ado)
        return {
          revision: "",
          policiesKnown: false,
          required: [],
          checks: [],
          labels: [],
          diagnostic: "ADO host transport not configured",
        };
      return ado(boundProject, signal, binding);
    },
  };
}
