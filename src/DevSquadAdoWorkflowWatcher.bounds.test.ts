import { afterEach, describe, expect, it } from "vitest";
import type { DevSquadAdoWorkflowLedger } from "./DevSquadAdoWorkflowLedger.js";
import { runDevSquadAdoWorkflowWatchPass } from "./DevSquadAdoWorkflowWatcher.js";
import type { RunDevSquadAdoWorkflowWatchPassOptions } from "./DevSquadAdoWorkflowWatcher.js";
import { computeDevSquadAdoWatcherBackoffDelayMs } from "./DevSquadAdoWorkflowWatcherValidation.js";
import {
  cleanupWatcherRepositories,
  createDeterministicClock,
  createRecordingDelay,
  createRecordingWatcherSeam,
  createWatcherLedgerFixture,
  nonSettlingObservation,
  seedWatcherRecord,
} from "./DevSquadAdoWorkflowWatcherTestSupport.js";
import type { DevSquadAdoWatcherWorkItemObservation } from "./DevSquadAdoWorkflowWatcher.js";

const LEDGER_NOW = "2026-01-01T00:00:00.000Z";
const POLL_NOW = "2026-01-01T00:00:10.000Z";
const OBSERVATION_TIMEOUT_MS = 5_000;

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
    maxPollStartElapsedMs: 600_000,
    observationTimeoutMs: OBSERVATION_TIMEOUT_MS,
  },
  clock: createDeterministicClock([POLL_NOW]).clock,
  delay: createRecordingDelay({
    observationTimeoutMs: OBSERVATION_TIMEOUT_MS,
  }).delay,
  ...overrides,
});

afterEach(cleanupWatcherRepositories);

describe("DevSquadAdoWorkflowWatcher backoff schedule", () => {
  it("[TEST-016] truncates, caps, and clamps deterministically with no ambient randomness", () => {
    const defaults = {
      baseIntervalMs: 1_000,
      multiplier: 2,
      maxIntervalMs: 30_000,
    };
    const schedule = [1, 2, 3, 4, 5, 6, 7].map((pollIndex) =>
      computeDevSquadAdoWatcherBackoffDelayMs({ pollIndex, ...defaults }),
    );
    expect(schedule).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000,
    ]);

    const custom = [1, 2, 3, 4].map((pollIndex) =>
      computeDevSquadAdoWatcherBackoffDelayMs({
        pollIndex,
        baseIntervalMs: 250,
        multiplier: 1.5,
        maxIntervalMs: 700,
      }),
    );
    expect(custom).toEqual([250, 375, 562, 700]);

    expect(
      computeDevSquadAdoWatcherBackoffDelayMs({
        pollIndex: 2,
        ...defaults,
        jitter: (baseDelayMs, pollIndex) => baseDelayMs / pollIndex + 0.9,
      }),
    ).toBe(1_000);
    expect(
      computeDevSquadAdoWatcherBackoffDelayMs({
        pollIndex: 1,
        ...defaults,
        jitter: () => -50,
      }),
    ).toBe(0);
    expect(
      computeDevSquadAdoWatcherBackoffDelayMs({
        pollIndex: 1,
        ...defaults,
        jitter: () => 10_000_000,
      }),
    ).toBe(30_000);

    const repeated = computeDevSquadAdoWatcherBackoffDelayMs({
      pollIndex: 3,
      ...defaults,
    });
    expect(
      computeDevSquadAdoWatcherBackoffDelayMs({ pollIndex: 3, ...defaults }),
    ).toBe(repeated);
  });
});

