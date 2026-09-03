import { describe, expect, it, vi } from "vitest";
import { runAdoFeedbackLoop } from "./AdoFeedbackLoop.js";
import { FakeAdoControlPlane } from "./AdoTeam.js";
import type { AdoReviewFeedback } from "./AdoTeam.js";

const workItem = {
  id: 4,
  title: "Add CI and review feedback loop plumbing",
  state: "Active",
};

const pullRequest = {
  id: "42",
  title: "Add feedback loop",
  url: "https://ado.example/pr/42",
};

describe("runAdoFeedbackLoop", () => {
  it("returns wait actions for fake pending/running CI transitions and summary on success", async () => {
    const controlPlane = new FakeAdoControlPlane([workItem]);
    controlPlane.setPullRequestCiStatusSequence([
      { status: "pending", summary: "Build queued." },
      { status: "running", summary: "Build running." },
      { status: "succeeded", summary: "Build passed." },
    ]);

    const result = await runAdoFeedbackLoop({
      controlPlane,
      workItemId: 4,
      pullRequest,
      maxObservations: 3,
    });

    expect(result.kind).toBe("summary");
    expect(result.observations).toHaveLength(3);
    expect(result.actions.map((action) => action.kind)).toEqual([
      "wait",
      "wait",
      "summary",
    ]);
    expect(result.actions[0]).toMatchObject({ reason: "ci-pending" });
    expect(result.actions[1]).toMatchObject({ reason: "ci-running" });
    expect(result.actions[2]).toMatchObject({ reason: "ci-succeeded" });
  });

  it("maps failed CI check details to clear local fix-and-test actions", async () => {
    const controlPlane = new FakeAdoControlPlane([workItem]);
    controlPlane.setPullRequestCiStatus({
      status: "failed",
      summary: "Validation failed.",
      checks: [
        {
          name: "typecheck",
          status: "failed",
          summary: "TypeScript found an error in AdoFeedbackLoop.ts.",
          localValidationCommand: "npm run typecheck",
        },
        { name: "prettier", status: "succeeded" },
      ],
    });

    const result = await runAdoFeedbackLoop({
      controlPlane,
      workItemId: 4,
      pullRequest,
    });

    expect(result.kind).toBe("local-action-required");
    expect(result.actions).toEqual([
      {
        kind: "local-fix-and-test",
        reason: "ci-failed",
        checkName: "typecheck",
        summary: "TypeScript found an error in AdoFeedbackLoop.ts.",
        suggestedValidation: "npm run typecheck",
      },
    ]);
  });

  it("falls back to aggregate CI failure when failed check details are empty", async () => {
    const controlPlane = new FakeAdoControlPlane([workItem]);
    controlPlane.setPullRequestCiStatus({
      status: "failed",
      summary: "Validation failed without child check details.",
      checks: [],
    });

    const result = await runAdoFeedbackLoop({
      controlPlane,
      workItemId: 4,
      pullRequest,
    });

    expect(result.kind).toBe("local-action-required");
    expect(result.actions).toEqual([
      {
        kind: "local-fix-and-test",
        reason: "ci-failed",
        checkName: "CI",
        summary: "Validation failed without child check details.",
        suggestedValidation:
          "Run the local validation for 'CI' after applying the fix.",
      },
    ]);
  });

  it("returns local update actions and records review changes through comments", async () => {
    const controlPlane = new FakeAdoControlPlane([workItem]);
    controlPlane.setPullRequestCiStatus({ status: "succeeded" });
    controlPlane.setPullRequestReviewFeedback({
      status: "changes-requested",
      summary: "Reviewer requested changes.",
      comments: [
        {
          id: "comment-1",
          author: "reviewer",
          body: "Please handle missing review-feedback capability.",
          filePath: "src/AdoFeedbackLoop.ts",
          line: 12,
        },
      ],
    });

    const result = await runAdoFeedbackLoop({
      controlPlane,
      workItemId: 4,
      pullRequest,
      recordActionableFeedbackComment: true,
    });

    expect(result.kind).toBe("local-action-required");
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({
      kind: "local-update",
      reason: "review-changes",
      summary: "Reviewer requested changes.",
    });
    expect(result.comments).toHaveLength(1);
    expect(controlPlane.listComments()[0]?.body).toContain(
      "ADO feedback requires local action",
    );
  });

  it("bounds repeated unchanged feedback instead of polling indefinitely", async () => {
    const controlPlane = new FakeAdoControlPlane([workItem]);
    controlPlane.setPullRequestCiStatus({
      status: "pending",
      summary: "Build is still queued.",
    });

    const result = await runAdoFeedbackLoop({
      controlPlane,
      workItemId: 4,
      pullRequest,
      maxObservations: 10,
      maxUnchangedObservations: 2,
    });

    expect(result.kind).toBe("bounded");
    expect(result.observations).toHaveLength(2);
    expect(result.summary).toContain("stopped after 2 unchanged observation");
    expect(result.actions.every((action) => action.kind === "wait")).toBe(true);
  });

  it("records optional progress and completion comments and work item updates", async () => {
    const controlPlane = new FakeAdoControlPlane([workItem]);
    controlPlane.setPullRequestCiStatus({ status: "succeeded" });

    const result = await runAdoFeedbackLoop({
      controlPlane,
      workItemId: 4,
      pullRequest,
      recordProgressComment: true,
      recordCompletionSummaryComment: true,
      progressWorkItemUpdate: { assignedTo: "sandcastle" },
      completionWorkItemUpdate: { state: "Resolved" },
    });

    expect(result.kind).toBe("summary");
    expect(result.comments.map((comment) => comment.body)).toEqual([
      "ADO feedback loop observation 1: CI is 'succeeded', review is 'none'.",
      "ADO feedback loop observed succeeded CI and no actionable review feedback for PR 42.",
    ]);
    expect(result.updatedWorkItems).toMatchObject([
      { id: 4, assignedTo: "sandcastle" },
      { id: 4, state: "Resolved", assignedTo: "sandcastle" },
    ]);
  });

  it("fails closed when the review-feedback read capability is missing", async () => {
    await expect(
      runAdoFeedbackLoop({
        controlPlane: {
          getPullRequestCiStatus: vi.fn(async () => ({
            status: "succeeded" as const,
          })),
        },
        workItemId: 4,
        pullRequest,
      }),
    ).rejects.toThrowError(
      "ADO feedback loop requires control-plane method 'getPullRequestReviewFeedback'",
    );
  });

  it("fails closed before reading when requested recording capabilities are missing", async () => {
    const getPullRequestCiStatus = vi.fn(async () => ({
      status: "succeeded" as const,
    }));
    const getPullRequestReviewFeedback = vi.fn(
      async (): Promise<AdoReviewFeedback> => ({ status: "none" }),
    );

    await expect(
      runAdoFeedbackLoop({
        controlPlane: {
          getPullRequestCiStatus,
          getPullRequestReviewFeedback,
        },
        workItemId: 4,
        pullRequest,
        recordProgressComment: true,
      }),
    ).rejects.toThrowError(
      "ADO feedback loop requires control-plane method 'addWorkItemComment' when feedback comments are requested",
    );
    expect(getPullRequestCiStatus).not.toHaveBeenCalled();
    expect(getPullRequestReviewFeedback).not.toHaveBeenCalled();
  });

  it("uses only injected control-plane methods and never calls finalization methods", async () => {
    const controlPlane = {
      getPullRequestCiStatus: vi.fn(async () => ({
        status: "succeeded" as const,
      })),
      getPullRequestReviewFeedback: vi.fn(
        async (): Promise<AdoReviewFeedback> => ({ status: "none" }),
      ),
      approvePullRequest: vi.fn(),
      completePullRequest: vi.fn(),
      mergePullRequest: vi.fn(),
    };

    const result = await runAdoFeedbackLoop({
      controlPlane,
      workItemId: 4,
      pullRequest,
    });

    expect(result.kind).toBe("summary");
    expect(controlPlane.getPullRequestCiStatus).toHaveBeenCalledWith("42");
    expect(controlPlane.getPullRequestReviewFeedback).toHaveBeenCalledWith(
      "42",
    );
    expect(controlPlane.approvePullRequest).not.toHaveBeenCalled();
    expect(controlPlane.completePullRequest).not.toHaveBeenCalled();
    expect(controlPlane.mergePullRequest).not.toHaveBeenCalled();
  });
});
