import { runAdoFeedbackLoop } from "./AdoFeedbackLoop.js";
import { publishAdoPullRequest } from "./AdoPullRequestPublisher.js";
import { validateAdoTeamConfig } from "./AdoTeam.js";
import type {
  AdoFeedbackLoopResult,
  RunAdoFeedbackLoopOptions,
} from "./AdoFeedbackLoop.js";
import type {
  PublishAdoPullRequestOptions,
  PublishAdoPullRequestResult,
} from "./AdoPullRequestPublisher.js";
import type {
  AdoControlPlane,
  AdoTeamAgentAssignment,
  AdoTeamValidationError,
  AdoTeamValidationResult,
} from "./AdoTeam.js";

export type AdoTeamRunnerValidationErrorCode =
  | AdoTeamValidationError["code"]
  | "invalid-max-parallelism"
  | "invalid-max-assignments"
  | "missing-work-item"
  | "missing-branch"
  | "missing-worktree";

export interface AdoTeamRunnerValidationError {
  readonly code: AdoTeamRunnerValidationErrorCode;
  readonly message: string;
  readonly assignmentIds: readonly string[];
  readonly value: string;
}

export type AdoTeamRunnerValidationResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly errors: readonly AdoTeamRunnerValidationError[];
    };

export type AdoTeamRunnerAssignmentStatus =
  | "completed"
  | "failed"
  | "pending"
  | "skipped";

export interface AdoTeamLocalExecutionResult {
  readonly status?: "completed" | "failed";
  readonly summary?: string;
  readonly branch?: string;
  readonly worktreePath?: string;
  readonly error?: unknown;
}

export interface AdoTeamLocalExecutionContext {
  readonly assignment: AdoTeamAgentAssignment;
  readonly assignmentIndex: number;
  readonly controlPlane: AdoControlPlane;
}

export type AdoTeamLocalExecution = (
  context: AdoTeamLocalExecutionContext,
) => Promise<AdoTeamLocalExecutionResult>;

export interface AdoTeamPullRequestContext {
  readonly assignment: AdoTeamAgentAssignment;
  readonly assignmentIndex: number;
  readonly controlPlane: AdoControlPlane;
  readonly localExecution: AdoTeamLocalExecutionResult;
}

export type AdoTeamPullRequestOptionsFactory = (
  context: AdoTeamPullRequestContext,
) =>
  | Promise<PublishAdoPullRequestOptions | undefined>
  | PublishAdoPullRequestOptions
  | undefined;

export type AdoTeamPullRequestPublisher = (
  context: AdoTeamPullRequestContext & {
    readonly options: PublishAdoPullRequestOptions;
  },
) => Promise<PublishAdoPullRequestResult>;

export interface AdoTeamFeedbackLoopContext extends AdoTeamPullRequestContext {
  readonly pullRequestResult: PublishAdoPullRequestResult;
}

export type AdoTeamFeedbackLoopOptionsFactory = (
  context: AdoTeamFeedbackLoopContext,
) =>
  | Promise<
      | Omit<
          RunAdoFeedbackLoopOptions,
          "controlPlane" | "workItemId" | "pullRequest"
        >
      | undefined
    >
  | Omit<
      RunAdoFeedbackLoopOptions,
      "controlPlane" | "workItemId" | "pullRequest"
    >
  | undefined;

export type AdoTeamFeedbackLoopRunner = (
  context: AdoTeamFeedbackLoopContext & {
    readonly options: Omit<
      RunAdoFeedbackLoopOptions,
      "controlPlane" | "workItemId" | "pullRequest"
    >;
  },
) => Promise<AdoFeedbackLoopResult>;

export interface AdoTeamRunnerExecutionBounds {
  /** Maximum number of implementer assignments that may be started by one run. */
  readonly maxAssignmentsToStart?: number;
  /** How unstarted assignments are reported when maxAssignmentsToStart is reached. */
  readonly unstartedAssignmentStatus?: "pending" | "skipped";
}

