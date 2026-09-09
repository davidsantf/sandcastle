import type {
  DevSquadAdoPullRequestCursor,
  DevSquadAdoWorkflowRecord,
} from "./DevSquadAdoWorkflowLedger.js";
import type {
  DevSquadAdoWatchObservationKind,
  DevSquadAdoWatcherObservationSeam,
  DevSquadAdoWatcherPullRequestObservation,
  DevSquadAdoWatcherWorkItemObservation,
} from "./DevSquadAdoWorkflowWatcher.js";
import { MAX_OBSERVATION_IDENTIFIER_BYTES } from "./DevSquadAdoWorkflowWatcherValidation.js";

const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;

/** Stable reasons an observation attempt failed for one candidate. */
export type DevSquadAdoWatcherObservationFailure =
  | "observation-failed"
  | "observation-timeout"
  | "pull-request-observation-unavailable"
  | "invalid-observation-identifier";

/** Projected, cursor-anchored view of one candidate's new external activity. */
export interface DevSquadAdoWatcherObservationSelection {
  /** Work-item comment identifiers newer than the persisted cursor. */
  readonly newWorkItemCommentIds: readonly string[];
  /** Next durable work-item comment cursor, or null when nothing advanced. */
  readonly nextWorkItemCommentId: string | null;
  /** Count of pull-request entries newer than the persisted cursor. */
  readonly newPullRequestEntryCount: number;
  /** Next durable pull-request cursor, or null when nothing persistable. */
  readonly nextPullRequestCursor: DevSquadAdoPullRequestCursor | null;
  /** Observation kinds observed but not persistable as a cursor. */
  readonly skippedCursorKinds: readonly DevSquadAdoWatchObservationKind[];
}

/** Successful projection or a stable per-candidate observation failure. */
export type DevSquadAdoWatcherObservationOutcome =
  | {
      /** Success discriminator. */
      readonly ok: true;
      /** Projected new-event selection. */
      readonly value: DevSquadAdoWatcherObservationSelection;
    }
  | {
      /** Failure discriminator. */
      readonly ok: false;
      /** Stable per-candidate observation failure reason. */
      readonly reason: DevSquadAdoWatcherObservationFailure;
    };

/** Everything one candidate observation needs from the pass. */
export interface DevSquadAdoWatcherObservationRequest {
  /** Injected read-oriented observation seam. */
  readonly seam: DevSquadAdoWatcherObservationSeam;
  /** Durable record read at the start of this candidate step. */
  readonly record: DevSquadAdoWorkflowRecord;
  /** Per-observation timeout in milliseconds. */
  readonly observationTimeoutMs: number;
  /** Injected delay source used to arm the observation timeout. */
  readonly delay: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Cooperative cancellation signal propagated to the seam. */
  readonly signal?: AbortSignal;
}

type RaceOutcome<T> =
  | { readonly kind: "value"; readonly value: T }
  | { readonly kind: "rejected" }
  | { readonly kind: "timeout" };

const raceObservation = async <T>(
  invoke: () => Promise<T>,
  request: DevSquadAdoWatcherObservationRequest,
): Promise<RaceOutcome<T>> => {
  let work: Promise<T>;
  try {
    work = Promise.resolve(invoke());
  } catch {
    return { kind: "rejected" };
  }
  let settled = false;
  const observed: Promise<RaceOutcome<T>> = work.then(
    (value) => {
      settled = true;
      return { kind: "value", value } as const;
    },
    () => {
      settled = true;
      return { kind: "rejected" } as const;
    },
  );

  // The timeout is armed on its own signal so a settled observation can retire
  // it immediately instead of leaving the host's timer pending for the whole
  // configured timeout.
  const timeoutSignal = new AbortController();
  const forwardAbort = (): void => timeoutSignal.abort();
  if (request.signal !== undefined) {
    if (request.signal.aborted) timeoutSignal.abort();
    else request.signal.addEventListener("abort", forwardAbort, { once: true });
  }

  // The delay is caller-supplied and no more trusted than the seam itself, so
  // a synchronous throw is treated exactly like a rejected delay: the bound
  // cannot be armed, so the observation is never allowed to run unbounded and
  // no untyped error escapes the pass.
  const armTimeout = (): Promise<RaceOutcome<T>> => {
    try {
      return Promise.resolve(
        request.delay(request.observationTimeoutMs, timeoutSignal.signal),
      ).then(
        () => ({ kind: "timeout" }) as const,
        () => ({ kind: "timeout" }) as const,
      );
    } catch {
      return Promise.resolve({ kind: "timeout" } as const);
    }
  };

  try {
    const winner = await Promise.race([observed, armTimeout()]);
    if (winner.kind !== "timeout") return winner;
    return settled ? await observed : winner;
  } finally {
    timeoutSignal.abort();
    request.signal?.removeEventListener("abort", forwardAbort);
  }
};

const isIdentifier = (value: unknown): value is string =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  !CONTROL.test(value) &&
  Buffer.byteLength(value, "utf8") <= MAX_OBSERVATION_IDENTIFIER_BYTES;

/** A pull-request entry projected down to identifier fields only. */
interface ProjectedPullRequestEntry {
  readonly threadId: string;
  readonly commentId: string | null;
}

const projectWorkItemComments = (
  response: DevSquadAdoWatcherWorkItemObservation,
): readonly string[] | null => {
  if (typeof response !== "object" || response === null) return null;
  const ids: unknown = response.commentIds;
  if (!Array.isArray(ids)) return null;
  const projected: string[] = [];
  for (const entry of ids as readonly unknown[]) {
    if (!isIdentifier(entry)) return null;
    projected.push(entry);
  }
  return projected;
};

