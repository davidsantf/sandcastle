import type {
  DevSquadAdoDiscoveryAuthorization,
  DevSquadAdoDiscoveryBinding,
  DevSquadAdoDiscoveryError,
  DevSquadAdoDiscoveryFilter,
  DevSquadAdoDiscoveryLimits,
  DevSquadAdoDiscoveryValidatedPass,
  DevSquadAdoWatcherDiscoverySeam,
  DevSquadAdoWatchDiscoveryConfiguration,
  RunDevSquadAdoDiscoveryWatchPassOptions,
  RunDevSquadAdoWorkflowWatchPassOptions,
} from "./DevSquadAdoWorkflowWatcher.js";
import type {
  DevSquadAdoWorkflowLedger,
  DevSquadAdoWorkItemId,
} from "./DevSquadAdoWorkflowLedger.js";
import {
  canonicalizeWorkItemId,
  validateInitializeInput,
} from "./DevSquadAdoWorkflowLedgerSchema.js";
import { prepareDevSquadAdoWorkflowWatchPassOptions } from "./DevSquadAdoWorkflowWatcherValidation.js";

type Failure = {
  readonly ok: false;
  readonly error: DevSquadAdoDiscoveryError;
};
const invalid = (field: string): Failure => ({
  ok: false,
  error: {
    kind: "validation",
    field,
    reason: "invalid discovery configuration",
  },
});

/** W039: inspect only request discriminators, before any injected effects. */
export const inspectDevSquadAdoWatchMode = (
  input: unknown,
):
  | { readonly ok: true; readonly value: "supplied" | "discovery" }
  | Failure => {
  try {
    const object = record(input);
    const mode = object.mode;
    if (mode === "discovery") {
      if ("candidates" in object) return invalid("candidates");
      if (object.discovery === undefined) return invalid("discovery");
      return { ok: true, value: "discovery" };
    }
    if (mode !== undefined && mode !== "supplied") return invalid("mode");
    if ("discovery" in object) return invalid("discovery");
    return { ok: true, value: "supplied" };
  } catch {
    return invalid("mode");
  }
};

/** Fixed-field readers throw payload-free errors confined to projection boundaries. */
export const record = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("shape");
  return value as Record<string, unknown>;
};

/** Validate length before encoding; unlike legacy identity, opaque facts are never normalized. */
export const discoveryText = (
  value: unknown,
  maximum: number,
  nonempty = false,
): string => {
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    (nonempty && value.length === 0)
  )
    throw new Error("text");
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error("unicode");
    } else if (code >= 0xdc00 && code <= 0xdfff) throw new Error("unicode");
  }
  if (Buffer.byteLength(value, "utf8") > maximum) throw new Error("bytes");
  return value;
};

/** Canonical recognized-field JSON byte meter; no oversized full JSON projection is built. */
export class DiscoveryJsonBudget {
  private bytes = 0;
  constructor(private readonly maximum: number) {}
  add(bytes: number): void {
    this.bytes += bytes;
    if (this.bytes > this.maximum) throw new Error("aggregate");
  }
  scalar<T extends string | number | boolean | null>(value: T): T {
    this.add(Buffer.byteLength(JSON.stringify(value), "utf8"));
    return value;
  }
  object<T>(fields: { readonly [K in keyof T]: () => T[K] }): T {
    // Enumerates an owned, fixed-key reader table, never the adapter's object.
    const keys = Object.keys(fields) as (keyof T & string)[];
    this.add(2 + Math.max(0, keys.length - 1));
    const result = {} as T;
    for (const key of keys) {
      this.scalar(key);
      this.add(1);
      result[key] = fields[key]();
    }
    return Object.freeze(result);
  }
  array<T>(
    raw: unknown,
    maximum: number,
    project: (value: unknown) => T,
    nonempty = false,
  ): readonly T[] {
    if (!Array.isArray(raw)) throw new Error("array");
    const length = raw.length;
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > maximum ||
      (nonempty && length === 0)
    )
      throw new Error("length");
    this.add(2 + Math.max(0, length - 1));
    const result: T[] = [];
    for (let index = 0; index < length; index++) {
      if (raw.length !== length || !(index in raw))
        throw new Error("changing array");
      const item: unknown = raw[index];
      if (raw.length !== length) throw new Error("changing array");
      const projected = project(item);
      if (raw.length !== length) throw new Error("changing array");
      result.push(projected);
    }
    return Object.freeze(result);
  }
}

