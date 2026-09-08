import { createHash, timingSafeEqual } from "node:crypto";
import type {
  AcquireDevSquadAdoWorkflowClaimInput,
  CheckpointDevSquadAdoWorkflowInput,
  DevSquadAdoCheckpointEntry,
  DevSquadAdoClaimMetadata,
  DevSquadAdoLedgerError,
  DevSquadAdoPullRequestCursor,
  DevSquadAdoWorkflowRecord,
  DevSquadAdoWorkItemId,
  InitializeDevSquadAdoWorkflowRecordInput,
  OpenDevSquadAdoWorkflowLedgerInput,
  ReleaseDevSquadAdoWorkflowClaimInput,
  RenewDevSquadAdoWorkflowClaimInput,
} from "./DevSquadAdoWorkflowLedger.js";

/** Strict schema-v1 and data-minimization boundary (ADR-0025, FR-018–021). */
export const LEDGER_KIND = "devsquad-ado-workflow-ledger" as const;
export const RECORD_KIND = "devsquad-ado-workflow-record" as const;
export const SCHEMA_VERSION = 1 as const;
export const MAX_RECORDS = 10_000;
export const MAX_OPERATIONS = 20_000;
export const MAX_CHECKPOINTS = 10_000;
export const MAX_REFERENCE_HISTORY = 10_000;
export const MAX_GENERATION_BYTES = 16 * 1024 * 1024;
export const MAX_RECORD_DIRECTORY_ENTRIES = 64;
export const MAX_RECOVERY_ARTIFACTS = 100_000;
export const MAX_PUBLICATION_ATTEMPTS = 32;
export const MAX_LEASE_MS = 86_400_000;

const utf8Length = (value: string): number => Buffer.byteLength(value, "utf8");
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;
const UNSAFE_ID = /[\/\\\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;
const HEX_64 = /^[a-f0-9]{64}$/;
const UTC_MILLISECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: DevSquadAdoLedgerError };

const validation = (
  field: string,
  reason: string,
): ValidationResult<never> => ({
  ok: false,
  error: { kind: "validation", field, reason },
});

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean => Object.keys(value).every((key) => allowed.includes(key));

const requireObject = (
  value: unknown,
  field: string,
  keys: readonly string[],
): ValidationResult<Record<string, unknown>> => {
  if (!isObject(value)) return validation(field, "must be an object");
  if (!hasExactKeys(value, keys))
    return validation(field, "contains an unknown field");
  return { ok: true, value };
};

const boundedString = (
  value: unknown,
  field: string,
  maximumBytes: number,
): ValidationResult<string> => {
  if (typeof value !== "string") return validation(field, "must be a string");
  if (value.trim().length === 0) return validation(field, "must not be blank");
  if (CONTROL.test(value))
    return validation(field, "contains a control character");
  if (utf8Length(value) > maximumBytes)
    return validation(field, "exceeds the byte limit");
  return { ok: true, value };
};

export const canonicalizeWorkItemId = (
  value: DevSquadAdoWorkItemId,
): ValidationResult<string> => {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      return validation("workItemId", "must be a nonnegative safe integer");
    }
    return { ok: true, value: String(value) };
  }
  if (typeof value !== "string")
    return validation("workItemId", "must be a string or number");
  if (value.normalize("NFC") !== value)
    return validation("workItemId", "must be NFC-normalized");
  if (value.trim().length === 0)
    return validation("workItemId", "must not be blank");
  if (utf8Length(value) > 120)
    return validation("workItemId", "exceeds the byte limit");
  if (UNSAFE_ID.test(value))
    return validation("workItemId", "contains an unsafe character");
  return { ok: true, value };
};

const validatePhaseStatus = (
  value: unknown,
  field: string,
): ValidationResult<string> => boundedString(value, field, 256);
const validateIdentifier = (
  value: unknown,
  field: string,
): ValidationResult<string> => boundedString(value, field, 256);
const validateOpaque = (
  value: unknown,
  field: string,
): ValidationResult<string> => boundedString(value, field, 1_024);
const validateBranch = (
  value: unknown,
  field: string,
): ValidationResult<string> => boundedString(value, field, 1_024);

const isAbsoluteStoredPath = (value: string): boolean =>
  value.startsWith("/") ||
  /^[A-Za-z]:[\\/]/.test(value) ||
  /^\\\\[^\\/]+[\\/][^\\/]+/.test(value);

const validateWorktreePath = (
  value: unknown,
  field: string,
): ValidationResult<string> => {
  if (typeof value !== "string") return validation(field, "must be a string");
  if (value.trim().length === 0) return validation(field, "must not be blank");
  if (value.includes("\0") || CONTROL.test(value))
    return validation(field, "contains a control character");
  if (utf8Length(value) > 4_096)
    return validation(field, "exceeds the byte limit");
  if (!isAbsoluteStoredPath(value))
    return validation(field, "must be an absolute host path");
  return { ok: true, value };
};

const validatePullRequestUrl = (
  value: unknown,
  field: string,
): ValidationResult<string> => {
  if (typeof value !== "string" || value.trim().length === 0)
    return validation(field, "must be a nonblank URL");
  if (utf8Length(value) > 4_096 || CONTROL.test(value))
    return validation(field, "is not a valid minimized URL");
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      return validation(
        field,
        "must be HTTP(S) without credentials, query, or fragment",
      );
    }
    return { ok: true, value };
  } catch {
    return validation(field, "must be an absolute URL");
  }
};

