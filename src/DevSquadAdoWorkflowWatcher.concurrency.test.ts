import { afterEach, describe, expect, it } from "vitest";
import type {
  CheckpointDevSquadAdoWorkflowInput,
  DevSquadAdoLedgerError,
  DevSquadAdoWorkflowLedger,
  RenewDevSquadAdoWorkflowClaimInput,
  ReleaseDevSquadAdoWorkflowClaimInput,
} from "./DevSquadAdoWorkflowLedger.js";
import {
  deriveDevSquadAdoWatcherOperationId,
  runDevSquadAdoWorkflowWatchPass,
} from "./DevSquadAdoWorkflowWatcher.js";
import type {
  DevSquadAdoWatchReasonCode,
  RunDevSquadAdoWorkflowWatchPassOptions,
} from "./DevSquadAdoWorkflowWatcher.js";
import {
  cleanupWatcherRepositories,
  createDeterministicClock,
  createRecordingDelay,
  createRecordingWatcherSeam,
  createWatcherLedgerFixture,
  makeWatcherRepository,
  openWatcherLedger,
  seedWatcherRecord,
  watcherCommentCheckpointOperationId,
} from "./DevSquadAdoWorkflowWatcherTestSupport.js";

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

const twoNewComments = () => ({ commentIds: ["480", "481"] });

/**
 * Success-criteria sweep scale.
 *
 * SC-002 states an explicit numeric bar, so its sweep always runs at the full
 * 1,000 trials. Trials are independent work items, so they run in bounded
 * concurrent batches: every ledger mutation is an fsync-backed publication and
 * the cost is I/O-bound, which keeps the committed default within the suite's
 * wall-clock budget without weakening any per-trial assertion. SC-003 states
 * no numeric bar, so its sweep keeps a reduced default and reaches full scale
 * under `SANDCASTLE_WATCHER_SWEEP=full`.
 */
const FULL_SWEEP = process.env.SANDCASTLE_WATCHER_SWEEP === "full";
const TWO_OWNER_TRIALS = 1_000;
const TWO_OWNER_BATCH = 25;
const STALE_FENCING_TRIALS = FULL_SWEEP ? 200 : 25;

afterEach(cleanupWatcherRepositories);

