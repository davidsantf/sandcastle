import type {
  CheckpointDevSquadAdoWorkflowInput,
  DevSquadAdoCheckpointEntry,
  DevSquadAdoWorkflowLedger,
  DevSquadAdoWorkflowRecord,
  DevSquadAdoLedgerResult,
} from "./DevSquadAdoWorkflowLedger.js";
import {
  canonicalJson,
  MAX_CHECKPOINTS,
  MAX_REFERENCE_HISTORY,
} from "./DevSquadAdoWorkflowLedgerSchema.js";

type ObjectValue = Record<string, unknown>;
const object = (v: unknown): v is ObjectValue =>
  typeof v === "object" && v !== null && !Array.isArray(v);

type Projector = (value: unknown) => unknown;
const scalar: Projector = (value) => {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return value;
  throw new Error("ledger-fault");
};
const fields =
  (shape: Readonly<Record<string, Projector>>): Projector =>
  (value) => {
    if (!object(value)) throw new Error("ledger-fault");
    const result: ObjectValue = {};
    // Enumerate our fixed schema, never the dependency's properties.
    for (const key of Object.keys(shape)) result[key] = shape[key]!(value[key]);
    return result;
  };
const nullableProjection =
  (project: Projector): Projector =>
  (value) =>
    value === null ? null : project(value);
const collection =
  (maximum: number, project: Projector): Projector =>
  (value) => {
    if (!Array.isArray(value)) throw new Error("ledger-fault");
    const length = value.length;
    if (!Number.isSafeInteger(length) || length < 0 || length > maximum)
      throw new Error("ledger-fault");
    const result: unknown[] = [];
    for (let index = 0; index < length; index++) {
      if (value.length !== length || result.length >= maximum)
        throw new Error("ledger-fault");
      const entry = project(value[index]);
      if (value.length !== length) throw new Error("ledger-fault");
      result.push(entry);
    }
    return result;
  };
const stateProjection = fields({ phase: scalar, status: scalar });
const claimFields = {
  workItemId: scalar,
  ownerId: scalar,
  fencingValue: scalar,
  acquiredAt: scalar,
  heartbeatAt: scalar,
  expiresAt: scalar,
};
const claimProjection = fields(claimFields);
const checkpointProjection = fields({
  revision: scalar,
  operationId: scalar,
  acceptedAt: scalar,
  previous: stateProjection,
  resulting: stateProjection,
});
const historyProjection = fields({
  current: scalar,
  history: collection(
    MAX_REFERENCE_HISTORY,
    fields({
      id: scalar,
      revision: scalar,
      activatedAt: scalar,
    }),
  ),
});
const recordProjection = fields({
  schemaVersion: scalar,
  workItemId: scalar,
  revision: scalar,
  createdAt: scalar,
  updatedAt: scalar,
  phase: scalar,
  status: scalar,
  branch: scalar,
  worktreePath: scalar,
  agent: historyProjection,
  session: historyProjection,
  pullRequest: fields({ id: scalar, url: scalar }),
  observations: fields({
    workItemCommentId: scalar,
    pullRequest: nullableProjection(
      fields({ threadId: scalar, commentId: scalar }),
    ),
  }),
  checkpoints: collection(MAX_CHECKPOINTS, checkpointProjection),
  activeClaim: nullableProjection(claimProjection),
  fencingCounter: scalar,
});
const errorProjection: Projector = (value) => {
  if (!object(value)) throw new Error("ledger-fault");
  const kind = scalar(value.kind);
  let project: Projector;
  switch (kind) {
    case "repository-not-found":
    case "repository-not-directory":
    case "unsupported-filesystem":
    case "record-not-found":
    case "record-already-exists":
    case "claim-not-held":
    case "claim-authorization":
    case "idempotency-conflict":
      project = fields({});
      break;
    case "validation":
      project = fields({ field: scalar, reason: scalar });
      break;
    case "path-boundary":
    case "unsupported-permissions":
    case "corrupt-artifact":
      project = fields({ artifact: scalar });
      break;
    case "claim-conflict":
      project = fields({ claim: claimProjection });
      break;
    case "claim-expired":
      project = fields({ expiredAt: scalar });
      break;
    case "stale-fencing":
      project = fields({ currentFencingValue: scalar });
      break;
    case "revision-conflict":
      project = fields({ expectedRevision: scalar, currentRevision: scalar });
      break;
    case "state-conflict":
      project = fields({ current: stateProjection });
      break;
    case "unsupported-schema-version":
      project = fields({ artifact: scalar, schemaVersion: scalar });
      break;
    case "capacity-exceeded":
      project = fields({ resource: scalar, limit: scalar });
      break;
    case "scan-limit":
      project = fields({ limit: scalar });
      break;
    case "contention":
      project = fields({ attempts: scalar });
      break;
    case "storage":
      project = fields({ outcome: scalar });
      break;
    default:
      throw new Error("ledger-fault");
  }
  const projected = project(value);
  if (!object(projected)) throw new Error("ledger-fault");
  projected.kind = kind;
  return projected;
};
const outcomeProjections = {
  initializeRecord: { kind: "initialized", project: fields({}) },
  acquireClaim: {
    kind: "claim-acquired",
    project: fields({
      authority: fields({ ...claimFields, claimToken: scalar }),
    }),
  },
  renewClaim: {
    kind: "claim-renewed",
    project: fields({ claim: claimProjection }),
  },
  checkpoint: {
    kind: "checkpointed",
    project: fields({ checkpoint: checkpointProjection }),
  },
  releaseClaim: {
    kind: "claim-released",
    project: fields({
      releasedClaim: fields({
        ownerId: scalar,
        fencingValue: scalar,
        releasedAt: scalar,
      }),
    }),
  },
};
const responseProjection = (method: Method, response: unknown): unknown => {
  if (!object(response)) throw new Error("ledger-fault");
  const ok = response.ok;
  if (ok === false) return { ok, error: errorProjection(response.error) };
  if (ok !== true) throw new Error("ledger-fault");
  if (method === "readRecord")
    return { ok, value: recordProjection(response.value) };
  const outcomeSchema = outcomeProjections[method];
  const value = fields({
    acceptedRevision: scalar,
    acceptedAt: scalar,
    replayed: scalar,
    record: recordProjection,
    outcome: (raw) => {
      if (!object(raw)) throw new Error("ledger-fault");
      const kind = raw.kind;
      if (kind !== outcomeSchema.kind) throw new Error("ledger-fault");
      const outcome = outcomeSchema.project(raw);
      if (!object(outcome)) throw new Error("ledger-fault");
      outcome.kind = kind;
      return outcome;
    },
  })(response.value);
  return { ok, value };
};
const integer = (v: unknown, minimum = 1): v is number =>
  Number.isSafeInteger(v) && (v as number) >= minimum;
