import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deriveDevSquadAdoWatcherOperationId,
  runDevSquadAdoWorkflowWatchPass,
  type CheckpointDevSquadAdoWorkflowInput,
  type DevSquadAdoWatcherObservationGeneration,
  type DevSquadAdoWatcherOperationIdentity,
  type DevSquadAdoWorkflowLedger,
  type RunDevSquadAdoWorkflowWatchPassOptions,
} from "./index.js";
import { canonicalJson } from "./DevSquadAdoWorkflowLedgerSchema.js";
import { deriveDiscoveryInitializationId } from "./DevSquadAdoWorkflowWatcherValidation.js";
import { discoveryOptions } from "./DevSquadAdoWorkflowWatcherDiscoveryTestSupport.js";
import {
  cleanupWatcherRepositories,
  createRecordingDelay,
  createWatcherLedgerFixture,
  openWatcherLedger,
  seedWatcherRecord,
} from "./DevSquadAdoWorkflowWatcherTestSupport.js";

const NOW = "2026-09-11T00:00:00.000Z";
const clock = () => new Date(NOW);
const pair = { threadId: "1", commentId: "1" };
type Mode = "supplied" | "discovery";
const identity = {
  step: "checkpoint",
  passId: "P",
  workItemId: "137",
  ordinal: 0,
  generation: {
    fromWorkItemCommentId: "480",
    fromPullRequest: null,
    toWorkItemCommentId: null,
    toPullRequest: pair,
  },
} as const satisfies DevSquadAdoWatcherOperationIdentity;
const commentIdentity = {
  ...identity,
  generation: {
    ...identity.generation,
    toWorkItemCommentId: "481",
    toPullRequest: null,
  },
};

afterEach(cleanupWatcherRepositories);

const track = (ledger: DevSquadAdoWorkflowLedger) => ({
  ...ledger,
  initializeRecord: vi.fn(ledger.initializeRecord),
  acquireClaim: vi.fn(ledger.acquireClaim),
  renewClaim: vi.fn(ledger.renewClaim),
  checkpoint: vi.fn(ledger.checkpoint),
  releaseClaim: vi.fn(ledger.releaseClaim),
});

const fixture = async (mode: Mode, pullRequestId: string | null = "A") => {
  const { ledger, repositoryRoot } = await createWatcherLedgerFixture(clock);
  await seedWatcherRecord(ledger, {
    workItemId: 137,
    revision: 1,
    phase: "implement",
    status: "ready",
    workItemCommentId: "480",
    ...(pullRequestId === null ? {} : { pullRequestId }),
  });
  const tracked = track(ledger);
  const comments = vi.fn(async () => ({
    kind: "window" as const,
    commentIds: ["480"],
  }));
  const pr = vi.fn(async () => ({
    kind: "window" as const,
    entries: [pair],
  }));
  const run = (
    activeLedger: DevSquadAdoWorkflowLedger = tracked,
    overrides: Partial<
      Pick<
        RunDevSquadAdoWorkflowWatchPassOptions,
        "budgets" | "clock" | "lease"
      >
    > = {},
  ) => {
    const common = {
      ledger: activeLedger,
      passId: "P",
      ownerId: "watcher",
      intakeRules: { phases: ["implement"], statuses: ["ready"] },
      budgets: {
        maxPolls: 1,
        maxPollStartElapsedMs: 600_000,
        observationTimeoutMs: 5_000,
      },
      clock,
      delay: createRecordingDelay({ observationTimeoutMs: 5_000 }).delay,
      ...overrides,
    };
    if (mode === "supplied")
      return runDevSquadAdoWorkflowWatchPass({
        ...common,
        candidates: [137],
        seam: {
          observeWorkItemComments: comments,
          observePullRequestActivity: pr,
        },
      });
    return runDevSquadAdoWorkflowWatchPass({
      ...discoveryOptions().options,
      ...common,
      seam: {
        discoverWorkItemsPage: async (request) => ({
          ...request,
          items: [{ workItemId: 137, facts: {} }],
          next: { kind: "terminal" },
        }),
        observeWorkItemComments: comments,
        observePullRequestActivity: pr,
      },
    });
  };
  return { ledger, repositoryRoot, tracked, comments, pr, run };
};