describe("DevSquadAdoWorkflowWatcher claim contention", () => {
  it("[TEST-008][CC-004] lets exactly one owner act and reports the other as a claim conflict", async () => {
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

    const seamB = createRecordingWatcherSeam({ comments: twoNewComments });
    const releasedBy: string[] = [];
    let interleaved = false;
    let outcomeB: Awaited<
      ReturnType<typeof runDevSquadAdoWorkflowWatchPass>
    > | null = null;

    const interleavingLedger: DevSquadAdoWorkflowLedger = {
      ...fixture.ledger,
      releaseClaim: async (input: ReleaseDevSquadAdoWorkflowClaimInput) => {
        releasedBy.push(input.authority.ownerId);
        return await fixture.ledger.releaseClaim(input);
      },
      checkpoint: async (input: CheckpointDevSquadAdoWorkflowInput) => {
        if (!interleaved) {
          interleaved = true;
          outcomeB = await runDevSquadAdoWorkflowWatchPass(
            passOptions({
              ledger: fixture.ledger,
              seam: seamB.seam,
              passId: "pass-b",
              ownerId: "watch-b",
              candidates: [137, 42],
              lease: { leaseDurationMs: 60_000 },
            }),
          );
        }
        return await fixture.ledger.checkpoint(input);
      },
    };

    const seamA = createRecordingWatcherSeam({ comments: twoNewComments });
    const resultA = await runDevSquadAdoWorkflowWatchPass(
      passOptions({
        ledger: interleavingLedger,
        seam: seamA.seam,
        passId: "pass-a",
        ownerId: "watch-a",
        candidates: [137, 42],
        lease: { leaseDurationMs: 60_000 },
      }),
    );

    expect(resultA.ok).toBe(true);
    expect(outcomeB).not.toBeNull();
    const resultB = outcomeB as unknown as Awaited<
      ReturnType<typeof runDevSquadAdoWorkflowWatchPass>
    >;
    expect(resultB.ok).toBe(true);
    if (!resultA.ok || !resultB.ok) return;

    const actorsFor137 = [resultA, resultB].filter((result) =>
      result.ok
        ? result.value.outcomes.some(
            (outcome) =>
              outcome.workItemId === "137" && outcome.kind === "acted",
          )
        : false,
    );
    expect(actorsFor137).toHaveLength(1);

    expect(
      resultB.value.outcomes.find((outcome) => outcome.workItemId === "137"),
    ).toMatchObject({ kind: "skipped", reason: "claim-conflict", claim: null });
    expect(
      resultB.value.outcomes.find((outcome) => outcome.workItemId === "42"),
    ).toMatchObject({ kind: "acted" });
    expect(resultB.value.signals.map((signal) => signal.workItemId)).toEqual([
      "42",
    ]);
    expect(
      seamB.calls.filter((call) => call.workItemId === "137"),
    ).toHaveLength(0);

    // The conflicted pass never force-releases the other owner's claim.
    expect(releasedBy).toEqual(["watch-a"]);
    for (const workItemId of [137, 42]) {
      const durable = await fixture.ledger.readRecord(workItemId);
      expect(durable.ok).toBe(true);
      if (!durable.ok) return;
      expect(durable.value.activeClaim).toBeNull();
      expect(durable.value.observations.workItemCommentId).toBe("481");
    }
  }, 120_000);

  it("[TEST-009][CC-022] abandons an observation whose anchors moved between the read and the claim", async () => {
    const fixture = await createWatcherLedgerFixture(ledgerClock);
    await seedWatcherRecord(fixture.ledger, {
      workItemId: 137,
      revision: 4,
      phase: "implement",
      status: "ready",
      workItemCommentId: "10",
    });

    // Owner B advances 10 -> 15 and releases inside the window between owner
    // A's record read and A's own acquisition. A's claim then succeeds, but the
    // selection A is holding was computed against anchor "10", which is no
    // longer durable.
    const checkpointPatches: (string | null | undefined)[] = [];
    let interleaved = false;
    let outcomeB: Awaited<
      ReturnType<typeof runDevSquadAdoWorkflowWatchPass>
    > | null = null;

    const recordingLedger: DevSquadAdoWorkflowLedger = {
      ...fixture.ledger,
      checkpoint: async (input: CheckpointDevSquadAdoWorkflowInput) => {
        checkpointPatches.push(input.patch.observations?.workItemCommentId);
        return await fixture.ledger.checkpoint(input);
      },
    };
    const interleavingLedger: DevSquadAdoWorkflowLedger = {
      ...recordingLedger,
      acquireClaim: async (input) => {
        if (!interleaved) {
          interleaved = true;
          outcomeB = await runDevSquadAdoWorkflowWatchPass(
            passOptions({
              ledger: recordingLedger,
              seam: createRecordingWatcherSeam({
                comments: () => ({ commentIds: ["10", "15"] }),
              }).seam,
              passId: "pass-b",
              ownerId: "watch-b",
              lease: { leaseDurationMs: 60_000 },
            }),
          );
        }
        return await fixture.ledger.acquireClaim(input);
      },
    };

    const seamA = createRecordingWatcherSeam({
      comments: (_input, callIndex) =>
        callIndex === 0
          ? { commentIds: ["10", "11", "12"] }
          : { commentIds: ["15"] },
    });
    const resultA = await runDevSquadAdoWorkflowWatchPass(
      passOptions({
        ledger: interleavingLedger,
        seam: seamA.seam,
        passId: "pass-a",
        ownerId: "watch-a",
        lease: { leaseDurationMs: 60_000 },
        budgets: {
          maxPolls: 2,
          maxPollStartElapsedMs: 600_000,
          observationTimeoutMs: OBSERVATION_TIMEOUT_MS,
        },
      }),
    );

    expect(resultA.ok).toBe(true);
    expect(outcomeB).not.toBeNull();
    const resultB = outcomeB as unknown as Awaited<
      ReturnType<typeof runDevSquadAdoWorkflowWatchPass>
    >;
    expect(resultB.ok).toBe(true);
    if (!resultA.ok || !resultB.ok) return;

    // B delivered its own advance exactly once.
    expect(resultB.value.signals).toHaveLength(1);
    expect(resultB.value.outcomes[0]).toMatchObject({ kind: "acted" });

    // A wrote nothing. Re-observing on the second poll against the durable
    // anchor "15" finds no new activity, so no signal is produced for events
    // that were already delivered to B.
    expect(resultA.value.polls).toBe(2);
    expect(resultA.value.outcomes[0]).toMatchObject({
      kind: "no-change",
      reason: "no-new-observations",
    });
    expect(resultA.value.signals).toEqual([]);

    // The regression this guards: A must never write "12" over "15".
    expect(checkpointPatches).toEqual(["15"]);
    const durable = await fixture.ledger.readRecord(137);
    expect(durable).toMatchObject({
      ok: true,
      value: {
        observations: { workItemCommentId: "15" },
        activeClaim: null,
      },
    });

    // A re-observed from the advanced anchor rather than from its stale one.
    expect(seamA.calls.map((call) => call.since)).toEqual(["10", "15"]);
  }, 120_000);

  it("[TEST-009][CC-022] reports a stale observation with its own reason and releases the claim", async () => {
    const fixture = await createWatcherLedgerFixture(ledgerClock);
    await seedWatcherRecord(fixture.ledger, {
      workItemId: 137,
      revision: 4,
      phase: "implement",
      status: "ready",
      workItemCommentId: "10",
    });

    let interleaved = false;
    const interleavingLedger: DevSquadAdoWorkflowLedger = {
      ...fixture.ledger,
      acquireClaim: async (input) => {
        if (!interleaved) {
          interleaved = true;
          await runDevSquadAdoWorkflowWatchPass(
            passOptions({
              ledger: fixture.ledger,
              seam: createRecordingWatcherSeam({
                comments: () => ({ commentIds: ["10", "15"] }),
              }).seam,
              passId: "pass-b",
              ownerId: "watch-b",
              lease: { leaseDurationMs: 60_000 },
            }),
          );
        }
        return await fixture.ledger.acquireClaim(input);
      },
    };

    const outcome = await runDevSquadAdoWorkflowWatchPass(
      passOptions({
        ledger: interleavingLedger,
        seam: createRecordingWatcherSeam({
          comments: () => ({ commentIds: ["10", "11", "12"] }),
        }).seam,
        passId: "pass-a",
        lease: { leaseDurationMs: 60_000 },
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.outcomes[0]).toMatchObject({
      kind: "no-change",
      reason: "stale-observation",
      revision: null,
      cursorChanges: [],
    });
    expect(outcome.value.counts).toMatchObject({ eligible: 0, acted: 0 });
    expect(outcome.value.signals).toEqual([]);

    // The claim A briefly held is released rather than left to expire.
    const durable = await fixture.ledger.readRecord(137);
    expect(durable).toMatchObject({
      ok: true,
      value: {
        observations: { workItemCommentId: "15" },
        activeClaim: null,
      },
    });
  }, 120_000);

  it("[TEST-009][CC-005] rejects a superseded fencing value without advancing anything", async () => {
    let ledgerNow = new Date(LEDGER_NOW).getTime();
    const repositoryRoot = await makeWatcherRepository();
    const ledger = await openWatcherLedger(
      repositoryRoot,
      () => new Date(ledgerNow),
    );
    await seedWatcherRecord(ledger, {
      workItemId: 137,
      revision: 4,
      phase: "implement",
      status: "ready",
      workItemCommentId: "480",
    });
    const beforeTakeover = await ledger.readRecord(137);
    expect(beforeTakeover.ok).toBe(true);
    if (!beforeTakeover.ok) return;

    let takenOver = false;
    const takeovers: string[] = [];
    const takeoverLedger: DevSquadAdoWorkflowLedger = {
      ...ledger,
      checkpoint: async (input: CheckpointDevSquadAdoWorkflowInput) => {
        if (!takenOver) {
          takenOver = true;
          ledgerNow += 61_000;
          const stolen = await ledger.acquireClaim({
            workItemId: 137,
            operationId: "watch-b-takeover",
            ownerId: "watch-b",
            claimToken: Buffer.alloc(32, 11).toString("base64url"),
            leaseDurationMs: 60_000,
          });
          takeovers.push(stolen.ok ? "ok" : stolen.error.kind);
        }
        return await ledger.checkpoint(input);
      },
    };

    const seam = createRecordingWatcherSeam({ comments: twoNewComments });
    const outcome = await runDevSquadAdoWorkflowWatchPass(
      passOptions({
        ledger: takeoverLedger,
        seam: seam.seam,
        passId: "pass-a",
        ownerId: "watch-a",
        lease: { leaseDurationMs: 60_000 },
      }),
    );

    // Asserted outside the injected wrapper so a failure here can never be
    // reshaped into a candidate outcome by the watcher's own call stack.
    expect(takeovers).toEqual(["ok"]);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.signals).toEqual([]);
    expect(outcome.value.outcomes[0]).toMatchObject({
      workItemId: "137",
      kind: "failed",
      reason: "stale-fencing",
      revision: null,
    });

    const durable = await ledger.readRecord(137);
    expect(durable.ok).toBe(true);
    if (!durable.ok) return;
    expect(durable.value.observations.workItemCommentId).toBe("480");
    expect(durable.value.activeClaim).toMatchObject({ ownerId: "watch-b" });
    expect(durable.value.checkpoints).toEqual(beforeTakeover.value.checkpoints);
  }, 120_000);

  it("[TEST-013][CC-006] ends the candidate step on revision and state conflicts while the pass continues", async () => {
    for (const scenario of ["revision-conflict", "state-conflict"] as const) {
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

      let drifted = false;
      const competing: string[] = [];
      const driftingLedger: DevSquadAdoWorkflowLedger = {
        ...fixture.ledger,
        acquireClaim: async (input) => {
          const acquired = await fixture.ledger.acquireClaim(input);
          if (!acquired.ok || drifted || input.workItemId !== "137")
            return acquired;
          drifted = true;
          if (scenario === "state-conflict") {
            return {
              ok: true,
              value: {
                ...acquired.value,
                record: { ...acquired.value.record, status: "drifted" },
              },
            };
          }
          const authority = acquired.value.outcome.authority;
          const written = await fixture.ledger.checkpoint({
            workItemId: input.workItemId,
            operationId: "competing-writer",
            authority: {
              ownerId: authority.ownerId,
              claimToken: authority.claimToken,
              fencingValue: authority.fencingValue,
            },
            expected: {
              revision: acquired.value.record.revision,
              phase: acquired.value.record.phase,
              status: acquired.value.record.status,
            },
            patch: { status: "ready" },
          });
          competing.push(written.ok ? "ok" : written.error.kind);
          return acquired;
        },
      };

      const seam = createRecordingWatcherSeam({ comments: twoNewComments });
      const outcome = await runDevSquadAdoWorkflowWatchPass(
        passOptions({
          ledger: driftingLedger,
          seam: seam.seam,
          candidates: [137, 42],
        }),
      );

      // Asserted outside the injected wrapper so a failure here can never be
      // reshaped into a candidate outcome by the watcher's own call stack.
      expect(competing, scenario).toEqual(
        scenario === "state-conflict" ? [] : ["ok"],
      );
      expect(outcome.ok, scenario).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.value.outcomes[0], scenario).toMatchObject({
        workItemId: "137",
        kind: "failed",
        reason: scenario,
        revision: null,
      });
      expect(outcome.value.outcomes[1], scenario).toMatchObject({
        workItemId: "42",
        kind: "acted",
      });
      expect(outcome.value.signals.map((signal) => signal.workItemId)).toEqual([
        "42",
      ]);

      const blocked = await fixture.ledger.readRecord(137);
      expect(blocked.ok).toBe(true);
      if (!blocked.ok) return;
      expect(blocked.value.observations.workItemCommentId, scenario).toBe(
        "480",
      );
      expect(blocked.value.activeClaim, scenario).toBeNull();
      await cleanupWatcherRepositories();
    }
  }, 180_000);
});

