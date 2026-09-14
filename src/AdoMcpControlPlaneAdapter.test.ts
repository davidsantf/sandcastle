import { describe, expect, it, vi } from "vitest";
import {
  createAdoMcpControlPlaneAdapter,
  type AdoMcpControlPlaneConfig,
  type AdoMcpToolRequest,
} from "./AdoMcpControlPlaneAdapter.js";

const workItem = { id: 137, title: "Host MCP adapter", state: "Active" };
const decoders: AdoMcpControlPlaneConfig["decoders"] = {
  workItem: (value) => value as typeof workItem,
  updatedWorkItem: (value) => value as typeof workItem,
  comment: (value) =>
    value as {
      id: string;
      workItemId: number;
      body: string;
      createdAt: string;
    },
  pullRequest: (value) =>
    value as {
      id: string;
      title: string;
      sourceBranch: string;
      targetBranch: string;
      workItemIds: number[];
      draft: boolean;
    },
  ciStatus: (value) => value as { status: "succeeded" },
  reviewFeedback: (value) => value as { status: "approved" },
};

function config(
  invoke: AdoMcpControlPlaneConfig["transport"]["invoke"],
): AdoMcpControlPlaneConfig & { readonly access: "write" } {
  return {
    orgName: "test-org",
    project: "test-project",
    repositoryId: "test-repo",
    access: "write",
    transport: { invoke },
    decoders,
    queries: {
      ciStatus: (pullRequestId) => ({
        properties: [`pr:${pullRequestId}`],
      }),
      reviewFeedback: (pullRequestId) => ({
        iteration: pullRequestId,
      }),
    },
  };
}