describe("PR checkpoint namespace [POST-SKEP-001][FR-037b/c]", () => {
  it.each(["supplied", "discovery"] as const)(
    "%s: same pass observes identical local pairs in replacement PRs",
    async (mode) => {
      const f = await fixture(mode);
      const first = await f.run();
      expect(first).toMatchObject({
        ok: true,
        value: {
          counts: { acted: 1 },
          signals: [{ changedKinds: ["pull-request-thread"] }],
          outcomes: [
            { kind: "acted", revision: 3, cleanup: { status: "released" } },
          ],
        },
      });
      expect(await f.ledger.readRecord(137)).toMatchObject({
        ok: true,
        value: {
          revision: 4,
          pullRequest: { id: "A" },
          observations: { workItemCommentId: "480", pullRequest: pair },
          activeClaim: null,
        },
      });

      // The authorized host changes destinations between invocations, not
      // during acquisition. No staleness or uncertain publication is involved.
      const acquired = await f.ledger.acquireClaim({
        workItemId: 137,
        operationId: "host-switch-claim",
        ownerId: "host",
        claimToken: Buffer.alloc(32, 9).toString("base64url"),
        leaseDurationMs: 60_000,
      });
      expect(acquired.ok).toBe(true);
      if (!acquired.ok) throw new Error("host claim failed");
      const { ownerId, claimToken, fencingValue } =
        acquired.value.outcome.authority;
      const authority = { ownerId, claimToken, fencingValue };
      expect(
        await f.ledger.checkpoint({
          workItemId: 137,
          operationId: "host-switch-checkpoint",
          authority,
          expected: {
            revision: acquired.value.record.revision,
            phase: "implement",
            status: "ready",
          },
          patch: {
            pullRequest: { id: "B" },
            observations: { pullRequest: null },
          },
        }),
      ).toMatchObject({ ok: true, value: { acceptedRevision: 6 } });
      expect(
        await f.ledger.releaseClaim({
          workItemId: 137,
          operationId: "host-switch-release",
          authority,
        }),
      ).toMatchObject({ ok: true, value: { acceptedRevision: 7 } });

      const second = await f.run();
      const ids = f.tracked.checkpoint.mock.calls.map(
        ([input]) => input.operationId,
      );
      const before = await f.ledger.readRecord(137);
      expect(
        second,
        JSON.stringify({
          checkpointIds: ids,
          observations: before.ok ? before.value.observations : null,
        }),
      ).toMatchObject({
        ok: true,
        value: {
          counts: { acted: 1, failed: 0 },
          signals: [{ changedKinds: ["pull-request-thread"] }],
          outcomes: [
            {
              kind: "acted",
              reason: "new-pull-request-activity",
              ledgerErrorKind: null,
              revision: 9,
              cleanup: { status: "released" },
            },
          ],
        },
      });
      expect(f.pr).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ pullRequestId: "A", sinceCursor: null }),
      );
      expect(f.pr).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ pullRequestId: "B", sinceCursor: null }),
      );
      expect(ids).toHaveLength(2);
      expect(new Set(ids).size).toBe(2);
      expect(ids).toEqual(
        ["A", "B"].map((pullRequestId) =>
          deriveDevSquadAdoWatcherOperationId(identity, { pullRequestId }),
        ),
      );
      expect(f.tracked.initializeRecord).not.toHaveBeenCalled();
      expect(f.tracked.releaseClaim).toHaveBeenCalledTimes(2);

      expect(before).toMatchObject({
        ok: true,
        value: {
          revision: 10,
          pullRequest: { id: "B" },
          observations: { workItemCommentId: "480", pullRequest: pair },
          activeClaim: null,
        },
      });
      const reopened = track(await openWatcherLedger(f.repositoryRoot, clock));
      expect(await f.run(reopened)).toMatchObject({
        ok: true,
        value: { signals: [], counts: { acted: 0 } },
      });
      expect(f.pr).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({ pullRequestId: "B", sinceCursor: pair }),
      );
      for (const method of [
        "initializeRecord",
        "acquireClaim",
        "renewClaim",
        "checkpoint",
        "releaseClaim",
      ] as const)
        expect(reopened[method]).not.toHaveBeenCalled();
      expect(await reopened.readRecord(137)).toEqual(before);
    },
    60_000,
  );

  it.each([
    ["supplied", "A"],
    ["discovery", "A"],
    ["supplied", null],
    ["discovery", null],
  ] as const)(
    "%s: WI-only advance uses observed PR namespace %s or legacy no-PR bytes",
    async (mode, pullRequestId) => {
      const f = await fixture(mode, pullRequestId);
      f.comments.mockResolvedValue({
        kind: "window",
        commentIds: ["480", "481"],
      });
      f.pr.mockResolvedValue({ kind: "window", entries: [] });
      expect(await f.run()).toMatchObject({
        ok: true,
        value: {
          signals: [{ changedKinds: ["work-item-comment"] }],
          outcomes: [{ kind: "acted", cleanup: { status: "released" } }],
        },
      });
      expect(f.tracked.checkpoint).toHaveBeenCalledTimes(1);
      expect(f.tracked.checkpoint.mock.calls[0]![0].operationId).toBe(
        pullRequestId === null
          ? "dsw2.checkpoint.8af77aaa8f5082b269d08beec9edb6d0"
          : deriveDevSquadAdoWatcherOperationId(commentIdentity, {
              pullRequestId,
            }),
      );
      expect(f.pr).toHaveBeenCalledTimes(pullRequestId === null ? 0 : 1);
      expect(f.tracked.initializeRecord).not.toHaveBeenCalled();
      expect(await f.ledger.readRecord(137)).toMatchObject({
        ok: true,
        value: {
          observations: { workItemCommentId: "481", pullRequest: null },
          activeClaim: null,
        },
      });
    },
  );

  describe.each(["supplied", "discovery"] as const)("%s recovery", (mode) => {
    it.each([
      "history",
      "retry",
      "retry-renewal",
      "later-pr",
      "conflict",
    ] as const)(
      "retains the original namespaced checkpoint through %s",
      async (recovery) => {
        const f = await fixture(mode);
        let now = Date.parse(NOW);
        const submitted: CheckpointDevSquadAdoWorkflowInput[] = [];
        const retry = recovery === "retry" || recovery === "retry-renewal";
        const checkpoint = vi.fn(
          async (request: CheckpointDevSquadAdoWorkflowInput) => {
            submitted.push(structuredClone(request));
            if (recovery === "conflict")
              return {
                ok: false as const,
                error: { kind: "idempotency-conflict" as const },
              };
            if (retry && submitted.length === 1) {
              if (recovery === "retry-renewal") now += 50_000;
            } else {
              expect(await f.ledger.checkpoint(request)).toMatchObject({
                ok: true,
                value: { replayed: false },
              });
              if (recovery === "later-pr") {
                // History must still acknowledge A, even when a later
                // authorized mutation has changed the record to B.
                expect(
                  await f.ledger.checkpoint({
                    ...request,
                    operationId: "later-authorized-pr-switch",
                    expected: {
                      ...request.expected,
                      revision: request.expected.revision + 1,
                    },
                    patch: {
                      pullRequest: { id: "B" },
                      observations: { pullRequest: null },
                    },
                  }),
                ).toMatchObject({ ok: true });
              }
            }
            return {
              ok: false as const,
              error: {
                kind: "storage" as const,
                outcome: "indeterminate" as const,
              },
            };
          },
        );
        const result = await f.run(
          { ...f.tracked, checkpoint },
          {
            clock: () => new Date(now),
            lease: { leaseDurationMs: 60_000, renewalThresholdMs: 20_000 },
            budgets: {
              maxPolls: 3,
              maxPollStartElapsedMs: 600_000,
              observationTimeoutMs: 5_000,
            },
          },
        );
        const conflict = recovery === "conflict";
        const accepted = recovery === "retry-renewal" ? 4 : 3;
        expect(result).toMatchObject({
          ok: true,
          value: {
            polls: conflict ? 1 : retry ? 3 : 2,
            signals: conflict
              ? []
              : [{ changedKinds: ["pull-request-thread"] }],
            outcomes: [
              {
                kind: conflict ? "failed" : "acted",
                reason: conflict
                  ? "idempotency-conflict"
                  : "new-pull-request-activity",
                revision: conflict ? null : accepted,
                cleanup: { status: "released" },
              },
            ],
          },
        });
        expect(checkpoint).toHaveBeenCalledTimes(retry ? 2 : 1);
        const originalId = deriveDevSquadAdoWatcherOperationId(identity, {
          pullRequestId: "A",
        });
        expect(submitted.map((request) => request.operationId)).toEqual(
          Array(retry ? 2 : 1).fill(originalId),
        );
        expect(submitted.map((request) => request.expected.revision)).toEqual(
          recovery === "retry-renewal" ? [2, 3] : retry ? [2, 2] : [2],
        );
        if (retry) {
          expect(submitted[1]!.authority).toEqual(submitted[0]!.authority);
          expect(submitted[1]!.patch).toEqual(submitted[0]!.patch);
          expect(submitted[0]!.expected.revision).toBe(2);
        }
        expect(f.tracked.renewClaim).toHaveBeenCalledTimes(
          recovery === "retry-renewal" ? 1 : 0,
        );
        expect(f.tracked.acquireClaim).toHaveBeenCalledTimes(1);
        expect(f.tracked.releaseClaim).toHaveBeenCalledTimes(1);
        expect(f.tracked.initializeRecord).not.toHaveBeenCalled();
        expect(f.pr).toHaveBeenCalledTimes(1);
        expect(f.comments).toHaveBeenCalledTimes(1);
        expect(await f.ledger.readRecord(137)).toMatchObject({
          ok: true,
          value: {
            pullRequest: { id: recovery === "later-pr" ? "B" : "A" },
            observations: {
              workItemCommentId: "480",
              pullRequest: recovery === "later-pr" || conflict ? null : pair,
            },
            activeClaim: null,
            ...(conflict
              ? { checkpoints: [] }
              : {
                  checkpoints: expect.arrayContaining([
                    expect.objectContaining({
                      operationId: originalId,
                      revision: accepted,
                    }),
                  ]),
                }),
          },
        });
      },
      60_000,
    );

    it("rejects namespaced contradictory history against the original submission", async () => {
      const f = await fixture(mode);
      let submitted: CheckpointDevSquadAdoWorkflowInput | undefined;
      const checkpoint = vi.fn(
        async (request: CheckpointDevSquadAdoWorkflowInput) => {
          submitted = structuredClone(request);
          expect(await f.ledger.checkpoint(request)).toMatchObject({
            ok: true,
          });
          return {
            ok: false as const,
            error: {
              kind: "storage" as const,
              outcome: "indeterminate" as const,
            },
          };
        },
      );
      const result = await f.run(
        {
          ...f.tracked,
          checkpoint,
          readRecord: async (workItemId) => {
            const response = await f.ledger.readRecord(workItemId);
            if (!response.ok || submitted === undefined) return response;
            return {
              ok: true,
              value: {
                ...response.value,
                checkpoints: response.value.checkpoints.map((entry) => ({
                  ...entry,
                  revision: submitted!.expected.revision,
                })),
              },
            };
          },
        },
        {
          budgets: {
            maxPolls: 3,
            maxPollStartElapsedMs: 600_000,
            observationTimeoutMs: 5_000,
          },
        },
      );
      expect(result).toMatchObject({
        ok: true,
        value: {
          signals: [],
          outcomes: [
            {
              kind: "failed",
              reason: "ledger-unavailable",
              ledgerErrorKind: "ledger-fault",
              cleanup: { status: "released" },
            },
          ],
        },
      });
      expect(submitted!.operationId).toBe(
        deriveDevSquadAdoWatcherOperationId(identity, { pullRequestId: "A" }),
      );
      expect(checkpoint).toHaveBeenCalledTimes(1);
      expect(f.tracked.renewClaim).not.toHaveBeenCalled();
      expect(f.tracked.releaseClaim).toHaveBeenCalledTimes(1);
    });
  });
});

