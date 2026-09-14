import { afterEach, describe, expect, it, vi } from "vitest";
import { runDevSquadAdoWorkflowWatchPass } from "./index.js";
import type {
  DevSquadAdoWorkflowLedger,
  InitializeDevSquadAdoWorkflowRecordInput,
  RunDevSquadAdoDiscoveryWatchPassOptions,
} from "./index.js";
import { discoveryOptions } from "./DevSquadAdoWorkflowWatcherDiscoveryTestSupport.js";
import {
  cleanupWatcherRepositories,
  createWatcherLedgerFixture,
  openWatcherLedger,
  readWatcherLedgerArtifacts,
} from "./DevSquadAdoWorkflowWatcherTestSupport.js";

afterEach(cleanupWatcherRepositories);
const missing = async () => ({
  ok: false as const,
  error: { kind: "record-not-found" as const },
});
// W041 / TEST-033: all assertions enter through the public discovery pass.
const fixture = async () => {
  const { options, effect } = discoveryOptions();
  const real = await createWatcherLedgerFixture(options.clock);
  const initializeRecord = vi.fn(real.ledger.initializeRecord);
  const input: RunDevSquadAdoDiscoveryWatchPassOptions = {
    ...options,
    ledger: {
      ...options.ledger,
      readRecord: real.ledger.readRecord,
      initializeRecord,
    },
    delay: (ms, signal) =>
      ms === 10 ? options.delay(ms, signal) : Promise.resolve(),
    discovery: {
      ...options.discovery,
      authorizations: [
        {
          workItemId: 999,
          kind: "authorized",
          submissionId: "submission-secret",
          initial: { phase: "ready", status: "open" },
        },
      ],
    },
    seam: {
      ...options.seam,
      discoverWorkItemsPage: async (request) => ({
        ...request,
        items: [{ workItemId: 999, facts: {} }],
        next: { kind: "terminal" },
      }),
    },
  };
  return { input, effect, initializeRecord, ...real };
};
describe("authorized fresh-only admission [W041]", () => {
  it.each([true, false])(
    "initializes item 999 without comments, intake matches=%s",
    async (admit) => {
      const { input, effect, initializeRecord, ledger } = await fixture();
      const result = await runDevSquadAdoWorkflowWatchPass({
        ...input,
        intakeRules: {
          phases: [admit ? "ready" : "other"],
          statuses: ["open"],
        },
      });
      expect(result).toMatchObject({
        ok: true,
        value: {
          counts: {
            admitted: 1,
            acted: admit ? 1 : 0,
            suppressed: 0,
            eligible: 0,
            cleanupNotRequired: 1,
          },
          outcomes: [
            {
              category: "admission",
              reason: admit
                ? "admission-accepted"
                : "admission-intake-rules-unmatched",
              acceptance: { kind: "fresh", acceptedRevision: 1 },
            },
          ],
        },
      });
      if (result.ok && admit)
        expect(result.value.signals).toEqual([
          {
            kind: "discovery-admission",
            workItemId: "999",
            acceptedInitializationRevision: 1,
            phase: "ready",
            status: "open",
            matching: {
              policyVersion: "policy-v1",
              decision: "matched",
              predicates: [],
            },
            authorization: "host-authorized",
          },
        ]);
      expect(initializeRecord).toHaveBeenCalledTimes(1);
      expect(Object.keys(initializeRecord.mock.calls[0]![0]).sort()).toEqual([
        "operationId",
        "phase",
        "status",
        "workItemId",
      ]);
      expect(await ledger.readRecord(999)).toMatchObject({
        ok: true,
        value: {
          revision: 1,
          phase: "ready",
          status: "open",
          observations: { workItemCommentId: null, pullRequest: null },
          pullRequest: { id: null, url: null },
          agent: { current: null, history: [] },
          session: { current: null, history: [] },
          activeClaim: null,
          fencingCounter: 0,
          checkpoints: [],
        },
      });
      expect(effect).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain("submission-secret");
    },
  );
  it.each([undefined, "not-authorized", "initial-state-missing"] as const)(
    "does not initialize unavailable authorization %s",
    async (unavailable) => {
      const { input, effect, initializeRecord } = await fixture();
      const result = await runDevSquadAdoWorkflowWatchPass({
        ...input,
        discovery: {
          ...input.discovery,
          authorizations:
            unavailable === undefined
              ? []
              : [{ workItemId: 999, kind: "unavailable", reason: unavailable }],
        },
      });
      expect(result).toMatchObject({
        ok: true,
        value: {
          signals: [],
          outcomes: [
            {
              reason:
                unavailable === "initial-state-missing"
                  ? "admission-initial-state-missing"
                  : "admission-not-authorized",
              acceptance: { kind: "none" },
            },
          ],
        },
      });
      expect(initializeRecord).not.toHaveBeenCalled();
      expect(effect).not.toHaveBeenCalled();
    },
  );
  it("replays the same retained identity across pass IDs without redelivery", async () => {
    const { input, effect, initializeRecord } = await fixture();
    const first = await runDevSquadAdoWorkflowWatchPass(input);
    const second = await runDevSquadAdoWorkflowWatchPass({
      ...input,
      passId: "another-pass",
      ledger: { ...input.ledger, readRecord: missing },
    });
    expect(first).toMatchObject({
      ok: true,
      value: { counts: { acted: 1, admitted: 1 } },
    });
    expect(second).toMatchObject({
      ok: true,
      value: {
        signals: [],
        counts: { initializationReplayed: 1, admitted: 0 },
        outcomes: [
          {
            reason: "admission-replayed",
            acceptance: { kind: "replayed", acceptedRevision: 1 },
          },
        ],
      },
    });
    expect(initializeRecord.mock.calls[0]![0]).toEqual(
      initializeRecord.mock.calls[1]![0],
    );
    expect(effect).not.toHaveBeenCalled();
  });
  it.each([true, false])(
    "racing publications have at most one admission, same submission=%s",
    async (same) => {
      const { input, effect, ledger } = await fixture();
      let reads = 0;
      let release!: () => void;
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      const concurrent = {
        ...input,
        ledger: {
          ...input.ledger,
          readRecord: async () => {
            if (++reads === 2) release();
            await barrier;
            return missing();
          },
        },
      };
      const other = {
        ...concurrent,
        passId: "other",
        discovery: {
          ...input.discovery,
          authorizations: [
            {
              workItemId: 999,
              kind: "authorized" as const,
              submissionId: same ? "submission-secret" : "different",
              initial: { phase: "ready", status: "open" },
            },
          ],
        },
      };
      const results = await Promise.all([
        runDevSquadAdoWorkflowWatchPass(concurrent),
        runDevSquadAdoWorkflowWatchPass(other),
      ]);
      expect(
        results.reduce((n, r) => n + (r.ok ? r.value.signals.length : 0), 0),
      ).toBe(1);
      expect(await ledger.readRecord(999)).toMatchObject({
        ok: true,
        value: { revision: 1 },
      });
      expect(effect).not.toHaveBeenCalled();
    },
  );
  it.each(["contention", "storage"])(
    "retries %s with the identical request and no comment fallback",
    async (kind) => {
      const { input, effect, ledger } = await fixture();
      const requests: InitializeDevSquadAdoWorkflowRecordInput[] = [];
      const result = await runDevSquadAdoWorkflowWatchPass({
        ...input,
        ledger: {
          ...input.ledger,
          initializeRecord: async (request) => {
            requests.push(structuredClone(request));
            if (requests.length === 1)
              return kind === "contention"
                ? { ok: false, error: { kind: "contention", attempts: 1 } }
                : {
                    ok: false,
                    error: { kind: "storage", outcome: "indeterminate" },
                  };
            return ledger.initializeRecord(request);
          },
        },
      });
      expect(result).toMatchObject({
        ok: true,
        value: {
          polls: 2,
          counts: { pageCalls: 1, admitted: 1, acted: 1 },
          traversal: { status: "complete" },
        },
      });
      expect(requests).toHaveLength(2);
      expect(requests[0]).toEqual(requests[1]);
      expect(effect).not.toHaveBeenCalled();
    },
  );
});

