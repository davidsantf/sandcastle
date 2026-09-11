import { afterEach, describe, expect, it, vi } from "vitest";
import { runDevSquadAdoWorkflowWatchPass } from "./index.js";
import type {
  DevSquadAdoDiscoveryWorkItemObservation,
  DevSquadAdoDiscoveryPullRequestObservation,
  DevSquadAdoWatcherDiscoverySeam,
} from "./index.js";
import { discoveryOptions } from "./DevSquadAdoWorkflowWatcherDiscoveryTestSupport.js";
import {
  cleanupWatcherRepositories,
  createWatcherLedgerFixture,
  openWatcherLedger,
  seedWatcherRecord,
  readWatcherLedgerArtifacts,
} from "./DevSquadAdoWorkflowWatcherTestSupport.js";

afterEach(cleanupWatcherRepositories);
const anchor = { threadId: "thread", commentId: "480" };

// W042 / TEST-035/039 / CC-007/019/023/026/033/037: public passes,
// injected host observations and a real durable ledger, never a second projector.
const fixture = async (withPr = false, anchored = true) => {
  const { options } = discoveryOptions();
  const { ledger, repositoryRoot } = await createWatcherLedgerFixture(
    options.clock,
  );
  await seedWatcherRecord(ledger, {
    workItemId: 137,
    phase: "ready",
    status: "open",
    ...(anchored ? { workItemCommentId: "480" } : {}),
    ...(withPr
      ? {
          pullRequestId: "pr",
          ...(anchored ? { pullRequestCursor: anchor } : {}),
        }
      : {}),
  });
  const before = await ledger.readRecord("137");
  const tracked = {
    ...ledger,
    readRecord: vi.fn(ledger.readRecord),
    initializeRecord: vi.fn(ledger.initializeRecord),
    acquireClaim: vi.fn(ledger.acquireClaim),
    renewClaim: vi.fn(ledger.renewClaim),
    checkpoint: vi.fn(ledger.checkpoint),
    releaseClaim: vi.fn(ledger.releaseClaim),
  };
  const comments = vi.fn<
    DevSquadAdoWatcherDiscoverySeam["observeWorkItemComments"]
  >(async () => ({ kind: "window", commentIds: ["480", "481"] }));
  const pr = vi.fn<
    NonNullable<DevSquadAdoWatcherDiscoverySeam["observePullRequestActivity"]>
  >(async () => ({
    kind: "window",
    entries: [anchor, { threadId: "thread", commentId: "481" }],
  }));
  const seam: DevSquadAdoWatcherDiscoverySeam = {
    discoverWorkItemsPage: async (request) => ({
      ...request,
      items: [
        {
          workItemId: 137,
          facts: { state: { kind: "known", value: "included" } },
        },
      ],
      next: { kind: "terminal" },
    }),
    observeWorkItemComments: comments,
    ...(withPr ? { observePullRequestActivity: pr } : {}),
  };
  const request = { ...options, ledger: tracked, seam };
  const unchanged = async () => {
    expect(await ledger.readRecord("137")).toEqual(before);
    for (const method of [
      tracked.initializeRecord,
      tracked.acquireClaim,
      tracked.renewClaim,
      tracked.checkpoint,
      tracked.releaseClaim,
    ])
      expect(method).not.toHaveBeenCalled();
  };
  return {
    request,
    ledger,
    repositoryRoot,
    before,
    tracked,
    comments,
    pr,
    unchanged,
  };
};

