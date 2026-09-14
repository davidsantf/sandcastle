import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  DevSquadAdoPullRequestCursor,
  DevSquadAdoWorkflowLedger,
  DevSquadAdoWorkItemId,
} from "./DevSquadAdoWorkflowLedger.js";
import {
  canonicalizeWorkItemId,
  workItemStorageKey,
} from "./DevSquadAdoWorkflowLedgerSchema.js";
import {
  openTestDevSquadAdoWorkflowLedger,
  openTestDevSquadAdoWorkflowLedgerWithClock,
} from "./DevSquadAdoWorkflowLedgerTestSupport.js";
import type {
  DevSquadAdoWatcherObservationSeam,
  DevSquadAdoWatcherPullRequestObservation,
  DevSquadAdoWatcherPullRequestObservationInput,
  DevSquadAdoWatcherWorkItemObservation,
  DevSquadAdoWatcherWorkItemObservationInput,
} from "./DevSquadAdoWorkflowWatcher.js";
import { deriveDevSquadAdoWatcherOperationId } from "./DevSquadAdoWorkflowWatcher.js";

/** Identity of one work-item-comment-only cursor advance. */
export interface WatcherCommentAdvance {
  /** Caller-supplied stable pass identity. */
  readonly passId: string;
  /** Canonical ledger work-item identifier. */
  readonly workItemId: string;
  /** Persisted comment anchor the advance starts from. */
  readonly from: string | null;
  /** Comment cursor the advance persists. */
  readonly to: string;
}

/**
 * Derive the checkpoint operation identifier for one comment-only advance.
 *
 * Checkpoint identity is scoped to the advance it publishes, so a test that
 * asserts on the identifier has to name both ends of that advance.
 */
export const watcherCommentCheckpointOperationId = (
  advance: WatcherCommentAdvance,
): string =>
  deriveDevSquadAdoWatcherOperationId({
    step: "checkpoint",
    passId: advance.passId,
    workItemId: advance.workItemId,
    ordinal: 0,
    generation: {
      fromWorkItemCommentId: advance.from,
      fromPullRequest: null,
      toWorkItemCommentId: advance.to,
      toPullRequest: null,
    },
  });

/** One recorded observation-seam invocation. */
export interface RecordedSeamCall {
  /** Seam method that was invoked. */
  readonly method: "observeWorkItemComments" | "observePullRequestActivity";
  /** Canonical work-item identifier passed to the seam. */
  readonly workItemId: string;
  /** `since` argument supplied for this call. */
  readonly since: string | DevSquadAdoPullRequestCursor | null;
}

/** Write-shaped spies that must never be invoked by a watch pass. */
export interface RecordedSeamWrites {
  /** Names of write-shaped seam methods that were invoked. */
  readonly invoked: string[];
}

/** A recording observation seam plus its call and write ledgers. */
export interface RecordingWatcherSeam {
  /** Seam injected into the watch pass. */
  readonly seam: DevSquadAdoWatcherObservationSeam;
  /** Ordered record of every observation invocation. */
  readonly calls: RecordedSeamCall[];
  /** Write-shaped spies; `invoked` must stay empty. */
  readonly writes: RecordedSeamWrites;
}

/** Response factories backing a recording observation seam. */
export interface RecordingWatcherSeamScript {
  /** Work-item comment responses, by call index for that work item. */
  readonly comments?: (
    input: DevSquadAdoWatcherWorkItemObservationInput,
    callIndex: number,
  ) =>
    | DevSquadAdoWatcherWorkItemObservation
    | Promise<DevSquadAdoWatcherWorkItemObservation>;
  /** Pull-request activity responses, by call index for that work item. */
  readonly pullRequest?: (
    input: DevSquadAdoWatcherPullRequestObservationInput,
    callIndex: number,
  ) =>
    | DevSquadAdoWatcherPullRequestObservation
    | Promise<DevSquadAdoWatcherPullRequestObservation>;
  /** Omit the required work-item method to exercise seam-contract failures. */
  readonly omitWorkItemComments?: boolean;
  /** Omit the optional pull-request method. */
  readonly omitPullRequestActivity?: boolean;
}

