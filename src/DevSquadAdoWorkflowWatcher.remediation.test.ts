import { describe, expect, it, vi } from "vitest";
import type {
  CheckpointDevSquadAdoWorkflowInput,
  DevSquadAdoWorkflowLedger,
  DevSquadAdoWorkflowRecord,
  DevSquadAdoLedgerError,
} from "./DevSquadAdoWorkflowLedger.js";
import {
  runDevSquadAdoWorkflowWatchPass,
  validateDevSquadAdoWorkflowWatchPassOptions,
  type RunDevSquadAdoWorkflowWatchPassOptions,
  type DevSquadAdoWatcherPullRequestObservationEntry,
} from "./DevSquadAdoWorkflowWatcher.js";
import { guardDevSquadAdoWatcherLedger } from "./DevSquadAdoWorkflowWatcherLedger.js";

const NOW = "2026-01-01T00:00:00.000Z";
const METHODS = [
  "readRecord",
  "acquireClaim",
  "renewClaim",
  "checkpoint",
  "releaseClaim",
] as const;
type Method = (typeof METHODS)[number];
const baseRecord = (): DevSquadAdoWorkflowRecord => ({
  schemaVersion: 1,
  workItemId: "137",
  revision: 4,
  createdAt: NOW,
  updatedAt: NOW,
  phase: "implement",
  status: "ready",
  branch: null,
  worktreePath: null,
  agent: { current: null, history: [] },
  session: { current: null, history: [] },
  pullRequest: { id: null, url: null },
  observations: { workItemCommentId: "480", pullRequest: null },
  checkpoints: [],
  activeClaim: null,
  fencingCounter: 1,
});
const fixture = () => {
  let record = baseRecord();
  const requests: { method: Method; input: unknown }[] = [];
  const success = <T>(outcome: T) => ({
    ok: true as const,
    value: {
      acceptedRevision: record.revision,
      acceptedAt: NOW,
      replayed: false,
      outcome,
      record: structuredClone(record),
    },
  });
  const ledger: DevSquadAdoWorkflowLedger = {
    initializeRecord: vi.fn(),
    listResumableRecords: vi.fn(),
    inspectRecoveryErrors: vi.fn(),
    readRecord: vi.fn(async (input) => {
      requests.push({ method: "readRecord", input });
      return { ok: true as const, value: structuredClone(record) };
    }),
    acquireClaim: vi.fn(async (input) => {
      requests.push({ method: "acquireClaim", input });
      const authority = {
        workItemId: "137",
        ownerId: input.ownerId,
        claimToken: input.claimToken,
        fencingValue: record.fencingCounter + 1,
        acquiredAt: NOW,
        heartbeatAt: NOW,
        expiresAt: new Date(
          Date.parse(NOW) + input.leaseDurationMs,
        ).toISOString(),
      };
      const { claimToken: _, ...metadata } = authority;
      record = {
        ...record,
        revision: record.revision + 1,
        fencingCounter: authority.fencingValue,
        activeClaim: metadata,
      };
      return success({ kind: "claim-acquired" as const, authority });
    }),
    renewClaim: vi.fn(async (input) => {
      requests.push({ method: "renewClaim", input });
      const claim = {
        ...record.activeClaim!,
        heartbeatAt: NOW,
        expiresAt: new Date(
          Date.parse(NOW) + input.leaseDurationMs,
        ).toISOString(),
      };
      record = { ...record, revision: record.revision + 1, activeClaim: claim };
      return success({ kind: "claim-renewed" as const, claim });
    }),
    checkpoint: vi.fn(async (input) => {
      requests.push({ method: "checkpoint", input });
      const checkpoint = {
        revision: record.revision + 1,
        operationId: input.operationId,
        acceptedAt: NOW,
        previous: { phase: record.phase, status: record.status },
        resulting: { phase: record.phase, status: record.status },
      };
      record = {
        ...record,
        revision: checkpoint.revision,
        observations: { ...record.observations, ...input.patch.observations },
        checkpoints: [...record.checkpoints, checkpoint],
      };
      return success({ kind: "checkpointed" as const, checkpoint });
    }),
    releaseClaim: vi.fn(async (input) => {
      requests.push({ method: "releaseClaim", input });
      record = { ...record, revision: record.revision + 1, activeClaim: null };
      return success({
        kind: "claim-released" as const,
        releasedClaim: {
          ownerId: input.authority.ownerId,
          fencingValue: input.authority.fencingValue,
          releasedAt: NOW,
        },
      });
    }),
  };
  const options: RunDevSquadAdoWorkflowWatchPassOptions = {
    ledger,
    seam: {
      observeWorkItemComments: vi.fn(async () => ({
        commentIds: ["480", "481"],
      })),
      observePullRequestActivity: vi.fn(async () => ({ entries: [] })),
    },
    passId: "recovery",
    ownerId: "watch-a",
    candidates: [137],
    intakeRules: { phases: ["implement"], statuses: ["ready"] },
    budgets: {
      maxPolls: 1,
      maxPollStartElapsedMs: 1000,
      observationTimeoutMs: 50,
    },
    clock: vi.fn(() => new Date(NOW)),
    delay: vi.fn(
      (_ms, signal) =>
        new Promise<void>((resolve) => {
          if (signal?.aborted) resolve();
          else
            signal?.addEventListener("abort", () => resolve(), { once: true });
        }),
    ),
  };
  return {
    ledger,
    options,
    requests,
    read: () => structuredClone(record),
    set: (patch: Partial<DevSquadAdoWorkflowRecord>) => {
      record = { ...record, ...patch };
    },
  };
};
type Fixture = ReturnType<typeof fixture>;
const run = async (options: RunDevSquadAdoWorkflowWatchPassOptions) => {
  const result = await runDevSquadAdoWorkflowWatchPass(options);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("unexpected validation failure");
  expect(
    result.value.counts.cleanupReleased +
      result.value.counts.cleanupFailed +
      result.value.counts.cleanupIndeterminate +
      result.value.counts.cleanupNotRequired,
  ).toBe(result.value.outcomes.length);
  return result.value;
};
const inject = (
  f: Fixture,
  method: Method,
  response: unknown,
  durable = false,
) => {
  const original = f.ledger[method];
  return {
    ...f.options,
    ledger: {
      ...f.ledger,
      [method]: vi.fn(async (input: never) => {
        if (durable) await original(input);
        return response;
      }),
    },
    ...(method === "renewClaim"
      ? { clock: () => new Date(Date.parse(NOW) + 50_000) }
      : {}),
  };
};

describe("third independent history regressions [RC14-008][TEST-026][TEST-031]", () => {
  const ambiguous = {
    ok: false as const,
    error: { kind: "storage" as const, outcome: "indeterminate" as const },
  };
  const polls = (f: Fixture): RunDevSquadAdoWorkflowWatchPassOptions => ({
    ...f.options,
    budgets: {
      ...f.options.budgets,
      maxPolls: 3,
      maxPollStartElapsedMs: 200_000,
    },
    delay: (ms, signal) =>
      signal === undefined ? Promise.resolve() : f.options.delay(ms, signal),
  });

  it.each([
    "A-accepted5-latest5",
    "B-accepted6-cursor480",
    "accepted5-newer-latest7",
    "phase",
    "status",
    "previous-phase",
    "previous-status",
    "owner",
    "fence",
    "missing-authority",
    "timestamp",
    "pr-cursor",
  ] as const)("rejects contradictory history: %s", async (defect) => {
    const f = fixture();
    let options = polls(f);
    if (defect === "pr-cursor") {
      f.set({
        pullRequest: { id: "42", url: null },
        observations: {
          workItemCommentId: "480",
          pullRequest: { threadId: "10", commentId: "20" },
        },
      });
      options = {
        ...options,
        seam: {
          ...options.seam,
          observePullRequestActivity: vi.fn(async () => ({
            entries: [
              { threadId: "10", commentId: "20" },
              { threadId: "11", commentId: "21" },
            ],
          })),
        },
      };
    }
    const submitted: CheckpointDevSquadAdoWorkflowInput[] = [];
    const checkpoint = vi.fn(
      async (input: CheckpointDevSquadAdoWorkflowInput) => {
        submitted.push(structuredClone(input));
        await f.ledger.checkpoint(input);
        const record = f.read();
        const entry = record.checkpoints[0]!;
        if (
          defect === "A-accepted5-latest5" ||
          defect === "accepted5-newer-latest7"
        ) {
          f.set({
            revision: defect === "A-accepted5-latest5" ? 5 : 7,
            observations: { ...record.observations, workItemCommentId: "480" },
            checkpoints: [{ ...entry, revision: 5 }],
          });
        } else if (defect === "B-accepted6-cursor480") {
          f.set({
            observations: { ...record.observations, workItemCommentId: "480" },
          });
        } else if (defect === "phase" || defect === "status") {
          const state = {
            phase: record.phase,
            status: record.status,
            [defect]: "other",
          };
          f.set({
            ...state,
            checkpoints: [{ ...entry, previous: state, resulting: state }],
          });
        } else if (
          defect === "previous-phase" ||
          defect === "previous-status"
        ) {
          f.set({
            checkpoints: [
              {
                ...entry,
                previous: {
                  ...entry.previous,
                  [defect === "previous-phase" ? "phase" : "status"]: "other",
                },
              },
            ],
          });
        } else if (defect === "owner") {
          f.set({
            activeClaim: { ...record.activeClaim!, ownerId: "watch-b" },
          });
        } else if (defect === "fence") {
          f.set({
            fencingCounter: 3,
            activeClaim: { ...record.activeClaim!, fencingValue: 3 },
          });
        } else if (defect === "missing-authority") {
          f.set({ activeClaim: null });
        } else if (defect === "timestamp") {
          f.set({ updatedAt: "2026-01-01T00:00:01.000Z" });
        } else {
          f.set({
            observations: {
              ...record.observations,
              pullRequest: { threadId: "10", commentId: "20" },
            },
          });
        }
        return ambiguous;
      },
    );
    const result = await run({
      ...options,
      ledger: { ...f.ledger, checkpoint },
    });
    expect(result.polls).toBe(2);
    expect(result.outcomes[0]).toMatchObject({
      kind: "failed",
      reason: "ledger-unavailable",
      ledgerErrorKind: "ledger-fault",
      sourceRevision: 4,
      revision: null,
      cursorChanges: [],
    });
    expect(result.signals).toEqual([]);
    expect(result.counts).toMatchObject({ acted: 0, failed: 1 });
    expect(checkpoint).toHaveBeenCalledTimes(1);
    expect(f.ledger.readRecord).toHaveBeenCalledTimes(2);
    expect(f.ledger.renewClaim).not.toHaveBeenCalled();
    expect(f.ledger.releaseClaim).toHaveBeenCalledTimes(1);
    expect(f.ledger.releaseClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        authority: submitted[0]!.authority,
      }),
    );
    expect(JSON.stringify(result)).not.toContain(
      submitted[0]!.authority.claimToken,
    );
  });

  it.each([
    "same-revision",
    "newer-mutation",
    "newer-renewal",
    "newer-takeover",
  ] as const)("accepts consistent history: %s", async (later) => {
    const f = fixture();
    const checkpoint = vi.fn(
      async (input: CheckpointDevSquadAdoWorkflowInput) => {
        await f.ledger.checkpoint(input);
        const record = f.read();
        if (later === "newer-mutation") {
          f.set({
            revision: 7,
            phase: "review",
            status: "waiting",
            observations: { ...record.observations, workItemCommentId: "482" },
            checkpoints: [
              ...record.checkpoints,
              {
                revision: 7,
                operationId: "later-mutation",
                acceptedAt: NOW,
                previous: { phase: "implement", status: "ready" },
                resulting: { phase: "review", status: "waiting" },
              },
            ],
          });
        } else if (later === "newer-renewal") {
          f.set({
            revision: 7,
            activeClaim: {
              ...record.activeClaim!,
              expiresAt: "2026-01-01T00:02:00.000Z",
            },
          });
        } else if (later === "newer-takeover") {
          f.set({
            revision: 7,
            fencingCounter: 3,
            activeClaim: {
              ...record.activeClaim!,
              ownerId: "watch-b",
              fencingValue: 3,
            },
          });
        }
        return ambiguous;
      },
    );
    const releaseClaim =
      later === "newer-takeover"
        ? vi.fn(async () => ({
            ok: false as const,
            error: { kind: "stale-fencing" as const, currentFencingValue: 3 },
          }))
        : f.ledger.releaseClaim;
    const result = await run({
      ...polls(f),
      ledger: { ...f.ledger, checkpoint, releaseClaim },
    });
    expect(result.polls).toBe(2);
    expect(result.outcomes[0]).toMatchObject({
      kind: later === "newer-takeover" ? "failed" : "acted",
      revision: 6,
      sourceRevision: 4,
      cursorChanges: ["work-item-comment"],
      cleanup: { status: later === "newer-takeover" ? "failed" : "released" },
    });
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]).toMatchObject({
      sourceRevision: 4,
      phase: "implement",
      status: "ready",
      claim: { ownerId: "watch-a", fencingValue: 2 },
    });
    expect(result.counts.acted).toBe(1);
    expect(checkpoint).toHaveBeenCalledTimes(1);
    expect(f.ledger.readRecord).toHaveBeenCalledTimes(2);
    expect(f.ledger.renewClaim).not.toHaveBeenCalled();
    expect(releaseClaim).toHaveBeenCalledTimes(1);
  });

  it.each(["none", "before-first", "before-retry"] as const)(
    "recovers an ambiguous retry with renewal %s using its submitted preconditions",
    async (renewal) => {
      const f = fixture();
      let now = Date.parse(NOW) + (renewal === "before-first" ? 50_000 : 0);
      const submitted: CheckpointDevSquadAdoWorkflowInput[] = [];
      const checkpoint = vi.fn(
        async (input: CheckpointDevSquadAdoWorkflowInput) => {
          submitted.push(structuredClone(input));
          if (submitted.length === 1) {
            if (renewal === "before-retry") now += 50_000;
          } else {
            await f.ledger.checkpoint(input);
          }
          return ambiguous;
        },
      );
      const result = await run({
        ...polls(f),
        clock: () => new Date(now),
        lease: { leaseDurationMs: 60_000, renewalThresholdMs: 20_000 },
        ledger: { ...f.ledger, checkpoint },
      });
      const expected =
        renewal === "none"
          ? [5, 5]
          : renewal === "before-first"
            ? [6, 7]
            : [5, 6];
      expect(submitted.map((input) => input.expected.revision)).toEqual(
        expected,
      );
      expect(submitted[1]!.operationId).toBe(submitted[0]!.operationId);
      expect(submitted[1]!.patch).toEqual(submitted[0]!.patch);
      expect(submitted[1]!.authority).toEqual(submitted[0]!.authority);
      expect(result.polls).toBe(3);
      expect(result.outcomes[0]).toMatchObject({
        kind: "acted",
        sourceRevision: 4,
        revision: expected[1]! + 1,
        cursorChanges: ["work-item-comment"],
        cleanup: { status: "released" },
      });
      expect(result.signals).toHaveLength(1);
      expect(f.ledger.readRecord).toHaveBeenCalledTimes(3);
      expect(checkpoint).toHaveBeenCalledTimes(2);
      expect(f.ledger.renewClaim).toHaveBeenCalledTimes(
        renewal === "none" ? 0 : renewal === "before-first" ? 2 : 1,
      );
      expect(f.ledger.releaseClaim).toHaveBeenCalledTimes(1);
      expect(f.options.seam.observeWorkItemComments).toHaveBeenCalledTimes(1);
    },
  );
});

