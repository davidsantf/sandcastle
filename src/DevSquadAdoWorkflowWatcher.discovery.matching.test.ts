import { afterEach, describe, expect, it, vi } from "vitest";
import { runDevSquadAdoWorkflowWatchPass } from "./index.js";
import type {
  DevSquadAdoDiscoveryFacts,
  DevSquadAdoDiscoveryFilter,
  DevSquadAdoDiscoveryPage,
} from "./index.js";
import { discoveryOptions } from "./DevSquadAdoWorkflowWatcherDiscoveryTestSupport.js";
import {
  cleanupWatcherRepositories,
  createWatcherLedgerFixture,
  seedWatcherRecord,
} from "./DevSquadAdoWorkflowWatcherTestSupport.js";

afterEach(cleanupWatcherRepositories);
const known = <T>(value: T) => ({ kind: "known" as const, value });
const cases: [
  string,
  DevSquadAdoDiscoveryFilter[],
  DevSquadAdoDiscoveryFacts,
  string,
][] = [
  ["unrestricted", [], {}, "matched"],
  [
    "state OR",
    [{ dimension: "state", operator: "one-of", values: ["A", "B"] }],
    { state: known("B") },
    "matched",
  ],
  ...["a", " A", "A ", "Á"].map(
    (
      value,
    ): [
      string,
      DevSquadAdoDiscoveryFilter[],
      DevSquadAdoDiscoveryFacts,
      string,
    ] => [
      "exact state " + value,
      [{ dimension: "state", operator: "one-of", values: ["A"] }],
      { state: known(value) },
      "excluded",
    ],
  ),
  [
    "team OR",
    [{ dimension: "team", operator: "one-of", values: ["A", "B"] }],
    { teams: known(["B", "C"]) },
    "matched",
  ],
  [
    "empty teams",
    [{ dimension: "team", operator: "one-of", values: ["A"] }],
    { teams: known([]) },
    "excluded",
  ],
  [
    "no inferred team",
    [{ dimension: "team", operator: "one-of", values: ["A"] }],
    {},
    "facts-missing",
  ],
  ...(["all", "any", "none"] as const).flatMap(
    (operator) =>
      [
        [
          "tags " + operator,
          [{ dimension: "tags", operator, values: ["A", "B"] }],
          { tags: known(["B"]) },
          operator === "any" ? "matched" : "excluded",
        ],
        [
          "empty tags " + operator,
          [{ dimension: "tags", operator, values: ["A"] }],
          { tags: known([]) },
          operator === "none" ? "matched" : "excluded",
        ],
      ] as typeof cases,
  ),
  ...(["area", "iteration"] as const).flatMap(
    (dimension) =>
      [
        [
          dimension + " exact",
          [{ dimension, operator: "exact", segments: ["A"] }],
          { [dimension]: known(["A"]) },
          "matched",
        ],
        [
          dimension + " descendant exact",
          [{ dimension, operator: "exact", segments: ["A"] }],
          { [dimension]: known(["A", "B"]) },
          "excluded",
        ],
        [
          dimension + " subtree root",
          [{ dimension, operator: "subtree", segments: ["A"] }],
          { [dimension]: known(["A"]) },
          "matched",
        ],
        [
          dimension + " subtree descendant",
          [{ dimension, operator: "subtree", segments: ["A"] }],
          { [dimension]: known(["A", "B"]) },
          "matched",
        ],
        [
          dimension + " sibling",
          [{ dimension, operator: "subtree", segments: ["A"] }],
          { [dimension]: known(["AB"]) },
          "excluded",
        ],
        [
          dimension + " root",
          [{ dimension, operator: "subtree", segments: [] }],
          { [dimension]: known([]) },
          "matched",
        ],
        [
          dimension + " no splitting",
          [{ dimension, operator: "subtree", segments: ["A"] }],
          { [dimension]: known(["A/B"]) },
          "excluded",
        ],
      ] as typeof cases,
  ),
  [
    "AND and missing priority",
    [
      { dimension: "state", operator: "one-of", values: ["A"] },
      { dimension: "tags", operator: "all", values: ["tag"] },
    ],
    { state: known("B"), tags: { kind: "missing" } },
    "facts-missing",
  ],
  [
    "all seven AND",
    [
      { dimension: "iteration", operator: "exact", segments: [] },
      { dimension: "tags", operator: "none", values: ["bad"] },
      { dimension: "tags", operator: "any", values: ["tag"] },
      { dimension: "tags", operator: "all", values: ["tag"] },
      { dimension: "team", operator: "one-of", values: ["team"] },
      { dimension: "area", operator: "subtree", segments: [] },
      { dimension: "state", operator: "one-of", values: ["state"] },
    ],
    {
      state: known("state"),
      teams: known(["team"]),
      tags: known(["tag"]),
      area: known([]),
      iteration: known([]),
    },
    "matched",
  ],
];

