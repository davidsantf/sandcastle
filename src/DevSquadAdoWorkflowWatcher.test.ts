import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  runDevSquadAdoWorkflowWatchPass,
  validateDevSquadAdoWorkflowWatchPassOptions,
} from "./DevSquadAdoWorkflowWatcher.js";
import type {
  DevSquadAdoWatchCandidateOutcome,
  DevSquadAdoWatchReasonCode,
  DevSquadAdoWatchStopReason,
  RunDevSquadAdoWorkflowWatchPassOptions,
} from "./DevSquadAdoWorkflowWatcher.js";
import { canonicalizeDevSquadAdoWatchCandidates } from "./DevSquadAdoWorkflowWatcherValidation.js";
import { selectDevSquadAdoWatcherNewEntries } from "./DevSquadAdoWorkflowWatcherObservation.js";
import {
  cleanupWatcherRepositories,
  createDeterministicClock,
  createRecordingDelay,
  createRecordingWatcherSeam,
  createWatcherLedgerFixture,
  readWatcherLedgerArtifacts,
  seedWatcherRecord,
  watcherCommentCheckpointOperationId,
} from "./DevSquadAdoWorkflowWatcherTestSupport.js";

const LEDGER_NOW = "2026-01-01T00:00:00.000Z";
const POLL_NOW = "2026-01-01T00:00:10.000Z";
const OBSERVATION_TIMEOUT_MS = 5_000;

/**
 * Success-criteria sweep scale.
 *
 * Every ledger mutation is a durable fsync-backed publication, so the
 * mutation-heavy sweeps run at a reduced default and reach the spec's stated
 * 1,000-trial scale under `SANDCASTLE_WATCHER_SWEEP=full`. The read-only
 * determinism sweep always runs at full scale.
 */
const FULL_SWEEP = process.env.SANDCASTLE_WATCHER_SWEEP === "full";
const REPEATED_PASS_TRIALS = 1_000;
const EXACTLY_ONCE_EVENTS = FULL_SWEEP ? 200 : 15;

const OUTCOME_KINDS = [
  "acted",
  "no-change",
  "intake-suppressed",
  "skipped",
  "failed",
] as const;

const REASON_CODES = [
  "new-work-item-comment",
  "new-pull-request-activity",
  "new-observations",
  "no-new-observations",
  "intake-rules-unmatched",
  "incomplete-pull-request-cursor",
  "record-not-found",
  "claim-conflict",
  "claim-expired",
  "claim-authorization",
  "stale-fencing",
  "revision-conflict",
  "state-conflict",
  "idempotency-conflict",
  "checkpoint-indeterminate",
  "observation-failed",
  "observation-timeout",
  "pull-request-observation-unavailable",
  "invalid-observation-identifier",
  "ledger-recovery",
  "ledger-capacity",
  "cancelled",
] as const;

const ledgerClock = (): Date => new Date(LEDGER_NOW);

const passOptions = (
  overrides: Partial<RunDevSquadAdoWorkflowWatchPassOptions> &
    Pick<RunDevSquadAdoWorkflowWatchPassOptions, "ledger" | "seam">,
): RunDevSquadAdoWorkflowWatchPassOptions => ({
  passId: "pass-1",
  ownerId: "watch-a",
  candidates: [137],
  intakeRules: { phases: ["implement"], statuses: ["ready"] },
  budgets: {
    maxPolls: 1,
    maxPollStartElapsedMs: 60_000,
    observationTimeoutMs: OBSERVATION_TIMEOUT_MS,
  },
  clock: createDeterministicClock([POLL_NOW]).clock,
  delay: createRecordingDelay({
    observationTimeoutMs: OBSERVATION_TIMEOUT_MS,
  }).delay,
  ...overrides,
});

const decisions = (
  outcomes: readonly DevSquadAdoWatchCandidateOutcome[],
): readonly {
  readonly workItemId: string;
  readonly kind: string;
  readonly reason: DevSquadAdoWatchReasonCode;
  readonly cursorChanges: readonly string[];
}[] =>
  outcomes.map((outcome) => ({
    workItemId: outcome.workItemId,
    kind: outcome.kind,
    reason: outcome.reason,
    cursorChanges: outcome.cursorChanges,
  }));

afterEach(cleanupWatcherRepositories);