describe("second independent boundary regressions", () => {
  it.each(["wi", "pr", "candidates"] as const)(
    "[SC-01] rejects %s growth, shrinkage and last-getter growth without effects",
    async (kind) => {
      for (const mutation of [
        "grow",
        "shrink",
        "last-grow",
        "throw",
      ] as const) {
        const f = fixture();
        const ids = Array.from({ length: 1000 }, (_, i) => String(480 + i));
        const entries = ids.map((id) => ({ threadId: id, commentId: id }));
        const array = kind === "pr" ? entries : ids;
        const index = mutation === "last-grow" ? 999 : 0;
        const entry = array[index];
        Object.defineProperty(array, index, {
          get() {
            if (mutation === "throw")
              throw new Error("SYNTHETIC_PRIVATE_MARKER");
            if (mutation === "shrink") array.length = 999;
            else array.length = 1001;
            return entry;
          },
        });
        if (kind === "candidates") {
          const options = { ...f.options, candidates: ids };
          expect(
            validateDevSquadAdoWorkflowWatchPassOptions(options),
          ).toMatchObject({
            ok: false,
            error: { kind: "validation", field: "candidates" },
          });
          ids.length = 1000;
          expect(await runDevSquadAdoWorkflowWatchPass(options)).toMatchObject({
            ok: false,
          });
          expect(f.options.clock).not.toHaveBeenCalled();
          expect(f.requests).toEqual([]);
        } else {
          f.set({ pullRequest: { id: "42", url: null } });
          const result = await run({
            ...f.options,
            seam: {
              observeWorkItemComments: async () => ({
                commentIds: kind === "wi" ? ids : ["480", "481"],
              }),
              observePullRequestActivity: async () => ({ entries }),
            },
          });
          expect(result.outcomes[0]).toMatchObject({
            reason: "invalid-observation-window",
            revision: null,
            cursorChanges: [],
          });
          expect(result.signals).toEqual([]);
          expect(f.ledger.acquireClaim).not.toHaveBeenCalled();
          expect(f.ledger.checkpoint).not.toHaveBeenCalled();
          expect(f.read().revision).toBe(4);
        }
      }
    },
  );

  it.each(["wi", "pr", "candidates"] as const)(
    "[SC-01] ignores %s custom iterators and uses exactly the indexed entries",
    async (kind) => {
      const f = fixture();
      const ids = Array.from({ length: 1000 }, (_, i) => String(480 + i));
      const entries = ids.map((id) => ({ threadId: id, commentId: id }));
      const iterator = vi.fn(() => {
        throw new Error("SYNTHETIC_PRIVATE_MARKER");
      });
      Object.defineProperty(kind === "pr" ? entries : ids, Symbol.iterator, {
        get: iterator,
      });
      if (kind === "candidates") {
        const result = validateDevSquadAdoWorkflowWatchPassOptions({
          ...f.options,
          candidates: ids,
        });
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value.candidates).toHaveLength(1000);
      } else {
        f.set({ pullRequest: { id: "42", url: null } });
        const result = await run({
          ...f.options,
          seam: {
            observeWorkItemComments: async () => ({
              commentIds: kind === "wi" ? ids : ["480", "481"],
            }),
            observePullRequestActivity: async () => ({
              entries: kind === "pr" ? entries : [],
            }),
          },
        });
        expect(result.signals).toHaveLength(1);
        expect(result.outcomes[0]?.revision).toBe(6);
        expect(f.read().revision).toBe(7);
        expect(
          kind === "wi"
            ? f.read().observations.workItemCommentId
            : f.read().observations.pullRequest?.commentId,
        ).toBe("1479");
      }
      expect(iterator).not.toHaveBeenCalled();
    },
  );

  it.each(["aborted", "addEventListener", "removeEventListener"] as const)(
    "[SC-02] sanitizes required signal.%s getters at both public boundaries",
    async (field) => {
      for (const direct of [true, false]) {
        const f = fixture();
        const signal = new AbortController().signal;
        Object.defineProperty(signal, field, {
          get() {
            throw new Error("SYNTHETIC_PRIVATE_MARKER");
          },
        });
        const options = { ...f.options, signal };
        const result = direct
          ? validateDevSquadAdoWorkflowWatchPassOptions(options)
          : await runDevSquadAdoWorkflowWatchPass(options);
        expect(result).toEqual({
          ok: false,
          error: {
            kind: "validation",
            field: "signal",
            reason: "must be readable",
          },
        });
        expect(f.options.clock).not.toHaveBeenCalled();
        expect(f.options.delay).not.toHaveBeenCalled();
        expect(f.options.seam.observeWorkItemComments).not.toHaveBeenCalled();
        expect(f.requests).toEqual([]);
      }
    },
  );

  it.each(["wi", "pr", "candidates"] as const)(
    "[SC-01] does not consume %s iterator-only overflow entries",
    async (kind) => {
      const f = fixture();
      const ids = Array.from({ length: 1000 }, (_, i) => String(480 + i));
      const entries = ids.map((id) => ({ threadId: id, commentId: id }));
      const iterator = vi.fn(function* () {
        for (let index = 0; index < 1001; index++)
          yield kind === "pr"
            ? { threadId: "iterator-only", commentId: String(index) }
            : "iterator-only";
      });
      Object.defineProperty(kind === "pr" ? entries : ids, Symbol.iterator, {
        value: iterator,
      });
      if (kind === "candidates") {
        const result = validateDevSquadAdoWorkflowWatchPassOptions({
          ...f.options,
          candidates: ids,
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.candidates).toHaveLength(1000);
          expect(result.value.candidates).not.toContain("iterator-only");
        }
      } else {
        f.set({ pullRequest: { id: "42", url: null } });
        const result = await run({
          ...f.options,
          seam: {
            observeWorkItemComments: async () => ({
              commentIds: kind === "wi" ? ids : ["480", "481"],
            }),
            observePullRequestActivity: async () => ({
              entries: kind === "pr" ? entries : [],
            }),
          },
        });
        expect(result.signals).toHaveLength(1);
        expect(
          kind === "wi"
            ? f.read().observations.workItemCommentId
            : f.read().observations.pullRequest?.commentId,
        ).toBe("1479");
        expect(f.read().revision).toBe(7);
      }
      expect(iterator).not.toHaveBeenCalled();
    },
  );

  it.each(["threadId", "commentId"] as const)(
    "[SC-01] rejects growth from the final PR entry's %s getter",
    async (field) => {
      const f = fixture();
      f.set({ pullRequest: { id: "42", url: null } });
      const entries = [{ threadId: "t", commentId: "c" }];
      const value = entries[0]![field];
      Object.defineProperty(entries[0], field, {
        get() {
          entries.push({ threadId: "overflow", commentId: "overflow" });
          return value;
        },
      });
      const result = await run({
        ...f.options,
        seam: {
          ...f.options.seam,
          observePullRequestActivity: async () => ({ entries }),
        },
      });
      expect(result.outcomes[0]?.reason).toBe("invalid-observation-window");
      expect(result.signals).toEqual([]);
      expect(f.read().revision).toBe(4);
      expect(f.ledger.acquireClaim).not.toHaveBeenCalled();
    },
  );

  it.each(["addEventListener", "removeEventListener"] as const)(
    "[SC-02] snapshots %s once while preserving live abort",
    async (field) => {
      const f = fixture();
      const parent = new AbortController();
      const method = parent.signal[field].bind(parent.signal);
      const getter = vi.fn(() => {
        if (getter.mock.calls.length > 1)
          throw new Error("SYNTHETIC_PRIVATE_MARKER");
        return method;
      });
      Object.defineProperty(parent.signal, field, { get: getter });
      const result = await run({
        ...f.options,
        signal: parent.signal,
        ledger: {
          ...f.ledger,
          checkpoint: async (input) => {
            const response = await f.ledger.checkpoint(input);
            parent.abort();
            return response;
          },
        },
      });
      expect(getter).toHaveBeenCalledTimes(1);
      expect(result.stopReason).toBe("cancelled");
      expect(result.signals).toHaveLength(1);
      expect(result.outcomes[0]?.cleanup.status).toBe("released");
    },
  );

  it("[SC-02] treats a subsequently unreadable aborted getter as live cancellation with cleanup", async () => {
    const f = fixture();
    const signal = new AbortController().signal;
    let unreadable = false;
    Object.defineProperty(signal, "aborted", {
      get() {
        if (unreadable) throw new Error("SYNTHETIC_PRIVATE_MARKER");
        return false;
      },
    });
    const result = await run({
      ...f.options,
      signal,
      ledger: {
        ...f.ledger,
        checkpoint: async (input) => {
          const response = await f.ledger.checkpoint(input);
          unreadable = true;
          return response;
        },
      },
    });
    expect(result.stopReason).toBe("cancelled");
    expect(result.signals).toHaveLength(1);
    expect(result.outcomes[0]?.cleanup.status).toBe("released");
    expect(f.ledger.releaseClaim).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC_PRIVATE_MARKER");
  });

  it("[SC-02] supports immutable listener methods without mutating the signal", async () => {
    const f = fixture();
    const parent = new AbortController();
    for (const field of ["addEventListener", "removeEventListener"] as const)
      Object.defineProperty(parent.signal, field, {
        value: parent.signal[field],
        writable: false,
        configurable: false,
      });
    const result = await run({ ...f.options, signal: parent.signal });
    expect(result.signals).toHaveLength(1);
    expect(parent.signal.aborted).toBe(false);
    expect(
      Object.getOwnPropertyDescriptor(parent.signal, "addEventListener")
        ?.writable,
    ).toBe(false);
  });

  it.each(["signal", "clock", "budgets.maxPolls"] as const)(
    "[SC-02] sanitizes required configuration accessor %s",
    async (field) => {
      for (const direct of [true, false]) {
        const f = fixture();
        const target =
          field === "budgets.maxPolls" ? f.options.budgets : f.options;
        Object.defineProperty(
          target,
          field === "budgets.maxPolls" ? "maxPolls" : field,
          {
            get() {
              throw new Error("SYNTHETIC_PRIVATE_MARKER");
            },
          },
        );
        const result = direct
          ? validateDevSquadAdoWorkflowWatchPassOptions(f.options)
          : await runDevSquadAdoWorkflowWatchPass(f.options);
        expect(result).toEqual({
          ok: false,
          error: { kind: "validation", field, reason: "must be readable" },
        });
        expect(f.requests).toEqual([]);
        expect(f.options.delay).not.toHaveBeenCalled();
      }
    },
  );

  it.each(["phases", "statuses"] as const)(
    "[SC-02] sanitizes unreadable required intake %s entries",
    async (field) => {
      const f = fixture();
      Object.defineProperty(f.options.intakeRules[field], 0, {
        get() {
          throw new Error("SYNTHETIC_PRIVATE_MARKER");
        },
      });
      const expected = {
        ok: false,
        error: {
          kind: "validation",
          field: `intakeRules.${field}`,
          reason: "must be readable",
        },
      };
      expect(validateDevSquadAdoWorkflowWatchPassOptions(f.options)).toEqual(
        expected,
      );
      expect(await runDevSquadAdoWorkflowWatchPass(f.options)).toEqual(
        expected,
      );
      expect(f.options.clock).not.toHaveBeenCalled();
      expect(f.requests).toEqual([]);
    },
  );

  it.each(METHODS)(
    "[SL14-001] ignores unrelated getters throughout %s acknowledgements",
    async (method) => {
      const f = fixture();
      f.set({
        agent: {
          current: "agent",
          history: [{ id: "agent", revision: 4, activatedAt: NOW }],
        },
        session: {
          current: "session",
          history: [{ id: "session", revision: 4, activatedAt: NOW }],
        },
        observations: {
          workItemCommentId: "480",
          pullRequest: { threadId: "t", commentId: "c" },
        },
      });
      const getter = vi.fn(() => {
        throw new Error("SYNTHETIC_PRIVATE_MARKER");
      });
      const poison = (value: unknown): void => {
        if (typeof value !== "object" || value === null) return;
        for (const child of Object.values(value)) poison(child);
        Object.defineProperty(value, "unrelated", {
          enumerable: true,
          get: getter,
        });
      };
      const original = f.ledger[method];
      const result = await run({
        ...f.options,
        ...(method === "renewClaim"
          ? { clock: () => new Date(Date.parse(NOW) + 50_000) }
          : {}),
        ledger: {
          ...f.ledger,
          [method]: async (input: never) => {
            const response = structuredClone(await original(input));
            poison(response);
            return response;
          },
        },
      });
      expect(getter).not.toHaveBeenCalled();
      expect(result.outcomes[0]?.kind).toBe("acted");
      expect(result.signals).toHaveLength(1);
      expect(result.outcomes[0]?.cleanup.status).toBe("released");
      expect(f.read().observations.workItemCommentId).toBe("481");
      expect(f.read().revision).toBe(method === "renewClaim" ? 8 : 7);
    },
  );

  it("[SL14-001] projects known error fields without accessing unknown payload", async () => {
    const f = fixture();
    const getter = vi.fn(() => {
      throw new Error("SYNTHETIC_PRIVATE_MARKER");
    });
    const failure = {
      kind: "revision-conflict" as const,
      expectedRevision: 5,
      currentRevision: 6,
    };
    Object.defineProperty(failure, "unrelated", {
      enumerable: true,
      get: getter,
    });
    const result = await run(
      inject(f, "checkpoint", { ok: false, error: failure }),
    );
    expect(result.outcomes[0]?.reason).toBe("revision-conflict");
    expect(result.outcomes[0]?.cleanup.status).toBe("released");
    expect(getter).not.toHaveBeenCalled();
  });

  it("[SL14-001] isolates unreadable required record fields from later candidates", async () => {
    const f = fixture();
    const result = await run({
      ...f.options,
      candidates: [137, 138],
      ledger: {
        ...f.ledger,
        readRecord: async (id) => {
          const value = { ...baseRecord(), workItemId: String(id) };
          if (id === "137")
            Object.defineProperty(value, "phase", {
              get() {
                throw new Error("SYNTHETIC_PRIVATE_MARKER");
              },
            });
          return { ok: true, value };
        },
      },
      seam: { observeWorkItemComments: async () => ({ commentIds: [] }) },
    });
    expect(result.outcomes.map((o) => o.reason)).toEqual([
      "ledger-unavailable",
      "no-new-observations",
    ]);
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC_PRIVATE_MARKER");
    expect(f.ledger.acquireClaim).not.toHaveBeenCalled();
  });

  it("[SL14-001] retains a fresh nested record snapshot and reads required getters once", async () => {
    const f = fixture();
    const response = { ok: true as const, value: baseRecord() };
    const phase = vi.fn(() => {
      if (phase.mock.calls.length > 1)
        throw new Error("SYNTHETIC_PRIVATE_MARKER");
      return "implement";
    });
    Object.defineProperty(response.value, "phase", { get: phase });
    const guarded = guardDevSquadAdoWatcherLedger({
      ...f.ledger,
      readRecord: async () => response,
    });
    const result = await guarded.readRecord("137");
    expect(result.ok).toBe(true);
    Reflect.set(response.value.observations, "workItemCommentId", "changed");
    Reflect.set(response.value.agent, "current", "changed");
    expect(result).toMatchObject({
      ok: true,
      value: {
        phase: "implement",
        agent: { current: null },
        observations: { workItemCommentId: "480" },
      },
    });
    expect(phase).toHaveBeenCalledTimes(1);
    if (result.ok) {
      expect(result.value === response.value).toBe(false);
      expect(result.value.observations).not.toBe(response.value.observations);
      expect(result.value.agent.history).not.toBe(response.value.agent.history);
    }
  });

  it.each(["agent", "session", "checkpoints"] as const)(
    "[SL14-001] bounds %s projection by indexed length and rejects live mutation",
    async (field) => {
      for (const mode of [
        "grow",
        "shrink",
        "over-limit",
        "iterator",
      ] as const) {
        const f = fixture();
        const entries = Array.from(
          { length: mode === "over-limit" ? 10001 : 10000 },
          (_, i) =>
            field === "checkpoints"
              ? {
                  revision: i + 1,
                  operationId: `op${i}`,
                  acceptedAt: NOW,
                  previous: { phase: "implement", status: "ready" },
                  resulting: { phase: "implement", status: "ready" },
                }
              : { id: `id${i}`, revision: i + 1, activatedAt: NOW },
        );
        const value = {
          ...baseRecord(),
          revision: 10000,
          [field]:
            field === "checkpoints"
              ? entries
              : { current: "id9999", history: entries },
        };
        const iterator = vi.fn(() => {
          throw new Error("SYNTHETIC_PRIVATE_MARKER");
        });
        Object.defineProperty(entries, Symbol.iterator, { get: iterator });
        if (mode === "grow" || mode === "shrink") {
          const last = entries[9999];
          Object.defineProperty(entries, 9999, {
            get() {
              entries.length = mode === "grow" ? 10001 : 9999;
              return last;
            },
          });
        }
        const guarded = guardDevSquadAdoWatcherLedger({
          ...f.ledger,
          readRecord: async () => ({ ok: true, value }),
        });
        if (mode === "iterator")
          await expect(guarded.readRecord("137")).resolves.toMatchObject({
            ok: true,
          });
        else
          await expect(guarded.readRecord("137")).rejects.toThrow(
            "ledger-fault",
          );
        expect(iterator).not.toHaveBeenCalled();
      }
    },
  );
});