export interface RunAdoTeamOptions {
  readonly assignments: readonly AdoTeamAgentAssignment[];
  readonly maxParallelism: number;
  readonly allowDuplicateWorkItems?: boolean;
  readonly executionBounds?: AdoTeamRunnerExecutionBounds;
  readonly controlPlane: AdoControlPlane;
  readonly executeLocal: AdoTeamLocalExecution;
  readonly createPullRequestOptions?: AdoTeamPullRequestOptionsFactory;
  readonly publishPullRequest?: AdoTeamPullRequestPublisher;
  readonly createFeedbackLoopOptions?: AdoTeamFeedbackLoopOptionsFactory;
  readonly runFeedbackLoop?: AdoTeamFeedbackLoopRunner;
}

export interface AdoTeamRunnerAssignmentResult {
  readonly assignment: AdoTeamAgentAssignment;
  readonly status: AdoTeamRunnerAssignmentStatus;
  readonly validation: AdoTeamRunnerValidationResult;
  readonly branch?: string;
  readonly worktreePath?: string;
  readonly localExecution?: AdoTeamLocalExecutionResult;
  readonly pullRequest?: PublishAdoPullRequestResult;
  readonly feedbackLoop?: AdoFeedbackLoopResult;
  readonly skippedReason?: string;
  readonly pendingReason?: string;
  readonly error?: unknown;
}

export interface AdoTeamRunnerCounts {
  readonly completed: number;
  readonly failed: number;
  readonly pending: number;
  readonly skipped: number;
}

export interface AdoTeamRunnerResult {
  readonly status: "completed" | "rejected" | "bounded";
  readonly validation: AdoTeamRunnerValidationResult;
  readonly assignments: readonly AdoTeamRunnerAssignmentResult[];
  readonly counts: AdoTeamRunnerCounts;
  readonly bounded: boolean;
  readonly startedCount: number;
  readonly maxParallelism: number;
}

const isPositiveInteger = (value: number): boolean =>
  Number.isInteger(value) && value > 0;

const implementerAssignments = (
  assignments: readonly AdoTeamAgentAssignment[],
): readonly AdoTeamAgentAssignment[] =>
  assignments.filter((assignment) => assignment.role === "implementer");

const assignmentWorkItem = (assignment: AdoTeamAgentAssignment): string =>
  assignment.workItemId === undefined
    ? ""
    : String(assignment.workItemId).trim();

const assignmentBranch = (assignment: AdoTeamAgentAssignment): string =>
  assignment.branch ?? "";

const assignmentWorktree = (assignment: AdoTeamAgentAssignment): string =>
  assignment.worktreePath ?? "";

const missingAssignmentErrors = (
  assignments: readonly AdoTeamAgentAssignment[],
): readonly AdoTeamRunnerValidationError[] =>
  implementerAssignments(assignments).flatMap((assignment) => {
    const errors: AdoTeamRunnerValidationError[] = [];
    if (assignmentWorkItem(assignment).length === 0) {
      errors.push({
        code: "missing-work-item",
        value: assignment.agentId,
        assignmentIds: [assignment.agentId],
        message: `ADO implementer '${assignment.agentId}' requires a primary work item assignment`,
      });
    }

    if (assignmentBranch(assignment).length === 0) {
      errors.push({
        code: "missing-branch",
        value: assignment.agentId,
        assignmentIds: [assignment.agentId],
        message: `ADO implementer '${assignment.agentId}' requires a branch assignment`,
      });
    }

    if (assignmentWorktree(assignment).length === 0) {
      errors.push({
        code: "missing-worktree",
        value: assignment.agentId,
        assignmentIds: [assignment.agentId],
        message: `ADO implementer '${assignment.agentId}' requires a worktree assignment`,
      });
    }

    return errors;
  });

const normalizeTeamValidationError = (
  error: AdoTeamValidationError,
): AdoTeamRunnerValidationError => ({ ...error });

export const validateAdoTeamRunnerOptions = (
  options: Pick<
    RunAdoTeamOptions,
    | "assignments"
    | "allowDuplicateWorkItems"
    | "executionBounds"
    | "maxParallelism"
  >,
): AdoTeamRunnerValidationResult => {
  const errors: AdoTeamRunnerValidationError[] = [];

  if (!isPositiveInteger(options.maxParallelism)) {
    errors.push({
      code: "invalid-max-parallelism",
      value: String(options.maxParallelism),
      assignmentIds: [],
      message:
        "ADO team runner option 'maxParallelism' must be a positive integer",
    });
  }

  const maxAssignmentsToStart = options.executionBounds?.maxAssignmentsToStart;
  if (
    maxAssignmentsToStart !== undefined &&
    !isPositiveInteger(maxAssignmentsToStart)
  ) {
    errors.push({
      code: "invalid-max-assignments",
      value: String(maxAssignmentsToStart),
      assignmentIds: [],
      message:
        "ADO team runner execution bound 'maxAssignmentsToStart' must be a positive integer when provided",
    });
  }

  errors.push(...missingAssignmentErrors(options.assignments));

  const teamValidation = validateAdoTeamConfig({
    assignments: options.assignments,
    allowDuplicateWorkItems: options.allowDuplicateWorkItems,
  });
  if (!teamValidation.ok) {
    errors.push(...teamValidation.errors.map(normalizeTeamValidationError));
  }

  if (errors.length === 0) return { ok: true };
  return { ok: false, errors };
};