describe("discovery anchored lifecycle [W042]", () => {
  it("pauses cursor 480 with zero item effects, then reenters at 480 and signals 481 once", async () => {
    const f = await fixture(true);
    const excluded = await runDevSquadAdoWorkflowWatchPass({
      ...f.request,
      discovery: {
        ...f.request.discovery,
        policy: {
          version: "pause-policy",
          filters: [
            { dimension: "state", operator: "one-of", values: ["other"] },
          ],
        },
      },
    });
    expect(excluded).toMatchObject({
      ok: true,
      value: {
        signals: [],
        counts: { paused: 1 },
        outcomes: [
          { matching: { decision: "excluded", policyVersion: "pause-policy" } },
        ],
      },
    });
    expect(f.tracked.readRecord).not.toHaveBeenCalled();
    expect(f.comments).not.toHaveBeenCalled();
    expect(f.pr).not.toHaveBeenCalled();
    await f.unchanged();

    // A fresh handle/invocation must use only the persisted anchors, not pause state.
    const reopened = await openWatcherLedger(f.repositoryRoot, f.request.clock);
    f.pr.mockResolvedValue({ kind: "window", entries: [anchor] });
    const result = await runDevSquadAdoWorkflowWatchPass({
      ...f.request,
      ledger: reopened,
      passId: "reentry",
    });
    expect(f.comments).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ sinceCommentId: "480" }),
    );
    expect(f.pr).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ sinceCursor: anchor }),
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        counts: { acted: 1 },
        signals: [
          { kind: "comment-observation", changedKinds: ["work-item-comment"] },
        ],
      },
    });
    if (result.ok) expect(result.value.signals).toHaveLength(1);
    expect(await reopened.readRecord("137")).toMatchObject({
      ok: true,
      value: {
        observations: { workItemCommentId: "481", pullRequest: anchor },
        activeClaim: null,
      },
    });
    f.comments.mockResolvedValue({ kind: "window", commentIds: ["481"] });
    const replay = await runDevSquadAdoWorkflowWatchPass({
      ...f.request,
      ledger: reopened,
      passId: "after-reentry",
    });
    expect(replay).toMatchObject({ ok: true, value: { signals: [] } });
  });

  it.each(["work-item", "pull-request"] as const)(
    "explicit %s loss blocks both cursors, including empty payloads",
    async (kind) => {
      const f = await fixture(true);
      if (kind === "work-item")
        f.comments.mockResolvedValue({ kind: "anchor-missing" });
      else f.pr.mockResolvedValue({ kind: "anchor-missing" });
      const result = await runDevSquadAdoWorkflowWatchPass(f.request);
      expect(result).toMatchObject({
        ok: true,
        value: {
          signals: [],
          outcomes: [
            {
              kind: "failed",
              reason: "observation-anchor-missing",
              cursorChanges: [],
              cleanup: { status: "not-required" },
            },
          ],
        },
      });
      await f.unchanged();
    },
  );

  it.each(["work-item", "pull-request"] as const)(
    "%s loss discriminator takes precedence over an incidental empty window",
    async (kind) => {
      const f = await fixture(true);
      // Host payloads may carry unrelated fields; only the selected arm is meaningful.
      if (kind === "work-item")
        f.comments.mockResolvedValue({
          kind: "anchor-missing",
          commentIds: [],
        } as DevSquadAdoDiscoveryWorkItemObservation);
      else
        f.pr.mockResolvedValue({
          kind: "anchor-missing",
          entries: [],
        } as DevSquadAdoDiscoveryPullRequestObservation);
      expect(await runDevSquadAdoWorkflowWatchPass(f.request)).toMatchObject({
        ok: true,
        value: {
          signals: [],
          outcomes: [{ reason: "observation-anchor-missing" }],
        },
      });
      await f.unchanged();
    },
  );

  it.each(["work-item", "pull-request"] as const)(
    "nonempty %s window missing its anchor fails closed",
    async (kind) => {
      const f = await fixture(true);
      if (kind === "work-item")
        f.comments.mockResolvedValue({ kind: "window", commentIds: ["481"] });
      else
        f.pr.mockResolvedValue({
          kind: "window",
          entries: [{ threadId: "thread", commentId: "481" }],
        });
      expect(await runDevSquadAdoWorkflowWatchPass(f.request)).toMatchObject({
        ok: true,
        value: {
          signals: [],
          outcomes: [{ reason: "observation-anchor-missing" }],
        },
      });
      await f.unchanged();
    },
  );

  it.each(["work-item", "pull-request"] as const)(
    "rejects explicit %s loss when no anchor was supplied",
    async (kind) => {
      const f = await fixture(true, false);
      if (kind === "work-item")
        f.comments.mockResolvedValue({ kind: "anchor-missing" });
      else f.pr.mockResolvedValue({ kind: "anchor-missing" });
      expect(await runDevSquadAdoWorkflowWatchPass(f.request)).toMatchObject({
        ok: true,
        value: {
          signals: [],
          outcomes: [{ reason: "invalid-observation-window" }],
        },
      });
      expect(f.comments).toHaveBeenCalledWith(
        expect.objectContaining({ sinceCommentId: null }),
      );
      if (kind === "pull-request")
        expect(f.pr).toHaveBeenCalledWith(
          expect.objectContaining({ sinceCursor: null }),
        );
      await f.unchanged();
    },
  );

  it.each(["work-item", "pull-request"] as const)(
    "discovery requires the %s window discriminator",
    async (kind) => {
      const f = await fixture(true);
      if (kind === "work-item")
        f.comments.mockResolvedValue({
          commentIds: ["480", "481"],
        } as unknown as DevSquadAdoDiscoveryWorkItemObservation);
      else
        f.pr.mockResolvedValue({
          entries: [anchor],
        } as unknown as DevSquadAdoDiscoveryPullRequestObservation);
      expect(await runDevSquadAdoWorkflowWatchPass(f.request)).toMatchObject({
        ok: true,
        value: {
          signals: [],
          outcomes: [{ reason: "invalid-observation-window" }],
        },
      });
      await f.unchanged();
    },
  );

  it.each(["discovery", "supplied"] as const)(
    "ordinary empty %s windows preserve both anchors without mutation",
    async (mode) => {
      const f = await fixture(true);
      f.comments.mockResolvedValue({ kind: "window", commentIds: [] });
      f.pr.mockResolvedValue({ kind: "window", entries: [] });
      const { discovery: _discovery, ...supplied } = f.request;
      const result =
        mode === "discovery"
          ? await runDevSquadAdoWorkflowWatchPass(f.request)
          : await runDevSquadAdoWorkflowWatchPass({
              ...supplied,
              mode: "supplied",
              candidates: [137],
              budgets: { ...supplied.budgets, maxPolls: 1 },
              seam: {
                observeWorkItemComments: async () => ({ commentIds: [] }),
                observePullRequestActivity: async () => ({ entries: [] }),
              },
            });
      expect(result).toMatchObject({
        ok: true,
        value: { signals: [], outcomes: [{ kind: "no-change" }] },
      });
      await f.unchanged();
    },
  );

  it.each([false, true])(
    "PR observation is required only for a record with a PR: %s",
    async (withPr) => {
      const f = await fixture(withPr);
      const result = await runDevSquadAdoWorkflowWatchPass({
        ...f.request,
        seam: { ...f.request.seam, observePullRequestActivity: undefined },
      });
      expect(result).toMatchObject({
        ok: true,
        value: {
          outcomes: [
            {
              kind: withPr ? "failed" : "acted",
              ...(withPr
                ? { reason: "pull-request-observation-unavailable" }
                : {}),
            },
          ],
        },
      });
      if (withPr) await f.unchanged();
      else
        expect(await f.ledger.readRecord("137")).toMatchObject({
          ok: true,
          value: { observations: { workItemCommentId: "481" } },
        });
    },
  );

  it("intake suppression still advances both cursors without a signal", async () => {
    const f = await fixture(true);
    const result = await runDevSquadAdoWorkflowWatchPass({
      ...f.request,
      intakeRules: { phases: ["different"], statuses: ["open"] },
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        signals: [],
        counts: { acted: 0, suppressed: 1 },
        outcomes: [
          {
            kind: "intake-suppressed",
            cursorChanges: ["work-item-comment", "pull-request-thread"],
          },
        ],
      },
    });
    expect(await f.ledger.readRecord("137")).toMatchObject({
      ok: true,
      value: {
        observations: {
          workItemCommentId: "481",
          pullRequest: { threadId: "thread", commentId: "481" },
        },
        activeClaim: null,
      },
    });
    expect(f.tracked.checkpoint).toHaveBeenCalledTimes(1);
  });

  it.each(["work-item", "pull-request"] as const)(
    "rejects duplicate %s identities without changing either cursor",
    async (kind) => {
      const f = await fixture(true);
      if (kind === "work-item")
        f.comments.mockResolvedValue({
          kind: "window",
          commentIds: ["480", "481", "481"],
        });
      else
        f.pr.mockResolvedValue({ kind: "window", entries: [anchor, anchor] });
      expect(await runDevSquadAdoWorkflowWatchPass(f.request)).toMatchObject({
        ok: true,
        value: {
          signals: [],
          outcomes: [{ reason: "invalid-observation-window" }],
        },
      });
      await f.unchanged();
    },
  );

  it("keeps seam order and newest complete PR pair despite a trailing incomplete entry", async () => {
    const f = await fixture(true);
    f.comments.mockResolvedValue({
      kind: "window",
      commentIds: ["480", "9", "2"],
    });
    f.pr.mockResolvedValue({
      kind: "window",
      entries: [
        anchor,
        { threadId: "z", commentId: "9" },
        { threadId: "a", commentId: "2" },
        { threadId: "last", commentId: null },
      ],
    });
    expect(await runDevSquadAdoWorkflowWatchPass(f.request)).toMatchObject({
      ok: true,
      value: {
        outcomes: [
          {
            kind: "acted",
            skippedCursorKinds: [],
            cursorChanges: ["work-item-comment", "pull-request-thread"],
          },
        ],
      },
    });
    expect(await f.ledger.readRecord("137")).toMatchObject({
      ok: true,
      value: {
        observations: {
          workItemCommentId: "2",
          pullRequest: { threadId: "a", commentId: "2" },
        },
      },
    });
  });
});

