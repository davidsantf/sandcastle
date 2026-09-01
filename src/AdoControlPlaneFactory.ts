import {
  FakeAdoControlPlane,
  type AdoCiStatus,
  type AdoControlPlane,
  type AdoPullRequestContext,
  type AdoPullRequestRequest,
  type AdoWorkItemComment,
  type AdoWorkItemContext,
  type AdoWorkItemId,
  type AdoWorkItemUpdate,
} from "./AdoTeam.js";

export interface AdoReadOnlyControlPlane {
  readonly fetchWorkItem: (
    id: AdoWorkItemId,
  ) => Promise<AdoWorkItemContext | undefined>;
  readonly getPullRequestCiStatus: (
    pullRequestId: string,
  ) => Promise<AdoCiStatus>;
}

export type AdoControlPlaneAccess = "read-only" | "write";

export interface AdoInjectedControlPlaneClient {
  readonly fetchWorkItem?: (
    id: AdoWorkItemId,
  ) => Promise<AdoWorkItemContext | undefined>;
  readonly updateWorkItem?: (
    id: AdoWorkItemId,
    update: AdoWorkItemUpdate,
  ) => Promise<AdoWorkItemContext>;
  readonly addWorkItemComment?: (
    id: AdoWorkItemId,
    body: string,
  ) => Promise<AdoWorkItemComment>;
  readonly createPullRequest?: (
    request: AdoPullRequestRequest,
  ) => Promise<AdoPullRequestContext>;
  readonly getPullRequestCiStatus?: (
    pullRequestId: string,
  ) => Promise<AdoCiStatus>;
}

export interface AdoFakeControlPlaneFactoryConfig {
  readonly mode: "fake";
  readonly access?: AdoControlPlaneAccess;
  readonly workItems?: readonly AdoWorkItemContext[];
  readonly ciStatus?: AdoCiStatus;
}

export interface AdoInjectedControlPlaneFactoryConfig {
  readonly mode: "injected";
  readonly access?: AdoControlPlaneAccess;
  readonly client: AdoInjectedControlPlaneClient;
}

export type AdoControlPlaneFactoryConfig =
  | AdoFakeControlPlaneFactoryConfig
  | AdoInjectedControlPlaneFactoryConfig;

export type AdoControlPlaneFactoryValidationErrorCode =
  | "missing-client"
  | "missing-method";

type AdoControlPlaneMethodName = keyof AdoInjectedControlPlaneClient;

export interface AdoControlPlaneFactoryValidationError {
  readonly code: AdoControlPlaneFactoryValidationErrorCode;
  readonly method?: AdoControlPlaneMethodName;
  readonly message: string;
}

export type AdoControlPlaneFactoryValidationResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly errors: readonly AdoControlPlaneFactoryValidationError[];
    };

const readOnlyMethods = [
  "fetchWorkItem",
  "getPullRequestCiStatus",
] as const satisfies readonly AdoControlPlaneMethodName[];

const writeMethods = [
  "updateWorkItem",
  "addWorkItemComment",
  "createPullRequest",
] as const satisfies readonly AdoControlPlaneMethodName[];

const methodsForAccess = (
  access: AdoControlPlaneAccess,
): readonly AdoControlPlaneMethodName[] =>
  access === "read-only"
    ? readOnlyMethods
    : [...readOnlyMethods, ...writeMethods];

const getAccess = (
  config: AdoControlPlaneFactoryConfig,
): AdoControlPlaneAccess => config.access ?? "write";

const isFunction = (value: unknown): value is (...args: never[]) => unknown =>
  typeof value === "function";

export const validateAdoControlPlaneFactoryConfig = (
  config: AdoControlPlaneFactoryConfig,
): AdoControlPlaneFactoryValidationResult => {
  if (config.mode === "fake") return { ok: true };

  const errors: AdoControlPlaneFactoryValidationError[] = [];
  if (config.client === undefined || config.client === null) {
    errors.push({
      code: "missing-client",
      message: "ADO injected control-plane mode requires a client object",
    });
    return { ok: false, errors };
  }

  const access = getAccess(config);
  for (const method of methodsForAccess(access)) {
    if (!isFunction(config.client[method])) {
      errors.push({
        code: "missing-method",
        method,
        message: `ADO injected control-plane client is missing required ${access} method '${method}'`,
      });
    }
  }

  if (errors.length === 0) return { ok: true };
  return { ok: false, errors };
};

