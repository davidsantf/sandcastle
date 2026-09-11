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
