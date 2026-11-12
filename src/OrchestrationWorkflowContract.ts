import { digest } from "./MultiProjectProtocol.js";
import type { OrchestrationDiscoveredItem } from "./OrchestrationDiscovery.js";
import type { OrchestrationIntakeStore } from "./OrchestrationProposal.js";
import type {
  WorkspaceConfiguration,
  WorkspaceDiscoverySource,
} from "./OrchestrationWorkspaceContract.js";

export const orchestrationWorkflowLabels: readonly string[] = [
  "orchestration-ready",
  "orchestration-planning",
  "orchestration-user-approval",
  "orchestration-implementation-ready",
  "orchestration-implementing",
  "orchestration-reviewing",
  "orchestration-finished",
];
export const workflowOwner = (stage: string) =>
  stage === "orchestration-user-approval"
    ? "user"
    : stage === "orchestration-finished"
      ? "none"
      : "agent";

export const githubWorkflowAdmissionKey = (
  configuration: Pick<WorkspaceConfiguration, "id" | "revision">,
  source: WorkspaceDiscoverySource,
  itemId: string,
) =>
  `hub-workflow-admission/${digest([configuration.id, configuration.revision, source, itemId])}`;

/** Continuity is host evidence, never authority inferred from a remote stage label. */
export const retainedGithubWorkflowAdmission =
  (
    configuration: Pick<
      WorkspaceConfiguration,
      "id" | "revision" | "discovery"
    >,
    store: OrchestrationIntakeStore,
  ) =>
  (item: OrchestrationDiscoveredItem) => {
    const source = configuration.discovery.find(
      (source) =>
        source.id === item.sourceId && source.projectId === item.projectId,
    );
    return Boolean(
      source?.workflow &&
      source.hub.kind === "github" &&
      ("optedInLabel" in source.selector
        ? source.selector.optedInLabel
        : "assignedToOrLabel" in source.selector
          ? source.selector.assignedToOrLabel.optedInLabel
          : undefined) === "orchestration-ready" &&
      item.kind === "issue" &&
      item.labels?.some(
        (label) =>
          label !== "orchestration-ready" &&
          orchestrationWorkflowLabels.includes(label),
      ) &&
      digest(
        store.read(githubWorkflowAdmissionKey(configuration, source, item.id))
          .value,
      ) === digest({ admitted: true }),
    );
  };