const assertValidFactoryConfig = (
  config: AdoControlPlaneFactoryConfig,
): void => {
  const result = validateAdoControlPlaneFactoryConfig(config);
  if (result.ok) return;

  throw new Error(result.errors.map((error) => error.message).join("; "));
};

const requireReadOnlyClient = (
  client: AdoInjectedControlPlaneClient,
): AdoReadOnlyControlPlane => {
  if (!isFunction(client.fetchWorkItem)) {
    throw new Error(
      "ADO injected control-plane client is missing required read-only method 'fetchWorkItem'",
    );
  }
  if (!isFunction(client.getPullRequestCiStatus)) {
    throw new Error(
      "ADO injected control-plane client is missing required read-only method 'getPullRequestCiStatus'",
    );
  }

  return {
    fetchWorkItem: client.fetchWorkItem,
    getPullRequestCiStatus: client.getPullRequestCiStatus,
  };
};

const requireWriteClient = (
  client: AdoInjectedControlPlaneClient,
): AdoControlPlane => {
  const readOnlyClient = requireReadOnlyClient(client);
  if (!isFunction(client.updateWorkItem)) {
    throw new Error(
      "ADO injected control-plane client is missing required write method 'updateWorkItem'",
    );
  }
  if (!isFunction(client.addWorkItemComment)) {
    throw new Error(
      "ADO injected control-plane client is missing required write method 'addWorkItemComment'",
    );
  }
  if (!isFunction(client.createPullRequest)) {
    throw new Error(
      "ADO injected control-plane client is missing required write method 'createPullRequest'",
    );
  }

  return {
    ...readOnlyClient,
    updateWorkItem: client.updateWorkItem,
    addWorkItemComment: client.addWorkItemComment,
    createPullRequest: client.createPullRequest,
  };
};

const createReadOnlyControlPlane = (
  client: AdoReadOnlyControlPlane,
): AdoReadOnlyControlPlane => ({
  fetchWorkItem: (id) => client.fetchWorkItem(id),
  getPullRequestCiStatus: (pullRequestId) =>
    client.getPullRequestCiStatus(pullRequestId),
});

const createFakeControlPlane = (
  config: AdoFakeControlPlaneFactoryConfig,
): FakeAdoControlPlane => {
  const controlPlane = new FakeAdoControlPlane(config.workItems ?? []);
  if (config.ciStatus !== undefined) {
    controlPlane.setPullRequestCiStatus(config.ciStatus);
  }
  return controlPlane;
};

const createInjectedReadOnlyControlPlane = (
  client: AdoInjectedControlPlaneClient,
): AdoReadOnlyControlPlane =>
  createReadOnlyControlPlane(requireReadOnlyClient(client));

const createInjectedControlPlane = (
  client: AdoInjectedControlPlaneClient,
): AdoControlPlane => requireWriteClient(client);

export function createAdoControlPlane(
  config: AdoFakeControlPlaneFactoryConfig & { readonly access: "read-only" },
): AdoReadOnlyControlPlane;
export function createAdoControlPlane(
  config: AdoInjectedControlPlaneFactoryConfig & {
    readonly access: "read-only";
  },
): AdoReadOnlyControlPlane;
export function createAdoControlPlane(
  config: AdoFakeControlPlaneFactoryConfig & { readonly access?: "write" },
): AdoControlPlane;
export function createAdoControlPlane(
  config: AdoInjectedControlPlaneFactoryConfig & { readonly access?: "write" },
): AdoControlPlane;
export function createAdoControlPlane(
  config: AdoControlPlaneFactoryConfig,
): AdoControlPlane | AdoReadOnlyControlPlane {
  assertValidFactoryConfig(config);

  if (config.mode === "fake") {
    const fakeControlPlane = createFakeControlPlane(config);
    return getAccess(config) === "read-only"
      ? createReadOnlyControlPlane(fakeControlPlane)
      : fakeControlPlane;
  }

  return getAccess(config) === "read-only"
    ? createInjectedReadOnlyControlPlane(config.client)
    : createInjectedControlPlane(config.client);
}