export const validateClaimToken = (
  value: unknown,
  field = "claimToken",
): ValidationResult<string> => {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_-]+$/.test(value) ||
    value.includes("=")
  ) {
    return validation(field, "must be canonical unpadded base64url");
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== 32 || decoded.toString("base64url") !== value) {
    return validation(field, "must decode to exactly 32 bytes");
  }
  return { ok: true, value };
};

const validateLease = (value: unknown): ValidationResult<number> => {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) <= 0 ||
    (value as number) > MAX_LEASE_MS
  ) {
    return validation(
      "leaseDurationMs",
      "must be a positive safe integer no greater than 86400000",
    );
  }
  return { ok: true, value: value as number };
};

const validateFence = (value: unknown): ValidationResult<number> => {
  if (!Number.isSafeInteger(value) || (value as number) <= 0)
    return validation(
      "authority.fencingValue",
      "must be a positive safe integer",
    );
  return { ok: true, value: value as number };
};

const validateCursor = (
  value: unknown,
  field: string,
): ValidationResult<DevSquadAdoPullRequestCursor> => {
  const object = requireObject(value, field, ["threadId", "commentId"]);
  if (!object.ok) return object;
  const threadId = validateOpaque(object.value.threadId, `${field}.threadId`);
  if (!threadId.ok) return threadId;
  const commentId = validateOpaque(
    object.value.commentId,
    `${field}.commentId`,
  );
  if (!commentId.ok) return commentId;
  return {
    ok: true,
    value: { threadId: threadId.value, commentId: commentId.value },
  };
};

export interface NormalizedInitializeInput {
  readonly workItemId: string;
  readonly operationId: string;
  readonly phase: string;
  readonly status: string;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly agentId: string | null;
  readonly sessionId: string | null;
  readonly pullRequest: {
    readonly id: string | null;
    readonly url: string | null;
  };
  readonly observations: {
    readonly workItemCommentId: string | null;
    readonly pullRequest: DevSquadAdoPullRequestCursor | null;
  };
}

export const validateOpenInput = (
  input: OpenDevSquadAdoWorkflowLedgerInput,
): ValidationResult<{ repositoryRoot: string }> => {
  const object = requireObject(input, "input", ["repositoryRoot"]);
  if (!object.ok) return object;
  if (
    typeof object.value.repositoryRoot !== "string" ||
    object.value.repositoryRoot.trim() === "" ||
    object.value.repositoryRoot.includes("\0")
  ) {
    return validation("repositoryRoot", "must be a nonblank path");
  }
  return { ok: true, value: { repositoryRoot: object.value.repositoryRoot } };
};

export const validateInitializeInput = (
  input: InitializeDevSquadAdoWorkflowRecordInput,
): ValidationResult<NormalizedInitializeInput> => {
  const object = requireObject(input, "input", [
    "workItemId",
    "operationId",
    "phase",
    "status",
    "branch",
    "worktreePath",
    "agentId",
    "sessionId",
    "pullRequest",
    "observations",
  ]);
  if (!object.ok) return object;
  const workItemId = canonicalizeWorkItemId(
    object.value.workItemId as DevSquadAdoWorkItemId,
  );
  if (!workItemId.ok) return workItemId;
  const operationId = validateIdentifier(
    object.value.operationId,
    "operationId",
  );
  if (!operationId.ok) return operationId;
  const phase = validatePhaseStatus(object.value.phase, "phase");
  if (!phase.ok) return phase;
  const status = validatePhaseStatus(object.value.status, "status");
  if (!status.ok) return status;
  const branch =
    object.value.branch === undefined
      ? { ok: true as const, value: null }
      : validateBranch(object.value.branch, "branch");
  if (!branch.ok) return branch;
  const worktreePath =
    object.value.worktreePath === undefined
      ? { ok: true as const, value: null }
      : validateWorktreePath(object.value.worktreePath, "worktreePath");
  if (!worktreePath.ok) return worktreePath;
  const agentId =
    object.value.agentId === undefined
      ? { ok: true as const, value: null }
      : validateIdentifier(object.value.agentId, "agentId");
  if (!agentId.ok) return agentId;
  const sessionId =
    object.value.sessionId === undefined
      ? { ok: true as const, value: null }
      : validateIdentifier(object.value.sessionId, "sessionId");
  if (!sessionId.ok) return sessionId;

  let pullRequest: NormalizedInitializeInput["pullRequest"] = {
    id: null,
    url: null,
  };
  if (object.value.pullRequest !== undefined) {
    const pr = requireObject(object.value.pullRequest, "pullRequest", [
      "id",
      "url",
    ]);
    if (!pr.ok) return pr;
    let id: string | null = null;
    let url: string | null = null;
    if (pr.value.id !== undefined) {
      const parsed = validateOpaque(pr.value.id, "pullRequest.id");
      if (!parsed.ok) return parsed;
      id = parsed.value;
    }
    if (pr.value.url !== undefined) {
      const parsed = validatePullRequestUrl(pr.value.url, "pullRequest.url");
      if (!parsed.ok) return parsed;
      url = parsed.value;
    }
    pullRequest = { id, url };
  }

  let observations: NormalizedInitializeInput["observations"] = {
    workItemCommentId: null,
    pullRequest: null,
  };
  if (object.value.observations !== undefined) {
    const obs = requireObject(object.value.observations, "observations", [
      "workItemCommentId",
      "pullRequest",
    ]);
    if (!obs.ok) return obs;
    let workItemCommentId: string | null = null;
    let pullRequestCursor: DevSquadAdoPullRequestCursor | null = null;
    if (obs.value.workItemCommentId !== undefined) {
      const parsed = validateOpaque(
        obs.value.workItemCommentId,
        "observations.workItemCommentId",
      );
      if (!parsed.ok) return parsed;
      workItemCommentId = parsed.value;
    }
    if (obs.value.pullRequest !== undefined) {
      const parsed = validateCursor(
        obs.value.pullRequest,
        "observations.pullRequest",
      );
      if (!parsed.ok) return parsed;
      pullRequestCursor = parsed.value;
    }
    observations = { workItemCommentId, pullRequest: pullRequestCursor };
  }

  return {
    ok: true,
    value: {
      workItemId: workItemId.value,
      operationId: operationId.value,
      phase: phase.value,
      status: status.value,
      branch: branch.value,
      worktreePath: worktreePath.value,
      agentId: agentId.value,
      sessionId: sessionId.value,
      pullRequest,
      observations,
    },
  };
};