// W046-001 / CC-031/037 / TEST-033/039: intake uses preflight snapshots,
// not caller array methods or values changed by awaited page/ledger effects.
describe.each(["phases", "statuses"] as const)(
  "admission intake snapshot: %s [W046-001]",
  (dimension) => {
    const cases = [
      "ordinary",
      "overridden includes",
      "throwing includes",
      "page mutation",
      "retained retry mutation",
    ].flatMap((scenario) =>
      [true, false].map((admit) => ({ scenario, admit })),
    );
    it.each(cases)(
      "$scenario, preflight intake matches=$admit",
      async ({ scenario, admit }) => {
        const { input, effect, initializeRecord, ledger } = await fixture();
        const intakeRules = { phases: ["ready"], statuses: ["open"] };
        const matchingValue = intakeRules[dimension][0]!;
        intakeRules[dimension][0] = admit ? matchingValue : "blocked";
        const mutate = () => {
          intakeRules[dimension][0] = admit ? "blocked" : matchingValue;
        };
        const callerIncludes = vi.fn(() => {
          if (scenario === "throwing includes")
            throw new Error("caller-includes-fault");
          return !admit;
        });
        if (
          scenario === "overridden includes" ||
          scenario === "throwing includes"
        )
          Object.defineProperty(intakeRules[dimension], "includes", {
            value: callerIncludes,
          });

        const retry = scenario === "retained retry mutation";
        const requests: InitializeDevSquadAdoWorkflowRecordInput[] = [];
        initializeRecord.mockImplementation(async (request) => {
          requests.push(structuredClone(request));
          if (retry && requests.length === 1) {
            mutate();
            return { ok: false, error: { kind: "contention", attempts: 1 } };
          }
          return ledger.initializeRecord(request);
        });
        const readRecord = vi.fn(ledger.readRecord);
        const discoverWorkItemsPage = vi.fn(async (request) => {
          if (scenario === "page mutation") mutate();
          return input.seam.discoverWorkItemsPage(request);
        });
        const result = await runDevSquadAdoWorkflowWatchPass({
          ...input,
          intakeRules,
          ledger: { ...input.ledger, readRecord },
          seam: {
            ...input.seam,
            discoverWorkItemsPage,
            observePullRequestActivity: effect,
          },
        });
        expect(result.ok).toBe(true);
        if (!result.ok)
          throw new Error("expected structured discovery success");
        expect(result.value).toMatchObject({
          mode: "discovery",
          polls: retry ? 2 : 1,
          stopReason: "completed",
          traversal: {
            status: "complete",
            reason: "terminal-page",
            terminalPageSeen: true,
          },
        });
        expect(result.value.counts).toEqual({
          pageCalls: 1,
          pagesValidated: 1,
          discovered: 1,
          evaluated: 1,
          admitted: 1,
          initializationReplayed: 0,
          paused: 0,
          processed: 1,
          examined: 1,
          eligible: 0,
          acted: admit ? 1 : 0,
          noChange: admit ? 0 : 1,
          suppressed: 0,
          skipped: 0,
          failed: 0,
          cleanupReleased: 0,
          cleanupFailed: 0,
          cleanupIndeterminate: 0,
          cleanupNotRequired: 1,
        });
        const matching = {
          policyVersion: "policy-v1",
          decision: "matched",
          predicates: [],
        };
        expect(result.value.outcomes).toEqual([
          {
            category: "admission",
            workItemId: "999",
            kind: admit ? "acted" : "no-change",
            reason: admit
              ? "admission-accepted"
              : "admission-intake-rules-unmatched",
            matching,
            acceptance: {
              kind: "fresh",
              acceptedRevision: 1,
              acceptedAt: "2026-09-10T00:00:00.000Z",
            },
            ledgerErrorKind: null,
            cleanup: {
              status: "not-required",
              reason: "no-claim-acquired",
              ledgerErrorKind: null,
              acceptedRevision: null,
            },
          },
        ]);
        expect(result.value.signals).toEqual(
          admit
            ? [
                {
                  kind: "discovery-admission",
                  workItemId: "999",
                  acceptedInitializationRevision: 1,
                  phase: "ready",
                  status: "open",
                  matching,
                  authorization: "host-authorized",
                },
              ]
            : [],
        );
        expect(discoverWorkItemsPage).toHaveBeenCalledTimes(1);
        expect(readRecord).toHaveBeenCalledTimes(1);
        expect(initializeRecord).toHaveBeenCalledTimes(retry ? 2 : 1);
        expect(requests[0]).toEqual({
          workItemId: "999",
          operationId: expect.any(String),
          phase: "ready",
          status: "open",
        });
        if (retry) expect(requests[1]).toEqual(requests[0]);
        expect(callerIncludes).not.toHaveBeenCalled();
        // The shared spy covers both observations and acquire/renew/checkpoint/release.
        expect(effect).not.toHaveBeenCalled();
        expect(await ledger.readRecord(999)).toMatchObject({
          ok: true,
          value: {
            revision: 1,
            phase: "ready",
            status: "open",
            observations: { workItemCommentId: null, pullRequest: null },
            pullRequest: { id: null, url: null },
            agent: { current: null, history: [] },
            session: { current: null, history: [] },
            activeClaim: null,
            fencingCounter: 0,
            checkpoints: [],
          },
        });
      },
    );
  },
);