// W044 / FR-047/051/052 / CC-012/034/035: integrated finalization uses
// real authority and publication, including abort raised by mandatory cleanup.
describe("integrated discovery finalization [W044]", () => {
  it("rechecks cancellation between cleanup attempts for retained checkpoints", async () => {
    const f = await fixture();
    await seedWatcherRecord(f.ledger, {
      workItemId: 138,
      phase: "ready",
      status: "open",
      workItemCommentId: "480",
    });
    const controller = new AbortController();
    f.tracked.checkpoint.mockResolvedValue({
      ok: false,
      error: { kind: "storage", outcome: "indeterminate" },
    });
    f.tracked.releaseClaim.mockImplementation(async (request) => {
      const accepted = await f.ledger.releaseClaim(request);
      if (request.workItemId === "137") controller.abort();
      return accepted;
    });
    const result = await runDevSquadAdoWorkflowWatchPass({
      ...f.request,
      signal: controller.signal,
      budgets: { ...f.request.budgets, maxPolls: 1 },
      seam: {
        ...f.request.seam,
        discoverWorkItemsPage: async (request) => ({
          ...request,
          items: [138, 137].map((workItemId) => ({ workItemId, facts: {} })),
          next: { kind: "terminal" },
        }),
      },
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        stopReason: "cancelled",
        traversal: {
          status: "incomplete",
          reason: "cancelled",
          terminalPageSeen: true,
        },
        signals: [],
        counts: { processed: 2, failed: 2, cleanupReleased: 2 },
        outcomes: [
          { workItemId: "137", reason: "checkpoint-indeterminate" },
          { workItemId: "138", reason: "cancelled" },
        ],
      },
    });
    expect(
      f.tracked.releaseClaim.mock.calls.map(([r]) => r.workItemId),
    ).toEqual(["137", "138"]);
    expect(f.tracked.checkpoint).toHaveBeenCalledTimes(2);
    for (const id of [137, 138])
      expect(await f.ledger.readRecord(id)).toMatchObject({
        ok: true,
        value: {
          activeClaim: null,
          observations: { workItemCommentId: "480" },
        },
      });
  });

  it.each(["released", "failed", "indeterminate"] as const)(
    "keeps acknowledgement order distinct from dispositions and partitions cleanup: %s",
    async (cleanup) => {
      const f = await fixture();
      for (const [workItemId, phase] of [
        [140, "ready"],
        [141, "suppressed"],
        [142, "ready"],
      ] as const)
        await seedWatcherRecord(f.ledger, {
          workItemId,
          phase,
          status: "open",
          workItemCommentId: "480",
        });
      const attempts = new Map<string, number>();
      f.tracked.checkpoint.mockImplementation(async (request) => {
        const id = String(request.workItemId);
        attempts.set(id, (attempts.get(id) ?? 0) + 1);
        if (id === "137" && attempts.get(id) === 1)
          return {
            ok: false,
            error: { kind: "storage", outcome: "indeterminate" },
          };
        return f.ledger.checkpoint(request);
      });
      f.tracked.releaseClaim.mockImplementation(async (request) => {
        if (request.workItemId === "142" && cleanup !== "released") {
          if (cleanup === "indeterminate") throw Error("private-cleanup-error");
          return { ok: false, error: { kind: "claim-authorization" } };
        }
        return f.ledger.releaseClaim(request);
      });
      f.comments.mockImplementation(async (request) => {
        if (request.workItemId === "140")
          throw Error("private-observation-error");
        return { kind: "window", commentIds: ["480", "481"] };
      });
      const result = await runDevSquadAdoWorkflowWatchPass({
        ...f.request,
        delay: (ms, signal) =>
          ms === 10 ? f.request.delay(ms, signal) : Promise.resolve(),
        discovery: {
          ...f.request.discovery,
          policy: {
            version: "mixed",
            filters: [
              {
                dimension: "state" as const,
                operator: "one-of" as const,
                values: ["included"],
              },
            ],
          },
          authorizations: [138, 100].map((workItemId) => ({
            workItemId,
            kind: "authorized" as const,
            submissionId: "original",
            initial: { phase: "ready", status: "open" },
          })),
        },
        seam: {
          ...f.request.seam,
          discoverWorkItemsPage: async (request) => ({
            ...request,
            items: (request.pageOrdinal === 1
              ? [142, 141, 140, 139, 138, 137]
              : [100]
            ).map((workItemId) => ({
              workItemId,
              facts: {
                state: {
                  kind: "known",
                  value: workItemId === 139 ? "excluded" : "included",
                },
              },
            })),
            next:
              request.pageOrdinal === 1
                ? { kind: "continue", continuation: "private-continuation" }
                : { kind: "terminal" },
          }),
        },
      });
      expect(result).toMatchObject({
        ok: true,
        value: {
          stopReason: "completed",
          polls: 2,
          traversal: {
            status: "complete",
            reason: "terminal-page",
            terminalPageSeen: true,
          },
          counts: {
            pageCalls: 2,
            pagesValidated: 2,
            discovered: 7,
            evaluated: 7,
            admitted: 2,
            initializationReplayed: 0,
            paused: 1,
            processed: 7,
            examined: 6,
            eligible: 3,
            acted: 4,
            noChange: 0,
            suppressed: 1,
            skipped: 1,
            failed: cleanup === "released" ? 1 : 2,
            cleanupReleased: cleanup === "released" ? 3 : 2,
            cleanupFailed: cleanup === "failed" ? 1 : 0,
            cleanupIndeterminate: cleanup === "indeterminate" ? 1 : 0,
            cleanupNotRequired: 4,
          },
        },
      });
      if (!result.ok) throw Error("expected discovery result");
      expect(result.value.outcomes.map((o) => o.workItemId)).toEqual([
        "137",
        "138",
        "139",
        "140",
        "141",
        "142",
        "100",
      ]);
      expect(result.value.signals.map((o) => [o.workItemId, o.kind])).toEqual([
        ["138", "discovery-admission"],
        ["142", "comment-observation"],
        ["137", "comment-observation"],
        ["100", "discovery-admission"],
      ]);
      expect(new Set(result.value.signals.map((o) => o.workItemId)).size).toBe(
        4,
      );
      expect(
        f.tracked.releaseClaim.mock.calls.map(([r]) => r.workItemId),
      ).toEqual(["141", "142", "137"]);
      expect(
        f.tracked.checkpoint.mock.calls
          .filter(([r]) => r.workItemId === "137")
          .map(([r]) => r.operationId)[0],
      ).toBe(
        f.tracked.checkpoint.mock.calls
          .filter(([r]) => r.workItemId === "137")
          .map(([r]) => r.operationId)[1],
      );
      expect(JSON.stringify(result)).not.toMatch(/private-/);
    },
  );

  it.each([
    "read",
    "work-item",
    "pull-request",
    "acquire",
    "checkpoint",
    "release",
  ] as const)(
    "fresh abort at %s prevents later effects without retracting accepted checkpoints",
    async (boundary) => {
      const f = await fixture(true);
      const controller = new AbortController();
      if (boundary === "read")
        f.tracked.readRecord.mockImplementation(async (id) => {
          const result = await f.ledger.readRecord(id);
          controller.abort();
          return result;
        });
      if (boundary === "work-item")
        f.comments.mockImplementation(async () => {
          controller.abort();
          return { kind: "window", commentIds: ["480", "481"] };
        });
      if (boundary === "pull-request")
        f.pr.mockImplementation(async () => {
          controller.abort();
          return {
            kind: "window",
            entries: [anchor, { threadId: "thread", commentId: "481" }],
          };
        });
      if (boundary === "acquire")
        f.tracked.acquireClaim.mockImplementation(async (request) => {
          const result = await f.ledger.acquireClaim(request);
          controller.abort();
          return result;
        });
      if (boundary === "checkpoint")
        f.tracked.checkpoint.mockImplementation(async (request) => {
          const result = await f.ledger.checkpoint(request);
          controller.abort();
          return result;
        });
      if (boundary === "release")
        f.tracked.releaseClaim.mockImplementation(async (request) => {
          const result = await f.ledger.releaseClaim(request);
          controller.abort();
          return result;
        });
      const accepted = boundary === "checkpoint" || boundary === "release";
      const acquired = accepted || boundary === "acquire";
      const result = await runDevSquadAdoWorkflowWatchPass({
        ...f.request,
        signal: controller.signal,
      });
      expect(result).toMatchObject({
        ok: true,
        value: {
          stopReason: "cancelled",
          traversal: { status: "incomplete", terminalPageSeen: true },
          counts: {
            acted: accepted ? 1 : 0,
            cleanupReleased: acquired ? 1 : 0,
            cleanupNotRequired: acquired ? 0 : 1,
          },
        },
      });
      if (boundary === "read" || boundary === "work-item")
        expect(f.pr).not.toHaveBeenCalled();
      expect(f.tracked.checkpoint).toHaveBeenCalledTimes(accepted ? 1 : 0);
      expect(f.tracked.releaseClaim).toHaveBeenCalledTimes(acquired ? 1 : 0);
      expect(await f.ledger.readRecord(137)).toMatchObject({
        ok: true,
        value: {
          activeClaim: null,
          observations: { workItemCommentId: accepted ? "481" : "480" },
        },
      });
    },
  );
});

