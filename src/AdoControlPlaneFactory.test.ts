import { describe, expect, it, vi } from "vitest";
import {
  createAdoControlPlane,
  validateAdoControlPlaneFactoryConfig,
  type AdoInjectedControlPlaneClient,
} from "./AdoControlPlaneFactory.js";

const workItem = {
  id: 101,
  title: "Add ADO adapter seam",
  state: "New",
};

describe("createAdoControlPlane", () => {
  it("creates a usable fake control plane", async () => {
    const controlPlane = createAdoControlPlane({
      mode: "fake",
      workItems: [workItem],
      ciStatus: { status: "succeeded" },
    });

    await expect(controlPlane.fetchWorkItem(101)).resolves.toMatchObject(
      workItem,
    );
    await expect(
      controlPlane.updateWorkItem(101, { state: "Active" }),
    ).resolves.toMatchObject({ id: 101, state: "Active" });
    await expect(
      controlPlane.addWorkItemComment(101, "Started"),
    ).resolves.toMatchObject({ workItemId: 101, body: "Started" });
    await expect(
      controlPlane.createPullRequest({
        title: "Add seam",
        sourceBranch: "sandcastle/ado-101",
        targetBranch: "main",
        workItemIds: [101],
      }),
    ).resolves.toMatchObject({
      sourceBranch: "sandcastle/ado-101",
      targetBranch: "main",
      workItemIds: [101],
    });
    await expect(controlPlane.getPullRequestCiStatus("1")).resolves.toEqual({
      status: "succeeded",
    });
  });

  it("delegates injected adapter calls", async () => {
    const client: AdoInjectedControlPlaneClient = {
      fetchWorkItem: vi.fn(async () => workItem),
      updateWorkItem: vi.fn(async (_id, update) => ({
        ...workItem,
        ...update,
      })),
      addWorkItemComment: vi.fn(async (id, body) => ({
        id: "comment-1",
        workItemId: id,
        body,
        createdAt: new Date(0),
      })),
      createPullRequest: vi.fn(async (request) => ({
        id: "pr-1",
        title: request.title,
        sourceBranch: request.sourceBranch,
        targetBranch: request.targetBranch,
        workItemIds: request.workItemIds ?? [],
        draft: request.draft ?? false,
      })),
      getPullRequestCiStatus: vi.fn(async () => ({
        status: "pending" as const,
      })),
    };
    const controlPlane = createAdoControlPlane({ mode: "injected", client });

    await expect(controlPlane.fetchWorkItem(101)).resolves.toEqual(workItem);
    await expect(
      controlPlane.updateWorkItem(101, { assignedTo: "agent" }),
    ).resolves.toMatchObject({ assignedTo: "agent" });
    await expect(
      controlPlane.addWorkItemComment(101, "Comment"),
    ).resolves.toMatchObject({ body: "Comment" });
    await expect(
      controlPlane.createPullRequest({
        title: "PR",
        sourceBranch: "feature",
        targetBranch: "main",
      }),
    ).resolves.toMatchObject({ id: "pr-1", title: "PR" });
    await expect(controlPlane.getPullRequestCiStatus("pr-1")).resolves.toEqual({
      status: "pending",
    });

    expect(client.fetchWorkItem).toHaveBeenCalledWith(101);
    expect(client.updateWorkItem).toHaveBeenCalledWith(101, {
      assignedTo: "agent",
    });
    expect(client.addWorkItemComment).toHaveBeenCalledWith(101, "Comment");
    expect(client.createPullRequest).toHaveBeenCalledWith({
      title: "PR",
      sourceBranch: "feature",
      targetBranch: "main",
    });
    expect(client.getPullRequestCiStatus).toHaveBeenCalledWith("pr-1");
  });

  it("fails closed when injected write-capable mode is missing methods", () => {
    expect(() =>
      createAdoControlPlane({
        mode: "injected",
        client: {
          fetchWorkItem: async () => workItem,
          getPullRequestCiStatus: async () => ({ status: "pending" as const }),
        },
      }),
    ).toThrowError(
      "ADO injected control-plane client is missing required write method 'updateWorkItem'",
    );
  });

  it("validates missing adapter methods with helpful errors", () => {
    expect(
      validateAdoControlPlaneFactoryConfig({
        mode: "injected",
        client: {
          fetchWorkItem: async () => workItem,
        },
      }),
    ).toEqual({
      ok: false,
      errors: [
        {
          code: "missing-method",
          method: "getPullRequestCiStatus",
          message:
            "ADO injected control-plane client is missing required write method 'getPullRequestCiStatus'",
        },
        {
          code: "missing-method",
          method: "updateWorkItem",
          message:
            "ADO injected control-plane client is missing required write method 'updateWorkItem'",
        },
        {
          code: "missing-method",
          method: "addWorkItemComment",
          message:
            "ADO injected control-plane client is missing required write method 'addWorkItemComment'",
        },
        {
          code: "missing-method",
          method: "createPullRequest",
          message:
            "ADO injected control-plane client is missing required write method 'createPullRequest'",
        },
      ],
    });
  });

  it("read-only mode does not claim write capabilities", async () => {
    const controlPlane = createAdoControlPlane({
      mode: "fake",
      access: "read-only",
      workItems: [workItem],
    });

    await expect(controlPlane.fetchWorkItem(101)).resolves.toEqual(workItem);
    expect("updateWorkItem" in controlPlane).toBe(false);
    expect("addWorkItemComment" in controlPlane).toBe(false);
    expect("createPullRequest" in controlPlane).toBe(false);
  });
});
