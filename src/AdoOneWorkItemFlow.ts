import {
  createAdoWorkItemBranchName,
  validateAdoTeamConfig,
  type AdoControlPlane,
  type AdoTeamAgentAssignment,
  type AdoTeamConfig,
  type AdoTeamValidationResult,
  type AdoWorkItemComment,
  type AdoWorkItemContext,
  type AdoWorkItemId,
} from "./AdoTeam.js";

export interface PrepareAdoWorkItemRunOptions {
  readonly controlPlane: AdoControlPlane;
  readonly workItemId: AdoWorkItemId;
  readonly implementerAgentId: string;
  readonly branch?: string;
  readonly branchPrefix?: string;
  /**
   * Existing implementer assignments to validate against when this one-work-item
   * preparation is composed into a larger local team run.
   */
  readonly existingAssignments?: readonly AdoTeamAgentAssignment[];
  /**
   * Skips writing the start/progress comment while still returning the planned
   * assignment and validation result.
   */
  readonly skipComment?: boolean;
  /** Alias for skipComment for demo and planning callers. */
  readonly dryRun?: boolean;
  readonly progressComment?: string;
}

export interface AdoWorkItemRunPreparationResult {
  readonly workItem: AdoWorkItemContext;
  readonly branch: string;
  readonly assignment: AdoTeamAgentAssignment;
  readonly teamConfig: AdoTeamConfig;
  readonly validation: AdoTeamValidationResult;
  readonly comment?: AdoWorkItemComment;
  readonly dryRun: boolean;
}

const defaultProgressComment = (
  workItem: AdoWorkItemContext,
  assignment: AdoTeamAgentAssignment,
): string =>
  [
    "Sandcastle ADO one-work-item demo prepared an implementer run.",
    `Work item: ${String(workItem.id)} - ${workItem.title}`,
    `Implementer: ${assignment.agentId}`,
    `Branch: ${assignment.branch ?? "(not assigned)"}`,
  ].join("\n");

/**
 * Prepares a deterministic one-work-item ADO implementer run without starting
 * real agents, creating git worktrees, entering sandboxes, or calling live ADO.
 */
export const prepareAdoWorkItemRun = async (
  options: PrepareAdoWorkItemRunOptions,
): Promise<AdoWorkItemRunPreparationResult> => {
  const workItem = await options.controlPlane.fetchWorkItem(options.workItemId);
  if (workItem === undefined) {
    throw new Error(
      `ADO work item '${String(options.workItemId)}' was not found`,
    );
  }

  const branch =
    options.branch ??
    createAdoWorkItemBranchName(workItem.id, options.branchPrefix);

  const assignment: AdoTeamAgentAssignment = {
    agentId: options.implementerAgentId,
    role: "implementer",
    workItemId: workItem.id,
    branch,
  };

  const teamConfig: AdoTeamConfig = {
    assignments: [...(options.existingAssignments ?? []), assignment],
  };
  const validation = validateAdoTeamConfig(teamConfig);
  const dryRun = options.dryRun === true || options.skipComment === true;

  if (!validation.ok || dryRun) {
    return {
      workItem,
      branch,
      assignment,
      teamConfig,
      validation,
      dryRun,
    };
  }

  const comment = await options.controlPlane.addWorkItemComment(
    workItem.id,
    options.progressComment ?? defaultProgressComment(workItem, assignment),
  );

  return {
    workItem,
    branch,
    assignment,
    teamConfig,
    validation,
    comment,
    dryRun,
  };
};

export const startAdoWorkItemRun = prepareAdoWorkItemRun;
