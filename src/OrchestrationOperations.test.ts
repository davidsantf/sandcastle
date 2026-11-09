import { afterEach, describe, expect, it } from "vitest";
import {
  createOrchestrationOperations,
  readOrchestrationOperationSummary,
  reconcileOrchestrationOperation,
} from "./OrchestrationOperations.js";
import {
  localServiceConfiguration,
  closeMemoryServiceStores,
  memoryServiceStore,
} from "./LocalOrchestrationServiceTestSupport.js";

afterEach(closeMemoryServiceStores);

describe("durable exact-action admission", () => {
  it("blocks unauthorized modes/actions/scopes without reserving or executing", async () => {
    const store = memoryServiceStore();
    const configuration = localServiceConfiguration();
    const operations = createOrchestrationOperations({
      workspaceId: configuration.id,
      focus: configuration.focus,
      store,
      signal: new AbortController().signal,
      passId: "one",
    });
    let effects = 0;
    for (const target of [
      { projectId: "outside", action: "discover" as const },
      { projectId: "app", action: "implement" as const },
      { projectId: "app", action: "publish-pr" as const },
    ])
      expect(
        await operations.perform(
          { ...target, id: "blocked", intent: {} },
          async () => effects++,
        ),
      ).toMatchObject({ state: "blocked" });
    expect(effects).toBe(0);
    expect(readOrchestrationOperationSummary(store, configuration.id)).toEqual({
      reserved: 0,
      completed: 0,
    });
  });

  it("reserves before dispatch, suppresses replay, rejects conflicting intent, and preserves uncertainty", async () => {
    const store = memoryServiceStore();
    const configuration = localServiceConfiguration();
    const make = () =>
      createOrchestrationOperations({
        workspaceId: configuration.id,
        focus: configuration.focus,
        store,
        signal: new AbortController().signal,
        passId: "one",
      });
    const request = {
      id: "exact-effect",
      projectId: "app",
      action: "discover" as const,
      intent: { repository: "fixture/app", account: "fixture", query: "one" },
    };
    let calls = 0;
    const operations = make();
    expect(
      await operations.perform(request, async () => {
        calls++;
        expect(
          readOrchestrationOperationSummary(store, configuration.id).reserved,
        ).toBe(1);
        throw new Error("credential-not-for-output");
      }),
    ).toMatchObject({
      state: "blocked",
      diagnostic: "host-action-unacknowledged: reconcile; do not retry",
    });
    expect(await make().perform(request, async () => calls++)).toMatchObject({
      state: "blocked",
    });
    expect(
      await make().perform(
        { ...request, intent: { query: "different" } },
        async () => calls++,
      ),
    ).toMatchObject({
      state: "blocked",
      diagnostic: "operation-identity-conflicts-with-reserved-intent",
    });
    expect(calls).toBe(1);
    expect(JSON.stringify(operations.evidence())).not.toContain(
      "credential-not",
    );
  });

  it("counts interrupted reservations against concurrency after restart", async () => {
    const configuration = localServiceConfiguration();
    configuration.focus.maxConcurrency = 1;
    const store = memoryServiceStore();
    const make = () =>
      createOrchestrationOperations({
        workspaceId: configuration.id,
        focus: configuration.focus,
        store,
        signal: new AbortController().signal,
        passId: "one",
      });
    await make().perform(
      { id: "uncertain", intent: {}, projectId: "app", action: "discover" },
      async () => {
        throw new Error("unknown");
      },
    );
    let calls = 0;
    expect(
      await make().perform(
        { id: "new", intent: {}, projectId: "app", action: "discover" },
        async () => calls++,
      ),
    ).toMatchObject({
      state: "blocked",
      diagnostic: "unsettled-operation-concurrency-limit",
    });
    expect(calls).toBe(0);
  });

  it("enforces measurable item, attempt, runtime, and concurrent-call budgets", async () => {
    const configuration = localServiceConfiguration();
    configuration.focus.budgets = {
      maxItems: 1,
      maxAttempts: 1,
      maxRuntimeMs: 20,
    };
    const store = memoryServiceStore();
    const operations = createOrchestrationOperations({
      workspaceId: configuration.id,
      focus: configuration.focus,
      store,
      signal: new AbortController().signal,
      passId: "one",
    });
    const request = {
      id: "one",
      intent: {},
      projectId: "app",
      action: "discover" as const,
    };
    expect(await operations.perform(request, async () => 1)).toEqual({
      state: "ready",
      value: 1,
    });
    expect(
      await operations.perform({ ...request, id: "two" }, async () => 2),
    ).toMatchObject({ state: "blocked", diagnostic: "focus-budget-exhausted" });
    const next = createOrchestrationOperations({
      workspaceId: "runtime",
      focus: configuration.focus,
      store,
      signal: new AbortController().signal,
      passId: "two",
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(await next.perform(request, async () => 1)).toMatchObject({
      state: "blocked",
      diagnostic: "focus-budget-exhausted",
    });
  });

  it("retains replay protection beyond a fixed-size history without accumulating active slots", async () => {
    const configuration = localServiceConfiguration();
    const store = memoryServiceStore();
    for (let index = 0; index < 270; index++) {
      const operations = createOrchestrationOperations({
        workspaceId: configuration.id,
        focus: configuration.focus,
        store,
        signal: new AbortController().signal,
        passId: `pass-${index}`,
      });
      expect(
        await operations.perform(
          {
            id: `effect-${index}`,
            intent: { index },
            projectId: "app",
            action: "discover",
          },
          async () => index,
        ),
      ).toEqual({ state: "ready", value: index });
    }
    expect(readOrchestrationOperationSummary(store, configuration.id)).toEqual({
      reserved: 0,
      completed: 270,
    });
    const replay = createOrchestrationOperations({
      workspaceId: configuration.id,
      focus: configuration.focus,
      store,
      signal: new AbortController().signal,
      passId: "replay",
    });
    expect(
      await replay.perform(
        {
          id: "effect-0",
          intent: { index: 0 },
          projectId: "app",
          action: "discover",
        },
        async () => {
          throw new Error("must not dispatch");
        },
      ),
    ).toMatchObject({ state: "blocked" });
    expect(() =>
      reconcileOrchestrationOperation({
        store,
        workspaceId: configuration.id,
        operationId: "effect-0",
        evidenceDigest: "1".repeat(64),
      }),
    ).toThrow("stop-service");
  });
});
