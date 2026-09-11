import { afterEach, describe, expect, it, vi } from "vitest";
import {
  runDevSquadAdoWorkflowWatchPass,
  validateDevSquadAdoWorkflowWatchPassOptions,
  DEFAULT_DEVSQUAD_ADO_DISCOVERY_LIMITS,
} from "./index.js";
import type {
  DevSquadAdoDiscoveryPage,
  DevSquadAdoDiscoveryPageRequest,
  RunDevSquadAdoDiscoveryWatchPassOptions,
} from "./index.js";
import {
  cleanupWatcherRepositories,
  createWatcherLedgerFixture,
  openWatcherLedger,
  readWatcherLedgerArtifacts,
  seedWatcherRecord,
} from "./DevSquadAdoWorkflowWatcherTestSupport.js";

import { discoveryOptions } from "./DevSquadAdoWorkflowWatcherDiscoveryTestSupport.js";

afterEach(cleanupWatcherRepositories);

// W039 / CC-036 / TEST-038: inclusive fixed and configured processing bounds.
describe("discovery configuration bounds [W039]", () => {
  const ceilings = {
    maxPageCalls: 1000,
    maxItems: 1000,
    maxEntriesPerPage: 1000,
    maxCollectionValues: 1024,
    maxPathSegments: 128,
    maxOpaqueValueBytes: 4096,
    maxContinuationBytes: 16384,
    maxPolicyBytes: 262144,
    maxPageBytes: 4194304,
    maxAuthorizationBytes: 1048576,
  };
  it("exports the approved defaults", () => {
    expect(DEFAULT_DEVSQUAD_ADO_DISCOVERY_LIMITS).toEqual(
      discoveryOptions().options.discovery.limits,
    );
  });
  it.each(Object.entries(ceilings))(
    "accepts exact ceiling and rejects +1/invalid %s before effects",
    async (key, ceiling) => {
      const { options, effect, clock } = discoveryOptions();
      for (const value of [
        ceiling,
        ceiling + 1,
        0,
        -1,
        1.5,
        NaN,
        Infinity,
        undefined,
      ]) {
        const request = {
          ...options,
          discovery: {
            ...options.discovery,
            limits: { ...options.discovery.limits, [key]: value },
          },
        } as RunDevSquadAdoDiscoveryWatchPassOptions;
        expect(validateDevSquadAdoWorkflowWatchPassOptions(request).ok).toBe(
          value === ceiling,
        );
        if (value !== ceiling)
          expect((await runDevSquadAdoWorkflowWatchPass(request)).ok).toBe(
            false,
          );
      }
      expect(effect).not.toHaveBeenCalled();
      expect(clock).not.toHaveBeenCalled();
      expect(options.delay).not.toHaveBeenCalled();
      expect(options.seam.discoverWorkItemsPage).not.toHaveBeenCalled();
    },
  );
  it.each(["scopeId", "partitionId", "stabilityId"])(
    "bounds fixed binding label %s by UTF-8 bytes",
    (key) => {
      const { options } = discoveryOptions();
      for (const [label, valid] of [
        ["é".repeat(128), true],
        ["é".repeat(128) + "x", false],
        ["\ud800", false],
      ] as const) {
        expect(
          validateDevSquadAdoWorkflowWatchPassOptions({
            ...options,
            discovery: {
              ...options.discovery,
              scope: { ...options.discovery.scope, [key]: label },
            },
          }).ok,
        ).toBe(valid);
      }
    },
  );
  it("counts canonical JSON keys, escaping and UTF-8 in policy and authorization aggregates", () => {
    const { options } = discoveryOptions();
    const policy = {
      version: "v",
      filters: [
        {
          dimension: "state" as const,
          operator: "one-of" as const,
          values: ['é"\\'],
        },
      ],
    };
    const authorizations = [
      {
        workItemId: "1",
        kind: "authorized" as const,
        submissionId: "submission",
        initial: { phase: "ready", status: "open" },
      },
    ];
    for (const delta of [0, -1]) {
      const result = validateDevSquadAdoWorkflowWatchPassOptions({
        ...options,
        discovery: {
          ...options.discovery,
          policy,
          authorizations,
          limits: {
            ...options.discovery.limits,
            maxPolicyBytes: Buffer.byteLength(JSON.stringify(policy)) + delta,
            maxAuthorizationBytes:
              Buffer.byteLength(JSON.stringify(authorizations)) + delta,
          },
        },
      });
      expect(result.ok).toBe(delta === 0);
    }
  });
  it.each([
    { filters: [{ dimension: "state", operator: "contains", values: ["a"] }] },
    { filters: [{ dimension: "state", operator: "one-of", values: [] }] },
    {
      filters: [{ dimension: "state", operator: "one-of", values: ["a", "a"] }],
    },
    {
      filters: [
        { dimension: "team", operator: "one-of", values: ["a"] },
        { dimension: "team", operator: "one-of", values: ["b"] },
      ],
    },
    { filters: [{ dimension: "tags", operator: "all", values: ["\udfff"] }] },
  ])(
    "rejects unsupported, empty, duplicate or ill-formed predicates: %j",
    (policy) => {
      const { options, effect, clock } = discoveryOptions();
      expect(
        validateDevSquadAdoWorkflowWatchPassOptions({
          ...options,
          discovery: {
            ...options.discovery,
            policy: { version: "v", ...policy },
          },
        } as RunDevSquadAdoDiscoveryWatchPassOptions).ok,
      ).toBe(false);
      expect(effect).not.toHaveBeenCalled();
      expect(clock).not.toHaveBeenCalled();
    },
  );
  it("rejects duplicate canonical authorizations and missing/oversized authorized state", () => {
    const { options } = discoveryOptions();
    for (const authorizations of [
      [
        { workItemId: 1, kind: "unavailable", reason: "not-authorized" },
        { workItemId: "1", kind: "unavailable", reason: "not-authorized" },
      ],
      [
        {
          workItemId: "1",
          kind: "authorized",
          submissionId: "s",
          initial: { phase: "ready" },
        },
      ],
      [
        {
          workItemId: "1",
          kind: "authorized",
          submissionId: "s".repeat(257),
          initial: { phase: "ready", status: "open" },
        },
      ],
      [
        {
          workItemId: "1",
          kind: "authorized",
          submissionId: "s",
          initial: { phase: "p".repeat(257), status: "open" },
        },
      ],
    ])
      expect(
        validateDevSquadAdoWorkflowWatchPassOptions({
          ...options,
          discovery: { ...options.discovery, authorizations },
        } as RunDevSquadAdoDiscoveryWatchPassOptions).ok,
      ).toBe(false);
  });
  it("bounds collections before traversal and ignores a custom iterator", () => {
    const { options } = discoveryOptions();
    const values = ["a", "b"];
    Object.defineProperty(values, Symbol.iterator, {
      get() {
        throw new Error("iterator must not be read");
      },
    });
    const request = {
      ...options,
      discovery: {
        ...options.discovery,
        policy: {
          version: "v",
          filters: [
            { dimension: "tags" as const, operator: "all" as const, values },
          ],
        },
        limits: { ...options.discovery.limits, maxCollectionValues: 2 },
      },
    };
    expect(validateDevSquadAdoWorkflowWatchPassOptions(request).ok).toBe(true);
    expect(
      validateDevSquadAdoWorkflowWatchPassOptions({
        ...request,
        discovery: {
          ...request.discovery,
          limits: { ...request.discovery.limits, maxCollectionValues: 1 },
        },
      }).ok,
    ).toBe(false);
  });
});