/**
 * Build a recording observation seam.
 *
 * The seam carries write-shaped spies (`updateWorkItem`, `createComment`,
 * `completePullRequest`) so a test can assert the watcher never attempts an
 * external mutation.
 */
export const createRecordingWatcherSeam = (
  script: RecordingWatcherSeamScript = {},
): RecordingWatcherSeam => {
  const calls: RecordedSeamCall[] = [];
  const writes: RecordedSeamWrites = { invoked: [] };
  const perWorkItemComments = new Map<string, number>();
  const perWorkItemPullRequest = new Map<string, number>();

  const observeWorkItemComments = async (
    input: DevSquadAdoWatcherWorkItemObservationInput,
  ): Promise<DevSquadAdoWatcherWorkItemObservation> => {
    calls.push({
      method: "observeWorkItemComments",
      workItemId: input.workItemId,
      since: input.sinceCommentId,
    });
    const index = perWorkItemComments.get(input.workItemId) ?? 0;
    perWorkItemComments.set(input.workItemId, index + 1);
    if (script.comments === undefined) return { commentIds: [] };
    return await script.comments(input, index);
  };

  const observePullRequestActivity = async (
    input: DevSquadAdoWatcherPullRequestObservationInput,
  ): Promise<DevSquadAdoWatcherPullRequestObservation> => {
    calls.push({
      method: "observePullRequestActivity",
      workItemId: input.workItemId,
      since: input.sinceCursor,
    });
    const index = perWorkItemPullRequest.get(input.workItemId) ?? 0;
    perWorkItemPullRequest.set(input.workItemId, index + 1);
    if (script.pullRequest === undefined) return { entries: [] };
    return await script.pullRequest(input, index);
  };

  const record = (name: string) => (): never => {
    writes.invoked.push(name);
    throw new Error(`watcher invoked a write-shaped seam method: ${name}`);
  };

  const seam: Record<string, unknown> = {
    updateWorkItem: record("updateWorkItem"),
    createComment: record("createComment"),
    completePullRequest: record("completePullRequest"),
  };
  if (script.omitWorkItemComments !== true)
    seam.observeWorkItemComments = observeWorkItemComments;
  if (script.omitPullRequestActivity !== true)
    seam.observePullRequestActivity = observePullRequestActivity;

  return {
    seam: seam as unknown as DevSquadAdoWatcherObservationSeam,
    calls,
    writes,
  };
};

/** A scripted clock that records every reading. */
export interface DeterministicClock {
  /** Clock injected into the watch pass. */
  readonly clock: () => Date;
  /** Every reading taken, in order. */
  readonly readings: Date[];
}

/**
 * Build a clock returning a caller-scripted sequence of instants.
 *
 * Once the script is exhausted the final instant repeats, so an over-long pass
 * never introduces wall-clock nondeterminism.
 */
export const createDeterministicClock = (
  sequence: readonly (Date | string | number)[],
): DeterministicClock => {
  if (sequence.length === 0)
    throw new Error("createDeterministicClock requires a nonempty sequence");
  const instants = sequence.map((entry) => new Date(entry));
  const readings: Date[] = [];
  let index = 0;
  return {
    clock: () => {
      const chosen =
        index < instants.length
          ? (instants[index] as Date)
          : (instants[instants.length - 1] as Date);
      index += 1;
      const reading = new Date(chosen.getTime());
      readings.push(reading);
      return reading;
    },
    readings,
  };
};

/** Build a clock that advances by a fixed step on every reading. */
export const createSteppingClock = (
  start: string | number | Date,
  stepMs: number,
  count: number,
): DeterministicClock =>
  createDeterministicClock(
    Array.from(
      { length: count },
      (_unused, index) => new Date(new Date(start).getTime() + index * stepMs),
    ),
  );