export interface NormalizedAuthority {
  readonly ownerId: string;
  readonly claimToken: string;
  readonly fencingValue: number;
}

const validateAuthority = (
  value: unknown,
): ValidationResult<NormalizedAuthority> => {
  const object = requireObject(value, "authority", [
    "ownerId",
    "claimToken",
    "fencingValue",
  ]);
  if (!object.ok) return object;
  const ownerId = validateIdentifier(object.value.ownerId, "authority.ownerId");
  if (!ownerId.ok) return ownerId;
  const claimToken = validateClaimToken(
    object.value.claimToken,
    "authority.claimToken",
  );
  if (!claimToken.ok) return claimToken;
  const fencingValue = validateFence(object.value.fencingValue);
  if (!fencingValue.ok) return fencingValue;
  return {
    ok: true,
    value: {
      ownerId: ownerId.value,
      claimToken: claimToken.value,
      fencingValue: fencingValue.value,
    },
  };
};

export interface NormalizedAcquireInput {
  readonly workItemId: string;
  readonly operationId: string;
  readonly ownerId: string;
  readonly claimToken: string;
  readonly leaseDurationMs: number;
}

export const validateAcquireInput = (
  input: AcquireDevSquadAdoWorkflowClaimInput,
): ValidationResult<NormalizedAcquireInput> => {
  const object = requireObject(input, "input", [
    "workItemId",
    "operationId",
    "ownerId",
    "claimToken",
    "leaseDurationMs",
  ]);
  if (!object.ok) return object;
  const workItemId = canonicalizeWorkItemId(
    object.value.workItemId as DevSquadAdoWorkItemId,
  );
  if (!workItemId.ok) return workItemId;
  const operationId = validateIdentifier(
    object.value.operationId,
    "operationId",
  );
  if (!operationId.ok) return operationId;
  const ownerId = validateIdentifier(object.value.ownerId, "ownerId");
  if (!ownerId.ok) return ownerId;
  const claimToken = validateClaimToken(object.value.claimToken);
  if (!claimToken.ok) return claimToken;
  const leaseDurationMs = validateLease(object.value.leaseDurationMs);
  if (!leaseDurationMs.ok) return leaseDurationMs;
  return {
    ok: true,
    value: {
      workItemId: workItemId.value,
      operationId: operationId.value,
      ownerId: ownerId.value,
      claimToken: claimToken.value,
      leaseDurationMs: leaseDurationMs.value,
    },
  };
};

export interface NormalizedRenewInput {
  readonly workItemId: string;
  readonly operationId: string;
  readonly authority: NormalizedAuthority;
  readonly leaseDurationMs: number;
}

export const validateRenewInput = (
  input: RenewDevSquadAdoWorkflowClaimInput,
): ValidationResult<NormalizedRenewInput> => {
  const object = requireObject(input, "input", [
    "workItemId",
    "operationId",
    "authority",
    "leaseDurationMs",
  ]);
  if (!object.ok) return object;
  const workItemId = canonicalizeWorkItemId(
    object.value.workItemId as DevSquadAdoWorkItemId,
  );
  if (!workItemId.ok) return workItemId;
  const operationId = validateIdentifier(
    object.value.operationId,
    "operationId",
  );
  if (!operationId.ok) return operationId;
  const authority = validateAuthority(object.value.authority);
  if (!authority.ok) return authority;
  const leaseDurationMs = validateLease(object.value.leaseDurationMs);
  if (!leaseDurationMs.ok) return leaseDurationMs;
  return {
    ok: true,
    value: {
      workItemId: workItemId.value,
      operationId: operationId.value,
      authority: authority.value,
      leaseDurationMs: leaseDurationMs.value,
    },
  };
};

export interface NormalizedReleaseInput {
  readonly workItemId: string;
  readonly operationId: string;
  readonly authority: NormalizedAuthority;
}

export const validateReleaseInput = (
  input: ReleaseDevSquadAdoWorkflowClaimInput,
): ValidationResult<NormalizedReleaseInput> => {
  const object = requireObject(input, "input", [
    "workItemId",
    "operationId",
    "authority",
  ]);
  if (!object.ok) return object;
  const workItemId = canonicalizeWorkItemId(
    object.value.workItemId as DevSquadAdoWorkItemId,
  );
  if (!workItemId.ok) return workItemId;
  const operationId = validateIdentifier(
    object.value.operationId,
    "operationId",
  );
  if (!operationId.ok) return operationId;
  const authority = validateAuthority(object.value.authority);
  if (!authority.ok) return authority;
  return {
    ok: true,
    value: {
      workItemId: workItemId.value,
      operationId: operationId.value,
      authority: authority.value,
    },
  };
};