describe("DevSquadAdoWorkflowWatcher claim authority outcomes", () => {
  it("[TEST-009] reports a lease that expired under the watcher as claim-expired", async () => {
    let ledgerNow = new Date(LEDGER_NOW).getTime();
    const repositoryRoot = await makeWatcherRepository();
    const ledger = await openWatcherLedger(
      repositoryRoot,
      () => new Date(ledgerNow),
    );
    await seedWatcherRecord(ledger, {
      workItemId: 137,
      revision: 4,
      phase: "implement",
      status: "ready",
      workItemCommentId: "480",
    });
    const before = await ledger.readRecord(137);

    // The lease reaches its inclusive expiry between the acquisition and the
    // checkpoint. The single poll reading stays far inside the renewal
    // threshold, so the watcher issues the mutation believing its claim is
    // live and the ledger is the only party that knows otherwise.
    const expiringLedger: DevSquadAdoWorkflowLedger = {
      ...ledger,
      checkpoint: async (input: CheckpointDevSquadAdoWorkflowInput) => {
        ledgerNow += 3_600_001;
        return await ledger.checkpoint(input);
      },
    };

    const seam = createRecordingWatcherSeam({ comments: twoNewComments });
    const outcome = await runDevSquadAdoWorkflowWatchPass(
      passOptions({
        ledger: expiringLedger,
        seam: seam.seam,
        lease: { leaseDurationMs: 3_600_000 },
      }),
    );

    expect(outcome.ok).toBe(true);
    expect(before.ok).toBe(true);
    if (!outcome.ok || !before.ok) return;
    expect(outcome.value.outcomes[0]).toMatchObject({
      workItemId: "137",
      kind: "failed",
      reason: "claim-expired",
      revision: null,
      ledgerErrorKind: null,
    });
    expect(outcome.value.signals).toEqual([]);
    expect(outcome.value.counts).toMatchObject({ acted: 0, failed: 1 });

    const durable = await ledger.readRecord(137);
    expect(durable.ok).toBe(true);
    if (!durable.ok) return;
    expect(durable.value.observations.workItemCommentId).toBe("480");
    expect(durable.value.checkpoints).toEqual(before.value.checkpoints);
    // The expired lease is the watcher's own, and releasing it needs the same
    // authority the ledger just refused, so expiry stays the backstop.
    expect(durable.value.activeClaim).toMatchObject({ ownerId: "watch-a" });
  }, 60_000);

  it("[TEST-009] reports an unusable claim capability as claim-authorization", async () => {
    const fixture = await createWatcherLedgerFixture(ledgerClock);
    await seedWatcherRecord(fixture.ledger, {
      workItemId: 137,
      revision: 4,
      phase: "implement",
      status: "ready",
      workItemCommentId: "480",
    });
    const before = await fixture.ledger.readRecord(137);

    // The acquisition is durably accepted but hands back a capability that no
    // longer matches the persisted verifier, so the claimed mutation is
    // refused on authority while the fence and the lease are both current.
    const tamperedLedger: DevSquadAdoWorkflowLedger = {
      ...fixture.ledger,
      acquireClaim: async (input) => {
        const acquired = await fixture.ledger.acquireClaim(input);
        if (!acquired.ok) return acquired;
        return {
          ok: true,
          value: {
            ...acquired.value,
            outcome: {
              ...acquired.value.outcome,
              authority: {
                ...acquired.value.outcome.authority,
                claimToken: Buffer.alloc(32, 23).toString("base64url"),
              },
            },
          },
        };
      },
    };

    const seam = createRecordingWatcherSeam({ comments: twoNewComments });
    const outcome = await runDevSquadAdoWorkflowWatchPass(
      passOptions({
        ledger: tamperedLedger,
        seam: seam.seam,
        lease: { leaseDurationMs: 60_000 },
      }),
    );

    expect(outcome.ok).toBe(true);
    expect(before.ok).toBe(true);
    if (!outcome.ok || !before.ok) return;
    expect(outcome.value.outcomes[0]).toMatchObject({
      workItemId: "137",
      kind: "failed",
      reason: "claim-authorization",
      revision: null,
      ledgerErrorKind: null,
    });
    expect(outcome.value.signals).toEqual([]);
    expect(outcome.value.counts).toMatchObject({ acted: 0, failed: 1 });

    const durable = await fixture.ledger.readRecord(137);
    expect(durable.ok).toBe(true);
    if (!durable.ok) return;
    expect(durable.value.observations.workItemCommentId).toBe("480");
    expect(durable.value.checkpoints).toEqual(before.value.checkpoints);
    expect(durable.value.activeClaim).toMatchObject({ ownerId: "watch-a" });
  }, 60_000);

  it("[TEST-009] keeps each claim-authority failure a distinct outcome instead of one conflict code", async () => {
    const fixture = await createWatcherLedgerFixture(ledgerClock);
    await seedWatcherRecord(fixture.ledger, {
      workItemId: 137,
      revision: 4,
      phase: "implement",
      status: "ready",
      workItemCommentId: "480",
    });
    const before = await fixture.ledger.readRecord(137);
    const foreignClaim = {
      workItemId: "137",
      ownerId: "watch-b",
      fencingValue: 9,
      acquiredAt: LEDGER_NOW,
      heartbeatAt: LEDGER_NOW,
      expiresAt: "2026-01-01T01:00:00.000Z",
    };

    const acquisitions: readonly {
      readonly passId: string;
      readonly error: DevSquadAdoLedgerError;
      readonly reason: DevSquadAdoWatchReasonCode;
    }[] = [
      {
        passId: "acquire-conflict",
        error: { kind: "claim-conflict", claim: foreignClaim },
        reason: "claim-conflict",
      },
      {
        passId: "acquire-expired",
        error: { kind: "claim-expired", expiredAt: LEDGER_NOW },
        reason: "claim-expired",
      },
      {
        passId: "acquire-authorization",
        error: { kind: "claim-authorization" },
        reason: "claim-authorization",
      },
      {
        passId: "acquire-fencing",
        error: { kind: "stale-fencing", currentFencingValue: 9 },
        reason: "stale-fencing",
      },
    ];

    for (const testCase of acquisitions) {
      const seam = createRecordingWatcherSeam({ comments: twoNewComments });
      const outcome = await runDevSquadAdoWorkflowWatchPass(
        passOptions({
          ledger: {
            ...fixture.ledger,
            acquireClaim: async () => ({ ok: false, error: testCase.error }),
          },
          seam: seam.seam,
          passId: testCase.passId,
        }),
      );
      expect(outcome.ok, testCase.passId).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.value.outcomes[0], testCase.passId).toMatchObject({
        workItemId: "137",
        kind: "skipped",
        reason: testCase.reason,
        revision: null,
        claim: null,
      });
      expect(outcome.value.signals, testCase.passId).toEqual([]);
    }

    const mutations: readonly {
      readonly passId: string;
      readonly error: DevSquadAdoLedgerError;
      readonly reason: DevSquadAdoWatchReasonCode;
    }[] = [
      {
        passId: "mutate-expired",
        error: { kind: "claim-expired", expiredAt: LEDGER_NOW },
        reason: "claim-expired",
      },
      {
        // A claim that is simply gone is reported as an expired lease: both
        // mean the watcher no longer holds the record.
        passId: "mutate-not-held",
        error: { kind: "claim-not-held" },
        reason: "claim-expired",
      },
      {
        passId: "mutate-authorization",
        error: { kind: "claim-authorization" },
        reason: "claim-authorization",
      },
    ];

    for (const testCase of mutations) {
      const seam = createRecordingWatcherSeam({ comments: twoNewComments });
      const outcome = await runDevSquadAdoWorkflowWatchPass(
        passOptions({
          ledger: {
            ...fixture.ledger,
            checkpoint: async () => ({ ok: false, error: testCase.error }),
          },
          seam: seam.seam,
          passId: testCase.passId,
        }),
      );
      expect(outcome.ok, testCase.passId).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.value.outcomes[0], testCase.passId).toMatchObject({
        workItemId: "137",
        kind: "failed",
        reason: testCase.reason,
        revision: null,
        ledgerErrorKind: null,
      });
      expect(outcome.value.signals, testCase.passId).toEqual([]);
    }

    const durable = await fixture.ledger.readRecord(137);
    expect(durable.ok).toBe(true);
    expect(before.ok).toBe(true);
    if (!durable.ok || !before.ok) return;
    expect(durable.value.observations.workItemCommentId).toBe("480");
    expect(durable.value.checkpoints).toEqual(before.value.checkpoints);
    expect(durable.value.activeClaim).toBeNull();
  }, 120_000);
});