/** One recorded delay request. */
export interface RecordedDelay {
  /** Milliseconds requested. */
  readonly ms: number;
  /** Zero-based index across every delay request. */
  readonly index: number;
  /** Whether the request armed an observation timeout or a between-poll wait. */
  readonly kind: "observation" | "backoff";
  /** One-based index of the poll that requested a between-poll wait. */
  readonly pollIndex: number | null;
}

/** A recording delay source that never waits on wall-clock time. */
export interface RecordingDelaySource {
  /** Delay injected into the watch pass. */
  readonly delay: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Every delay request, in order. */
  readonly requests: RecordedDelay[];
  /** Only the between-poll backoff requests. */
  readonly backoffs: () => readonly RecordedDelay[];
  /** Only the observation-timeout requests. */
  readonly observations: () => readonly RecordedDelay[];
}

/** Options controlling the recording delay source. */
export interface RecordingDelayOptions {
  /**
   * Per-observation timeout in milliseconds.
   *
   * Requests for exactly this duration are classified as observation timeouts;
   * every other request is a between-poll backoff.
   */
  readonly observationTimeoutMs?: number;
  /** Hook invoked synchronously when a delay is requested. */
  readonly onDelay?: (request: RecordedDelay) => void;
}

/**
 * Build a delay source that resolves on the next macrotask.
 *
 * Seam fakes settle through microtasks, so a settling observation always wins
 * its timeout race while a genuinely non-settling observation always loses it.
 * No request ever waits for the duration it asked for.
 */
export const createRecordingDelay = (
  options: RecordingDelayOptions = {},
): RecordingDelaySource => {
  const requests: RecordedDelay[] = [];
  let polls = 0;
  const delay = (ms: number, signal?: AbortSignal): Promise<void> => {
    const kind: "observation" | "backoff" =
      options.observationTimeoutMs !== undefined &&
      ms === options.observationTimeoutMs
        ? "observation"
        : "backoff";
    if (kind === "backoff") polls += 1;
    const request: RecordedDelay = {
      ms,
      index: requests.length,
      kind,
      pollIndex: kind === "backoff" ? polls : null,
    };
    requests.push(request);
    options.onDelay?.(request);
    return new Promise<void>((resolve) => {
      if (signal?.aborted === true) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, 0);
      const onAbort = (): void => {
        clearTimeout(timer);
        resolve();
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  };
  return {
    delay,
    requests,
    backoffs: () => requests.filter((request) => request.kind === "backoff"),
    observations: () =>
      requests.filter((request) => request.kind === "observation"),
  };
};

/** A never-settling seam response used to exercise observation timeouts. */
export const nonSettlingObservation = <T>(): Promise<T> =>
  new Promise<T>(() => {
    /* deliberately never settles */
  });

const repositories: string[] = [];

/** Create an isolated temporary repository root for a ledger fixture. */
export const makeWatcherRepository = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "devsquad-watcher-"));
  repositories.push(root);
  return root;
};