describe("DevSquadAdoWorkflowWatcher validation", () => {
  it("[TEST-001][CC-015] rejects invalid configuration with stable field paths and no side effects", async () => {
    const fixture = await createWatcherLedgerFixture(ledgerClock);
    await seedWatcherRecord(fixture.ledger, {
      workItemId: 137,
      phase: "implement",
      status: "ready",
      workItemCommentId: "480",
    });
    const before = await fixture.ledger.readRecord(137);
    expect(before.ok).toBe(true);

    const cases: readonly {
      readonly label: string;
      readonly overrides: Partial<RunDevSquadAdoWorkflowWatchPassOptions>;
      readonly field: string;
    }[] = [
      { label: "blank owner", overrides: { ownerId: "   " }, field: "ownerId" },
      {
        label: "duplicate candidates",
        overrides: { candidates: [137, "137"] },
        field: "candidates[1]",
      },
      {
        label: "empty candidates",
        overrides: { candidates: [] },
        field: "candidates",
      },
      {
        label: "invalid work-item identifier",
        overrides: { candidates: ["../137"] },
        field: "candidates[0]",
      },
      {
        label: "zero maxPolls",
        overrides: {
          budgets: {
            maxPolls: 0,
            maxPollStartElapsedMs: 60_000,
            observationTimeoutMs: OBSERVATION_TIMEOUT_MS,
          },
        },
        field: "budgets.maxPolls",
      },
      {
        label: "non-positive duration budget",
        overrides: {
          budgets: {
            maxPolls: 1,
            maxPollStartElapsedMs: 0,
            observationTimeoutMs: OBSERVATION_TIMEOUT_MS,
          },
        },
        field: "budgets.maxPollStartElapsedMs",
      },
      {
        label: "non-finite observation timeout",
        overrides: {
          budgets: {
            maxPolls: 1,
            maxPollStartElapsedMs: 60_000,
            observationTimeoutMs: Number.POSITIVE_INFINITY,
          },
        },
        field: "budgets.observationTimeoutMs",
      },
      {
        label: "malformed intake phases",
        overrides: { intakeRules: { phases: [], statuses: ["ready"] } },
        field: "intakeRules.phases",
      },
      {
        label: "blank intake status",
        overrides: { intakeRules: { phases: ["implement"], statuses: [" "] } },
        field: "intakeRules.statuses[0]",
      },
      {
        label: "duplicate intake phase",
        overrides: {
          intakeRules: {
            phases: ["implement", "implement"],
            statuses: ["ready"],
          },
        },
        field: "intakeRules.phases[1]",
      },
      {
        label: "oversized lease",
        overrides: { lease: { leaseDurationMs: 86_400_001 } },
        field: "lease.leaseDurationMs",
      },
      {
        label: "renewal threshold at or above the lease",
        overrides: {
          lease: { leaseDurationMs: 60_000, renewalThresholdMs: 60_000 },
        },
        field: "lease.renewalThresholdMs",
      },
      {
        // The derived threshold is floored at one millisecond, so the lease is
        // the offending input; the caller never supplied a threshold.
        label: "lease too short for a derived renewal threshold",
        overrides: { lease: { leaseDurationMs: 1 } },
        field: "lease.leaseDurationMs",
      },
      {
        label: "backoff multiplier below one",
        overrides: { backoff: { multiplier: 0.5 } },
        field: "backoff.multiplier",
      },
      {
        label: "backoff ceiling below the base interval",
        overrides: { backoff: { baseIntervalMs: 5_000, maxIntervalMs: 100 } },
        field: "backoff.maxIntervalMs",
      },
      {
        label: "non-callable jitter",
        overrides: {
          backoff: { jitter: 7 as unknown as (a: number, b: number) => number },
        },
        field: "backoff.jitter",
      },
      {
        label: "blank pass identity",
        overrides: { passId: "" },
        field: "passId",
      },
      {
        label: "non-signal cancellation",
        overrides: { signal: {} as unknown as AbortSignal },
        field: "signal",
      },
    ];

    for (const testCase of cases) {
      const seam = createRecordingWatcherSeam();
      const outcome = await runDevSquadAdoWorkflowWatchPass(
        passOptions({
          ledger: fixture.ledger,
          seam: seam.seam,
          ...testCase.overrides,
        }),
      );
      expect(outcome, testCase.label).toMatchObject({
        ok: false,
        error: { kind: "validation", field: testCase.field },
      });
      if (!outcome.ok) expect(outcome.error.kind).toBe("validation");
      expect(seam.calls, testCase.label).toEqual([]);
      expect(seam.writes.invoked, testCase.label).toEqual([]);
    }

    const after = await fixture.ledger.readRecord(137);
    expect(after).toEqual(before);
  }, 60_000);

  it("[TEST-002][CC-016] reports seam-contract failures naming the missing method", async () => {
    const fixture = await createWatcherLedgerFixture(ledgerClock);
    await seedWatcherRecord(fixture.ledger, {
      workItemId: 137,
      phase: "implement",
      status: "ready",
      workItemCommentId: "480",
    });
    const before = await fixture.ledger.readRecord(137);

    const missing = createRecordingWatcherSeam({ omitWorkItemComments: true });
    expect(
      await runDevSquadAdoWorkflowWatchPass(
        passOptions({ ledger: fixture.ledger, seam: missing.seam }),
      ),
    ).toEqual({
      ok: false,
      error: {
        kind: "seam-contract",
        method: "observeWorkItemComments",
        reason: "missing",
      },
    });

    expect(
      await runDevSquadAdoWorkflowWatchPass(
        passOptions({
          ledger: fixture.ledger,
          seam: {
            observeWorkItemComments: 7,
          } as unknown as RunDevSquadAdoWorkflowWatchPassOptions["seam"],
        }),
      ),
    ).toEqual({
      ok: false,
      error: {
        kind: "seam-contract",
        method: "observeWorkItemComments",
        reason: "not-a-function",
      },
    });

    expect(
      await runDevSquadAdoWorkflowWatchPass(
        passOptions({
          ledger: fixture.ledger,
          seam: {
            observeWorkItemComments: () =>
              Promise.resolve({ commentIds: [] as readonly string[] }),
            observePullRequestActivity: 7,
          } as unknown as RunDevSquadAdoWorkflowWatchPassOptions["seam"],
        }),
      ),
    ).toEqual({
      ok: false,
      error: {
        kind: "seam-contract",
        method: "observePullRequestActivity",
        reason: "not-a-function",
      },
    });

    expect(missing.calls).toEqual([]);
    expect(await fixture.ledger.readRecord(137)).toEqual(before);
  }, 60_000);

  it("[TEST-001] exposes the same structural verdict through the public validator", async () => {
    const fixture = await createWatcherLedgerFixture(ledgerClock);
    const seam = createRecordingWatcherSeam();
    const valid = validateDevSquadAdoWorkflowWatchPassOptions(
      passOptions({ ledger: fixture.ledger, seam: seam.seam }),
    );
    expect(valid).toMatchObject({
      ok: true,
      value: {
        passId: "pass-1",
        ownerId: "watch-a",
        candidates: ["137"],
        leaseDurationMs: 60_000,
        renewalThresholdMs: 20_000,
        baseIntervalMs: 1_000,
        multiplier: 2,
        maxIntervalMs: 30_000,
      },
    });
    expect(
      validateDevSquadAdoWorkflowWatchPassOptions(
        passOptions({
          ledger: fixture.ledger,
          seam: seam.seam,
          ownerId: "\u0007owner",
        }),
      ),
    ).toMatchObject({
      ok: false,
      error: { kind: "validation", field: "ownerId" },
    });
  }, 30_000);
});