const text = (v: unknown, maximum = 1024): v is string =>
  typeof v === "string" &&
  v.trim().length > 0 &&
  !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(v) &&
  Buffer.byteLength(v, "utf8") <= maximum;
const timestamp = (v: unknown): v is string =>
  typeof v === "string" &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString() === v;
const nullable = (v: unknown, check: (v: unknown) => boolean): boolean =>
  v === null || check(v);
const state = (v: unknown): v is ObjectValue =>
  object(v) && text(v.phase, 256) && text(v.status, 256);
const cursor = (v: unknown): boolean =>
  object(v) && text(v.threadId) && text(v.commentId);
const same = (a: unknown, b: unknown): boolean =>
  canonicalJson(a) === canonicalJson(b);
const claim = (v: unknown, id: string): v is ObjectValue =>
  object(v) &&
  v.workItemId === id &&
  text(v.ownerId, 256) &&
  integer(v.fencingValue) &&
  timestamp(v.acquiredAt) &&
  timestamp(v.heartbeatAt) &&
  timestamp(v.expiresAt) &&
  v.acquiredAt <= v.heartbeatAt &&
  v.heartbeatAt < v.expiresAt;
const checkpoint = (v: unknown): v is ObjectValue =>
  object(v) &&
  integer(v.revision) &&
  text(v.operationId, 256) &&
  timestamp(v.acceptedAt) &&
  state(v.previous) &&
  state(v.resulting);