describe("discovery fixed projection boundaries [W039 / TEST-038]", () => {
  it("accepts all seven slots, rejecting an eighth before reading its operands", () => {
    const { options } = discoveryOptions();
    const filters = [
      { dimension: "state", operator: "one-of", values: ["open"] },
      { dimension: "team", operator: "one-of", values: ["host-team"] },
      { dimension: "tags", operator: "all", values: ["a"] },
      { dimension: "tags", operator: "any", values: ["b"] },
      { dimension: "tags", operator: "none", values: ["c"] },
      { dimension: "area", operator: "exact", segments: [] },
      { dimension: "iteration", operator: "subtree", segments: [] },
    ];
    const request = {
      ...options,
      discovery: { ...options.discovery, policy: { version: "v", filters } },
    } as RunDevSquadAdoDiscoveryWatchPassOptions;
    expect(validateDevSquadAdoWorkflowWatchPassOptions(request).ok).toBe(true);
    filters.push({
      dimension: "state",
      operator: "one-of",
      get values(): string[] {
        throw new Error("must not traverse overflow");
      },
    });
    expect(validateDevSquadAdoWorkflowWatchPassOptions(request).ok).toBe(false);
  });

  it("accepts exactly 1000 authorization declarations and rejects 1001", () => {
    const { options } = discoveryOptions();
    const authorizations = Array.from({ length: 1000 }, (_, index) => ({
      workItemId: index + 1,
      kind: "unavailable" as const,
      reason: "not-authorized" as const,
    }));
    const request = {
      ...options,
      discovery: { ...options.discovery, authorizations },
    };
    expect(validateDevSquadAdoWorkflowWatchPassOptions(request).ok).toBe(true);
    authorizations.push({
      workItemId: 1001,
      kind: "unavailable",
      reason: "not-authorized",
    });
    expect(validateDevSquadAdoWorkflowWatchPassOptions(request).ok).toBe(false);
  });

  it("independently enforces policy and authorization aggregate B/B+1", () => {
    const { options } = discoveryOptions();
    const policy = { version: "v", filters: [] };
    const authorizations = [
      {
        workItemId: "1",
        kind: "unavailable" as const,
        reason: "not-authorized" as const,
      },
    ];
    for (const [key, bytes] of [
      ["maxPolicyBytes", Buffer.byteLength(JSON.stringify(policy))],
      [
        "maxAuthorizationBytes",
        Buffer.byteLength(JSON.stringify(authorizations)),
      ],
    ] as const)
      for (const delta of [0, -1]) {
        expect(
          validateDevSquadAdoWorkflowWatchPassOptions({
            ...options,
            discovery: {
              ...options.discovery,
              policy,
              authorizations,
              limits: { ...options.discovery.limits, [key]: bytes + delta },
            },
          }).ok,
        ).toBe(delta === 0);
      }
  });

  it.each(["workItemId", "submissionId", "phase", "status", "version"])(
    "uses the fixed byte limit for %s",
    (field) => {
      const { options } = discoveryOptions();
      const maximum = field === "workItemId" ? 120 : 256;
      for (const delta of [0, 1]) {
        const text = "x".repeat(maximum + delta);
        const authorizations = [
          {
            workItemId: field === "workItemId" ? text : "1",
            kind: "authorized" as const,
            submissionId: field === "submissionId" ? text : "s",
            initial: {
              phase: field === "phase" ? text : "ready",
              status: field === "status" ? text : "open",
            },
          },
        ];
        expect(
          validateDevSquadAdoWorkflowWatchPassOptions({
            ...options,
            discovery: {
              ...options.discovery,
              authorizations,
              policy: {
                version: field === "version" ? text : "v",
                filters: [],
              },
            },
          }).ok,
        ).toBe(delta === 0);
      }
    },
  );

  it("checks exact path and opaque-value limits, without changing whitespace or Unicode", () => {
    const { options } = discoveryOptions();
    for (const [segments, valid] of [
      [["é", " "], true],
      [["é", " ", "x"], false],
      [["éx"], false],
    ] as const) {
      expect(
        validateDevSquadAdoWorkflowWatchPassOptions({
          ...options,
          discovery: {
            ...options.discovery,
            limits: {
              ...options.discovery.limits,
              maxPathSegments: 2,
              maxOpaqueValueBytes: 2,
            },
            policy: {
              version: "v",
              filters: [{ dimension: "area", operator: "exact", segments }],
            },
          },
        }).ok,
      ).toBe(valid);
    }
  });

  it("rejects changing/sparse collections and never enumerates unrelated getters", () => {
    const { options } = discoveryOptions();
    for (const values of [new Array<string>(2), ["a", "b"]]) {
      if (values[0])
        Object.defineProperty(values, "0", {
          get() {
            values.length = 1;
            return "a";
          },
        });
      expect(
        validateDevSquadAdoWorkflowWatchPassOptions({
          ...options,
          discovery: {
            ...options.discovery,
            policy: {
              version: "v",
              filters: [{ dimension: "state", operator: "one-of", values }],
            },
          },
        }).ok,
      ).toBe(false);
    }
    Object.defineProperty(options.discovery, "privatePayload", {
      get() {
        throw new Error("unrelated");
      },
    });
    expect(validateDevSquadAdoWorkflowWatchPassOptions(options).ok).toBe(true);
  });
});

