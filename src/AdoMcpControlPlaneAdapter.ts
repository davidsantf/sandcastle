import type {
  AdoCiStatus,
  AdoControlPlane,
  AdoPullRequestContext,
  AdoPullRequestRequest,
  AdoReviewFeedback,
  AdoWorkItemComment,
  AdoWorkItemContext,
  AdoWorkItemId,
  AdoWorkItemUpdate,
} from "./AdoTeam.js";

export type AdoMcpToolName =
  | "ado-wit_work_item"
  | "ado-wit_work_item_write"
  | "ado-wit_work_item_comment_write"
  | "ado-repo_pull_request"
  | "ado-repo_pull_request_thread"
  | "ado-repo_pull_request_write"
  | "ado-pipelines_build";

export interface AdoMcpToolRequest {
  readonly tool: AdoMcpToolName;
  readonly arguments: Readonly<Record<string, unknown>>;
}

export interface AdoMcpTransport {
  readonly invoke: (
    request: AdoMcpToolRequest,
    signal: AbortSignal,
  ) => Promise<unknown>;
}

export interface AdoMcpDecodedComment extends Omit<
  AdoWorkItemComment,
  "createdAt"
> {
  readonly createdAt: string;
}

export interface AdoMcpResponseDecoders {
  readonly workItem: (value: unknown) => AdoWorkItemContext | undefined;
  readonly updatedWorkItem: (value: unknown) => AdoWorkItemContext;
  readonly comment: (value: unknown) => AdoMcpDecodedComment;
  readonly pullRequest: (value: unknown) => AdoPullRequestContext;
  readonly ciStatus: (value: unknown) => AdoCiStatus;
  readonly reviewFeedback: (value: unknown) => AdoReviewFeedback;
}

export interface AdoMcpQueryBuilders {
  readonly ciStatus: (
    pullRequestId: string,
  ) => Readonly<Record<string, unknown>>;
  readonly reviewFeedback: (
    pullRequestId: string,
  ) => Readonly<Record<string, unknown>>;
}

interface AdoMcpControlPlaneBaseConfig {
  readonly orgName: string;
  readonly project: string;
  readonly repositoryId: string;
  readonly transport: AdoMcpTransport;
  readonly decoders: AdoMcpResponseDecoders;
  /**
   * CI and review topology is host-owned because Azure DevOps installations
   * differ in build definitions and PR policy layouts.
   */
  readonly queries: AdoMcpQueryBuilders;
  /** 1..120000 milliseconds; default 30000. */
  readonly timeoutMs?: number;
}

export type AdoMcpControlPlaneConfig = AdoMcpControlPlaneBaseConfig &
  ({ readonly access: "read-only" } | { readonly access: "write" });

const toolNames = new Set<AdoMcpToolName>([
  "ado-wit_work_item",
  "ado-wit_work_item_write",
  "ado-wit_work_item_comment_write",
  "ado-repo_pull_request",
  "ado-repo_pull_request_thread",
  "ado-repo_pull_request_write",
  "ado-pipelines_build",
]);

function text(value: unknown, maximum = 4096): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.normalize("NFC") === value &&
    !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value) &&
    Buffer.byteLength(value) <= maximum
  );
}

function content(value: unknown, maximum = 32768): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.normalize("NFC") === value &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029]/u.test(
      value,
    ) &&
    Buffer.byteLength(value) <= maximum
  );
}

function id(value: unknown): value is AdoWorkItemId {
  return (
    (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) ||
    text(value, 120)
  );
}

function pullRequestWorkItemId(value: unknown): value is AdoWorkItemId {
  return (
    (typeof value === "number" && Number.isSafeInteger(value) && value > 0) ||
    (typeof value === "string" && /^[1-9]\d*$/.test(value))
  );
}