/** Remove every repository root created by {@link makeWatcherRepository}. */
export const cleanupWatcherRepositories = async (): Promise<void> => {
  await Promise.all(
    repositories
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
};

/** An isolated ledger opened beneath a temporary repository root. */
export interface WatcherLedgerFixture {
  /** Temporary repository root owning the ledger. */
  readonly repositoryRoot: string;
  /** Opened ledger handle. */
  readonly ledger: DevSquadAdoWorkflowLedger;
}

/**
 * Open an isolated ledger for watcher tests.
 *
 * The trusted test platform is used so the fixture is portable across the
 * platforms the production opener deliberately refuses. Supplying `now` makes
 * every ledger-generated timestamp, lease expiry, and fence deterministic.
 */
export const openWatcherLedger = async (
  repositoryRoot: string,
  now?: () => Date,
): Promise<DevSquadAdoWorkflowLedger> => {
  const opened =
    now === undefined
      ? await openTestDevSquadAdoWorkflowLedger({ repositoryRoot })
      : await openTestDevSquadAdoWorkflowLedgerWithClock(
          { repositoryRoot },
          now,
        );
  if (!opened.ok)
    throw new Error(`failed to open watcher ledger: ${opened.error.kind}`);
  return opened.value;
};

/** Create a temporary repository root and open an isolated ledger in it. */
export const createWatcherLedgerFixture = async (
  now?: () => Date,
): Promise<WatcherLedgerFixture> => {
  const repositoryRoot = await makeWatcherRepository();
  return {
    repositoryRoot,
    ledger: await openWatcherLedger(repositoryRoot, now),
  };
};

/** Description of one seeded durable record. */
export interface SeedWatcherRecordInput {
  /** Work item to seed. */
  readonly workItemId: DevSquadAdoWorkItemId;
  /** Target durable revision; must be 1 or at least 3. */
  readonly revision?: number;
  /** Caller-defined phase. */
  readonly phase: string;
  /** Caller-defined status. */
  readonly status: string;
  /** Opaque pull-request identifier. */
  readonly pullRequestId?: string;
  /** Minimized pull-request URL. */
  readonly pullRequestUrl?: string;
  /** Opaque work-item comment cursor. */
  readonly workItemCommentId?: string;
  /** Opaque pull-request thread/comment cursor. */
  readonly pullRequestCursor?: DevSquadAdoPullRequestCursor;
}

const seedToken = (): string => Buffer.alloc(32, 7).toString("base64url");

/**
 * Seed one durable record at a chosen revision, phase, status, and cursor.
 *
 * Every ledger mutation advances the revision by one, so a record is seeded by
 * initializing it, acquiring a claim, checkpointing until one mutation remains,
 * and releasing the claim. The record is left unclaimed.
 */
export const seedWatcherRecord = async (
  ledger: DevSquadAdoWorkflowLedger,
  input: SeedWatcherRecordInput,
): Promise<string> => {
  const canonical = canonicalizeWorkItemId(input.workItemId);
  if (!canonical.ok) throw new Error("seedWatcherRecord: invalid work item");
  const workItemId = canonical.value;
  const target = input.revision ?? 4;
  if (target !== 1 && target < 3)
    throw new Error("seedWatcherRecord: revision must be 1 or at least 3");

  const observations: {
    workItemCommentId?: string;
    pullRequest?: DevSquadAdoPullRequestCursor;
  } = {};
  if (input.workItemCommentId !== undefined)
    observations.workItemCommentId = input.workItemCommentId;
  if (input.pullRequestCursor !== undefined)
    observations.pullRequest = input.pullRequestCursor;

  const pullRequest: { id?: string; url?: string } = {};
  if (input.pullRequestId !== undefined) pullRequest.id = input.pullRequestId;
  if (input.pullRequestUrl !== undefined)
    pullRequest.url = input.pullRequestUrl;

  const initialized = await ledger.initializeRecord({
    workItemId,
    operationId: `seed-init-${workItemId}`,
    phase: input.phase,
    status: input.status,
    ...(Object.keys(pullRequest).length > 0 ? { pullRequest } : {}),
    ...(Object.keys(observations).length > 0 ? { observations } : {}),
  });
  if (!initialized.ok)
    throw new Error(`seedWatcherRecord: init ${initialized.error.kind}`);
  if (target === 1) return workItemId;

  const claimToken = seedToken();
  const acquired = await ledger.acquireClaim({
    workItemId,
    operationId: `seed-claim-${workItemId}`,
    ownerId: "seed-owner",
    claimToken,
    leaseDurationMs: 3_600_000,
  });
  if (!acquired.ok)
    throw new Error(`seedWatcherRecord: claim ${acquired.error.kind}`);
  const authority = {
    ownerId: acquired.value.outcome.authority.ownerId,
    claimToken: acquired.value.outcome.authority.claimToken,
    fencingValue: acquired.value.outcome.authority.fencingValue,
  };

  let revision = acquired.value.acceptedRevision;
  let sequence = 0;
  while (revision < target - 1) {
    sequence += 1;
    const checkpointed = await ledger.checkpoint({
      workItemId,
      operationId: `seed-checkpoint-${workItemId}-${String(sequence)}`,
      authority,
      expected: { revision, phase: input.phase, status: input.status },
      patch: { status: input.status },
    });
    if (!checkpointed.ok)
      throw new Error(
        `seedWatcherRecord: checkpoint ${checkpointed.error.kind}`,
      );
    revision = checkpointed.value.acceptedRevision;
  }

  const released = await ledger.releaseClaim({
    workItemId,
    operationId: `seed-release-${workItemId}`,
    authority,
  });
  if (!released.ok)
    throw new Error(`seedWatcherRecord: release ${released.error.kind}`);
  if (released.value.acceptedRevision !== target)
    throw new Error(
      `seedWatcherRecord: reached revision ${String(
        released.value.acceptedRevision,
      )}, expected ${String(target)}`,
    );
  return workItemId;
};

/** One raw durable ledger artifact. */
export interface RawLedgerArtifact {
  /** Path relative to the ledger root. */
  readonly path: string;
  /** Raw file contents. */
  readonly contents: string;
}

const walkArtifacts = async (
  root: string,
  prefix: string,
): Promise<RawLedgerArtifact[]> => {
  const found: RawLedgerArtifact[] = [];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const absolute = join(root, entry.name);
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...(await walkArtifacts(absolute, relative)));
      continue;
    }
    found.push({
      path: relative,
      contents: await readFile(absolute, "utf8"),
    });
  }
  return found;
};