// W043 / TEST-036-039 / CC-034-037: public-pass traversal over real ledger state.
const traversalFixture = async () => {
  const { options } = discoveryOptions();
  // The watcher clock must be counted independently of ledger operation clocks.
  const real = await createWatcherLedgerFixture(
    () => new Date("2026-09-10T00:00:00.000Z"),
  );
  for (const workItemId of [137, 138])
    await seedWatcherRecord(real.ledger, {
      workItemId,
      phase: "ready",
      status: "open",
      workItemCommentId: "480",
    });
  const events: string[] = [];
  const tracked = {
    ...real.ledger,
    readRecord: vi.fn(real.ledger.readRecord),
    acquireClaim: vi.fn(real.ledger.acquireClaim),
    renewClaim: vi.fn(real.ledger.renewClaim),
    releaseClaim: vi.fn(real.ledger.releaseClaim),
    checkpoint: vi.fn(real.ledger.checkpoint),
  };
  const clock = vi.fn(() => {
    events.push("clock");
    return new Date("2026-09-10T00:00:00.000Z");
  });
  const delay = vi.fn((ms: number, signal?: AbortSignal) => {
    if (ms === options.budgets.observationTimeoutMs)
      return options.delay(ms, signal);
    events.push(`delay:${ms}`);
    return Promise.resolve();
  });
  const comments = vi.fn(async ({ workItemId }: { workItemId: string }) => {
    events.push(`observe:${workItemId}`);
    return { kind: "window" as const, commentIds: ["480", "481"] };
  });
  const input: RunDevSquadAdoDiscoveryWatchPassOptions = {
    ...options,
    ledger: tracked,
    clock,
    delay,
    backoff: { baseIntervalMs: 20, multiplier: 2, maxIntervalMs: 80 },
    seam: { ...options.seam, observeWorkItemComments: comments },
  };
  return { input, ...real, tracked, clock, delay, events, comments };
};
const page = (
  request: DevSquadAdoDiscoveryPageRequest,
  ids: readonly (string | number)[],
  continuation: string | null = null,
): DevSquadAdoDiscoveryPage => ({
  binding: request.binding,
  traversalId: request.traversalId,
  pageOrdinal: request.pageOrdinal,
  items: ids.map((workItemId) => ({ workItemId, facts: {} })),
  next:
    continuation === null
      ? { kind: "terminal" }
      : { kind: "continue", continuation },
});