export interface NormalizedCheckpointPatch {
  readonly phase?: string;
  readonly status?: string;
  readonly branch?: string | null;
  readonly worktreePath?: string | null;
  readonly agentId?: string | null;
  readonly sessionId?: string | null;
  readonly pullRequest?: {
    readonly id?: string | null;
    readonly url?: string | null;
  };
  readonly observations?: {
    readonly workItemCommentId?: string | null;
    readonly pullRequest?: DevSquadAdoPullRequestCursor | null;
  };
}

export interface NormalizedCheckpointInput {
  readonly workItemId: string;
  readonly operationId: string;
  readonly authority: NormalizedAuthority;
  readonly expected: {
    readonly revision: number;
    readonly phase: string;
    readonly status: string;
  };
  readonly patch: NormalizedCheckpointPatch;
}

export const validateCheckpointInput = (
  input: CheckpointDevSquadAdoWorkflowInput,
): ValidationResult<NormalizedCheckpointInput> => {
  const object = requireObject(input, "input", [
    "workItemId",
    "operationId",
    "authority",
    "expected",
    "patch",
  ]);
  if (!object.ok) return object;
  const workItemId = canonicalizeWorkItemId(
    object.value.workItemId as DevSquadAdoWorkItemId,
  );
  if (!workItemId.ok) return workItemId;
  const operationId = validateIdentifier(
    object.value.operationId,
    "operationId",
  );
  if (!operationId.ok) return operationId;
  const authority = validateAuthority(object.value.authority);
  if (!authority.ok) return authority;
  const expectedObject = requireObject(object.value.expected, "expected", [
    "revision",
    "phase",
    "status",
  ]);
  if (!expectedObject.ok) return expectedObject;
  if (
    !Number.isSafeInteger(expectedObject.value.revision) ||
    (expectedObject.value.revision as number) <= 0
  )
    return validation("expected.revision", "must be a positive safe integer");
  const expectedPhase = validatePhaseStatus(
    expectedObject.value.phase,
    "expected.phase",
  );
  if (!expectedPhase.ok) return expectedPhase;
  const expectedStatus = validatePhaseStatus(
    expectedObject.value.status,
    "expected.status",
  );
  if (!expectedStatus.ok) return expectedStatus;
  const patchObject = requireObject(object.value.patch, "patch", [
    "phase",
    "status",
    "branch",
    "worktreePath",
    "agentId",
    "sessionId",
    "pullRequest",
    "observations",
  ]);
  if (!patchObject.ok) return patchObject;
  if (Object.keys(patchObject.value).length === 0)
    return validation("patch", "must contain at least one field");
  const patch: Record<string, unknown> = {};
  if ("phase" in patchObject.value) {
    const parsed = validatePhaseStatus(patchObject.value.phase, "patch.phase");
    if (!parsed.ok) return parsed;
    patch.phase = parsed.value;
  }
  if ("status" in patchObject.value) {
    const parsed = validatePhaseStatus(
      patchObject.value.status,
      "patch.status",
    );
    if (!parsed.ok) return parsed;
    patch.status = parsed.value;
  }
  if ("branch" in patchObject.value) {
    if (patchObject.value.branch === null) patch.branch = null;
    else {
      const parsed = validateBranch(patchObject.value.branch, "patch.branch");
      if (!parsed.ok) return parsed;
      patch.branch = parsed.value;
    }
  }
  if ("worktreePath" in patchObject.value) {
    if (patchObject.value.worktreePath === null) patch.worktreePath = null;
    else {
      const parsed = validateWorktreePath(
        patchObject.value.worktreePath,
        "patch.worktreePath",
      );
      if (!parsed.ok) return parsed;
      patch.worktreePath = parsed.value;
    }
  }
  for (const key of ["agentId", "sessionId"] as const) {
    if (key in patchObject.value) {
      const value = patchObject.value[key];
      if (value === null) patch[key] = null;
      else {
        const parsed = validateIdentifier(value, `patch.${key}`);
        if (!parsed.ok) return parsed;
        patch[key] = parsed.value;
      }
    }
  }
  if ("pullRequest" in patchObject.value) {
    const pr = requireObject(
      patchObject.value.pullRequest,
      "patch.pullRequest",
      ["id", "url"],
    );
    if (!pr.ok) return pr;
    if (Object.keys(pr.value).length === 0)
      return validation("patch.pullRequest", "must contain at least one field");
    const normalized: Record<string, unknown> = {};
    if ("id" in pr.value) {
      if (pr.value.id === null) normalized.id = null;
      else {
        const parsed = validateOpaque(pr.value.id, "patch.pullRequest.id");
        if (!parsed.ok) return parsed;
        normalized.id = parsed.value;
      }
    }
    if ("url" in pr.value) {
      if (pr.value.url === null) normalized.url = null;
      else {
        const parsed = validatePullRequestUrl(
          pr.value.url,
          "patch.pullRequest.url",
        );
        if (!parsed.ok) return parsed;
        normalized.url = parsed.value;
      }
    }
    patch.pullRequest = normalized;
  }
  if ("observations" in patchObject.value) {
    const obs = requireObject(
      patchObject.value.observations,
      "patch.observations",
      ["workItemCommentId", "pullRequest"],
    );
    if (!obs.ok) return obs;
    if (Object.keys(obs.value).length === 0)
      return validation(
        "patch.observations",
        "must contain at least one field",
      );
    const normalized: Record<string, unknown> = {};
    if ("workItemCommentId" in obs.value) {
      if (obs.value.workItemCommentId === null)
        normalized.workItemCommentId = null;
      else {
        const parsed = validateOpaque(
          obs.value.workItemCommentId,
          "patch.observations.workItemCommentId",
        );
        if (!parsed.ok) return parsed;
        normalized.workItemCommentId = parsed.value;
      }
    }
    if ("pullRequest" in obs.value) {
      if (obs.value.pullRequest === null) normalized.pullRequest = null;
      else {
        const parsed = validateCursor(
          obs.value.pullRequest,
          "patch.observations.pullRequest",
        );
        if (!parsed.ok) return parsed;
        normalized.pullRequest = parsed.value;
      }
    }
    patch.observations = normalized;
  }
  return {
    ok: true,
    value: {
      workItemId: workItemId.value,
      operationId: operationId.value,
      authority: authority.value,
      expected: {
        revision: expectedObject.value.revision as number,
        phase: expectedPhase.value,
        status: expectedStatus.value,
      },
      patch: patch as NormalizedCheckpointPatch,
    },
  };
};