describe("fresh independent RC14 regressions", () => {
  it.each(["ownerId", "claimToken"] as const)(
    "[RC14-001] rejects acquire request mutation of %s without exposing authority",
    async (field) => {
      const f = fixture();
      let token = "";
      const result = await run({
        ...f.options,
        ledger: {
          ...f.ledger,
          acquireClaim: async (input) => {
            token = input.claimToken;
            Reflect.set(
              input,
              field,
              field === "ownerId" ? token : "wrong-token",
            );
            return f.ledger.acquireClaim(input);
          },
        },
      });
      expect(result.outcomes[0]).toMatchObject({
        reason: "ledger-unavailable",
        claim: null,
        revision: null,
        cursorChanges: [],
        cleanup: { status: "indeterminate", reason: "authority-unvalidated" },
      });
      expect(result.signals).toEqual([]);
      expect(JSON.stringify(result)).not.toContain(token);
      expect(f.ledger.checkpoint).not.toHaveBeenCalled();
      expect(f.ledger.releaseClaim).not.toHaveBeenCalled();
    },
  );

  it.each(["workItemCommentId", "pullRequest"] as const)(
    "[RC14-001] isolates nested checkpoint %s from pending state",
    async (kind) => {
      const f = fixture();
      f.set({ pullRequest: { id: "42", url: null } });
      const result = await run({
        ...f.options,
        seam: {
          ...f.options.seam,
          observePullRequestActivity: async () => ({
            entries: [{ threadId: "thread", commentId: "new" }],
          }),
        },
        ledger: {
          ...f.ledger,
          checkpoint: async (input) => {
            if (kind === "workItemCommentId")
              Reflect.set(
                input.patch.observations!,
                "workItemCommentId",
                "480",
              );
            else
              Reflect.set(
                input.patch.observations!.pullRequest!,
                "commentId",
                "old",
              );
            return f.ledger.checkpoint(input);
          },
        },
      });
      expect(result.outcomes[0]).toMatchObject({
        reason: "ledger-unavailable",
        revision: null,
        cursorChanges: [],
        cleanup: { status: "released" },
      });
      expect(result.signals).toEqual([]);
      expect(f.read().observations).toMatchObject(
        kind === "workItemCommentId"
          ? { workItemCommentId: "480" }
          : { pullRequest: { commentId: "old" } },
      );
      expect(f.ledger.releaseClaim).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["renewClaim", "releaseClaim"] as const)(
    "[RC14-001] isolates %s authority including token fields",
    async (method) => {
      const f = fixture();
      const original = f.ledger[method];
      const result = await run({
        ...f.options,
        clock: () => new Date(Date.parse(NOW) + 50_000),
        ledger: {
          ...f.ledger,
          [method]: async (
            input: Parameters<DevSquadAdoWorkflowLedger["renewClaim"]>[0],
          ) => {
            Reflect.set(input.authority, "claimToken", "substituted-token");
            return original(input);
          },
        },
      });
      expect(result.outcomes[0]).toMatchObject({
        reason: "ledger-unavailable",
        ledgerErrorKind: "ledger-fault",
      });
      expect(result.signals).toHaveLength(method === "releaseClaim" ? 1 : 0);
      expect(f.ledger.releaseClaim).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(result)).not.toContain("substituted-token");
    },
  );

  it.each([
    "acquireClaim",
    "renewClaim",
    "checkpoint",
    "releaseClaim",
  ] as const)(
    "[RC14-002] rejects contradictory %s replay at its accepted revision",
    async (method) => {
      const f = fixture();
      const original = f.ledger[method];
      const result = await run({
        ...f.options,
        ...(method === "renewClaim"
          ? { clock: () => new Date(Date.parse(NOW) + 50_000) }
          : {}),
        ledger: {
          ...f.ledger,
          [method]: async (input: never) => {
            const before = f.read();
            const response = await original(input);
            if (!response.ok) return response;
            const record = {
              ...response.value.record,
              ...(method === "checkpoint"
                ? { observations: before.observations }
                : {
                    activeClaim:
                      method === "releaseClaim" ? before.activeClaim : null,
                  }),
            };
            return {
              ok: true,
              value: { ...response.value, replayed: true, record },
            };
          },
        },
      });
      expect(result.outcomes[0]).toMatchObject({
        reason: "ledger-unavailable",
        ledgerErrorKind: "ledger-fault",
      });
      expect(result.signals).toHaveLength(method === "releaseClaim" ? 1 : 0);
      expect(result.outcomes[0]?.revision).toBe(
        method === "releaseClaim" ? 6 : null,
      );
    },
  );

  it("[RC14-002] rejects replay acceptance at the expected checkpoint revision", async () => {
    const f = fixture();
    const result = await run({
      ...f.options,
      ledger: {
        ...f.ledger,
        checkpoint: async (input) => {
          const response = await f.ledger.checkpoint(input);
          if (!response.ok) return response;
          const checkpoint = {
            ...response.value.outcome.checkpoint,
            revision: input.expected.revision,
          };
          return {
            ok: true,
            value: {
              ...response.value,
              replayed: true,
              acceptedRevision: checkpoint.revision,
              outcome: { kind: "checkpointed", checkpoint },
              record: { ...response.value.record, checkpoints: [checkpoint] },
            },
          };
        },
      },
    });
    expect(result.outcomes[0]?.reason).toBe("ledger-unavailable");
    expect(result.signals).toEqual([]);
  });

  it.each([
    "acquireClaim",
    "renewClaim",
    "checkpoint",
    "releaseClaim",
  ] as const)(
    "[RC14-002] accepts consistent %s replay at its latest revision",
    async (method) => {
      const f = fixture();
      const original = f.ledger[method];
      const result = await run({
        ...f.options,
        ...(method === "renewClaim"
          ? { clock: () => new Date(Date.parse(NOW) + 50_000) }
          : {}),
        ledger: {
          ...f.ledger,
          [method]: async (input: never) => {
            const response = await original(input);
            return response.ok
              ? { ...response, value: { ...response.value, replayed: true } }
              : response;
          },
        },
      });
      expect(result.signals).toHaveLength(1);
      expect(result.outcomes[0]?.kind).toBe("acted");
      expect(result.outcomes[0]?.cleanup.status).toBe("released");
    },
  );

  it("[RC14-002] accepts an older checkpoint after a valid later cursor advance", async () => {
    const f = fixture();
    const acquired = await f.ledger.acquireClaim({
      workItemId: "137",
      operationId: "claim",
      ownerId: "watch-a",
      claimToken: "private-token",
      leaseDurationMs: 60_000,
    });
    if (!acquired.ok) throw new Error("fixture");
    const input = {
      workItemId: "137",
      operationId: "original",
      authority: acquired.value.outcome.authority,
      expected: { revision: 5, phase: "implement", status: "ready" },
      patch: { observations: { workItemCommentId: "481" } },
    };
    const original = await f.ledger.checkpoint(input);
    if (!original.ok) throw new Error("fixture");
    await f.ledger.checkpoint({
      ...input,
      operationId: "later",
      expected: { ...input.expected, revision: 6 },
      patch: { observations: { workItemCommentId: "482" } },
    });
    const replay = {
      ...original,
      value: { ...original.value, replayed: true, record: f.read() },
    };
    const guarded = guardDevSquadAdoWatcherLedger({
      ...f.ledger,
      checkpoint: async () => replay,
    });
    await expect(guarded.checkpoint(input)).resolves.toEqual(replay);
    await expect(
      guarded.checkpoint({
        ...input,
        expected: { ...input.expected, revision: 6 },
      }),
    ).rejects.toThrow("ledger-fault");
  });

  it("[RC14-003] ignores unused adapter getters and preserves method receivers for two candidates", async () => {
    const f = fixture();
    const ledger = {
      ...f.ledger,
      readRecord: vi.fn(async function (this: unknown, id: string | number) {
        expect(this).toBe(ledger);
        return {
          ok: true as const,
          value: { ...baseRecord(), workItemId: String(id) },
        };
      }),
      get unrelated() {
        throw new Error("SYNTHETIC_PRIVATE_MARKER");
      },
    };
    const result = await run({
      ...f.options,
      ledger,
      candidates: [137, 138],
      seam: { observeWorkItemComments: async () => ({ commentIds: [] }) },
    });
    expect(result.outcomes.map((outcome) => outcome.reason)).toEqual([
      "no-new-observations",
      "no-new-observations",
    ]);
    expect(ledger.readRecord).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC_PRIVATE_MARKER");
  });

  it.each([
    "wi-envelope",
    "pr-envelope",
    "pr-thread",
    "pr-comment",
    "wi-proxy",
  ] as const)(
    "[RC14-003] quarantines %s accessor failure without losing the next candidate",
    async (mode) => {
      const f = fixture();
      const bad = () => {
        throw new Error("SYNTHETIC_OBSERVATION_MARKER");
      };
      const result = await run({
        ...f.options,
        candidates: [137, 138],
        ledger: {
          ...f.ledger,
          readRecord: async (id) => ({
            ok: true,
            value: {
              ...baseRecord(),
              workItemId: String(id),
              pullRequest: { id: "42", url: null },
            },
          }),
        },
        seam: {
          observeWorkItemComments: async ({ workItemId }) => {
            if (workItemId === "138") return { commentIds: [] };
            if (mode === "wi-envelope")
              return {
                get commentIds(): string[] {
                  return bad();
                },
              };
            if (mode === "wi-proxy")
              return new Proxy(
                { commentIds: [] },
                {
                  get: (target, key, receiver) =>
                    key === "commentIds"
                      ? bad()
                      : Reflect.get(target, key, receiver),
                },
              );
            return { commentIds: ["480", "481"] };
          },
          observePullRequestActivity: async ({ workItemId }) => {
            if (workItemId === "138") return { entries: [] };
            if (mode === "pr-envelope")
              return {
                get entries(): [] {
                  return bad();
                },
              };
            return {
              entries: [
                {
                  get threadId(): string {
                    return mode === "pr-thread" ? bad() : "thread";
                  },
                  get commentId(): string {
                    return bad();
                  },
                },
              ],
            };
          },
        },
      });
      expect(result.outcomes.map((outcome) => outcome.reason)).toEqual([
        "invalid-observation-window",
        "no-new-observations",
      ]);
      expect(f.ledger.acquireClaim).not.toHaveBeenCalled();
      expect(result.signals).toEqual([]);
      expect(JSON.stringify(result)).not.toContain(
        "SYNTHETIC_OBSERVATION_MARKER",
      );
    },
  );

  it.each(["wi", "pr"] as const)(
    "[RC14-005] rejects malformed %s collections as windows rather than identifiers",
    async (kind) => {
      const f = fixture();
      f.set({ pullRequest: { id: "42", url: null } });
      const result = await run({
        ...f.options,
        seam: {
          observeWorkItemComments: async () => ({
            commentIds: kind === "wi" ? null! : ["480", "481"],
          }),
          observePullRequestActivity: async () => ({ entries: null! }),
        },
      });
      expect(result.outcomes[0]).toMatchObject({
        reason: "invalid-observation-window",
        cursorChanges: [],
        revision: null,
      });
      expect(result.signals).toEqual([]);
      expect(f.ledger.acquireClaim).not.toHaveBeenCalled();
      expect(f.read().revision).toBe(4);
    },
  );

  it.each(["ledger", "seam"] as const)(
    "[RC14-003] sanitizes required %s method accessors before side effects",
    async (dependency) => {
      const f = fixture();
      const method =
        dependency === "ledger" ? "readRecord" : "observeWorkItemComments";
      Object.defineProperty(f.options[dependency], method, {
        get() {
          throw new Error("SYNTHETIC_PRIVATE_MARKER");
        },
      });
      const result = await runDevSquadAdoWorkflowWatchPass(f.options);
      expect(result).toEqual({
        ok: false,
        error: {
          kind: "validation",
          field: `${dependency}.${method}`,
          reason: "must be readable",
        },
      });
      expect(f.options.clock).not.toHaveBeenCalled();
      expect(f.options.delay).not.toHaveBeenCalled();
      expect(f.requests).toEqual([]);
    },
  );

  it("[RC14-003] never reads unrelated observation payload getters", async () => {
    const f = fixture();
    f.set({ pullRequest: { id: "42", url: null } });
    const result = await run({
      ...f.options,
      seam: {
        observeWorkItemComments: async () => ({
          commentIds: ["480", "481"],
          get body() {
            throw new Error("SYNTHETIC_PRIVATE_MARKER");
          },
        }),
        observePullRequestActivity: async () => ({
          entries: [
            {
              threadId: "t",
              commentId: "c",
              get body() {
                throw new Error("SYNTHETIC_PRIVATE_MARKER");
              },
            },
          ],
          get body() {
            throw new Error("SYNTHETIC_PRIVATE_MARKER");
          },
        }),
      },
    });
    expect(result.outcomes[0]?.kind).toBe("acted");
    expect(result.signals).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC_PRIVATE_MARKER");
  });

  it.each(["success", "rejected", "throw"] as const)(
    "[RC14-004] cancellation during budget-finalizer cleanup with %s response",
    async (cleanup) => {
      const f = fixture();
      const parent = new AbortController();
      const release = vi.fn(
        async (
          input: Parameters<DevSquadAdoWorkflowLedger["releaseClaim"]>[0],
        ) => {
          parent.abort();
          if (cleanup === "throw") throw new Error("private-cleanup");
          if (cleanup === "rejected")
            return {
              ok: false as const,
              error: { kind: "claim-authorization" as const },
            };
          return f.ledger.releaseClaim(input);
        },
      );
      const result = await run({
        ...f.options,
        signal: parent.signal,
        ledger: {
          ...f.ledger,
          checkpoint: async () => ({
            ok: false,
            error: { kind: "storage", outcome: "indeterminate" },
          }),
          releaseClaim: release,
        },
      });
      expect(result.stopReason).toBe("cancelled");
      expect(result.outcomes[0]).toMatchObject({
        reason: "checkpoint-indeterminate",
        revision: null,
        cursorChanges: [],
        cleanup: {
          status:
            cleanup === "success"
              ? "released"
              : cleanup === "rejected"
                ? "failed"
                : "indeterminate",
        },
      });
      expect(result.signals).toEqual([]);
      expect(release).toHaveBeenCalledTimes(1);
    },
  );

  for (const abortAt of ["checkpoint", "release"] as const) {
    it.each(["success", "rejected", "throw"] as const)(
      `[RC14-004] final candidate abort in ${abortAt} retains acknowledged effects with %s cleanup`,
      async (cleanup) => {
        const f = fixture();
        const parent = new AbortController();
        const release = vi.fn(
          async (
            input: Parameters<DevSquadAdoWorkflowLedger["releaseClaim"]>[0],
          ) => {
            if (abortAt === "release") parent.abort();
            if (cleanup === "throw") throw new Error("private-cleanup");
            if (cleanup === "rejected")
              return {
                ok: false as const,
                error: { kind: "claim-authorization" as const },
              };
            return f.ledger.releaseClaim(input);
          },
        );
        const result = await run({
          ...f.options,
          signal: parent.signal,
          ledger: {
            ...f.ledger,
            checkpoint: async (input) => {
              const response = await f.ledger.checkpoint(input);
              if (abortAt === "checkpoint") parent.abort();
              return response;
            },
            releaseClaim: release,
          },
        });
        expect(result.stopReason).toBe("cancelled");
        expect(result.outcomes[0]).toMatchObject({
          revision: 6,
          cursorChanges: ["work-item-comment"],
          cleanup: {
            status:
              cleanup === "success"
                ? "released"
                : cleanup === "rejected"
                  ? "failed"
                  : "indeterminate",
            acceptedRevision: cleanup === "success" ? 7 : null,
          },
        });
        expect(result.signals).toHaveLength(1);
        expect(result.counts).toMatchObject({
          acted: 1,
          failed: cleanup === "success" ? 0 : 1,
        });
        expect(f.read().observations.workItemCommentId).toBe("481");
        expect(release).toHaveBeenCalledTimes(1);
      },
    );
  }
});

