import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type {
  DevSquadAdoLedgerError,
  DevSquadAdoWorkflowLedger,
} from "./DevSquadAdoWorkflowLedger.js";
import type { LedgerPersistencePoint } from "./DevSquadAdoWorkflowLedgerPlatform.js";
import { openDevSquadAdoWorkflowLedgerWithRuntime } from "./DevSquadAdoWorkflowLedgerStorage.js";
import {
  interruptPersistenceAt,
  makeLedgerTestRuntime,
} from "./DevSquadAdoWorkflowLedgerTestSupport.js";
import {
  deriveDevSquadAdoWatcherOperationId,
  runDevSquadAdoWorkflowWatchPass,
} from "./DevSquadAdoWorkflowWatcher.js";
import type { RunDevSquadAdoWorkflowWatchPassOptions } from "./DevSquadAdoWorkflowWatcher.js";
import {
  cleanupWatcherRepositories,
  corruptWatcherRecord,
  createDeterministicClock,
  createRecordingDelay,
  createRecordingWatcherSeam,
  createWatcherLedgerFixture,
  makeWatcherRepository,
  openWatcherLedger,
  seedWatcherRecord,
  setWatcherRecordSchemaVersion,
  watcherRecordGenerationPath,
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
    maxPassDurationMs: 600_000,
    observationTimeoutMs: OBSERVATION_TIMEOUT_MS,
  },
  clock: createDeterministicClock([POLL_NOW]).clock,
  delay: createRecordingDelay({
    observationTimeoutMs: OBSERVATION_TIMEOUT_MS,
  }).delay,
  ...overrides,
});

const twoNewComments = () => ({ commentIds: ["480", "481"] });

afterEach(cleanupWatcherRepositories);