const validationForAssignment = (
  assignment: AdoTeamAgentAssignment,
  validation: AdoTeamRunnerValidationResult,
): AdoTeamRunnerValidationResult => {
  if (validation.ok) return { ok: true };
  const errors = validation.errors.filter(
    (error) =>
      error.assignmentIds.length === 0 ||
      error.assignmentIds.includes(assignment.agentId),
  );

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
};

const createSkippedAssignmentResult = (
  assignment: AdoTeamAgentAssignment,
  validation: AdoTeamRunnerValidationResult,
  skippedReason: string,
): AdoTeamRunnerAssignmentResult => ({
  assignment,
  status: "skipped",
  validation: validationForAssignment(assignment, validation),
  branch: assignment.branch,
  worktreePath: assignment.worktreePath,
  skippedReason,
});

const countsFor = (
  assignments: readonly AdoTeamRunnerAssignmentResult[],
): AdoTeamRunnerCounts => ({
  completed: assignments.filter(
    (assignment) => assignment.status === "completed",
  ).length,
  failed: assignments.filter((assignment) => assignment.status === "failed")
    .length,
  pending: assignments.filter((assignment) => assignment.status === "pending")
    .length,
  skipped: assignments.filter((assignment) => assignment.status === "skipped")
    .length,
});

const defaultPublishPullRequest: AdoTeamPullRequestPublisher = async (
  context,
) => publishAdoPullRequest(context.controlPlane, context.options);

const defaultRunFeedbackLoop: AdoTeamFeedbackLoopRunner = async (context) => {
  const workItemId = context.assignment.workItemId;
  if (workItemId === undefined) {
    throw new Error(
      `ADO feedback loop requires implementer '${context.assignment.agentId}' to have a primary work item`,
    );
  }

  return runAdoFeedbackLoop({
    ...context.options,
    controlPlane: context.controlPlane,
    workItemId,
    pullRequest: context.pullRequestResult.pullRequest,
  });
};

const normalizeLocalExecutionResult = (
  assignment: AdoTeamAgentAssignment,
  result: AdoTeamLocalExecutionResult,
): AdoTeamLocalExecutionResult => ({
  ...result,
  status: result.status ?? "completed",
  branch: result.branch ?? assignment.branch,
  worktreePath: result.worktreePath ?? assignment.worktreePath,
});