function plainCopy<T>(value: T): T {
  const seen = new Set<object>();
  let nodes = 0;
  let bytes = 0;
  const charge = (value: string | number) => {
    bytes +=
      typeof value === "number" ? value : Buffer.byteLength(value, "utf8");
    if (bytes > 256 * 1024) throw new Error("input-limit");
  };
  const visit = (entry: unknown, depth: number): unknown => {
    if (++nodes > 8192 || depth > 16) throw new Error("input-limit");
    if (
      entry === null ||
      typeof entry === "string" ||
      typeof entry === "boolean"
    ) {
      charge(JSON.stringify(entry));
      return entry;
    }
    if (typeof entry === "number" && Number.isFinite(entry)) {
      charge(JSON.stringify(entry));
      return entry;
    }
    if (Array.isArray(entry)) {
      const lengthDescriptor = Object.getOwnPropertyDescriptor(entry, "length");
      if (
        seen.has(entry) ||
        Object.getPrototypeOf(entry) !== Array.prototype ||
        !lengthDescriptor ||
        !("value" in lengthDescriptor) ||
        !Number.isSafeInteger(lengthDescriptor.value) ||
        lengthDescriptor.value < 0 ||
        lengthDescriptor.value > 8192
      )
        throw new Error("invalid-input");
      const length = lengthDescriptor.value;
      const keys = Reflect.ownKeys(entry);
      if (
        keys.length !== length + 1 ||
        keys.some(
          (key) =>
            typeof key !== "string" ||
            (key !== "length" &&
              (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length)),
        )
      )
        throw new Error("invalid-input");
      seen.add(entry);
      charge(2 + Math.max(0, length - 1));
      const result: unknown[] = [];
      for (let index = 0; index < length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(
          entry,
          String(index),
        );
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor))
          throw new Error("invalid-input");
        result.push(visit(descriptor.value, depth + 1));
      }
      seen.delete(entry);
      return result;
    }
    if (
      typeof entry !== "object" ||
      Object.getPrototypeOf(entry) !== Object.prototype ||
      seen.has(entry)
    )
      throw new Error("invalid-input");
    seen.add(entry);
    const result: Record<string, unknown> = {};
    const keys = Reflect.ownKeys(entry);
    if (
      keys.length > 8192 ||
      keys.some(
        (key) =>
          typeof key !== "string" ||
          ["__proto__", "prototype", "constructor"].includes(key),
      )
    )
      throw new Error("invalid-input");
    charge(2 + Math.max(0, keys.length - 1));
    for (const key of keys as string[]) {
      charge(JSON.stringify(key));
      charge(1);
      const descriptor = Object.getOwnPropertyDescriptor(entry, key);
      if (!descriptor || !("value" in descriptor))
        throw new Error("invalid-input");
      Object.defineProperty(result, key, {
        value: visit(descriptor.value, depth + 1),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    seen.delete(entry);
    return result;
  };
  return visit(value, 0) as T;
}

function validateWorkItem(value: AdoWorkItemContext | undefined) {
  if (value === undefined) return value;
  if (
    !id(value.id) ||
    !text(value.title) ||
    (value.description !== undefined && !content(value.description)) ||
    (value.state !== undefined && !text(value.state)) ||
    (value.url !== undefined && !safeUrl(value.url)) ||
    (value.assignedTo !== undefined && !text(value.assignedTo)) ||
    (value.areaPath !== undefined && !text(value.areaPath)) ||
    (value.iterationPath !== undefined && !text(value.iterationPath)) ||
    (value.parentId !== undefined && !id(value.parentId)) ||
    (value.tags !== undefined &&
      (!Array.isArray(value.tags) ||
        value.tags.length > 256 ||
        value.tags.some((tag) => !text(tag))))
  )
    throw new Error("invalid-response");
  return {
    id: value.id,
    title: value.title,
    ...(value.description === undefined
      ? {}
      : { description: value.description }),
    ...(value.state === undefined ? {} : { state: value.state }),
    ...(value.url === undefined ? {} : { url: value.url }),
    ...(value.assignedTo === undefined ? {} : { assignedTo: value.assignedTo }),
    ...(value.areaPath === undefined ? {} : { areaPath: value.areaPath }),
    ...(value.iterationPath === undefined
      ? {}
      : { iterationPath: value.iterationPath }),
    ...(value.parentId === undefined ? {} : { parentId: value.parentId }),
    ...(value.tags === undefined ? {} : { tags: [...value.tags] }),
  } satisfies AdoWorkItemContext;
}

function validateComment(value: AdoMcpDecodedComment) {
  const createdAt = Date.parse(value.createdAt);
  if (
    !text(value.id) ||
    !id(value.workItemId) ||
    !content(value.body) ||
    !Number.isFinite(createdAt) ||
    new Date(createdAt).toISOString() !== value.createdAt
  )
    throw new Error("invalid-response");
  return {
    id: value.id,
    workItemId: value.workItemId,
    body: value.body,
    createdAt: new Date(createdAt),
  } satisfies AdoWorkItemComment;
}

function validatePullRequest(value: AdoPullRequestContext) {
  if (
    !text(value.id) ||
    !text(value.title) ||
    !text(value.sourceBranch) ||
    !text(value.targetBranch) ||
    (value.url !== undefined && !safeUrl(value.url)) ||
    !Array.isArray(value.workItemIds) ||
    value.workItemIds.some((item) => !id(item)) ||
    typeof value.draft !== "boolean"
  )
    throw new Error("invalid-response");
  return {
    id: value.id,
    ...(value.url === undefined ? {} : { url: value.url }),
    title: value.title,
    sourceBranch: value.sourceBranch,
    targetBranch: value.targetBranch,
    workItemIds: [...value.workItemIds],
    draft: value.draft,
  } satisfies AdoPullRequestContext;
}

function safeUrl(value: unknown): value is string {
  if (!text(value)) return false;
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

function validateCi(value: AdoCiStatus) {
  if (
    !value ||
    typeof value !== "object" ||
    !["pending", "running", "succeeded", "failed"].includes(value.status) ||
    (value.summary !== undefined && !content(value.summary)) ||
    (value.status === "failed" && !content(value.summary)) ||
    ("checks" in value &&
      (value.status !== "failed" ||
        !Array.isArray(value.checks) ||
        value.checks.length > 256 ||
        value.checks.some(
          (check) =>
            !check ||
            typeof check !== "object" ||
            !text(check.name) ||
            !["pending", "running", "succeeded", "failed"].includes(
              check.status,
            ) ||
            (check.summary !== undefined && !content(check.summary)) ||
            (check.localValidationCommand !== undefined &&
              !content(check.localValidationCommand)),
        )))
  )
    throw new Error("invalid-response");
  if (value.status === "failed")
    return {
      status: value.status,
      summary: value.summary,
      ...(value.checks === undefined
        ? {}
        : {
            checks: value.checks.map((check) => ({
              name: check.name,
              status: check.status,
              ...(check.summary === undefined
                ? {}
                : { summary: check.summary }),
              ...(check.localValidationCommand === undefined
                ? {}
                : {
                    localValidationCommand: check.localValidationCommand,
                  }),
            })),
          }),
    } satisfies AdoCiStatus;
  return {
    status: value.status,
    ...(value.summary === undefined ? {} : { summary: value.summary }),
  } satisfies AdoCiStatus;
}

function validateReview(value: AdoReviewFeedback) {
  const keys = Object.keys(value);
  const carriesComments =
    value.status === "commented" || value.status === "changes-requested";
  if (
    !value ||
    typeof value !== "object" ||
    !["none", "approved", "commented", "changes-requested"].includes(
      value.status,
    ) ||
    (value.summary !== undefined && !content(value.summary)) ||
    (!carriesComments && keys.some((key) => key === "comments")) ||
    keys.some(
      (key) =>
        !["status", "summary"].includes(key) &&
        !(carriesComments && key === "comments"),
    ) ||
    (carriesComments &&
      (!Array.isArray(value.comments) ||
        value.comments.length > 256 ||
        value.comments.some(
          (comment) =>
            !comment ||
            typeof comment !== "object" ||
            !content(comment.body) ||
            (comment.id !== undefined && !text(comment.id)) ||
            (comment.author !== undefined && !text(comment.author)) ||
            (comment.filePath !== undefined && !text(comment.filePath)) ||
            (comment.line !== undefined &&
              (!Number.isSafeInteger(comment.line) || comment.line < 1)) ||
            (comment.isActionable !== undefined &&
              typeof comment.isActionable !== "boolean"),
        )))
  )
    throw new Error("invalid-response");
  if (carriesComments) {
    const feedback = value as Extract<
      AdoReviewFeedback,
      { readonly status: "commented" | "changes-requested" }
    >;
    return {
      status: feedback.status,
      ...(feedback.summary === undefined ? {} : { summary: feedback.summary }),
      comments: feedback.comments.map((comment) => ({
        body: comment.body,
        ...(comment.id === undefined ? {} : { id: comment.id }),
        ...(comment.author === undefined ? {} : { author: comment.author }),
        ...(comment.filePath === undefined
          ? {}
          : { filePath: comment.filePath }),
        ...(comment.line === undefined ? {} : { line: comment.line }),
        ...(comment.isActionable === undefined
          ? {}
          : { isActionable: comment.isActionable }),
      })),
    } satisfies AdoReviewFeedback;
  }
  return {
    status: value.status,
    ...(value.summary === undefined ? {} : { summary: value.summary }),
  } satisfies AdoReviewFeedback;
}

function branchRef(value: string) {
  if (value.startsWith("refs/heads/")) return value;
  if (value.startsWith("refs/")) throw new Error("invalid-input");
  return `refs/heads/${value}`;
}

function request(
  tool: AdoMcpToolName,
  args: Readonly<Record<string, unknown>>,
): AdoMcpToolRequest {
  return plainCopy({ tool, arguments: args });
}

function updateOperations(update: AdoWorkItemUpdate) {
  const fields: Array<{ op: "Add" | "Remove"; path: string; value?: unknown }> =
    [];
  const add = (path: string, value: unknown) =>
    fields.push({ op: "Add", path, value });
  if (
    (update.title !== undefined && !text(update.title)) ||
    (update.description !== undefined && !content(update.description)) ||
    (update.state !== undefined && !text(update.state)) ||
    (update.assignedTo !== undefined &&
      update.assignedTo !== null &&
      !text(update.assignedTo)) ||
    (update.tags !== undefined &&
      (!Array.isArray(update.tags) ||
        update.tags.length > 256 ||
        update.tags.some((tag) => !text(tag))))
  )
    throw new Error("invalid-input");
  if (update.title !== undefined) add("/fields/System.Title", update.title);
  if (update.description !== undefined)
    add("/fields/System.Description", update.description);
  if (update.state !== undefined) add("/fields/System.State", update.state);
  if (update.assignedTo !== undefined)
    update.assignedTo === null
      ? fields.push({ op: "Remove", path: "/fields/System.AssignedTo" })
      : add("/fields/System.AssignedTo", update.assignedTo);
  if (update.tags !== undefined)
    add("/fields/System.Tags", update.tags.join("; "));
  if (fields.length === 0) throw new Error("invalid-input");
  return fields;
}

/** Create a host-side bridge. No MCP runtime is imported or discovered. */
export function createAdoMcpControlPlaneAdapter(
  config: AdoMcpControlPlaneConfig & { readonly access: "read-only" },
): Pick<
  AdoControlPlane,
  "fetchWorkItem" | "getPullRequestCiStatus" | "getPullRequestReviewFeedback"
>;
export function createAdoMcpControlPlaneAdapter(
  config: AdoMcpControlPlaneConfig & { readonly access: "write" },
): AdoControlPlane;
export function createAdoMcpControlPlaneAdapter(
  config: AdoMcpControlPlaneConfig,
):
  | AdoControlPlane
  | Pick<
      AdoControlPlane,
      | "fetchWorkItem"
      | "getPullRequestCiStatus"
      | "getPullRequestReviewFeedback"
    > {
  if (
    !text(config.orgName) ||
    !text(config.project) ||
    !text(config.repositoryId) ||
    !["read-only", "write"].includes(config.access) ||
    typeof config.transport?.invoke !== "function" ||
    typeof config.decoders?.workItem !== "function" ||
    typeof config.decoders?.updatedWorkItem !== "function" ||
    typeof config.decoders?.comment !== "function" ||
    typeof config.decoders?.pullRequest !== "function" ||
    typeof config.decoders?.ciStatus !== "function" ||
    typeof config.decoders?.reviewFeedback !== "function" ||
    typeof config.queries?.ciStatus !== "function" ||
    typeof config.queries?.reviewFeedback !== "function"
  )
    throw new Error("invalid ADO MCP adapter configuration");
  const timeoutMs = config.timeoutMs ?? 30000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000)
    throw new Error("invalid ADO MCP adapter timeout");
  const invoke = async (toolRequest: AdoMcpToolRequest) => {
    const captured = request(toolRequest.tool, toolRequest.arguments);
    if (!toolNames.has(captured.tool))
      throw new Error("unsupported ADO MCP tool");
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const retirement = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("ADO MCP operation failed"));
      }, timeoutMs);
    });
    try {
      return plainCopy(
        await Promise.race([
          config.transport.invoke(captured, controller.signal),
          retirement,
        ]),
      );
    } catch {
      throw new Error("ADO MCP operation failed");
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      controller.abort();
    }
  };
  const decode = <T, R>(
    decoder: (value: unknown) => T,
    value: unknown,
    validate: (decoded: T) => R,
  ): R => {
    try {
      const decoded = decoder(value);
      return validate(decoded === undefined ? decoded : plainCopy(decoded));
    } catch {
      throw new Error("invalid ADO MCP response");
    }
  };
  const query = (
    builder: (id: string) => Readonly<Record<string, unknown>>,
    value: string,
    protectedKeys: readonly string[],
  ) => {
    if (!text(value)) throw new Error("invalid-input");
    try {
      const built = plainCopy(builder(value));
      if (protectedKeys.some((key) => key in built))
        throw new Error("invalid query");
      return built;
    } catch {
      throw new Error("invalid ADO MCP query");
    }
  };
  const readOnly = {
    fetchWorkItem: async (workItemId: AdoWorkItemId) => {
      if (!id(workItemId)) throw new Error("invalid-input");
      return decode(
        config.decoders.workItem,
        await invoke(
          request("ado-wit_work_item", {
            action: "get",
            orgName: config.orgName,
            project: config.project,
            id: workItemId,
          }),
        ),
        validateWorkItem,
      );
    },
    getPullRequestCiStatus: async (pullRequestId: string) =>
      decode(
        config.decoders.ciStatus,
        await invoke(
          request("ado-pipelines_build", {
            ...query(config.queries.ciStatus, pullRequestId, [
              "action",
              "orgName",
              "project",
            ]),
            action: "list",
            orgName: config.orgName,
            project: config.project,
          }),
        ),
        validateCi,
      ),
    getPullRequestReviewFeedback: async (pullRequestId: string) =>
      decode(
        config.decoders.reviewFeedback,
        await invoke(
          request("ado-repo_pull_request_thread", {
            ...query(config.queries.reviewFeedback, pullRequestId, [
              "action",
              "orgName",
              "project",
              "repositoryId",
              "pullRequestId",
            ]),
            action: "list",
            orgName: config.orgName,
            project: config.project,
            repositoryId: config.repositoryId,
            pullRequestId,
          }),
        ),
        validateReview,
      ),
  };
  if (config.access === "read-only") return readOnly;
  return {
    ...readOnly,
    updateWorkItem: async (workItemId, update) => {
      if (!id(workItemId)) throw new Error("invalid-input");
      return decode(
        config.decoders.updatedWorkItem,
        await invoke(
          request("ado-wit_work_item_write", {
            action: "update",
            orgName: config.orgName,
            project: config.project,
            id: workItemId,
            updates: updateOperations(plainCopy(update)),
          }),
        ),
        (value) => {
          const validated = validateWorkItem(value);
          if (validated === undefined) throw new Error("invalid-response");
          return validated;
        },
      );
    },
    addWorkItemComment: async (workItemId, body) => {
      if (!id(workItemId) || !content(body)) throw new Error("invalid-input");
      return decode(
        config.decoders.comment,
        await invoke(
          request("ado-wit_work_item_comment_write", {
            action: "add",
            orgName: config.orgName,
            project: config.project,
            workItemId,
            comment: body,
            format: "Markdown",
          }),
        ),
        validateComment,
      );
    },
    createPullRequest: async (value: AdoPullRequestRequest) => {
      const pullRequest = plainCopy(value);
      if (
        !text(pullRequest.title) ||
        !text(pullRequest.sourceBranch) ||
        !text(pullRequest.targetBranch) ||
        (pullRequest.description !== undefined &&
          !content(pullRequest.description)) ||
        (pullRequest.draft !== undefined &&
          typeof pullRequest.draft !== "boolean") ||
        (pullRequest.workItemIds !== undefined &&
          (!Array.isArray(pullRequest.workItemIds) ||
            pullRequest.workItemIds.length > 256 ||
            pullRequest.workItemIds.some(
              (item) => !pullRequestWorkItemId(item),
            )))
      )
        throw new Error("invalid-input");
      const arguments_: Record<string, unknown> = {
        action: "create",
        orgName: config.orgName,
        project: config.project,
        repositoryId: config.repositoryId,
        sourceRefName: branchRef(pullRequest.sourceBranch),
        targetRefName: branchRef(pullRequest.targetBranch),
        title: pullRequest.title,
        isDraft: pullRequest.draft ?? false,
      };
      if (pullRequest.description !== undefined)
        arguments_.description = pullRequest.description;
      if (pullRequest.workItemIds !== undefined)
        arguments_.workItems = pullRequest.workItemIds.join(" ");
      return decode(
        config.decoders.pullRequest,
        await invoke(request("ado-repo_pull_request_write", arguments_)),
        validatePullRequest,
      );
    },
  };
}
