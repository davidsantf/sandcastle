export type AdoWorkItemId = string | number;

export interface AdoWorkItemContext {
  readonly id: AdoWorkItemId;
  readonly title: string;
  readonly description?: string;
  readonly state?: string;
  readonly url?: string;
  readonly assignedTo?: string;
  readonly areaPath?: string;
  readonly iterationPath?: string;
  readonly parentId?: AdoWorkItemId;
  readonly tags?: readonly string[];
}

export interface AdoWorkItemUpdate {
  readonly title?: string;
  readonly description?: string;
  readonly state?: string;
  readonly assignedTo?: string | null;
  readonly tags?: readonly string[];
}

export interface AdoWorkItemComment {
  readonly id: string;
  readonly workItemId: AdoWorkItemId;
  readonly body: string;
  readonly createdAt: Date;
}

export interface AdoPullRequestRequest {
  readonly title: string;
  readonly description?: string;
  readonly sourceBranch: string;
  readonly targetBranch: string;
  readonly workItemIds?: readonly AdoWorkItemId[];
  readonly draft?: boolean;
}

export interface AdoPullRequestContext {
  readonly id: string;
  readonly url?: string;
  readonly title: string;
  readonly sourceBranch: string;
  readonly targetBranch: string;
  readonly workItemIds: readonly AdoWorkItemId[];
  readonly draft: boolean;
}

export type AdoCiStatus =
  | { readonly status: "pending" }
  | { readonly status: "succeeded" }
  | { readonly status: "failed"; readonly summary: string };

/**
 * Control-plane surface for Azure DevOps-backed orchestration.
 *
 * Implementations are expected to live in the host process (for example, an MCP
 * bridge). Sandcastle templates should not assume this is available as a shell
 * command inside a sandbox.
 */
export interface AdoControlPlane {
  readonly fetchWorkItem: (
    id: AdoWorkItemId,
  ) => Promise<AdoWorkItemContext | undefined>;
  readonly updateWorkItem: (
    id: AdoWorkItemId,
    update: AdoWorkItemUpdate,
  ) => Promise<AdoWorkItemContext>;
  readonly addWorkItemComment: (
    id: AdoWorkItemId,
    body: string,
  ) => Promise<AdoWorkItemComment>;
  readonly createPullRequest: (
    request: AdoPullRequestRequest,
  ) => Promise<AdoPullRequestContext>;
  readonly getPullRequestCiStatus: (
    pullRequestId: string,
  ) => Promise<AdoCiStatus>;
}

export type AdoTeamRole = "planner" | "implementer" | "reviewer" | "merger";

export interface AdoTeamAgentAssignment {
  readonly agentId: string;
  readonly role: AdoTeamRole;
  readonly workItemId?: AdoWorkItemId;
  readonly branch?: string;
  readonly worktreePath?: string;
  /**
   * Allows a second implementer to pick up the same work item intentionally,
   * while branch and worktree uniqueness are still enforced.
   */
  readonly allowDuplicateWorkItem?: boolean;
}

export interface AdoTeamConfig {
  readonly assignments: readonly AdoTeamAgentAssignment[];
  readonly allowDuplicateWorkItems?: boolean;
}

export type AdoTeamValidationErrorCode =
  | "duplicate-work-item"
  | "shared-branch"
  | "shared-worktree";

export interface AdoTeamValidationError {
  readonly code: AdoTeamValidationErrorCode;
  readonly message: string;
  readonly assignmentIds: readonly string[];
  readonly value: string;
}

export type AdoTeamValidationResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly errors: readonly AdoTeamValidationError[];
    };

const normalizeWorkItemId = (id: AdoWorkItemId): string => String(id).trim();

const normalizePath = (path: string): string =>
  path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

const collectDuplicates = <T extends AdoTeamAgentAssignment>(
  assignments: readonly T[],
  valueFor: (assignment: T) => string | undefined,
  code: AdoTeamValidationErrorCode,
  label: string,
): AdoTeamValidationError[] => {
  const byValue = new Map<string, T[]>();

  for (const assignment of assignments) {
    const value = valueFor(assignment);
    if (value === undefined || value.length === 0) continue;
    const matches = byValue.get(value) ?? [];
    matches.push(assignment);
    byValue.set(value, matches);
  }

  return Array.from(byValue.entries())
    .filter(([, matches]) => matches.length > 1)
    .map(([value, matches]) => ({
      code,
      value,
      assignmentIds: matches.map((assignment) => assignment.agentId),
      message: `Parallel ADO implementers cannot share ${label} '${value}'`,
    }));
};

/**
 * Validates that parallel implementers are isolated from each other.
 *
 * Branches and worktrees must always be unique. Work items must also be unique
 * unless duplicate handling is explicitly enabled at config or assignment level.
 */