describe("DevSquadAdoWorkflowWatcher runtime response contract [TEST-026]", () => {
  it("snapshots dependency-owned error fields before validation and projection", async () => {
    const f = fixture();
    let reads = 0;
    const result = await run(
      inject(f, "readRecord", {
        ok: false,
        error: {
          get kind() {
            return ++reads === 1 ? "storage" : "secret-category";
          },
          outcome: "unchanged",
        },
      }),
    );
    expect(reads).toBe(1);
    expect(result.outcomes[0]?.ledgerErrorKind).toBe("storage");
    expect(JSON.stringify(result)).not.toContain("secret-category");
  });
  it("quarantines a throwing payload accessor without an untyped escape", async () => {
    const f = fixture();
    const result = await run(
      inject(f, "readRecord", {
        ok: true,
        get value() {
          throw new Error("private-message");
        },
      }),
    );
    expect(result.outcomes[0]?.ledgerErrorKind).toBe("ledger-fault");
    expect(JSON.stringify(result)).not.toContain("private-message");
  });
  for (const method of METHODS) {
    it.each([
      null,
      {},
      { ok: true, value: {} },
      { ok: true },
      { ok: "yes", error: { kind: "record-not-found" } },
      { ok: false, error: { kind: "secret-transport-body" } },
      { ok: false, error: { kind: "storage" } },
      { ok: false, error: { kind: "claim-conflict", claim: {} } },
    ])(`${method} quarantines malformed result %#`, async (response) => {
      const f = fixture();
      const result = await run(inject(f, method, response));
      const candidate = result.outcomes[0]!;
      expect(candidate).toMatchObject({
        kind: "failed",
        reason: "ledger-unavailable",
        ledgerErrorKind: "ledger-fault",
      });
      expect(candidate.cleanup.status).toBe(
        method === "acquireClaim" || method === "releaseClaim"
          ? "indeterminate"
          : method === "readRecord"
            ? "not-required"
            : "released",
      );
      expect(f.ledger.releaseClaim).toHaveBeenCalledTimes(
        method === "renewClaim" || method === "checkpoint" ? 1 : 0,
      );
      expect(result.signals).toHaveLength(method === "releaseClaim" ? 1 : 0);
      expect(JSON.stringify(result)).not.toContain("secret-transport-body");
    });
    it(`${method} rejects a wrong record identity after complete success`, async () => {
      const f = fixture();
      const original = f.ledger[method];
      const options = inject(f, method, null);
      const ledger = {
        ...options.ledger,
        [method]: async (input: never) => {
          const result = await original(input);
          if (!result.ok) return result;
          const copy = structuredClone(result);
          const value = copy.value as unknown as Record<string, any>;
          (method === "readRecord" ? value : value.record).workItemId = "999";
          return copy;
        },
      };
      const result = await run({ ...options, ledger });
      expect(result.outcomes[0]).toMatchObject({
        reason: "ledger-unavailable",
      });
      expect(result.signals).toHaveLength(method === "releaseClaim" ? 1 : 0);
    });
  }
  it.each([
    "acquireClaim",
    "renewClaim",
    "checkpoint",
    "releaseClaim",
  ] as const)(
    "%s never fabricates acknowledgement after a durable mutation",
    async (method) => {
      const f = fixture();
      const result = await run(
        inject(f, method, { ok: true, value: {} }, true),
      );
      expect(result.outcomes[0]).toMatchObject({
        kind: "failed",
        reason: "ledger-unavailable",
      });
      expect(result.signals).toHaveLength(method === "releaseClaim" ? 1 : 0);
      expect(result.outcomes[0]?.revision).toBe(
        method === "releaseClaim" ? 6 : null,
      );
      if (method === "checkpoint" || method === "releaseClaim")
        expect(f.read().observations.workItemCommentId).toBe("481");
      if (method === "acquireClaim") {
        expect(f.ledger.releaseClaim).not.toHaveBeenCalled();
        expect(f.read().activeClaim).not.toBeNull();
      }
    },
  );

  const known: DevSquadAdoLedgerError[] = [
    { kind: "validation", field: "input", reason: "invalid" },
    { kind: "repository-not-found" },
    { kind: "repository-not-directory" },
    { kind: "path-boundary", artifact: "record" },
    { kind: "unsupported-filesystem" },
    { kind: "unsupported-permissions", artifact: "record" },
    { kind: "record-not-found" },
    { kind: "record-already-exists" },
    { kind: "claim-not-held" },
    { kind: "claim-authorization" },
    { kind: "idempotency-conflict" },
    { kind: "claim-expired", expiredAt: NOW },
    { kind: "stale-fencing", currentFencingValue: 3 },
    { kind: "revision-conflict", expectedRevision: 5, currentRevision: 6 },
    { kind: "state-conflict", current: { phase: "review", status: "ready" } },
    { kind: "corrupt-artifact", artifact: "record" },
    {
      kind: "unsupported-schema-version",
      artifact: "record",
      schemaVersion: 2,
    },
    { kind: "capacity-exceeded", resource: "records", limit: 10_000 },
    { kind: "scan-limit", limit: 100 },
    { kind: "contention", attempts: 32 },
    { kind: "storage", outcome: "unchanged" },
    {
      kind: "claim-conflict",
      claim: {
        workItemId: "137",
        ownerId: "other",
        fencingValue: 3,
        acquiredAt: NOW,
        heartbeatAt: NOW,
        expiresAt: "2026-01-01T00:01:00.000Z",
      },
    },
  ];
  for (const method of METHODS) {
    it(`${method} validates every known error and all required fields`, async () => {
      for (const error of known) {
        const f = fixture();
        const result = await run(inject(f, method, { ok: false, error }));
        expect(result.outcomes[0]?.ledgerErrorKind).not.toBe("ledger-fault");
        for (const key of Object.keys(error).filter((key) => key !== "kind")) {
          const malformed: Record<string, unknown> = {
            ...error,
            [key]: undefined,
          };
          if (
            key === "artifact" &&
            ["path-boundary", "unsupported-permissions"].includes(error.kind)
          )
            malformed[key] = 123;
          const broken = await run(
            inject(fixture(), method, { ok: false, error: malformed }),
          );
          expect(
            broken.outcomes[0]?.ledgerErrorKind,
            `${method}/${error.kind}/${key}`,
          ).toBe("ledger-fault");
        }
      }
    });
  }
  describe("DevSquadAdoWorkflowWatcher bounded windows [TEST-028]", () => {
    it.each([1000, 1001])(
      "enforces the PR entry bound at %i before iteration",
      async (length) => {
        const f = fixture();
        f.set({ pullRequest: { id: "pr", url: null } });
        const entries = Array.from({ length }, (_, i) => ({
          threadId: String(i),
          commentId: null,
        }));
        let reads = 0;
        if (length === 1001)
          Object.defineProperty(entries, "0", {
            get() {
              reads++;
              throw new Error("oversized array must not be read");
            },
          });
        const result = await run({
          ...f.options,
          seam: {
            ...f.options.seam,
            observePullRequestActivity: async () => ({ entries }),
          },
        });
        expect(reads).toBe(0);
        expect(result.outcomes[0]?.reason).toBe(
          length === 1001
            ? "invalid-observation-window"
            : "new-work-item-comment",
        );
        expect(f.ledger.acquireClaim).toHaveBeenCalledTimes(
          length === 1001 ? 0 : 1,
        );
      },
    );
    it("rejects duplicate PR anchors rather than selecting a first occurrence", async () => {
      const f = fixture();
      const anchor = { threadId: "t", commentId: "c" };
      f.set({
        pullRequest: { id: "pr", url: null },
        observations: { workItemCommentId: "480", pullRequest: anchor },
      });
      const result = await run({
        ...f.options,
        seam: {
          ...f.options.seam,
          observePullRequestActivity: async () => ({
            entries: [anchor, { threadId: "next", commentId: "new" }, anchor],
          }),
        },
      });
      expect(result.outcomes[0]?.reason).toBe("invalid-observation-window");
      expect(f.ledger.acquireClaim).not.toHaveBeenCalled();
    });
    it.each([
      ["duplicate anchor", ["480", "480", "481"], "invalid-observation-window"],
      [
        "duplicate nonanchor",
        ["480", "481", "481"],
        "invalid-observation-window",
      ],
      ["missing anchor", ["481"], "observation-anchor-missing"],
      ["blank", ["480", ""], "invalid-observation-identifier"],
      [
        "oversized ID",
        ["480", "x".repeat(1025)],
        "invalid-observation-identifier",
      ],
      [
        "multibyte oversized",
        ["480", "\u00e9".repeat(513)],
        "invalid-observation-identifier",
      ],
      [
        "1001 entries",
        Array.from({ length: 1001 }, (_, i) => String(i)),
        "invalid-observation-window",
      ],
    ])("rejects WI %s atomically", async (_name, ids, reason) => {
      const f = fixture();
      const result = await run({
        ...f.options,
        seam: {
          observeWorkItemComments: async () => ({
            commentIds: ids as string[],
          }),
        },
      });
      expect(result.outcomes[0]?.reason).toBe(reason);
      expect(f.ledger.acquireClaim).not.toHaveBeenCalled();
      expect(result.signals).toEqual([]);
    });
    it("checks array length before reading even its first element", async () => {
      const f = fixture();
      let read = 0;
      const ids = new Array<string>(1001);
      Object.defineProperty(ids, "0", {
        get() {
          read++;
          throw new Error("must not iterate");
        },
      });
      const result = await run({
        ...f.options,
        seam: { observeWorkItemComments: async () => ({ commentIds: ids }) },
      });
      expect(result.outcomes[0]?.reason).toBe("invalid-observation-window");
      expect(read).toBe(0);
    });
    it("accepts 1000 maximum-byte WI identifiers in exact opaque order", async () => {
      const f = fixture();
      f.set({ observations: { workItemCommentId: null, pullRequest: null } });
      const ids = Array.from(
        { length: 1000 },
        (_, i) => `${String(1000 - i).padStart(4, "0")}${"\u00e9".repeat(510)}`,
      );
      expect(ids.every((id) => Buffer.byteLength(id) === 1024)).toBe(true);
      const result = await run({
        ...f.options,
        seam: { observeWorkItemComments: async () => ({ commentIds: ids }) },
      });
      expect(result.outcomes[0]?.kind).toBe("acted");
      expect(f.read().observations.workItemCommentId).toBe(ids.at(-1));
    });
    it.each([
      [
        { threadId: "t", commentId: "c" },
        { threadId: "t", commentId: "c" },
      ],
      [{ threadId: "t" }, { threadId: "t", commentId: null }],
      [
        { threadId: "t", commentId: null },
        { threadId: "t", commentId: undefined },
      ],
    ])(
      "rejects duplicate PR tuple %# and invalidates valid WI changes",
      async (...entries) => {
        const f = fixture();
        f.set({ pullRequest: { id: "pr", url: null } });
        const result = await run({
          ...f.options,
          seam: {
            ...f.options.seam,
            observePullRequestActivity: async () => ({ entries }),
          },
        });
        expect(result.outcomes[0]?.reason).toBe("invalid-observation-window");
        expect(f.ledger.acquireClaim).not.toHaveBeenCalled();
      },
    );
    it.each(["", " ", "\t"])(
      "rejects blank PR comments, not normalizing %j to null",
      async (commentId) => {
        const f = fixture();
        f.set({ pullRequest: { id: "pr", url: null } });
        const result = await run({
          ...f.options,
          seam: {
            ...f.options.seam,
            observePullRequestActivity: async () => ({
              entries: [{ threadId: "t", commentId }],
            }),
          },
        });
        expect(result.outcomes[0]?.reason).toBe(
          "invalid-observation-identifier",
        );
        expect(f.ledger.acquireClaim).not.toHaveBeenCalled();
      },
    );
    it.each([0, 1])(
      "enforces aggregate UTF8 PR ceiling at 1048576 + %i",
      async (extra) => {
        const f = fixture();
        f.set({ pullRequest: { id: "pr", url: null } });
        const entries: DevSquadAdoWatcherPullRequestObservationEntry[] =
          Array.from({ length: 512 }, (_, i) => ({
            threadId: `${String(i).padStart(4, "0")}${"\u00e9".repeat(510)}`,
            commentId: "\u00e9".repeat(512),
          }));
        if (extra) entries.push({ threadId: "x" });
        expect(
          entries.reduce(
            (sum, e) =>
              sum +
              Buffer.byteLength(e.threadId) +
              (e.commentId == null ? 0 : Buffer.byteLength(e.commentId)),
            0,
          ),
        ).toBe(1048576 + extra);
        const result = await run({
          ...f.options,
          seam: {
            ...f.options.seam,
            observePullRequestActivity: async () => ({ entries }),
          },
        });
        expect(result.outcomes[0]?.reason).toBe(
          extra ? "invalid-observation-window" : "new-observations",
        );
        expect(f.ledger.acquireClaim).toHaveBeenCalledTimes(extra ? 0 : 1);
      },
    );
    it("preserves newest complete pair through trailing incomplete entries", async () => {
      const f = fixture();
      f.set({
        pullRequest: { id: "pr", url: null },
        observations: {
          workItemCommentId: "480",
          pullRequest: { threadId: "99", commentId: "z" },
        },
      });
      const result = await run({
        ...f.options,
        seam: {
          ...f.options.seam,
          observePullRequestActivity: async () => ({
            entries: [
              { threadId: "99", commentId: "z" },
              { threadId: "10", commentId: "x" },
              { threadId: "2" },
              { threadId: "1", commentId: "a" },
              { threadId: "0", commentId: null },
            ],
          }),
        },
      });
      expect(result.outcomes[0]).toMatchObject({
        kind: "acted",
        cursorChanges: ["work-item-comment", "pull-request-thread"],
        skippedCursorKinds: [],
      });
      expect(f.read().observations.pullRequest).toEqual({
        threadId: "1",
        commentId: "a",
      });
    });
  });

  describe("DevSquadAdoWorkflowWatcher observation cancellation [TEST-029]", () => {
    it.each(["success", "rejection", "throw", "timeout", "abort"] as const)(
      "retires child, timer and parent listeners on %s",
      async (mode) => {
        const f = fixture();
        const parent = new AbortController();
        const added = vi.spyOn(parent.signal, "addEventListener");
        const removed = vi.spyOn(parent.signal, "removeEventListener");
        let child: AbortSignal | undefined;
        let timer: AbortSignal | undefined;
        const result = await run({
          ...f.options,
          signal: parent.signal,
          seam: {
            observeWorkItemComments: ({ signal }) => {
              child = signal;
              expect(child).not.toBe(parent.signal);
              if (mode === "throw") throw new Error("private failure");
              if (mode === "rejection")
                return Promise.reject(new Error("private failure"));
              if (mode === "abort") parent.abort();
              if (mode === "success")
                return Promise.resolve({ commentIds: ["480", "481"] });
              return new Promise((_resolve, reject) =>
                signal?.addEventListener(
                  "abort",
                  () => reject(new Error("cancelled")),
                  { once: true },
                ),
              );
            },
          },
          delay: (_ms, signal) => {
            timer = signal;
            if (mode === "timeout") return Promise.resolve();
            return new Promise<void>((resolve) => {
              if (signal?.aborted) resolve();
              else
                signal?.addEventListener("abort", () => resolve(), {
                  once: true,
                });
            });
          },
        });
        expect(child?.aborted).toBe(true);
        if (timer) expect(timer.aborted).toBe(true);
        expect(added).toHaveBeenCalledTimes(1);
        expect(removed).toHaveBeenCalledTimes(1);
        expect(added.mock.calls[0]?.[1]).toBe(removed.mock.calls[0]?.[1]);
        expect(result.signals).toHaveLength(mode === "success" ? 1 : 0);
      },
    );
    it("bounds maximum cooperative seam and timer concurrency across candidates", async () => {
      const f = fixture();
      let active = 0,
        maxActive = 0,
        timers = 0,
        maxTimers = 0;
      const ledger = {
        ...f.ledger,
        readRecord: async (id: string | number) => ({
          ok: true as const,
          value: { ...baseRecord(), workItemId: String(id) },
        }),
      };
      const result = await run({
        ...f.options,
        ledger,
        candidates: [137, 138, 139],
        seam: {
          observeWorkItemComments: ({ signal }) =>
            new Promise((_resolve, reject) => {
              maxActive = Math.max(maxActive, ++active);
              signal!.addEventListener(
                "abort",
                () => {
                  active--;
                  reject(new Error("cancelled"));
                },
                { once: true },
              );
            }),
        },
        delay: async (_ms, signal) => {
          maxTimers = Math.max(maxTimers, ++timers);
          signal!.addEventListener(
            "abort",
            () => {
              timers--;
            },
            { once: true },
          );
        },
      });
      expect(result.outcomes.map((c) => c.reason)).toEqual(
        Array(3).fill("observation-timeout"),
      );
      expect({ active, maxActive, timers, maxTimers }).toEqual({
        active: 0,
        maxActive: 1,
        timers: 0,
        maxTimers: 1,
      });
    });
    it("does not revive a timed-out result settling in the race's continuation microtask", async () => {
      const f = fixture();
      let resolve!: (value: { commentIds: string[] }) => void;
      const result = await run({
        ...f.options,
        seam: {
          observeWorkItemComments: () =>
            new Promise((yes) => {
              resolve = yes;
            }),
        },
        delay: () => {
          queueMicrotask(() => resolve({ commentIds: ["480", "481"] }));
          return Promise.resolve();
        },
      });
      expect(result.outcomes[0]?.reason).toBe("observation-timeout");
      expect(result.signals).toEqual([]);
      expect(f.ledger.acquireClaim).not.toHaveBeenCalled();
    });
    it.each(["fulfill", "reject"] as const)(
      "quarantines late noncooperative %s without claiming physical termination",
      async (settlement) => {
        const f = fixture();
        let resolve!: (value: { commentIds: string[] }) => void;
        let reject!: (error: Error) => void;
        let active = true;
        const work = new Promise<{ commentIds: string[] }>((yes, no) => {
          resolve = yes;
          reject = no;
        });
        const result = await run({
          ...f.options,
          delay: async () => {},
          seam: { observeWorkItemComments: () => work },
        });
        expect(result.outcomes[0]?.reason).toBe("observation-timeout");
        expect(active).toBe(true);
        const snapshot = JSON.stringify(result);
        if (settlement === "fulfill") resolve({ commentIds: ["480", "481"] });
        else reject(new Error("late-private-message"));
        await work.then(
          () => {
            active = false;
          },
          () => {
            active = false;
          },
        );
        await Promise.resolve();
        expect(active).toBe(false);
        expect(JSON.stringify(result)).toBe(snapshot);
        expect(f.ledger.acquireClaim).not.toHaveBeenCalled();
      },
    );
  });
});

