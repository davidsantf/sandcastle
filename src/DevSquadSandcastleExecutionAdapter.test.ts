import { describe, expect, it, vi } from "vitest";
import { run } from "./run.js";
import {
  buildDevSquadSandcastleImplementationPrompt,
  defaultDevSquadSandcastleExecutionSeam,
  runDevSquadSandcastleExecution,
  validateDevSquadSandcastleExecutionRequest,
  type DevSquadSandcastleExecutionRequest,
} from "./DevSquadSandcastleExecutionAdapter.js";

vi.mock("./run.js", () => ({
  run: vi.fn(),
}));

const request = (
  overrides: Partial<DevSquadSandcastleExecutionRequest> = {},
): DevSquadSandcastleExecutionRequest => ({
  repo: {
    hostRepoPath: "/repo",
    worktreePath: "/repo/.sandcastle/worktrees/implementer-12",
    workingDirectory: "/repo/.sandcastle/worktrees/implementer-12/package",
  },
  branch: {
    sourceBranch: "davidsant/devsquad-sandcastle-execution-adapter",
    targetBranch: "origin/main",
  },
  workItem: {
    id: 12,
    title: "DevSquad Sandcastle execution adapter",
    description: "Run one implementation task through Sandcastle.",
    url: "https://github.com/davidsantf/sandcastle/issues/12",
    metadata: { priority: 1, source: "github" },
  },
  specContent: "RF-001 typed host-side API",
  planContent: "Add adapter and fake seams",
  relatedSummaries: ["ADR-0024 keeps DevSquad state outside the adapter"],
  agentRole: "implementer",
  validationCommands: [
    { label: "typecheck", command: "npm run typecheck" },
    { label: "targeted tests", command: "npm test -- adapter" },
  ],
  sandcastle: undefined,
  ...overrides,
});

describe("validateDevSquadSandcastleExecutionRequest", () => {
  it("aggregates invalid input diagnostics before execution", () => {
    const result = validateDevSquadSandcastleExecutionRequest(
      request({
        repo: { hostRepoPath: "", worktreePath: "", workingDirectory: "" },
        branch: { sourceBranch: "", targetBranch: "" },
        workItem: { id: " ", title: "" },
        specContent: "",
        planContent: "",
        agentRole: "reviewer",
        validationCommands: [{ label: "", command: "" }],
        bounds: {
          maxIterations: 0,
          idleTimeoutSeconds: -1,
          completionTimeoutSeconds: 1.5,
          timeoutMs: 0,
        },
      }),
    );

    expect(result).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        expect.objectContaining({ code: "missing-host-repo-path" }),
        expect.objectContaining({ code: "missing-worktree-path" }),
        expect.objectContaining({ code: "missing-working-directory" }),
        expect.objectContaining({ code: "missing-source-branch" }),
        expect.objectContaining({ code: "missing-target-branch" }),
        expect.objectContaining({ code: "missing-work-item-id" }),
        expect.objectContaining({ code: "missing-work-item-title" }),
        expect.objectContaining({ code: "missing-spec-content" }),
        expect.objectContaining({ code: "missing-plan-content" }),
        expect.objectContaining({ code: "invalid-agent-role" }),
        expect.objectContaining({ code: "missing-validation-command-label" }),
        expect.objectContaining({ code: "missing-validation-command-text" }),
        expect.objectContaining({ code: "invalid-max-iterations" }),
        expect.objectContaining({ code: "invalid-idle-timeout" }),
        expect.objectContaining({ code: "invalid-completion-timeout" }),
        expect.objectContaining({ code: "invalid-timeout" }),
        expect.objectContaining({ code: "missing-execution-seam" }),
        expect.objectContaining({ code: "missing-validation-runner" }),
      ]),
    });
  });

  it("accepts injected execution and validation seams without live Sandcastle config", () => {
    const result = validateDevSquadSandcastleExecutionRequest(request(), {
      execute: async () => ({ branch: "feature" }),
      runValidationCommand: async () => ({ exitCode: 0 }),
    });

    expect(result).toEqual({ ok: true });
  });

  it("accepts workingDirectory equal to worktreePath after POSIX path resolution", () => {
    const result = validateDevSquadSandcastleExecutionRequest(
      request({
        repo: {
          hostRepoPath: "/repo",
          worktreePath: "/repo/.sandcastle/worktrees/implementer-12",
          workingDirectory:
            "/repo/.sandcastle/worktrees/implementer-12/package/..",
        },
      }),
      {
        execute: async () => ({ branch: "feature" }),
        runValidationCommand: async () => ({ exitCode: 0 }),
      },
    );

    expect(result).toEqual({ ok: true });
  });

  it("accepts workingDirectory child of worktreePath for Windows-style paths", () => {
    const result = validateDevSquadSandcastleExecutionRequest(
      request({
        repo: {
          hostRepoPath: "C:\\repo",
          worktreePath: "C:\\repo\\.sandcastle\\worktrees\\implementer-12",
          workingDirectory:
            "C:\\repo\\.sandcastle\\worktrees\\implementer-12\\package",
        },
      }),
      {
        execute: async () => ({ branch: "feature" }),
        runValidationCommand: async () => ({ exitCode: 0 }),
      },
    );

    expect(result).toEqual({ ok: true });
  });

  it("rejects workingDirectory outside worktreePath", () => {
    const result = validateDevSquadSandcastleExecutionRequest(
      request({
        repo: {
          hostRepoPath: "/repo",
          worktreePath: "/repo/.sandcastle/worktrees/implementer-12",
          workingDirectory:
            "/repo/.sandcastle/worktrees/implementer-12-sibling",
        },
      }),
      {
        execute: async () => ({ branch: "feature" }),
        runValidationCommand: async () => ({ exitCode: 0 }),
      },
    );

    expect(result).toEqual({
      ok: false,
      errors: [
        expect.objectContaining({ code: "invalid-working-directory-boundary" }),
      ],
    });
  });

  it("rejects validation command cwd outside the worktree context", () => {
    const result = validateDevSquadSandcastleExecutionRequest(
      request({
        validationCommands: [
          { label: "escape", command: "npm test", cwd: "/tmp/outside" },
        ],
      }),
      {
        execute: async () => ({ branch: "feature" }),
        runValidationCommand: async () => ({ exitCode: 0 }),
      },
    );

    expect(result).toEqual({
      ok: false,
      errors: [
        expect.objectContaining({ code: "invalid-validation-command-cwd" }),
      ],
    });
  });
});