export const validateAdoTeamConfig = (
  config: AdoTeamConfig,
): AdoTeamValidationResult => {
  const implementers = config.assignments.filter(
    (assignment) => assignment.role === "implementer",
  );

  const duplicateWorkItemsAllowed = config.allowDuplicateWorkItems === true;
  const workItemAssignments = duplicateWorkItemsAllowed
    ? []
    : implementers.filter(
        (assignment) => assignment.allowDuplicateWorkItem !== true,
      );

  const errors = [
    ...collectDuplicates(
      workItemAssignments,
      (assignment) =>
        assignment.workItemId === undefined
          ? undefined
          : normalizeWorkItemId(assignment.workItemId),
      "duplicate-work-item",
      "work item",
    ),
    ...collectDuplicates(
      implementers,
      (assignment) => assignment.branch,
      "shared-branch",
      "branch",
    ),
    ...collectDuplicates(
      implementers,
      (assignment) =>
        assignment.worktreePath === undefined
          ? undefined
          : normalizePath(assignment.worktreePath),
      "shared-worktree",
      "worktree",
    ),
  ];

  if (errors.length === 0) return { ok: true };
  return { ok: false, errors };
};

const sanitizeBranchSegment = (value: string): string => {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (sanitized.length === 0) {
    throw new Error(
      "ADO work item id must contain at least one letter or digit",
    );
  }

  return sanitized;
};

/** Creates a stable branch name for an Azure DevOps work item. */
export const createAdoWorkItemBranchName = (
  id: AdoWorkItemId,
  prefix = "sandcastle",
): string =>
  `${sanitizeBranchSegment(prefix)}/ado-${sanitizeBranchSegment(String(id))}`;

const cloneWorkItem = (workItem: AdoWorkItemContext): AdoWorkItemContext => ({
  ...workItem,
  tags: workItem.tags === undefined ? undefined : [...workItem.tags],
});

/** In-memory control plane for tests and local orchestration dry runs. */
export class FakeAdoControlPlane implements AdoControlPlane {
  readonly #workItems = new Map<string, AdoWorkItemContext>();
  readonly #comments: AdoWorkItemComment[] = [];
  readonly #pullRequests = new Map<string, AdoPullRequestContext>();
  #nextCommentId = 1;
  #nextPullRequestId = 1;
  #ciStatus: AdoCiStatus = { status: "pending" };

  constructor(workItems: readonly AdoWorkItemContext[] = []) {
    for (const workItem of workItems) {
      this.#workItems.set(
        normalizeWorkItemId(workItem.id),
        cloneWorkItem(workItem),
      );
    }
  }

  async fetchWorkItem(
    id: AdoWorkItemId,
  ): Promise<AdoWorkItemContext | undefined> {
    const workItem = this.#workItems.get(normalizeWorkItemId(id));
    return workItem === undefined ? undefined : cloneWorkItem(workItem);
  }

  async updateWorkItem(
    id: AdoWorkItemId,
    update: AdoWorkItemUpdate,
  ): Promise<AdoWorkItemContext> {
    const key = normalizeWorkItemId(id);
    const current = this.#workItems.get(key);
    if (current === undefined) {
      throw new Error(`ADO work item '${key}' was not found`);
    }

    const next: AdoWorkItemContext = {
      ...current,
      ...update,
      assignedTo:
        update.assignedTo === null
          ? undefined
          : (update.assignedTo ?? current.assignedTo),
      tags: update.tags === undefined ? current.tags : [...update.tags],
    };
    this.#workItems.set(key, next);
    return cloneWorkItem(next);
  }

  async addWorkItemComment(
    id: AdoWorkItemId,
    body: string,
  ): Promise<AdoWorkItemComment> {
    const key = normalizeWorkItemId(id);
    if (!this.#workItems.has(key)) {
      throw new Error(`ADO work item '${key}' was not found`);
    }

    const comment: AdoWorkItemComment = {
      id: String(this.#nextCommentId++),
      workItemId: id,
      body,
      createdAt: new Date(0),
    };
    this.#comments.push(comment);
    return comment;
  }

  async createPullRequest(
    request: AdoPullRequestRequest,
  ): Promise<AdoPullRequestContext> {
    const pullRequest: AdoPullRequestContext = {
      id: String(this.#nextPullRequestId++),
      title: request.title,
      sourceBranch: request.sourceBranch,
      targetBranch: request.targetBranch,
      workItemIds:
        request.workItemIds === undefined ? [] : [...request.workItemIds],
      draft: request.draft ?? false,
    };
    this.#pullRequests.set(pullRequest.id, pullRequest);
    return pullRequest;
  }

  async getPullRequestCiStatus(_pullRequestId: string): Promise<AdoCiStatus> {
    return this.#ciStatus;
  }

  setPullRequestCiStatus(status: AdoCiStatus): void {
    this.#ciStatus = status;
  }

  listComments(): readonly AdoWorkItemComment[] {
    return [...this.#comments];
  }
}