describe("DevSquadAdoWorkflowWatcher budgets", () => {
  it("[TEST-016][CC-011] performs exactly maxPolls polls and requests one fewer delay", async () => {
    const fixture = await createWatcherLedgerFixture(ledgerClock);
    await seedWatcherRecord(fixture.ledger, {
      workItemId: 137,
      revision: 4,
      phase: "implement",
      status: "ready",
      workItemCommentId: "480",
    });
    const seam = createRecordingWatcherSeam({
      comments: () => ({ commentIds: ["480"] }),
    });
    const clock = createDeterministicClock([POLL_NOW]);
    const delaySource = createRecordingDelay({
      observationTimeoutMs: OBSERVATION_TIMEOUT_MS,
    });

    const outcome = await runDevSquadAdoWorkflowWatchPass(
      passOptions({
        ledger: fixture.ledger,
        seam: seam.seam,
        budgets: {
          maxPolls: 3,
          maxPollStartElapsedMs: 600_000,
          observationTimeoutMs: OBSERVATION_TIMEOUT_MS,
        },
        clock: clock.clock,
        delay: delaySource.delay,
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.polls).toBe(3);
    expect(outcome.value.stopReason).toBe("poll-budget-exhausted");
    expect(delaySource.backoffs().map((request) => request.ms)).toEqual([
      1_000, 2_000,
    ]);
    expect(delaySource.observations()).toHaveLength(3);
    expect(clock.readings).toHaveLength(4);
    expect(outcome.value.outcomes[0]).toMatchObject({
      kind: "no-change",
      reason: "no-new-observations",
    });
    expect(seam.calls).toHaveLength(3);

    const durable = await fixture.ledger.readRecord(137);
    expect(durable).toMatchObject({ ok: true, value: { revision: 4 } });
  }, 60_000);

  it("[TEST-016] stops on the duration budget from the second poll onward", async () => {
    const fixture = await createWatcherLedgerFixture(ledgerClock);
    await seedWatcherRecord(fixture.ledger, {
      workItemId: 137,
      revision: 4,
      phase: "implement",
      status: "ready",
      workItemCommentId: "480",
    });
    const seam = createRecordingWatcherSeam({
      comments: () => ({ commentIds: ["480"] }),
    });
    const clock = createDeterministicClock([
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:06.000Z",
    ]);
    const delaySource = createRecordingDelay({
      observationTimeoutMs: OBSERVATION_TIMEOUT_MS,
    });

    const outcome = await runDevSquadAdoWorkflowWatchPass(
      passOptions({
        ledger: fixture.ledger,
        seam: seam.seam,
        budgets: {
          maxPolls: 10,
          maxPollStartElapsedMs: 5_000,
          observationTimeoutMs: OBSERVATION_TIMEOUT_MS,
        },
        clock: clock.clock,
        delay: delaySource.delay,
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.polls).toBe(1);
    expect(outcome.value.stopReason).toBe("poll-start-budget-exhausted");
    expect(outcome.value.startedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(outcome.value.completedAt).toBe("2026-01-01T00:00:06.000Z");
    expect(delaySource.backoffs()).toHaveLength(1);
  }, 60_000);

  it("[TEST-007] reads the injected clock exactly once per poll", async () => {
    const fixture = await createWatcherLedgerFixture(ledgerClock);
    await seedWatcherRecord(fixture.ledger, {
      workItemId: 137,
      revision: 4,
      phase: "implement",
      status: "ready",
      workItemCommentId: "480",
    });
    const seam = createRecordingWatcherSeam({
      comments: () => ({ commentIds: ["480"] }),
    });
    const clock = createDeterministicClock([
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:01.000Z",
      "2026-01-01T00:00:02.000Z",
    ]);

    const outcome = await runDevSquadAdoWorkflowWatchPass(
      passOptions({
        ledger: fixture.ledger,
        seam: seam.seam,
        budgets: {
          maxPolls: 2,
          maxPollStartElapsedMs: 600_000,
          observationTimeoutMs: OBSERVATION_TIMEOUT_MS,
        },
        clock: clock.clock,
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.polls).toBe(2);
    expect(clock.readings).toHaveLength(3);
    expect(outcome.value.startedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(outcome.value.completedAt).toBe("2026-01-01T00:00:02.000Z");
  }, 60_000);

  it("[TEST-007] drives the foreign-claim lease decision from the single poll reading", async () => {
    for (const scenario of [
      { pollNow: "2026-01-01T00:00:59.999Z", expected: "claim-conflict" },
      { pollNow: "2026-01-01T00:01:00.000Z", expected: "no-new-observations" },
    ] as const) {
      const fixture = await createWatcherLedgerFixture(ledgerClock);
      await seedWatcherRecord(fixture.ledger, {
        workItemId: 137,
        revision: 4,
        phase: "implement",
        status: "ready",
        workItemCommentId: "480",
      });
      const acquired = await fixture.ledger.acquireClaim({
        workItemId: 137,
        operationId: "foreign-claim",
        ownerId: "watch-b",
        claimToken: Buffer.alloc(32, 3).toString("base64url"),
        leaseDurationMs: 60_000,
      });
      expect(acquired.ok).toBe(true);
      if (!acquired.ok) return;
      expect(acquired.value.outcome.authority.expiresAt).toBe(
        "2026-01-01T00:01:00.000Z",
      );

      const seam = createRecordingWatcherSeam({
        comments: () => ({ commentIds: ["480"] }),
      });
      const outcome = await runDevSquadAdoWorkflowWatchPass(
        passOptions({
          ledger: fixture.ledger,
          seam: seam.seam,
          clock: createDeterministicClock([scenario.pollNow]).clock,
        }),
      );
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.value.outcomes[0]?.reason, scenario.pollNow).toBe(
        scenario.expected,
      );
      expect(seam.calls.length, scenario.pollNow).toBe(
        scenario.expected === "claim-conflict" ? 0 : 1,
      );
    }
  }, 120_000);
});

describe("DevSquadAdoWorkflowWatcher observation timeout", () => {
  it("[TEST-018][CC-013] converts a non-settling observation into a per-candidate timeout and continues", async () => {
    const fixture = await createWatcherLedgerFixture(ledgerClock);
    for (const workItemId of [137, 42]) {
      await seedWatcherRecord(fixture.ledger, {
        workItemId,
        revision: 4,
        phase: "implement",
        status: "ready",
        workItemCommentId: "480",
      });
    }
    const seam = createRecordingWatcherSeam({
      comments: (input) =>
        input.workItemId === "137"
          ? nonSettlingObservation<DevSquadAdoWatcherWorkItemObservation>()
          : { commentIds: ["480", "481"] },
    });
    const delaySource = createRecordingDelay({
      observationTimeoutMs: OBSERVATION_TIMEOUT_MS,
    });

    const outcome = await runDevSquadAdoWorkflowWatchPass(
      passOptions({
        ledger: fixture.ledger,
        seam: seam.seam,
        candidates: [137, 42],
        delay: delaySource.delay,
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.outcomes[0]).toMatchObject({
      workItemId: "137",
      kind: "failed",
      reason: "observation-timeout",
      ledgerErrorKind: null,
    });
    expect(outcome.value.outcomes[1]).toMatchObject({
      workItemId: "42",
      kind: "acted",
      reason: "new-work-item-comment",
    });
    expect(outcome.value.counts).toMatchObject({ failed: 1, acted: 1 });
    expect(
      delaySource.observations().every((request) => request.ms === 5_000),
    ).toBe(true);

    const untouched = await fixture.ledger.readRecord(137);
    expect(untouched).toMatchObject({ ok: true, value: { revision: 4 } });
  }, 60_000);

  it("[TEST-018] converts a seam rejection into a stable reason with no transport detail", async () => {
    const fixture = await createWatcherLedgerFixture(ledgerClock);
    await seedWatcherRecord(fixture.ledger, {
      workItemId: 137,
      revision: 4,
      phase: "implement",
      status: "ready",
      workItemCommentId: "480",
    });
    const seam = createRecordingWatcherSeam({
      comments: () => {
        throw new Error(
          "https://user:p4ssw0rd@example.test/rest/api?token=SECRET",
        );
      },
    });

    const outcome = await runDevSquadAdoWorkflowWatchPass(
      passOptions({ ledger: fixture.ledger, seam: seam.seam }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.outcomes[0]).toMatchObject({
      kind: "failed",
      reason: "observation-failed",
    });
    expect(JSON.stringify(outcome.value)).not.toContain("p4ssw0rd");
    expect(JSON.stringify(outcome.value)).not.toContain("SECRET");
  }, 60_000);
});

describe("DevSquadAdoWorkflowWatcher injected callable failures", () => {
  it("[TEST-018][TEST-011] converts a throwing delay into a fail-closed timeout and still releases a held claim", async () => {
    const fixture = await createWatcherLedgerFixture(ledgerClock);
    for (const workItemId of [137, 42]) {
      await seedWatcherRecord(fixture.ledger, {
        workItemId,
        revision: 4,
        phase: "implement",
        status: "ready",
        workItemCommentId: "480",
      });
    }

    // The first candidate is left holding its claim across the poll boundary,
    // so an escaping throw from the second candidate would skip the finalize
    // release loop and strand the lease.
    let armingFails = false;
    const carryOverLedger: DevSquadAdoWorkflowLedger = {
      ...fixture.ledger,
      checkpoint: async () => {
        armingFails = true;
        return { ok: false, error: { kind: "contention", attempts: 32 } };
      },
    };
    const seam = createRecordingWatcherSeam({
      comments: (input) =>
        input.workItemId === "137"
          ? { commentIds: ["480", "481"] }
          : nonSettlingObservation<DevSquadAdoWatcherWorkItemObservation>(),
    });
    const delaySource = createRecordingDelay({
      observationTimeoutMs: OBSERVATION_TIMEOUT_MS,
      onDelay: (request) => {
        if (request.kind === "observation" && armingFails)
          throw new Error("injected delay source is unavailable");
      },
    });
    const before = new Map(
      await Promise.all(
        [137, 42].map(
          async (workItemId) =>
            [workItemId, await fixture.ledger.readRecord(workItemId)] as const,
        ),
      ),
    );

    const outcome = await runDevSquadAdoWorkflowWatchPass(
      passOptions({
        ledger: carryOverLedger,
        seam: seam.seam,
        candidates: [137, 42],
        delay: delaySource.delay,
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.stopReason).toBe("poll-budget-exhausted");
    expect(
      outcome.value.outcomes.map((candidate) => [
        candidate.workItemId,
        candidate.kind,
        candidate.reason,
      ]),
    ).toEqual([
      ["137", "failed", "checkpoint-indeterminate"],
      ["42", "failed", "observation-timeout"],
    ]);
    expect(outcome.value.signals).toEqual([]);

    // The throwing arm was genuinely requested, and the observation it failed
    // to bound never settles, so a timeout is the only fail-closed answer.
    expect(delaySource.observations()).toHaveLength(2);
    expect(armingFails).toBe(true);

    for (const workItemId of [137, 42]) {
      const durable = await fixture.ledger.readRecord(workItemId);
      expect(durable.ok, String(workItemId)).toBe(true);
      if (!durable.ok) return;
      expect(durable.value.activeClaim, String(workItemId)).toBeNull();
      expect(
        durable.value.observations.workItemCommentId,
        String(workItemId),
      ).toBe("480");
      const seeded = before.get(workItemId);
      expect(seeded?.ok, String(workItemId)).toBe(true);
      if (seeded?.ok !== true) return;
      expect(durable.value.checkpoints, String(workItemId)).toEqual(
        seeded.value.checkpoints,
      );
    }
  }, 60_000);

  it("[TEST-007][TEST-011] stops on a stable reason and releases a held claim when the clock throws mid-pass", async () => {
    const fixture = await createWatcherLedgerFixture(ledgerClock);
    await seedWatcherRecord(fixture.ledger, {
      workItemId: 137,
      revision: 4,
      phase: "implement",
      status: "ready",
      workItemCommentId: "480",
    });
    const carryOverLedger: DevSquadAdoWorkflowLedger = {
      ...fixture.ledger,
      checkpoint: async () => ({
        ok: false,
        error: { kind: "contention", attempts: 32 },
      }),
    };

    // Readings: pass start, first poll, then the second poll that throws.
    let readings = 0;
    const failingClock = (): Date => {
      readings += 1;
      if (readings >= 3) throw new Error("injected clock is unavailable");
      return new Date(POLL_NOW);
    };

    const seam = createRecordingWatcherSeam({
      comments: () => ({ commentIds: ["480", "481"] }),
    });
    const before = await fixture.ledger.readRecord(137);
    const outcome = await runDevSquadAdoWorkflowWatchPass(
      passOptions({
        ledger: carryOverLedger,
        seam: seam.seam,
        clock: failingClock,
        budgets: {
          maxPolls: 3,
          maxPollStartElapsedMs: 600_000,
          observationTimeoutMs: OBSERVATION_TIMEOUT_MS,
        },
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(readings).toBe(3);
    expect(outcome.value.polls).toBe(1);
    // An unreadable clock is fail-closed in exactly the way an unusable
    // reading already is: the pass stops rather than deciding on time it
    // cannot read.
    expect(outcome.value.stopReason).toBe("poll-start-budget-exhausted");
    expect(outcome.value.outcomes[0]).toMatchObject({
      workItemId: "137",
      kind: "failed",
      reason: "checkpoint-indeterminate",
    });
    expect(outcome.value.signals).toEqual([]);

    const durable = await fixture.ledger.readRecord(137);
    expect(durable.ok).toBe(true);
    expect(before.ok).toBe(true);
    if (!durable.ok || !before.ok) return;
    expect(durable.value.activeClaim).toBeNull();
    expect(durable.value.observations.workItemCommentId).toBe("480");
    expect(durable.value.checkpoints).toEqual(before.value.checkpoints);
  }, 60_000);

  it("[TEST-001] rejects a clock that throws on its first reading before any observation or mutation", async () => {
    const fixture = await createWatcherLedgerFixture(ledgerClock);
    await seedWatcherRecord(fixture.ledger, {
      workItemId: 137,
      revision: 4,
      phase: "implement",
      status: "ready",
      workItemCommentId: "480",
    });
    const before = await fixture.ledger.readRecord(137);

    const seam = createRecordingWatcherSeam({
      comments: () => ({ commentIds: ["480", "481"] }),
    });
    const outcome = await runDevSquadAdoWorkflowWatchPass(
      passOptions({
        ledger: fixture.ledger,
        seam: seam.seam,
        clock: (): Date => {
          throw new Error("injected clock is unavailable");
        },
      }),
    );

    expect(outcome).toEqual({
      ok: false,
      error: {
        kind: "validation",
        field: "clock",
        reason: "must return a valid Date",
      },
    });
    expect(seam.calls).toEqual([]);
    expect(seam.writes.invoked).toEqual([]);
    expect(await fixture.ledger.readRecord(137)).toEqual(before);
  }, 60_000);
});

describe("DevSquadAdoWorkflowWatcher cancellation", () => {
  it("[TEST-017][CC-012] stops before the next seam call and reports acknowledged outcomes", async () => {
    const fixture = await createWatcherLedgerFixture(ledgerClock);
    for (const workItemId of [137, 42]) {
      await seedWatcherRecord(fixture.ledger, {
        workItemId,
        revision: 4,
        phase: "implement",
        status: "ready",
        workItemCommentId: "480",
      });
    }
    const controller = new AbortController();
    const seam = createRecordingWatcherSeam({
      comments: () => ({ commentIds: ["480", "481"] }),
    });
    const abortingLedger: DevSquadAdoWorkflowLedger = {
      ...fixture.ledger,
      checkpoint: async (input) => {
        const result = await fixture.ledger.checkpoint(input);
        controller.abort();
        return result;
      },
    };

    const outcome = await runDevSquadAdoWorkflowWatchPass(
      passOptions({
        ledger: abortingLedger,
        seam: seam.seam,
        candidates: [137, 42],
        signal: controller.signal,
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.stopReason).toBe("cancelled");
    expect(outcome.value.signals).toHaveLength(1);
    expect(outcome.value.signals[0]?.workItemId).toBe("137");
    expect(outcome.value.outcomes[0]).toMatchObject({
      workItemId: "137",
      kind: "acted",
      revision: 6,
    });
    expect(outcome.value.outcomes[1]).toMatchObject({
      workItemId: "42",
      kind: "no-change",
      reason: "cancelled",
    });
    expect(seam.calls.filter((call) => call.workItemId === "42")).toHaveLength(
      0,
    );

    for (const workItemId of [137, 42]) {
      const durable = await fixture.ledger.readRecord(workItemId);
      expect(durable.ok).toBe(true);
      if (!durable.ok) return;
      expect(durable.value.activeClaim).toBeNull();
    }
    const advanced = await fixture.ledger.readRecord(137);
    expect(advanced).toMatchObject({
      ok: true,
      value: { revision: 7, observations: { workItemCommentId: "481" } },
    });
    const untouched = await fixture.ledger.readRecord(42);
    expect(untouched).toMatchObject({ ok: true, value: { revision: 4 } });
  }, 60_000);

  it("[TEST-017] stops before a ledger mutation without advancing durable state", async () => {
    const fixture = await createWatcherLedgerFixture(ledgerClock);
    await seedWatcherRecord(fixture.ledger, {
      workItemId: 137,
      revision: 4,
      phase: "implement",
      status: "ready",
      workItemCommentId: "480",
    });
    const controller = new AbortController();
    const seam = createRecordingWatcherSeam({
      comments: () => {
        controller.abort();
        return { commentIds: ["480", "481"] };
      },
    });

    const outcome = await runDevSquadAdoWorkflowWatchPass(
      passOptions({
        ledger: fixture.ledger,
        seam: seam.seam,
        signal: controller.signal,
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.stopReason).toBe("cancelled");
    expect(outcome.value.signals).toEqual([]);
    expect(outcome.value.outcomes[0]).toMatchObject({
      kind: "failed",
      reason: "cancelled",
      claim: null,
    });

    const durable = await fixture.ledger.readRecord(137);
    expect(durable).toMatchObject({
      ok: true,
      value: { revision: 4, activeClaim: null },
    });
  }, 60_000);

  it("[TEST-017] stops between polls through the injected delay", async () => {
    const fixture = await createWatcherLedgerFixture(ledgerClock);
    await seedWatcherRecord(fixture.ledger, {
      workItemId: 137,
      revision: 4,
      phase: "implement",
      status: "ready",
      workItemCommentId: "480",
    });
    const controller = new AbortController();
    const seam = createRecordingWatcherSeam({
      comments: () => ({ commentIds: ["480"] }),
    });
    const delaySource = createRecordingDelay({
      observationTimeoutMs: OBSERVATION_TIMEOUT_MS,
      onDelay: (request) => {
        if (request.kind === "backoff" && request.pollIndex === 1)
          controller.abort();
      },
    });

    const outcome = await runDevSquadAdoWorkflowWatchPass(
      passOptions({
        ledger: fixture.ledger,
        seam: seam.seam,
        budgets: {
          maxPolls: 5,
          maxPollStartElapsedMs: 600_000,
          observationTimeoutMs: OBSERVATION_TIMEOUT_MS,
        },
        clock: createDeterministicClock([POLL_NOW]).clock,
        delay: delaySource.delay,
        signal: controller.signal,
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.polls).toBe(1);
    expect(outcome.value.stopReason).toBe("cancelled");
    expect(delaySource.backoffs()).toHaveLength(1);
    expect(outcome.value.outcomes[0]).toMatchObject({
      kind: "no-change",
      reason: "no-new-observations",
    });
  }, 60_000);

  it("[TEST-017] returns immediately when the pass starts already cancelled", async () => {
    const fixture = await createWatcherLedgerFixture(ledgerClock);
    await seedWatcherRecord(fixture.ledger, {
      workItemId: 137,
      revision: 4,
      phase: "implement",
      status: "ready",
      workItemCommentId: "480",
    });
    const controller = new AbortController();
    controller.abort();
    const seam = createRecordingWatcherSeam({
      comments: () => ({ commentIds: ["480", "481"] }),
    });

    const outcome = await runDevSquadAdoWorkflowWatchPass(
      passOptions({
        ledger: fixture.ledger,
        seam: seam.seam,
        signal: controller.signal,
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.polls).toBe(0);
    expect(outcome.value.stopReason).toBe("cancelled");
    expect(outcome.value.counts.examined).toBe(0);
    expect(outcome.value.outcomes[0]).toMatchObject({
      kind: "no-change",
      reason: "cancelled",
    });
    expect(seam.calls).toEqual([]);
  }, 60_000);
});

describe("DevSquadAdoWorkflowWatcher success criteria", () => {
  it("[SC-005][SC-010] terminates with a stable stop reason across the budget matrix without wall-clock waiting", async () => {
    const fixture = await createWatcherLedgerFixture(ledgerClock);
    await seedWatcherRecord(fixture.ledger, {
      workItemId: 137,
      revision: 4,
      phase: "implement",
      status: "ready",
      workItemCommentId: "480",
    });

    const matrix: readonly {
      readonly label: string;
      readonly maxPolls: number;
      readonly maxPollStartElapsedMs: number;
      readonly clock: readonly string[];
      readonly abortAfterPoll: number | null;
      readonly stopReason: string;
      readonly polls: number;
    }[] = [
      {
        label: "single poll",
        maxPolls: 1,
        maxPollStartElapsedMs: 600_000,
        clock: ["2026-01-01T00:00:00.000Z"],
        abortAfterPoll: null,
        stopReason: "poll-budget-exhausted",
        polls: 1,
      },
      {
        label: "three polls",
        maxPolls: 3,
        maxPollStartElapsedMs: 600_000,
        clock: ["2026-01-01T00:00:00.000Z"],
        abortAfterPoll: null,
        stopReason: "poll-budget-exhausted",
        polls: 3,
      },
      {
        label: "ten polls",
        maxPolls: 10,
        maxPollStartElapsedMs: 600_000,
        clock: ["2026-01-01T00:00:00.000Z"],
        abortAfterPoll: null,
        stopReason: "poll-budget-exhausted",
        polls: 10,
      },
      {
        label: "duration budget on the second poll",
        maxPolls: 10,
        maxPollStartElapsedMs: 1_000,
        clock: [
          "2026-01-01T00:00:00.000Z",
          "2026-01-01T00:00:00.000Z",
          "2026-01-01T00:00:05.000Z",
        ],
        abortAfterPoll: null,
        stopReason: "poll-start-budget-exhausted",
        polls: 1,
      },
      {
        label: "duration budget on the fourth poll",
        maxPolls: 10,
        maxPollStartElapsedMs: 3_000,
        clock: [
          "2026-01-01T00:00:00.000Z",
          "2026-01-01T00:00:00.000Z",
          "2026-01-01T00:00:01.000Z",
          "2026-01-01T00:00:02.000Z",
          "2026-01-01T00:00:09.000Z",
        ],
        abortAfterPoll: null,
        stopReason: "poll-start-budget-exhausted",
        polls: 3,
      },
      {
        label: "abort after the first poll",
        maxPolls: 10,
        maxPollStartElapsedMs: 600_000,
        clock: ["2026-01-01T00:00:00.000Z"],
        abortAfterPoll: 1,
        stopReason: "cancelled",
        polls: 1,
      },
      {
        label: "abort after the second poll",
        maxPolls: 10,
        maxPollStartElapsedMs: 600_000,
        clock: ["2026-01-01T00:00:00.000Z"],
        abortAfterPoll: 2,
        stopReason: "cancelled",
        polls: 2,
      },
    ];

    const startedAt = Date.now();
    let requestedDelayMs = 0;
    for (const scenario of matrix) {
      const controller = new AbortController();
      const delaySource = createRecordingDelay({
        observationTimeoutMs: OBSERVATION_TIMEOUT_MS,
        onDelay: (request) => {
          if (
            scenario.abortAfterPoll !== null &&
            request.kind === "backoff" &&
            request.pollIndex === scenario.abortAfterPoll
          )
            controller.abort();
        },
      });
      const seam = createRecordingWatcherSeam({
        comments: () => ({ commentIds: ["480"] }),
      });
      const outcome = await runDevSquadAdoWorkflowWatchPass(
        passOptions({
          ledger: fixture.ledger,
          seam: seam.seam,
          budgets: {
            maxPolls: scenario.maxPolls,
            maxPollStartElapsedMs: scenario.maxPollStartElapsedMs,
            observationTimeoutMs: OBSERVATION_TIMEOUT_MS,
          },
          clock: createDeterministicClock([...scenario.clock]).clock,
          delay: delaySource.delay,
          ...(scenario.abortAfterPoll !== null
            ? { signal: controller.signal }
            : {}),
        }),
      );

      expect(outcome.ok, scenario.label).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.value.stopReason, scenario.label).toBe(
        scenario.stopReason,
      );
      expect(outcome.value.polls, scenario.label).toBe(scenario.polls);
      expect(outcome.value.outcomes, scenario.label).toHaveLength(1);
      for (const request of delaySource.requests) {
        requestedDelayMs += request.ms;
      }
    }

    // The injected delay source is asked for minutes of nominal waiting; the
    // suite must not spend any of it.
    expect(requestedDelayMs).toBeGreaterThan(60_000);
    expect(Date.now() - startedAt).toBeLessThan(30_000);

    const durable = await fixture.ledger.readRecord(137);
    expect(durable).toMatchObject({ ok: true, value: { revision: 4 } });
  }, 300_000);
});
