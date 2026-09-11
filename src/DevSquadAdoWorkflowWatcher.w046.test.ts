import { describe, expect, it, vi } from "vitest";
import {
  runDevSquadAdoWorkflowWatchPass,
  validateDevSquadAdoWorkflowWatchPassOptions,
  type DevSquadAdoWorkflowLedger,
  type DevSquadAdoWorkflowRecord,
  type RunDevSquadAdoWorkflowWatchPassOptions,
  type RunDevSquadAdoDiscoveryWatchPassOptions,
} from "./index.js";
import { discoveryOptions } from "./DevSquadAdoWorkflowWatcherDiscoveryTestSupport.js";

// W046: method-valid in-memory ledger exemplar from the retained remediation suite.
// These public-entry tests prove boundary behavior, not physical persistence.
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
const fixture = (workItemId = "137") => {
  let record = { ...baseRecord(), workItemId };
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
        workItemId,
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
    candidates: [workItemId],
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

const discoveryFixture = () => {
  const f = fixture();
  const { options } = discoveryOptions();
  const input: RunDevSquadAdoDiscoveryWatchPassOptions = {
    ...options,
    ledger: f.ledger,
    intakeRules: f.options.intakeRules,
    clock: f.options.clock,
    delay: (ms, signal) =>
      ms === 10 ? options.delay(ms, signal) : Promise.resolve(),
    discovery: {
      ...options.discovery,
      authorizations: [
        {
          workItemId: 137,
          kind: "authorized",
          submissionId: "private-submission",
          initial: { phase: "implement", status: "ready" },
        },
      ],
    },
    seam: {
      discoverWorkItemsPage: vi.fn(async (request) => ({
        ...request,
        items: [{ workItemId: 137, facts: {} }],
        next: { kind: "terminal" },
      })),
      observeWorkItemComments: vi.fn(async () => ({
        kind: "window" as const,
        commentIds: ["480", "481"],
      })),
    },
  };
  return { ...f, input };
};

// SKEP1 / FR-020/059-060/067-069 / CC-009/024/028-029/031/037.
describe("W046 SKEP1 initial missing-read provenance", () => {
  it.each(
    [true, false].flatMap((authorized) =>
      ["failed", "indeterminate"].map((cleanup) => ({ authorized, cleanup })),
    ),
  )(
    "preserves checkpoint rejection and $cleanup cleanup with authorization=$authorized",
    async ({ authorized, cleanup }) => {
      const f = discoveryFixture();
      const checkpoint = vi.fn(async () => ({
        ok: false as const,
        error: { kind: "record-not-found" as const },
      }));
      const releaseClaim = vi.fn(async () => ({
        ok: false as const,
        error: {
          kind: "storage" as const,
          outcome:
            cleanup === "failed"
              ? ("unchanged" as const)
              : ("indeterminate" as const),
        },
      }));
      const result = await runDevSquadAdoWorkflowWatchPass({
        ...f.input,
        discovery: {
          ...f.input.discovery,
          authorizations: authorized ? f.input.discovery.authorizations : [],
        },
        ledger: { ...f.ledger, checkpoint, releaseClaim },
      });
      expect(f.ledger.initializeRecord).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        ok: true,
        value: {
          signals: [],
          outcomes: [
            {
              category: "observation",
              kind: "failed",
              reason: "record-not-found",
              sourceRevision: 4,
              cleanup: { status: cleanup, ledgerErrorKind: "storage" },
            },
          ],
          counts: {
            failed: 1,
            cleanupFailed: cleanup === "failed" ? 1 : 0,
            cleanupIndeterminate: cleanup === "indeterminate" ? 1 : 0,
            cleanupNotRequired: 0,
          },
        },
      });
      expect(checkpoint).toHaveBeenCalledTimes(1);
      expect(releaseClaim).toHaveBeenCalledTimes(1);
    },
  );
  it.each([true, false])(
    "requires a method-valid missing read (valid=%s)",
    async (valid) => {
      const f = discoveryFixture();
      const initializeRecord = vi.fn(async () => ({
        ok: false as const,
        error: { kind: "record-already-exists" as const },
      }));
      const result = await runDevSquadAdoWorkflowWatchPass({
        ...f.input,
        ledger: {
          ...f.ledger,
          initializeRecord,
          readRecord: vi.fn(async () =>
            valid
              ? {
                  ok: false as const,
                  error: { kind: "record-not-found" as const },
                }
              : (null as unknown as Awaited<
                  ReturnType<DevSquadAdoWorkflowLedger["readRecord"]>
                >),
          ),
        },
      });
      expect(result.ok).toBe(true);
      expect(initializeRecord).toHaveBeenCalledTimes(valid ? 1 : 0);
      if (!valid)
        expect(result).toMatchObject({
          ok: true,
          value: {
            outcomes: [
              { category: "observation", reason: "ledger-unavailable" },
            ],
          },
        });
      expect(f.ledger.acquireClaim).not.toHaveBeenCalled();
    },
  );
});

