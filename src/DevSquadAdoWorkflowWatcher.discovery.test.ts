import { describe, expect, it } from "vitest";
import {
  runDevSquadAdoWorkflowWatchPass,
  validateDevSquadAdoWorkflowWatchPassOptions,
} from "./index.js";
import type {
  DevSquadAdoDiscoveryPassOutcome,
  DevSquadAdoWatchPassOutcome,
  DevSquadAdoWorkflowWatchPassRequest,
  RunDevSquadAdoDiscoveryWatchPassOptions,
  RunDevSquadAdoWorkflowWatchPassOptions,
} from "./index.js";

import { discoveryOptions } from "./DevSquadAdoWorkflowWatcherDiscoveryTestSupport.js";

describe("discovery preflight and empty traversal [W039]", () => {
  it("returns a separate discovery result for a terminal empty page without item effects", async () => {
    const { options, effect, timers } = discoveryOptions();
    const result: DevSquadAdoDiscoveryPassOutcome =
      await runDevSquadAdoWorkflowWatchPass(options);
    expect(result).toMatchObject({
      ok: true,
      value: {
        mode: "discovery",
        stopReason: "completed",
        polls: 1,
        traversal: {
          status: "complete",
          reason: "terminal-page",
          terminalPageSeen: true,
        },
        counts: {
          pageCalls: 1,
          pagesValidated: 1,
          discovered: 0,
          evaluated: 0,
          acted: 0,
        },
        outcomes: [],
        signals: [],
      },
    });
    expect(effect).not.toHaveBeenCalled();
    expect(timers).toHaveLength(1);
    expect(timers[0]?.aborted).toBe(true);
    expect(options.seam.discoverWorkItemsPage).toHaveBeenCalledWith(
      expect.objectContaining({
        pageOrdinal: 1,
        continuation: null,
        traversalId: expect.any(String),
        binding: {
          scopeId: "scope",
          partitionId: "partition",
          stabilityId: "stable",
          policyVersion: "policy-v1",
        },
      }),
    );
    const rendered = JSON.stringify(result);
    expect(rendered).not.toContain("traversalId");
    expect(rendered).not.toContain("continuation");
  });

  it("keeps legacy and explicit supplied results and validation types without requiring initialization", async () => {
    const { options, effect } = discoveryOptions();
    const {
      mode: _mode,
      discovery: _discovery,
      seam: _seam,
      ...common
    } = options;
    const supplied: RunDevSquadAdoWorkflowWatchPassOptions = {
      ...common,
      candidates: ["1"],
      signal: AbortSignal.abort(),
      seam: { observeWorkItemComments: effect },
      ledger: new Proxy(options.ledger, {
        get(target, key) {
          if (key === "initializeRecord")
            throw new Error("must not inspect initializer");
          return Reflect.get(target, key);
        },
      }),
    };
    const legacy: DevSquadAdoWatchPassOutcome =
      await runDevSquadAdoWorkflowWatchPass(supplied);
    const explicit: DevSquadAdoWatchPassOutcome =
      await runDevSquadAdoWorkflowWatchPass({ ...supplied, mode: "supplied" });
    expect(legacy).toEqual(explicit);
    expect(legacy.ok && "mode" in legacy.value).toBe(false);
    expect(validateDevSquadAdoWorkflowWatchPassOptions(supplied).ok).toBe(true);
    const union: DevSquadAdoWorkflowWatchPassRequest = options;
    expect(validateDevSquadAdoWorkflowWatchPassOptions(union)).toMatchObject({
      ok: true,
      value: { mode: "discovery" },
    });
    expect(effect).not.toHaveBeenCalled();
  });

  it.each([
    { mode: "unknown" },
    { mode: "supplied" },
    { mode: undefined },
    { candidates: [] },
    { discovery: undefined },
    { ledger: {} },
    {
      seam: {
        observeWorkItemComments: async () => ({
          kind: "window",
          commentIds: [],
        }),
      },
    },
  ])(
    "rejects mixed/malformed request arms before effects: %j",
    async (patch) => {
      const { options, effect, clock } = discoveryOptions();
      const result = await runDevSquadAdoWorkflowWatchPass({
        ...options,
        ...patch,
      } as RunDevSquadAdoDiscoveryWatchPassOptions);
      expect(result.ok).toBe(false);
      expect(effect).not.toHaveBeenCalled();
      expect(clock).not.toHaveBeenCalled();
      expect(options.delay).not.toHaveBeenCalled();
      expect(options.seam.discoverWorkItemsPage).not.toHaveBeenCalled();
    },
  );

  it("does not start a page after pre-abort", async () => {
    const { options, effect } = discoveryOptions();
    const controller = new AbortController();
    controller.abort();
    const result = await runDevSquadAdoWorkflowWatchPass({
      ...options,
      signal: controller.signal,
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        stopReason: "cancelled",
        counts: { pageCalls: 0 },
        traversal: {
          status: "incomplete",
          reason: "cancelled",
          terminalPageSeen: false,
        },
      },
    });
    expect(options.seam.discoverWorkItemsPage).not.toHaveBeenCalled();
    expect(effect).not.toHaveBeenCalled();
  });

  it("times out a page, retires its child and consumes late rejection", async () => {
    const { options, effect } = discoveryOptions();
    let reject!: (reason: Error) => void;
    let child: AbortSignal | undefined;
    const result = await runDevSquadAdoWorkflowWatchPass({
      ...options,
      delay: async () => {},
      seam: {
        ...options.seam,
        discoverWorkItemsPage: (input) => {
          child = input.signal;
          return new Promise((_resolve, fail) => {
            reject = fail;
          });
        },
      },
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        stopReason: "discovery-incomplete",
        counts: { pageCalls: 1, pagesValidated: 0 },
        traversal: { status: "incomplete", reason: "page-timeout" },
      },
    });
    expect(child?.aborted).toBe(true);
    reject(new Error("private late payload"));
    await Promise.resolve();
    expect(effect).not.toHaveBeenCalled();
  });
});