const ceilings: DevSquadAdoDiscoveryLimits = {
  maxPageCalls: 1000,
  maxItems: 1000,
  maxEntriesPerPage: 1000,
  maxCollectionValues: 1024,
  maxPathSegments: 128,
  maxOpaqueValueBytes: 4096,
  maxContinuationBytes: 16384,
  maxPolicyBytes: 262144,
  maxPageBytes: 4194304,
  maxAuthorizationBytes: 1048576,
};

const projectConfiguration = (
  input: unknown,
): DevSquadAdoWatchDiscoveryConfiguration => {
  const raw = record(input);
  const rawLimits = record(raw.limits);
  const limits = {} as {
    -readonly [K in keyof DevSquadAdoDiscoveryLimits]: number;
  };
  for (const key of Object.keys(
    ceilings,
  ) as (keyof DevSquadAdoDiscoveryLimits)[]) {
    const value = rawLimits[key];
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value <= 0 ||
      value > ceilings[key]
    )
      throw new Error("limit");
    limits[key] = value;
  }
  Object.freeze(limits);
  const rawScope = record(raw.scope);
  if (rawScope.stableForInvocation !== true) throw new Error("scope stability");
  const scope = Object.freeze({
    scopeId: discoveryText(rawScope.scopeId, 256, true),
    partitionId: discoveryText(rawScope.partitionId, 256, true),
    stabilityId: discoveryText(rawScope.stabilityId, 256, true),
    stableForInvocation: true as const,
  });
  const rawPolicy = record(raw.policy);
  const policyBudget = new DiscoveryJsonBudget(limits.maxPolicyBytes);
  const slots = new Set<string>();
  const policy = policyBudget.object({
    version: () =>
      policyBudget.scalar(discoveryText(rawPolicy.version, 256, true)),
    filters: () =>
      policyBudget.array(
        rawPolicy.filters,
        7,
        (input): DevSquadAdoDiscoveryFilter => {
          const raw = record(input);
          const dimension = raw.dimension;
          const operator = raw.operator;
          const path = dimension === "area" || dimension === "iteration";
          if (
            !(
              (path && (operator === "exact" || operator === "subtree")) ||
              ((dimension === "state" || dimension === "team") &&
                operator === "one-of") ||
              (dimension === "tags" &&
                (operator === "all" ||
                  operator === "any" ||
                  operator === "none"))
            )
          )
            throw new Error("predicate");
          const slot =
            dimension === "tags" ? `tags-${operator}` : (dimension as string);
          if (slots.has(slot)) throw new Error("duplicate slot");
          slots.add(slot);
          const values = (): readonly string[] => {
            const seen = new Set<string>();
            return policyBudget.array(
              path ? raw.segments : raw.values,
              path ? limits.maxPathSegments : limits.maxCollectionValues,
              (value) => {
                const text = discoveryText(value, limits.maxOpaqueValueBytes);
                if (!path && seen.has(text)) throw new Error("duplicate value");
                seen.add(text);
                return policyBudget.scalar(text);
              },
              !path,
            );
          };
          // Discriminators were checked above; read no unsupported operand slots.
          return (
            path
              ? policyBudget.object({
                  dimension: () => policyBudget.scalar(dimension),
                  operator: () => policyBudget.scalar(operator as string),
                  segments: values,
                })
              : policyBudget.object({
                  dimension: () => policyBudget.scalar(dimension as string),
                  operator: () => policyBudget.scalar(operator as string),
                  values,
                })
          ) as DevSquadAdoDiscoveryFilter;
        },
      ),
  });
  const authorizationBudget = new DiscoveryJsonBudget(
    limits.maxAuthorizationBytes,
  );
  const seen = new Set<string>();
  const declarations = raw.authorizations;
  const authorizations = authorizationBudget.array(
    declarations === undefined ? [] : declarations,
    1000,
    (input): DevSquadAdoDiscoveryAuthorization => {
      const raw = record(input);
      const id = canonicalizeWorkItemId(
        raw.workItemId as DevSquadAdoWorkItemId,
      );
      if (!id.ok || seen.has(id.value))
        throw new Error("authorization identity");
      seen.add(id.value);
      const kind = raw.kind;
      if (kind === "unavailable") {
        const reason = raw.reason;
        if (reason !== "not-authorized" && reason !== "initial-state-missing")
          throw new Error("authorization reason");
        return authorizationBudget.object({
          workItemId: () => authorizationBudget.scalar(id.value),
          kind: () => authorizationBudget.scalar(kind),
          reason: () => authorizationBudget.scalar(reason),
        });
      }
      if (kind !== "authorized") throw new Error("authorization kind");
      const submissionId = discoveryText(raw.submissionId, 256, true);
      const initial = record(raw.initial);
      const phase = discoveryText(initial.phase, 256, true);
      const status = discoveryText(initial.status, 256, true);
      if (
        !validateInitializeInput({
          workItemId: id.value,
          operationId: "discovery-preflight",
          phase,
          status,
        }).ok
      )
        throw new Error("initial state");
      return authorizationBudget.object({
        workItemId: () => authorizationBudget.scalar(id.value),
        kind: () => authorizationBudget.scalar(kind),
        submissionId: () => authorizationBudget.scalar(submissionId),
        initial: () =>
          authorizationBudget.object({
            phase: () => authorizationBudget.scalar(phase),
            status: () => authorizationBudget.scalar(status),
          }),
      });
    },
  );
  return Object.freeze({ scope, policy, limits, authorizations });
};