// SKEP2 / FR-001/005-007/051-053/057-060/069 / CC-012/025/027-028/037.
describe("W046 SKEP2 executable signal listener failures", () => {
  it.each(
    ["supplied", "discovery"].flatMap((mode) =>
      ["add", "remove"].map((method) => ({ mode, method })),
    ),
  )(
    "contains $method throws in $mode while preserving prior acknowledgement and finalization",
    async ({ mode, method }) => {
      const first = discoveryFixture();
      const second = fixture("138");
      const ambiguous = {
        ok: false as const,
        error: { kind: "storage" as const, outcome: "indeterminate" as const },
      };
      const secondCheckpoint = vi.fn(async () => ambiguous);
      const secondLedger = { ...second.ledger, checkpoint: secondCheckpoint };
      const forItem = (id: unknown) =>
        String(id) === "137" ? first.ledger : secondLedger;
      const ledger: DevSquadAdoWorkflowLedger = {
        ...first.ledger,
        readRecord: (input) => forItem(input).readRecord(input),
        acquireClaim: (input) => forItem(input.workItemId).acquireClaim(input),
        renewClaim: (input) => forItem(input.workItemId).renewClaim(input),
        checkpoint: (input) => forItem(input.workItemId).checkpoint(input),
        releaseClaim: (input) => forItem(input.workItemId).releaseClaim(input),
      };
      // A listener method can throw after partially registering, or before removing.
      // Only the removal attempt can be guaranteed for arbitrary host adapters.
      const listeners = new Set<unknown>();
      const faultAt = mode === "supplied" ? 2 : 4;
      let adds = 0,
        removes = 0;
      const addEventListener = vi.fn((_type: string, listener: unknown) => {
        listeners.add(listener);
        if (++adds === faultAt && method === "add")
          throw new Error("private-listener-error");
      });
      const removeEventListener = vi.fn((_type: string, listener: unknown) => {
        if (++removes === faultAt && method === "remove")
          throw new Error("private-listener-error");
        listeners.delete(listener);
      });
      const signal = {
        aborted: false,
        addEventListener,
        removeEventListener,
      } as unknown as AbortSignal;
      const page = vi.fn<
        RunDevSquadAdoDiscoveryWatchPassOptions["seam"]["discoverWorkItemsPage"]
      >(async (request) => ({
        ...request,
        items:
          request.pageOrdinal === 1
            ? [
                { workItemId: 137, facts: {} },
                { workItemId: 138, facts: {} },
              ]
            : [],
        next:
          request.pageOrdinal === 1
            ? { kind: "continue", continuation: "private-page-token" }
            : { kind: "terminal" },
      }));
      const result =
        mode === "supplied"
          ? await runDevSquadAdoWorkflowWatchPass({
              ...first.options,
              ledger,
              candidates: [137, 138],
              signal,
            })
          : await runDevSquadAdoWorkflowWatchPass({
              ...first.input,
              ledger,
              signal,
              seam: { ...first.input.seam, discoverWorkItemsPage: page },
            });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unexpected validation failure");
      expect(result.value.signals).toHaveLength(1);
      expect(result.value.signals[0]).toMatchObject({ workItemId: "137" });
      expect(first.read().observations.workItemCommentId).toBe("481");
      expect(result.value.outcomes[0]).toMatchObject({
        kind: "acted",
        cleanup: { status: "released" },
      });
      expect(first.ledger.releaseClaim).toHaveBeenCalledTimes(1);
      expect(addEventListener).toHaveBeenCalledTimes(faultAt);
      expect(removeEventListener).toHaveBeenCalledTimes(faultAt);
      expect(listeners.size).toBe(method === "remove" ? 1 : 0);
      if (mode === "discovery") {
        expect(result.value).toMatchObject({
          traversal: { status: "incomplete", reason: "page-failed" },
          counts: { pageCalls: method === "add" ? 1 : 2, cleanupReleased: 2 },
        });
        expect(result.value.outcomes[1]).toMatchObject({
          kind: "failed",
          reason: "checkpoint-indeterminate",
          cleanup: { status: "released" },
        });
        expect(secondCheckpoint).toHaveBeenCalledTimes(2);
        expect(second.ledger.releaseClaim).toHaveBeenCalledTimes(1);
        expect(secondCheckpoint.mock.calls[0]).toEqual(
          secondCheckpoint.mock.calls[1],
        );
      } else {
        expect(result.value.outcomes[1]).toMatchObject({
          kind: "failed",
          reason: "observation-failed",
          cleanup: { status: "not-required" },
        });
        expect(second.ledger.acquireClaim).not.toHaveBeenCalled();
      }
      expect(JSON.stringify(result)).not.toMatch(
        /private-listener-error|private-page-token|claimToken/,
      );
    },
  );
});