describe("DevSquadAdoWorkflowWatcher operation identity", () => {
  it("[TEST-012] derives stable, delimiter-safe, ASCII operation identifiers", () => {
    const generation = {
      fromWorkItemCommentId: "480",
      fromPullRequest: null,
      toWorkItemCommentId: "481",
      toPullRequest: null,
    } as const;
    const identity = {
      step: "checkpoint",
      passId: "pass-1",
      workItemId: "137",
      ordinal: 0,
      generation,
    } as const;
    const derived = deriveDevSquadAdoWatcherOperationId(identity);
    expect(derived).toBe(deriveDevSquadAdoWatcherOperationId({ ...identity }));
    expect(derived).toMatch(/^dsw2\.checkpoint\.[0-9a-f]{32}$/);
    expect(Buffer.byteLength(derived, "utf8")).toBe(derived.length);
    expect(derived.length).toBe(48);
    expect(derived.length).toBeLessThanOrEqual(256);

    for (const step of ["claim", "renew", "release"] as const) {
      const other = deriveDevSquadAdoWatcherOperationId({
        step,
        passId: "pass-1",
        workItemId: "137",
        ordinal: 0,
        claimEpoch: "epoch-1",
      });
      expect(other.startsWith(`dsw2.${step}.`)).toBe(true);
      expect(other.length).toBe(`dsw2.${step}.`.length + 32);
      expect(other).not.toBe(derived);
    }

    const renewIdentity = {
      step: "renew",
      passId: "pass-1",
      workItemId: "137",
      claimEpoch: "epoch-1",
    } as const;
    expect(
      deriveDevSquadAdoWatcherOperationId({ ...renewIdentity, ordinal: 1 }),
    ).not.toBe(
      deriveDevSquadAdoWatcherOperationId({ ...renewIdentity, ordinal: 2 }),
    );

    // A claim-lifecycle identifier is scoped to its acquisition, so a second
    // acquisition under the same pass identity never reuses the first one's
    // ledger receipt — the whole reason the same `passId` stays replayable.
    for (const step of ["claim", "renew", "release"] as const) {
      const scoped = {
        step,
        passId: "pass-1",
        workItemId: "137",
        ordinal: step === "renew" ? 1 : 0,
      } as const;
      expect(
        deriveDevSquadAdoWatcherOperationId({
          ...scoped,
          claimEpoch: "epoch-1",
        }),
      ).not.toBe(
        deriveDevSquadAdoWatcherOperationId({
          ...scoped,
          claimEpoch: "epoch-2",
        }),
      );
    }

    // A checkpoint identifier is scoped to the advance it publishes: the same
    // advance replays, a different advance is a different operation.
    expect(
      deriveDevSquadAdoWatcherOperationId({
        ...identity,
        generation: { ...generation },
      }),
    ).toBe(derived);
    expect(
      deriveDevSquadAdoWatcherOperationId({
        ...identity,
        generation: { ...generation, toWorkItemCommentId: "482" },
      }),
    ).not.toBe(derived);
    expect(
      deriveDevSquadAdoWatcherOperationId({
        ...identity,
        generation: { ...generation, fromWorkItemCommentId: "479" },
      }),
    ).not.toBe(derived);
    expect(
      deriveDevSquadAdoWatcherOperationId({
        ...identity,
        generation: {
          ...generation,
          toPullRequest: { threadId: "t1", commentId: "c1" },
        },
      }),
    ).not.toBe(derived);

    // Canonical serialization removes delimiter ambiguity between a long pass
    // identifier with a short work item and the transposed pair.
    expect(
      deriveDevSquadAdoWatcherOperationId({
        ...identity,
        passId: "abc",
        workItemId: "de",
      }),
    ).not.toBe(
      deriveDevSquadAdoWatcherOperationId({
        ...identity,
        passId: "ab",
        workItemId: "cde",
      }),
    );
  });

  it("[TEST-012] replays a derived checkpoint and rejects a reused identifier carrying different data", async () => {
    const fixture = await createWatcherLedgerFixture(ledgerClock);
    await seedWatcherRecord(fixture.ledger, {
      workItemId: 137,
      revision: 4,
      phase: "implement",
      status: "ready",
      workItemCommentId: "480",
    });
    const claimToken = Buffer.alloc(32, 5).toString("base64url");
    const acquired = await fixture.ledger.acquireClaim({
      workItemId: 137,
      operationId: deriveDevSquadAdoWatcherOperationId({
        step: "claim",
        passId: "pass-1",
        workItemId: "137",
        ordinal: 0,
        claimEpoch: "epoch-1",
      }),
      ownerId: "watch-a",
      claimToken,
      leaseDurationMs: 60_000,
    });
    expect(acquired.ok).toBe(true);
    if (!acquired.ok) return;
    const authority = {
      ownerId: "watch-a",
      claimToken,
      fencingValue: acquired.value.outcome.authority.fencingValue,
    };
    const request: CheckpointDevSquadAdoWorkflowInput = {
      workItemId: 137,
      operationId: deriveDevSquadAdoWatcherOperationId({
        step: "checkpoint",
        passId: "pass-1",
        workItemId: "137",
        ordinal: 0,
        generation: {
          fromWorkItemCommentId: "480",
          fromPullRequest: null,
          toWorkItemCommentId: "481",
          toPullRequest: null,
        },
      }),
      authority,
      expected: {
        revision: acquired.value.record.revision,
        phase: "implement",
        status: "ready",
      },
      patch: { observations: { workItemCommentId: "481" } },
    };

    const first = await fixture.ledger.checkpoint(request);
    expect(first).toMatchObject({ ok: true, value: { replayed: false } });
    if (!first.ok) return;

    const replayed = await fixture.ledger.checkpoint(request);
    expect(replayed).toMatchObject({
      ok: true,
      value: { replayed: true, acceptedRevision: first.value.acceptedRevision },
    });

    const conflicting = await fixture.ledger.checkpoint({
      ...request,
      patch: { observations: { workItemCommentId: "482" } },
    });
    expect(conflicting).toMatchObject({
      ok: false,
      error: { kind: "idempotency-conflict" },
    });

    const durable = await fixture.ledger.readRecord(137);
    expect(durable).toMatchObject({
      ok: true,
      value: {
        revision: first.value.acceptedRevision,
        observations: { workItemCommentId: "481" },
      },
    });
  }, 60_000);

  it("[TEST-012][CC-021] keeps the same pass identity replayable after a durable acquire whose checkpoint never landed", async () => {
    const fixture = await createWatcherLedgerFixture(ledgerClock);
    await seedWatcherRecord(fixture.ledger, {
      workItemId: 137,
      revision: 4,
      phase: "implement",
      status: "ready",
      workItemCommentId: "480",
    });

    // First attempt: the claim is acquired durably, then the checkpoint never
    // reaches storage. The claim is released on the way out, so nothing but the
    // acquisition receipt survives.
    const acquireOperationIds: string[] = [];
    const neverCheckpointsLedger: DevSquadAdoWorkflowLedger = {
      ...fixture.ledger,
      acquireClaim: async (input) => {
        acquireOperationIds.push(input.operationId);
        return await fixture.ledger.acquireClaim(input);
      },
      checkpoint: async () => ({
        ok: false,
        error: { kind: "storage", outcome: "unchanged" },
      }),
    };

    const firstSeam = createRecordingWatcherSeam({ comments: twoNewComments });
    const first = await runDevSquadAdoWorkflowWatchPass(
      passOptions({
        ledger: neverCheckpointsLedger,
        seam: firstSeam.seam,
      }),
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.outcomes[0]).toMatchObject({ kind: "failed" });

    const afterFirst = await fixture.ledger.readRecord(137);
    expect(afterFirst).toMatchObject({
      ok: true,
      value: {
        observations: { workItemCommentId: "480" },
        activeClaim: null,
      },
    });

    // Retrying the *same* pass identity must be able to acquire again. The
    // ledger folds the random capability token into its idempotency digest, so
    // an acquisition identifier that ignored the acquisition attempt would make
    // this second acquire a permanent `idempotency-conflict` — poisoning the
    // pass identity for this candidate with no cursor ever advanced.
    const retrySeam = createRecordingWatcherSeam({ comments: twoNewComments });
    const retried = await runDevSquadAdoWorkflowWatchPass(
      passOptions({
        ledger: {
          ...fixture.ledger,
          acquireClaim: async (input) => {
            acquireOperationIds.push(input.operationId);
            return await fixture.ledger.acquireClaim(input);
          },
        },
        seam: retrySeam.seam,
      }),
    );

    expect(retried.ok).toBe(true);
    if (!retried.ok) return;
    expect(retried.value.outcomes[0]).toMatchObject({
      kind: "acted",
      reason: "new-work-item-comment",
    });
    expect(retried.value.signals).toHaveLength(1);

    // Both acquisitions ran under one pass identity and one work item, and each
    // still carried its own operation identifier.
    expect(acquireOperationIds).toHaveLength(2);
    expect(acquireOperationIds[0]).not.toBe(acquireOperationIds[1]);
    for (const operationId of acquireOperationIds)
      expect(operationId).toMatch(/^dsw2\.claim\.[0-9a-f]{32}$/);

    const durable = await fixture.ledger.readRecord(137);
    expect(durable).toMatchObject({
      ok: true,
      value: {
        observations: { workItemCommentId: "481" },
        activeClaim: null,
      },
    });
  }, 60_000);

  it("[TEST-012] scopes every claim-lifecycle identifier to its own acquisition", async () => {
    const fixture = await createWatcherLedgerFixture(ledgerClock);
    await seedWatcherRecord(fixture.ledger, {
      workItemId: 137,
      revision: 4,
      phase: "implement",
      status: "ready",
      workItemCommentId: "480",
    });

    const claimIds: string[] = [];
    const renewIds: string[] = [];
    const releaseIds: string[] = [];
    const recordingLedger: DevSquadAdoWorkflowLedger = {
      ...fixture.ledger,
      acquireClaim: async (input) => {
        claimIds.push(input.operationId);
        return await fixture.ledger.acquireClaim(input);
      },
      renewClaim: async (input) => {
        renewIds.push(input.operationId);
        return await fixture.ledger.renewClaim(input);
      },
      releaseClaim: async (input) => {
        releaseIds.push(input.operationId);
        return await fixture.ledger.releaseClaim(input);
      },
    };

    // Two passes under one pass identity: the first advances 480 -> 481, the
    // second advances 481 -> 482. Both acquire, renew, and release.
    for (const commentIds of [
      ["480", "481"],
      ["481", "482"],
    ]) {
      const seam = createRecordingWatcherSeam({
        comments: () => ({ commentIds }),
      });
      const outcome = await runDevSquadAdoWorkflowWatchPass(
        passOptions({
          ledger: recordingLedger,
          seam: seam.seam,
          // A one-millisecond renewal headroom forces a renewal before every
          // checkpoint, so the renew identifiers are exercised too.
          lease: { leaseDurationMs: 60_000, renewalThresholdMs: 59_999 },
        }),
      );
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.value.outcomes[0]).toMatchObject({ kind: "acted" });
    }

    expect(claimIds).toHaveLength(2);
    expect(renewIds).toHaveLength(2);
    expect(releaseIds).toHaveLength(2);
    for (const ids of [claimIds, renewIds, releaseIds])
      expect(new Set(ids).size).toBe(ids.length);

    // Every identifier the two passes issued is distinct, so no receipt from
    // the first acquisition can ever collide with the second.
    const all = [...claimIds, ...renewIds, ...releaseIds];
    expect(new Set(all).size).toBe(all.length);

    const durable = await fixture.ledger.readRecord(137);
    expect(durable).toMatchObject({
      ok: true,
      value: { observations: { workItemCommentId: "482" } },
    });
  }, 60_000);
});

