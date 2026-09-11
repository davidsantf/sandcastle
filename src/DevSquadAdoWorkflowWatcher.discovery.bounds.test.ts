import { describe, expect, it } from "vitest";
import {
  runDevSquadAdoWorkflowWatchPass,
  validateDevSquadAdoWorkflowWatchPassOptions,
  DEFAULT_DEVSQUAD_ADO_DISCOVERY_LIMITS,
} from "./index.js";
import type { RunDevSquadAdoDiscoveryWatchPassOptions } from "./index.js";
import { discoveryOptions } from "./DevSquadAdoWorkflowWatcherDiscoveryTestSupport.js";

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
