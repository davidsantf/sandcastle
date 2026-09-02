import type {
  AdoCiCheck,
  AdoCiStatus,
  AdoControlPlane,
  AdoPullRequestContext,
  AdoReviewFeedback,
  AdoReviewFeedbackComment,
  AdoWorkItemComment,
  AdoWorkItemContext,
  AdoWorkItemId,
  AdoWorkItemUpdate,
} from "./AdoTeam.js";

export interface AdoFeedbackLoopPullRequestContext extends Pick<
  AdoPullRequestContext,
  "id"
> {
  readonly title?: string;
  readonly url?: string;
}

export type AdoFeedbackLoopAction =
  | {
      readonly kind: "wait";
      readonly reason: "ci-pending" | "ci-running";
      readonly summary: string;
    }
  | {
      readonly kind: "summary";
      readonly reason: "ci-succeeded" | "bounded";
      readonly summary: string;
    }
  | {
      readonly kind: "local-fix-and-test";
      readonly reason: "ci-failed";
      readonly checkName: string;
      readonly summary: string;
      readonly suggestedValidation: string;
    }
  | {
      readonly kind: "local-update";
      readonly reason: "review-changes";
      readonly summary: string;
      readonly comments: readonly AdoReviewFeedbackComment[];
    };

export interface AdoFeedbackLoopObservation {
  readonly attempt: number;
  readonly ciStatus: AdoCiStatus;
  readonly reviewFeedback: AdoReviewFeedback;
  readonly actions: readonly AdoFeedbackLoopAction[];
}

export type AdoFeedbackLoopResultKind =
  | "waiting"
  | "summary"
  | "local-action-required"
  | "bounded";

export interface AdoFeedbackLoopResult {
  readonly kind: AdoFeedbackLoopResultKind;
  readonly summary: string;
  readonly observations: readonly AdoFeedbackLoopObservation[];
  readonly actions: readonly AdoFeedbackLoopAction[];
  readonly comments: readonly AdoWorkItemComment[];
  readonly updatedWorkItems: readonly AdoWorkItemContext[];
}

export interface RunAdoFeedbackLoopOptions {
  readonly controlPlane: AdoFeedbackLoopControlPlaneLike;
  readonly workItemId: AdoWorkItemId;
  readonly pullRequest: AdoFeedbackLoopPullRequestContext;
  readonly maxObservations?: number;
  readonly maxUnchangedObservations?: number;
  readonly recordProgressComment?: boolean;
  readonly recordActionableFeedbackComment?: boolean;
  readonly recordCompletionSummaryComment?: boolean;
  readonly progressWorkItemUpdate?: AdoWorkItemUpdate;
  readonly completionWorkItemUpdate?: AdoWorkItemUpdate;
}

type AdoFeedbackLoopControlPlane = Pick<
  AdoControlPlane,
  "getPullRequestCiStatus"
> & {
  readonly getPullRequestReviewFeedback: (
    pullRequestId: string,
  ) => Promise<AdoReviewFeedback>;
} & Partial<Pick<AdoControlPlane, "addWorkItemComment" | "updateWorkItem">>;

export type AdoFeedbackLoopControlPlaneLike = object;

const isRecord = (value: unknown): value is Record<PropertyKey, unknown> =>
  typeof value === "object" && value !== null;

const isFunction = (value: unknown): value is (...args: never[]) => unknown =>
  typeof value === "function";

const getControlPlaneMethod = (
  controlPlane: AdoFeedbackLoopControlPlaneLike,
  method: keyof AdoFeedbackLoopControlPlane,
): unknown => (isRecord(controlPlane) ? controlPlane[method] : undefined);

const requestedUpdateCount = (
  ...updates: readonly (AdoWorkItemUpdate | undefined)[]
): number => updates.filter((update) => update !== undefined).length;

function assertCanRunFeedbackLoop(
  controlPlane: AdoFeedbackLoopControlPlaneLike,
  options: RunAdoFeedbackLoopOptions,
): asserts controlPlane is AdoFeedbackLoopControlPlane {
  if (
    !isFunction(getControlPlaneMethod(controlPlane, "getPullRequestCiStatus"))
  ) {
    throw new Error(
      "ADO feedback loop requires control-plane method 'getPullRequestCiStatus'",
    );
  }

  if (
    !isFunction(
      getControlPlaneMethod(controlPlane, "getPullRequestReviewFeedback"),
    )
  ) {
    throw new Error(
      "ADO feedback loop requires control-plane method 'getPullRequestReviewFeedback'",
    );
  }

  if (
    (options.recordProgressComment === true ||
      options.recordActionableFeedbackComment === true ||
      options.recordCompletionSummaryComment === true) &&
    !isFunction(getControlPlaneMethod(controlPlane, "addWorkItemComment"))
  ) {
    throw new Error(
      "ADO feedback loop requires control-plane method 'addWorkItemComment' when feedback comments are requested",
    );
  }

  if (
    requestedUpdateCount(
      options.progressWorkItemUpdate,
      options.completionWorkItemUpdate,
    ) > 0 &&
    !isFunction(getControlPlaneMethod(controlPlane, "updateWorkItem"))
  ) {
    throw new Error(
      "ADO feedback loop requires control-plane method 'updateWorkItem' when feedback work item updates are requested",
    );
  }
}