export interface PersistedReferenceActivationV1 {
  readonly id: string;
  readonly revision: number;
  readonly activatedAt: string;
}
export interface PersistedReferenceHistoryV1 {
  readonly current: string | null;
  readonly history: readonly PersistedReferenceActivationV1[];
}
export interface PersistedCheckpointV1 extends DevSquadAdoCheckpointEntry {}
export interface PersistedActiveClaimV1 {
  readonly ownerId: string;
  readonly tokenVerifier: string;
  readonly fencingValue: number;
  readonly acquiredAt: string;
  readonly heartbeatAt: string;
  readonly expiresAt: string;
}
export type PersistedOperationKind =
  | "initialize"
  | "checkpoint"
  | "acquire-claim"
  | "renew-claim"
  | "release-claim";
export type PersistedOperationOutcomeV1 =
  | { readonly kind: "initialized" }
  | {
      readonly kind: "checkpointed";
      readonly checkpoint: PersistedCheckpointV1;
    }
  | {
      readonly kind: "claim-acquired";
      readonly claim: DevSquadAdoClaimMetadata;
    }
  | { readonly kind: "claim-renewed"; readonly claim: DevSquadAdoClaimMetadata }
  | {
      readonly kind: "claim-released";
      readonly releasedClaim: {
        readonly ownerId: string;
        readonly fencingValue: number;
        readonly releasedAt: string;
      };
    };
export interface PersistedOperationReceiptV1 {
  readonly operationId: string;
  readonly operationKind: PersistedOperationKind;
  readonly requestDigest: string;
  readonly acceptedRevision: number;
  readonly acceptedAt: string;
  readonly outcome: PersistedOperationOutcomeV1;
}
export interface PersistedDevSquadAdoWorkflowRecordV1 {
  readonly kind: typeof RECORD_KIND;
  readonly schemaVersion: 1;
  readonly workItemId: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly workflow: { readonly phase: string; readonly status: string };
  readonly execution: {
    readonly branch: string | null;
    readonly worktreePath: string | null;
    readonly agent: PersistedReferenceHistoryV1;
    readonly session: PersistedReferenceHistoryV1;
  };
  readonly pullRequest: {
    readonly id: string | null;
    readonly url: string | null;
  };
  readonly observations: {
    readonly workItemCommentId: string | null;
    readonly pullRequest: DevSquadAdoPullRequestCursor | null;
  };
  readonly checkpoints: readonly PersistedCheckpointV1[];
  readonly claim: {
    readonly fencingCounter: number;
    readonly active: PersistedActiveClaimV1 | null;
  };
  readonly operations: readonly PersistedOperationReceiptV1[];
  readonly previousGenerationDigest: string | null;
  readonly integrity: { readonly algorithm: "sha256"; readonly digest: string };
}

export interface LedgerManifestV1 {
  readonly kind: typeof LEDGER_KIND;
  readonly schemaVersion: 1;
  readonly createdAt: string;
}

export class PersistedSchemaFailure {
  readonly _tag = "PersistedSchemaFailure";
  constructor(
    readonly kind: "corrupt-artifact" | "unsupported-schema-version",
    readonly schemaVersion?: number,
  ) {}
}