describe("retained discovery scheduling [W043]", () => {
  it("retries in first-discovery order before one new page per poll, retaining checkpoint identity and authority", async () => {
    const f = await traversalFixture();
    const attempts = new Map<string, number>();
    f.tracked.checkpoint.mockImplementation(async (request) => {
      const id = String(request.workItemId);
      f.events.push(`checkpoint:${id}`);
      const attempt = (attempts.get(id) ?? 0) + 1;
      attempts.set(id, attempt);
      return attempt <= 2
        ? { ok: false, error: { kind: "contention", attempts: 32 } }
        : f.ledger.checkpoint(request);
    });
    const discover = vi.fn(async (request: DevSquadAdoDiscoveryPageRequest) => {
      f.events.push(`page:${request.pageOrdinal}`);
      return page(
        request,
        request.pageOrdinal === 1
          ? [138]
          : request.pageOrdinal === 2
            ? [137]
            : [],
        request.pageOrdinal < 3 ? `opaque-${request.pageOrdinal}` : null,
      );
    });
    const result = await runDevSquadAdoWorkflowWatchPass({
      ...f.input,
      seam: { ...f.input.seam, discoverWorkItemsPage: discover },
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        polls: 4,
        traversal: { status: "complete", terminalPageSeen: true },
        counts: { pageCalls: 3, acted: 2, cleanupReleased: 2 },
        outcomes: [
          { workItemId: "138", kind: "acted" },
          { workItemId: "137", kind: "acted" },
        ],
      },
    });
    expect(f.events).toEqual([
      "clock",
      "clock",
      "page:1",
      "observe:138",
      "checkpoint:138",
      "delay:20",
      "clock",
      "checkpoint:138",
      "page:2",
      "observe:137",
      "checkpoint:137",
      "delay:40",
      "clock",
      "checkpoint:138",
      "checkpoint:137",
      "page:3",
      "delay:80",
      "clock",
      "checkpoint:137",
    ]);
    expect(f.clock).toHaveBeenCalledTimes(5);
    expect(f.comments).toHaveBeenCalledTimes(2);
    expect(f.tracked.acquireClaim).toHaveBeenCalledTimes(2);
    expect(f.tracked.releaseClaim).toHaveBeenCalledTimes(2);
    for (const id of ["137", "138"]) {
      const submissions = f.tracked.checkpoint.mock.calls
        .map(([r]) => r)
        .filter((r) => r.workItemId === id);
      expect(submissions).toHaveLength(3);
      expect(submissions[1]).toEqual(submissions[0]);
      expect(submissions[2]).toEqual(submissions[0]);
      expect(await f.ledger.readRecord(id)).toMatchObject({
        ok: true,
        value: {
          activeClaim: null,
          observations: { workItemCommentId: "481" },
        },
      });
    }
  });

  it.each([1, 2])(
    "terminal evidence cannot discard a genuine retry; maxPolls=%s",
    async (maxPolls) => {
      const f = await traversalFixture();
      f.tracked.checkpoint.mockResolvedValue({
        ok: false,
        error: { kind: "contention", attempts: 32 },
      });
      const discover = vi.fn(async (r: DevSquadAdoDiscoveryPageRequest) =>
        page(r, [137]),
      );
      const result = await runDevSquadAdoWorkflowWatchPass({
        ...f.input,
        budgets: { ...f.input.budgets, maxPolls },
        seam: { ...f.input.seam, discoverWorkItemsPage: discover },
      });
      expect(result).toMatchObject({
        ok: true,
        value: {
          polls: maxPolls,
          stopReason: "poll-budget-exhausted",
          traversal: {
            status: "incomplete",
            reason: "poll-budget-exhausted",
            terminalPageSeen: true,
          },
          signals: [],
          counts: { pageCalls: 1, failed: 1, cleanupReleased: 1 },
          outcomes: [{ reason: "checkpoint-indeterminate" }],
        },
      });
      expect(f.tracked.checkpoint).toHaveBeenCalledTimes(maxPolls);
      expect(f.tracked.releaseClaim).toHaveBeenCalledTimes(1);
      expect(discover).toHaveBeenCalledTimes(1);
    },
  );

  it("recovers an ambiguous durable checkpoint from original-submission history without observing or writing again", async () => {
    const f = await traversalFixture();
    const accepted: boolean[] = [];
    f.tracked.checkpoint.mockImplementation(async (request) => {
      const result = await f.ledger.checkpoint(request);
      accepted.push(result.ok);
      return {
        ok: false,
        error: { kind: "storage", outcome: "indeterminate" },
      };
    });
    const result = await runDevSquadAdoWorkflowWatchPass({
      ...f.input,
      seam: {
        ...f.input.seam,
        discoverWorkItemsPage: async (r) => page(r, [137]),
      },
    });
    expect(accepted).toEqual([true]);
    expect(result).toMatchObject({
      ok: true,
      value: {
        polls: 2,
        counts: { acted: 1, cleanupReleased: 1 },
        traversal: { status: "complete" },
        signals: [{ kind: "comment-observation", workItemId: "137" }],
      },
    });
    expect(f.comments).toHaveBeenCalledTimes(1);
    expect(f.tracked.checkpoint).toHaveBeenCalledTimes(1);
    expect(f.tracked.releaseClaim).toHaveBeenCalledTimes(1);
  });

  it("keeps quiet candidates pending until terminal evidence, then finalizes without an extra poll", async () => {
    const f = await traversalFixture();
    f.comments.mockResolvedValue({ kind: "window", commentIds: [] });
    const result = await runDevSquadAdoWorkflowWatchPass({
      ...f.input,
      seam: {
        ...f.input.seam,
        discoverWorkItemsPage: async (r) =>
          page(
            r,
            r.pageOrdinal === 1 ? [138, 137] : [],
            r.pageOrdinal < 3 ? `token-${r.pageOrdinal}` : null,
          ),
      },
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        polls: 3,
        traversal: { status: "complete" },
        counts: { pageCalls: 3, noChange: 2 },
        outcomes: [
          { workItemId: "137", reason: "no-new-observations" },
          { workItemId: "138", reason: "no-new-observations" },
        ],
      },
    });
    expect(f.comments.mock.calls.map(([r]) => r.workItemId)).toEqual([
      "137",
      "138",
      "137",
      "138",
      "137",
      "138",
    ]);
    expect(f.tracked.acquireClaim).not.toHaveBeenCalled();
  });

  it("rejects remaining-item overflow before reading the current page's entries", async () => {
    const { options, effect } = discoveryOptions();
    const entry = vi.fn(() => ({ workItemId: "138", facts: {} }));
    const items = Object.defineProperty([{ workItemId: "138", facts: {} }], 0, {
      get: entry,
    });
    const result = await runDevSquadAdoWorkflowWatchPass({
      ...options,
      delay: (ms, signal) =>
        ms === 10 ? options.delay(ms, signal) : Promise.resolve(),
      ledger: {
        ...options.ledger,
        readRecord: async () => ({
          ok: false,
          error: { kind: "record-not-found" },
        }),
      },
      discovery: {
        ...options.discovery,
        limits: { ...options.discovery.limits, maxItems: 1 },
      },
      seam: {
        ...options.seam,
        discoverWorkItemsPage: async (r) =>
          r.pageOrdinal === 1
            ? page(r, [137], "next")
            : {
                ...page(r, []),
                items: items as DevSquadAdoDiscoveryPage["items"],
              },
      },
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        counts: { discovered: 1, pageCalls: 2 },
        traversal: { status: "incomplete", reason: "item-budget-exhausted" },
      },
    });
    expect(entry).not.toHaveBeenCalled();
    expect(effect).not.toHaveBeenCalled();
  });
});

// Empty/missing-record seams keep large bounds tests offline without filesystem cost.
const boundedOptions = (): RunDevSquadAdoDiscoveryWatchPassOptions => {
  const { options } = discoveryOptions();
  return {
    ...options,
    delay: (ms, signal) =>
      ms === 10 ? options.delay(ms, signal) : Promise.resolve(),
    ledger: {
      ...options.ledger,
      readRecord: vi.fn(async () => ({
        ok: false as const,
        error: { kind: "record-not-found" as const },
      })),
    },
  };
};