/** Owned dependency/configuration snapshot, separate from the public validation view. */
export interface PreparedDiscovery {
  readonly ok: true;
  readonly value: DevSquadAdoDiscoveryValidatedPass;
  readonly options: RunDevSquadAdoWorkflowWatchPassOptions;
  readonly seam: DevSquadAdoWatcherDiscoverySeam;
}

/** Capture discovery's initializer without imposing it on any supplied caller. */
export const prepareDevSquadAdoDiscovery = (
  input: RunDevSquadAdoDiscoveryWatchPassOptions,
): PreparedDiscovery | Failure => {
  let field = "discovery";
  try {
    const configuration = projectConfiguration(input.discovery);
    field = "ledger";
    const rawLedger = input.ledger;
    const captured: Partial<DevSquadAdoWorkflowLedger> = {};
    for (const key of [
      "readRecord",
      "acquireClaim",
      "renewClaim",
      "releaseClaim",
      "checkpoint",
      "initializeRecord",
    ] as const) {
      field = `ledger.${key}`;
      const method = rawLedger[key];
      if (typeof method !== "function") return invalid(field);
      // An owned method table prevents rereading mutable adapter getters later.
      Object.defineProperty(captured, key, {
        value: method.bind(rawLedger),
        enumerable: true,
      });
    }
    field = "seam";
    const rawSeam = input.seam;
    field = "seam.discoverWorkItemsPage";
    const page = rawSeam.discoverWorkItemsPage;
    if (typeof page !== "function")
      return {
        ok: false,
        error: {
          kind: "seam-contract",
          method: "discoverWorkItemsPage",
          reason: page === undefined ? "missing" : "not-a-function",
        },
      };
    field = "seam.observeWorkItemComments";
    const comments = rawSeam.observeWorkItemComments;
    if (typeof comments !== "function")
      return {
        ok: false,
        error: {
          kind: "seam-contract",
          method: "observeWorkItemComments",
          reason: comments === undefined ? "missing" : "not-a-function",
        },
      };
    field = "seam.observePullRequestActivity";
    const pullRequest = rawSeam.observePullRequestActivity;
    if (pullRequest !== undefined && typeof pullRequest !== "function")
      return {
        ok: false,
        error: {
          kind: "seam-contract",
          method: "observePullRequestActivity",
          reason: "not-a-function",
        },
      };
    const seam = Object.freeze({
      discoverWorkItemsPage: page.bind(rawSeam),
      observeWorkItemComments: comments.bind(rawSeam),
      observePullRequestActivity: pullRequest?.bind(rawSeam),
    });
    field = "options";
    // Fixed-field proxy delegates common fields to the existing guarded preparer.
    // Its empty internal candidate list is not a synthetic discovered identity.
    const common = new Proxy({} as RunDevSquadAdoWorkflowWatchPassOptions, {
      get(_target, key) {
        if (key === "candidates") return [];
        if (key === "ledger") return captured;
        if (key === "seam") return seam;
        return Reflect.get(input, key, input);
      },
    });
    const prepared = prepareDevSquadAdoWorkflowWatchPassOptions(common, true);
    if (!prepared.ok) return prepared;
    const { candidates: _candidates, ...validated } = prepared.value;
    const binding: DevSquadAdoDiscoveryBinding = Object.freeze({
      scopeId: configuration.scope.scopeId,
      partitionId: configuration.scope.partitionId,
      stabilityId: configuration.scope.stabilityId,
      policyVersion: configuration.policy.version,
    });
    return {
      ok: true,
      value: Object.freeze({
        ...validated,
        mode: "discovery",
        binding,
        discovery: configuration,
      }),
      options: prepared.options,
      seam,
    };
  } catch {
    return invalid(field);
  }
};