describe("DevSquadAdoWorkflowWatcher observation anchor rule", () => {
  it("[TEST-004] selects only post-anchor entries and fails closed when the anchor is gone", () => {
    const equals = (anchor: string, entry: string): boolean => anchor === entry;

    expect(
      selectDevSquadAdoWatcherNewEntries("b", ["a", "b", "c"], equals),
    ).toEqual({ ok: true, value: ["c"] });
    expect(
      selectDevSquadAdoWatcherNewEntries("c", ["a", "b", "c"], equals),
    ).toEqual({ ok: true, value: [] });
    expect(
      selectDevSquadAdoWatcherNewEntries(null, ["a", "b"], equals),
    ).toEqual({ ok: true, value: ["a", "b"] });
    expect(selectDevSquadAdoWatcherNewEntries("b", [], equals)).toEqual({
      ok: true,
      value: [],
    });

    // The seam's window is anchor-inclusive, so a non-empty window that does
    // not contain the anchor is undecidable: the watcher cannot tell "all of
    // these are new" from "the anchored entry aged out". Reporting every entry
    // as new would silently re-deliver the whole window, so this fails closed
    // instead and the candidate reports `observation-anchor-missing`.
    expect(selectDevSquadAdoWatcherNewEntries("b", ["a", "c"], equals)).toEqual(
      {
        ok: false,
        reason: "anchor-missing",
      },
    );
  });
});

describe("DevSquadAdoWorkflowWatcher candidate ordering", () => {
  it("[TEST-006] canonicalizes, deduplicates, and byte-orders candidates independently of input order", () => {
    const shuffles = [
      [9001, "42", 137, "\u00e9-work"],
      ["\u00e9-work", 137, 9001, "42"],
      ["42", "\u00e9-work", "9001", 137],
    ];
    const canonical = shuffles.map((input) => {
      const result = canonicalizeDevSquadAdoWatchCandidates(input);
      expect(result.ok).toBe(true);
      return result.ok ? result.value : [];
    });
    expect(canonical[0]).toEqual(["137", "42", "9001", "\u00e9-work"]);
    expect(canonical[1]).toEqual(canonical[0]);
    expect(canonical[2]).toEqual(canonical[0]);
  });
});