describe("operation helper compatibility [FR-037b/c]", () => {
  it("pins every legacy arm and discovery initialization to pre-repair golden bytes", () => {
    for (const [step, ordinal, golden] of [
      ["claim", 0, "dsw2.claim.9330f98509c6a36cfbde4083082b1e2a"],
      ["renew", 1, "dsw2.renew.c7101eef4ae09762954d3ce6a0e698a8"],
      ["release", 0, "dsw2.release.f32e537ab765f39647bf1a88bdeb244b"],
    ] as const)
      expect(
        deriveDevSquadAdoWatcherOperationId({
          step,
          passId: "P",
          workItemId: "137",
          ordinal,
          claimEpoch: "epoch-1",
        }),
      ).toBe(golden);
    expect(deriveDevSquadAdoWatcherOperationId(identity)).toBe(
      "dsw2.checkpoint.f63e312927f284052c04ac4d7a0bc5fb",
    );
    expect(deriveDevSquadAdoWatcherOperationId(commentIdentity)).toBe(
      "dsw2.checkpoint.8af77aaa8f5082b269d08beec9edb6d0",
    );
    expect(
      deriveDiscoveryInitializationId({
        workItemId: "137",
        submissionId: "submit-1",
        phase: "implement",
        status: "ready",
      }),
    ).toBe("dsw2.initialize.02b1cac1acb57faf1daa6d0139d5cf15");
  });

  it("uses exactly the v3 PR generation formula, deterministically and within bounds", () => {
    const ids = ["A", "B"].map((pullRequestId) => {
      const id = deriveDevSquadAdoWatcherOperationId(identity, {
        pullRequestId,
      });
      const canonicalIdentity = {
        v: 3,
        passId: "P",
        workItemId: "137",
        step: "checkpoint",
        ordinal: 0,
        generation: {
          pullRequestId,
          fromWorkItemCommentId: "480",
          fromPullRequest: null,
          toWorkItemCommentId: null,
          toPullRequest: pair,
        },
      };
      expect(id).toBe(
        `dsw3.checkpoint.${createHash("sha256").update(canonicalJson(canonicalIdentity)).digest("hex").slice(0, 32)}`,
      );
      expect(id).toBe(
        deriveDevSquadAdoWatcherOperationId(
          { ...identity, generation: { ...identity.generation } },
          { pullRequestId },
        ),
      );
      expect(id).toMatch(/^dsw3\.checkpoint\.[0-9a-f]{32}$/);
      expect(Buffer.byteLength(id, "utf8")).toBe(48);
      return id;
    });
    expect(new Set(ids).size).toBe(2);
    const long = deriveDevSquadAdoWatcherOperationId(
      {
        ...identity,
        passId: "é".repeat(512),
        workItemId: "x".repeat(256),
        generation: {
          fromWorkItemCommentId: "a".repeat(1024),
          fromPullRequest: {
            threadId: "b".repeat(1024),
            commentId: "c".repeat(1024),
          },
          toWorkItemCommentId: "d".repeat(1024),
          toPullRequest: {
            threadId: "e".repeat(1024),
            commentId: "f".repeat(1024),
          },
        },
      },
      { pullRequestId: "é".repeat(512) },
    );
    expect(long).toMatch(/^dsw3\.checkpoint\.[0-9a-f]{32}$/);
    expect(Buffer.byteLength(long, "utf8")).toBeLessThanOrEqual(256);
  });

  it("adds only a checkpoint overload, leaving one-argument identity types usable", () => {
    const legacy: (input: DevSquadAdoWatcherOperationIdentity) => string =
      deriveDevSquadAdoWatcherOperationId;
    expect(legacy(identity)).toBe(
      deriveDevSquadAdoWatcherOperationId(identity),
    );
    const claim = {
      step: "claim",
      passId: "P",
      workItemId: "137",
      ordinal: 0,
      claimEpoch: "epoch-1",
    } as const;
    if (false) {
      // @ts-expect-error The PR namespace is checkpoint-only.
      deriveDevSquadAdoWatcherOperationId(claim, { pullRequestId: "A" });
      // @ts-expect-error A namespace must contain a string PR identifier.
      deriveDevSquadAdoWatcherOperationId(identity, { pullRequestId: null });
      const generation: DevSquadAdoWatcherObservationGeneration = {
        ...identity.generation,
        // @ts-expect-error The legacy generation type has not gained a PR field.
        pullRequestId: "A",
      };
      void generation;
    }
  });
});
