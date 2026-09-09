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
  | "observation-anchor-missing"
  | "pull-request-observation-unavailable"
  | "invalid-observation-identifier"
  | "cancelled";

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
 * ordered, or arithmetically compared.
 *
 * The seam's window is anchor-inclusive, so exactly three cases are
 * well-defined: an empty window has nothing new, an absent anchor makes every
 * entry new, and a located anchor makes everything after it new. A non-empty
 * window that omits a supplied anchor is the fourth case, and it is
 * **undecidable**: the watcher cannot tell "all of these are new" from "your
 * anchor aged out of the window". Treating it as the former silently
 * re-delivers the whole window, so it is reported as anchor loss and the
 * candidate fails closed instead.
 */
const selectNewEntries = <T>(
  anchor: T | null,
  entries: readonly T[],
  equals: (anchor: T, entry: T) => boolean,
):
  | { readonly ok: true; readonly value: readonly T[] }
  | { readonly ok: false; readonly reason: "anchor-missing" } => {
  if (entries.length === 0) return { ok: true, value: [] };
  if (anchor === null) return { ok: true, value: entries };
  const index = entries.findIndex((entry) => equals(anchor, entry));
  if (index < 0) return { ok: false, reason: "anchor-missing" };
  return { ok: true, value: entries.slice(index + 1) };
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
  // A cancelled pass is reported as cancellation rather than as an observation
  // fault: a seam that rejects because its signal aborted is not a broken seam,
  // and diagnosing it as `observation-failed` sends operators hunting a
  // transport problem that never happened.
  const aborted = (): boolean => request.signal?.aborted === true;

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
    return {
      ok: false,
      reason: aborted() ? "cancelled" : "observation-timeout",
    };
  if (workItemOutcome.kind === "rejected")
    return {
      ok: false,
      reason: aborted() ? "cancelled" : "observation-failed",
    };
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
      return {
        ok: false,
        reason: aborted() ? "cancelled" : "observation-timeout",
      };
    if (pullRequestOutcome.kind === "rejected")
      return {
        ok: false,
        reason: aborted() ? "cancelled" : "observation-failed",
      };
    const projected = projectPullRequestEntries(pullRequestOutcome.value);
    if (projected === null)
      return { ok: false, reason: "invalid-observation-identifier" };
    pullRequestEntries = projected;
  }

  const selectedWorkItemComments = selectNewEntries(
    record.observations.workItemCommentId,
    commentIds,
    (anchor, entry) => anchor === entry,
  );
  if (!selectedWorkItemComments.ok)
    return { ok: false, reason: "observation-anchor-missing" };
  const newWorkItemCommentIds = selectedWorkItemComments.value;

  const selectedPullRequestEntries = selectNewEntries(
    record.observations.pullRequest,
    pullRequestEntries,
    (anchor, entry) =>
      anchor.threadId === entry.threadId &&
      anchor.commentId === entry.commentId,
  );
  if (!selectedPullRequestEntries.ok)
    return { ok: false, reason: "observation-anchor-missing" };
  const newPullRequestEntries =
    selectedPullRequestEntries.value as readonly ProjectedPullRequestEntry[];

  // A kind is "skipped" only when nothing at all could be persisted for it.
  // Advancing to the newest complete entry and *also* reporting the kind as
  // skipped would make `cursorChanges` and `skippedCursorKinds` overlap and
  // claim two contradictory things about one kind in one outcome.
  const skippedCursorKinds: DevSquadAdoWatchObservationKind[] = [];
  let nextPullRequestCursor: DevSquadAdoPullRequestCursor | null = null;
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
  if (newPullRequestEntries.length > 0 && nextPullRequestCursor === null)
    skippedCursorKinds.push("pull-request-thread");

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