const getPositiveIntegerOption = (
  name: string,
  value: number | undefined,
  defaultValue: number,
): number => {
  const result = value ?? defaultValue;
  if (!Number.isInteger(result) || result < 1) {
    throw new Error(
      `ADO feedback loop option '${name}' must be a positive integer`,
    );
  }

  return result;
};

const reviewRequiresChanges = (feedback: AdoReviewFeedback): boolean =>
  feedback.status === "changes-requested" ||
  (feedback.status === "commented" &&
    feedback.comments.some((comment) => comment.isActionable === true));

const actionableReviewComments = (
  feedback: AdoReviewFeedback,
): readonly AdoReviewFeedbackComment[] => {
  if (feedback.status === "none" || feedback.status === "approved") return [];
  if (feedback.status === "changes-requested") return feedback.comments;
  return feedback.comments.filter((comment) => comment.isActionable === true);
};

const summarizeReviewFeedback = (feedback: AdoReviewFeedback): string => {
  if (feedback.summary !== undefined && feedback.summary.length > 0) {
    return feedback.summary;
  }

  switch (feedback.status) {
    case "none":
      return "No review feedback was reported.";
    case "approved":
      return "Review feedback is approved.";
    case "commented":
      return `${feedback.comments.length} review comment(s) were reported.`;
    case "changes-requested":
      return `${feedback.comments.length} review change request(s) were reported.`;
  }
};

const failedChecks = (ciStatus: AdoCiStatus): readonly AdoCiCheck[] => {
  if (ciStatus.status !== "failed") return [];

  const failedChildChecks =
    ciStatus.checks?.filter((check) => check.status === "failed") ?? [];
  if (failedChildChecks.length > 0) return failedChildChecks;

  return [
    {
      name: "CI",
      status: "failed",
      summary: ciStatus.summary,
    },
  ];
};

const suggestedValidationForCheck = (check: AdoCiCheck): string =>
  check.localValidationCommand ??
  `Run the local validation for '${check.name}' after applying the fix.`;

const actionsForObservation = (
  ciStatus: AdoCiStatus,
  reviewFeedback: AdoReviewFeedback,
): readonly AdoFeedbackLoopAction[] => {
  if (reviewRequiresChanges(reviewFeedback)) {
    return [
      {
        kind: "local-update",
        reason: "review-changes",
        summary: summarizeReviewFeedback(reviewFeedback),
        comments: actionableReviewComments(reviewFeedback),
      },
    ];
  }

  switch (ciStatus.status) {
    case "pending":
      return [
        {
          kind: "wait",
          reason: "ci-pending",
          summary:
            ciStatus.summary ?? "CI is pending; wait for a later status.",
        },
      ];
    case "running":
      return [
        {
          kind: "wait",
          reason: "ci-running",
          summary: ciStatus.summary ?? "CI is running; wait for completion.",
        },
      ];
    case "succeeded":
      return [
        {
          kind: "summary",
          reason: "ci-succeeded",
          summary:
            ciStatus.summary ??
            `${summarizeReviewFeedback(
              reviewFeedback,
            )} CI succeeded with no local fix action required.`,
        },
      ];
    case "failed":
      return failedChecks(ciStatus).map((check) => ({
        kind: "local-fix-and-test" as const,
        reason: "ci-failed" as const,
        checkName: check.name,
        summary: check.summary ?? ciStatus.summary,
        suggestedValidation: suggestedValidationForCheck(check),
      }));
  }
};

const signatureForFeedback = (
  ciStatus: AdoCiStatus,
  reviewFeedback: AdoReviewFeedback,
): string => JSON.stringify({ ciStatus, reviewFeedback });

const isLocalActionRequired = (
  actions: readonly AdoFeedbackLoopAction[],
): boolean =>
  actions.some(
    (action) =>
      action.kind === "local-fix-and-test" || action.kind === "local-update",
  );

const allActions = (
  observations: readonly AdoFeedbackLoopObservation[],
): readonly AdoFeedbackLoopAction[] =>
  observations.flatMap((observation) => observation.actions);

const addComment = async (
  controlPlane: AdoFeedbackLoopControlPlane,
  workItemId: AdoWorkItemId,
  comments: AdoWorkItemComment[],
  body: string,
): Promise<void> => {
  comments.push(await controlPlane.addWorkItemComment!(workItemId, body));
};

const updateWorkItem = async (
  controlPlane: AdoFeedbackLoopControlPlane,
  workItemId: AdoWorkItemId,
  updatedWorkItems: AdoWorkItemContext[],
  update: AdoWorkItemUpdate | undefined,
): Promise<void> => {
  if (update === undefined) return;
  updatedWorkItems.push(await controlPlane.updateWorkItem!(workItemId, update));
};

