import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readLocalOrchestrationFailure,
  runLocalOrchestrationPass,
} from "./LocalOrchestrationService.js";
import { OrchestrationWorkspaceStore } from "./OrchestrationWorkspace.js";
import {
  closeMemoryServiceStores,
  localServiceConfiguration,
  memoryServiceStore,
} from "./LocalOrchestrationServiceTestSupport.js";

const folders: string[] = [];
const stores: OrchestrationWorkspaceStore[] = [];
afterEach(() => {
  closeMemoryServiceStores();
  for (const store of stores.splice(0)) store.close();
  for (const directory of folders.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("bounded durable service failure evidence", () => {
  it("persists redacted callback failure evidence across close, reopen, and healthy restart", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "service-failure-"));
    folders.push(directory);
    const filename = path.join(directory, "orchestration.sqlite");
    const configuration = localServiceConfiguration();
    const first = new OrchestrationWorkspaceStore(filename);
    const result = await runLocalOrchestrationPass({
      configuration,
      store: first,
      tick: async () => {
        throw new Error("credential-bearing-secret: " + "x".repeat(100_000));
      },
    });
    expect(result.state).toBe("blocked");
    expect(result.failureEvidence).toBe("acknowledged");
    expect(result.lastFailure).toMatchObject({
      phase: "tick",
      classification: "host-callback-failed",
      configurationRevision: configuration.revision,
    });
    expect(result.lastFailure?.passId).toMatch(/^[a-f0-9-]{36}$/);
    expect(result.diagnostic).toContain("host-callback-failed");
    expect(JSON.stringify(result).length).toBeLessThan(4000);
    const failureEvents = first
      .events()
      .filter((event) => event.kind === "service-failed");
    expect(failureEvents).toHaveLength(1);
    expect(JSON.stringify(first.events())).not.toContain(
      "credential-bearing-secret",
    );
    first.close();
    const reopened = new OrchestrationWorkspaceStore(filename);
    stores.push(reopened);
    expect(readLocalOrchestrationFailure(reopened, configuration.id)).toEqual(
      result.lastFailure,
    );
    const restarted = await runLocalOrchestrationPass({
      configuration,
      store: reopened,
      tick: async () => undefined,
    });
    expect(restarted.state).toBe("stopped");
    expect(restarted.lastFailure).toEqual(result.lastFailure);
    expect(restarted.ownerId).not.toBe(result.lastFailure?.ownerId);
    expect(
      reopened.events().filter((event) => event.kind === "service-failed"),
    ).toHaveLength(1);
  });

  it.each([
    ["ETIMEDOUT", "timeout"],
    ["EACCES", "access-denied"],
    ["ECONNREFUSED", "dependency-unavailable"],
    ["ENOSPC", "storage-unavailable"],
    ["ABORT_ERR", "cancelled"],
    ["untrusted-token-code", "host-callback-failed"],
  ])(
    "maps %s into a fixed allowlisted cause without echoing the raw error",
    async (code, classification) => {
      const store = memoryServiceStore();
      const configuration = localServiceConfiguration();
      const result = await runLocalOrchestrationPass({
        configuration,
        store,
        tick: async () => {
          throw Object.assign(new Error("raw-secret-error"), { code });
        },
      });
      expect(result.lastFailure?.classification).toBe(classification);
      expect(result.failureEvidence).toBe("acknowledged");
      expect(JSON.stringify(result)).not.toContain("raw-secret-error");
      expect(JSON.stringify(result)).not.toContain("untrusted-token-code");
      expect(readLocalOrchestrationFailure(store, configuration.id)).toEqual(
        result.lastFailure,
      );
    },
  );

  it("classifies trusted configuration reload failures separately from callback failures", async () => {
    const configuration = localServiceConfiguration();
    const store = memoryServiceStore();
    let calls = 0;
    const result = await runLocalOrchestrationPass({
      configuration,
      store,
      reloadConfiguration: () => {
        throw new Error("private-configuration-value");
      },
      tick: async () => {
        calls++;
      },
    });
    expect(calls).toBe(0);
    expect(result.lastFailure).toMatchObject({
      phase: "configuration",
      classification: "configuration-invalid",
      passId: null,
    });
    expect(result.diagnostic).toContain("validate or migrate");
    expect(JSON.stringify(result)).not.toContain("private-configuration-value");
  });

  it("does not execute error-property getters during classification", async () => {
    let reads = 0;
    const error = {};
    for (const key of ["code", "name", "message"])
      Object.defineProperty(error, key, {
        get() {
          reads++;
          throw new Error("secret-getter");
        },
      });
    const result = await runLocalOrchestrationPass({
      configuration: localServiceConfiguration(),
      store: memoryServiceStore(),
      tick: async () => {
        throw error;
      },
    });
    expect(reads).toBe(0);
    expect(result.lastFailure?.classification).toBe("host-callback-failed");
    expect(result.failureEvidence).toBe("acknowledged");
  });

  it("exposes persistence failure explicitly instead of claiming a durable failure event", async () => {
    const store = memoryServiceStore();
    const configuration = localServiceConfiguration();
    const root = store.compareAndSwap.bind(store);
    const guarded = store.withGuard.bind(store);
    const failEvidence = (
      candidate: ReturnType<typeof guarded>,
    ): ReturnType<typeof guarded> => ({
      read: candidate.read.bind(candidate),
      events: candidate.events.bind(candidate),
      compareAndSwap(key, version, value, event) {
        if (event.kind === "service-failed")
          throw new Error("private-storage-failure");
        return candidate.compareAndSwap(key, version, value, event);
      },
      withGuard: (guard) => failEvidence(candidate.withGuard(guard)),
    });
    const failingStore = {
      read: store.read.bind(store),
      events: store.events.bind(store),
      compareAndSwap: root,
      withGuard: (guard: Parameters<typeof guarded>[0]) =>
        failEvidence(guarded(guard)),
    };
    const result = await runLocalOrchestrationPass({
      configuration,
      store: failingStore,
      tick: async () => {
        throw new Error("private-host-failure");
      },
    });
    expect(result.state).toBe("blocked");
    expect(result.failureEvidence).toBe("unacknowledged");
    expect(result.diagnostic).toContain("failure-evidence-unacknowledged");
    expect(
      store.events().filter((event) => event.kind === "service-failed"),
    ).toHaveLength(0);
    expect(readLocalOrchestrationFailure(store, configuration.id)).toBeNull();
    expect(JSON.stringify(result)).not.toContain("private-");
  });
});