const errors: unknown[] = [
  { kind: "repository-not-found" },
  { kind: "repository-not-directory" },
  { kind: "unsupported-filesystem" },
  { kind: "record-not-found" },
  { kind: "record-already-exists" },
  { kind: "claim-not-held" },
  { kind: "claim-authorization" },
  { kind: "idempotency-conflict" },
  { kind: "validation", field: "secret", reason: "secret" },
  { kind: "path-boundary", artifact: "secret" },
  { kind: "unsupported-permissions" },
  { kind: "claim-expired", expiredAt: "2026-09-10T00:00:00.000Z" },
  { kind: "stale-fencing", currentFencingValue: 1 },
  { kind: "revision-conflict", expectedRevision: 1, currentRevision: 2 },
  { kind: "state-conflict", current: { phase: "ready", status: "open" } },
  { kind: "corrupt-artifact", artifact: "secret" },
  { kind: "unsupported-schema-version", artifact: "secret", schemaVersion: 2 },
  { kind: "capacity-exceeded", resource: "records", limit: 1 },
  { kind: "scan-limit", limit: 1 },
  { kind: "contention", attempts: 1 },
  { kind: "storage", outcome: "unchanged" },
  { kind: "storage", outcome: "indeterminate" },
  {
    kind: "claim-conflict",
    claim: {
      workItemId: "999",
      ownerId: "other",
      fencingValue: 1,
      acquiredAt: "2026-09-10T00:00:00.000Z",
      heartbeatAt: "2026-09-10T00:00:00.000Z",
      expiresAt: "2026-09-10T00:01:00.000Z",
    },
  },
];
describe("initialization-specific guards [W041 / SEC-A02]", () => {
  it.each(errors)("validates/redacts known error %j", async (error) => {
    const { input, effect } = await fixture();
    const result = await runDevSquadAdoWorkflowWatchPass({
      ...input,
      budgets: { ...input.budgets, maxPolls: 1 },
      ledger: {
        ...input.ledger,
        initializeRecord: async () =>
          ({ ok: false, error }) as Awaited<
            ReturnType<DevSquadAdoWorkflowLedger["initializeRecord"]>
          >,
      },
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        signals: [],
        counts: { admitted: 0, cleanupNotRequired: 1 },
        outcomes: [
          {
            category: "admission",
            cleanup: {
              status: "not-required",
              reason: "no-claim-acquired",
              acceptedRevision: null,
              ledgerErrorKind: null,
            },
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("ledger-fault");
    expect(effect).not.toHaveBeenCalled();
  });
  it.each([
    null,
    { kind: "unknown" },
    { kind: "contention", attempts: 0 },
    { kind: "storage", outcome: "other" },
    { kind: "claim-expired", expiredAt: "bad" },
    { kind: "revision-conflict", expectedRevision: 0, currentRevision: 1 },
    { kind: "capacity-exceeded", resource: "other", limit: 1 },
    { kind: "state-conflict", current: {} },
    { kind: "claim-conflict", claim: {} },
  ])("rejects malformed error %j", async (error) => {
    const { input, effect } = await fixture();
    const result = await runDevSquadAdoWorkflowWatchPass({
      ...input,
      ledger: {
        ...input.ledger,
        initializeRecord: async () =>
          ({ ok: false, error }) as Awaited<
            ReturnType<DevSquadAdoWorkflowLedger["initializeRecord"]>
          >,
      },
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        signals: [],
        outcomes: [
          {
            kind: "failed",
            reason: "ledger-unavailable",
            ledgerErrorKind: "ledger-fault",
            acceptance: { kind: "unconfirmed" },
            cleanup: { status: "not-required" },
          },
        ],
      },
    });
    expect(effect).not.toHaveBeenCalled();
  });
  it.each([
    "revision",
    "timestamp",
    "creation",
    "replay",
    "kind",
    "identity",
    "phase",
    "cursor",
    "claim",
    "history",
    "mutation",
    "throw",
    "reject",
  ])("rejects contradictory %s acknowledgement", async (defect) => {
    const { input, effect, ledger } = await fixture();
    const result = await runDevSquadAdoWorkflowWatchPass({
      ...input,
      ledger: {
        ...input.ledger,
        initializeRecord: async (request) => {
          if (defect === "throw") throw Error("secret");
          if (defect === "reject") return Promise.reject(Error("secret"));
          const accepted = await ledger.initializeRecord(request);
          if (!accepted.ok) throw Error("fixture");
          const response = structuredClone(accepted);
          if (defect === "revision")
            Object.assign(response.value, { acceptedRevision: 2 });
          if (defect === "timestamp")
            Object.assign(response.value, { acceptedAt: "bad" });
          if (defect === "creation")
            Object.assign(response.value, {
              record: {
                ...response.value.record,
                createdAt: "2026-09-09T00:00:00.000Z",
              },
            });
          if (defect === "replay")
            Object.assign(response.value, { replayed: 1 });
          if (defect === "kind")
            Object.assign(response.value.outcome, { kind: "checkpointed" });
          if (defect === "identity")
            Object.assign(response.value, {
              record: { ...response.value.record, workItemId: "998" },
            });
          if (defect === "phase")
            Object.assign(response.value, {
              record: { ...response.value.record, phase: "other" },
            });
          if (defect === "cursor")
            Object.assign(response.value, {
              record: {
                ...response.value.record,
                observations: { workItemCommentId: "fake", pullRequest: null },
              },
            });
          if (defect === "claim")
            Object.assign(response.value, {
              record: { ...response.value.record, fencingCounter: 1 },
            });
          if (defect === "history")
            Object.assign(response.value, {
              record: {
                ...response.value.record,
                agent: {
                  current: "agent",
                  history: [
                    {
                      id: "agent",
                      revision: 1,
                      activatedAt: response.value.acceptedAt,
                    },
                  ],
                },
              },
            });
          if (defect === "mutation") Object.assign(request, { phase: "other" });
          return response;
        },
      },
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        signals: [],
        counts: { admitted: 0, cleanupNotRequired: 1 },
        outcomes: [
          {
            kind: "failed",
            reason: "ledger-unavailable",
            ledgerErrorKind: "ledger-fault",
            acceptance: { kind: "unconfirmed" },
          },
        ],
      },
    });
    expect(effect).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});

// W041: latest state is not the initialization snapshot; the retained chain binds it.
describe("initialization acknowledgements with later records", () => {
  it.each([
    "fresh-claim",
    "fresh-checkpoint",
    "replay-checkpoint",
    "contradictory-initial",
    "contradictory-chain",
  ])("validates %s against the original authorized state", async (variant) => {
    const { input, effect, ledger } = await fixture();
    let retained: InitializeDevSquadAdoWorkflowRecordInput | undefined;
    const initializeRecord: DevSquadAdoWorkflowLedger["initializeRecord"] =
      async (request) => {
        retained = request;
        const initialized = await ledger.initializeRecord(request);
        if (!initialized.ok) throw Error("fixture initialize");
        const acquired = await ledger.acquireClaim({
          workItemId: 999,
          operationId: "later-claim",
          ownerId: "later",
          claimToken: Buffer.alloc(32, 7).toString("base64url"),
          leaseDurationMs: 60000,
        });
        if (!acquired.ok) throw Error("fixture acquire");
        const { ownerId, claimToken, fencingValue } =
          acquired.value.outcome.authority;
        const authority = { ownerId, claimToken, fencingValue };
        if (variant !== "fresh-claim")
          expect(
            (
              await ledger.checkpoint({
                workItemId: 999,
                operationId: "later-checkpoint",
                authority,
                expected: {
                  revision: acquired.value.record.revision,
                  phase: "ready",
                  status: "open",
                },
                patch: {
                  phase: "later",
                  observations: { workItemCommentId: "real-comment" },
                },
              })
            ).ok,
          ).toBe(true);
        const latest = await ledger.readRecord(999);
        if (!latest.ok) throw Error("fixture read");
        const record = structuredClone(latest.value);
        if (variant === "contradictory-initial")
          Object.assign(record.checkpoints[0]!, {
            previous: { phase: "wrong", status: "open" },
          });
        if (variant === "contradictory-chain")
          Object.assign(record.checkpoints[0]!, {
            resulting: { phase: "wrong", status: "open" },
          });
        if (variant === "replay-checkpoint")
          return ledger.initializeRecord(request);
        return { ...initialized, value: { ...initialized.value, record } };
      };
    const result = await runDevSquadAdoWorkflowWatchPass({
      ...input,
      ledger: { ...input.ledger, initializeRecord },
    });
    const bad = variant.startsWith("contradictory"),
      replay = variant.startsWith("replay");
    expect(result).toMatchObject({
      ok: true,
      value: {
        counts: {
          acted: bad || replay ? 0 : 1,
          admitted: bad || replay ? 0 : 1,
          initializationReplayed: replay ? 1 : 0,
        },
        outcomes: [
          {
            acceptance: {
              kind: bad ? "unconfirmed" : replay ? "replayed" : "fresh",
            },
            reason: bad
              ? "ledger-unavailable"
              : replay
                ? "admission-replayed"
                : "admission-accepted",
          },
        ],
      },
    });
    expect(retained?.phase).toBe("ready");
    expect(effect).not.toHaveBeenCalled();
  });
  it("captures authorization before read callbacks mutate caller declarations", async () => {
    const { input, effect, initializeRecord } = await fixture();
    const result = await runDevSquadAdoWorkflowWatchPass({
      ...input,
      ledger: {
        ...input.ledger,
        readRecord: async () => {
          Object.assign(input.discovery.authorizations![0]!, {
            initial: { phase: "secret-changed", status: "other" },
            submissionId: "changed",
          });
          return missing();
        },
      },
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        counts: { admitted: 1, acted: 1 },
        signals: [{ phase: "ready", status: "open" }],
      },
    });
    expect(initializeRecord.mock.calls[0]![0].phase).toBe("ready");
    expect(effect).not.toHaveBeenCalled();
  });
});

// W044 / FR-052/067-069 / CC-027-031: acknowledgement is not delivery recovery.
describe("integrated admission cancellation and restart [W044]", () => {
  it("counts evaluated pauses independently of unscheduled dispositions after accepted initialization abort", async () => {
    const f = await fixture();
    const controller = new AbortController();
    f.initializeRecord.mockImplementation(async (request) => {
      const accepted = await f.ledger.initializeRecord(request);
      controller.abort();
      return accepted;
    });
    const result = await runDevSquadAdoWorkflowWatchPass({
      ...f.input,
      signal: controller.signal,
      discovery: {
        ...f.input.discovery,
        policy: {
          version: "pause-count",
          filters: [
            { dimension: "state", operator: "one-of", values: ["included"] },
          ],
        },
      },
      seam: {
        ...f.input.seam,
        discoverWorkItemsPage: async (request) => ({
          ...request,
          items: [
            {
              workItemId: "999",
              facts: { state: { kind: "known", value: "included" } },
            },
            {
              workItemId: "a",
              facts: { state: { kind: "known", value: "excluded" } },
            },
            { workItemId: "b", facts: {} },
            {
              workItemId: "c",
              facts: { state: { kind: "known", value: "included" } },
            },
          ],
          next: { kind: "terminal" },
        }),
      },
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        stopReason: "cancelled",
        traversal: { status: "incomplete", terminalPageSeen: true },
        counts: {
          pageCalls: 1,
          pagesValidated: 1,
          discovered: 4,
          evaluated: 4,
          paused: 2,
          processed: 1,
          admitted: 1,
          acted: 1,
          eligible: 0,
          suppressed: 0,
          skipped: 3,
          failed: 0,
          cleanupNotRequired: 4,
          cleanupReleased: 0,
          cleanupFailed: 0,
          cleanupIndeterminate: 0,
        },
        signals: [{ kind: "discovery-admission", workItemId: "999" }],
        outcomes: [
          { category: "admission", acceptance: { kind: "fresh" } },
          {
            category: "unprocessed",
            workItemId: "a",
            matching: { decision: "excluded" },
          },
          {
            category: "unprocessed",
            workItemId: "b",
            matching: { decision: "facts-missing" },
          },
          {
            category: "unprocessed",
            workItemId: "c",
            matching: { decision: "matched" },
          },
        ],
      },
    });
    expect(f.initializeRecord).toHaveBeenCalledTimes(1);
    expect(f.effect).not.toHaveBeenCalled();
    expect(await f.ledger.readRecord(999)).toMatchObject({
      ok: true,
      value: { revision: 1, activeClaim: null },
    });
  });

  it.each(["lost", "malformed"] as const)(
    "does not reconstruct discovery delivery after durable %s acknowledgement and reopen",
    async (failure) => {
      const f = await fixture();
      f.initializeRecord.mockImplementation(async (request) => {
        const accepted = await f.ledger.initializeRecord(request);
        if (failure === "lost") throw Error("private-lost-ack");
        return {
          ...accepted,
          value: { private: "private-malformed-ack" },
        } as unknown as Awaited<
          ReturnType<DevSquadAdoWorkflowLedger["initializeRecord"]>
        >;
      });
      const first = await runDevSquadAdoWorkflowWatchPass(f.input);
      expect(first).toMatchObject({
        ok: true,
        value: {
          signals: [],
          counts: { admitted: 0, failed: 1, cleanupNotRequired: 1 },
          outcomes: [
            {
              reason: "ledger-unavailable",
              ledgerErrorKind: "ledger-fault",
              acceptance: { kind: "unconfirmed" },
            },
          ],
        },
      });
      const before = await readWatcherLedgerArtifacts(f.repositoryRoot);
      const reopened = await openWatcherLedger(f.repositoryRoot, f.input.clock);
      const observe = vi.fn<
        NonNullable<typeof f.input.seam.observeWorkItemComments>
      >(async () => ({ kind: "window", commentIds: [] }));
      const second = await runDevSquadAdoWorkflowWatchPass({
        ...f.input,
        passId: "reopened",
        ledger: reopened,
        seam: { ...f.input.seam, observeWorkItemComments: observe },
      });
      expect(second).toMatchObject({
        ok: true,
        value: {
          signals: [],
          counts: { admitted: 0, initializationReplayed: 0 },
        },
      });
      expect(observe).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ sinceCommentId: null }),
      );
      expect(await readWatcherLedgerArtifacts(f.repositoryRoot)).toEqual(
        before,
      );
      // A real comment is still observable later; initialization seeded no cursor.
      observe.mockResolvedValue({
        kind: "window",
        commentIds: ["real-comment"],
      });
      const later = await runDevSquadAdoWorkflowWatchPass({
        ...f.input,
        passId: "later-comment",
        ledger: reopened,
        seam: { ...f.input.seam, observeWorkItemComments: observe },
      });
      expect(later).toMatchObject({
        ok: true,
        value: {
          signals: [{ kind: "comment-observation", workItemId: "999" }],
          counts: { acted: 1, admitted: 0 },
        },
      });
      expect(f.effect).not.toHaveBeenCalled();
      for (const surface of [
        first,
        second,
        later,
        await reopened.listResumableRecords(),
        await reopened.inspectRecoveryErrors(),
        await readWatcherLedgerArtifacts(f.repositoryRoot),
      ])
        expect(JSON.stringify(surface)).not.toMatch(
          /private-|submission-secret/,
        );
    },
  );
});