describe("whole-page matching [W040 / TEST-034/038]", () => {
  it.each(cases)("%s", async (_name, filters, facts, decision) => {
    const { options, effect } = discoveryOptions();
    const readRecord = vi.fn(async () => ({
      ok: false as const,
      error: { kind: "record-not-found" as const },
    }));
    const result = await runDevSquadAdoWorkflowWatchPass({
      ...options,
      ledger: { ...options.ledger, readRecord },
      discovery: { ...options.discovery, policy: { version: "v", filters } },
      seam: {
        ...options.seam,
        discoverWorkItemsPage: async (request) => ({
          ...request,
          items: [{ workItemId: 137, facts }],
          next: { kind: "terminal" },
        }),
      },
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        stopReason: "completed",
        counts: {
          discovered: 1,
          evaluated: 1,
          paused: decision === "matched" ? 0 : 1,
        },
        outcomes: [
          {
            workItemId: "137",
            matching: { policyVersion: "v", decision },
            cleanup: { status: "not-required" },
          },
        ],
      },
    });
    expect(readRecord).toHaveBeenCalledTimes(decision === "matched" ? 1 : 0);
    expect(effect).not.toHaveBeenCalled();
    if (result.ok) {
      const evidence = (
        result.value.outcomes[0] as unknown as { matching: unknown }
      ).matching;
      expect(JSON.stringify(evidence)).not.toMatch(
        /values|segments|expected|actual/,
      );
      if (_name === "all seven AND")
        expect(evidence).toMatchObject({
          predicates: [
            "state",
            "team",
            "tags-all",
            "tags-any",
            "tags-none",
            "area",
            "iteration",
          ].map((predicate) => ({ predicate, outcome: "matched" })),
        });
    }
  });

  it("does not inspect unused fact getters or custom iterators", async () => {
    const { options } = discoveryOptions();
    const facts = Object.defineProperty({}, "state", {
      get() {
        throw Error("secret");
      },
    });
    const items = [{ workItemId: "137", facts }];
    Object.defineProperty(items, Symbol.iterator, {
      value() {
        throw Error("iterator");
      },
    });
    const result = await runDevSquadAdoWorkflowWatchPass({
      ...options,
      ledger: {
        ...options.ledger,
        readRecord: async () => ({
          ok: false,
          error: { kind: "record-not-found" },
        }),
      },
      seam: {
        ...options.seam,
        discoverWorkItemsPage: async (request) => ({
          ...request,
          items,
          next: { kind: "terminal" },
        }),
      },
    });
    expect(result).toMatchObject({
      ok: true,
      value: { counts: { discovered: 1 }, traversal: { status: "complete" } },
    });
  });

  it.each([
    "malformed",
    "sparse",
    "changing",
    "duplicate",
    "count",
    "fact-count",
    "fact-bytes",
  ])("rejects the entire %s page before item effects", async (variant) => {
    const { options, effect } = discoveryOptions();
    const items: unknown[] = [
      { workItemId: "137", facts: { tags: known(["A"]) } },
      { workItemId: "138", facts: { tags: known(["A"]) } },
    ];
    if (variant === "malformed")
      items[1] = { workItemId: "138", facts: { tags: { kind: "other" } } };
    if (variant === "sparse") delete items[1];
    if (variant === "changing")
      Object.defineProperty(items, 1, {
        get() {
          items.push({});
          return {};
        },
      });
    if (variant === "duplicate")
      items[1] = { workItemId: 137, facts: { tags: known(["A"]) } };
    if (variant === "fact-count")
      items[1] = { workItemId: "138", facts: { tags: known(["A", "B"]) } };
    if (variant === "fact-bytes")
      items[1] = { workItemId: "138", facts: { tags: known(["é"]) } };
    const result = await runDevSquadAdoWorkflowWatchPass({
      ...options,
      discovery: {
        ...options.discovery,
        policy: {
          version: "v",
          filters: [{ dimension: "tags", operator: "all", values: ["A"] }],
        },
        limits: {
          ...options.discovery.limits,
          maxEntriesPerPage: variant === "count" ? 1 : 128,
          maxCollectionValues: 1,
          maxOpaqueValueBytes: 1,
        },
      },
      seam: {
        ...options.seam,
        discoverWorkItemsPage: async (request) => ({
          ...request,
          items: items as DevSquadAdoDiscoveryPage["items"],
          next: { kind: "terminal" },
        }),
      },
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        counts: { discovered: 0, pagesValidated: 0 },
        traversal: {
          status: "incomplete",
          reason: variant === "duplicate" ? "duplicate-item" : "invalid-page",
        },
      },
    });
    expect(effect).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "forwards existing records through fenced checkpoints; intake matches=%s",
    async (admit) => {
      const { options } = discoveryOptions();
      const { ledger } = await createWatcherLedgerFixture(options.clock);
      for (const workItemId of ["137", "138"])
        await seedWatcherRecord(ledger, {
          workItemId,
          phase: "ready",
          status: "open",
          workItemCommentId: "480",
        });
      const calls: string[] = [];
      const result = await runDevSquadAdoWorkflowWatchPass({
        ...options,
        ledger,
        intakeRules: {
          phases: [admit ? "ready" : "other"],
          statuses: ["open"],
        },
        seam: {
          discoverWorkItemsPage: async (request) => ({
            ...request,
            items: [
              { workItemId: 138, facts: {} },
              { workItemId: 137, facts: {} },
            ],
            next: { kind: "terminal" },
          }),
          observeWorkItemComments: async (request) => {
            calls.push(request.workItemId);
            expect(request.sinceCommentId).toBe("480");
            return { kind: "window", commentIds: ["480", "481"] };
          },
        },
      });
      expect(calls).toEqual(["137", "138"]);
      expect(result).toMatchObject({
        ok: true,
        value: {
          counts: {
            acted: admit ? 2 : 0,
            suppressed: admit ? 0 : 2,
            cleanupReleased: 2,
          },
          outcomes: [
            {
              category: "observation",
              workItemId: "137",
              kind: admit ? "acted" : "intake-suppressed",
            },
            { category: "observation", workItemId: "138" },
          ],
        },
      });
      if (result.ok && admit)
        expect(result.value.signals).toMatchObject([
          { kind: "comment-observation" },
          { kind: "comment-observation" },
        ]);
      expect(await ledger.readRecord("137")).toMatchObject({
        ok: true,
        value: {
          observations: { workItemCommentId: "481" },
          activeClaim: null,
        },
      });
    },
  );
});