describe("DevSquadAdoWorkflowWatcher candidate isolation", () => {
  it("[TEST-019][CC-017] isolates a corrupt artifact and completes the other candidates", async () => {
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
    const corruptedPath = await corruptWatcherRecord(
      fixture.repositoryRoot,
      42,
    );
    const corruptedBefore = await readFile(corruptedPath, "utf8");

    const reopened = await openWatcherLedger(
      fixture.repositoryRoot,
      ledgerClock,
    );
    const seam = createRecordingWatcherSeam({ comments: twoNewComments });
    const outcome = await runDevSquadAdoWorkflowWatchPass(
      passOptions({
        ledger: reopened,
        seam: seam.seam,
        candidates: [137, 42, 9001],
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(
      outcome.value.outcomes.map((candidate) => [
        candidate.workItemId,
        candidate.kind,
        candidate.reason,
        candidate.ledgerErrorKind,
      ]),
    ).toEqual([
      ["137", "acted", "new-work-item-comment", null],
      ["42", "failed", "ledger-recovery", "corrupt-artifact"],
      ["9001", "acted", "new-work-item-comment", null],
    ]);
    expect(outcome.value.counts).toMatchObject({
      examined: 3,
      acted: 2,
      failed: 1,
    });
    expect(outcome.value.signals.map((signal) => signal.workItemId)).toEqual([
      "137",
      "9001",
    ]);

    // The blocked artifact is reported, never repaired or rewritten.
    expect(await readFile(corruptedPath, "utf8")).toBe(corruptedBefore);
    for (const workItemId of [137, 9001]) {
      const durable = await reopened.readRecord(workItemId);
      expect(durable).toMatchObject({
        ok: true,
        value: { observations: { workItemCommentId: "481" } },
      });
    }
  }, 120_000);

  it("[TEST-019] isolates a seam rejection without touching another candidate's durable state", async () => {
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
    const before = await fixture.ledger.readRecord(137);
    expect(before.ok).toBe(true);

    const seam = createRecordingWatcherSeam({
      comments: (input) => {
        if (input.workItemId === "137")
          return Promise.reject(new Error("transport exploded"));
        return { commentIds: ["480", "481"] };
      },
    });
    const outcome = await runDevSquadAdoWorkflowWatchPass(
      passOptions({
        ledger: fixture.ledger,
        seam: seam.seam,
        candidates: [137, 42],
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.outcomes[0]).toMatchObject({
      workItemId: "137",
      kind: "failed",
      reason: "observation-failed",
    });
    expect(outcome.value.outcomes[1]).toMatchObject({
      workItemId: "42",
      kind: "acted",
    });
    expect(await fixture.ledger.readRecord(137)).toEqual(before);
  }, 120_000);

  it("[TEST-020] reports every ledger recovery and capacity category with a stable kind", async () => {
    const fixture = await createWatcherLedgerFixture(ledgerClock);
    await seedWatcherRecord(fixture.ledger, {
      workItemId: 137,
      revision: 4,
      phase: "implement",
      status: "ready",
      workItemCommentId: "480",
    });

    const cases: readonly {
      readonly error: DevSquadAdoLedgerError;
      readonly reason: string;
      readonly ledgerErrorKind: string;
    }[] = [
      {
        error: { kind: "corrupt-artifact", artifact: "records/x/1.json" },
        reason: "ledger-recovery",
        ledgerErrorKind: "corrupt-artifact",
      },
      {
        error: {
          kind: "unsupported-schema-version",
          artifact: "records/x/1.json",
          schemaVersion: 2,
        },
        reason: "ledger-recovery",
        ledgerErrorKind: "unsupported-schema-version",
      },
      {
        error: { kind: "path-boundary" },
        reason: "ledger-recovery",
        ledgerErrorKind: "path-boundary",
      },
      {
        error: { kind: "unsupported-permissions" },
        reason: "ledger-recovery",
        ledgerErrorKind: "unsupported-permissions",
      },
      {
        error: { kind: "scan-limit", limit: 100_000 },
        reason: "ledger-recovery",
        ledgerErrorKind: "scan-limit",
      },
      {
        error: { kind: "storage", outcome: "unchanged" },
        reason: "ledger-recovery",
        ledgerErrorKind: "storage",
      },
      {
        error: {
          kind: "capacity-exceeded",
          resource: "records",
          limit: 10_000,
        },
        reason: "ledger-capacity",
        ledgerErrorKind: "capacity-exceeded",
      },
    ];

    for (const testCase of cases) {
      const failingLedger: DevSquadAdoWorkflowLedger = {
        ...fixture.ledger,
        readRecord: async () => ({ ok: false, error: testCase.error }),
      };
      const seam = createRecordingWatcherSeam({ comments: twoNewComments });
      const outcome = await runDevSquadAdoWorkflowWatchPass(
        passOptions({ ledger: failingLedger, seam: seam.seam }),
      );
      expect(outcome.ok, testCase.error.kind).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.value.outcomes[0], testCase.error.kind).toMatchObject({
        kind: "failed",
        reason: testCase.reason,
        ledgerErrorKind: testCase.ledgerErrorKind,
      });
      expect(seam.calls, testCase.error.kind).toEqual([]);
      const serialized = JSON.stringify(outcome.value);
      expect(serialized, testCase.error.kind).not.toContain("records/x/1.json");
    }
  }, 120_000);

  it("[TEST-020] surfaces an unsupported persisted schema without repairing it", async () => {
    const fixture = await createWatcherLedgerFixture(ledgerClock);
    await seedWatcherRecord(fixture.ledger, {
      workItemId: 137,
      revision: 4,
      phase: "implement",
      status: "ready",
      workItemCommentId: "480",
    });
    const path = await setWatcherRecordSchemaVersion(
      fixture.repositoryRoot,
      137,
      2,
    );
    const before = await readFile(path, "utf8");

    const reopened = await openWatcherLedger(
      fixture.repositoryRoot,
      ledgerClock,
    );
    const seam = createRecordingWatcherSeam({ comments: twoNewComments });
    const outcome = await runDevSquadAdoWorkflowWatchPass(
      passOptions({ ledger: reopened, seam: seam.seam }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.outcomes[0]).toMatchObject({
      kind: "failed",
      reason: "ledger-recovery",
      ledgerErrorKind: "unsupported-schema-version",
    });
    expect(await readFile(path, "utf8")).toBe(before);
    expect(await watcherRecordGenerationPath(fixture.repositoryRoot, 137)).toBe(
      path,
    );
  }, 120_000);
});

describe("DevSquadAdoWorkflowWatcher restart safety", () => {
  it("[TEST-023] keeps only acknowledged outcomes durable and replays a retried pass", async () => {
    const repositoryRoot = await makeWatcherRepository();
    const ledger = await openWatcherLedger(repositoryRoot, ledgerClock);
    for (const workItemId of [137, 42]) {
      await seedWatcherRecord(ledger, {
        workItemId,
        revision: 4,
        phase: "implement",
        status: "ready",
        workItemCommentId: "480",
      });
    }

    const controller = new AbortController();
    const interruptedLedger: DevSquadAdoWorkflowLedger = {
      ...ledger,
      checkpoint: async (input) => {
        const result = await ledger.checkpoint(input);
        controller.abort();
        return result;
      },
    };
    const firstSeam = createRecordingWatcherSeam({ comments: twoNewComments });
    const interrupted = await runDevSquadAdoWorkflowWatchPass(
      passOptions({
        ledger: interruptedLedger,
        seam: firstSeam.seam,
        passId: "pass-restart",
        candidates: [137, 42],
        signal: controller.signal,
      }),
    );
    expect(interrupted.ok).toBe(true);
    if (!interrupted.ok) return;
    expect(interrupted.value.stopReason).toBe("cancelled");
    expect(
      interrupted.value.signals.map((signal) => signal.workItemId),
    ).toEqual(["137"]);
    const acknowledgedRevision = interrupted.value.outcomes[0]?.revision;

    // Reopen from disk: only the acknowledged cursor advance is durable.
    const restarted = await openWatcherLedger(repositoryRoot, ledgerClock);
    const advanced = await restarted.readRecord(137);
    expect(advanced.ok).toBe(true);
    if (!advanced.ok) return;
    expect(advanced.value.observations.workItemCommentId).toBe("481");
    expect(advanced.value.activeClaim).toBeNull();
    expect(
      advanced.value.checkpoints.map((checkpoint) => checkpoint.revision),
    ).toContain(acknowledgedRevision);
    expect(await restarted.readRecord(42)).toMatchObject({
      ok: true,
      value: { revision: 4, observations: { workItemCommentId: "480" } },
    });

    // Retrying the same pass identity reproduces every operation identifier
    // and replays rather than duplicating.
    const retrySeam = createRecordingWatcherSeam({ comments: twoNewComments });
    const retried = await runDevSquadAdoWorkflowWatchPass(
      passOptions({
        ledger: restarted,
        seam: retrySeam.seam,
        passId: "pass-restart",
        candidates: [137, 42],
      }),
    );
    expect(retried.ok).toBe(true);
    if (!retried.ok) return;
    expect(
      retried.value.outcomes.map((candidate) => [
        candidate.workItemId,
        candidate.kind,
        candidate.reason,
      ]),
    ).toEqual([
      ["137", "no-change", "no-new-observations"],
      ["42", "acted", "new-work-item-comment"],
    ]);
    expect(retried.value.signals.map((signal) => signal.workItemId)).toEqual([
      "42",
    ]);

    const final = await restarted.readRecord(137);
    expect(final).toEqual(advanced);
    const checkpointOperationId = deriveDevSquadAdoWatcherOperationId({
      passId: "pass-restart",
      workItemId: "137",
      step: "checkpoint",
      ordinal: 0,
    });
    expect(
      advanced.value.checkpoints.filter(
        (checkpoint) => checkpoint.operationId === checkpointOperationId,
      ),
    ).toHaveLength(1);
    expect(checkpointOperationId).toBe(
      deriveDevSquadAdoWatcherOperationId({
        passId: "pass-restart",
        workItemId: "137",
        step: "checkpoint",
        ordinal: 0,
      }),
    );
  }, 180_000);

  it("[TEST-023] leaves durable state untouched when a mutation is never acknowledged", async () => {
    const repositoryRoot = await makeWatcherRepository();
    const ledger = await openWatcherLedger(repositoryRoot, ledgerClock);
    await seedWatcherRecord(ledger, {
      workItemId: 137,
      revision: 4,
      phase: "implement",
      status: "ready",
      workItemCommentId: "480",
    });
    const before = await ledger.readRecord(137);
    expect(before.ok).toBe(true);
    if (!before.ok) return;

    let armed = false;
    const selected: LedgerPersistencePoint = "candidate-written";
    const faultingRuntime = makeLedgerTestRuntime(ledgerClock, {
      hit(point) {
        if (armed && point === selected)
          return interruptPersistenceAt(selected).hit(point);
      },
    });
    const opened = await openDevSquadAdoWorkflowLedgerWithRuntime(
      { repositoryRoot },
      faultingRuntime,
    );
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const faulting = opened.value;
    const faultingLedger: DevSquadAdoWorkflowLedger = {
      ...faulting,
      checkpoint: async (input) => {
        armed = true;
        try {
          return await faulting.checkpoint(input);
        } finally {
          armed = false;
        }
      },
    };

    const seam = createRecordingWatcherSeam({ comments: twoNewComments });
    const outcome = await runDevSquadAdoWorkflowWatchPass(
      passOptions({
        ledger: faultingLedger,
        seam: seam.seam,
        passId: "pass-fault",
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.signals).toEqual([]);
    expect(outcome.value.outcomes[0]).toMatchObject({
      kind: "failed",
      reason: "ledger-recovery",
      ledgerErrorKind: "storage",
      revision: null,
    });

    const restarted = await openWatcherLedger(repositoryRoot, ledgerClock);
    const after = await restarted.readRecord(137);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.observations.workItemCommentId).toBe("480");
    expect(after.value.checkpoints).toEqual(before.value.checkpoints);
    expect(after.value.activeClaim).toBeNull();
  }, 180_000);
});

describe("DevSquadAdoWorkflowWatcher success criteria", () => {
  it("[SC-008] never lets one failing candidate change another candidate durable revision", async () => {
    const trials = process.env.SANDCASTLE_WATCHER_SWEEP === "full" ? 50 : 12;

    for (let trial = 0; trial < trials; trial++) {
      const fixture = await createWatcherLedgerFixture(ledgerClock);
      const healthy = [`ok-a-${String(trial)}`, `ok-b-${String(trial)}`];
      const broken = `broken-${String(trial)}`;
      const untouched = `control-${String(trial)}`;
      for (const workItemId of [...healthy, broken, untouched]) {
        await seedWatcherRecord(fixture.ledger, {
          workItemId,
          revision: 1,
          phase: "implement",
          status: "ready",
          workItemCommentId: "c0",
        });
      }
      await corruptWatcherRecord(fixture.repositoryRoot, broken);

      const reopened = await openWatcherLedger(
        fixture.repositoryRoot,
        ledgerClock,
      );
      const beforeControl = await reopened.readRecord(untouched);
      expect(beforeControl.ok, untouched).toBe(true);

      const seam = createRecordingWatcherSeam({
        comments: () => ({ commentIds: ["c0", "c1"] }),
      });
      const outcome = await runDevSquadAdoWorkflowWatchPass(
        passOptions({
          ledger: reopened,
          seam: seam.seam,
          passId: `isolation-${String(trial)}`,
          candidates: [...healthy, broken],
        }),
      );

      expect(outcome.ok, broken).toBe(true);
      if (!outcome.ok) return;
      expect(
        outcome.value.outcomes.filter(
          (candidate) => candidate.kind === "failed",
        ),
        broken,
      ).toHaveLength(1);
      expect(
        outcome.value.outcomes.find(
          (candidate) => candidate.workItemId === broken,
        ),
        broken,
      ).toMatchObject({
        kind: "failed",
        reason: "ledger-recovery",
        ledgerErrorKind: "corrupt-artifact",
      });

      for (const workItemId of healthy) {
        const durable = await reopened.readRecord(workItemId);
        expect(durable, workItemId).toMatchObject({
          ok: true,
          value: { observations: { workItemCommentId: "c1" } },
        });
      }
      expect(await reopened.readRecord(untouched)).toEqual(beforeControl);
      await cleanupWatcherRepositories();
    }
  }, 600_000);
});
