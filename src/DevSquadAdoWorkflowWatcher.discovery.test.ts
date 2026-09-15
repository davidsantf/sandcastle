import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_DEVSQUAD_ADO_DISCOVERY_LIMITS,
  runDevSquadAdoWorkflowWatchPass,
  validateDevSquadAdoWorkflowWatchPassOptions,
} from "./index.js";
import type {
  DevSquadAdoDiscoveryPassOutcome,
  DevSquadAdoDiscoveryValidationResult,
  DevSquadAdoWatchValidationResult,
  DevSquadAdoWatchIntakeSignal,
  DevSquadAdoWorkflowLedger,
  DevSquadAdoDiscoveryPage,
  DevSquadAdoWatcherDiscoverySeam,
  DevSquadAdoWatchPassOutcome,
  DevSquadAdoWorkflowWatchPassRequest,
  RunDevSquadAdoDiscoveryWatchPassOptions,
  RunDevSquadAdoWorkflowWatchPassOptions,
} from "./index.js";

import { discoveryOptions } from "./DevSquadAdoWorkflowWatcherDiscoveryTestSupport.js";

import {
  cleanupWatcherRepositories,
  createWatcherLedgerFixture,
  seedWatcherRecord,
} from "./DevSquadAdoWorkflowWatcherTestSupport.js";

afterEach(cleanupWatcherRepositories);

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

// W045 / TEST-025/033/035/039: this exact typed fixture is reproduced in README.
// BEGIN W045 README EXAMPLE
async function offlineDiscoveryExamples(
  ledger: DevSquadAdoWorkflowLedger,
  clock: () => Date,
  delay: RunDevSquadAdoDiscoveryWatchPassOptions["delay"],
) {
  const emptySeam: DevSquadAdoWatcherDiscoverySeam = {
    discoverWorkItemsPage: async (request) => ({
      binding: request.binding,
      traversalId: request.traversalId,
      pageOrdinal: request.pageOrdinal,
      items: [],
      next: { kind: "terminal" },
    }),
    observeWorkItemComments: async () => ({ kind: "window", commentIds: [] }),
  };
  const options: RunDevSquadAdoDiscoveryWatchPassOptions = {
    mode: "discovery",
    ledger,
    seam: emptySeam,
    passId: "offline-example",
    ownerId: "host",
    clock,
    delay,
    intakeRules: { phases: ["ready"], statuses: ["open"] },
    budgets: {
      maxPolls: 2,
      maxPollStartElapsedMs: 1000,
      observationTimeoutMs: 10,
    },
    discovery: {
      scope: {
        scopeId: "example",
        partitionId: "small-partition",
        stabilityId: "snapshot-1",
        stableForInvocation: true,
      },
      policy: { version: "policy-v1", filters: [] },
      limits: DEFAULT_DEVSQUAD_ADO_DISCOVERY_LIMITS,
    },
  };
  const empty = await runDevSquadAdoWorkflowWatchPass(options);
  const pageFor =
    (
      items: DevSquadAdoDiscoveryPage["items"],
    ): DevSquadAdoWatcherDiscoverySeam["discoverWorkItemsPage"] =>
    async (request) => ({
      binding: request.binding,
      traversalId: request.traversalId,
      pageOrdinal: request.pageOrdinal,
      items,
      next: { kind: "terminal" },
    });

  // Precondition: 999 is absent. Admission never calls the comment method.
  const admission = await runDevSquadAdoWorkflowWatchPass({
    ...options,
    seam: {
      discoverWorkItemsPage: pageFor([{ workItemId: 999, facts: {} }]),
      observeWorkItemComments: async () => {
        throw new Error("admission must not observe comments");
      },
    },
    discovery: {
      ...options.discovery,
      authorizations: [
        {
          workItemId: 999,
          kind: "authorized",
          submissionId: "host-submission-999",
          initial: { phase: "ready", status: "open" },
        },
      ],
    },
  });

  // Precondition: 137 already has phase ready/status open, WI cursor 480, no PR.
  const reentryOptions: RunDevSquadAdoDiscoveryWatchPassOptions = {
    ...options,
    seam: {
      discoverWorkItemsPage: pageFor([
        {
          workItemId: 137,
          facts: { state: { kind: "known", value: "included" } },
        },
      ]),
      observeWorkItemComments: async ({ sinceCommentId }) => {
        if (sinceCommentId !== "480" && sinceCommentId !== "481")
          throw new Error("expected the durable anchor");
        return { kind: "window", commentIds: ["480", "481"] };
      },
    },
  };
  const paused = await runDevSquadAdoWorkflowWatchPass({
    ...reentryOptions,
    discovery: {
      ...options.discovery,
      policy: {
        version: "policy-excluded",
        filters: [
          { dimension: "state", operator: "one-of", values: ["other"] },
        ],
      },
    },
  });
  const reentry = await runDevSquadAdoWorkflowWatchPass(reentryOptions);
  const repeat = await runDevSquadAdoWorkflowWatchPass(reentryOptions);
  return { empty, admission, paused, reentry, repeat };
}
// END W045 README EXAMPLE

