import { describe, expect, it, vi } from "vitest";
import { runAdoTeam, validateAdoTeamRunnerOptions } from "./AdoTeamRunner.js";
import { FakeAdoControlPlane } from "./AdoTeam.js";
import type { AdoControlPlane, AdoTeamAgentAssignment } from "./AdoTeam.js";

const assignment = (
  agentId: string,
  workItemId: number,
): AdoTeamAgentAssignment => ({
  agentId,
  role: "implementer",
  workItemId,
  branch: `sandcastle/ado-${workItemId}-${agentId}`,
  worktreePath: `/repo/.sandcastle/worktrees/${agentId}`,
});

const controlPlaneFor = (
  assignments: readonly AdoTeamAgentAssignment[],
): FakeAdoControlPlane =>
  new FakeAdoControlPlane(
    assignments.map((item) => ({
      id: item.workItemId!,
      title: `Work item ${item.workItemId}`,
      state: "Active",
    })),
  );

const waitUntil = async (predicate: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error("Timed out waiting for test condition");
};

describe("validateAdoTeamRunnerOptions", () => {
  it.each([0, -1])(
    "rejects non-positive maxParallelism %s before local execution",
    (maxParallelism) => {
      const result = validateAdoTeamRunnerOptions({
        assignments: [assignment("implementer-a", 5)],
        maxParallelism,
      });

      expect(result).toEqual({
        ok: false,
        errors: [
          {
            code: "invalid-max-parallelism",
            value: String(maxParallelism),
            assignmentIds: [],
            message:
              "ADO team runner option 'maxParallelism' must be a positive integer",
          },
        ],
      });
    },
  );

  it("rejects missing branch and worktree assignments", () => {
    const result = validateAdoTeamRunnerOptions({
      assignments: [
        { agentId: "implementer-a", role: "implementer", workItemId: 5 },
      ],
      maxParallelism: 1,
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        {
          code: "missing-branch",
          value: "implementer-a",
          assignmentIds: ["implementer-a"],
          message:
            "ADO implementer 'implementer-a' requires a branch assignment",
        },
        {
          code: "missing-worktree",
          value: "implementer-a",
          assignmentIds: ["implementer-a"],
          message:
            "ADO implementer 'implementer-a' requires a worktree assignment",
        },
      ],
    });
  });
});