// W039 / FR-051–053: cancellation and dependency faults preserve empty-pass truth.
describe("discovery page lifecycle", () => {
  it("returns redacted incomplete evidence for a throwing page", async () => {
    const { options, effect } = discoveryOptions();
    const result = await runDevSquadAdoWorkflowWatchPass({
      ...options,
      seam: {
        ...options.seam,
        discoverWorkItemsPage: () => {
          throw new Error("private page failure");
        },
      },
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        counts: { pageCalls: 1, pagesValidated: 0 },
        traversal: { status: "incomplete", reason: "page-failed" },
      },
    });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(effect).not.toHaveBeenCalled();
  });

  it("cancels an in-flight page, retiring parent listeners and both child signals", async () => {
    const { options, effect, timers } = discoveryOptions();
    const parent = new AbortController();
    let listeners = 0;
    const add = parent.signal.addEventListener.bind(parent.signal);
    const remove = parent.signal.removeEventListener.bind(parent.signal);
    parent.signal.addEventListener = (...args: Parameters<typeof add>) => {
      listeners++;
      add(...args);
    };
    parent.signal.removeEventListener = (
      ...args: Parameters<typeof remove>
    ) => {
      listeners--;
      remove(...args);
    };
    let child: AbortSignal | undefined;
    const result = await runDevSquadAdoWorkflowWatchPass({
      ...options,
      signal: parent.signal,
      seam: {
        ...options.seam,
        discoverWorkItemsPage: (request) => {
          child = request.signal;
          parent.abort();
          return new Promise(() => {});
        },
      },
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        stopReason: "cancelled",
        counts: { pageCalls: 1, pagesValidated: 0 },
        traversal: { status: "incomplete", reason: "cancelled" },
      },
    });
    expect(child?.aborted).toBe(true);
    expect(timers.every((timer) => timer.aborted)).toBe(true);
    expect(listeners).toBe(0);
    expect(effect).not.toHaveBeenCalled();
  });

  it("owns binding and policy snapshots despite caller mutation after preflight", async () => {
    const { options } = discoveryOptions();
    const configuration = options.discovery as {
      scope: { scopeId: string };
      policy: { version: string };
    };
    const page = options.seam.discoverWorkItemsPage;
    const result = await runDevSquadAdoWorkflowWatchPass({
      ...options,
      seam: {
        ...options.seam,
        discoverWorkItemsPage: async (request) => {
          configuration.scope.scopeId = "changed";
          configuration.policy.version = "changed";
          expect(request.binding.scopeId).toBe("scope");
          expect(request.binding.policyVersion).toBe("policy-v1");
          expect(Object.isFrozen(request.binding)).toBe(true);
          return page(request);
        },
      },
    });
    expect(result).toMatchObject({
      ok: true,
      value: { stopReason: "completed" },
    });
  });

  it("counts the empty page's complete recognized JSON encoding at B and B+1", async () => {
    const { options } = discoveryOptions();
    const pageBytes = Buffer.byteLength(
      JSON.stringify({
        binding: {
          scopeId: "scope",
          partitionId: "partition",
          stabilityId: "stable",
          policyVersion: "policy-v1",
        },
        traversalId: "x".repeat(64),
        pageOrdinal: 1,
        items: [],
        next: { kind: "terminal" },
      }),
    );
    for (const delta of [0, -1]) {
      const result = await runDevSquadAdoWorkflowWatchPass({
        ...options,
        discovery: {
          ...options.discovery,
          limits: {
            ...options.discovery.limits,
            maxPageBytes: pageBytes + delta,
          },
        },
      });
      expect(result).toMatchObject({
        ok: true,
        value: {
          traversal: { reason: delta === 0 ? "terminal-page" : "invalid-page" },
        },
      });
    }
  });
});
