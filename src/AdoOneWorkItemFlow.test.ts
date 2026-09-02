import { describe, expect, it, vi } from "vitest";
import { FakeAdoControlPlane, type AdoControlPlane } from "./AdoTeam.js";
import { prepareAdoWorkItemRun } from "./AdoOneWorkItemFlow.js";

describe("prepareAdoWorkItemRun", () => {
  it("fetches a work item, derives a branch, validates, and posts a progress comment", async () => {
    const controlPlane = new FakeAdoControlPlane([
      { id: 123, title: "Add ADO helper", state: "New" },
    ]);

    const result = await prepareAdoWorkItemRun({
      controlPlane,
      workItemId: 123,
      implementerAgentId: "implementer-one",
    });

    expect(result).toMatchObject({
      workItem: { id: 123, title: "Add ADO helper" },
      branch: "sandcastle/ado-123",
      assignment: {
        agentId: "implementer-one",
        role: "implementer",
        workItemId: 123,
        branch: "sandcastle/ado-123",
      },
      teamConfig: {
        assignments: [
          {
            agentId: "implementer-one",
            role: "implementer",
            workItemId: 123,
            branch: "sandcastle/ado-123",
          },
        ],
      },
      validation: { ok: true },
      dryRun: false,
    });
    expect(result.comment).toMatchObject({
      id: "1",
      workItemId: 123,
      body: expect.stringContaining("Branch: sandcastle/ado-123"),
    });
    expect(controlPlane.listComments()).toHaveLength(1);
  });

  it("fails closed when the work item is not found", async () => {
    const controlPlane = new FakeAdoControlPlane();

    await expect(
      prepareAdoWorkItemRun({
        controlPlane,
        workItemId: 404,
        implementerAgentId: "implementer-one",
      }),
    ).rejects.toThrow("ADO work item '404' was not found");
    expect(controlPlane.listComments()).toHaveLength(0);
  });

  it("returns validation failures without posting a progress comment", async () => {
    const controlPlane = new FakeAdoControlPlane([
      { id: 123, title: "Add ADO helper" },
    ]);

    const result = await prepareAdoWorkItemRun({
      controlPlane,
      workItemId: 123,
      implementerAgentId: "implementer-two",
      existingAssignments: [
        {
          agentId: "implementer-one",
          role: "implementer",
          workItemId: 123,
          branch: "sandcastle/ado-123",
        },
      ],
    });

    expect(result.validation).toEqual({
      ok: false,
      errors: [
        {
          code: "duplicate-work-item",
          value: "123",
          assignmentIds: ["implementer-one", "implementer-two"],
          message: "Parallel ADO implementers cannot share work item '123'",
        },
        {
          code: "shared-branch",
          value: "sandcastle/ado-123",
          assignmentIds: ["implementer-one", "implementer-two"],
          message:
            "Parallel ADO implementers cannot share branch 'sandcastle/ado-123'",
        },
      ],
    });
    expect(result.comment).toBeUndefined();
    expect(controlPlane.listComments()).toHaveLength(0);
  });

  it("uses a caller-provided branch instead of deriving one", async () => {
    const controlPlane = new FakeAdoControlPlane([
      { id: "AB# 123", title: "Use chosen branch" },
    ]);

    const result = await prepareAdoWorkItemRun({
      controlPlane,
      workItemId: "AB# 123",
      implementerAgentId: "implementer-one",
      branch: "feature/custom-ado-branch",
    });

    expect(result.branch).toBe("feature/custom-ado-branch");
    expect(result.assignment.branch).toBe("feature/custom-ado-branch");
    expect(result.comment?.body).toContain("Branch: feature/custom-ado-branch");
  });

  it("supports dry runs without posting a progress comment", async () => {
    const controlPlane = new FakeAdoControlPlane([
      { id: 321, title: "Plan without comment" },
    ]);

    const result = await prepareAdoWorkItemRun({
      controlPlane,
      workItemId: 321,
      implementerAgentId: "implementer-one",
      dryRun: true,
    });

    expect(result).toMatchObject({
      branch: "sandcastle/ado-321",
      validation: { ok: true },
      dryRun: true,
    });
    expect(result.comment).toBeUndefined();
    expect(controlPlane.listComments()).toHaveLength(0);
  });

  it("supports injected mock control planes without live ADO calls", async () => {
    const controlPlane: AdoControlPlane = {
      fetchWorkItem: vi.fn(async () => ({ id: 123, title: "Injected" })),
      updateWorkItem: vi.fn(),
      addWorkItemComment: vi.fn(async (workItemId, body) => ({
        id: "comment-1",
        workItemId,
        body,
        createdAt: new Date(0),
      })),
      createPullRequest: vi.fn(),
      getPullRequestCiStatus: vi.fn(),
    };

    const result = await prepareAdoWorkItemRun({
      controlPlane,
      workItemId: 123,
      implementerAgentId: "implementer-one",
      progressComment: "custom start comment",
    });

    expect(controlPlane.fetchWorkItem).toHaveBeenCalledWith(123);
    expect(controlPlane.addWorkItemComment).toHaveBeenCalledWith(
      123,
      "custom start comment",
    );
    expect(result.comment?.id).toBe("comment-1");
  });
});