// W044 / FR-036/051-053/059: no abandoned ledger writes or late seam effects.
describe("discovery cancellation boundaries and retired lifecycles [W044]", () => {
  it.each([
    "before-pass",
    "poll-clock",
    "page-settled",
    "page-validation",
    "between-polls",
  ] as const)("stops scheduling at %s", async (boundary) => {
    const f = await fixture();
    const controller = new AbortController();
    let clocks = 0;
    const page = vi.fn<
      DevSquadAdoWatcherDiscoverySeam["discoverWorkItemsPage"]
    >(async (request) => {
      if (boundary === "page-settled") controller.abort();
      return {
        ...request,
        items: [
          {
            workItemId: 137,
            get facts() {
              if (boundary === "page-validation") controller.abort();
              return {};
            },
          },
        ],
        next: { kind: "continue", continuation: "private-token" },
      };
    });
    if (boundary === "before-pass") controller.abort();
    const result = await runDevSquadAdoWorkflowWatchPass({
      ...f.request,
      signal: controller.signal,
      clock: () => {
        if (++clocks === 2 && boundary === "poll-clock") controller.abort();
        return f.request.clock();
      },
      delay: (ms, signal) => {
        if (ms === 10) return f.request.delay(ms, signal);
        controller.abort();
        return Promise.resolve();
      },
      seam: { ...f.request.seam, discoverWorkItemsPage: page },
    });
    const processed = boundary === "between-polls";
    expect(result).toMatchObject({
      ok: true,
      value: {
        stopReason: "cancelled",
        traversal: {
          status: "incomplete",
          reason: "cancelled",
          terminalPageSeen: false,
        },
        counts: {
          pageCalls: ["before-pass", "poll-clock"].includes(boundary) ? 0 : 1,
          pagesValidated: processed ? 1 : 0,
          discovered: processed ? 1 : 0,
          acted: processed ? 1 : 0,
        },
      },
    });
    expect(f.tracked.readRecord).toHaveBeenCalledTimes(processed ? 1 : 0);
    expect(f.tracked.releaseClaim).toHaveBeenCalledTimes(processed ? 1 : 0);
  });

  it("aborts after awaited renewal without retrying the checkpoint or losing cleanup authority", async () => {
    const f = await fixture();
    const controller = new AbortController();
    let now = Date.parse("2026-09-10T00:00:00.000Z");
    vi.mocked(f.request.clock).mockImplementation(() => new Date(now));
    f.tracked.checkpoint.mockResolvedValue({
      ok: false,
      error: { kind: "storage", outcome: "indeterminate" },
    });
    f.tracked.renewClaim.mockImplementation(async (request) => {
      const result = await f.ledger.renewClaim(request);
      controller.abort();
      return result;
    });
    const result = await runDevSquadAdoWorkflowWatchPass({
      ...f.request,
      signal: controller.signal,
      budgets: { ...f.request.budgets, maxPollStartElapsedMs: 100000 },
      delay: (ms, signal) => {
        if (ms === 10) return f.request.delay(ms, signal);
        now += 50000;
        return Promise.resolve();
      },
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        stopReason: "cancelled",
        signals: [],
        outcomes: [{ reason: "cancelled", cleanup: { status: "released" } }],
      },
    });
    expect(f.tracked.renewClaim).toHaveBeenCalledTimes(1);
    expect(f.tracked.checkpoint).toHaveBeenCalledTimes(1);
    expect(f.tracked.releaseClaim).toHaveBeenCalledTimes(1);
    expect(await f.ledger.readRecord(137)).toMatchObject({
      ok: true,
      value: { activeClaim: null, observations: { workItemCommentId: "480" } },
    });
  });

  it("preserves original-submission history acceptance when the recovery read aborts", async () => {
    const f = await fixture();
    const controller = new AbortController();
    f.tracked.checkpoint.mockImplementation(async (request) => {
      const accepted = await f.ledger.checkpoint(request);
      expect(accepted.ok).toBe(true);
      return {
        ok: false,
        error: { kind: "storage", outcome: "indeterminate" },
      };
    });
    let reads = 0;
    f.tracked.readRecord.mockImplementation(async (id) => {
      const read = await f.ledger.readRecord(id);
      if (++reads === 2) controller.abort();
      return read;
    });
    const result = await runDevSquadAdoWorkflowWatchPass({
      ...f.request,
      signal: controller.signal,
      delay: (ms, signal) =>
        ms === 10 ? f.request.delay(ms, signal) : Promise.resolve(),
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        stopReason: "cancelled",
        counts: { acted: 1 },
        signals: [{ kind: "comment-observation", sourceRevision: 4 }],
        outcomes: [
          {
            cursorChanges: ["work-item-comment"],
            cleanup: { status: "released" },
          },
        ],
      },
    });
    expect(f.comments).toHaveBeenCalledTimes(1);
    expect(f.tracked.checkpoint).toHaveBeenCalledTimes(1);
    expect(f.tracked.releaseClaim).toHaveBeenCalledTimes(1);
  });

  it.each(["lost", "malformed"] as const)(
    "never fabricates cleanup authority after durable %s acquire acknowledgement",
    async (failure) => {
      const f = await fixture();
      const controller = new AbortController();
      f.tracked.acquireClaim.mockImplementation(async (request) => {
        const accepted = await f.ledger.acquireClaim(request);
        expect(accepted.ok).toBe(true);
        controller.abort();
        if (failure === "lost") throw Error("private-acquire-ack");
        return { ok: true, value: {} } as unknown as typeof accepted;
      });
      const result = await runDevSquadAdoWorkflowWatchPass({
        ...f.request,
        signal: controller.signal,
      });
      expect(result).toMatchObject({
        ok: true,
        value: {
          stopReason: "cancelled",
          signals: [],
          counts: { cleanupIndeterminate: 1, failed: 1 },
          outcomes: [
            {
              ledgerErrorKind: "ledger-fault",
              cleanup: { reason: "authority-unvalidated" },
            },
          ],
        },
      });
      expect(f.tracked.releaseClaim).not.toHaveBeenCalled();
      expect(f.tracked.checkpoint).not.toHaveBeenCalled();
      expect(await f.ledger.readRecord(137)).toMatchObject({
        ok: true,
        value: {
          activeClaim: { ownerId: "host" },
          observations: { workItemCommentId: "480" },
        },
      });
      expect(JSON.stringify(result)).not.toContain("private-acquire-ack");
    },
  );

  it.each(["page", "work-item", "pull-request"] as const)(
    "retires noncooperating %s calls on abort/timeout and quarantines late fulfillment/rejection",
    async (boundary) => {
      for (const ending of ["abort", "timeout"] as const)
        for (const settlement of ["fulfill", "reject"] as const) {
          const f = await fixture(true);
          const controller = new AbortController();
          const add = vi.spyOn(controller.signal, "addEventListener");
          const remove = vi.spyOn(controller.signal, "removeEventListener");
          let announce!: () => void;
          const entered = new Promise<void>((resolve) => {
            announce = resolve;
          });
          let fulfill!: (value: unknown) => void;
          let reject!: (error: Error) => void;
          const late = new Promise<unknown>((resolve, rejectPromise) => {
            fulfill = resolve;
            reject = rejectPromise;
          });
          let child!: AbortSignal;
          let expire!: () => void;
          let selected = false;
          const timers: AbortSignal[] = [];
          const wait = (signal: AbortSignal | undefined) => {
            if (!signal) throw Error("missing child signal");
            child = signal;
            selected = true;
            return late;
          };
          const run = runDevSquadAdoWorkflowWatchPass({
            ...f.request,
            signal: controller.signal,
            delay: (ms, signal) => {
              if (signal) timers.push(signal);
              if (selected)
                return new Promise<void>((resolve) => {
                  expire = resolve;
                  announce();
                });
              return f.request.delay(ms, signal);
            },
            seam: {
              discoverWorkItemsPage: (request) =>
                boundary === "page"
                  ? (wait(request.signal) as ReturnType<
                      DevSquadAdoWatcherDiscoverySeam["discoverWorkItemsPage"]
                    >)
                  : f.request.seam.discoverWorkItemsPage(request),
              observeWorkItemComments: (request) =>
                boundary === "work-item"
                  ? (wait(request.signal) as ReturnType<
                      DevSquadAdoWatcherDiscoverySeam["observeWorkItemComments"]
                    >)
                  : f.comments(request),
              observePullRequestActivity: (request) =>
                wait(request.signal) as ReturnType<
                  NonNullable<
                    DevSquadAdoWatcherDiscoverySeam["observePullRequestActivity"]
                  >
                >,
            },
          });
          await entered;
          if (ending === "abort") controller.abort();
          else expire();
          const result = await run;
          expect(result).toMatchObject({
            ok: true,
            value: {
              stopReason:
                ending === "abort"
                  ? "cancelled"
                  : boundary === "page"
                    ? "discovery-incomplete"
                    : "completed",
              signals: [],
              counts: {
                discovered: boundary === "page" ? 0 : 1,
                acted: 0,
                cleanupNotRequired: boundary === "page" ? 0 : 1,
              },
            },
          });
          expect(child.aborted).toBe(true);
          expect(timers.every((signal) => signal.aborted)).toBe(true);
          expect(remove.mock.calls.map((call) => call[1])).toEqual(
            add.mock.calls.map((call) => call[1]),
          );
          const snapshot = JSON.stringify(result);
          const artifacts = await readWatcherLedgerArtifacts(f.repositoryRoot);
          if (settlement === "reject") reject(Error("private-late-rejection"));
          else
            fulfill({
              kind: "window",
              commentIds: ["480", "late"],
              entries: [anchor],
            });
          expire(); // Retire even the deliberately noncooperating timer dependency.
          await Promise.resolve();
          await Promise.resolve();
          expect(JSON.stringify(result)).toBe(snapshot);
          expect(await readWatcherLedgerArtifacts(f.repositoryRoot)).toEqual(
            artifacts,
          );
          expect(f.tracked.acquireClaim).not.toHaveBeenCalled();
          expect(f.tracked.releaseClaim).not.toHaveBeenCalled();
        }
    },
  );
});