describe("multi-page traversal and restart [W043]", () => {
  it.each([true, false])(
    "counts an empty continued page and final permitted call; terminal=%s",
    async (terminal) => {
      const f = await traversalFixture();
      const requests: DevSquadAdoDiscoveryPageRequest[] = [];
      const result = await runDevSquadAdoWorkflowWatchPass({
        ...f.input,
        discovery: {
          ...f.input.discovery,
          limits: { ...f.input.discovery.limits, maxPageCalls: 2 },
        },
        seam: {
          ...f.input.seam,
          discoverWorkItemsPage: async (r) => {
            requests.push(r);
            return page(
              r,
              r.pageOrdinal === 1 ? [] : [137],
              r.pageOrdinal === 1
                ? 'opaque / \u00e9"\\'
                : terminal
                  ? null
                  : "unfinished",
            );
          },
        },
      });
      expect(result).toMatchObject({
        ok: true,
        value: {
          polls: 2,
          counts: { pageCalls: 2, pagesValidated: 2, acted: 1 },
          traversal: {
            status: terminal ? "complete" : "incomplete",
            reason: terminal ? "terminal-page" : "page-budget-exhausted",
          },
        },
      });
      expect(requests.map((r) => [r.pageOrdinal, r.continuation])).toEqual([
        [1, null],
        [2, 'opaque / \u00e9"\\'],
      ]);
      expect(new Set(requests.map((r) => r.traversalId)).size).toBe(1);
      expect(f.clock).toHaveBeenCalledTimes(3);
    },
  );

  it("reopens a real ledger and starts ordinal one/null, without durable tokens or duplicate comment intake", async () => {
    const f = await traversalFixture();
    const requests: DevSquadAdoDiscoveryPageRequest[] = [];
    const discover = async (r: DevSquadAdoDiscoveryPageRequest) => {
      requests.push(r);
      return page(
        r,
        r.pageOrdinal === 1 ? [137] : r.pageOrdinal === 2 ? [] : [138],
        r.pageOrdinal < 3 ? `private-continuation-${r.pageOrdinal}` : null,
      );
    };
    const input = {
      ...f.input,
      seam: { ...f.input.seam, discoverWorkItemsPage: discover },
    };
    const first = await runDevSquadAdoWorkflowWatchPass(input);
    expect(first).toMatchObject({
      ok: true,
      value: {
        polls: 3,
        counts: { pageCalls: 3, acted: 2 },
        traversal: { status: "complete" },
        outcomes: [{ workItemId: "137" }, { workItemId: "138" }],
      },
    });
    const before = await readWatcherLedgerArtifacts(f.repositoryRoot);
    const reopened = await openWatcherLedger(
      f.repositoryRoot,
      () => new Date("2026-09-10T00:00:00.000Z"),
    );
    const second = await runDevSquadAdoWorkflowWatchPass({
      ...input,
      ledger: reopened,
      passId: "reopened",
    });
    expect(second).toMatchObject({
      ok: true,
      value: {
        polls: 3,
        signals: [],
        counts: { pageCalls: 3, acted: 0 },
        traversal: { status: "complete" },
      },
    });
    expect(requests.map((r) => [r.pageOrdinal, r.continuation])).toEqual([
      [1, null],
      [2, "private-continuation-1"],
      [3, "private-continuation-2"],
      [1, null],
      [2, "private-continuation-1"],
      [3, "private-continuation-2"],
    ]);
    expect(requests[0]!.traversalId).not.toBe(requests[3]!.traversalId);
    expect(await readWatcherLedgerArtifacts(f.repositoryRoot)).toEqual(before);
    const persisted = JSON.stringify(before);
    for (const forbidden of [
      "private-continuation",
      "traversalId",
      "pageOrdinal",
      requests[0]!.traversalId,
      requests[3]!.traversalId,
    ])
      expect(persisted).not.toContain(forbidden);
    expect(JSON.stringify([first, second])).not.toContain(
      "private-continuation",
    );
  });

  it.each(["failed", "timeout"] as const)(
    "counts a %s page invocation once, preserving earlier acknowledged intake",
    async (kind) => {
      const f = await traversalFixture();
      const discover = vi.fn(async (r: DevSquadAdoDiscoveryPageRequest) => {
        if (r.pageOrdinal === 1) return page(r, [137], "next");
        if (kind === "failed") throw Error("private adapter error");
        return new Promise<DevSquadAdoDiscoveryPage>(() => {});
      });
      let timer = 0;
      const result = await runDevSquadAdoWorkflowWatchPass({
        ...f.input,
        delay: (ms, signal) => {
          // Page one, item observation, then page two: deterministic timeout only there.
          if (ms === 10 && ++timer === 3) return Promise.resolve();
          return f.input.delay(ms, signal);
        },
        seam: { ...f.input.seam, discoverWorkItemsPage: discover },
      });
      expect(result).toMatchObject({
        ok: true,
        value: {
          polls: 2,
          counts: { pageCalls: 2, pagesValidated: 1, acted: 1 },
          traversal: {
            status: "incomplete",
            reason: kind === "failed" ? "page-failed" : "page-timeout",
          },
        },
      });
      expect(discover).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(result)).not.toContain("private adapter error");
    },
  );

  it.each([
    "duplicate-within",
    "duplicate-across",
    "continuation-repeat",
    "continuation-cycle",
    "scopeId",
    "partitionId",
    "stabilityId",
    "policyVersion",
    "traversalId",
    "pageOrdinal",
    "empty-token",
    "bad-next",
    "malformed-last",
    "changing-items",
    "remaining-overflow",
  ])(
    "rejects the whole %s page, preserving earlier accepted writes",
    async (variant) => {
      const f = await traversalFixture();
      const discover = vi.fn(
        async (
          r: DevSquadAdoDiscoveryPageRequest,
        ): Promise<DevSquadAdoDiscoveryPage> => {
          if (r.pageOrdinal === 1) return page(r, [137], "token-a");
          if (variant === "continuation-cycle" && r.pageOrdinal === 2)
            return page(r, [], "token-b");
          const response = page(r, [138, "139"]);
          if (variant === "duplicate-within") return page(r, [138, "138"]);
          if (variant === "duplicate-across") return page(r, [138, "137"]);
          if (variant.startsWith("continuation-"))
            return page(r, [138], "token-a");
          if (
            ["scopeId", "partitionId", "stabilityId", "policyVersion"].includes(
              variant,
            )
          )
            return {
              ...response,
              binding: { ...r.binding, [variant]: "drift" },
            };
          if (variant === "traversalId")
            return { ...response, traversalId: "wrong" };
          if (variant === "pageOrdinal") return { ...response, pageOrdinal: 1 };
          if (variant === "empty-token") return page(r, [138], "");
          if (variant === "bad-next")
            return {
              ...response,
              next: { kind: "unknown" },
            } as unknown as DevSquadAdoDiscoveryPage;
          if (variant === "malformed-last")
            return {
              ...response,
              items: [response.items[0]!, { workItemId: "139", facts: null }],
            } as unknown as DevSquadAdoDiscoveryPage;
          if (variant === "changing-items") {
            const items = [...response.items];
            Object.defineProperty(items, 1, {
              get() {
                items.pop();
                return { workItemId: "139", facts: {} };
              },
            });
            return { ...response, items };
          }
          return response;
        },
      );
      const result = await runDevSquadAdoWorkflowWatchPass({
        ...f.input,
        discovery: {
          ...f.input.discovery,
          limits: {
            ...f.input.discovery.limits,
            maxItems: variant === "remaining-overflow" ? 2 : 1000,
          },
        },
        seam: { ...f.input.seam, discoverWorkItemsPage: discover },
      });
      const reason = variant.startsWith("duplicate-")
        ? "duplicate-item"
        : variant.startsWith("continuation-")
          ? "repeated-continuation"
          : ["scopeId", "partitionId", "stabilityId", "policyVersion"].includes(
                variant,
              )
            ? "unstable-scope"
            : variant === "remaining-overflow"
              ? "item-budget-exhausted"
              : "invalid-page";
      expect(result).toMatchObject({
        ok: true,
        value: {
          counts: {
            discovered: 1,
            acted: 1,
            pageCalls: variant === "continuation-cycle" ? 3 : 2,
          },
          traversal: { status: "incomplete", reason },
          signals: [{ kind: "comment-observation", workItemId: "137" }],
          outcomes: [{ workItemId: "137", kind: "acted" }],
        },
      });
      expect(f.comments).toHaveBeenCalledTimes(1);
      expect(f.tracked.readRecord.mock.calls.map(([id]) => id)).toEqual([
        "137",
      ]);
      expect(f.tracked.checkpoint).toHaveBeenCalledTimes(1);
      expect(await f.ledger.readRecord("138")).toMatchObject({
        ok: true,
        value: {
          observations: { workItemCommentId: "480" },
          activeClaim: null,
        },
      });
    },
  );

  it.each([false, true])(
    "allows empty tail pages at exactly 1000 items; extra item=%s",
    async (overflow) => {
      const input = boundedOptions();
      const result = await runDevSquadAdoWorkflowWatchPass({
        ...input,
        discovery: {
          ...input.discovery,
          limits: { ...input.discovery.limits, maxEntriesPerPage: 1000 },
        },
        seam: {
          ...input.seam,
          discoverWorkItemsPage: async (r) =>
            page(
              r,
              r.pageOrdinal === 1
                ? Array.from({ length: 1000 }, (_, n) => n + 1)
                : overflow
                  ? [1001]
                  : [],
              r.pageOrdinal < 3 ? `next-${r.pageOrdinal}` : null,
            ),
        },
      });
      expect(result).toMatchObject({
        ok: true,
        value: {
          counts: { discovered: 1000, pageCalls: overflow ? 2 : 3 },
          traversal: {
            status: overflow ? "incomplete" : "complete",
            reason: overflow ? "item-budget-exhausted" : "terminal-page",
          },
        },
      });
      expect(input.ledger.readRecord).toHaveBeenCalledTimes(1000);
    },
  );

  it.each([true, false])(
    "honors the 1000-call ceiling including empty pages; terminal=%s",
    async (terminal) => {
      const input = boundedOptions();
      const discover = vi.fn(async (r: DevSquadAdoDiscoveryPageRequest) =>
        page(
          r,
          [],
          terminal && r.pageOrdinal === 1000 ? null : `next-${r.pageOrdinal}`,
        ),
      );
      const result = await runDevSquadAdoWorkflowWatchPass({
        ...input,
        budgets: { ...input.budgets, maxPolls: 1001 },
        discovery: {
          ...input.discovery,
          limits: { ...input.discovery.limits, maxPageCalls: 1000 },
        },
        seam: { ...input.seam, discoverWorkItemsPage: discover },
      });
      expect(result).toMatchObject({
        ok: true,
        value: {
          polls: 1000,
          counts: { pageCalls: 1000 },
          traversal: {
            status: terminal ? "complete" : "incomplete",
            reason: terminal ? "terminal-page" : "page-budget-exhausted",
          },
        },
      });
      expect(discover).toHaveBeenCalledTimes(1000);
      expect(input.clock).toHaveBeenCalledTimes(1001);
    },
  );

  it("uses poll-start elapsed time and never starts a page at the elapsed boundary", async () => {
    const input = boundedOptions();
    let tick = 0;
    const discover = vi.fn(async (r: DevSquadAdoDiscoveryPageRequest) =>
      page(r, [], "next"),
    );
    const clock = vi.fn(
      () => new Date(Date.UTC(2026, 8, 10) + [0, 0, 1000][tick++]!),
    );
    const result = await runDevSquadAdoWorkflowWatchPass({
      ...input,
      clock,
      seam: { ...input.seam, discoverWorkItemsPage: discover },
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        polls: 1,
        counts: { pageCalls: 1 },
        traversal: { reason: "poll-start-budget-exhausted" },
      },
    });
    expect(clock).toHaveBeenCalledTimes(3);
    expect(discover).toHaveBeenCalledTimes(1);
  });
});