describe("DevSquadAdoWorkflowWatcher full metadata and replay [TEST-026][TEST-031]", () => {
  it("rejects an error whose expected revision does not match the checkpoint request", async () => {
    const f = fixture();
    const result = await run(
      inject(f, "checkpoint", {
        ok: false,
        error: {
          kind: "revision-conflict",
          expectedRevision: 99,
          currentRevision: 100,
        },
      }),
    );
    expect(result.outcomes[0]).toMatchObject({
      reason: "ledger-unavailable",
      ledgerErrorKind: "ledger-fault",
    });
  });
  it.each(METHODS)(
    "%s rejects incomplete records and mismatched success metadata",
    async (method) => {
      const paths = [
        "schemaVersion",
        "workItemId",
        "revision",
        "createdAt",
        "updatedAt",
        "phase",
        "status",
        "branch",
        "worktreePath",
        "agent",
        "agent.current",
        "agent.history",
        "session",
        "pullRequest",
        "pullRequest.id",
        "pullRequest.url",
        "observations",
        "observations.workItemCommentId",
        "observations.pullRequest",
        "checkpoints",
        "activeClaim",
        "fencingCounter",
      ].map((field) => (method === "readRecord" ? field : `record.${field}`));
      if (method !== "readRecord")
        paths.push(
          "acceptedAt",
          "acceptedRevision",
          "replayed",
          "outcome.kind",
        );
      const prefix =
        method === "acquireClaim"
          ? "outcome.authority"
          : method === "renewClaim"
            ? "outcome.claim"
            : method === "checkpoint"
              ? "outcome.checkpoint"
              : method === "releaseClaim"
                ? "outcome.releasedClaim"
                : null;
      if (prefix) paths.push(prefix);
      if (method === "acquireClaim" || method === "renewClaim")
        paths.push(
          ...[
            "workItemId",
            "ownerId",
            "fencingValue",
            "acquiredAt",
            "heartbeatAt",
            "expiresAt",
          ].map((field) => `${prefix}.${field}`),
        );
      if (method === "acquireClaim") paths.push(`${prefix}.claimToken`);
      if (method === "releaseClaim")
        paths.push(
          ...["ownerId", "fencingValue", "releasedAt"].map(
            (field) => `${prefix}.${field}`,
          ),
        );
      if (method === "checkpoint")
        paths.push(
          ...[
            "operationId",
            "revision",
            "acceptedAt",
            "previous",
            "resulting",
          ].map((field) => `${prefix}.${field}`),
        );
      for (const path of paths) {
        const f = fixture();
        const original = f.ledger[method];
        const options = inject(f, method, null);
        const result = await run({
          ...options,
          ledger: {
            ...options.ledger,
            [method]: async (input: never) => {
              const response = await original(input);
              if (!response.ok) return response;
              const copy = structuredClone(response);
              const parts = path.split(".");
              let object = copy.value as unknown as Record<string, any>;
              for (const part of parts.slice(0, -1)) object = object[part];
              delete object[parts.at(-1)!];
              return copy;
            },
          },
        });
        expect(result.outcomes[0]?.reason, `${method}/${path}`).toBe(
          "ledger-unavailable",
        );
        expect(result.outcomes[0]?.ledgerErrorKind).toBe("ledger-fault");
      }
    },
  );
  it.each([
    ["acquireClaim", "outcome.authority.ownerId", "other"],
    ["acquireClaim", "outcome.authority.claimToken", "wrong"],
    ["acquireClaim", "outcome.authority.fencingValue", 200],
    ["renewClaim", "outcome.claim.fencingValue", 200],
    ["renewClaim", "outcome.claim.expiresAt", "2026-01-01T00:02:00.000Z"],
    ["checkpoint", "outcome.checkpoint.operationId", "different-operation"],
    ["checkpoint", "record.observations.workItemCommentId", "different-cursor"],
    ["releaseClaim", "outcome.releasedClaim.ownerId", "other"],
    ["releaseClaim", "outcome.releasedClaim.fencingValue", 1],
    [
      "releaseClaim",
      "outcome.releasedClaim.releasedAt",
      "2026-01-01T00:00:01.000Z",
    ],
    ["readRecord", "worktreePath", "relative-path"],
    ["readRecord", "agent", { current: "x", history: [] }],
    ["readRecord", "pullRequest.url", "https://user:secret@example.com/"],
  ] as const)("rejects %s inconsistent %s", async (method, path, value) => {
    const f = fixture();
    const options = inject(f, method, null);
    const original = f.ledger[method];
    const result = await run({
      ...options,
      ledger: {
        ...options.ledger,
        [method]: async (input: never) => {
          const response = await original(input);
          if (!response.ok) return response;
          const copy = structuredClone(response);
          const parts = path.split(".");
          let object = copy.value as unknown as Record<string, any>;
          for (const part of parts.slice(0, -1)) object = object[part];
          object[parts.at(-1)!] = value;
          return copy;
        },
      },
    });
    expect(result.outcomes[0]?.reason).toBe("ledger-unavailable");
  });
  it("accepts semantically identical checkpoint metadata in any property order", async () => {
    const f = fixture();
    const result = await run({
      ...f.options,
      ledger: {
        ...f.ledger,
        checkpoint: async (input) => {
          const response = await f.ledger.checkpoint(input);
          if (!response.ok) return response;
          return {
            ...response,
            value: {
              ...response.value,
              outcome: {
                kind: "checkpointed",
                checkpoint: {
                  resulting: response.value.outcome.checkpoint.resulting,
                  previous: response.value.outcome.checkpoint.previous,
                  acceptedAt: response.value.acceptedAt,
                  operationId: input.operationId,
                  revision: response.value.acceptedRevision,
                },
              },
            },
          };
        },
      },
    });
    expect(result.outcomes[0]?.kind).toBe("acted");
  });
  it.each([
    "acquireClaim",
    "renewClaim",
    "checkpoint",
    "releaseClaim",
  ] as const)(
    "%s accepts original acknowledgement below latest revision after takeover",
    async (method) => {
      const f = fixture();
      const input = {
        workItemId: "137",
        operationId: "acquire",
        ownerId: "watch-a",
        claimToken: Buffer.alloc(32, 1).toString("base64url"),
        leaseDurationMs: 60000,
      };
      const acquired = await f.ledger.acquireClaim(input);
      if (!acquired.ok) throw new Error("fixture");
      const authority = acquired.value.outcome.authority;
      const claimedInput = { ...input, authority };
      const checkpointInput = {
        ...claimedInput,
        expected: { revision: 5, phase: "implement", status: "ready" },
        patch: { observations: { workItemCommentId: "481" } },
      };
      const request =
        method === "checkpoint"
          ? checkpointInput
          : method === "acquireClaim"
            ? input
            : claimedInput;
      const original =
        method === "acquireClaim"
          ? acquired
          : await f.ledger[method](request as never);
      if (!original.ok) throw new Error("fixture");
      const { claimToken: _token, ...metadata } = authority;
      const latest = {
        ...f.read(),
        revision: 20,
        fencingCounter: 9,
        activeClaim: { ...metadata, ownerId: "other", fencingValue: 9 },
      };
      const replay = {
        ...original,
        value: { ...original.value, replayed: true, record: latest },
      };
      const guarded = guardDevSquadAdoWatcherLedger({
        ...f.ledger,
        [method]: async () => replay,
      });
      await expect(guarded[method](request as never)).resolves.toEqual(replay);
    },
  );
  it("release replay preserves original cleanup revision and a later owner's claim", async () => {
    const f = fixture();
    const result = await run({
      ...f.options,
      ledger: {
        ...f.ledger,
        releaseClaim: async (input) => {
          const released = await f.ledger.releaseClaim(input);
          if (!released.ok) return released;
          f.set({
            revision: 8,
            fencingCounter: 3,
            activeClaim: {
              workItemId: "137",
              ownerId: "other",
              fencingValue: 3,
              acquiredAt: NOW,
              heartbeatAt: NOW,
              expiresAt: "2026-01-01T00:01:00.000Z",
            },
          });
          return {
            ...released,
            value: { ...released.value, replayed: true, record: f.read() },
          };
        },
      },
    });
    expect(result.outcomes[0]).toMatchObject({
      revision: 6,
      cleanup: { status: "released", acceptedRevision: 7 },
    });
    expect(f.read().activeClaim?.ownerId).toBe("other");
    expect(f.ledger.releaseClaim).toHaveBeenCalledTimes(1);
  });
  it.each(["identity", "cursor"] as const)(
    "abandons PR %s changed during acquire",
    async (change) => {
      const f = fixture();
      f.set({ pullRequest: { id: "pr", url: null } });
      const result = await run({
        ...f.options,
        ledger: {
          ...f.ledger,
          acquireClaim: async (input) => {
            if (change === "identity")
              f.set({ pullRequest: { id: "different", url: null } });
            else
              f.set({
                observations: {
                  ...f.read().observations,
                  pullRequest: { threadId: "new", commentId: "new" },
                },
              });
            return f.ledger.acquireClaim(input);
          },
        },
        seam: {
          ...f.options.seam,
          observePullRequestActivity: async () => ({
            entries: [{ threadId: "original", commentId: "original" }],
          }),
        },
      });
      expect(result.outcomes[0]).toMatchObject({
        reason: "stale-observation",
        cleanup: { status: "released" },
      });
      expect(f.ledger.checkpoint).not.toHaveBeenCalled();
      expect(f.ledger.releaseClaim).toHaveBeenCalledTimes(1);
      expect(result.signals).toEqual([]);
    },
  );
  it("never retries idempotency-conflict with a new operation identifier", async () => {
    const f = fixture();
    const options = inject(f, "checkpoint", {
      ok: false,
      error: { kind: "idempotency-conflict" },
    });
    const result = await run({
      ...options,
      budgets: { ...options.budgets, maxPolls: 5 },
    });
    expect(result.outcomes[0]?.reason).toBe("idempotency-conflict");
    expect(options.ledger.checkpoint).toHaveBeenCalledTimes(1);
    expect(f.ledger.acquireClaim).toHaveBeenCalledTimes(1);
    expect(f.ledger.releaseClaim).toHaveBeenCalledTimes(1);
  });
});