// W044 / FR-037/046/052/068: retained admission is one lane per invocation.
describe("awaited initialization and retained admission lane [W044]", () => {
  it.each([
    "fresh",
    "replayed",
    "already-recorded",
    "lost",
    "malformed",
  ] as const)(
    "awaits in-flight %s initialization after abort without comment fallback or release",
    async (acceptance) => {
      const f = await fixture();
      if (acceptance === "replayed")
        await runDevSquadAdoWorkflowWatchPass(f.input);
      if (acceptance === "already-recorded") {
        expect(
          (
            await f.ledger.initializeRecord({
              workItemId: 999,
              operationId: "other-initializer",
              phase: "ready",
              status: "open",
            })
          ).ok,
        ).toBe(true);
      }
      const controller = new AbortController();
      let enter!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      let settle!: () => void;
      const held = new Promise<void>((resolve) => {
        settle = resolve;
      });
      f.initializeRecord.mockImplementation(async (request) => {
        const result = await f.ledger.initializeRecord(request);
        enter();
        await held;
        if (acceptance === "lost") throw Error("private-lost-initialization");
        if (acceptance === "malformed")
          return { ok: true, value: {} } as unknown as typeof result;
        return result;
      });
      let returned = false;
      const pass = runDevSquadAdoWorkflowWatchPass({
        ...f.input,
        signal: controller.signal,
        passId: "different-pass",
        ledger: { ...f.input.ledger, readRecord: missing },
      }).then((result) => {
        returned = true;
        return result;
      });
      await entered;
      controller.abort();
      await Promise.resolve();
      await Promise.resolve();
      expect(returned).toBe(false);
      settle();
      const result = await pass;
      expect(result).toMatchObject({
        ok: true,
        value: {
          stopReason: "cancelled",
          traversal: { status: "incomplete", terminalPageSeen: true },
          counts: {
            admitted: acceptance === "fresh" ? 1 : 0,
            acted: acceptance === "fresh" ? 1 : 0,
            initializationReplayed: acceptance === "replayed" ? 1 : 0,
            cleanupNotRequired: 1,
            cleanupReleased: 0,
            cleanupFailed: 0,
            cleanupIndeterminate: 0,
          },
          outcomes: [
            {
              acceptance: {
                kind:
                  acceptance === "fresh"
                    ? "fresh"
                    : acceptance === "replayed"
                      ? "replayed"
                      : acceptance === "already-recorded"
                        ? "none"
                        : "unconfirmed",
              },
            },
          ],
        },
      });
      expect(f.effect).not.toHaveBeenCalled();
      if (acceptance === "replayed")
        expect(f.initializeRecord.mock.calls[0]![0]).toEqual(
          f.initializeRecord.mock.calls[1]![0],
        );
      const reopened = await openWatcherLedger(f.repositoryRoot, f.input.clock);
      expect(await reopened.readRecord(999)).toMatchObject({
        ok: true,
        value: {
          revision: 1,
          activeClaim: null,
          observations: { workItemCommentId: null },
        },
      });
      for (const surface of [
        result,
        await reopened.inspectRecoveryErrors(),
        await readWatcherLedgerArtifacts(f.repositoryRoot),
      ])
        expect(JSON.stringify(surface)).not.toMatch(
          /private-|submission-secret/,
        );
    },
  );
});