// Construct exact canonical JSON boundaries, independently of the production meter.
// Each retained scalar is bounded; only the tests serialize the full payload.
const fillJsonValues = (
  object: unknown,
  values: string[],
  target: number,
): void => {
  let remaining = target - Buffer.byteLength(JSON.stringify(object));
  while (remaining > 0) {
    const overhead = values.length === 0 ? 2 : 3;
    let size = Math.min(4096, remaining - overhead);
    // Leave enough room for the last array element's punctuation.
    if (remaining - overhead - size > 0 && remaining - overhead - size < 4)
      size -= 4;
    values.push(String(values.length).padEnd(size, "x"));
    remaining -= size + overhead;
  }
  expect(Buffer.byteLength(JSON.stringify(object))).toBe(target);
};

describe("conjunctive numeric and byte boundaries [W043 / CC-036]", () => {
  it.each([0, 1])(
    "enforces the 1000 entries-per-page ceiling before effects, delta=%s",
    async (delta) => {
      const input = boundedOptions();
      const items = Array.from({ length: 1000 + delta }, (_, n) => ({
        workItemId: n + 1,
        facts: {},
      }));
      const result = await runDevSquadAdoWorkflowWatchPass({
        ...input,
        discovery: {
          ...input.discovery,
          limits: { ...input.discovery.limits, maxEntriesPerPage: 1000 },
        },
        seam: {
          ...input.seam,
          discoverWorkItemsPage: async (r) => ({ ...page(r, []), items }),
        },
      });
      expect(result).toMatchObject({
        ok: true,
        value: {
          counts: { discovered: delta === 0 ? 1000 : 0 },
          traversal: {
            status: delta === 0 ? "complete" : "incomplete",
            reason: delta === 0 ? "terminal-page" : "invalid-page",
          },
        },
      });
      expect(input.ledger.readRecord).toHaveBeenCalledTimes(
        delta === 0 ? 1000 : 0,
      );
    },
  );

  it.each(["collection", "path", "opaque", "continuation"] as const)(
    "enforces actual %s ceiling and +1 with multibyte values",
    async (kind) => {
      for (const delta of [0, 1]) {
        const input = boundedOptions();
        const value = "\u00e9".repeat(2048) + "x".repeat(delta);
        const result = await runDevSquadAdoWorkflowWatchPass({
          ...input,
          discovery: {
            ...input.discovery,
            limits: {
              ...input.discovery.limits,
              maxCollectionValues: 1024,
              maxPathSegments: 128,
              maxOpaqueValueBytes: 4096,
              maxContinuationBytes: 16384,
            },
            policy: {
              version: "v",
              filters:
                kind === "collection"
                  ? [
                      {
                        dimension: "tags",
                        operator: "none",
                        values: ["excluded"],
                      },
                    ]
                  : kind === "path"
                    ? [{ dimension: "area", operator: "subtree", segments: [] }]
                    : kind === "opaque"
                      ? [
                          {
                            dimension: "state",
                            operator: "one-of",
                            values: ["excluded"],
                          },
                        ]
                      : [],
            },
          },
          seam: {
            ...input.seam,
            discoverWorkItemsPage: async (r) => {
              if (kind === "continuation")
                return page(
                  r,
                  [],
                  r.pageOrdinal === 1
                    ? "\u00e9".repeat(8192) + "x".repeat(delta)
                    : null,
                );
              return {
                ...page(r, []),
                items: [
                  {
                    workItemId: 137,
                    facts:
                      kind === "collection"
                        ? {
                            tags: {
                              kind: "known",
                              value: Array.from(
                                { length: 1024 + delta },
                                (_, n) => String(n),
                              ),
                            },
                          }
                        : kind === "path"
                          ? {
                              area: {
                                kind: "known",
                                value: Array(128 + delta).fill("\u00e9"),
                              },
                            }
                          : { state: { kind: "known", value } },
                  },
                ],
              };
            },
          },
        });
        expect(result).toMatchObject({
          ok: true,
          value: {
            traversal: {
              status: delta === 0 ? "complete" : "incomplete",
              reason: delta === 0 ? "terminal-page" : "invalid-page",
            },
            counts: {
              pagesValidated:
                delta === 0 ? (kind === "continuation" ? 2 : 1) : 0,
            },
          },
        });
        if (delta) expect(input.ledger.readRecord).not.toHaveBeenCalled();
      }
    },
  );

  it.each(["collection", "path", "opaque"] as const)(
    "enforces actual policy %s ceiling and +1 before calls",
    async (kind) => {
      for (const delta of [0, 1]) {
        const input = boundedOptions();
        const result = await runDevSquadAdoWorkflowWatchPass({
          ...input,
          discovery: {
            ...input.discovery,
            limits: {
              ...input.discovery.limits,
              maxCollectionValues: 1024,
              maxPathSegments: 128,
              maxOpaqueValueBytes: 4096,
            },
            policy: {
              version: "v",
              filters:
                kind === "path"
                  ? [
                      {
                        dimension: "area",
                        operator: "exact",
                        segments: Array(128 + delta).fill("\u00e9"),
                      },
                    ]
                  : [
                      {
                        dimension: "state",
                        operator: "one-of",
                        values:
                          kind === "collection"
                            ? Array.from({ length: 1024 + delta }, (_, n) =>
                                String(n),
                              )
                            : ["\u00e9".repeat(2048) + "x".repeat(delta)],
                      },
                    ],
            },
          },
        });
        expect(result.ok).toBe(delta === 0);
        expect(input.clock).toHaveBeenCalledTimes(delta === 0 ? 2 : 0);
        expect(input.ledger.readRecord).not.toHaveBeenCalled();
      }
    },
  );

  it.each(["policy", "page", "authorization"] as const)(
    "enforces the exact aggregate %s ceiling and one extra encoded byte",
    async (kind) => {
      for (const delta of [0, 1]) {
        const input = boundedOptions();
        const values: string[] = [];
        const policy = {
          version: "v",
          filters: [
            {
              dimension: "state" as const,
              operator: "one-of" as const,
              values,
            },
          ],
        };
        const facts = { tags: { kind: "known" as const, value: values } };
        const prototype = {
          binding: {
            scopeId: "scope",
            partitionId: "partition",
            stabilityId: "stable",
            policyVersion: "v",
          },
          traversalId: "x".repeat(64),
          pageOrdinal: 1,
          items: [{ workItemId: "137", facts }],
          next: { kind: "terminal" as const },
        };
        const authorizations = Array.from({ length: 1000 }, (_, n) => ({
          workItemId: String(n + 1),
          kind: "authorized" as const,
          submissionId: "s",
          initial: { phase: "ready", status: "open" },
        }));
        if (kind === "policy") fillJsonValues(policy, values, 262144 + delta);
        if (kind === "page") fillJsonValues(prototype, values, 4194304 + delta);
        if (kind === "authorization") {
          let remaining =
            1048576 + delta - Buffer.byteLength(JSON.stringify(authorizations));
          for (const entry of authorizations) {
            const escapes = Math.min(255, Math.floor(remaining / 6));
            entry.submissionId += "\u0001".repeat(escapes);
            remaining -= escapes * 6;
            const plain = Math.min(remaining, 256 - entry.submissionId.length);
            entry.submissionId += "x".repeat(plain);
            remaining -= plain;
          }
          expect(remaining).toBe(0);
          expect(Buffer.byteLength(JSON.stringify(authorizations))).toBe(
            1048576 + delta,
          );
        }
        const result = await runDevSquadAdoWorkflowWatchPass({
          ...input,
          discovery: {
            ...input.discovery,
            limits: {
              ...input.discovery.limits,
              maxCollectionValues: 1024,
              maxOpaqueValueBytes: 4096,
              maxPolicyBytes: 262144,
              maxPageBytes: 4194304,
              maxAuthorizationBytes: 1048576,
            },
            policy:
              kind === "policy"
                ? policy
                : {
                    version: "v",
                    filters:
                      kind === "page"
                        ? [
                            {
                              dimension: "tags",
                              operator: "none",
                              values: ["excluded"],
                            },
                          ]
                        : [],
                  },
            ...(kind === "authorization" ? { authorizations } : {}),
          },
          seam: {
            ...input.seam,
            discoverWorkItemsPage: async (r) =>
              kind === "page"
                ? {
                    ...prototype,
                    binding: r.binding,
                    traversalId: r.traversalId,
                  }
                : page(r, []),
          },
        });
        if (kind === "page")
          expect(result).toMatchObject({
            ok: true,
            value: {
              traversal: { status: delta === 0 ? "complete" : "incomplete" },
              counts: { discovered: delta === 0 ? 1 : 0 },
            },
          });
        else expect(result.ok).toBe(delta === 0);
        if (delta) expect(input.ledger.readRecord).not.toHaveBeenCalled();
      }
    },
  );

  it.each([0, 1])(
    "counts required facts, metadata, escaping and continuation in page B/B+1, delta=%s",
    async (delta) => {
      const input = boundedOptions();
      const prototype = {
        binding: {
          scopeId: "scope",
          partitionId: "partition",
          stabilityId: "stable",
          policyVersion: "v",
        },
        traversalId: "x".repeat(64),
        pageOrdinal: 1,
        items: [
          {
            workItemId: "137",
            facts: { state: { kind: "known" as const, value: '\u00e9"\\\n' } },
          },
        ],
        next: { kind: "continue" as const, continuation: '\u00e9"\\' },
      };
      const bytes = Buffer.byteLength(JSON.stringify(prototype));
      const result = await runDevSquadAdoWorkflowWatchPass({
        ...input,
        discovery: {
          ...input.discovery,
          policy: {
            version: "v",
            filters: [
              { dimension: "state", operator: "one-of", values: ["excluded"] },
            ],
          },
          limits: { ...input.discovery.limits, maxPageBytes: bytes - delta },
        },
        seam: {
          ...input.seam,
          discoverWorkItemsPage: async (r) =>
            r.pageOrdinal === 1
              ? { ...prototype, binding: r.binding, traversalId: r.traversalId }
              : page(r, []),
        },
      });
      expect(result).toMatchObject({
        ok: true,
        value: {
          counts: {
            discovered: delta === 0 ? 1 : 0,
            pageCalls: delta === 0 ? 2 : 1,
          },
          traversal: { status: delta === 0 ? "complete" : "incomplete" },
        },
      });
      expect(input.ledger.readRecord).not.toHaveBeenCalled();
    },
  );

  it.each(["items", "facts"] as const)(
    "rejects a changing %s array or malformed last entry without accepting its valid prefix",
    async (field) => {
      for (const changing of [true, false]) {
        const input = boundedOptions();
        const tags: unknown[] = ["a", "b"];
        const items: unknown[] = [
          { workItemId: 137, facts: { tags: { kind: "known", value: tags } } },
          { workItemId: 138, facts: {} },
        ];
        const array = field === "items" ? items : tags;
        if (changing)
          Object.defineProperty(array, 1, {
            get() {
              array.push("unexpected");
              return field === "items" ? { workItemId: 138, facts: {} } : "b";
            },
          });
        else array[1] = null;
        const result = await runDevSquadAdoWorkflowWatchPass({
          ...input,
          discovery: {
            ...input.discovery,
            policy: {
              version: "v",
              filters: [
                { dimension: "tags", operator: "none", values: ["excluded"] },
              ],
            },
          },
          seam: {
            ...input.seam,
            discoverWorkItemsPage: async (r) => ({
              ...page(r, []),
              items: items as DevSquadAdoDiscoveryPage["items"],
            }),
          },
        });
        expect(result).toMatchObject({
          ok: true,
          value: {
            counts: { discovered: 0 },
            traversal: { reason: "invalid-page" },
          },
        });
        expect(input.ledger.readRecord).not.toHaveBeenCalled();
      }
    },
  );
});