const history = (v: unknown, revision: number): boolean => {
  if (
    !object(v) ||
    !nullable(v.current, (x) => text(x, 256)) ||
    !Array.isArray(v.history) ||
    v.history.length > MAX_REFERENCE_HISTORY
  )
    return false;
  let previous = 0;
  for (const entry of v.history) {
    if (
      !object(entry) ||
      !text(entry.id, 256) ||
      !integer(entry.revision) ||
      entry.revision <= previous ||
      entry.revision > revision ||
      !timestamp(entry.activatedAt)
    )
      return false;
    previous = entry.revision;
  }
  return (
    v.current === null ||
    (v.history.length > 0 && v.history[v.history.length - 1].id === v.current)
  );
};
const record = (v: unknown, id: string): v is ObjectValue => {
  if (
    !object(v) ||
    v.schemaVersion !== 1 ||
    v.workItemId !== id ||
    !integer(v.revision) ||
    !timestamp(v.createdAt) ||
    !timestamp(v.updatedAt) ||
    !state(v) ||
    !nullable(v.branch, text) ||
    !nullable(
      v.worktreePath,
      (x) =>
        text(x, 4096) &&
        (x.startsWith("/") ||
          /^[A-Za-z]:[\\/]/.test(x) ||
          /^\\\\[^\\/]+[\\/][^\\/]+/.test(x)),
    ) ||
    !history(v.agent, v.revision) ||
    !history(v.session, v.revision) ||
    !object(v.pullRequest) ||
    !nullable(v.pullRequest.id, text) ||
    !nullable(v.pullRequest.url, (x) => {
      if (!text(x, 4096)) return false;
      try {
        const url = new URL(x);
        return (
          ["http:", "https:"].includes(url.protocol) &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash
        );
      } catch {
        return false;
      }
    }) ||
    !object(v.observations) ||
    !nullable(v.observations.workItemCommentId, text) ||
    !nullable(v.observations.pullRequest, cursor) ||
    !integer(v.fencingCounter, 0) ||
    !nullable(v.activeClaim, (x) => claim(x, id)) ||
    !Array.isArray(v.checkpoints) ||
    v.checkpoints.length > MAX_CHECKPOINTS
  )
    return false;
  if (object(v.activeClaim) && v.activeClaim.fencingValue !== v.fencingCounter)
    return false;
  let previous = 0;
  let previousState: unknown;
  const operations = new Set<string>();
  for (const entry of v.checkpoints) {
    if (
      !checkpoint(entry) ||
      !integer(entry.revision) ||
      entry.revision <= previous ||
      entry.revision > v.revision ||
      operations.has(entry.operationId as string) ||
      (previousState !== undefined && !same(previousState, entry.previous))
    )
      return false;
    previous = entry.revision;
    operations.add(entry.operationId as string);
    previousState = entry.resulting;
  }
  return (
    previousState === undefined ||
    same(previousState, { phase: v.phase, status: v.status })
  );
};

const error = (v: unknown, id: string): boolean => {
  if (!object(v)) return false;
  switch (v.kind) {
    case "repository-not-found":
    case "repository-not-directory":
    case "unsupported-filesystem":
    case "record-not-found":
    case "record-already-exists":
    case "claim-not-held":
    case "claim-authorization":
    case "idempotency-conflict":
      return true;
    case "validation":
      return text(v.field) && text(v.reason, 4096);
    case "path-boundary":
    case "unsupported-permissions":
      return v.artifact === undefined || text(v.artifact, 4096);
    case "claim-conflict":
      return claim(v.claim, id);
    case "claim-expired":
      return timestamp(v.expiredAt);
    case "stale-fencing":
      return integer(v.currentFencingValue, 0);
    case "revision-conflict":
      return integer(v.expectedRevision) && integer(v.currentRevision);
    case "state-conflict":
      return state(v.current);
    case "corrupt-artifact":
      return text(v.artifact, 4096);
    case "unsupported-schema-version":
      return text(v.artifact, 4096) && integer(v.schemaVersion);
    case "capacity-exceeded":
      return (
        [
          "records",
          "operations",
          "checkpoints",
          "agent-history",
          "session-history",
          "generation-bytes",
        ].includes(v.resource as string) && integer(v.limit)
      );
    case "scan-limit":
      return integer(v.limit);
    case "contention":
      return integer(v.attempts);
    case "storage":
      return v.outcome === "unchanged" || v.outcome === "indeterminate";
    default:
      return false;
  }
};

type Method =
  | "initializeRecord"
  | "readRecord"
  | "acquireClaim"
  | "renewClaim"
  | "checkpoint"
  | "releaseClaim";