type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;

// Typed wrappers deliberately preserve a runtime union (not a narrowed const).
const invokeEither = (request: DevSquadAdoWorkflowWatchPassRequest) =>
  runDevSquadAdoWorkflowWatchPass(request);
const validateEither = (request: DevSquadAdoWorkflowWatchPassRequest) =>
  validateDevSquadAdoWorkflowWatchPassOptions(request);

describe("public offline examples and inference [W045]", () => {
  it("executes empty discovery, claim-free admission, pause and anchored reentry", async () => {
    const { options } = discoveryOptions();
    const { ledger } = await createWatcherLedgerFixture(options.clock);
    await seedWatcherRecord(ledger, {
      workItemId: 137,
      phase: "ready",
      status: "open",
      workItemCommentId: "480",
    });
    const result = await offlineDiscoveryExamples(
      ledger,
      options.clock,
      options.delay,
    );
    const exact: Equal<typeof result.empty, DevSquadAdoDiscoveryPassOutcome> =
      true;
    expect(exact).toBe(true);
    expect(result.empty).toMatchObject({
      ok: true,
      value: {
        signals: [],
        outcomes: [],
        traversal: { status: "complete" },
        counts: { pageCalls: 1, discovered: 0 },
      },
    });
    expect(result.admission).toMatchObject({
      ok: true,
      value: {
        signals: [
          {
            kind: "discovery-admission",
            workItemId: "999",
            acceptedInitializationRevision: 1,
          },
        ],
        counts: { admitted: 1, acted: 1, eligible: 0, cleanupNotRequired: 1 },
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
    expect(await ledger.readRecord(999)).toMatchObject({
      ok: true,
      value: {
        revision: 1,
        activeClaim: null,
        fencingCounter: 0,
        checkpoints: [],
        observations: { workItemCommentId: null, pullRequest: null },
      },
    });
    expect(result.paused).toMatchObject({
      ok: true,
      value: {
        signals: [],
        counts: { paused: 1, examined: 0 },
      },
    });
    expect(result.reentry).toMatchObject({
      ok: true,
      value: {
        signals: [
          {
            kind: "comment-observation",
            workItemId: "137",
            changedKinds: ["work-item-comment"],
          },
        ],
        counts: { acted: 1, cleanupReleased: 1 },
      },
    });
    expect(result.repeat).toMatchObject({
      ok: true,
      value: { signals: [], counts: { acted: 0 } },
    });
    expect(await ledger.readRecord(137)).toMatchObject({
      ok: true,
      value: {
        observations: { workItemCommentId: "481" },
        activeClaim: null,
      },
    });
    if (!result.admission.ok || !result.reentry.ok)
      throw new Error("example failed");
    expect(result.admission.value.signals).toHaveLength(1);
    expect(result.reentry.value.signals).toHaveLength(1);
    for (const signal of [
      ...result.admission.value.signals,
      ...result.reentry.value.signals,
    ]) {
      if (signal.kind === "discovery-admission") {
        const revision: 1 = signal.acceptedInitializationRevision;
        expect(revision).toBe(1);
        // @ts-expect-error Admission must not invent claim/comment metadata.
        expect(signal.changedKinds).toBeUndefined();
        expect(signal).not.toHaveProperty("claim");
      } else {
        const legacy: DevSquadAdoWatchIntakeSignal = signal;
        expect(legacy.changedKinds).toEqual(["work-item-comment"]);
        // @ts-expect-error Comment signals have no initialization acceptance.
        expect(signal.acceptedInitializationRevision).toBeUndefined();
      }
    }
  });

  it("keeps supplied inference and a true runtime request union, including validation", async () => {
    const { options, effect } = discoveryOptions();
    const supplied: RunDevSquadAdoWorkflowWatchPassOptions = {
      ledger: new Proxy(options.ledger, {
        get(target, key) {
          if (key === "initializeRecord")
            throw new Error("supplied must not inspect initialization");
          return Reflect.get(target, key);
        },
      }),
      seam: { observeWorkItemComments: effect },
      candidates: [137],
      passId: "supplied",
      ownerId: "host",
      clock: options.clock,
      delay: options.delay,
      budgets: options.budgets,
      intakeRules: options.intakeRules,
      signal: AbortSignal.abort(),
    };
    const implicit = await runDevSquadAdoWorkflowWatchPass(supplied);
    const explicit = await runDevSquadAdoWorkflowWatchPass({
      ...supplied,
      mode: "supplied",
    });
    const validation = validateDevSquadAdoWorkflowWatchPassOptions(supplied);
    const discoveryValidation =
      validateDevSquadAdoWorkflowWatchPassOptions(options);
    const exact: [
      Equal<typeof implicit, DevSquadAdoWatchPassOutcome>,
      Equal<typeof explicit, DevSquadAdoWatchPassOutcome>,
      Equal<typeof validation, DevSquadAdoWatchValidationResult>,
      Equal<typeof discoveryValidation, DevSquadAdoDiscoveryValidationResult>,
      Equal<
        Awaited<ReturnType<typeof invokeEither>>,
        DevSquadAdoWatchPassOutcome | DevSquadAdoDiscoveryPassOutcome
      >,
      Equal<
        ReturnType<typeof validateEither>,
        DevSquadAdoWatchValidationResult | DevSquadAdoDiscoveryValidationResult
      >,
    ] = [true, true, true, true, true, true];
    expect(exact.every(Boolean)).toBe(true);
    expect(implicit).toEqual(explicit);
    expect(implicit.ok && implicit.value).not.toHaveProperty("mode");
    for (const request of [supplied, options]) {
      expect(validateEither(request).ok).toBe(true);
      expect(await invokeEither(request)).toEqual(
        request === supplied
          ? implicit
          : await runDevSquadAdoWorkflowWatchPass(options),
      );
    }
    if (implicit.ok) {
      const signals: readonly DevSquadAdoWatchIntakeSignal[] =
        implicit.value.signals;
      for (const signal of signals) {
        // @ts-expect-error Supplied signals must not acquire a discovery discriminator.
        void signal.kind;
      }
    }
    expect(effect).not.toHaveBeenCalled();
  });

  it.each([undefined, "supplied"] as const)(
    "runs active supplied mode %s without inspecting initialization or widening signals",
    async (mode) => {
      const { options } = discoveryOptions();
      const { ledger } = await createWatcherLedgerFixture(options.clock);
      await seedWatcherRecord(ledger, {
        workItemId: 137,
        phase: "ready",
        status: "open",
        workItemCommentId: "480",
      });
      const outcome = await runDevSquadAdoWorkflowWatchPass({
        mode,
        ledger: new Proxy(ledger, {
          get(target, key) {
            if (key === "initializeRecord")
              throw new Error("must not inspect initializer");
            return Reflect.get(target, key);
          },
        }),
        candidates: [137, 999],
        seam: {
          observeWorkItemComments: async () => ({ commentIds: ["480", "481"] }),
        },
        passId: "active-supplied",
        ownerId: "host",
        clock: options.clock,
        delay: options.delay,
        intakeRules: options.intakeRules,
        budgets: { ...options.budgets, maxPolls: 1 },
      });
      const exact: Equal<typeof outcome, DevSquadAdoWatchPassOutcome> = true;
      expect(exact).toBe(true);
      expect(outcome).toMatchObject({
        ok: true,
        value: {
          signals: [{ workItemId: "137", changedKinds: ["work-item-comment"] }],
          outcomes: [
            { kind: "acted" },
            { kind: "skipped", reason: "record-not-found" },
          ],
        },
      });
      if (!outcome.ok) throw new Error("supplied example failed");
      expect(outcome.value.signals).toHaveLength(1);
      expect(outcome.value.signals[0]).not.toHaveProperty("kind");
      expect(outcome.value).not.toHaveProperty("mode");
      expect(await ledger.readRecord(999)).toMatchObject({
        ok: false,
        error: { kind: "record-not-found" },
      });
    },
  );

  it("publishes the exact compiled and executed fixture in README", async () => {
    const read = (name: string) =>
      readFile(new URL(name, import.meta.url), "utf8").then((text) =>
        text.replace(/\r\n/g, "\n"),
      );
    const source = await read("DevSquadAdoWorkflowWatcher.discovery.test.ts");
    const example = source
      .split("// BEGIN W045 README EXAMPLE\n")[1]
      ?.split("// END W045 README EXAMPLE")[0]
      ?.trim();
    expect(example).toBeDefined();
    expect(
      (await read("../README.md")).includes(example ?? "missing fixture"),
    ).toBe(true);
  });
});