const executeAssignment = async (
  options: RunAdoTeamOptions,
  assignment: AdoTeamAgentAssignment,
  assignmentIndex: number,
): Promise<AdoTeamRunnerAssignmentResult> => {
  const context: AdoTeamLocalExecutionContext = {
    assignment,
    assignmentIndex,
    controlPlane: options.controlPlane,
  };

  let localExecution: AdoTeamLocalExecutionResult;
  try {
    localExecution = normalizeLocalExecutionResult(
      assignment,
      await options.executeLocal(context),
    );
  } catch (error) {
    return {
      assignment,
      status: "failed",
      validation: { ok: true },
      branch: assignment.branch,
      worktreePath: assignment.worktreePath,
      error,
    };
  }

  if (localExecution.status === "failed") {
    return {
      assignment,
      status: "failed",
      validation: { ok: true },
      branch: localExecution.branch,
      worktreePath: localExecution.worktreePath,
      localExecution,
      error: localExecution.error,
    };
  }

  let pullRequest: PublishAdoPullRequestResult | undefined;
  try {
    const pullRequestOptions = await options.createPullRequestOptions?.({
      ...context,
      localExecution,
    });
    pullRequest =
      pullRequestOptions === undefined
        ? undefined
        : await (options.publishPullRequest ?? defaultPublishPullRequest)({
            ...context,
            localExecution,
            options: pullRequestOptions,
          });

    const feedbackLoopOptions =
      pullRequest === undefined
        ? undefined
        : await options.createFeedbackLoopOptions?.({
            ...context,
            localExecution,
            pullRequestResult: pullRequest,
          });
    const feedbackLoop =
      pullRequest === undefined || feedbackLoopOptions === undefined
        ? undefined
        : await (options.runFeedbackLoop ?? defaultRunFeedbackLoop)({
            ...context,
            localExecution,
            pullRequestResult: pullRequest,
            options: feedbackLoopOptions,
          });

    return {
      assignment,
      status: "completed",
      validation: { ok: true },
      branch: localExecution.branch,
      worktreePath: localExecution.worktreePath,
      localExecution,
      pullRequest,
      feedbackLoop,
    };
  } catch (error) {
    return {
      assignment,
      status: "failed",
      validation: { ok: true },
      branch: localExecution.branch,
      worktreePath: localExecution.worktreePath,
      localExecution,
      pullRequest,
      error,
    };
  }
};
const createPendingAssignmentResult = (
  assignment: AdoTeamAgentAssignment,
  reason: string,
): AdoTeamRunnerAssignmentResult => ({
  assignment,
  status: "pending",
  validation: { ok: true },
  branch: assignment.branch,
  worktreePath: assignment.worktreePath,
  pendingReason: reason,
});

const createBoundedAssignmentResult = (
  assignment: AdoTeamAgentAssignment,
  status: "pending" | "skipped",
): AdoTeamRunnerAssignmentResult =>
  status === "pending"
    ? createPendingAssignmentResult(
        assignment,
        "execution bound reached before this implementer assignment was started",
      )
    : createSkippedAssignmentResult(
        assignment,
        { ok: true },
        "execution bound reached before this implementer assignment was started",
      );

/**
 * Coordinates ADO implementer assignments through injected seams.
 *
 * The runner validates RF-014..RF-023 isolation constraints before local
 * execution, schedules bounded implementer work with maxParallelism, and keeps
 * git, sandbox, command execution, tests, commits, PR publication, and feedback
 * observation behind injected or composed Sandcastle helpers.
 */
export const runAdoTeam = async (
  options: RunAdoTeamOptions,
): Promise<AdoTeamRunnerResult> => {
  const validation = validateAdoTeamRunnerOptions(options);
  const implementers = implementerAssignments(options.assignments);

  if (!validation.ok) {
    const assignments = implementers.map((assignment) =>
      createSkippedAssignmentResult(
        assignment,
        validation,
        "validation failed before local execution started",
      ),
    );

    return {
      status: "rejected",
      validation,
      assignments,
      counts: countsFor(assignments),
      bounded: false,
      startedCount: 0,
      maxParallelism: options.maxParallelism,
    };
  }

  const maxAssignmentsToStart =
    options.executionBounds?.maxAssignmentsToStart ?? implementers.length;
  const assignmentsToStart = implementers.slice(0, maxAssignmentsToStart);
  const unstartedStatus =
    options.executionBounds?.unstartedAssignmentStatus ?? "pending";
  const boundedAssignments = implementers
    .slice(maxAssignmentsToStart)
    .map((assignment) =>
      createBoundedAssignmentResult(assignment, unstartedStatus),
    );

  const startedResults = new Array<AdoTeamRunnerAssignmentResult>(
    assignmentsToStart.length,
  );
  let nextAssignmentIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextAssignmentIndex < assignmentsToStart.length) {
      const assignmentIndex = nextAssignmentIndex;
      nextAssignmentIndex += 1;
      const assignment = assignmentsToStart[assignmentIndex]!;
      startedResults[assignmentIndex] = await executeAssignment(
        options,
        assignment,
        assignmentIndex,
      );
    }
  };

  const workerCount = Math.min(
    options.maxParallelism,
    assignmentsToStart.length,
  );
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      await worker();
    }),
  );

  const assignments = [...startedResults, ...boundedAssignments];
  const bounded = boundedAssignments.length > 0;

  return {
    status: bounded ? "bounded" : "completed",
    validation,
    assignments,
    counts: countsFor(assignments),
    bounded,
    startedCount: assignmentsToStart.length,
    maxParallelism: options.maxParallelism,
  };
};