// W044 / SEC-A01-A07 / CC-024/027/031: only public IDs and expressly
// authorized workflow values may leave the private fact/authorization boundary.
describe("discovery integrated privacy [W044]", () => {
  it("minimizes results, errors, diagnostics, mutation fields and every durable artifact", async () => {
    const f = await fixture();
    const privateValues = [
      "private-fact",
      "private-policy-only",
      "private-submission",
      "private-continuation",
      "private-error",
      "private-body",
    ];
    f.tracked.readRecord.mockImplementation(async (id) =>
      id === "139"
        ? {
            ok: false,
            error: { kind: "corrupt-artifact", artifact: "private-error" },
          }
        : f.ledger.readRecord(id),
    );
    f.comments.mockResolvedValue({
      kind: "window",
      commentIds: ["480", "481"],
      body: "private-body",
    } as DevSquadAdoDiscoveryWorkItemObservation);
    const result = await runDevSquadAdoWorkflowWatchPass({
      ...f.request,
      intakeRules: {
        phases: ["ready", "authorized-initial-phase"],
        statuses: ["open"],
      },
      delay: (ms, signal) =>
        ms === 10 ? f.request.delay(ms, signal) : Promise.resolve(),
      discovery: {
        ...f.request.discovery,
        policy: {
          version: "public-policy-version",
          filters: [
            {
              dimension: "state",
              operator: "one-of",
              values: ["private-fact", "private-policy-only"],
            },
          ],
        },
        authorizations: [
          {
            workItemId: 138,
            kind: "authorized",
            submissionId: "private-submission",
            initial: { phase: "authorized-initial-phase", status: "open" },
          },
        ],
      },
      seam: {
        ...f.request.seam,
        discoverWorkItemsPage: async (request) => ({
          ...request,
          items: (request.pageOrdinal === 1 ? [137, 138, 139] : [140]).map(
            (workItemId) => ({
              workItemId,
              facts: {
                state: {
                  kind: "known",
                  value: workItemId === 140 ? "excluded" : "private-fact",
                },
              },
              body: "private-body",
            }),
          ),
          next:
            request.pageOrdinal === 1
              ? { kind: "continue", continuation: "private-continuation" }
              : { kind: "terminal" },
        }),
      },
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        counts: { admitted: 1, acted: 2, failed: 1, paused: 1 },
        outcomes: [
          { category: "observation" },
          { category: "admission" },
          { category: "observation", ledgerErrorKind: "corrupt-artifact" },
          { category: "matching" },
        ],
      },
    });
    const capabilities = f.tracked.acquireClaim.mock.calls.map(
      ([request]) => request.claimToken,
    );
    expect(capabilities).toHaveLength(1);
    const submitted = [
      ...f.tracked.initializeRecord.mock.calls,
      ...f.tracked.acquireClaim.mock.calls,
      ...f.tracked.checkpoint.mock.calls,
      ...f.tracked.releaseClaim.mock.calls,
    ].map(([request]) => {
      const fields = structuredClone(request) as unknown as Record<
        string,
        unknown
      >;
      // Authority is necessary only on the claim/mutation input, never evidence.
      if ("claimToken" in fields) {
        expect(capabilities).toContain(fields.claimToken);
        delete fields.claimToken;
      }
      if (fields.authority) {
        const authority = fields.authority as Record<string, unknown>;
        expect(capabilities).toContain(authority.claimToken);
        delete authority.claimToken;
      }
      return fields;
    });
    const surfaces = [
      result,
      submitted,
      await f.ledger.readRecord(137),
      await f.ledger.readRecord(138),
      await f.ledger.listResumableRecords(),
      await f.ledger.inspectRecoveryErrors(),
      await readWatcherLedgerArtifacts(f.repositoryRoot),
    ];
    for (const surface of surfaces)
      for (const forbidden of [...privateValues, ...capabilities])
        expect(JSON.stringify(surface)).not.toContain(forbidden);
    expect(JSON.stringify(result)).toContain("authorized-initial-phase");
    expect(
      JSON.stringify(await readWatcherLedgerArtifacts(f.repositoryRoot)),
    ).toContain("authorized-initial-phase");
  });
});