const projectPullRequestEntries = (
  response: DevSquadAdoWatcherPullRequestObservation,
): readonly ProjectedPullRequestEntry[] | null => {
  if (typeof response !== "object" || response === null) return null;
  const entries: unknown = response.entries;
  if (!Array.isArray(entries)) return null;
  const projected: ProjectedPullRequestEntry[] = [];
  for (const entry of entries as readonly unknown[]) {
    if (typeof entry !== "object" || entry === null) return null;
    const threadId: unknown = (entry as Record<string, unknown>).threadId;
    if (!isIdentifier(threadId)) return null;
    const rawCommentId: unknown = (entry as Record<string, unknown>).commentId;
    if (rawCommentId === undefined || rawCommentId === null) {
      projected.push({ threadId, commentId: null });
      continue;
    }
    if (typeof rawCommentId !== "string") return null;
    if (rawCommentId.trim().length === 0) {
      projected.push({ threadId, commentId: null });
      continue;
    }
    if (!isIdentifier(rawCommentId)) return null;
    projected.push({ threadId, commentId: rawCommentId });
  }
  return projected;
};

/**
 * Select entries newer than the persisted anchor using the seam's ordering.
 *
 * The anchor is compared by exact equality only; no identifier is parsed,
 * ordered, or arithmetically compared. When the anchor is absent from the
 * returned list, the seam returned post-cursor entries only and every entry is
 * new.
 */
const selectNewEntries = <T>(
  anchor: T | null,
  entries: readonly T[],
  equals: (anchor: T, entry: T) => boolean,
): readonly T[] => {
  if (entries.length === 0) return [];
  if (anchor === null) return entries;
  const last = entries[entries.length - 1] as T;
  if (equals(anchor, last)) return [];
  const index = entries.findIndex((entry) => equals(anchor, entry));
  if (index >= 0) return entries.slice(index + 1);
  return entries;
};

/**
 * Invoke the seam for one candidate, project responses to opaque identifiers,
 * and select the entries newer than the persisted cursors.
 *
 * Only identifier fields are read from a seam response; every other property
 * is discarded at projection and can never reach durable state, results,
 * errors, or diagnostics.
 */
export const observeDevSquadAdoWatchCandidate = async (
  request: DevSquadAdoWatcherObservationRequest,
): Promise<DevSquadAdoWatcherObservationOutcome> => {
  const record = request.record;
  const workItemOutcome = await raceObservation(
    () =>
      request.seam.observeWorkItemComments({
        workItemId: record.workItemId,
        sinceCommentId: record.observations.workItemCommentId,
        signal: request.signal,
      }),
    request,
  );
  if (workItemOutcome.kind === "timeout")
    return { ok: false, reason: "observation-timeout" };
  if (workItemOutcome.kind === "rejected")
    return { ok: false, reason: "observation-failed" };
  const commentIds = projectWorkItemComments(workItemOutcome.value);
  if (commentIds === null)
    return { ok: false, reason: "invalid-observation-identifier" };

  let pullRequestEntries: readonly ProjectedPullRequestEntry[] = [];
  const pullRequestId = record.pullRequest.id;
  if (pullRequestId !== null) {
    const observePullRequestActivity = request.seam.observePullRequestActivity;
    if (typeof observePullRequestActivity !== "function")
      return { ok: false, reason: "pull-request-observation-unavailable" };
    const pullRequestOutcome = await raceObservation(
      () =>
        observePullRequestActivity({
          workItemId: record.workItemId,
          pullRequestId,
          sinceCursor: record.observations.pullRequest,
          signal: request.signal,
        }),
      request,
    );
    if (pullRequestOutcome.kind === "timeout")
      return { ok: false, reason: "observation-timeout" };
    if (pullRequestOutcome.kind === "rejected")
      return { ok: false, reason: "observation-failed" };
    const projected = projectPullRequestEntries(pullRequestOutcome.value);
    if (projected === null)
      return { ok: false, reason: "invalid-observation-identifier" };
    pullRequestEntries = projected;
  }

  const newWorkItemCommentIds = selectNewEntries(
    record.observations.workItemCommentId,
    commentIds,
    (anchor, entry) => anchor === entry,
  );
  const newPullRequestEntries = selectNewEntries(
    record.observations.pullRequest,
    pullRequestEntries,
    (anchor, entry) =>
      anchor.threadId === entry.threadId &&
      anchor.commentId === entry.commentId,
  ) as readonly ProjectedPullRequestEntry[];

  const skippedCursorKinds: DevSquadAdoWatchObservationKind[] = [];
  let nextPullRequestCursor: DevSquadAdoPullRequestCursor | null = null;
  if (newPullRequestEntries.length > 0) {
    const last = newPullRequestEntries[
      newPullRequestEntries.length - 1
    ] as ProjectedPullRequestEntry;
    if (last.commentId === null) skippedCursorKinds.push("pull-request-thread");
    for (let index = newPullRequestEntries.length - 1; index >= 0; index--) {
      const entry = newPullRequestEntries[index] as ProjectedPullRequestEntry;
      if (entry.commentId !== null) {
        nextPullRequestCursor = {
          threadId: entry.threadId,
          commentId: entry.commentId,
        };
        break;
      }
    }
  }

  return {
    ok: true,
    value: {
      newWorkItemCommentIds,
      nextWorkItemCommentId:
        newWorkItemCommentIds.length > 0
          ? (newWorkItemCommentIds[newWorkItemCommentIds.length - 1] as string)
          : null,
      newPullRequestEntryCount: newPullRequestEntries.length,
      nextPullRequestCursor,
      skippedCursorKinds,
    },
  };
};

/** Anchor-rule selection exposed for focused unit assertions. */
export const selectDevSquadAdoWatcherNewEntries = selectNewEntries;
