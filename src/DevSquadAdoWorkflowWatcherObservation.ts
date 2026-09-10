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
  | "invalid-observation-window"
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
  invoke: (signal: AbortSignal) => Promise<T>,
  request: DevSquadAdoWatcherObservationRequest,
): Promise<RaceOutcome<T>> => {
  const child = new AbortController();
  const timer = new AbortController();
  let cancel!: () => void;
  const cancelled = new Promise<RaceOutcome<T>>((resolve) => {
    cancel = () => {
      child.abort();
      timer.abort();
      resolve({ kind: "timeout" });
    };
  });
  request.signal?.addEventListener("abort", cancel, { once: true });
  if (request.signal?.aborted) {
    cancel();
    request.signal.removeEventListener("abort", cancel);
    return { kind: "timeout" };
  }
  let work: Promise<T>;
  try {
    work = Promise.resolve(invoke(child.signal));
  } catch {
    child.abort();
    timer.abort();
    request.signal?.removeEventListener("abort", cancel);
    return { kind: "rejected" };
  }
  const observed: Promise<RaceOutcome<T>> = work.then(
    (value) => {
      return { kind: "value", value } as const;
    },
    () => {
      return { kind: "rejected" } as const;
    },
  );

  // The timeout is armed on its own signal so a settled observation can retire
  // it immediately instead of leaving the host's timer pending for the whole
  // configured timeout.

  // The delay is caller-supplied and no more trusted than the seam itself, so
  // a synchronous throw is treated exactly like a rejected delay: the bound
  // cannot be armed, so the observation is never allowed to run unbounded and
  // no untyped error escapes the pass.
  const armTimeout = (): Promise<RaceOutcome<T>> => {
    try {
      return Promise.resolve(
        request.delay(request.observationTimeoutMs, timer.signal),
      ).then(
        () => ({ kind: "timeout" }) as const,
        () => ({ kind: "timeout" }) as const,
      );
    } catch {
      return Promise.resolve({ kind: "timeout" } as const);
    }
  };

  try {
    return await Promise.race([observed, armTimeout(), cancelled]);
  } finally {
    child.abort();
    timer.abort();
    request.signal?.removeEventListener("abort", cancel);
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

const MAX_WINDOW_ENTRIES = 1_000;
const MAX_WINDOW_BYTES = 1_048_576;
type Projection<T> =
  | { readonly value: readonly T[] }
  | {
      readonly reason:
        | "invalid-observation-identifier"
        | "invalid-observation-window";
    };
const invalidIdentifier = { reason: "invalid-observation-identifier" } as const;
const invalidWindow = { reason: "invalid-observation-window" } as const;

// Reading only identifier-bearing fields avoids unrelated payload accessors.
// An unreadable collection or entry is a malformed window, not a raw exception.
const projectWindow = <T>(project: () => Projection<T>): Projection<T> => {
  try {
    return project();
  } catch {
    return invalidWindow;
  }
};

const projectWorkItemComments = (
  response: DevSquadAdoWatcherWorkItemObservation,
): Projection<string> => {
  if (typeof response !== "object" || response === null) return invalidWindow;
  const ids: unknown = response.commentIds;
  if (!Array.isArray(ids)) return invalidWindow;
  const length = ids.length;
  if (
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > MAX_WINDOW_ENTRIES
  )
    return invalidWindow;
  const projected: string[] = [];
  const seen = new Set<string>();
  let bytes = 0;
  for (let index = 0; index < length; index++) {
    if (ids.length !== length || projected.length >= MAX_WINDOW_ENTRIES)
      return invalidWindow;
    const entry: unknown = ids[index];
    if (ids.length !== length) return invalidWindow;
    if (!isIdentifier(entry)) return invalidIdentifier;
    bytes += Buffer.byteLength(entry, "utf8");
    if (bytes > MAX_WINDOW_BYTES || seen.has(entry)) return invalidWindow;
    seen.add(entry);
    projected.push(entry);
  }
  return { value: projected };
};

const projectPullRequestEntries = (
  response: DevSquadAdoWatcherPullRequestObservation,
): Projection<ProjectedPullRequestEntry> => {
  if (typeof response !== "object" || response === null) return invalidWindow;
  const entries: unknown = response.entries;
  if (!Array.isArray(entries)) return invalidWindow;
  const length = entries.length;
  if (
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > MAX_WINDOW_ENTRIES
  )
    return invalidWindow;
  const projected: ProjectedPullRequestEntry[] = [];
  const seen = new Set<string>();
  let bytes = 0;
  for (let index = 0; index < length; index++) {
    if (entries.length !== length || projected.length >= MAX_WINDOW_ENTRIES)
      return invalidWindow;
    const entry: unknown = entries[index];
    if (entries.length !== length) return invalidWindow;
    if (typeof entry !== "object" || entry === null) return invalidIdentifier;
    const threadId: unknown = (entry as Record<string, unknown>).threadId;
    if (entries.length !== length) return invalidWindow;
    if (!isIdentifier(threadId)) return invalidIdentifier;
    const rawCommentId: unknown = (entry as Record<string, unknown>).commentId;
    if (entries.length !== length) return invalidWindow;
    const commentId = rawCommentId ?? null;
    if (commentId !== null && !isIdentifier(commentId))
      return invalidIdentifier;
    bytes +=
      Buffer.byteLength(threadId, "utf8") +
      (commentId === null ? 0 : Buffer.byteLength(commentId as string, "utf8"));
    const key = JSON.stringify([threadId, commentId]);
    if (bytes > MAX_WINDOW_BYTES || seen.has(key)) return invalidWindow;
    seen.add(key);
    projected.push({ threadId, commentId: commentId as string | null });
  }
  return { value: projected };
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
    (signal) =>
      request.seam.observeWorkItemComments({
        workItemId: record.workItemId,
        sinceCommentId: record.observations.workItemCommentId,
        signal,
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
  if (aborted()) return { ok: false, reason: "cancelled" };
  const comments = projectWindow(() =>
    projectWorkItemComments(workItemOutcome.value),
  );
  if ("reason" in comments) return { ok: false, reason: comments.reason };
  const commentIds = comments.value;

  let pullRequestEntries: readonly ProjectedPullRequestEntry[] = [];
  const pullRequestId = record.pullRequest.id;
  if (pullRequestId !== null) {
    let observePullRequestActivity;
    try {
      observePullRequestActivity = request.seam.observePullRequestActivity;
    } catch {
      return { ok: false, reason: "observation-failed" };
    }
    if (typeof observePullRequestActivity !== "function")
      return { ok: false, reason: "pull-request-observation-unavailable" };
    const pullRequestOutcome = await raceObservation(
      (signal) =>
        observePullRequestActivity.call(request.seam, {
          workItemId: record.workItemId,
          pullRequestId,
          sinceCursor: structuredClone(record.observations.pullRequest),
          signal,
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
    const projected = projectWindow(() =>
      projectPullRequestEntries(pullRequestOutcome.value),
    );
    if (aborted()) return { ok: false, reason: "cancelled" };
    if ("reason" in projected) return { ok: false, reason: projected.reason };
    pullRequestEntries = projected.value;
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