// W044 / FR-036/052/059: signal eligibility survives abort and failed cleanup,
// but it never survives an invalid or missing checkpoint acknowledgement.
describe("awaited checkpoint settlement [W044]", () => {
  it.each(["fresh", "replayed", "lost", "malformed"] as const)(
    "awaits %s acknowledgement after abort and attempts cleanup exactly once",
    async (acknowledgement) => {
      const f = await fixture();
      const controller = new AbortController();
      let enter!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      let settle!: () => void;
      const held = new Promise<void>((resolve) => {
        settle = resolve;
      });
      f.tracked.checkpoint.mockImplementation(async (request) => {
        const accepted = await f.ledger.checkpoint(request);
        expect(accepted.ok).toBe(true);
        const result =
          acknowledgement === "replayed"
            ? await f.ledger.checkpoint(request)
            : accepted;
        enter();
        await held;
        if (acknowledgement === "lost") throw Error("private-checkpoint-ack");
        if (acknowledgement === "malformed")
          return { ok: true, value: {} } as unknown as typeof result;
        return result;
      });
      f.tracked.releaseClaim.mockImplementation(async () => {
        throw Error("private-cleanup-ack");
      });
      let returned = false;
      const pass = runDevSquadAdoWorkflowWatchPass({
        ...f.request,
        signal: controller.signal,
      }).then((result) => {
        returned = true;
        return result;
      });
      await entered;
      controller.abort();
      await Promise.resolve();
      await Promise.resolve();
      expect(returned).toBe(false);
      expect(f.tracked.releaseClaim).not.toHaveBeenCalled();
      settle();
      const result = await pass;
      const valid =
        acknowledgement === "fresh" || acknowledgement === "replayed";
      expect(result).toMatchObject({
        ok: true,
        value: {
          stopReason: "cancelled",
          traversal: { status: "incomplete", terminalPageSeen: true },
          counts: {
            acted: valid ? 1 : 0,
            failed: 1,
            cleanupIndeterminate: 1,
            cleanupReleased: 0,
          },
          outcomes: [
            {
              kind: "failed",
              ledgerErrorKind: "ledger-fault",
              cursorChanges: valid ? ["work-item-comment"] : [],
              cleanup: { status: "indeterminate" },
            },
          ],
        },
      });
      expect(f.tracked.releaseClaim).toHaveBeenCalledTimes(1);
      expect(f.tracked.checkpoint).toHaveBeenCalledTimes(1);
      const reopened = await openWatcherLedger(
        f.repositoryRoot,
        f.request.clock,
      );
      expect(await reopened.readRecord(137)).toMatchObject({
        ok: true,
        value: { observations: { workItemCommentId: "481" } },
      });
      for (const surface of [
        result,
        await reopened.inspectRecoveryErrors(),
        await readWatcherLedgerArtifacts(f.repositoryRoot),
      ])
        expect(JSON.stringify(surface)).not.toMatch(/private-/);
    },
  );
});