/** Read every raw durable ledger artifact for leak scanning. */
export const readWatcherLedgerArtifacts = async (
  repositoryRoot: string,
): Promise<readonly RawLedgerArtifact[]> =>
  await walkArtifacts(join(repositoryRoot, ".sandcastle", "devsquad-ado"), "");

/** Absolute path of the highest durable generation for one seeded record. */
export const watcherRecordGenerationPath = async (
  repositoryRoot: string,
  workItemId: DevSquadAdoWorkItemId,
): Promise<string> => {
  const canonical = canonicalizeWorkItemId(workItemId);
  if (!canonical.ok)
    throw new Error("watcherRecordGenerationPath: invalid work item");
  const directory = join(
    repositoryRoot,
    ".sandcastle",
    "devsquad-ado",
    "records",
    workItemStorageKey(canonical.value),
  );
  const generations = (await readdir(directory))
    .filter((name) => name.endsWith(".json"))
    .sort();
  const highest = generations[generations.length - 1];
  if (highest === undefined)
    throw new Error("watcherRecordGenerationPath: no generation found");
  return join(directory, highest);
};

/**
 * Corrupt the highest durable generation of one seeded record.
 *
 * Recovery never falls back from a corrupt highest generation, so this makes
 * exactly one candidate unreadable while leaving every other record intact.
 */
export const corruptWatcherRecord = async (
  repositoryRoot: string,
  workItemId: DevSquadAdoWorkItemId,
): Promise<string> => {
  const path = await watcherRecordGenerationPath(repositoryRoot, workItemId);
  await writeFile(path, '{"kind":"devsquad-ado-workflow-record"', "utf8");
  return path;
};

/** Rewrite one record's persisted schema version to an unsupported value. */
export const setWatcherRecordSchemaVersion = async (
  repositoryRoot: string,
  workItemId: DevSquadAdoWorkItemId,
  schemaVersion: number,
): Promise<string> => {
  const path = await watcherRecordGenerationPath(repositoryRoot, workItemId);
  const value = JSON.parse(await readFile(path, "utf8")) as Record<
    string,
    unknown
  >;
  value.schemaVersion = schemaVersion;
  await writeFile(path, `${JSON.stringify(value)}\n`, "utf8");
  return path;
};
