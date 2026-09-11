import type {
  DevSquadAdoWorkflowRecord,
  DevSquadAdoWorkItemId,
} from "./DevSquadAdoWorkflowLedger.js";
// W048 / SEC-006: fixed-field projection follows the watcher guard exemplar,
// independently bounded before copying; no watcher execution graph is imported.
type ObjectValue = Record<string, unknown>;
const object = (v: unknown): v is ObjectValue =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const MAX_CHECKPOINTS = 10000;
const MAX_REFERENCE_HISTORY = 10000;
export const unicode = (v: string): boolean =>
  !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
    v,
  );
export const canonicalWorkItem = (
  value: DevSquadAdoWorkItemId,
): string | null => {
  if (typeof value === "number")
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  if (
    typeof value !== "string" ||
    value.length > 120 ||
    !unicode(value) ||
    value.normalize("NFC") !== value ||
    !value.trim() ||
    Buffer.byteLength(value, "utf8") > 120 ||
    /[\/\\\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value)
  )
    return null;
  return value;
};
export const isB32 = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[A-Za-z0-9_-]{43}$/.test(v) &&
  Buffer.from(v, "base64url").length === 32 &&
  Buffer.from(v, "base64url").toString("base64url") === v;
const integer = (v: unknown, minimum = 1): v is number =>
  Number.isSafeInteger(v) && (v as number) >= minimum;
const text = (v: unknown, maximum = 1024): v is string =>
  typeof v === "string" &&
  unicode(v) &&
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
  JSON.stringify(a) === JSON.stringify(b);
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

export function inspectDesignGateRecord(
  value: unknown,
  workItemId: string,
): DevSquadAdoWorkflowRecord | null {
  try {
    let bytes = 0;
    const charge = (count: number) => {
      bytes += count;
      if (bytes > 16 * 1024 * 1024) throw new Error("evidence-unavailable");
    };
    type Projector = (value: unknown) => unknown;
    const scalar: Projector = (value) => {
      if (typeof value === "string" && (value.length > 4096 || !unicode(value)))
        throw new Error("evidence-unavailable");
      if (value === undefined) throw new Error("evidence-unavailable");
      const serialized = JSON.stringify(value);
      if (typeof serialized !== "string" || serialized.length > 24578)
        throw new Error("evidence-unavailable");
      charge(Buffer.byteLength(serialized, "utf8"));
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
        const keys = Object.keys(shape);
        charge(2 + Math.max(0, keys.length - 1));
        for (const key of keys)
          charge(Buffer.byteLength(JSON.stringify(key), "utf8") + 1);
        // Enumerate our fixed schema, never the dependency's properties.
        for (const key of Object.keys(shape))
          result[key] = shape[key]!(value[key]);
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
        charge(2 + Math.max(0, length - 1));
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

    const projected = recordProjection(value);
    if (!record(projected, workItemId)) return null;
    return projected as unknown as DevSquadAdoWorkflowRecord;
  } catch {
    return null;
  }
}