describe("terminal observation disposition [W043]", () => {
  it.each([true, false])(
    "a released stale observation is not pending mutation recovery; terminal=%s",
    async (terminal) => {
      const f = await traversalFixture();
      const publications: boolean[] = [];
      f.tracked.acquireClaim.mockImplementation(async (request) => {
        const other = await f.ledger.acquireClaim({
          workItemId: 137,
          operationId: "foreign-claim",
          ownerId: "other",
          claimToken: Buffer.alloc(32, 17).toString("base64url"),
          leaseDurationMs: 60000,
        });
        if (!other.ok) throw Error("fixture claim");
        const acquiredAuthority = other.value.outcome.authority;
        const authority = {
          ownerId: acquiredAuthority.ownerId,
          claimToken: acquiredAuthority.claimToken,
          fencingValue: acquiredAuthority.fencingValue,
        };
        const changed = await f.ledger.checkpoint({
          workItemId: 137,
          operationId: "foreign-checkpoint",
          authority,
          expected: {
            revision: other.value.record.revision,
            phase: "ready",
            status: "open",
          },
          patch: { observations: { workItemCommentId: "482" } },
        });
        publications.push(changed.ok);
        const released = await f.ledger.releaseClaim({
          workItemId: 137,
          operationId: "foreign-release",
          authority,
        });
        publications.push(released.ok);
        return f.ledger.acquireClaim(request);
      });
      const comments = vi.fn(
        async ({ sinceCommentId }: { sinceCommentId: string | null }) => ({
          kind: "window" as const,
          commentIds: sinceCommentId === "480" ? ["480", "481"] : ["482"],
        }),
      );
      const result = await runDevSquadAdoWorkflowWatchPass({
        ...f.input,
        seam: {
          observeWorkItemComments: comments,
          discoverWorkItemsPage: async (r) =>
            page(
              r,
              r.pageOrdinal === 1 ? [137] : [],
              r.pageOrdinal === 1 && !terminal ? "next" : null,
            ),
        },
      });
      expect(publications).toEqual([true, true]);
      expect(result).toMatchObject({
        ok: true,
        value: {
          polls: terminal ? 1 : 2,
          signals: [],
          traversal: { status: "complete" },
          outcomes: [
            {
              kind: "no-change",
              reason: terminal ? "stale-observation" : "no-new-observations",
              cleanup: { status: "released" },
            },
          ],
        },
      });
      expect(comments).toHaveBeenCalledTimes(terminal ? 1 : 2);
      expect(f.tracked.checkpoint).not.toHaveBeenCalled();
      expect(f.tracked.releaseClaim).toHaveBeenCalledTimes(1);
    },
  );
});
