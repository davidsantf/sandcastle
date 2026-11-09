import { afterEach, describe, expect, it } from "vitest";
import {
  runLocalOrchestrationPass,
  startLocalOrchestrationService,
  type LocalOrchestrationServiceHandle,
  type LocalOrchestrationTickContext,
} from "./LocalOrchestrationService.js";
import {
  localServiceConfiguration,
  closeMemoryServiceStores,
  memoryServiceStore,
  waitForServiceCondition,
} from "./LocalOrchestrationServiceTestSupport.js";
import {
  orchestrationServiceDigest,
  reconcileOrchestrationOperation,
} from "./OrchestrationOperations.js";

const handles: LocalOrchestrationServiceHandle[] = [];
afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.stop();
  closeMemoryServiceStores();
});

describe("user-local service lifecycle", () => {
  it("starts with inactive project grants but never dispatches their effects", async () => {
    const configuration = localServiceConfiguration();
    configuration.focus.permissions.push({
      projectId: "inactive",
      action: "discover",
    });
    let effects = 0;
    const result = await runLocalOrchestrationPass({
      configuration,
      store: memoryServiceStore(),
      tick: async ({ operations }) => {
        expect(
          await operations.perform(
            {
              id: "inactive-project",
              intent: {},
              projectId: "inactive",
              action: "discover",
            },
            async () => effects++,
          ),
        ).toMatchObject({
          state: "blocked",
          diagnostic: "outside-focus: host handoff required",
        });
      },
    });
    expect(result.state).toBe("stopped");
    expect(result.passes).toBe(1);
    expect(result.operations).toEqual({ reserved: 0, completed: 0 });
    expect(effects).toBe(0);
  });

  it("actually polls, shares ownership with manual passes, and stops gracefully", async () => {
    const configuration = localServiceConfiguration();
    const store = memoryServiceStore();
    let passes = 0;
    const handle = await startLocalOrchestrationService({
      configuration,
      store,
      tick: async () => {
        passes++;
      },
    });
    handles.push(handle);
    await waitForServiceCondition(() => passes >= 2);
    await expect(
      runLocalOrchestrationPass({
        configuration,
        store,
        tick: async () => undefined,
      }),
    ).rejects.toThrow("service-already-owned");
    await handle.stop();
    const count = passes;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(passes).toBe(count);
    expect(handle.status().state).toBe("stopped");
    await handle.stop();
    expect(handle.status().state).toBe("stopped");
    const result = await runLocalOrchestrationPass({
      configuration,
      store,
      tick: async () => {
        passes++;
      },
    });
    expect(result.passes).toBe(1);
    expect(passes).toBe(count + 1);
  });

  it("persists pause and narrowed focus across restarts without expanding grants", async () => {
    const configuration = localServiceConfiguration();
    const store = memoryServiceStore();
    let passes = 0;
    const tick = async () => {
      passes++;
    };
    const first = await startLocalOrchestrationService({
      configuration,
      store,
      tick,
    });
    handles.push(first);
    await waitForServiceCondition(() => passes > 0);
    first.updateFocus({
      ...configuration.focus,
      priorities: { app: 99 },
      maxConcurrency: 1,
    });
    expect(() =>
      first.updateFocus({ ...configuration.focus, mode: "execute" }),
    ).toThrow("focus-expansion");
    first.pause();
    await first.stop();
    const count = passes;
    const second = await startLocalOrchestrationService({
      configuration,
      store,
      tick,
    });
    handles.push(second);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(passes).toBe(count);
    expect(second.status().focus.maxConcurrency).toBe(1);
    second.resume();
    await waitForServiceCondition(() => passes > count);
  });

  it("fences stale tick stores and callbacks after a pass and focus change", async () => {
    const configuration = localServiceConfiguration();
    const store = memoryServiceStore();
    let captured: LocalOrchestrationTickContext | undefined;
    const result = await runLocalOrchestrationPass({
      configuration,
      store,
      tick: async (context) => {
        captured = context;
      },
    });
    expect(result.state).toBe("stopped");
    expect(() =>
      captured!.store.compareAndSwap(
        "late",
        0,
        {},
        { kind: "late", at: new Date().toISOString() },
      ),
    ).toThrow("guard is stale");
    let effects = 0;
    expect(
      await captured!.operations.perform(
        { id: "late", intent: {}, projectId: "app", action: "discover" },
        async () => effects++,
      ),
    ).toMatchObject({ state: "blocked", diagnostic: "pass-cancelled" });
    expect(effects).toBe(0);
    expect(Object.isFrozen(captured!.configuration.focus.budgets)).toBe(true);
  });

  it("aborts at deadlines but retains ownership until uncooperative callbacks settle", async () => {
    const configuration = localServiceConfiguration();
    configuration.focus.budgets.maxRuntimeMs = 30;
    const store = memoryServiceStore();
    let release!: () => void;
    let signal: AbortSignal | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handle = await startLocalOrchestrationService({
      configuration,
      store,
      tick: async (context) => {
        signal = context.signal;
        await blocked;
      },
    });
    handles.push(handle);
    await waitForServiceCondition(() => signal?.aborted === true);
    await expect(
      runLocalOrchestrationPass({
        configuration,
        store,
        tick: async () => undefined,
      }),
    ).rejects.toThrow("service-already-owned");
    const stopping = handle.stop();
    expect(handle.status().state).toBe("stopping");
    release();
    await stopping;
    expect(handle.status().state).toBe("stopped");
  });

  it("waits for admitted fire-and-forget operations before releasing ownership", async () => {
    const configuration = localServiceConfiguration();
    const store = memoryServiceStore();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handle = await startLocalOrchestrationService({
      configuration,
      store,
      tick: async (context) => {
        void context.operations.perform(
          { id: "pending", intent: {}, projectId: "app", action: "discover" },
          async () => pending,
        );
      },
    });
    handles.push(handle);
    const stopped = handle.stop();
    await expect(
      runLocalOrchestrationPass({
        configuration,
        store,
        tick: async () => undefined,
      }),
    ).rejects.toThrow("service-already-owned");
    release();
    await stopped;
    expect(handle.status().operations.completed).toBe(1);
  });

  it("returns credential-free blocked diagnostics rather than pretending a failed pass succeeded", async () => {
    const configuration = localServiceConfiguration();
    const result = await runLocalOrchestrationPass({
      configuration,
      store: memoryServiceStore(),
      tick: async () => {
        throw new Error("secret-token-not-for-output");
      },
    });
    expect(result.state).toBe("blocked");
    expect(JSON.stringify(result)).not.toContain("secret-token");
    expect(result.passes).toBe(0);
  });

  it("invalidates admission immediately on pause and keeps already admitted outcomes uncertain", async () => {
    const configuration = localServiceConfiguration();
    const store = memoryServiceStore();
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    let context!: LocalOrchestrationTickContext;
    const handle = await startLocalOrchestrationService({
      configuration,
      store,
      tick: async (captured) => {
        context = captured;
        await captured.operations.perform(
          {
            id: "admitted-before-pause",
            projectId: "app",
            action: "discover",
            intent: {},
          },
          async () => waiting,
        );
      },
    });
    handles.push(handle);
    handle.pause();
    expect(context.signal.aborted).toBe(true);
    expect(() =>
      context.store.compareAndSwap(
        "stale-after-pause",
        0,
        {},
        { kind: "fixture", at: new Date().toISOString() },
      ),
    ).toThrow("guard is stale");
    let calls = 0;
    expect(
      await context.operations.perform(
        {
          id: "after-pause",
          projectId: "app",
          action: "discover",
          intent: {},
        },
        async () => calls++,
      ),
    ).toMatchObject({ state: "blocked", diagnostic: "pass-cancelled" });
    expect(calls).toBe(0);
    release();
    await handle.stop();
    expect(handle.status().operations.reserved).toBe(1);
    expect(
      handle.status().evidence.some((item) => item.state === "blocked"),
    ).toBe(true);
    reconcileOrchestrationOperation({
      store,
      workspaceId: configuration.id,
      operationId: "admitted-before-pause",
      evidenceDigest: "a".repeat(64),
    });
    expect(handle.status().operations).toEqual({ reserved: 0, completed: 1 });
    await expect(
      runLocalOrchestrationPass({
        configuration,
        store,
        tick: async (next) => {
          expect(
            await next.operations.perform(
              {
                id: "admitted-before-pause",
                projectId: "app",
                action: "discover",
                intent: {},
              },
              async () => calls++,
            ),
          ).toMatchObject({ state: "blocked" });
        },
      }),
    ).resolves.toMatchObject({ state: "stopped" });
    expect(calls).toBe(0);
  });

  it("refuses a foreign-host ownership record rather than stealing it on timeout", async () => {
    const configuration = localServiceConfiguration();
    const store = memoryServiceStore();
    store.compareAndSwap(
      `service-owner/${orchestrationServiceDigest(configuration.id)}`,
      0,
      {
        state: "active",
        ownerId: "foreign",
        pid: 2147483647,
        hostname: "not-this-host-fixture",
      },
      { kind: "fixture", at: new Date().toISOString() },
    );
    await expect(
      startLocalOrchestrationService({
        configuration,
        store,
        tick: async () => undefined,
      }),
    ).rejects.toThrow("foreign-host");
  });

  it("atomically fences changed configuration and reloads a trusted revision before the next pass", async () => {
    let configuration = localServiceConfiguration();
    const store = memoryServiceStore();
    const configKey = "workspace:configuration";
    const event = { kind: "fixture", at: new Date().toISOString() };
    store.compareAndSwap(configKey, 0, configuration, event);
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const contexts: LocalOrchestrationTickContext[] = [];
    const handle = await startLocalOrchestrationService({
      configuration,
      store,
      reloadConfiguration: () => configuration,
      tick: async (context) => {
        contexts.push(context);
        if (contexts.length === 1) await waiting;
      },
    });
    handles.push(handle);
    configuration = {
      ...configuration,
      revision: 2,
      focus: { ...configuration.focus, priorities: { app: 10 } },
    };
    store.compareAndSwap(configKey, 1, configuration, event);
    let effects = 0;
    await expect(
      contexts[0]!.operations.perform(
        {
          id: "stale-config-action",
          projectId: "app",
          action: "discover",
          intent: {},
        },
        async () => effects++,
      ),
    ).rejects.toThrow("guard is stale");
    expect(effects).toBe(0);
    release();
    await waitForServiceCondition(() => contexts.length >= 2);
    expect(contexts[1]!.configuration.revision).toBe(2);
    expect(contexts[1]!.configuration.focus.priorities.app).toBe(10);
  });

  it("reports failed ownership release as blocked instead of success", async () => {
    const configuration = localServiceConfiguration();
    const store = memoryServiceStore();
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handle = await startLocalOrchestrationService({
      configuration,
      store,
      tick: async () => waiting,
    });
    handles.push(handle);
    const key = `service-owner/${orchestrationServiceDigest(configuration.id)}`;
    const owner = store.read(key);
    store.compareAndSwap(
      key,
      owner.version,
      {
        state: "active",
        ownerId: "replacement-fixture",
        pid: process.pid,
        hostname: "replacement-host",
      },
      { kind: "fixture", at: new Date().toISOString() },
    );
    const stopped = handle.stop();
    release();
    await stopped;
    expect(handle.status().state).toBe("blocked");
    expect(handle.status().diagnostic).toContain(
      "failure-evidence-unacknowledged",
    );
    expect(handle.status().failureEvidence).toBe("unacknowledged");
    expect(handle.status().lastFailure?.phase).toBe("release");
  });
});