describe("ADO MCP control-plane adapter", () => {
  it("maps read-only operations to explicit allowlisted MCP requests", async () => {
    const invoke = vi.fn(async (request: AdoMcpToolRequest) => {
      if (request.tool === "ado-wit_work_item") return workItem;
      if (request.tool === "ado-pipelines_build")
        return { status: "succeeded" };
      return { status: "approved" };
    });
    const adapter = createAdoMcpControlPlaneAdapter({
      ...config(invoke),
      access: "read-only",
    });
    await expect(adapter.fetchWorkItem(137)).resolves.toEqual(workItem);
    await expect(adapter.getPullRequestCiStatus("24")).resolves.toEqual({
      status: "succeeded",
    });
    await expect(adapter.getPullRequestReviewFeedback?.("24")).resolves.toEqual(
      { status: "approved" },
    );
    expect("updateWorkItem" in adapter).toBe(false);
    expect(invoke.mock.calls.map(([request]) => request.tool)).toEqual([
      "ado-wit_work_item",
      "ado-pipelines_build",
      "ado-repo_pull_request_thread",
    ]);
  });

  it("maps write operations without discovering or invoking any runtime globally", async () => {
    const invoke = vi.fn(async (request: AdoMcpToolRequest) => {
      if (request.tool === "ado-wit_work_item_write") return workItem;
      if (request.tool === "ado-wit_work_item_comment_write")
        return {
          id: "comment-1",
          workItemId: 137,
          body: "reviewed\nwith details",
          createdAt: new Date(0).toISOString(),
        };
      return {
        id: "pr-25",
        title: "Slice 19",
        sourceBranch: "users/slice19",
        targetBranch: "users/slice18",
        workItemIds: [137],
        draft: false,
      };
    });
    const adapter = createAdoMcpControlPlaneAdapter(config(invoke));
    await adapter.updateWorkItem(137, {
      state: "Active",
      assignedTo: null,
      tags: ["agent", "bounded"],
    });
    await adapter.addWorkItemComment(137, "reviewed\nwith details");
    await adapter.createPullRequest({
      title: "Slice 19",
      sourceBranch: "users/slice19",
      targetBranch: "users/slice18",
      workItemIds: [137],
    });
    expect(invoke.mock.calls.map(([request]) => request)).toMatchObject([
      {
        tool: "ado-wit_work_item_write",
        arguments: {
          action: "update",
          id: 137,
          updates: [
            { path: "/fields/System.State", value: "Active" },
            { path: "/fields/System.AssignedTo" },
            { path: "/fields/System.Tags", value: "agent; bounded" },
          ],
        },
      },
      {
        tool: "ado-wit_work_item_comment_write",
        arguments: {
          action: "add",
          workItemId: 137,
          comment: "reviewed\nwith details",
        },
      },
      {
        tool: "ado-repo_pull_request_write",
        arguments: {
          action: "create",
          repositoryId: "test-repo",
          sourceRefName: "refs/heads/users/slice19",
          targetRefName: "refs/heads/users/slice18",
        },
      },
    ]);
  });

  it("fails closed on scope overrides and malformed responses", async () => {
    const invoke = vi.fn(async () => ({ id: 137, title: "" }));
    const unsupported = {
      ...config(invoke),
      queries: {
        ...config(invoke).queries,
        ciStatus: () => ({ action: "update" }),
      },
    };
    const adapter = createAdoMcpControlPlaneAdapter(unsupported);
    await expect(adapter.getPullRequestCiStatus("24")).rejects.toThrow(
      "invalid ADO MCP query",
    );
    await expect(adapter.fetchWorkItem(137)).rejects.toThrow(
      "invalid ADO MCP response",
    );
    const malformedReview = createAdoMcpControlPlaneAdapter({
      ...config(async () => ({ status: "commented" })),
      access: "read-only",
      decoders: {
        ...decoders,
        reviewFeedback: (value) =>
          value as {
            status: "commented";
            comments: [];
          },
      },
    });
    await expect(
      malformedReview.getPullRequestReviewFeedback?.("24"),
    ).rejects.toThrow("invalid ADO MCP response");
    const approvedWithComments = createAdoMcpControlPlaneAdapter({
      ...config(async () => ({
        status: "approved",
        comments: [{ body: "hidden actionable feedback" }],
      })),
      access: "read-only",
      decoders: {
        ...decoders,
        reviewFeedback: (value) => value as never,
      },
    });
    await expect(
      approvedWithComments.getPullRequestReviewFeedback?.("24"),
    ).rejects.toThrow("invalid ADO MCP response");

    const throwingBuilder = createAdoMcpControlPlaneAdapter({
      ...config(async () => ({ status: "succeeded" })),
      access: "read-only",
      queries: {
        ...config(invoke).queries,
        ciStatus: () => {
          throw new Error("secret provider diagnostic");
        },
      },
    });
    await expect(throwingBuilder.getPullRequestCiStatus("24")).rejects.toThrow(
      "invalid ADO MCP query",
    );
  });

  it("bounds ignored cancellation and sanitizes transport failures", async () => {
    let settle!: (value: unknown) => void;
    const invoke = vi.fn<AdoMcpControlPlaneConfig["transport"]["invoke"]>(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    const adapter = createAdoMcpControlPlaneAdapter({
      ...config(invoke),
      timeoutMs: 25,
    });
    await expect(adapter.fetchWorkItem(137)).rejects.toThrow(
      "ADO MCP operation failed",
    );
    expect(invoke.mock.calls[0]![1].aborted).toBe(true);
    settle(workItem);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(invoke).toHaveBeenCalledOnce();
  });

  it("rejects accessors, oversized input, empty updates, and invalid config", async () => {
    const invoke = vi.fn(async () => workItem);
    const adapter = createAdoMcpControlPlaneAdapter(config(invoke));
    await expect(adapter.updateWorkItem(137, {})).rejects.toThrow(
      "invalid-input",
    );
    await expect(
      adapter.addWorkItemComment(137, "x".repeat(32769)),
    ).rejects.toThrow("invalid-input");
    await expect(
      adapter.createPullRequest({
        title: "invalid links",
        sourceBranch: "feature",
        targetBranch: "main",
        workItemIds: ["1 999"],
      }),
    ).rejects.toThrow("invalid-input");
    const update = {};
    Object.defineProperty(update, "state", { get: () => "Active" });
    await expect(adapter.updateWorkItem(137, update)).rejects.toThrow(
      "invalid-input",
    );
    expect(() =>
      createAdoMcpControlPlaneAdapter({
        ...config(invoke),
        orgName: "",
      }),
    ).toThrow("invalid ADO MCP adapter configuration");
    expect(() =>
      createAdoMcpControlPlaneAdapter({
        ...config(invoke),
        access: undefined,
      } as never),
    ).toThrow("invalid ADO MCP adapter configuration");
  });

  it("rejects prototype keys and strips undeclared provider fields", async () => {
    const poisoned = JSON.parse(
      '{"__proto__":{"status":"succeeded"}}',
    ) as unknown;
    const poisonedAdapter = createAdoMcpControlPlaneAdapter({
      ...config(async () => poisoned),
      access: "read-only",
    });
    await expect(poisonedAdapter.getPullRequestCiStatus("24")).rejects.toThrow(
      "ADO MCP operation failed",
    );

    const adapter = createAdoMcpControlPlaneAdapter({
      ...config(async () => ({
        ...workItem,
        providerDiagnostic: "must not cross the adapter",
      })),
      access: "read-only",
    });
    await expect(adapter.fetchWorkItem(137)).resolves.toEqual(workItem);
    const missing = createAdoMcpControlPlaneAdapter({
      ...config(async () => null),
      access: "read-only",
      decoders: { ...decoders, workItem: () => undefined },
    });
    await expect(missing.fetchWorkItem(404)).resolves.toBeUndefined();

    const sparse = new Array(10);
    const decodedSparse = createAdoMcpControlPlaneAdapter({
      ...config(async () => ({ status: "commented" })),
      access: "read-only",
      decoders: {
        ...decoders,
        reviewFeedback: () => ({
          status: "commented",
          comments: sparse,
        }),
      },
    });
    await expect(
      decodedSparse.getPullRequestReviewFeedback?.("24"),
    ).rejects.toThrow("invalid ADO MCP response");

    const accessorComments: unknown[] = [];
    Object.defineProperty(accessorComments, "0", {
      enumerable: true,
      get: () => ({ body: "must not execute" }),
    });
    const decodedAccessor = createAdoMcpControlPlaneAdapter({
      ...config(async () => ({ status: "commented" })),
      access: "read-only",
      decoders: {
        ...decoders,
        reviewFeedback: () => ({
          status: "commented",
          comments: accessorComments as never,
        }),
      },
    });
    await expect(
      decodedAccessor.getPullRequestReviewFeedback?.("24"),
    ).rejects.toThrow("invalid ADO MCP response");
  });
});