const createResult = (
  kind: AdoFeedbackLoopResultKind,
  summary: string,
  observations: readonly AdoFeedbackLoopObservation[],
  comments: readonly AdoWorkItemComment[],
  updatedWorkItems: readonly AdoWorkItemContext[],
): AdoFeedbackLoopResult => ({
  kind,
  summary,
  observations,
  actions: allActions(observations),
  comments,
  updatedWorkItems,
});

/**
 * Maps ADO CI and review feedback into bounded local Sandcastle follow-up
 * actions for issue #4. The helper reads and writes only through typed injected
 * control-plane methods; it never approves, completes, merges, shells out, or
 * decides final merge readiness.
 */
export const runAdoFeedbackLoop = async (
  options: RunAdoFeedbackLoopOptions,
): Promise<AdoFeedbackLoopResult> => {
  assertCanRunFeedbackLoop(options.controlPlane, options);

  const maxObservations = getPositiveIntegerOption(
    "maxObservations",
    options.maxObservations,
    5,
  );
  const maxUnchangedObservations = getPositiveIntegerOption(
    "maxUnchangedObservations",
    options.maxUnchangedObservations,
    2,
  );

  const observations: AdoFeedbackLoopObservation[] = [];
  const comments: AdoWorkItemComment[] = [];
  const updatedWorkItems: AdoWorkItemContext[] = [];
  let previousSignature: string | undefined;
  let unchangedObservations = 0;

  await updateWorkItem(
    options.controlPlane,
    options.workItemId,
    updatedWorkItems,
    options.progressWorkItemUpdate,
  );

  for (let attempt = 1; attempt <= maxObservations; attempt += 1) {
    const ciStatus = await options.controlPlane.getPullRequestCiStatus(
      options.pullRequest.id,
    );
    const reviewFeedback =
      await options.controlPlane.getPullRequestReviewFeedback(
        options.pullRequest.id,
      );
    const actions = actionsForObservation(ciStatus, reviewFeedback);
    const observation: AdoFeedbackLoopObservation = {
      attempt,
      ciStatus,
      reviewFeedback,
      actions,
    };
    observations.push(observation);

    if (options.recordProgressComment === true) {
      await addComment(
        options.controlPlane,
        options.workItemId,
        comments,
        `ADO feedback loop observation ${attempt}: CI is '${ciStatus.status}', review is '${reviewFeedback.status}'.`,
      );
    }

    const currentSignature = signatureForFeedback(ciStatus, reviewFeedback);
    unchangedObservations =
      currentSignature === previousSignature ? unchangedObservations + 1 : 1;
    previousSignature = currentSignature;

    if (isLocalActionRequired(actions)) {
      const summary = `ADO feedback requires local action for PR ${options.pullRequest.id}.`;
      if (options.recordActionableFeedbackComment === true) {
        await addComment(
          options.controlPlane,
          options.workItemId,
          comments,
          `${summary} ${actions.map((action) => action.summary).join(" ")}`,
        );
      }
      return createResult(
        "local-action-required",
        summary,
        observations,
        comments,
        updatedWorkItems,
      );
    }

    if (ciStatus.status === "succeeded") {
      const summary = `ADO feedback loop observed succeeded CI and no actionable review feedback for PR ${options.pullRequest.id}.`;
      if (options.recordCompletionSummaryComment === true) {
        await addComment(
          options.controlPlane,
          options.workItemId,
          comments,
          summary,
        );
      }
      await updateWorkItem(
        options.controlPlane,
        options.workItemId,
        updatedWorkItems,
        options.completionWorkItemUpdate,
      );
      return createResult(
        "summary",
        summary,
        observations,
        comments,
        updatedWorkItems,
      );
    }

    if (unchangedObservations >= maxUnchangedObservations) {
      const summary = `ADO feedback loop stopped after ${unchangedObservations} unchanged observation(s) for PR ${options.pullRequest.id}.`;
      if (options.recordCompletionSummaryComment === true) {
        await addComment(
          options.controlPlane,
          options.workItemId,
          comments,
          summary,
        );
      }
      await updateWorkItem(
        options.controlPlane,
        options.workItemId,
        updatedWorkItems,
        options.completionWorkItemUpdate,
      );
      return createResult(
        "bounded",
        summary,
        observations,
        comments,
        updatedWorkItems,
      );
    }
  }

  const summary = `ADO feedback loop stopped at the configured maximum of ${maxObservations} observation(s) for PR ${options.pullRequest.id}.`;
  if (options.recordCompletionSummaryComment === true) {
    await addComment(
      options.controlPlane,
      options.workItemId,
      comments,
      summary,
    );
  }
  await updateWorkItem(
    options.controlPlane,
    options.workItemId,
    updatedWorkItems,
    options.completionWorkItemUpdate,
  );
  return createResult(
    "bounded",
    summary,
    observations,
    comments,
    updatedWorkItems,
  );
};