describe("DevSquadAdoWorkflowWatcher cleanup evidence [TEST-030]", () => {
  it.each(["cancelled", "budget", "stale", "clock", "delay"] as const)(
    "attempts cleanup once on %s even when cleanup is rejected",
    async (exit) => {
      const f = fixture();
      const parent = new AbortController();
      let reads = 0;
      const options = inject(f, "releaseClaim", {
        ok: false,
        error: { kind: "storage", outcome: "unchanged" },
      });
      const result = await run({
        ...options,
        signal: parent.signal,
        budgets: {
          ...options.budgets,
          maxPolls: exit === "clock" || exit === "delay" ? 2 : 1,
        },
        clock: () => {
          if (exit === "clock" && ++reads > 2) throw new Error("clock");
          return new Date(NOW);
        },
        delay: (ms, signal) =>
          ms === options.budgets.observationTimeoutMs
            ? options.delay(ms, signal)
            : exit === "delay"
              ? Promise.reject(new Error("delay"))
              : Promise.resolve(),
        ledger: {
          ...options.ledger,
          acquireClaim: async (input) => {
            if (exit === "stale")
              f.set({
                observations: { workItemCommentId: "moved", pullRequest: null },
              });
            const acquired = await f.ledger.acquireClaim(input);
            if (exit === "cancelled") parent.abort();
            return acquired;
          },
          checkpoint: vi.fn(async () => ({
            ok: false as const,
            error: {
              kind: "storage" as const,
              outcome: "indeterminate" as const,
            },
          })),
        },
      });
      expect(options.ledger.releaseClaim).toHaveBeenCalledTimes(1);
      expect(f.ledger.acquireClaim).toHaveBeenCalledTimes(1);
      expect(result.outcomes[0]).toMatchObject({
        kind: "failed",
        reason:
          exit === "stale"
            ? "claim-cleanup-unconfirmed"
            : exit === "cancelled" || exit === "delay"
              ? "cancelled"
              : "checkpoint-indeterminate",
        cleanup: {
          status: "failed",
          reason: "release-rejected",
          ledgerErrorKind: "storage",
        },
      });
      expect(result.signals).toEqual([]);
    },
  );
  it.each([
    { ok: false, error: { kind: "storage", outcome: "indeterminate" } },
    { ok: false, error: { kind: "contention", attempts: 32 } },
  ])(
    "does not invent acquire authority on ambiguous response %#",
    async (response) => {
      const f = fixture();
      const result = await run(inject(f, "acquireClaim", response));
      expect(result.outcomes[0]).toMatchObject({
        kind: "failed",
        claim: null,
        cleanup: {
          status: "indeterminate",
          reason: "authority-unvalidated",
          acceptedRevision: null,
        },
      });
      expect(f.ledger.releaseClaim).not.toHaveBeenCalled();
      expect(f.ledger.checkpoint).not.toHaveBeenCalled();
    },
  );
  for (const primary of [
    "acted",
    "suppressed",
    "checkpoint-failure",
  ] as const) {
    it.each([
      [
        { ok: false, error: { kind: "claim-authorization" } },
        "failed",
        "claim-authorization",
      ],
      [
        { ok: false, error: { kind: "storage", outcome: "unchanged" } },
        "failed",
        "storage",
      ],
      [
        { ok: false, error: { kind: "storage", outcome: "indeterminate" } },
        "indeterminate",
        "storage",
      ],
      [
        { ok: false, error: { kind: "contention", attempts: 32 } },
        "indeterminate",
        "contention",
      ],
      [{ ok: true, value: {} }, "indeterminate", "ledger-fault"],
    ] as const)(
      `${primary} retains primary effects across cleanup %#`,
      async (response, status, category) => {
        const f = fixture();
        let options = inject(f, "releaseClaim", response);
        if (primary === "suppressed")
          options = {
            ...options,
            intakeRules: { phases: ["other"], statuses: ["ready"] },
          };
        if (primary === "checkpoint-failure")
          options = {
            ...options,
            ledger: {
              ...options.ledger,
              checkpoint: vi.fn(async () => ({
                ok: false as const,
                error: { kind: "idempotency-conflict" as const },
              })),
            },
          };
        const result = await run(options);
        expect(options.ledger.releaseClaim).toHaveBeenCalledTimes(1);
        const candidate = result.outcomes[0]!;
        expect(candidate).toMatchObject({
          kind: "failed",
          reason:
            primary === "checkpoint-failure"
              ? "idempotency-conflict"
              : category === "ledger-fault"
                ? "ledger-unavailable"
                : "claim-cleanup-unconfirmed",
          cleanup: {
            status,
            reason:
              status === "failed"
                ? "release-rejected"
                : "release-indeterminate",
            ledgerErrorKind: category,
            acceptedRevision: null,
          },
        });
        expect(candidate.revision).toBe(
          primary === "checkpoint-failure" ? null : 6,
        );
        expect(candidate.cursorChanges).toEqual(
          primary === "checkpoint-failure" ? [] : ["work-item-comment"],
        );
        expect(result.signals).toHaveLength(primary === "acted" ? 1 : 0);
        expect(result.counts).toMatchObject({
          acted: primary === "acted" ? 1 : 0,
          suppressed: primary === "suppressed" ? 1 : 0,
          failed: 1,
        });
      },
    );
  }
  it("[TEST-031] distinguishes source4 checkpoint6 cleanup7 and unchanged replay7", async () => {
    const f = fixture();
    const result = await run(f.options);
    expect(result.outcomes[0]).toMatchObject({
      sourceRevision: 4,
      revision: 6,
      cleanup: { status: "released", acceptedRevision: 7 },
    });
    expect(result.signals).toEqual([
      {
        workItemId: "137",
        sourceRevision: 4,
        changedKinds: ["work-item-comment"],
        phase: "implement",
        status: "ready",
        claim: {
          ownerId: "watch-a",
          fencingValue: 2,
          expiresAt: "2026-01-01T00:01:00.000Z",
        },
      },
    ]);
    const repeat = await run(f.options);
    expect(repeat.outcomes[0]).toMatchObject({
      sourceRevision: 7,
      revision: null,
      cleanup: { status: "not-required", acceptedRevision: null },
    });
    expect(f.read().revision).toBe(7);
    expect(f.ledger.acquireClaim).toHaveBeenCalledTimes(1);
    expect(f.ledger.checkpoint).toHaveBeenCalledTimes(1);
    expect(f.ledger.releaseClaim).toHaveBeenCalledTimes(1);
  });
});