// W044 / FR-047/051/068: traversal failure and cancellation cannot invent
// acceptance or erase a prior admission, and rejected pages contribute no IDs.
describe("admission traversal exits [W044]", () => {
  it.each(["before-initialize", "between-retries"] as const)(
    "does not issue initialization after abort at %s",
    async (boundary) => {
      const f = await fixture();
      const controller = new AbortController();
      f.initializeRecord.mockResolvedValue({
        ok: false,
        error: { kind: "storage", outcome: "indeterminate" },
      });
      const result = await runDevSquadAdoWorkflowWatchPass({
        ...f.input,
        signal: controller.signal,
        ledger: {
          ...f.input.ledger,
          readRecord: async () => {
            if (boundary === "before-initialize") controller.abort();
            return missing();
          },
        },
        delay: (ms, signal) => {
          if (ms === 10) return f.input.delay(ms, signal);
          controller.abort();
          return Promise.resolve();
        },
      });
      expect(result).toMatchObject({
        ok: true,
        value: {
          stopReason: "cancelled",
          signals: [],
          counts: {
            admitted: 0,
            initializationReplayed: 0,
            cleanupNotRequired: 1,
          },
          outcomes: [
            {
              acceptance: {
                kind: boundary === "before-initialize" ? "none" : "unconfirmed",
              },
            },
          ],
        },
      });
      expect(f.initializeRecord).toHaveBeenCalledTimes(
        boundary === "before-initialize" ? 0 : 1,
      );
      expect(f.effect).not.toHaveBeenCalled();
    },
  );

  it.each(["page-failed", "duplicate-item", "unstable-scope"] as const)(
    "retains admission and excludes rejected-page IDs after %s",
    async (reason) => {
      const f = await fixture();
      const result = await runDevSquadAdoWorkflowWatchPass({
        ...f.input,
        seam: {
          ...f.input.seam,
          discoverWorkItemsPage: async (request) => {
            if (request.pageOrdinal === 1)
              return {
                ...request,
                items: [{ workItemId: 999, facts: {} }],
                next: {
                  kind: "continue",
                  continuation: "private-continuation",
                },
              };
            if (reason === "page-failed") throw Error("private-page-failure");
            return {
              ...request,
              binding:
                reason === "unstable-scope"
                  ? { ...request.binding, scopeId: "private-drift" }
                  : request.binding,
              items: [
                { workItemId: 1000, facts: {} },
                { workItemId: 999, facts: {} },
              ],
              next: { kind: "terminal" },
            };
          },
        },
      });
      expect(result).toMatchObject({
        ok: true,
        value: {
          stopReason: "discovery-incomplete",
          traversal: { status: "incomplete", reason, terminalPageSeen: false },
          counts: {
            pageCalls: 2,
            pagesValidated: 1,
            discovered: 1,
            evaluated: 1,
            processed: 1,
            admitted: 1,
            acted: 1,
            cleanupNotRequired: 1,
          },
          outcomes: [{ workItemId: "999", acceptance: { kind: "fresh" } }],
          signals: [{ kind: "discovery-admission", workItemId: "999" }],
        },
      });
      if (!result.ok) throw Error("expected discovery result");
      expect(result.value.outcomes).toHaveLength(1);
      expect(f.initializeRecord).toHaveBeenCalledTimes(1);
      expect(f.effect).not.toHaveBeenCalled();
      for (const surface of [
        result,
        await readWatcherLedgerArtifacts(f.repositoryRoot),
      ])
        expect(JSON.stringify(surface)).not.toMatch(
          /private-|submission-secret/,
        );
    },
  );
});