const valid = <T>(
  method: Method,
  input: unknown,
  result: unknown,
): result is DevSquadAdoLedgerResult<T> => {
  const request = object(input) ? input : { workItemId: input };
  const id = String(request.workItemId);
  if (!object(result)) return false;
  if (result.ok === false) {
    if (!error(result.error, id)) return false;
    const failure = result.error as ObjectValue;
    return (
      failure.kind !== "revision-conflict" ||
      !object(request.expected) ||
      failure.expectedRevision === request.expected.revision
    );
  }
  if (result.ok !== true) return false;
  const value = result.value;
  if (method === "readRecord") return record(value, id);
  if (
    !object(value) ||
    !record(value.record, id) ||
    !integer(value.acceptedRevision) ||
    !timestamp(value.acceptedAt) ||
    typeof value.replayed !== "boolean" ||
    !object(value.outcome)
  )
    return false;
  const latest = value.record;
  // W041: initialization may acknowledge revision one with a valid later record.
  // This exception must not relax nonreplayed checkpoint/claim/release guards.
  if (method === "initializeRecord") {
    if (
      value.outcome.kind !== "initialized" ||
      value.acceptedRevision !== 1 ||
      value.acceptedAt !== latest.createdAt
    )
      return false;
    const checkpoints = latest.checkpoints as ObjectValue[];
    const initial = checkpoints.length ? checkpoints[0]!.previous : latest;
    if (
      !object(initial) ||
      initial.phase !== request.phase ||
      initial.status !== request.status
    )
      return false;
    if (latest.revision !== 1) return true;
    return (
      latest.updatedAt === value.acceptedAt &&
      latest.branch === null &&
      latest.worktreePath === null &&
      same(latest.agent, { current: null, history: [] }) &&
      same(latest.session, { current: null, history: [] }) &&
      same(latest.pullRequest, { id: null, url: null }) &&
      same(latest.observations, {
        workItemCommentId: null,
        pullRequest: null,
      }) &&
      checkpoints.length === 0 &&
      latest.activeClaim === null &&
      latest.fencingCounter === 0
    );
  }
  const isLatestAcceptance = value.acceptedRevision === latest.revision;
  if (
    value.acceptedRevision > (latest.revision as number) ||
    (!value.replayed && !isLatestAcceptance) ||
    (isLatestAcceptance && value.acceptedAt !== latest.updatedAt)
  )
    return false;
  const outcome = value.outcome;
  const authority = object(request.authority) ? request.authority : request;
  if (method === "acquireClaim" || method === "renewClaim") {
    const acquired = method === "acquireClaim";
    const metadata = acquired ? outcome.authority : outcome.claim;
    if (
      outcome.kind !== (acquired ? "claim-acquired" : "claim-renewed") ||
      !claim(metadata, id) ||
      metadata.ownerId !== authority.ownerId ||
      (!acquired && metadata.fencingValue !== authority.fencingValue) ||
      (acquired && metadata.claimToken !== request.claimToken) ||
      metadata.heartbeatAt !== value.acceptedAt ||
      (acquired && metadata.acquiredAt !== value.acceptedAt) ||
      Date.parse(metadata.expiresAt as string) -
        Date.parse(value.acceptedAt) !==
        request.leaseDurationMs ||
      (metadata.fencingValue as number) > (latest.fencingCounter as number)
    )
      return false;
    if (isLatestAcceptance) {
      if (!claim(latest.activeClaim, id)) return false;
      if (acquired && metadata.fencingValue !== latest.fencingCounter)
        return false;
      for (const key of [
        "workItemId",
        "ownerId",
        "fencingValue",
        "acquiredAt",
        "heartbeatAt",
        "expiresAt",
      ])
        if (metadata[key] !== latest.activeClaim[key]) return false;
    }
    return true;
  }
  if (method === "releaseClaim") {
    const released = outcome.releasedClaim;
    return (
      outcome.kind === "claim-released" &&
      object(released) &&
      released.ownerId === authority.ownerId &&
      released.fencingValue === authority.fencingValue &&
      released.releasedAt === value.acceptedAt &&
      (released.fencingValue as number) <= (latest.fencingCounter as number) &&
      (!isLatestAcceptance ||
        (latest.activeClaim === null &&
          released.fencingValue === latest.fencingCounter))
    );
  }
  const entry = outcome.checkpoint;
  if (
    outcome.kind !== "checkpointed" ||
    !checkpoint(entry) ||
    entry.operationId !== request.operationId ||
    entry.revision !== value.acceptedRevision ||
    entry.acceptedAt !== value.acceptedAt ||
    !object(request.expected) ||
    value.acceptedRevision !== (request.expected.revision as number) + 1 ||
    !object(request.patch) ||
    !object(entry.previous) ||
    !object(entry.resulting) ||
    entry.previous.phase !== request.expected.phase ||
    entry.previous.status !== request.expected.status ||
    !same(entry.previous, entry.resulting)
  )
    return false;
  const durable = (latest.checkpoints as ObjectValue[]).find(
    (item) => item.operationId === request.operationId,
  );
  if (!same(durable, entry)) return false;
  if (isLatestAcceptance) {
    if (
      !claim(latest.activeClaim, id) ||
      latest.activeClaim.ownerId !== authority.ownerId ||
      latest.activeClaim.fencingValue !== authority.fencingValue ||
      latest.phase !== request.expected.phase ||
      latest.status !== request.expected.status ||
      !object(request.patch.observations) ||
      !object(latest.observations)
    )
      return false;
    for (const key of Object.keys(request.patch.observations)) {
      if (!same(request.patch.observations[key], latest.observations[key]))
        return false;
    }
  }
  return true;
};

