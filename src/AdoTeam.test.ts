import { describe, expect, it } from "vitest";
import {
  createAdoWorkItemBranchName,
  FakeAdoControlPlane,
  validateAdoTeamConfig,
  type AdoTeamConfig,
} from "./AdoTeam.js";

describe("validateAdoTeamConfig", () => {
  it("accepts isolated parallel implementer assignments", () => {
    const config: AdoTeamConfig = {
      assignments: [
        {
          agentId: "implementer-a",
          role: "implementer",
          workItemId: 101,
          branch: "sandcastle/ado-101",
          worktreePath: "/repo/.sandcastle/worktrees/ado-101",
        },
        {
          agentId: "implementer-b",
          role: "implementer",
          workItemId: 102,
          branch: "sandcastle/ado-102",
          worktreePath: "/repo/.sandcastle/worktrees/ado-102",
        },
        {
          agentId: "reviewer-a",
          role: "reviewer",
          workItemId: 101,
          branch: "sandcastle/ado-101",
          worktreePath: "/repo/.sandcastle/worktrees/ado-101",
        },
      ],
    };

    expect(validateAdoTeamConfig(config)).toEqual({ ok: true });
  });

  it("rejects duplicate work items for parallel implementers", () => {
    const result = validateAdoTeamConfig({
      assignments: [
        { agentId: "implementer-a", role: "implementer", workItemId: 101 },
        { agentId: "implementer-b", role: "implementer", workItemId: "101" },
      ],
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        {
          code: "duplicate-work-item",
          value: "101",
          assignmentIds: ["implementer-a", "implementer-b"],
          message: "Parallel ADO implementers cannot share work item '101'",
        },
      ],
    });
  });

  it("allows duplicate work items when explicitly enabled", () => {
    const result = validateAdoTeamConfig({
      allowDuplicateWorkItems: true,
      assignments: [
        { agentId: "implementer-a", role: "implementer", workItemId: 101 },
        { agentId: "implementer-b", role: "implementer", workItemId: 101 },
      ],
    });

    expect(result).toEqual({ ok: true });
  });

  it("rejects shared branch and worktree assignments", () => {
    const result = validateAdoTeamConfig({
      assignments: [
        {
          agentId: "implementer-a",
          role: "implementer",
          workItemId: 101,
          branch: "sandcastle/ado-101",
          worktreePath: "C:\\repo\\.sandcastle\\worktrees\\ado-101\\",
        },
        {
          agentId: "implementer-b",
          role: "implementer",
          workItemId: 102,
          branch: "sandcastle/ado-101",
          worktreePath: "c:/repo/.sandcastle/worktrees/ado-101",
        },
      ],
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        {
          code: "shared-branch",
          value: "sandcastle/ado-101",
          assignmentIds: ["implementer-a", "implementer-b"],
          message:
            "Parallel ADO implementers cannot share branch 'sandcastle/ado-101'",
        },
        {
          code: "shared-worktree",
          value: "c:/repo/.sandcastle/worktrees/ado-101",
          assignmentIds: ["implementer-a", "implementer-b"],
          message:
            "Parallel ADO implementers cannot share worktree 'c:/repo/.sandcastle/worktrees/ado-101'",
        },
      ],
    });
  });
});

describe("createAdoWorkItemBranchName", () => {
  it("creates deterministic safe branch names", () => {
    expect(createAdoWorkItemBranchName(123)).toBe("sandcastle/ado-123");
    expect(createAdoWorkItemBranchName("AB# 123/456")).toBe(
      "sandcastle/ado-ab-123-456",
    );
    expect(createAdoWorkItemBranchName("  42  ", "My Tool")).toBe(
      "my-tool/ado-42",
    );
  });
});

describe("FakeAdoControlPlane", () => {
  it("supports a deterministic local work item, comment, PR, and CI lifecycle", async () => {
    const controlPlane = new FakeAdoControlPlane([
      { id: 101, title: "Add orchestration", state: "New" },
    ]);

    await expect(controlPlane.fetchWorkItem(101)).resolves.toMatchObject({
      id: 101,
      title: "Add orchestration",
      state: "New",
    });

    await expect(
      controlPlane.updateWorkItem(101, {
        state: "Active",
        assignedTo: "sandcastle-agent",
      }),
    ).resolves.toMatchObject({
      id: 101,
      state: "Active",
      assignedTo: "sandcastle-agent",
    });

    await expect(
      controlPlane.addWorkItemComment(101, "Implementation started"),
    ).resolves.toMatchObject({
      id: "1",
      workItemId: 101,
      body: "Implementation started",
      createdAt: new Date(0),
    });

    await expect(
      controlPlane.createPullRequest({
        title: "Add orchestration",
        sourceBranch: "sandcastle/ado-101",
        targetBranch: "main",
        workItemIds: [101],
        draft: true,
      }),
    ).resolves.toMatchObject({
      id: "1",
      sourceBranch: "sandcastle/ado-101",
      targetBranch: "main",
      workItemIds: [101],
      draft: true,
    });

    expect(await controlPlane.getPullRequestCiStatus("1")).toEqual({
      status: "pending",
    });

    controlPlane.setPullRequestCiStatus({ status: "succeeded" });
    await expect(controlPlane.getPullRequestCiStatus("1")).resolves.toEqual({
      status: "succeeded",
    });
    expect(controlPlane.listComments()).toHaveLength(1);
  });
});