describe("DevSquadAdoWorkflowWatcher watch pass", () => {
  it("[TEST-004][CC-001][TEST-003][CC-003] turns one new comment into one durable cursor advance and one intake signal", async () => {
    const fixture = await createWatcherLedgerFixture(ledgerClock);
    await seedWatcherRecord(fixture.ledger, {
      workItemId: 137,
      revision: 4,
      phase: "implement",
      status: "ready",
      workItemCommentId: "480",
    });
    const seam = createRecordingWatcherSeam({
      comments: () => ({ commentIds: ["480", "481"] }),
    });
    const clock = createDeterministicClock([POLL_NOW, POLL_NOW]);

    const outcome = await runDevSquadAdoWorkflowWatchPass(
      passOptions({
        ledger: fixture.ledger,
        seam: seam.seam,
        clock: clock.clock,
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const result = outcome.value;
    expect(result.stopReason).toBe<DevSquadAdoWatchStopReason>(
      "candidates-resolved",
    );
    expect(result.polls).toBe(1);
    expect(result.counts).toEqual({
      examined: 1,
      eligible: 1,
      acted: 1,
      noChange: 0,
      suppressed: 0,
      skipped: 0,
      failed: 0,
    });
    expect(result.outcomes).toHaveLength(1);
    const candidate = result.outcomes[0];
    expect(candidate).toMatchObject({
      workItemId: "137",
      kind: "acted",
      reason: "new-work-item-comment",
      sourceRevision: 4,
      cursorChanges: ["work-item-comment"],
      skippedCursorKinds: [],
      ledgerErrorKind: null,
    });
    expect(candidate?.claim).toMatchObject({
      ownerId: "watch-a",
      fencingValue: 2,
    });

    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]).toMatchObject({
      workItemId: "137",
      sourceRevision: 4,
      changedKinds: ["work-item-comment"],
      phase: "implement",
      status: "ready",
    });

    // Acquiring the fenced claim consumes revision 5, so the checkpoint that
    // advances the cursor is accepted at revision 6 and the release lands at 7.
    const durable = await fixture.ledger.readRecord(137);
    expect(durable.ok).toBe(true);
    if (!durable.ok) return;
    expect(durable.value.observations.workItemCommentId).toBe("481");
    expect(durable.value.activeClaim).toBeNull();
    expect(candidate?.revision).toBe(6);
    expect(durable.value.revision).toBe(7);
    expect(
      durable.value.checkpoints.map((checkpoint) => checkpoint.revision),
    ).toContain(candidate?.revision);
    expect(
      durable.value.checkpoints.some(
        (checkpoint) =>
          checkpoint.operationId ===
          watcherCommentCheckpointOperationId({
            passId: "pass-1",
            workItemId: "137",
            from: "480",
            to: "481",
          }),
      ),
    ).toBe(true);

    expect(seam.calls).toEqual([
      {
        method: "observeWorkItemComments",
        workItemId: "137",
        since: "480",
      },
    ]);
    expect(seam.writes.invoked).toEqual([]);
    expect(clock.readings).toHaveLength(result.polls + 1);
  }, 60_000);

  it("[TEST-003][CC-003] calls only observation methods, at most once per candidate per poll per kind", async () => {
    const fixture = await createWatcherLedgerFixture(ledgerClock);
    for (const workItemId of [137, 42]) {
      await seedWatcherRecord(fixture.ledger, {
        workItemId,
        revision: 4,
        phase: "implement",
        status: "ready",
        workItemCommentId: "480",
        pullRequestId: "pr-1",
        pullRequestCursor: { threadId: "t-1", commentId: "c-1" },
      });
    }
    const seam = createRecordingWatcherSeam({
      comments: () => ({ commentIds: ["480"] }),
      pullRequest: () => ({ entries: [{ threadId: "t-1", commentId: "c-1" }] }),
    });

    const outcome = await runDevSquadAdoWorkflowWatchPass(
      passOptions({
        ledger: fixture.ledger,
        seam: seam.seam,
        candidates: [137, 42],
        budgets: {
          maxPolls: 3,
          maxPollStartElapsedMs: 600_000,
          observationTimeoutMs: OBSERVATION_TIMEOUT_MS,
        },
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.polls).toBe(3);
    expect(seam.writes.invoked).toEqual([]);
    expect(new Set(seam.calls.map((call) => call.method))).toEqual(
      new Set(["observeWorkItemComments", "observePullRequestActivity"]),
    );
    for (const workItemId of ["137", "42"]) {
      for (const method of [
        "observeWorkItemComments",
        "observePullRequestActivity",
      ] as const) {
        expect(
          seam.calls.filter(
            (call) => call.workItemId === workItemId && call.method === method,
          ),
          `${workItemId} ${method}`,
        ).toHaveLength(outcome.value.polls);
      }
    }
    for (const call of seam.calls) {
      if (call.method === "observeWorkItemComments") {
        expect(call.since).toBe("480");
      } else {
        expect(call.since).toEqual({ threadId: "t-1", commentId: "c-1" });
      }
    }
  }, 120_000);

  it("[TEST-005][CC-002] reports no-change and mutates nothing when durable state is unchanged", async () => {
    const fixture = await createWatcherLedgerFixture(ledgerClock);
    await seedWatcherRecord(fixture.ledger, {
      workItemId: 137,
      revision: 4,
      phase: "implement",
      status: "ready",
      workItemCommentId: "480",
    });
    const seam = createRecordingWatcherSeam({
      comments: () => ({ commentIds: ["480", "481"] }),
    });

    const first = await runDevSquadAdoWorkflowWatchPass(
      passOptions({ ledger: fixture.ledger, seam: seam.seam }),
    );
    expect(first).toMatchObject({ ok: true });
    const afterFirst = await fixture.ledger.readRecord(137);
    expect(afterFirst.ok).toBe(true);
    if (!afterFirst.ok) return;

    const replaySeam = createRecordingWatcherSeam({
      comments: () => ({ commentIds: ["480", "481"] }),
    });
    const replay = await runDevSquadAdoWorkflowWatchPass(
      passOptions({
        ledger: fixture.ledger,
        seam: replaySeam.seam,
        passId: "pass-2",
      }),
    );
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.value.signals).toEqual([]);
    expect(replay.value.stopReason).toBe("poll-budget-exhausted");
    expect(decisions(replay.value.outcomes)).toEqual([
      {
        workItemId: "137",
        kind: "no-change",
        reason: "no-new-observations",
        cursorChanges: [],
      },
    ]);
    expect(replay.value.counts).toMatchObject({
      examined: 1,
      eligible: 0,
      acted: 0,
      noChange: 1,
    });

    const afterReplay = await fixture.ledger.readRecord(137);
    expect(afterReplay).toEqual(afterFirst);
  }, 60_000);

  it("[TEST-014][CC-007] advances the cursor and suppresses intake when rules do not match", async () => {
    const fixture = await createWatcherLedgerFixture(ledgerClock);
    await seedWatcherRecord(fixture.ledger, {
      workItemId: 137,
      revision: 4,
      phase: "awaiting-approval",
      status: "ready",
      workItemCommentId: "481",
    });
    const seam = createRecordingWatcherSeam({
      comments: () => ({ commentIds: ["481", "482"] }),
    });

    const outcome = await runDevSquadAdoWorkflowWatchPass(
      passOptions({
        ledger: fixture.ledger,
        seam: seam.seam,
        intakeRules: { phases: ["implement", "review"], statuses: ["ready"] },
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.signals).toEqual([]);
    expect(decisions(outcome.value.outcomes)).toEqual([
      {
        workItemId: "137",
        kind: "intake-suppressed",
        reason: "intake-rules-unmatched",
        cursorChanges: ["work-item-comment"],
      },
    ]);
    expect(outcome.value.counts).toMatchObject({ suppressed: 1, eligible: 1 });

    const durable = await fixture.ledger.readRecord(137);
    expect(durable.ok).toBe(true);
    if (!durable.ok) return;
    expect(durable.value.observations.workItemCommentId).toBe("482");
    expect(durable.value.phase).toBe("awaiting-approval");
  }, 60_000);

  it("[TEST-014][CC-008] admits an unknown phase listed in caller intake rules", async () => {
    const fixture = await createWatcherLedgerFixture(ledgerClock);
    await seedWatcherRecord(fixture.ledger, {
      workItemId: 137,
      revision: 4,
      phase: "custom-security-gate",
      status: "waiting-for-host",
      workItemCommentId: "481",
    });
    const seam = createRecordingWatcherSeam({
      comments: () => ({ commentIds: ["481", "482"] }),
    });

    const outcome = await runDevSquadAdoWorkflowWatchPass(
      passOptions({
        ledger: fixture.ledger,
        seam: seam.seam,
        intakeRules: {
          phases: ["custom-security-gate"],
          statuses: ["waiting-for-host"],
        },
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.signals).toHaveLength(1);
    expect(outcome.value.signals[0]).toMatchObject({
      phase: "custom-security-gate",
      status: "waiting-for-host",
      changedKinds: ["work-item-comment"],
    });
    expect(outcome.value.outcomes[0]).toMatchObject({
      kind: "acted",
      reason: "new-work-item-comment",
    });
  }, 60_000);

  it("[TEST-015][CC-009] skips an uninitialized candidate without creating a record", async () => {
    const fixture = await createWatcherLedgerFixture(ledgerClock);
    const seam = createRecordingWatcherSeam();

    const outcome = await runDevSquadAdoWorkflowWatchPass(
      passOptions({
        ledger: fixture.ledger,
        seam: seam.seam,
        candidates: [999],
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(decisions(outcome.value.outcomes)).toEqual([
      {
        workItemId: "999",
        kind: "skipped",
        reason: "record-not-found",
        cursorChanges: [],
      },
    ]);
    expect(outcome.value.stopReason).toBe("candidates-resolved");
    expect(seam.calls).toEqual([]);
    expect(
      await readdir(
        join(fixture.repositoryRoot, ".sandcastle", "devsquad-ado", "records"),
      ),
    ).toEqual([]);
  }, 60_000);

  it("[TEST-022][CC-019] never persists a pull-request cursor without a comment identifier", async () => {
    const fixture = await createWatcherLedgerFixture(ledgerClock);
    await seedWatcherRecord(fixture.ledger, {
      workItemId: 137,
      revision: 4,
      phase: "implement",
      status: "ready",
      workItemCommentId: "480",
      pullRequestId: "481",
      pullRequestCursor: { threadId: "thread-12", commentId: "comment-29" },
    });
    const seam = createRecordingWatcherSeam({
      comments: () => ({ commentIds: ["480"] }),
      pullRequest: () => ({
        entries: [
          { threadId: "thread-12", commentId: "comment-29" },
          { threadId: "thread-13" },
        ],
      }),
    });

    const outcome = await runDevSquadAdoWorkflowWatchPass(
      passOptions({ ledger: fixture.ledger, seam: seam.seam }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.signals).toEqual([]);
    expect(outcome.value.outcomes[0]).toMatchObject({
      workItemId: "137",
      kind: "no-change",
      reason: "incomplete-pull-request-cursor",
      cursorChanges: [],
      skippedCursorKinds: ["pull-request-thread"],
    });

    const durable = await fixture.ledger.readRecord(137);
    expect(durable.ok).toBe(true);
    if (!durable.ok) return;
    expect(durable.value.observations.pullRequest).toEqual({
      threadId: "thread-12",
      commentId: "comment-29",
    });
    expect(durable.value.revision).toBe(4);
    expect(seam.calls.map((call) => call.method)).toEqual([
      "observeWorkItemComments",
      "observePullRequestActivity",
    ]);
  }, 60_000);

  it("[TEST-022][CC-019] advances to the newest complete pull-request entry without also reporting the kind as skipped", async () => {
    // FR-034 disjointness: a window that mixes complete and incomplete entries
    // must still publish a cursor (the newest *complete* entry), and must not
    // name `pull-request-thread` in both `cursorChanges` and
    // `skippedCursorKinds`. The all-incomplete case above is the only one where
    // the kind is legitimately skipped.
    const cases: readonly {
      readonly label: string;
      readonly entries: readonly {
        readonly threadId: string;
        readonly commentId?: string;
      }[];
      readonly expectedCursor: {
        readonly threadId: string;
        readonly commentId: string;
      };
    }[] = [
      {
        label: "newest entry incomplete, older new entry complete",
        entries: [
          { threadId: "thread-12", commentId: "comment-29" },
          { threadId: "thread-13", commentId: "comment-30" },
          { threadId: "thread-14" },
        ],
        expectedCursor: { threadId: "thread-13", commentId: "comment-30" },
      },
      {
        label: "incomplete entry followed by a newer complete entry",
        entries: [
          { threadId: "thread-12", commentId: "comment-29" },
          { threadId: "thread-13" },
          { threadId: "thread-14", commentId: "comment-31" },
        ],
        expectedCursor: { threadId: "thread-14", commentId: "comment-31" },
      },
    ];

    for (const testCase of cases) {
      const fixture = await createWatcherLedgerFixture(ledgerClock);
      await seedWatcherRecord(fixture.ledger, {
        workItemId: 137,
        revision: 4,
        phase: "implement",
        status: "ready",
        workItemCommentId: "480",
        pullRequestId: "481",
        pullRequestCursor: { threadId: "thread-12", commentId: "comment-29" },
      });
      const seam = createRecordingWatcherSeam({
        comments: () => ({ commentIds: ["480"] }),
        pullRequest: () => ({ entries: testCase.entries }),
      });

      const outcome = await runDevSquadAdoWorkflowWatchPass(
        passOptions({ ledger: fixture.ledger, seam: seam.seam }),
      );

      expect(outcome.ok, testCase.label).toBe(true);
      if (!outcome.ok) return;
      const candidate = outcome.value
        .outcomes[0] as DevSquadAdoWatchCandidateOutcome;
      expect(candidate, testCase.label).toMatchObject({
        workItemId: "137",
        kind: "acted",
        reason: "new-pull-request-activity",
        cursorChanges: ["pull-request-thread"],
        skippedCursorKinds: [],
      });

      // The disjointness clause itself: no kind may appear in both lists.
      const overlap = candidate.cursorChanges.filter((kind) =>
        candidate.skippedCursorKinds.includes(kind),
      );
      expect(overlap, testCase.label).toEqual([]);

      const durable = await fixture.ledger.readRecord(137);
      expect(durable.ok, testCase.label).toBe(true);
      if (!durable.ok) return;
      expect(durable.value.observations.pullRequest, testCase.label).toEqual(
        testCase.expectedCursor,
      );
      // Claim acquire/checkpoint/release each publish a revision, so assert
      // advancement rather than a bookkeeping-sensitive absolute value.
      expect(durable.value.revision, testCase.label).toBeGreaterThan(4);
      expect(outcome.value.signals.length, testCase.label).toBe(1);
    }
  }, 60_000);

  it("[TEST-003] reports a stable failure when a pull-request record has no observation method", async () => {
    const fixture = await createWatcherLedgerFixture(ledgerClock);
    await seedWatcherRecord(fixture.ledger, {
      workItemId: 137,
      revision: 4,
      phase: "implement",
      status: "ready",
      pullRequestId: "481",
    });
    const seam = createRecordingWatcherSeam({
      comments: () => ({ commentIds: [] }),
      omitPullRequestActivity: true,
    });

    const outcome = await runDevSquadAdoWorkflowWatchPass(
      passOptions({ ledger: fixture.ledger, seam: seam.seam }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.outcomes[0]).toMatchObject({
      kind: "failed",
      reason: "pull-request-observation-unavailable",
    });
  }, 60_000);

  it("[TEST-003] rejects a non-identifier observation payload without persisting anything", async () => {
    const fixture = await createWatcherLedgerFixture(ledgerClock);
    await seedWatcherRecord(fixture.ledger, {
      workItemId: 137,
      revision: 4,
      phase: "implement",
      status: "ready",
    });
    const seam = createRecordingWatcherSeam({
      comments: () =>
        ({ commentIds: [17] }) as unknown as { commentIds: readonly string[] },
    });

    const outcome = await runDevSquadAdoWorkflowWatchPass(
      passOptions({ ledger: fixture.ledger, seam: seam.seam }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.outcomes[0]).toMatchObject({
      kind: "failed",
      reason: "invalid-observation-identifier",
    });
    const durable = await fixture.ledger.readRecord(137);
    expect(durable).toMatchObject({ ok: true, value: { revision: 4 } });
  }, 60_000);

  it("[TEST-006][CC-010] produces identical decisions and seam call order for shuffled input", async () => {
    const orders = [
      [137, "42", 9001],
      [9001, 137, "42"],
      ["42", 9001, 137],
    ];
    const runs: {
      readonly decisions: unknown;
      readonly calls: unknown;
      readonly counts: unknown;
      readonly signals: unknown;
    }[] = [];

    for (const order of orders) {
      const fixture = await createWatcherLedgerFixture(ledgerClock);
      for (const workItemId of [137, 42, 9001]) {
        await seedWatcherRecord(fixture.ledger, {
          workItemId,
          revision: 4,
          phase: "implement",
          status: "ready",
          workItemCommentId: "480",
        });
      }
      const seam = createRecordingWatcherSeam({
        comments: (input) => ({
          commentIds:
            input.workItemId === "42"
              ? ["480"]
              : ["480", `481-${input.workItemId}`],
        }),
      });
      const outcome = await runDevSquadAdoWorkflowWatchPass(
        passOptions({
          ledger: fixture.ledger,
          seam: seam.seam,
          candidates: order,
        }),
      );
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      runs.push({
        decisions: decisions(outcome.value.outcomes),
        calls: seam.calls,
        counts: outcome.value.counts,
        signals: outcome.value.signals.map((signal) => signal.workItemId),
      });
    }

    expect(runs[1]).toEqual(runs[0]);
    expect(runs[2]).toEqual(runs[0]);
    expect(runs[0]?.decisions).toEqual([
      {
        workItemId: "137",
        kind: "acted",
        reason: "new-work-item-comment",
        cursorChanges: ["work-item-comment"],
      },
      {
        workItemId: "42",
        kind: "no-change",
        reason: "no-new-observations",
        cursorChanges: [],
      },
      {
        workItemId: "9001",
        kind: "acted",
        reason: "new-work-item-comment",
        cursorChanges: ["work-item-comment"],
      },
    ]);
  }, 120_000);

  it("[TEST-021][CC-018] keeps bodies, authors, credentials, and claim tokens out of every projection", async () => {
    const bodyMarker = "EXTERNAL-BODY-SECRET";
    const authorMarker = "EXTERNAL-AUTHOR-SECRET";
    const credentialUrl = "https://user:p4ssw0rd@example.test/private";
    const fixture = await createWatcherLedgerFixture(ledgerClock);
    await seedWatcherRecord(fixture.ledger, {
      workItemId: 137,
      revision: 4,
      phase: "implement",
      status: "ready",
      workItemCommentId: "480",
      pullRequestId: "481",
      pullRequestCursor: { threadId: "thread-12", commentId: "comment-29" },
    });
    const seam = createRecordingWatcherSeam({
      comments: () =>
        ({
          commentIds: ["480", "481"],
          bodies: [bodyMarker],
          authors: [authorMarker],
          url: credentialUrl,
        }) as unknown as { commentIds: readonly string[] },
      pullRequest: () =>
        ({
          entries: [
            {
              threadId: "thread-12",
              commentId: "comment-29",
              body: bodyMarker,
              author: authorMarker,
              url: credentialUrl,
            },
            {
              threadId: "thread-13",
              commentId: "comment-30",
              body: bodyMarker,
              author: authorMarker,
              url: credentialUrl,
            },
          ],
        }) as unknown as {
          entries: readonly { threadId: string; commentId?: string | null }[];
        },
    });

    const outcome = await runDevSquadAdoWorkflowWatchPass(
      passOptions({ ledger: fixture.ledger, seam: seam.seam }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.outcomes[0]).toMatchObject({
      kind: "acted",
      reason: "new-observations",
      cursorChanges: ["work-item-comment", "pull-request-thread"],
    });

    const artifacts = await readWatcherLedgerArtifacts(fixture.repositoryRoot);
    expect(artifacts.length).toBeGreaterThan(0);
    const surfaces = [
      JSON.stringify(outcome.value),
      JSON.stringify(outcome.value.signals),
      ...artifacts.map((artifact) => artifact.contents),
    ];
    const tokenShaped = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/;
    for (const surface of surfaces) {
      expect(surface).not.toContain(bodyMarker);
      expect(surface).not.toContain(authorMarker);
      expect(surface).not.toContain(credentialUrl);
      expect(surface).not.toContain("p4ssw0rd");
      expect(surface).not.toMatch(tokenShaped);
    }

    const durable = await fixture.ledger.readRecord(137);
    expect(durable.ok).toBe(true);
    if (!durable.ok) return;
    expect(durable.value.observations).toEqual({
      workItemCommentId: "481",
      pullRequest: { threadId: "thread-13", commentId: "comment-30" },
    });
  }, 60_000);
});

describe("DevSquadAdoWorkflowWatcher success criteria", () => {
  it("[SC-001] produces byte-identical results across repeated passes over frozen state", async () => {
    const fixture = await createWatcherLedgerFixture(ledgerClock);
    await seedWatcherRecord(fixture.ledger, {
      workItemId: 137,
      revision: 4,
      phase: "implement",
      status: "ready",
      workItemCommentId: "481",
    });
    const before = await fixture.ledger.readRecord(137);
    expect(before.ok).toBe(true);

    let baseline: string | null = null;
    for (let trial = 0; trial < REPEATED_PASS_TRIALS; trial++) {
      const seam = createRecordingWatcherSeam({
        comments: () => ({ commentIds: ["480", "481"] }),
      });
      const outcome = await runDevSquadAdoWorkflowWatchPass(
        passOptions({
          ledger: fixture.ledger,
          seam: seam.seam,
          clock: createDeterministicClock([POLL_NOW]).clock,
        }),
      );
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      const serialized = JSON.stringify(outcome.value);
      if (baseline === null) baseline = serialized;
      else expect(serialized, `trial ${String(trial)}`).toBe(baseline);
    }
    expect(baseline).not.toBeNull();
    expect(await fixture.ledger.readRecord(137)).toEqual(before);
  }, 600_000);

  it("[SC-004] delivers an observed event at most once across passes", async () => {
    const fixture = await createWatcherLedgerFixture(ledgerClock);
    await seedWatcherRecord(fixture.ledger, {
      workItemId: 137,
      revision: 4,
      phase: "implement",
      status: "ready",
      workItemCommentId: "c0",
    });

    const observed = ["c0"];
    const delivered: string[] = [];
    for (let event = 1; event <= EXACTLY_ONCE_EVENTS; event++) {
      observed.push(`c${String(event)}`);
      for (const attempt of ["first", "replay"] as const) {
        const seam = createRecordingWatcherSeam({
          comments: () => ({ commentIds: [...observed] }),
        });
        const outcome = await runDevSquadAdoWorkflowWatchPass(
          passOptions({
            ledger: fixture.ledger,
            seam: seam.seam,
            passId: `pass-${String(event)}-${attempt}`,
            clock: createDeterministicClock([POLL_NOW]).clock,
          }),
        );
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;
        for (const signal of outcome.value.signals)
          delivered.push(signal.phase);
        expect(
          outcome.value.signals.length,
          `event ${String(event)} ${attempt}`,
        ).toBe(attempt === "first" ? 1 : 0);
      }
    }
    expect(delivered).toHaveLength(EXACTLY_ONCE_EVENTS);

    const durable = await fixture.ledger.readRecord(137);
    expect(durable).toMatchObject({
      ok: true,
      value: {
        observations: { workItemCommentId: `c${String(EXACTLY_ONCE_EVENTS)}` },
      },
    });
  }, 600_000);

  it("[SC-009] gives every candidate outcome a stable nonempty kind and reason", async () => {
    const fixture = await createWatcherLedgerFixture(ledgerClock);
    await seedWatcherRecord(fixture.ledger, {
      workItemId: 137,
      revision: 4,
      phase: "implement",
      status: "ready",
      workItemCommentId: "480",
    });
    await seedWatcherRecord(fixture.ledger, {
      workItemId: 42,
      revision: 4,
      phase: "awaiting-approval",
      status: "ready",
      workItemCommentId: "480",
    });
    await seedWatcherRecord(fixture.ledger, {
      workItemId: 9001,
      revision: 4,
      phase: "implement",
      status: "ready",
      workItemCommentId: "480",
    });

    const seam = createRecordingWatcherSeam({
      comments: (input) => {
        if (input.workItemId === "9001")
          return Promise.reject(new Error("transport exploded"));
        if (input.workItemId === "99999") return { commentIds: ["480"] };
        return { commentIds: ["480", "481"] };
      },
    });
    const outcome = await runDevSquadAdoWorkflowWatchPass(
      passOptions({
        ledger: fixture.ledger,
        seam: seam.seam,
        candidates: [137, 42, 9001, 99999],
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const kinds = new Set<string>();
    for (const candidate of outcome.value.outcomes) {
      expect(OUTCOME_KINDS).toContain(candidate.kind);
      expect(REASON_CODES).toContain(candidate.reason);
      expect(candidate.reason.length).toBeGreaterThan(0);
      kinds.add(candidate.kind);
    }
    expect([...kinds].sort()).toEqual([
      "acted",
      "failed",
      "intake-suppressed",
      "skipped",
    ]);
  }, 120_000);
});
