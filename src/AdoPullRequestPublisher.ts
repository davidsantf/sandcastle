import type {
  AdoControlPlane,
  AdoPullRequestContext,
  AdoPullRequestRequest,
  AdoWorkItemComment,
  AdoWorkItemContext,
  AdoWorkItemId,
  AdoWorkItemUpdate,
} from "./AdoTeam.js";

export interface AdoPullRequestWorkItemCommentRequest {
  readonly workItemId: AdoWorkItemId;
  readonly body: string;
}

export interface AdoPullRequestWorkItemUpdateRequest {
  readonly workItemId: AdoWorkItemId;
  readonly update: AdoWorkItemUpdate;
}

export interface PublishAdoPullRequestOptions extends AdoPullRequestRequest {
  /**
   * Optional host-side work item comments to add after the pull request is
   * created. Sandcastle never shells out to ADO tooling for these updates.
   */
  readonly workItemComments?: readonly AdoPullRequestWorkItemCommentRequest[];
  /**
   * Optional host-side work item state/metadata updates to apply after the pull
   * request is created. Sandcastle remains responsible only for local execution.
   */
  readonly workItemUpdates?: readonly AdoPullRequestWorkItemUpdateRequest[];
}

export interface PublishAdoPullRequestResult {
  readonly pullRequest: AdoPullRequestContext;
  readonly comments: readonly AdoWorkItemComment[];
  readonly updatedWorkItems: readonly AdoWorkItemContext[];
}

type AdoPullRequestPublisherControlPlane = Pick<
  AdoControlPlane,
  "createPullRequest"
> &
  Partial<Pick<AdoControlPlane, "addWorkItemComment" | "updateWorkItem">>;

export type AdoPullRequestPublisherControlPlaneLike = object;

const isRecord = (value: unknown): value is Record<PropertyKey, unknown> =>
  typeof value === "object" && value !== null;

const isFunction = (value: unknown): value is (...args: never[]) => unknown =>
  typeof value === "function";

const getControlPlaneMethod = (
  controlPlane: AdoPullRequestPublisherControlPlaneLike,
  method: keyof AdoPullRequestPublisherControlPlane,
): unknown => (isRecord(controlPlane) ? controlPlane[method] : undefined);

const requestedCount = <T>(values: readonly T[] | undefined): number =>
  values?.length ?? 0;

function assertCanPublishPullRequest(
  controlPlane: AdoPullRequestPublisherControlPlaneLike,
  options: PublishAdoPullRequestOptions,
): asserts controlPlane is AdoPullRequestPublisherControlPlane {
  if (!isFunction(getControlPlaneMethod(controlPlane, "createPullRequest"))) {
    throw new Error(
      "ADO PR publishing requires control-plane method 'createPullRequest'",
    );
  }

  if (
    requestedCount(options.workItemComments) > 0 &&
    !isFunction(getControlPlaneMethod(controlPlane, "addWorkItemComment"))
  ) {
    throw new Error(
      "ADO PR publishing requires control-plane method 'addWorkItemComment' when work item comments are requested",
    );
  }

  if (
    requestedCount(options.workItemUpdates) > 0 &&
    !isFunction(getControlPlaneMethod(controlPlane, "updateWorkItem"))
  ) {
    throw new Error(
      "ADO PR publishing requires control-plane method 'updateWorkItem' when work item updates are requested",
    );
  }
}

const createPullRequestRequest = (
  options: PublishAdoPullRequestOptions,
): AdoPullRequestRequest => ({
  title: options.title,
  description: options.description,
  sourceBranch: options.sourceBranch,
  targetBranch: options.targetBranch,
  workItemIds: options.workItemIds,
  draft: options.draft,
});

/**
 * Publishes local Sandcastle execution output as Azure Repos PR metadata through
 * the typed ADO control-plane boundary. Implements RF-007/RF-008 for issue #3.
 *
 * The helper validates all requested write capabilities before publishing so a
 * read-only or partial control plane fails closed without creating a PR.
 */
export const publishAdoPullRequest = async (
  controlPlane: AdoPullRequestPublisherControlPlaneLike,
  options: PublishAdoPullRequestOptions,
): Promise<PublishAdoPullRequestResult> => {
  assertCanPublishPullRequest(controlPlane, options);

  const pullRequest = await controlPlane.createPullRequest(
    createPullRequestRequest(options),
  );

  const comments: AdoWorkItemComment[] = [];
  for (const comment of options.workItemComments ?? []) {
    comments.push(
      await controlPlane.addWorkItemComment!(comment.workItemId, comment.body),
    );
  }

  const updatedWorkItems: AdoWorkItemContext[] = [];
  for (const workItemUpdate of options.workItemUpdates ?? []) {
    updatedWorkItems.push(
      await controlPlane.updateWorkItem!(
        workItemUpdate.workItemId,
        workItemUpdate.update,
      ),
    );
  }

  return {
    pullRequest,
    comments,
    updatedWorkItems,
  };
};