describe("DevSquadAdoWorkflowWatcher preflight and fresh abort [TEST-027][TEST-032]", () => {
  it.each([
    [{ baseIntervalMs: 0, maxIntervalMs: 0, multiplier: 1 }, true],
    [{ baseIntervalMs: -1 }, false],
    [{ baseIntervalMs: 0.5 }, false],
    [{ maxIntervalMs: Number.MAX_SAFE_INTEGER + 1 }, false],
    [{ multiplier: Infinity }, false],
    [{ multiplier: 0.99 }, false],
    [{ baseIntervalMs: 20, maxIntervalMs: 19 }, false],
    [{ jitter: 1 }, false],
  ] as const)(
    "validates backoff boundaries %# with no effects",
    async (backoff, accepted) => {
      const f = fixture();
      const options = {
        ...f.options,
        backoff,
      } as RunDevSquadAdoWorkflowWatchPassOptions;
      expect(validateDevSquadAdoWorkflowWatchPassOptions(options).ok).toBe(
        accepted,
      );
      if (!accepted)
        expect((await runDevSquadAdoWorkflowWatchPass(options)).ok).toBe(false);
      expect(f.requests).toEqual([]);
      expect(f.options.clock).not.toHaveBeenCalled();
      expect(f.options.delay).not.toHaveBeenCalled();
      expect(f.options.seam.observeWorkItemComments).not.toHaveBeenCalled();
    },
  );
  it.each([
    { aborted: false, addEventListener() {} },
    { aborted: false, addEventListener: 1, removeEventListener() {} },
    { aborted: "false", addEventListener() {}, removeEventListener() {} },
    { aborted: false, addEventListener() {}, removeEventListener: 1 },
  ])(
    "rejects malformed signals without any injected effects %#",
    async (signal) => {
      const f = fixture();
      expect(
        await runDevSquadAdoWorkflowWatchPass({
          ...f.options,
          signal: signal as unknown as AbortSignal,
        }),
      ).toMatchObject({ ok: false, error: { field: "signal" } });
      expect(f.options.clock).not.toHaveBeenCalled();
      expect(f.options.delay).not.toHaveBeenCalled();
      expect(f.options.seam.observeWorkItemComments).not.toHaveBeenCalled();
      expect(f.requests).toEqual([]);
    },
  );
  it("does not invoke PR after WI aborts parent while returning valid data", async () => {
    const f = fixture();
    f.set({ pullRequest: { id: "pr", url: null } });
    const parent = new AbortController();
    const options = {
      ...f.options,
      signal: parent.signal,
      seam: {
        ...f.options.seam,
        observeWorkItemComments: async () => {
          parent.abort();
          return { commentIds: ["480", "481"] };
        },
      },
    };
    const result = await run(options);
    expect(result.stopReason).toBe("cancelled");
    expect(f.options.seam.observePullRequestActivity).not.toHaveBeenCalled();
    expect(f.ledger.acquireClaim).not.toHaveBeenCalled();
  });
  it.each([
    ["candidates", [], false],
    ["candidates", [1], true],
    ["candidates", Array.from({ length: 1000 }, (_, i) => i + 1), true],
    ["candidates", Array.from({ length: 1001 }, (_, i) => i + 1), false],
    ["candidates", [137, "137"], false],
    ["maxPolls", 1, true],
    ["maxPolls", 10000, true],
    ["maxPolls", 0, false],
    ["maxPolls", 10001, false],
    ["maxPolls", Number.MAX_SAFE_INTEGER + 1, false],
    ["leaseDurationMs", 86400000, true],
    ["leaseDurationMs", 86400001, false],
    ["leaseDurationMs", 1, false],
    ["leaseDurationMs", 0, false],
    ["renewalThresholdMs", 60000, false],
    ["renewalThresholdMs", 0, false],
    ["observationTimeoutMs", 0, false],
    ["observationTimeoutMs", 0.5, false],
    ["observationTimeoutMs", 1, true],
    ["observationTimeoutMs", Number.MAX_SAFE_INTEGER, true],
    ["maxPollStartElapsedMs", 1, true],
    ["maxPollStartElapsedMs", Number.MAX_SAFE_INTEGER, true],
    ["renewalThresholdMs", 59999, true],
    ["maxPollStartElapsedMs", Number.MAX_SAFE_INTEGER + 1, false],
  ] as const)(
    "validates %s=%s (accepted %s) without effects",
    async (field, value, accepted) => {
      const f = fixture();
      const options = {
        ...f.options,
        ...(field === "candidates"
          ? { candidates: value }
          : ["leaseDurationMs", "renewalThresholdMs"].includes(field)
            ? { lease: { [field]: value } }
            : { budgets: { ...f.options.budgets, [field]: value } }),
      } as RunDevSquadAdoWorkflowWatchPassOptions;
      expect(validateDevSquadAdoWorkflowWatchPassOptions(options).ok).toBe(
        accepted,
      );
      if (!accepted)
        expect((await runDevSquadAdoWorkflowWatchPass(options)).ok).toBe(false);
      expect(f.options.clock).not.toHaveBeenCalled();
      expect(f.options.delay).not.toHaveBeenCalled();
      expect(f.options.seam.observeWorkItemComments).not.toHaveBeenCalled();
      expect(f.requests).toEqual([]);
    },
  );
});