const persistedAssert = (condition: boolean): void => {
  if (!condition) throw new PersistedSchemaFailure("corrupt-artifact");
};
const persistedObject = (
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> => {
  persistedAssert(isObject(value));
  const object = value as Record<string, unknown>;
  persistedAssert(
    Object.keys(object).length === keys.length && hasExactKeys(object, keys),
  );
  return object;
};
const persistedString = (value: unknown, max: number): string => {
  persistedAssert(
    typeof value === "string" &&
      value.trim().length > 0 &&
      !CONTROL.test(value) &&
      utf8Length(value) <= max,
  );
  return value as string;
};
const persistedTimestamp = (value: unknown): string => {
  persistedAssert(typeof value === "string" && UTC_MILLISECONDS.test(value));
  const date = new Date(value as string);
  persistedAssert(
    Number.isFinite(date.getTime()) && date.toISOString() === value,
  );
  return value as string;
};
const persistedPositive = (value: unknown): number => {
  persistedAssert(Number.isSafeInteger(value) && (value as number) > 0);
  return value as number;
};
const persistedNonnegative = (value: unknown): number => {
  persistedAssert(Number.isSafeInteger(value) && (value as number) >= 0);
  return value as number;
};

const validatePersistedState = (value: unknown): void => {
  const object = persistedObject(value, ["phase", "status"]);
  persistedString(object.phase, 256);
  persistedString(object.status, 256);
};
const validatePersistedActivation = (
  value: unknown,
): PersistedReferenceActivationV1 => {
  const object = persistedObject(value, ["id", "revision", "activatedAt"]);
  return {
    id: persistedString(object.id, 256),
    revision: persistedPositive(object.revision),
    activatedAt: persistedTimestamp(object.activatedAt),
  };
};
const validatePersistedReference = (
  value: unknown,
  revision: number,
): PersistedReferenceHistoryV1 => {
  const object = persistedObject(value, ["current", "history"]);
  persistedAssert(
    object.current === null || typeof object.current === "string",
  );
  if (object.current !== null) persistedString(object.current, 256);
  persistedAssert(
    Array.isArray(object.history) &&
      object.history.length <= MAX_REFERENCE_HISTORY,
  );
  const history = (object.history as unknown[]).map(
    validatePersistedActivation,
  );
  for (let index = 0; index < history.length; index++) {
    persistedAssert(
      history[index]!.revision <= revision &&
        (index === 0 ||
          history[index - 1]!.revision < history[index]!.revision),
    );
  }
  if (object.current !== null)
    persistedAssert(
      history.length > 0 && history.at(-1)!.id === object.current,
    );
  return { current: object.current as string | null, history };
};
const validatePersistedCheckpoint = (value: unknown): PersistedCheckpointV1 => {
  const object = persistedObject(value, [
    "revision",
    "operationId",
    "acceptedAt",
    "previous",
    "resulting",
  ]);
  validatePersistedState(object.previous);
  validatePersistedState(object.resulting);
  return {
    revision: persistedPositive(object.revision),
    operationId: persistedString(object.operationId, 256),
    acceptedAt: persistedTimestamp(object.acceptedAt),
    previous: object.previous as DevSquadAdoCheckpointEntry["previous"],
    resulting: object.resulting as DevSquadAdoCheckpointEntry["resulting"],
  };
};
const validatePersistedClaimMetadata = (
  value: unknown,
  workItemId: string,
): DevSquadAdoClaimMetadata => {
  const object = persistedObject(value, [
    "workItemId",
    "ownerId",
    "fencingValue",
    "acquiredAt",
    "heartbeatAt",
    "expiresAt",
  ]);
  persistedAssert(object.workItemId === workItemId);
  return {
    workItemId,
    ownerId: persistedString(object.ownerId, 256),
    fencingValue: persistedPositive(object.fencingValue),
    acquiredAt: persistedTimestamp(object.acquiredAt),
    heartbeatAt: persistedTimestamp(object.heartbeatAt),
    expiresAt: persistedTimestamp(object.expiresAt),
  };
};
const validatePersistedReceipt = (
  value: unknown,
  workItemId: string,
): PersistedOperationReceiptV1 => {
  const object = persistedObject(value, [
    "operationId",
    "operationKind",
    "requestDigest",
    "acceptedRevision",
    "acceptedAt",
    "outcome",
  ]);
  const operationKind = object.operationKind;
  persistedAssert(
    operationKind === "initialize" ||
      operationKind === "checkpoint" ||
      operationKind === "acquire-claim" ||
      operationKind === "renew-claim" ||
      operationKind === "release-claim",
  );
  persistedAssert(
    typeof object.requestDigest === "string" &&
      HEX_64.test(object.requestDigest),
  );
  const acceptedRevision = persistedPositive(object.acceptedRevision);
  const acceptedAt = persistedTimestamp(object.acceptedAt);
  const outcome = persistedObject(
    object.outcome,
    operationKind === "initialize"
      ? ["kind"]
      : operationKind === "checkpoint"
        ? ["kind", "checkpoint"]
        : operationKind === "release-claim"
          ? ["kind", "releasedClaim"]
          : ["kind", "claim"],
  );
  if (operationKind === "initialize")
    persistedAssert(outcome.kind === "initialized");
  if (operationKind === "checkpoint") {
    persistedAssert(outcome.kind === "checkpointed");
    const checkpoint = validatePersistedCheckpoint(outcome.checkpoint);
    persistedAssert(
      checkpoint.revision === acceptedRevision &&
        checkpoint.operationId === object.operationId &&
        checkpoint.acceptedAt === acceptedAt,
    );
  }
  if (operationKind === "acquire-claim") {
    persistedAssert(outcome.kind === "claim-acquired");
    validatePersistedClaimMetadata(outcome.claim, workItemId);
  }
  if (operationKind === "renew-claim") {
    persistedAssert(outcome.kind === "claim-renewed");
    validatePersistedClaimMetadata(outcome.claim, workItemId);
  }
  if (operationKind === "release-claim") {
    persistedAssert(outcome.kind === "claim-released");
    const released = persistedObject(outcome.releasedClaim, [
      "ownerId",
      "fencingValue",
      "releasedAt",
    ]);
    persistedString(released.ownerId, 256);
    persistedPositive(released.fencingValue);
    persistedTimestamp(released.releasedAt);
  }
  return object as unknown as PersistedOperationReceiptV1;
};

export const canonicalJson = (value: unknown): string => {
  const normalize = (current: unknown): unknown => {
    if (Array.isArray(current)) return current.map(normalize);
    if (isObject(current))
      return Object.fromEntries(
        Object.keys(current)
          .sort()
          .map((key) => [key, normalize(current[key])]),
      );
    return current;
  };
  return JSON.stringify(normalize(value));
};

export const sha256Hex = (value: string | Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");
export const workItemStorageKey = (workItemId: string): string =>
  `wi-${sha256Hex(Buffer.from(workItemId, "utf8"))}`;
export const requestDigest = (
  operationKind: PersistedOperationKind,
  value: unknown,
): string =>
  sha256Hex(canonicalJson({ requestSchemaVersion: 1, operationKind, value }));
export const claimTokenVerifier = (token: string): string =>
  sha256Hex(Buffer.from(token, "base64url"));
export const verifierMatches = (token: string, verifier: string): boolean => {
  const actual = Buffer.from(claimTokenVerifier(token), "hex");
  const expected = Buffer.from(verifier, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

export const timestampFromDate = (date: Date): string => {
  const time = date.getTime();
  if (!Number.isFinite(time))
    throw new PersistedSchemaFailure("corrupt-artifact");
  return date.toISOString();
};

export const addLease = (now: Date, leaseDurationMs: number): string =>
  timestampFromDate(new Date(now.getTime() + leaseDurationMs));

export const serializeManifest = (manifest: LedgerManifestV1): string =>
  `${canonicalJson(manifest)}\n`;
export const parseManifest = (bytes: string): LedgerManifestV1 => {
  let value: unknown;
  try {
    value = JSON.parse(bytes);
  } catch {
    throw new PersistedSchemaFailure("corrupt-artifact");
  }
  const base = persistedObject(value, ["kind", "schemaVersion", "createdAt"]);
  persistedAssert(base.kind === LEDGER_KIND);
  if (base.schemaVersion !== SCHEMA_VERSION) {
    if (typeof base.schemaVersion === "number")
      throw new PersistedSchemaFailure(
        "unsupported-schema-version",
        base.schemaVersion,
      );
    throw new PersistedSchemaFailure("corrupt-artifact");
  }
  persistedTimestamp(base.createdAt);
  const manifest = base as unknown as LedgerManifestV1;
  persistedAssert(serializeManifest(manifest) === bytes);
  return manifest;
};

export const sealRecord = (
  record: Omit<PersistedDevSquadAdoWorkflowRecordV1, "integrity">,
): PersistedDevSquadAdoWorkflowRecordV1 => ({
  ...record,
  integrity: { algorithm: "sha256", digest: sha256Hex(canonicalJson(record)) },
});
export const serializeRecord = (
  record: PersistedDevSquadAdoWorkflowRecordV1,
): string => `${canonicalJson(record)}\n`;

export const parseRecord = (
  bytes: string,
  expectedWorkItemId: string,
  expectedRevision: number,
): PersistedDevSquadAdoWorkflowRecordV1 => {
  if (Buffer.byteLength(bytes, "utf8") > MAX_GENERATION_BYTES)
    throw new PersistedSchemaFailure("corrupt-artifact");
  let value: unknown;
  try {
    value = JSON.parse(bytes);
  } catch {
    throw new PersistedSchemaFailure("corrupt-artifact");
  }
  const object = persistedObject(value, [
    "kind",
    "schemaVersion",
    "workItemId",
    "revision",
    "createdAt",
    "updatedAt",
    "workflow",
    "execution",
    "pullRequest",
    "observations",
    "checkpoints",
    "claim",
    "operations",
    "previousGenerationDigest",
    "integrity",
  ]);
  persistedAssert(object.kind === RECORD_KIND);
  if (object.schemaVersion !== SCHEMA_VERSION) {
    if (typeof object.schemaVersion === "number")
      throw new PersistedSchemaFailure(
        "unsupported-schema-version",
        object.schemaVersion,
      );
    throw new PersistedSchemaFailure("corrupt-artifact");
  }
  persistedAssert(
    object.workItemId === expectedWorkItemId &&
      workItemStorageKey(expectedWorkItemId) ===
        workItemStorageKey(object.workItemId as string),
  );
  const revision = persistedPositive(object.revision);
  persistedAssert(revision === expectedRevision);
  const createdAt = persistedTimestamp(object.createdAt);
  const updatedAt = persistedTimestamp(object.updatedAt);
  validatePersistedState(object.workflow);
  const execution = persistedObject(object.execution, [
    "branch",
    "worktreePath",
    "agent",
    "session",
  ]);
  persistedAssert(
    execution.branch === null || typeof execution.branch === "string",
  );
  if (execution.branch !== null) persistedString(execution.branch, 1_024);
  persistedAssert(
    execution.worktreePath === null ||
      typeof execution.worktreePath === "string",
  );
  if (execution.worktreePath !== null)
    persistedAssert(
      validateWorktreePath(execution.worktreePath, "worktreePath").ok,
    );
  validatePersistedReference(execution.agent, revision);
  validatePersistedReference(execution.session, revision);
  const pullRequest = persistedObject(object.pullRequest, ["id", "url"]);
  persistedAssert(
    pullRequest.id === null || typeof pullRequest.id === "string",
  );
  if (pullRequest.id !== null) persistedString(pullRequest.id, 1_024);
  persistedAssert(
    pullRequest.url === null ||
      validatePullRequestUrl(pullRequest.url, "pullRequest.url").ok,
  );
  const observations = persistedObject(object.observations, [
    "workItemCommentId",
    "pullRequest",
  ]);
  persistedAssert(
    observations.workItemCommentId === null ||
      typeof observations.workItemCommentId === "string",
  );
  if (observations.workItemCommentId !== null)
    persistedString(observations.workItemCommentId, 1_024);
  if (observations.pullRequest !== null)
    persistedAssert(
      validateCursor(observations.pullRequest, "observations.pullRequest").ok,
    );
  persistedAssert(
    Array.isArray(object.checkpoints) &&
      object.checkpoints.length <= MAX_CHECKPOINTS,
  );
  const checkpoints = (object.checkpoints as unknown[]).map(
    validatePersistedCheckpoint,
  );
  for (let index = 0; index < checkpoints.length; index++)
    persistedAssert(
      checkpoints[index]!.revision <= revision &&
        (index === 0 ||
          checkpoints[index - 1]!.revision < checkpoints[index]!.revision),
    );
  const claim = persistedObject(object.claim, ["fencingCounter", "active"]);
  const fencingCounter = persistedNonnegative(claim.fencingCounter);
  if (claim.active !== null) {
    const active = persistedObject(claim.active, [
      "ownerId",
      "tokenVerifier",
      "fencingValue",
      "acquiredAt",
      "heartbeatAt",
      "expiresAt",
    ]);
    persistedString(active.ownerId, 256);
    persistedAssert(
      typeof active.tokenVerifier === "string" &&
        HEX_64.test(active.tokenVerifier),
    );
    persistedAssert(persistedPositive(active.fencingValue) <= fencingCounter);
    const acquiredAt = persistedTimestamp(active.acquiredAt);
    const heartbeatAt = persistedTimestamp(active.heartbeatAt);
    const expiresAt = persistedTimestamp(active.expiresAt);
    persistedAssert(acquiredAt <= heartbeatAt && heartbeatAt < expiresAt);
  }
  persistedAssert(
    Array.isArray(object.operations) &&
      object.operations.length <= MAX_OPERATIONS &&
      object.operations.length === revision,
  );
  const operations = (object.operations as unknown[]).map((receipt: unknown) =>
    validatePersistedReceipt(receipt, expectedWorkItemId),
  );
  const operationIds = new Set<string>();
  for (let index = 0; index < operations.length; index++) {
    const receipt = operations[index]!;
    persistedAssert(receipt.acceptedRevision === index + 1);
    persistedAssert(!operationIds.has(receipt.operationId));
    operationIds.add(receipt.operationId);
  }
  const checkpointReceipts = operations.filter(
    (receipt) => receipt.operationKind === "checkpoint",
  );
  persistedAssert(checkpointReceipts.length === checkpoints.length);
  for (let index = 0; index < checkpoints.length; index++) {
    const checkpoint = checkpoints[index]!;
    const receipt = checkpointReceipts[index]!;
    persistedAssert(
      receipt.outcome.kind === "checkpointed" &&
        checkpoint.revision === receipt.acceptedRevision &&
        checkpoint.operationId === receipt.operationId &&
        checkpoint.acceptedAt === receipt.acceptedAt &&
        (index === 0 ||
          (checkpoint.previous.phase ===
            checkpoints[index - 1]!.resulting.phase &&
            checkpoint.previous.status ===
              checkpoints[index - 1]!.resulting.status)),
    );
  }
  if (checkpoints.length > 0) {
    const latestState = checkpoints.at(-1)!.resulting;
    persistedAssert(
      latestState.phase === (object.workflow as { phase: string }).phase &&
        latestState.status === (object.workflow as { status: string }).status,
    );
  }
  const executionReferences = [
    validatePersistedReference(execution.agent, revision),
    validatePersistedReference(execution.session, revision),
  ];
  for (const reference of executionReferences) {
    for (const activation of reference.history) {
      const receipt = operations[activation.revision - 1];
      persistedAssert(
        receipt !== undefined &&
          (receipt.operationKind === "initialize" ||
            receipt.operationKind === "checkpoint") &&
          receipt.acceptedAt === activation.activatedAt,
      );
    }
  }
  persistedAssert(
    operations[0]?.operationKind === "initialize" &&
      createdAt === operations[0]?.acceptedAt &&
      updatedAt === operations.at(-1)?.acceptedAt,
  );
  persistedAssert(
    object.previousGenerationDigest === null
      ? revision === 1
      : revision > 1 &&
          typeof object.previousGenerationDigest === "string" &&
          HEX_64.test(object.previousGenerationDigest),
  );
  const integrity = persistedObject(object.integrity, ["algorithm", "digest"]);
  persistedAssert(
    integrity.algorithm === "sha256" &&
      typeof integrity.digest === "string" &&
      HEX_64.test(integrity.digest),
  );
  const withoutIntegrity = { ...object };
  delete withoutIntegrity.integrity;
  persistedAssert(
    sha256Hex(canonicalJson(withoutIntegrity)) === integrity.digest,
  );
  const record = object as unknown as PersistedDevSquadAdoWorkflowRecordV1;
  persistedAssert(serializeRecord(record) === bytes);
  return record;
};

export const publicRecord = (
  record: PersistedDevSquadAdoWorkflowRecordV1,
): DevSquadAdoWorkflowRecord => ({
  schemaVersion: 1,
  workItemId: record.workItemId,
  revision: record.revision,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  phase: record.workflow.phase,
  status: record.workflow.status,
  branch: record.execution.branch,
  worktreePath: record.execution.worktreePath,
  agent: {
    current: record.execution.agent.current,
    history: record.execution.agent.history.map((entry) => ({ ...entry })),
  },
  session: {
    current: record.execution.session.current,
    history: record.execution.session.history.map((entry) => ({ ...entry })),
  },
  pullRequest: { ...record.pullRequest },
  observations: {
    workItemCommentId: record.observations.workItemCommentId,
    pullRequest:
      record.observations.pullRequest === null
        ? null
        : { ...record.observations.pullRequest },
  },
  checkpoints: record.checkpoints.map((entry) => ({
    ...entry,
    previous: { ...entry.previous },
    resulting: { ...entry.resulting },
  })),
  activeClaim:
    record.claim.active === null
      ? null
      : {
          workItemId: record.workItemId,
          ownerId: record.claim.active.ownerId,
          fencingValue: record.claim.active.fencingValue,
          acquiredAt: record.claim.active.acquiredAt,
          heartbeatAt: record.claim.active.heartbeatAt,
          expiresAt: record.claim.active.expiresAt,
        },
  fencingCounter: record.claim.fencingCounter,
});