// W040 / CC-004 and FR-036a: shared claim and stale-anchor protections.
describe("discovery existing-record controls", () => {
  it.each([false, true])(
    "foreign claim and stale acquisition, race=%s",
    async (race) => {
      const { options, effect } = discoveryOptions();
      const { ledger } = await createWatcherLedgerFixture(options.clock);
      await seedWatcherRecord(ledger, {
        workItemId: 137,
        phase: "ready",
        status: "open",
        workItemCommentId: "480",
      });
      const acquireOther = () =>
        ledger.acquireClaim({
          workItemId: 137,
          operationId: "foreign",
          ownerId: "other",
          claimToken: Buffer.alloc(32, 17).toString("base64url"),
          leaseDurationMs: 60000,
        });
      if (!race) expect((await acquireOther()).ok).toBe(true);
      const checkpoint = vi.fn(ledger.checkpoint);
      const result = await runDevSquadAdoWorkflowWatchPass({
        ...options,
        ledger: {
          ...ledger,
          checkpoint,
          acquireClaim: async (input) => {
            const acquired = await acquireOther();
            if (!acquired.ok) throw Error("fixture claim");
            expect(
              (
                await ledger.checkpoint({
                  workItemId: 137,
                  operationId: "racer-write",
                  expected: {
                    revision: acquired.value.record.revision,
                    phase: "ready",
                    status: "open",
                  },
                  authority: {
                    ownerId: acquired.value.outcome.authority.ownerId,
                    claimToken: acquired.value.outcome.authority.claimToken,
                    fencingValue: acquired.value.outcome.authority.fencingValue,
                  },
                  patch: { observations: { workItemCommentId: "482" } },
                })
              ).ok,
            ).toBe(true);
            expect(
              (
                await ledger.releaseClaim({
                  workItemId: 137,
                  operationId: "racer-release",
                  authority: {
                    ownerId: acquired.value.outcome.authority.ownerId,
                    claimToken: acquired.value.outcome.authority.claimToken,
                    fencingValue: acquired.value.outcome.authority.fencingValue,
                  },
                })
              ).ok,
            ).toBe(true);
            return ledger.acquireClaim(input);
          },
        },
        seam: {
          discoverWorkItemsPage: async (request) => ({
            ...request,
            items: [{ workItemId: 137, facts: {} }],
            next: { kind: "terminal" },
          }),
          observeWorkItemComments: race
            ? async () => ({
                kind: "window" as const,
                commentIds: ["480", "481"],
              })
            : effect,
        },
      });
      expect(result).toMatchObject({
        ok: true,
        value: {
          signals: [],
          outcomes: [
            {
              category: "observation",
              reason: race ? "stale-observation" : "claim-conflict",
              cleanup: { status: race ? "released" : "not-required" },
            },
          ],
        },
      });
      expect(effect).not.toHaveBeenCalled();
      expect(checkpoint).not.toHaveBeenCalled();
    },
  );
  it.each([0, 1])(
    "recognizes exact escaped/multibyte page bytes, short by %s",
    async (under) => {
      const { options, effect } = discoveryOptions();
      const filters = [
        {
          dimension: "tags" as const,
          operator: "all" as const,
          values: ['é"'],
        },
      ];
      const items = [{ workItemId: "137", facts: { tags: known(['é"']) } }];
      const page = {
        binding: {
          scopeId: "scope",
          partitionId: "partition",
          stabilityId: "stable",
          policyVersion: "policy-v1",
        },
        traversalId: "x".repeat(64),
        pageOrdinal: 1,
        items,
        next: { kind: "terminal" as const },
      };
      const maxPageBytes = Buffer.byteLength(JSON.stringify(page)) - under;
      const readRecord = vi.fn(async () => ({
        ok: false as const,
        error: { kind: "record-not-found" as const },
      }));
      const result = await runDevSquadAdoWorkflowWatchPass({
        ...options,
        ledger: { ...options.ledger, readRecord },
        discovery: {
          ...options.discovery,
          policy: { ...options.discovery.policy, filters },
          limits: {
            ...options.discovery.limits,
            maxPageBytes,
            maxCollectionValues: 1,
            maxOpaqueValueBytes: 3,
          },
        },
        seam: {
          ...options.seam,
          discoverWorkItemsPage: async (request) => ({
            ...request,
            items,
            next: { kind: "terminal" },
          }),
        },
      });
      expect(result).toMatchObject({
        ok: true,
        value: {
          counts: { discovered: under ? 0 : 1 },
          traversal: { status: under ? "incomplete" : "complete" },
        },
      });
      expect(readRecord).toHaveBeenCalledTimes(under ? 0 : 1);
      expect(effect).not.toHaveBeenCalled();
    },
  );
});