// SKEP3 / FR-016-017/047-048 / CC-011/030: caller-owned Dates cannot move baselines.
describe("W046 SKEP3 mutable supplied clock", () => {
  it("blocks poll two at 6000ms with a 5000ms budget and preserves the initial timestamp", async () => {
    const f = fixture();
    const shared = new Date(NOW);
    let reads = 0;
    const clock = vi.fn(() => {
      shared.setTime(Date.parse(NOW) + (++reads >= 3 ? 6000 : 0));
      return shared;
    });
    const observeWorkItemComments = vi.fn(async () => ({
      commentIds: ["480"],
    }));
    const result = await runDevSquadAdoWorkflowWatchPass({
      ...f.options,
      clock,
      budgets: {
        ...f.options.budgets,
        maxPolls: 3,
        maxPollStartElapsedMs: 5000,
      },
      delay: (ms, signal) =>
        signal === undefined ? Promise.resolve() : f.options.delay(ms, signal),
      seam: { observeWorkItemComments },
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        polls: 1,
        stopReason: "poll-start-budget-exhausted",
        startedAt: NOW,
        completedAt: "2026-01-01T00:00:06.000Z",
      },
    });
    expect(observeWorkItemComments).toHaveBeenCalledTimes(1);
    expect(clock).toHaveBeenCalledTimes(3);
    expect(f.ledger.acquireClaim).not.toHaveBeenCalled();
  });
  it("retains start and final poll metadata if the seam mutates the returned Date", async () => {
    const f = fixture();
    const shared = new Date(NOW);
    const clock = vi.fn(() => shared);
    const result = await runDevSquadAdoWorkflowWatchPass({
      ...f.options,
      clock,
      seam: {
        observeWorkItemComments: async () => {
          shared.setTime(Date.parse(NOW) + 6000);
          return { commentIds: ["480"] };
        },
      },
    });
    expect(result).toMatchObject({
      ok: true,
      value: { polls: 1, startedAt: NOW, completedAt: NOW },
    });
    expect(clock).toHaveBeenCalledTimes(2);
  });
});
