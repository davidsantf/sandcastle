import { describe, expect, it, vi } from "vitest";
import { createAdoControlPlane } from "./AdoControlPlaneFactory.js";
import { publishAdoPullRequest } from "./AdoPullRequestPublisher.js";
import { FakeAdoControlPlane } from "./AdoTeam.js";
import type {
  AdoPullRequestContext,
  AdoPullRequestRequest,
  AdoWorkItemId,
} from "./AdoTeam.js";

const workItem = {
  id: 3,
  title: "Add PR publishing helper",
  state: "Active",
};

const publishOptions = {
  title: "Add PR publishing helper",
  description: "Publishes local execution output through ADO metadata.",
  sourceBranch: "davidsant/ado-pr-publishing-helper",
  targetBranch: "main",
  workItemIds: [3],
  draft: true,
} as const;

describe("publishAdoPullRequest", () => {
  it("publishes PR metadata and requested work item changes through the fake control plane", async () => {
    const controlPlane = new FakeAdoControlPlane([workItem]);

    const result = await publishAdoPullRequest(controlPlane, {
      ...publishOptions,
      workItemComments: [
        {
          workItemId: 3,
          body: "PR published by Sandcastle.",
        },
      ],
      workItemUpdates: [
        {
          workItemId: 3,
          update: { state: "Resolved" },
        },
      ],
    });

    expect(result.pullRequest).toMatchObject({
      id: "1",
      title: publishOptions.title,
      sourceBranch: publishOptions.sourceBranch,
      targetBranch: publishOptions.targetBranch,
      workItemIds: [3],
      draft: true,
    });
    expect(result.comments).toEqual([
      {
        id: "1",
        workItemId: 3,
        body: "PR published by Sandcastle.",
        createdAt: new Date(0),
      },
    ]);
    expect(result.updatedWorkItems).toEqual([
      {
        ...workItem,
        state: "Resolved",
      },
    ]);
    expect(controlPlane.listComments()).toHaveLength(1);
  });

  it("delegates to an injected adapter without using shell or live ADO calls", async () => {
    const client = {
      fetchWorkItem: vi.fn(async () => workItem),
      getPullRequestCiStatus: vi.fn(async () => ({
        status: "pending" as const,
      })),
      createPullRequest: vi.fn(async (request: AdoPullRequestRequest) => ({
        id: "pr-42",
        url: "https://ado.example/pr/42",
        title: request.title,
        sourceBranch: request.sourceBranch,
        targetBranch: request.targetBranch,
        workItemIds: request.workItemIds ?? [],
        draft: request.draft ?? false,
      })),
      addWorkItemComment: vi.fn(async (id: AdoWorkItemId, body: string) => ({
        id: "comment-42",
        workItemId: id,
        body,
        createdAt: new Date(0),
      })),
      updateWorkItem: vi.fn(
        async (id: AdoWorkItemId, update: { state?: string }) => ({
          ...workItem,
          id,
          state: update.state ?? workItem.state,
        }),
      ),
    };
    const controlPlane = createAdoControlPlane({ mode: "injected", client });

    const result = await publishAdoPullRequest(controlPlane, {
      ...publishOptions,
      draft: false,
      workItemComments: [{ workItemId: 3, body: "Ready for review." }],
      workItemUpdates: [{ workItemId: 3, update: { state: "Resolved" } }],
    });

    expect(result.pullRequest).toMatchObject({
      id: "pr-42",
      url: "https://ado.example/pr/42",
      draft: false,
    });
    expect(result.comments).toMatchObject([
      { id: "comment-42", workItemId: 3, body: "Ready for review." },
    ]);
    expect(result.updatedWorkItems).toMatchObject([
      { id: 3, state: "Resolved" },
    ]);
    expect(client.createPullRequest).toHaveBeenCalledWith({
      title: publishOptions.title,
      description: publishOptions.description,
      sourceBranch: publishOptions.sourceBranch,
      targetBranch: publishOptions.targetBranch,
      workItemIds: publishOptions.workItemIds,
      draft: false,
    });
    expect(client.addWorkItemComment).toHaveBeenCalledWith(
      3,
      "Ready for review.",
    );
    expect(client.updateWorkItem).toHaveBeenCalledWith(3, {
      state: "Resolved",
    });
    expect(client.fetchWorkItem).not.toHaveBeenCalled();
    expect(client.getPullRequestCiStatus).not.toHaveBeenCalled();
  });

  it("fails closed before publishing when PR capability is missing", async () => {
    const controlPlane = createAdoControlPlane({
      mode: "fake",
      access: "read-only",
      workItems: [workItem],
    });

    await expect(
      publishAdoPullRequest(controlPlane, publishOptions),
    ).rejects.toThrowError(
      "ADO PR publishing requires control-plane method 'createPullRequest'",
    );
  });

  it("fails closed before publishing when comments are requested without comment capability", async () => {
    const createPullRequest = vi.fn(
      async (
        request: AdoPullRequestRequest,
      ): Promise<AdoPullRequestContext> => ({
        id: "pr-1",
        title: request.title,
        sourceBranch: request.sourceBranch,
        targetBranch: request.targetBranch,
        workItemIds: request.workItemIds ?? [],
        draft: request.draft ?? false,
      }),
    );

    await expect(
      publishAdoPullRequest(
        { createPullRequest },
        {
          ...publishOptions,
          workItemComments: [{ workItemId: 3, body: "Ready." }],
        },
      ),
    ).rejects.toThrowError(
      "ADO PR publishing requires control-plane method 'addWorkItemComment' when work item comments are requested",
    );
    expect(createPullRequest).not.toHaveBeenCalled();
  });

  it("fails closed before publishing when updates are requested without update capability", async () => {
    const createPullRequest = vi.fn(
      async (
        request: AdoPullRequestRequest,
      ): Promise<AdoPullRequestContext> => ({
        id: "pr-1",
        title: request.title,
        sourceBranch: request.sourceBranch,
        targetBranch: request.targetBranch,
        workItemIds: request.workItemIds ?? [],
        draft: request.draft ?? false,
      }),
    );

    await expect(
      publishAdoPullRequest(
        { createPullRequest },
        {
          ...publishOptions,
          workItemUpdates: [{ workItemId: 3, update: { state: "Resolved" } }],
        },
      ),
    ).rejects.toThrowError(
      "ADO PR publishing requires control-plane method 'updateWorkItem' when work item updates are requested",
    );
    expect(createPullRequest).not.toHaveBeenCalled();
  });

  it("does not require comment or update capabilities when no optional work item actions are requested", async () => {
    const createPullRequest = vi.fn(
      async (
        request: AdoPullRequestRequest,
      ): Promise<AdoPullRequestContext> => ({
        id: "pr-1",
        title: request.title,
        sourceBranch: request.sourceBranch,
        targetBranch: request.targetBranch,
        workItemIds: request.workItemIds ?? [],
        draft: request.draft ?? false,
      }),
    );

    await expect(
      publishAdoPullRequest({ createPullRequest }, publishOptions),
    ).resolves.toMatchObject({
      pullRequest: { id: "pr-1" },
      comments: [],
      updatedWorkItems: [],
    });
    expect(createPullRequest).toHaveBeenCalledTimes(1);
  });
});