describe("runAdoTeam", () => {
  it("rejects missing primary work item assignments before local execution", async () => {
    const assignments: readonly AdoTeamAgentAssignment[] = [
      {
        agentId: "implementer-a",
        role: "implementer",
        branch: "sandcastle/a",
        worktreePath: "/repo/.sandcastle/worktrees/implementer-a",
      },
    ];
    const executeLocal = vi.fn(async () => ({ status: "completed" as const }));

    const result = await runAdoTeam({
      assignments,
      maxParallelism: 1,
      controlPlane: controlPlaneFor(assignments),
      executeLocal,
    });

    expect(result.status).toBe("rejected");
    expect(result.counts).toEqual({
      completed: 0,
      failed: 0,
      pending: 0,
      skipped: 1,
    });
    expect(result.validation).toEqual({
      ok: false,
      errors: [
        {
          code: "missing-work-item",
          value: "implementer-a",
          assignmentIds: ["implementer-a"],
          message:
            "ADO implementer 'implementer-a' requires a primary work item assignment",
        },
      ],
    });
    expect(executeLocal).not.toHaveBeenCalled();
  });
  it("rejects duplicate primary work items before starting local execution", async () => {
    const assignments = [
      { ...assignment("implementer-a", 5), branch: "sandcastle/a" },
      { ...assignment("implementer-b", 5), branch: "sandcastle/b" },
    ];
    const executeLocal = vi.fn(async () => ({ status: "completed" as const }));

    const result = await runAdoTeam({
      assignments,
      maxParallelism: 2,
      controlPlane: controlPlaneFor(assignments),
      executeLocal,
    });

    expect(result.status).toBe("rejected");
    expect(result.counts).toEqual({
      completed: 0,
      failed: 0,
      pending: 0,
      skipped: 2,
    });
    expect(result.validation).toEqual({
      ok: false,
      errors: [
        {
          code: "duplicate-work-item",
          value: "5",
          assignmentIds: ["implementer-a", "implementer-b"],
          message: "Parallel ADO implementers cannot share work item '5'",
        },
      ],
    });
    expect(executeLocal).not.toHaveBeenCalled();
  });

  it("allows duplicate primary work items only when explicitly enabled and isolation remains distinct", async () => {
    const assignments = [
      { ...assignment("implementer-a", 5), branch: "sandcastle/a" },
      { ...assignment("implementer-b", 5), branch: "sandcastle/b" },
    ];
    const executeLocal = vi.fn(async ({ assignment: item }) => ({
      status: "completed" as const,
      summary: `completed ${item.agentId}`,
    }));

    const result = await runAdoTeam({
      assignments,
      allowDuplicateWorkItems: true,
      maxParallelism: 2,
      controlPlane: controlPlaneFor(assignments),
      executeLocal,
    });

    expect(result.status).toBe("completed");
    expect(result.counts).toEqual({
      completed: 2,
      failed: 0,
      pending: 0,
      skipped: 0,
    });
    expect(executeLocal).toHaveBeenCalledTimes(2);
  });

  it("rejects duplicate branch or worktree assignments before starting local execution", async () => {
    const assignments = [
      {
        agentId: "implementer-a",
        role: "implementer" as const,
        workItemId: 5,
        branch: "sandcastle/shared",
        worktreePath: "C:\\repo\\worktrees\\shared\\",
      },
      {
        agentId: "implementer-b",
        role: "implementer" as const,
        workItemId: 6,
        branch: "sandcastle/shared",
        worktreePath: "c:/repo/worktrees/shared",
      },
    ];
    const executeLocal = vi.fn(async () => ({ status: "completed" as const }));

    const result = await runAdoTeam({
      assignments,
      maxParallelism: 2,
      controlPlane: controlPlaneFor(assignments),
      executeLocal,
    });

    expect(result.status).toBe("rejected");
    expect(result.validation).toEqual({
      ok: false,
      errors: [
        {
          code: "shared-branch",
          value: "sandcastle/shared",
          assignmentIds: ["implementer-a", "implementer-b"],
          message:
            "Parallel ADO implementers cannot share branch 'sandcastle/shared'",
        },
        {
          code: "shared-worktree",
          value: "c:/repo/worktrees/shared",
          assignmentIds: ["implementer-a", "implementer-b"],
          message:
            "Parallel ADO implementers cannot share worktree 'c:/repo/worktrees/shared'",
        },
      ],
    });
    expect(executeLocal).not.toHaveBeenCalled();
  });

  it("schedules no more than maxParallelism local executions concurrently", async () => {
    const assignments = [
      assignment("implementer-a", 5),
      assignment("implementer-b", 6),
      assignment("implementer-c", 7),
    ];
    const releases = new Map<string, () => void>();
    const startOrder: string[] = [];
    let activeExecutions = 0;
    let maxActiveExecutions = 0;

    const executeLocal = vi.fn(async ({ assignment: item }) => {
      startOrder.push(item.agentId);
      activeExecutions += 1;
      maxActiveExecutions = Math.max(maxActiveExecutions, activeExecutions);
      await new Promise<void>((resolve) => releases.set(item.agentId, resolve));
      activeExecutions -= 1;
      return { status: "completed" as const, summary: item.agentId };
    });

    const run = runAdoTeam({
      assignments,
      maxParallelism: 2,
      controlPlane: controlPlaneFor(assignments),
      executeLocal,
    });

    await waitUntil(() => startOrder.length === 2);
    expect(startOrder).toEqual(["implementer-a", "implementer-b"]);
    expect(maxActiveExecutions).toBe(2);

    releases.get("implementer-a")?.();
    await waitUntil(() => startOrder.length === 3);
    expect(startOrder).toEqual([
      "implementer-a",
      "implementer-b",
      "implementer-c",
    ]);
    expect(maxActiveExecutions).toBe(2);

    releases.get("implementer-b")?.();
    releases.get("implementer-c")?.();
    await expect(run).resolves.toMatchObject({
      status: "completed",
      counts: { completed: 3, failed: 0, pending: 0, skipped: 0 },
    });
  });

  it("returns deterministic fake local execution results", async () => {
    const assignments = [
      assignment("implementer-a", 5),
      assignment("implementer-b", 6),
    ];

    const result = await runAdoTeam({
      assignments,
      maxParallelism: 2,
      controlPlane: controlPlaneFor(assignments),
      executeLocal: vi.fn(async ({ assignment: item }) => {
        if (item.agentId === "implementer-a") {
          return {
            status: "completed" as const,
            summary: `local ${item.agentId}`,
          };
        }

        return {
          status: "failed" as const,
          summary: `local ${item.agentId}`,
          error: "boom",
        };
      }),
    });

    expect(result.counts).toEqual({
      completed: 1,
      failed: 1,
      pending: 0,
      skipped: 0,
    });
    expect(
      result.assignments.map((item) => item.localExecution?.summary),
    ).toEqual(["local implementer-a", "local implementer-b"]);
  });

  it("composes PR publishing and feedback-loop helpers through injected control-plane metadata", async () => {
    const assignments = [assignment("implementer-a", 5)];
    const controlPlane = controlPlaneFor(assignments);
    controlPlane.setPullRequestCiStatus({
      status: "succeeded",
      summary: "CI passed.",
    });

    const result = await runAdoTeam({
      assignments,
      maxParallelism: 1,
      controlPlane,
      executeLocal: vi.fn(async ({ assignment: item }) => ({
        status: "completed" as const,
        branch: item.branch,
        worktreePath: item.worktreePath,
        summary: "local execution completed",
      })),
      createPullRequestOptions: ({ assignment: item, localExecution }) => ({
        title: `Implement ${item.workItemId}`,
        description: `Local worktree: ${localExecution.worktreePath}`,
        sourceBranch: localExecution.branch!,
        targetBranch: "main",
        workItemIds: [item.workItemId!],
        draft: true,
      }),
      createFeedbackLoopOptions: () => ({ maxObservations: 1 }),
    });

    expect(result.status).toBe("completed");
    expect(result.assignments[0]?.pullRequest?.pullRequest).toMatchObject({
      id: "1",
      sourceBranch: assignments[0]?.branch,
      targetBranch: "main",
      workItemIds: [5],
      draft: true,
    });
    expect(result.assignments[0]?.feedbackLoop).toMatchObject({
      kind: "summary",
      summary:
        "ADO feedback loop observed succeeded CI and no actionable review feedback for PR 1.",
    });
    expect(result.assignments[0]?.localExecution).toMatchObject({
      branch: assignments[0]?.branch,
      worktreePath: assignments[0]?.worktreePath,
    });
  });

  it("passes local execution output to optional PR publisher seams", async () => {
    const assignments = [assignment("implementer-a", 5)];
    const publishPullRequest = vi.fn(async ({ options }) => ({
      pullRequest: {
        id: "pr-1",
        title: options.title,
        sourceBranch: options.sourceBranch,
        targetBranch: options.targetBranch,
        workItemIds: options.workItemIds ?? [],
        draft: options.draft ?? false,
      },
      comments: [],
      updatedWorkItems: [],
    }));

    await runAdoTeam({
      assignments,
      maxParallelism: 1,
      controlPlane: controlPlaneFor(assignments),
      executeLocal: vi.fn(async () => ({
        status: "completed" as const,
        branch: "local/output-branch",
        worktreePath: "/local/output-worktree",
      })),
      createPullRequestOptions: ({ localExecution }) => ({
        title: "Implement 5",
        sourceBranch: localExecution.branch!,
        targetBranch: "main",
      }),
      publishPullRequest,
    });

    expect(publishPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        localExecution: expect.objectContaining({
          branch: "local/output-branch",
          worktreePath: "/local/output-worktree",
        }),
        options: expect.objectContaining({
          sourceBranch: "local/output-branch",
        }),
      }),
    );
  });

  it("preserves successful local execution output when PR composition fails", async () => {
    const assignments = [assignment("implementer-a", 5)];
    const error = new Error("publish failed");

    const result = await runAdoTeam({
      assignments,
      maxParallelism: 1,
      controlPlane: controlPlaneFor(assignments),
      executeLocal: vi.fn(async () => ({
        status: "completed" as const,
        branch: "local/output-branch",
        worktreePath: "/local/output-worktree",
        summary: "local execution completed",
      })),
      createPullRequestOptions: ({ localExecution }) => ({
        title: "Implement 5",
        sourceBranch: localExecution.branch!,
        targetBranch: "main",
      }),
      publishPullRequest: vi.fn(async () => {
        throw error;
      }),
    });

    expect(result.counts).toEqual({
      completed: 0,
      failed: 1,
      pending: 0,
      skipped: 0,
    });
    expect(result.assignments[0]).toMatchObject({
      status: "failed",
      branch: "local/output-branch",
      worktreePath: "/local/output-worktree",
      localExecution: {
        status: "completed",
        branch: "local/output-branch",
        worktreePath: "/local/output-worktree",
        summary: "local execution completed",
      },
      error,
    });
  });
  it("isolates thrown local execution failures per assignment", async () => {
    const assignments = [
      assignment("implementer-a", 5),
      assignment("implementer-b", 6),
    ];

    const result = await runAdoTeam({
      assignments,
      maxParallelism: 2,
      controlPlane: controlPlaneFor(assignments),
      executeLocal: vi.fn(async ({ assignment: item }) => {
        if (item.agentId === "implementer-a") throw new Error("local failed");
        return { status: "completed" as const, summary: "unrelated completed" };
      }),
    });

    expect(result.counts).toEqual({
      completed: 1,
      failed: 1,
      pending: 0,
      skipped: 0,
    });
    expect(result.assignments.map((item) => item.status)).toEqual([
      "failed",
      "completed",
    ]);
    expect(result.assignments[0]?.branch).toBe(assignments[0]?.branch);
    expect(result.assignments[0]?.worktreePath).toBe(
      assignments[0]?.worktreePath,
    );
  });

  it("returns bounded pending and skipped assignment summaries when execution bounds are reached", async () => {
    const assignments = [
      assignment("implementer-a", 5),
      assignment("implementer-b", 6),
      assignment("implementer-c", 7),
    ];

    const pendingResult = await runAdoTeam({
      assignments,
      maxParallelism: 2,
      executionBounds: { maxAssignmentsToStart: 1 },
      controlPlane: controlPlaneFor(assignments),
      executeLocal: vi.fn(async () => ({ status: "completed" as const })),
    });

    expect(pendingResult.status).toBe("bounded");
    expect(pendingResult.counts).toEqual({
      completed: 1,
      failed: 0,
      pending: 2,
      skipped: 0,
    });
    expect(
      pendingResult.assignments.slice(1).map((item) => item.pendingReason),
    ).toEqual([
      "execution bound reached before this implementer assignment was started",
      "execution bound reached before this implementer assignment was started",
    ]);

    const skippedResult = await runAdoTeam({
      assignments,
      maxParallelism: 2,
      executionBounds: {
        maxAssignmentsToStart: 1,
        unstartedAssignmentStatus: "skipped",
      },
      controlPlane: controlPlaneFor(assignments),
      executeLocal: vi.fn(async () => ({ status: "completed" as const })),
    });

    expect(skippedResult.counts).toEqual({
      completed: 1,
      failed: 0,
      pending: 0,
      skipped: 2,
    });
    expect(
      skippedResult.assignments.slice(1).map((item) => item.skippedReason),
    ).toEqual([
      "execution bound reached before this implementer assignment was started",
      "execution bound reached before this implementer assignment was started",
    ]);
  });

  it("does not call control-plane metadata methods when no PR or feedback composition is requested", async () => {
    const assignments = [assignment("implementer-a", 5)];
    const controlPlane: AdoControlPlane = {
      fetchWorkItem: vi.fn(),
      updateWorkItem: vi.fn(),
      addWorkItemComment: vi.fn(),
      createPullRequest: vi.fn(),
      getPullRequestCiStatus: vi.fn(),
      getPullRequestReviewFeedback: vi.fn(),
    };

    const result = await runAdoTeam({
      assignments,
      maxParallelism: 1,
      controlPlane,
      executeLocal: vi.fn(async () => ({ status: "completed" as const })),
    });

    expect(result.counts.completed).toBe(1);
    expect(controlPlane.fetchWorkItem).not.toHaveBeenCalled();
    expect(controlPlane.updateWorkItem).not.toHaveBeenCalled();
    expect(controlPlane.addWorkItemComment).not.toHaveBeenCalled();
    expect(controlPlane.createPullRequest).not.toHaveBeenCalled();
    expect(controlPlane.getPullRequestCiStatus).not.toHaveBeenCalled();
    expect(controlPlane.getPullRequestReviewFeedback).not.toHaveBeenCalled();
  });
});