describe("buildDevSquadSandcastleImplementationPrompt", () => {
  it("builds single-task implementer context without phase ownership", () => {
    const prompt = buildDevSquadSandcastleImplementationPrompt(request());

    expect(prompt).toContain("one Sandcastle implementation task");
    expect(prompt).toContain("Do not discover, claim, watch, or transition");
    expect(prompt).toContain(
      "Source branch: davidsant/devsquad-sandcastle-execution-adapter",
    );
    expect(prompt).toContain("RF-001 typed host-side API");
    expect(prompt).toContain("npm run typecheck");
  });
});

describe("runDevSquadSandcastleExecution", () => {
  it("returns completed status with fake execution, validation, commits, and metadata", async () => {
    const execute = vi.fn(async ({ prompt }) => ({
      branch: "davidsant/devsquad-sandcastle-execution-adapter",
      commits: [{ sha: "abc123", summary: "feat: add adapter" }],
      stdout: prompt,
      logFilePath: "/repo/.sandcastle/logs/adapter.log",
      sessionId: "session-12",
      iterationCount: 1,
      durationMs: 1234,
      metadata: { provider: "fake" },
    }));
    const runValidationCommand = vi.fn(async () => ({
      status: "passed" as const,
      exitCode: 0,
      stdout: "ok",
      durationMs: 10,
      diagnostics: [],
    }));

    const result = await runDevSquadSandcastleExecution(request(), {
      execute,
      runValidationCommand,
    });

    expect(result).toMatchObject({
      status: "completed",
      branch: "davidsant/devsquad-sandcastle-execution-adapter",
      commits: [{ sha: "abc123", summary: "feat: add adapter" }],
      validation: { status: "passed" },
      logs: {
        logFilePath: "/repo/.sandcastle/logs/adapter.log",
        sessionId: "session-12",
        metadata: { provider: "fake" },
      },
      iterationCount: 1,
      durationMs: 1234,
    });
    expect(result.logs.stdoutExcerpt).toContain("RF-001 typed host-side API");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(runValidationCommand).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid input before calling execution or validation seams", async () => {
    const execute = vi.fn(async () => ({ branch: "never" }));
    const runValidationCommand = vi.fn(async () => ({ exitCode: 0 }));

    const result = await runDevSquadSandcastleExecution(
      request({ workItem: { id: "", title: "" } }),
      { execute, runValidationCommand },
    );

    expect(result.status).toBe("input-invalid");
    expect(result.failure).toMatchObject({ category: "input-validation" });
    expect(result.validation.status).toBe("skipped");
    expect(execute).not.toHaveBeenCalled();
    expect(runValidationCommand).not.toHaveBeenCalled();
  });

  it("rejects workingDirectory boundary violations before calling execution or validation seams", async () => {
    const execute = vi.fn(async () => ({ branch: "never" }));
    const runValidationCommand = vi.fn(async () => ({ exitCode: 0 }));

    const result = await runDevSquadSandcastleExecution(
      request({
        repo: {
          hostRepoPath: "/repo",
          worktreePath: "/repo/.sandcastle/worktrees/implementer-12",
          workingDirectory: "/tmp/external-workdir",
        },
        validationCommands: [
          {
            label: "external",
            command: "npm test",
            cwd: "/tmp/external-workdir",
          },
        ],
      }),
      { execute, runValidationCommand },
    );

    expect(result.status).toBe("input-invalid");
    expect(result.failure).toMatchObject({ category: "input-validation" });
    expect(result.failure?.safeCauseDetails).toContain(
      "Working directory must stay inside or equal to repo.worktreePath",
    );
    expect(result.validation.status).toBe("skipped");
    expect(execute).not.toHaveBeenCalled();
    expect(runValidationCommand).not.toHaveBeenCalled();
  });

  it("rejects missing injected validation runner before execution", async () => {
    const execute = vi.fn(async () => ({ branch: "never" }));

    const result = await runDevSquadSandcastleExecution(request(), { execute });

    expect(result.status).toBe("input-invalid");
    expect(result.failure).toMatchObject({ category: "input-validation" });
    expect(result.failure?.safeCauseDetails).toContain("runValidationCommand");
    expect(execute).not.toHaveBeenCalled();
  });

  it("passes the supplied worktree as the default Sandcastle cwd without creating a named checkout", async () => {
    vi.mocked(run).mockResolvedValueOnce({
      branch: "davidsant/devsquad-sandcastle-execution-adapter",
      commits: [],
      stdout: "done",
      iterations: [],
    } as never);

    await defaultDevSquadSandcastleExecutionSeam({
      request: request({
        sandcastle: {
          agent: {} as never,
          sandbox: { tag: "bind-mount" } as never,
        },
      }),
      prompt: "prompt",
    });

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/repo/.sandcastle/worktrees/implementer-12",
        branchStrategy: undefined,
      }),
    );
  });

  it("returns execution-failed and skips validation when execution seam throws", async () => {
    const execute = vi.fn(async () => {
      throw new Error("agent failed");
    });
    const runValidationCommand = vi.fn(async () => ({ exitCode: 0 }));

    const result = await runDevSquadSandcastleExecution(request(), {
      execute,
      runValidationCommand,
    });

    expect(result.status).toBe("execution-failed");
    expect(result.failure).toMatchObject({
      category: "execution",
      message: "agent failed",
    });
    expect(result.validation.commands).toEqual([
      expect.objectContaining({ label: "typecheck", status: "skipped" }),
      expect.objectContaining({ label: "targeted tests", status: "skipped" }),
    ]);
    expect(runValidationCommand).not.toHaveBeenCalled();
  });

  it("returns validation-failed with per-command diagnostics", async () => {
    const execute = vi.fn(async () => ({
      branch: "davidsant/devsquad-sandcastle-execution-adapter",
      commits: [{ sha: "def456" }],
    }));
    const runValidationCommand = vi
      .fn()
      .mockResolvedValueOnce({ status: "passed", exitCode: 0 })
      .mockResolvedValueOnce({
        status: "failed",
        exitCode: 1,
        stdout: "test stdout",
        stderr: "expected true to be false",
        durationMs: 20,
        diagnostics: ["vitest failed"],
      });

    const result = await runDevSquadSandcastleExecution(request(), {
      execute,
      runValidationCommand,
    });

    expect(result.status).toBe("validation-failed");
    expect(result.commits).toEqual([{ sha: "def456" }]);
    expect(result.failure).toMatchObject({
      category: "validation",
      failedValidationCommand: "npm test -- adapter",
    });
    expect(result.validation.commands[1]).toMatchObject({
      label: "targeted tests",
      status: "failed",
      stderrExcerpt: "expected true to be false",
      diagnostics: ["vitest failed"],
    });
  });

  it("marks thrown validation runner errors as validation failures", async () => {
    const result = await runDevSquadSandcastleExecution(request(), {
      execute: async () => ({ branch: "feature" }),
      runValidationCommand: async () => {
        throw new Error("validator crashed");
      },
    });

    expect(result.status).toBe("validation-failed");
    expect(result.validation.commands[0]).toMatchObject({
      status: "failed",
      diagnostics: ["validator crashed"],
    });
  });
});