/** Validate projected history with the same rules as a replay acknowledgement. */
export const isDevSquadAdoWatcherCheckpointHistoryValid = (
  request: CheckpointDevSquadAdoWorkflowInput,
  latest: DevSquadAdoWorkflowRecord,
  entry: DevSquadAdoCheckpointEntry,
): boolean =>
  valid("checkpoint", request, {
    ok: true,
    value: {
      acceptedRevision: entry.revision,
      acceptedAt: entry.acceptedAt,
      replayed: true,
      record: latest,
      outcome: { kind: "checkpointed", checkpoint: entry },
    },
  });

/** Guard all watcher-used ledger responses before trusting any payload. */
export const guardDevSquadAdoWatcherLedger = (
  ledger: DevSquadAdoWorkflowLedger,
): Pick<DevSquadAdoWorkflowLedger, Exclude<Method, "initializeRecord">> => {
  const guarded =
    <I, T>(
      method: Method,
      invoke: (input: I) => Promise<DevSquadAdoLedgerResult<T>>,
    ) =>
    async (input: I): Promise<DevSquadAdoLedgerResult<T>> => {
      // Neither the adapter nor pending watcher state shares the validation
      // snapshot. In-place request changes cannot redefine an acknowledgement.
      const expected = structuredClone(input);
      const supplied = structuredClone(expected);
      const response: unknown = await invoke(supplied);
      let result: unknown;
      try {
        result = responseProjection(method, response);
      } catch {
        // Only response inspection is guarded; unknown getters are never read.
        throw new Error("ledger-fault");
      }
      if (!same(expected, supplied) || !valid<T>(method, expected, result))
        throw new Error("ledger-fault");
      return result;
    };
  return {
    readRecord: guarded("readRecord", (input) => ledger.readRecord(input)),
    acquireClaim: guarded("acquireClaim", (input) =>
      ledger.acquireClaim(input),
    ),
    renewClaim: guarded("renewClaim", (input) => ledger.renewClaim(input)),
    checkpoint: guarded("checkpoint", (input) => ledger.checkpoint(input)),
    releaseClaim: guarded("releaseClaim", (input) =>
      ledger.releaseClaim(input),
    ),
  };
};

/** W041 / SEC-A02: separate original, validation, request copy and bounded response. */
export const guardDiscoveryInitializer =
  (
    ledger: DevSquadAdoWorkflowLedger,
  ): DevSquadAdoWorkflowLedger["initializeRecord"] =>
  async (input) => {
    const expected = {
      workItemId: input.workItemId,
      operationId: input.operationId,
      phase: input.phase,
      status: input.status,
    };
    const supplied = { ...expected };
    const response: unknown = await ledger.initializeRecord(supplied);
    const result = responseProjection("initializeRecord", response);
    for (const key of ["workItemId", "operationId", "phase", "status"] as const)
      if (supplied[key] !== expected[key]) throw Error("ledger-fault");
    for (const key of [
      "branch",
      "worktreePath",
      "agentId",
      "sessionId",
      "pullRequest",
      "observations",
    ] as const)
      if ((supplied as unknown as ObjectValue)[key] !== undefined)
        throw Error("ledger-fault");
    if (
      !valid<
        Awaited<
          ReturnType<DevSquadAdoWorkflowLedger["initializeRecord"]>
        > extends DevSquadAdoLedgerResult<infer T>
          ? T
          : never
      >("initializeRecord", expected, result)
    )
      throw Error("ledger-fault");
    return result;
  };