describe("DevSquadAdoWorkflowWatcher claim lifecycle", () => {
  it("[TEST-010][CC-014] holds the claim across polls, renews before expiry, and replays the same checkpoint request", async () => {
    const fixture = await createWatcherLedgerFixture(ledgerClock);
    await seedWatcherRecord(fixture.ledger, {
      workItemId: 137,
      revision: 4,
      phase: "implement",
      status: "ready",
      workItemCommentId: "480",
    });

    const checkpointCalls: CheckpointDevSquadAdoWorkflowInput[] = [];
    const renewCalls: RenewDevSquadAdoWorkflowClaimInput[] = [];
    const ambiguousLedger: DevSquadAdoWorkflowLedger = {
      ...fixture.ledger,
      renewClaim: async (input) => {
        renewCalls.push(input);
        return await fixture.ledger.renewClaim(input);
      },
      checkpoint: async (input) => {
        checkpointCalls.push(input);
        if (checkpointCalls.length === 1)
          return {
            ok: false,
            error: { kind: "storage", outcome: "indeterminate" },
          };
        return await fixture.ledger.checkpoint(input);
      },
    };

    const seam = createRecordingWatcherSeam({ comments: twoNewComments });
    const outcome = await runDevSquadAdoWorkflowWatchPass(
      passOptions({
        ledger: ambiguousLedger,
        seam: seam.seam,
        budgets: {
          maxPolls: 3,
          maxPollStartElapsedMs: 600_000,
          observationTimeoutMs: OBSERVATION_TIMEOUT_MS,
        },
        lease: { leaseDurationMs: 60_000, renewalThresholdMs: 20_000 },
        clock: createDeterministicClock([
          "2026-01-01T00:00:00.000Z",
          "2026-01-01T00:00:00.000Z",
          "2026-01-01T00:00:45.000Z",
        ]).clock,
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.polls).toBe(2);
    expect(outcome.value.outcomes[0]).toMatchObject({
      kind: "acted",
      reason: "new-work-item-comment",
    });
    expect(outcome.value.signals).toHaveLength(1);

    expect(checkpointCalls).toHaveLength(2);
    expect(checkpointCalls[1]?.operationId).toBe(
      checkpointCalls[0]?.operationId,
    );
    expect(checkpointCalls[1]?.operationId).toBe(
      watcherCommentCheckpointOperationId({
        passId: "pass-1",
        workItemId: "137",
        from: "480",
        to: "481",
      }),
    );
    expect(checkpointCalls[1]?.patch).toEqual(checkpointCalls[0]?.patch);
    expect(checkpointCalls[1]?.expected.phase).toBe(
      checkpointCalls[0]?.expected.phase,
    );
    expect(checkpointCalls[1]?.expected.status).toBe(
      checkpointCalls[0]?.expected.status,
    );
    // The renewal is itself a ledger mutation, so the optimistic precondition
    // is refreshed from the renewal response instead of replaying a stale one.
    expect(checkpointCalls[1]?.expected.revision).toBe(
      (checkpointCalls[0]?.expected.revision ?? 0) + 1,
    );
    expect(checkpointCalls[1]?.authority.fencingValue).toBe(
      checkpointCalls[0]?.authority.fencingValue,
    );

    // Only the second poll is inside the renewal threshold of the inclusive
    // expiry, and renewal preserves the fence.
    expect(renewCalls).toHaveLength(1);
    expect(renewCalls[0]?.operationId).toMatch(/^dsw2\.renew\.[0-9a-f]{32}$/);
    expect(renewCalls[0]?.authority.fencingValue).toBe(
      checkpointCalls[0]?.authority.fencingValue,
    );

    // The seam is consulted once for the eligible poll only; the held-claim
    // retry never re-observes.
    expect(seam.calls).toHaveLength(1);

    const durable = await fixture.ledger.readRecord(137);
    expect(durable.ok).toBe(true);
    if (!durable.ok) return;
    expect(durable.value.observations.workItemCommentId).toBe("481");
    expect(durable.value.activeClaim).toBeNull();
  }, 120_000);

  it("[TEST-010] completes from the durable checkpoint history when an acknowledgement is lost", async () => {
    const fixture = await createWatcherLedgerFixture(ledgerClock);
    await seedWatcherRecord(fixture.ledger, {
      workItemId: 137,
      revision: 4,
      phase: "implement",
      status: "ready",
      workItemCommentId: "480",
    });

    let attempts = 0;
    let acceptedRevision = 0;
    const firstAttempt: string[] = [];
    const lostAcknowledgementLedger: DevSquadAdoWorkflowLedger = {
      ...fixture.ledger,
      checkpoint: async (input) => {
        attempts += 1;
        const result = await fixture.ledger.checkpoint(input);
        if (attempts === 1) {
          firstAttempt.push(result.ok ? "ok" : result.error.kind);
          if (result.ok) acceptedRevision = result.value.acceptedRevision;
          return {
            ok: false,
            error: { kind: "storage", outcome: "indeterminate" },
          };
        }
        return result;
      },
    };

    const seam = createRecordingWatcherSeam({ comments: twoNewComments });
    const outcome = await runDevSquadAdoWorkflowWatchPass(
      passOptions({
        ledger: lostAcknowledgementLedger,
        seam: seam.seam,
        budgets: {
          maxPolls: 3,
          maxPollStartElapsedMs: 600_000,
          observationTimeoutMs: OBSERVATION_TIMEOUT_MS,
        },
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // Asserted outside the injected wrapper so a failure here can never be
    // reshaped into a candidate outcome by the watcher's own call stack.
    expect(firstAttempt).toEqual(["ok"]);
    expect(attempts).toBe(1);
    expect(outcome.value.polls).toBe(2);
    expect(outcome.value.outcomes[0]).toMatchObject({
      kind: "acted",
      reason: "new-work-item-comment",
      revision: acceptedRevision,
    });
    expect(outcome.value.signals).toHaveLength(1);

    const durable = await fixture.ledger.readRecord(137);
    expect(durable.ok).toBe(true);
    if (!durable.ok) return;
    expect(durable.value.observations.workItemCommentId).toBe("481");
    expect(durable.value.activeClaim).toBeNull();
    expect(
      durable.value.checkpoints.filter(
        (checkpoint) =>
          checkpoint.operationId ===
          watcherCommentCheckpointOperationId({
            passId: "pass-1",
            workItemId: "137",
            from: "480",
            to: "481",
          }),
      ),
    ).toHaveLength(1);
  }, 120_000);

  it("[TEST-010] reports checkpoint-indeterminate and releases the claim when the budget ends first", async () => {
    const fixture = await createWatcherLedgerFixture(ledgerClock);
    await seedWatcherRecord(fixture.ledger, {
      workItemId: 137,
      revision: 4,
      phase: "implement",
      status: "ready",
      workItemCommentId: "480",
    });
    const stuckLedger: DevSquadAdoWorkflowLedger = {
      ...fixture.ledger,
      checkpoint: async () => ({
        ok: false,
        error: { kind: "contention", attempts: 32 },
      }),
    };

    const seam = createRecordingWatcherSeam({ comments: twoNewComments });
    const outcome = await runDevSquadAdoWorkflowWatchPass(
      passOptions({
        ledger: stuckLedger,
        seam: seam.seam,
        budgets: {
          maxPolls: 2,
          maxPollStartElapsedMs: 600_000,
          observationTimeoutMs: OBSERVATION_TIMEOUT_MS,
        },
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.polls).toBe(2);
    expect(outcome.value.stopReason).toBe("poll-budget-exhausted");
    expect(outcome.value.outcomes[0]).toMatchObject({
      kind: "failed",
      reason: "checkpoint-indeterminate",
    });
    expect(outcome.value.signals).toEqual([]);

    const durable = await fixture.ledger.readRecord(137);
    expect(durable.ok).toBe(true);
    if (!durable.ok) return;
    expect(durable.value.activeClaim).toBeNull();
    expect(durable.value.observations.workItemCommentId).toBe("480");
  }, 120_000);

  it("[TEST-011] releases claims on success, on candidate failure, and on cancellation", async () => {
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
    const controller = new AbortController();
    const releases: ReleaseDevSquadAdoWorkflowClaimInput[] = [];
    const scriptedLedger: DevSquadAdoWorkflowLedger = {
      ...fixture.ledger,
      releaseClaim: async (input) => {
        releases.push(input);
        return await fixture.ledger.releaseClaim(input);
      },
      checkpoint: async (input) => {
        if (input.workItemId === "42")
          return {
            ok: false,
            error: {
              kind: "revision-conflict",
              expectedRevision: input.expected.revision,
              currentRevision: input.expected.revision + 1,
            },
          };
        if (input.workItemId === "9001") {
          controller.abort();
          return {
            ok: false,
            error: { kind: "storage", outcome: "indeterminate" },
          };
        }
        return await fixture.ledger.checkpoint(input);
      },
    };

    const seam = createRecordingWatcherSeam({ comments: twoNewComments });
    const outcome = await runDevSquadAdoWorkflowWatchPass(
      passOptions({
        ledger: scriptedLedger,
        seam: seam.seam,
        candidates: [137, 42, 9001],
        budgets: {
          maxPolls: 3,
          maxPollStartElapsedMs: 600_000,
          observationTimeoutMs: OBSERVATION_TIMEOUT_MS,
        },
        signal: controller.signal,
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.stopReason).toBe("cancelled");
    expect(
      outcome.value.outcomes.map((candidate) => [
        candidate.workItemId,
        candidate.kind,
        candidate.reason,
      ]),
    ).toEqual([
      ["137", "acted", "new-work-item-comment"],
      ["42", "failed", "revision-conflict"],
      ["9001", "failed", "cancelled"],
    ]);

    expect(releases.map((release) => release.workItemId).sort()).toEqual([
      "137",
      "42",
      "9001",
    ]);
    for (const release of releases) {
      expect(release.authority.ownerId).toBe("watch-a");
    }
    for (const workItemId of [137, 42, 9001]) {
      const durable = await fixture.ledger.readRecord(workItemId);
      expect(durable.ok).toBe(true);
      if (!durable.ok) return;
      expect(durable.value.activeClaim, String(workItemId)).toBeNull();
    }
  }, 120_000);

  it("[TEST-011] never force-releases a foreign claim during a full pass", async () => {
    let ledgerNow = new Date(LEDGER_NOW).getTime();
    const repositoryRoot = await makeWatcherRepository();
    const ledger = await openWatcherLedger(
      repositoryRoot,
      () => new Date(ledgerNow),
    );
    await seedWatcherRecord(ledger, {
      workItemId: 137,
      revision: 4,
      phase: "implement",
      status: "ready",
      workItemCommentId: "480",
    });
    const foreign = await ledger.acquireClaim({
      workItemId: 137,
      operationId: "foreign",
      ownerId: "watch-b",
      claimToken: Buffer.alloc(32, 17).toString("base64url"),
      leaseDurationMs: 3_600_000,
    });
    expect(foreign).toMatchObject({ ok: true });
    if (!foreign.ok) return;

    const releases: ReleaseDevSquadAdoWorkflowClaimInput[] = [];
    const observedLedger: DevSquadAdoWorkflowLedger = {
      ...ledger,
      releaseClaim: async (input) => {
        releases.push(input);
        return await ledger.releaseClaim(input);
      },
    };
    ledgerNow += 1_000;

    const seam = createRecordingWatcherSeam({ comments: twoNewComments });
    const outcome = await runDevSquadAdoWorkflowWatchPass(
      passOptions({
        ledger: observedLedger,
        seam: seam.seam,
        clock: createDeterministicClock(["2026-01-01T00:00:01.000Z"]).clock,
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.outcomes[0]).toMatchObject({
      kind: "skipped",
      reason: "claim-conflict",
    });
    expect(releases).toEqual([]);

    const durable = await ledger.readRecord(137);
    expect(durable.ok).toBe(true);
    if (!durable.ok) return;
    expect(durable.value.activeClaim).toMatchObject({
      ownerId: "watch-b",
      fencingValue: foreign.value.outcome.authority.fencingValue,
    });
  }, 120_000);
});

describe("DevSquadAdoWorkflowWatcher success criteria", () => {
  it("[SC-002] lets exactly one owner act in every interleaved two-owner trial", async () => {
    const fixture = await createWatcherLedgerFixture(ledgerClock);

    /** One trial's observable verdict, collected outside every ledger wrapper. */
    interface TwoOwnerVerdict {
      /** Work item the trial contended on. */
      readonly workItemId: string;
      /** Passes that produced a structured result. */
      readonly passes: number;
      /** Whether both passes resolved successfully. */
      readonly resolved: boolean;
      /** Passes that acted on the work item. */
      readonly acted: number;
      /** Passes that reported a claim conflict. */
      readonly conflicted: number;
      /** Durable comment cursor after the trial. */
      readonly cursor: string | null;
      /** Whether a claim survived the trial. */
      readonly claimHeld: boolean;
    }

    const runTrial = async (trial: number): Promise<TwoOwnerVerdict> => {
      const workItemId = `sweep-${String(trial)}`;
      await seedWatcherRecord(fixture.ledger, {
        workItemId,
        revision: 1,
        phase: "implement",
        status: "ready",
        workItemCommentId: "c0",
      });

      const seamB = createRecordingWatcherSeam({
        comments: () => ({ commentIds: ["c0", "c1"] }),
      });
      const passB: Awaited<
        ReturnType<typeof runDevSquadAdoWorkflowWatchPass>
      >[] = [];
      const interleavingLedger: DevSquadAdoWorkflowLedger = {
        ...fixture.ledger,
        checkpoint: async (input) => {
          if (passB.length === 0) {
            passB.push(
              await runDevSquadAdoWorkflowWatchPass(
                passOptions({
                  ledger: fixture.ledger,
                  seam: seamB.seam,
                  passId: "sweep-b",
                  ownerId: "watch-b",
                  candidates: [workItemId],
                  lease: { leaseDurationMs: 60_000 },
                }),
              ),
            );
          }
          return await fixture.ledger.checkpoint(input);
        },
      };

      const seamA = createRecordingWatcherSeam({
        comments: () => ({ commentIds: ["c0", "c1"] }),
      });
      const resultA = await runDevSquadAdoWorkflowWatchPass(
        passOptions({
          ledger: interleavingLedger,
          seam: seamA.seam,
          passId: "sweep-a",
          ownerId: "watch-a",
          candidates: [workItemId],
          lease: { leaseDurationMs: 60_000 },
        }),
      );

      const observed = [resultA, ...passB];
      const durable = await fixture.ledger.readRecord(workItemId);
      return {
        workItemId,
        passes: observed.length,
        resolved: observed.every((result) => result.ok) && durable.ok,
        acted: observed.filter(
          (result) =>
            result.ok &&
            result.value.outcomes.some((outcome) => outcome.kind === "acted"),
        ).length,
        conflicted: observed.filter(
          (result) =>
            result.ok &&
            result.value.outcomes.some(
              (outcome) => outcome.reason === "claim-conflict",
            ),
        ).length,
        cursor: durable.ok
          ? durable.value.observations.workItemCommentId
          : null,
        claimHeld: durable.ok ? durable.value.activeClaim !== null : true,
      };
    };

    // Trials are disjoint work items, so a bounded batch only overlaps their
    // I/O; each trial still interleaves its own two owners deterministically.
    const verdicts: TwoOwnerVerdict[] = [];
    for (let start = 0; start < TWO_OWNER_TRIALS; start += TWO_OWNER_BATCH) {
      const size = Math.min(TWO_OWNER_BATCH, TWO_OWNER_TRIALS - start);
      verdicts.push(
        ...(await Promise.all(
          Array.from({ length: size }, (_unused, index) =>
            runTrial(start + index),
          ),
        )),
      );
    }

    expect(verdicts).toHaveLength(TWO_OWNER_TRIALS);
    expect(
      verdicts.filter(
        (verdict) =>
          !(
            verdict.passes === 2 &&
            verdict.resolved &&
            verdict.acted === 1 &&
            verdict.conflicted === 1 &&
            verdict.cursor === "c1" &&
            !verdict.claimHeld
          ),
      ),
    ).toEqual([]);
    expect(verdicts.reduce((total, verdict) => total + verdict.acted, 0)).toBe(
      TWO_OWNER_TRIALS,
    );
    expect(
      verdicts.reduce((total, verdict) => total + verdict.conflicted, 0),
    ).toBe(TWO_OWNER_TRIALS);
  }, 900_000);

  it("[SC-003] never advances a cursor or revision under a superseded fence", async () => {
    let ledgerNow = new Date(LEDGER_NOW).getTime();
    const repositoryRoot = await makeWatcherRepository();
    const ledger = await openWatcherLedger(
      repositoryRoot,
      () => new Date(ledgerNow),
    );

    for (let trial = 0; trial < STALE_FENCING_TRIALS; trial++) {
      const workItemId = `fence-${String(trial)}`;
      await seedWatcherRecord(ledger, {
        workItemId,
        revision: 1,
        phase: "implement",
        status: "ready",
        workItemCommentId: "c0",
      });

      let takenOver = false;
      const takeovers: string[] = [];
      const takeoverLedger: DevSquadAdoWorkflowLedger = {
        ...ledger,
        checkpoint: async (input) => {
          if (!takenOver) {
            takenOver = true;
            ledgerNow += 61_000;
            const stolen = await ledger.acquireClaim({
              workItemId,
              operationId: `takeover-${String(trial)}`,
              ownerId: "watch-b",
              claimToken: Buffer.alloc(32, 11).toString("base64url"),
              leaseDurationMs: 60_000,
            });
            takeovers.push(stolen.ok ? "ok" : stolen.error.kind);
          }
          return await ledger.checkpoint(input);
        },
      };

      const seam = createRecordingWatcherSeam({
        comments: () => ({ commentIds: ["c0", "c1"] }),
      });
      const outcome = await runDevSquadAdoWorkflowWatchPass(
        passOptions({
          ledger: takeoverLedger,
          seam: seam.seam,
          passId: "fence-a",
          ownerId: "watch-a",
          candidates: [workItemId],
          lease: { leaseDurationMs: 60_000 },
          clock: createDeterministicClock([new Date(ledgerNow)]).clock,
        }),
      );

      expect(outcome.ok, workItemId).toBe(true);
      if (!outcome.ok) return;
      // Asserted outside the injected wrapper so a failure here can never be
      // reshaped into a candidate outcome by the watcher's own call stack.
      expect(takeovers, workItemId).toEqual(["ok"]);
      expect(outcome.value.signals, workItemId).toEqual([]);
      expect(outcome.value.outcomes[0], workItemId).toMatchObject({
        kind: "failed",
        reason: "stale-fencing",
        revision: null,
      });

      const durable = await ledger.readRecord(workItemId);
      expect(durable.ok, workItemId).toBe(true);
      if (!durable.ok) return;
      expect(durable.value.observations.workItemCommentId, workItemId).toBe(
        "c0",
      );
      expect(durable.value.checkpoints, workItemId).toEqual([]);
      expect(durable.value.revision, workItemId).toBe(3);
      expect(durable.value.activeClaim?.ownerId, workItemId).toBe("watch-b");
    }
  }, 900_000);

  it("[SC-006] releases or never acquires a claim on every exit path", async () => {
    const releases: ReleaseDevSquadAdoWorkflowClaimInput[] = [];
    const exits = [
      "success",
      "candidate-failure",
      "cancellation",
      "budget-exhaustion",
    ] as const;

    for (const exit of exits) {
      const fixture = await createWatcherLedgerFixture(ledgerClock);
      await seedWatcherRecord(fixture.ledger, {
        workItemId: 137,
        revision: 4,
        phase: "implement",
        status: "ready",
        workItemCommentId: "480",
      });
      const controller = new AbortController();
      const scripted: DevSquadAdoWorkflowLedger = {
        ...fixture.ledger,
        releaseClaim: async (input) => {
          releases.push(input);
          return await fixture.ledger.releaseClaim(input);
        },
        checkpoint: async (input) => {
          if (exit === "candidate-failure")
            return {
              ok: false,
              error: {
                kind: "revision-conflict",
                expectedRevision: input.expected.revision,
                currentRevision: input.expected.revision + 1,
              },
            };
          if (exit === "cancellation") {
            controller.abort();
            return {
              ok: false,
              error: { kind: "storage", outcome: "indeterminate" },
            };
          }
          if (exit === "budget-exhaustion")
            return { ok: false, error: { kind: "contention", attempts: 32 } };
          return await fixture.ledger.checkpoint(input);
        },
      };

      const seam = createRecordingWatcherSeam({ comments: twoNewComments });
      const outcome = await runDevSquadAdoWorkflowWatchPass(
        passOptions({
          ledger: scripted,
          seam: seam.seam,
          budgets: {
            maxPolls: exit === "budget-exhaustion" ? 2 : 1,
            maxPollStartElapsedMs: 600_000,
            observationTimeoutMs: OBSERVATION_TIMEOUT_MS,
          },
          ...(exit === "cancellation" ? { signal: controller.signal } : {}),
        }),
      );

      expect(outcome.ok, exit).toBe(true);
      if (!outcome.ok) return;
      const durable = await fixture.ledger.readRecord(137);
      expect(durable.ok, exit).toBe(true);
      if (!durable.ok) return;
      expect(durable.value.activeClaim, exit).toBeNull();
      await cleanupWatcherRepositories();
    }

    expect(releases.length).toBe(exits.length);
    for (const release of releases) {
      expect(release.authority.ownerId).toBe("watch-a");
    }
  }, 300_000);
});
