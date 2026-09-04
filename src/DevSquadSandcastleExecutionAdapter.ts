import { exec } from "node:child_process";
import { promisify } from "node:util";
import { run } from "./run.js";
import type { AgentProvider } from "./AgentProvider.js";
import type { LoggingOption, RunResult, Timeouts } from "./run.js";
import type { BranchStrategy, SandboxProvider } from "./SandboxProvider.js";

const execAsync = promisify(exec);

export type DevSquadSandcastleExecutionStatus =
  | "completed"
  | "input-invalid"
  | "execution-failed"
  | "validation-failed";

export type DevSquadSandcastleFailureCategory =
  | "input-validation"
  | "execution"
  | "validation";

export type DevSquadValidationCommandStatus = "passed" | "failed" | "skipped";

export type DevSquadValidationOverallStatus = "passed" | "failed" | "skipped";

export type DevSquadSandcastleAgentRole = "implementer" | (string & {});

export interface DevSquadRepoContext {
  readonly hostRepoPath: string;
  readonly worktreePath: string;
  readonly workingDirectory?: string;
}

export interface DevSquadBranchContext {
  readonly sourceBranch: string;
  readonly targetBranch: string;
}

export interface DevSquadWorkItemContext {
  readonly id: string | number;
  readonly title: string;
  readonly description?: string;
  readonly url?: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface DevSquadValidationCommand {
  readonly label: string;
  readonly command: string;
  readonly description?: string;
  readonly cwd?: string;
}

export interface DevSquadExecutionBounds {
  readonly maxIterations?: number;
  readonly idleTimeoutSeconds?: number;
  readonly completionTimeoutSeconds?: number;
  readonly timeoutMs?: number;
}

export interface DevSquadSandcastleRunConfig {
  readonly agent: AgentProvider;
  readonly sandbox: SandboxProvider;
  readonly name?: string;
  readonly logging?: LoggingOption;
  readonly completionSignal?: string | readonly string[];
  readonly copyToWorktree?: readonly string[];
  readonly branchStrategy?: BranchStrategy;
  readonly timeouts?: Timeouts;
}

export interface DevSquadSandcastleExecutionRequest {
  readonly repo: DevSquadRepoContext;
  readonly branch: DevSquadBranchContext;
  readonly workItem: DevSquadWorkItemContext;
  readonly specContent: string;
  readonly planContent: string;
  readonly relatedSummaries?: readonly string[];
  readonly agentRole: DevSquadSandcastleAgentRole;
  readonly validationCommands: readonly DevSquadValidationCommand[];
  readonly bounds?: DevSquadExecutionBounds;
  readonly sandcastle?: DevSquadSandcastleRunConfig;
  readonly signal?: AbortSignal;
}

export interface DevSquadSandcastleExecutionSeamInput {
  readonly request: DevSquadSandcastleExecutionRequest;
  readonly prompt: string;
}

export interface DevSquadCommitMetadata {
  readonly sha: string;
  readonly summary?: string;
}

export interface DevSquadSandcastleExecutionSeamResult {
  readonly branch: string;
  readonly commits?: readonly DevSquadCommitMetadata[];
  readonly stdout?: string;
  readonly logFilePath?: string;
  readonly preservedWorktreePath?: string;
  readonly sessionId?: string;
  readonly iterationCount?: number;
  readonly durationMs?: number;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export type DevSquadSandcastleExecutionSeam = (
  input: DevSquadSandcastleExecutionSeamInput,
) => Promise<DevSquadSandcastleExecutionSeamResult>;

export interface DevSquadValidationCommandRunnerInput {
  readonly command: DevSquadValidationCommand;
  readonly request: DevSquadSandcastleExecutionRequest;
  readonly execution: DevSquadSandcastleExecutionSeamResult;
}

export interface DevSquadValidationCommandRunnerResult {
  readonly status?: Exclude<DevSquadValidationCommandStatus, "skipped">;
  readonly exitCode: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly durationMs?: number;
  readonly diagnostics?: readonly string[];
}

export type DevSquadValidationCommandRunner = (
  input: DevSquadValidationCommandRunnerInput,
) => Promise<DevSquadValidationCommandRunnerResult>;

export interface DevSquadValidationCommandSummary {
  readonly label: string;
  readonly command: string;
  readonly status: DevSquadValidationCommandStatus;
  readonly exitCode?: number;
  readonly stdoutExcerpt?: string;
  readonly stderrExcerpt?: string;
  readonly durationMs?: number;
  readonly diagnostics: readonly string[];
}

export interface DevSquadValidationSummary {
  readonly status: DevSquadValidationOverallStatus;
  readonly commands: readonly DevSquadValidationCommandSummary[];
}

export interface DevSquadSandcastleLogSessionMetadata {
  readonly logFilePath?: string;
  readonly stdoutExcerpt?: string;
  readonly sessionId?: string;
  readonly preservedWorktreePath?: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface DevSquadSandcastleFailureDetails {
  readonly category: DevSquadSandcastleFailureCategory;
  readonly message: string;
  readonly safeCauseDetails?: string;
  readonly failedValidationCommand?: string;
  readonly recoveryHint: string;
}

export type DevSquadSandcastleValidationErrorCode =
  | "missing-host-repo-path"
  | "missing-worktree-path"
  | "missing-source-branch"
  | "missing-target-branch"
  | "missing-work-item-id"
  | "missing-work-item-title"
  | "missing-spec-content"
  | "missing-plan-content"
  | "invalid-agent-role"
  | "missing-validation-command"
  | "missing-validation-command-label"
  | "missing-validation-command-text"
  | "invalid-max-iterations"
  | "invalid-idle-timeout"
  | "invalid-completion-timeout"
  | "invalid-timeout"
  | "missing-execution-seam";

export interface DevSquadSandcastleValidationError {
  readonly code: DevSquadSandcastleValidationErrorCode;
  readonly path: string;
  readonly message: string;
}

export type DevSquadSandcastleRequestValidationResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly errors: readonly DevSquadSandcastleValidationError[];
    };

export interface RunDevSquadSandcastleExecutionOptions {
  readonly execute?: DevSquadSandcastleExecutionSeam;
  readonly runValidationCommand?: DevSquadValidationCommandRunner;
}

export interface DevSquadSandcastleExecutionResult {
  readonly status: DevSquadSandcastleExecutionStatus;
  readonly branch: string;
  readonly commits: readonly DevSquadCommitMetadata[];
  readonly validation: DevSquadValidationSummary;
  readonly logs: DevSquadSandcastleLogSessionMetadata;
  readonly iterationCount?: number;
  readonly durationMs?: number;
  readonly failure?: DevSquadSandcastleFailureDetails;
}

const isBlank = (value: string | undefined): boolean =>
  value === undefined || value.trim().length === 0;

const isPositiveInteger = (value: number): boolean =>
  Number.isInteger(value) && value > 0;

const pushMissing = (
  errors: DevSquadSandcastleValidationError[],
  code: DevSquadSandcastleValidationErrorCode,
  path: string,
  label: string,
): void => {
  errors.push({ code, path, message: `${label} is required` });
};

export const validateDevSquadSandcastleExecutionRequest = (
  request: DevSquadSandcastleExecutionRequest,
  options: RunDevSquadSandcastleExecutionOptions = {},
): DevSquadSandcastleRequestValidationResult => {
  const errors: DevSquadSandcastleValidationError[] = [];

  if (isBlank(request.repo.hostRepoPath)) {
    pushMissing(
      errors,
      "missing-host-repo-path",
      "repo.hostRepoPath",
      "Host repo path",
    );
  }
  if (isBlank(request.repo.worktreePath)) {
    pushMissing(
      errors,
      "missing-worktree-path",
      "repo.worktreePath",
      "Worktree path",
    );
  }
  if (isBlank(request.branch.sourceBranch)) {
    pushMissing(
      errors,
      "missing-source-branch",
      "branch.sourceBranch",
      "Source branch",
    );
  }
  if (isBlank(request.branch.targetBranch)) {
    pushMissing(
      errors,
      "missing-target-branch",
      "branch.targetBranch",
      "Target branch",
    );
  }
  if (String(request.workItem.id).trim().length === 0) {
    pushMissing(errors, "missing-work-item-id", "workItem.id", "Work item id");
  }
  if (isBlank(request.workItem.title)) {
    pushMissing(
      errors,
      "missing-work-item-title",
      "workItem.title",
      "Work item title",
    );
  }
  if (isBlank(request.specContent)) {
    pushMissing(errors, "missing-spec-content", "specContent", "Spec content");
  }
  if (isBlank(request.planContent)) {
    pushMissing(errors, "missing-plan-content", "planContent", "Plan content");
  }
  if (request.agentRole !== "implementer") {
    errors.push({
      code: "invalid-agent-role",
      path: "agentRole",
      message:
        "DevSquad Sandcastle execution adapter only runs implementer tasks",
    });
  }
  if (request.validationCommands.length === 0) {
    pushMissing(
      errors,
      "missing-validation-command",
      "validationCommands",
      "At least one validation command",
    );
  }
  request.validationCommands.forEach((command, index) => {
    if (isBlank(command.label)) {
      pushMissing(
        errors,
        "missing-validation-command-label",
        `validationCommands.${index}.label`,
        "Validation command label",
      );
    }
    if (isBlank(command.command)) {
      pushMissing(
        errors,
        "missing-validation-command-text",
        `validationCommands.${index}.command`,
        "Validation command text",
      );
    }
  });

  if (
    request.bounds?.maxIterations !== undefined &&
    !isPositiveInteger(request.bounds.maxIterations)
  ) {
    errors.push({
      code: "invalid-max-iterations",
      path: "bounds.maxIterations",
      message: "Execution bound maxIterations must be a positive integer",
    });
  }
  if (
    request.bounds?.idleTimeoutSeconds !== undefined &&
    !isPositiveInteger(request.bounds.idleTimeoutSeconds)
  ) {
    errors.push({
      code: "invalid-idle-timeout",
      path: "bounds.idleTimeoutSeconds",
      message: "Execution bound idleTimeoutSeconds must be a positive integer",
    });
  }
  if (
    request.bounds?.completionTimeoutSeconds !== undefined &&
    !isPositiveInteger(request.bounds.completionTimeoutSeconds)
  ) {
    errors.push({
      code: "invalid-completion-timeout",
      path: "bounds.completionTimeoutSeconds",
      message:
        "Execution bound completionTimeoutSeconds must be a positive integer",
    });
  }
  if (
    request.bounds?.timeoutMs !== undefined &&
    !isPositiveInteger(request.bounds.timeoutMs)
  ) {
    errors.push({
      code: "invalid-timeout",
      path: "bounds.timeoutMs",
      message: "Execution bound timeoutMs must be a positive integer",
    });
  }

  if (options.execute === undefined && request.sandcastle === undefined) {
    errors.push({
      code: "missing-execution-seam",
      path: "sandcastle",
      message:
        "Provide an injected execution seam or Sandcastle agent/sandbox config",
    });
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
};

const excerpt = (
  value: string | undefined,
  limit = 4000,
): string | undefined => {
  if (value === undefined || value.length === 0) return undefined;
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
};

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
};

const stringifySafeCause = (error: unknown): string | undefined => {
  if (error instanceof Error) return error.stack ?? error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return undefined;
  }
};

const inputInvalidResult = (
  request: DevSquadSandcastleExecutionRequest,
  validation: Extract<DevSquadSandcastleRequestValidationResult, { ok: false }>,
): DevSquadSandcastleExecutionResult => ({
  status: "input-invalid",
  branch: request.branch.sourceBranch,
  commits: [],
  validation: {
    status: "skipped",
    commands: request.validationCommands.map((command) => ({
      label: command.label,
      command: command.command,
      status: "skipped" as const,
      diagnostics: ["Skipped because adapter input validation failed"],
    })),
  },
  logs: {},
  failure: {
    category: "input-validation",
    message: validation.errors.map((error) => error.message).join("; "),
    safeCauseDetails: validation.errors
      .map((error) => `${error.path}: ${error.message}`)
      .join("\n"),
    recoveryHint:
      "Supply the missing or invalid request fields before starting Sandcastle execution.",
  },
});

export const buildDevSquadSandcastleImplementationPrompt = (
  request: DevSquadSandcastleExecutionRequest,
): string => {
  const metadata = request.workItem.metadata
    ? Object.entries(request.workItem.metadata)
        .map(([key, value]) => `- ${key}: ${String(value)}`)
        .join("\n")
    : "(none)";
  const relatedSummaries =
    request.relatedSummaries && request.relatedSummaries.length > 0
      ? request.relatedSummaries.map((summary) => `- ${summary}`).join("\n")
      : "(none)";
  const validation = request.validationCommands
    .map(
      (command) =>
        `- ${command.label}: ${command.command}${
          command.description ? ` (${command.description})` : ""
        }`,
    )
    .join("\n");

  return `You are the DevSquad implementer for one Sandcastle implementation task.

Boundaries:
- Run exactly one implementation task for the supplied work item context.
- Do not discover, claim, watch, or transition DevSquad or ADO work items.
- Do not own DevSquad phase state, multi-agent scheduling, PR finalization, or merge decisions.
- Preserve host-provided branch and validation context.

Repository context:
- Host repo path: ${request.repo.hostRepoPath}
- Worktree path: ${request.repo.worktreePath}
- Working directory: ${request.repo.workingDirectory ?? request.repo.worktreePath}

Branch context:
- Source branch: ${request.branch.sourceBranch}
- Target branch: ${request.branch.targetBranch}

Work item:
- ID: ${String(request.workItem.id)}
- Title: ${request.workItem.title}
- URL: ${request.workItem.url ?? "(none)"}
- Description:
${request.workItem.description ?? "(none)"}
- Metadata:
${metadata}

Related summaries:
${relatedSummaries}

Spec content:
${request.specContent}

Plan content:
${request.planContent}

Validation commands expected after implementation:
${validation}

When finished, leave commits on ${request.branch.sourceBranch} and report implementation, validation, logs, session metadata, and failure details through Sandcastle output. <promise>COMPLETE</promise>`;
};

const mapRunResult = (
  result: RunResult,
): DevSquadSandcastleExecutionSeamResult => ({
  branch: result.branch,
  commits: result.commits.map((commit) => ({ sha: commit.sha })),
  stdout: result.stdout,
  logFilePath: result.logFilePath,
  preservedWorktreePath: result.preservedWorktreePath,
  iterationCount: result.iterations.length,
});

export const defaultDevSquadSandcastleExecutionSeam: DevSquadSandcastleExecutionSeam =
  async ({ request, prompt }) => {
    if (request.sandcastle === undefined) {
      throw new Error("Missing Sandcastle agent/sandbox config");
    }

    const branchStrategy: BranchStrategy = request.sandcastle
      .branchStrategy ?? {
      type: "branch",
      branch: request.branch.sourceBranch,
      baseBranch: request.branch.targetBranch,
    };
    const completionSignal: string | string[] | undefined =
      request.sandcastle.completionSignal === undefined
        ? undefined
        : typeof request.sandcastle.completionSignal === "string"
          ? request.sandcastle.completionSignal
          : [...request.sandcastle.completionSignal];

    const result = await run({
      agent: request.sandcastle.agent,
      sandbox: request.sandcastle.sandbox,
      cwd: request.repo.hostRepoPath,
      prompt,
      maxIterations: request.bounds?.maxIterations,
      idleTimeoutSeconds: request.bounds?.idleTimeoutSeconds,
      completionTimeoutSeconds: request.bounds?.completionTimeoutSeconds,
      completionSignal,
      name:
        request.sandcastle.name ?? `devsquad-${String(request.workItem.id)}`,
      logging: request.sandcastle.logging,
      copyToWorktree: request.sandcastle.copyToWorktree
        ? [...request.sandcastle.copyToWorktree]
        : undefined,
      branchStrategy,
      timeouts: request.sandcastle.timeouts,
      signal: request.signal,
    });

    return mapRunResult(result);
  };

export const defaultDevSquadValidationCommandRunner: DevSquadValidationCommandRunner =
  async ({ command, request }) => {
    const started = Date.now();
    try {
      const result = await execAsync(command.command, {
        cwd:
          command.cwd ??
          request.repo.workingDirectory ??
          request.repo.worktreePath,
        timeout: request.bounds?.timeoutMs,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      });
      return {
        status: "passed",
        exitCode: 0,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: Date.now() - started,
        diagnostics: [],
      };
    } catch (error) {
      const failed = error as Error & {
        readonly code?: number;
        readonly stdout?: string;
        readonly stderr?: string;
      };
      return {
        status: "failed",
        exitCode: typeof failed.code === "number" ? failed.code : 1,
        stdout: failed.stdout,
        stderr: failed.stderr,
        durationMs: Date.now() - started,
        diagnostics: [errorMessage(error)],
      };
    }
  };

const skippedValidation = (
  request: DevSquadSandcastleExecutionRequest,
  reason: string,
): DevSquadValidationSummary => ({
  status: "skipped",
  commands: request.validationCommands.map((command) => ({
    label: command.label,
    command: command.command,
    status: "skipped",
    diagnostics: [reason],
  })),
});

const runValidationCommands = async (
  request: DevSquadSandcastleExecutionRequest,
  execution: DevSquadSandcastleExecutionSeamResult,
  runner: DevSquadValidationCommandRunner,
): Promise<DevSquadValidationSummary> => {
  const commands: DevSquadValidationCommandSummary[] = [];

  for (const command of request.validationCommands) {
    try {
      const result = await runner({ command, request, execution });
      const status =
        result.status ?? (result.exitCode === 0 ? "passed" : "failed");
      commands.push({
        label: command.label,
        command: command.command,
        status,
        exitCode: result.exitCode,
        stdoutExcerpt: excerpt(result.stdout),
        stderrExcerpt: excerpt(result.stderr),
        durationMs: result.durationMs,
        diagnostics: result.diagnostics ?? [],
      });
    } catch (error) {
      commands.push({
        label: command.label,
        command: command.command,
        status: "failed",
        exitCode: 1,
        diagnostics: [errorMessage(error)],
        stderrExcerpt: excerpt(stringifySafeCause(error)),
      });
    }
  }

  return {
    status: commands.some((command) => command.status === "failed")
      ? "failed"
      : "passed",
    commands,
  };
};

export const runDevSquadSandcastleExecution = async (
  request: DevSquadSandcastleExecutionRequest,
  options: RunDevSquadSandcastleExecutionOptions = {},
): Promise<DevSquadSandcastleExecutionResult> => {
  const validation = validateDevSquadSandcastleExecutionRequest(
    request,
    options,
  );
  if (!validation.ok) {
    return inputInvalidResult(request, validation);
  }

  const prompt = buildDevSquadSandcastleImplementationPrompt(request);
  const execute = options.execute ?? defaultDevSquadSandcastleExecutionSeam;
  const runValidationCommand =
    options.runValidationCommand ?? defaultDevSquadValidationCommandRunner;

  let execution: DevSquadSandcastleExecutionSeamResult;
  try {
    execution = await execute({ request, prompt });
  } catch (error) {
    return {
      status: "execution-failed",
      branch: request.branch.sourceBranch,
      commits: [],
      validation: skippedValidation(
        request,
        "Skipped because Sandcastle execution failed",
      ),
      logs: {},
      failure: {
        category: "execution",
        message: errorMessage(error),
        safeCauseDetails: excerpt(stringifySafeCause(error)),
        recoveryHint:
          "Inspect the Sandcastle execution logs/session metadata and retry the same work item after fixing execution setup.",
      },
    };
  }

  const validationSummary = await runValidationCommands(
    request,
    execution,
    runValidationCommand,
  );
  const failureCommand = validationSummary.commands.find(
    (command) => command.status === "failed",
  );

  return {
    status:
      validationSummary.status === "failed" ? "validation-failed" : "completed",
    branch: execution.branch,
    commits: execution.commits ?? [],
    validation: validationSummary,
    logs: {
      logFilePath: execution.logFilePath,
      stdoutExcerpt: excerpt(execution.stdout),
      sessionId: execution.sessionId,
      preservedWorktreePath: execution.preservedWorktreePath,
      metadata: execution.metadata,
    },
    iterationCount: execution.iterationCount,
    durationMs: execution.durationMs,
    failure:
      failureCommand === undefined
        ? undefined
        : {
            category: "validation",
            message: `Validation command '${failureCommand.label}' failed`,
            safeCauseDetails:
              failureCommand.stderrExcerpt ?? failureCommand.stdoutExcerpt,
            failedValidationCommand: failureCommand.command,
            recoveryHint:
              "Fix the implementation or validation environment and rerun host-approved validation commands.",
          },
  };
};
