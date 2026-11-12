import { afterEach, describe, expect, it, vi } from "vitest";
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  sendLocalOrchestrationControl,
  startLocalOrchestrationControlChannel,
} from "./LocalOrchestrationServiceControl.js";
import {
  startLocalOrchestrationService,
  type LocalOrchestrationServiceHandle,
} from "./LocalOrchestrationService.js";
import {
  closeMemoryServiceStores,
  localServiceConfiguration,
  memoryServiceStore,
} from "./LocalOrchestrationServiceTestSupport.js";
import { orchestrationServiceDigest } from "./OrchestrationOperations.js";

const hooks = vi.hoisted(() => ({
  afterStat: undefined as ((filename: string) => void) | undefined,
  beforeRead: undefined as ((filename: string) => void) | undefined,
  afterRead: undefined as ((filename: string) => void) | undefined,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    lstatSync: (...args: Parameters<typeof actual.lstatSync>) => {
      const result = actual.lstatSync(...args);
      hooks.afterStat?.(String(args[0]));
      return result;
    },
    readFileSync: (...args: Parameters<typeof actual.readFileSync>) => {
      hooks.beforeRead?.(String(args[0]));
      const result = actual.readFileSync(...args);
      hooks.afterRead?.(String(args[0]));
      return result;
    },
  };
});

const folders: string[] = [];
const handles: LocalOrchestrationServiceHandle[] = [];
const channels: { close(): Promise<void> }[] = [];
afterEach(async () => {
  hooks.afterStat = hooks.beforeRead = hooks.afterRead = undefined;
  for (const handle of handles.splice(0)) await handle.stop();
  for (const channel of channels.splice(0)) await channel.close();
  closeMemoryServiceStores();
  for (const directory of folders.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

async function fixture() {
  const configuration = localServiceConfiguration();
  const directory = mkdtempSync(path.join(os.tmpdir(), "control-race-"));
  folders.push(directory);
  const options = { directory, workspaceId: configuration.id };
  const descriptor = path.join(
    directory,
    `${orchestrationServiceDigest(configuration.id)}.control.json`,
  );
  const store = memoryServiceStore();
  const handle = await startLocalOrchestrationService({
    configuration,
    store,
    tick: async () => undefined,
  });
  handles.push(handle);
  return { handle, options, descriptor, configuration, store };
}

function onceAt(
  boundary: "afterStat" | "beforeRead" | "afterRead",
  descriptor: string,
  action: () => void,
) {
  hooks[boundary] = (filename) => {
    if (filename !== descriptor) return;
    hooks[boundary] = undefined;
    action();
  };
}

function replaceDescriptor(descriptor: string) {
  const replacement = { ownerId: randomUUID(), endpoint: "successor" };
  const temporary = `${descriptor}.replacement`;
  writeFileSync(temporary, JSON.stringify(replacement), {
    flag: "wx",
    mode: 0o600,
  });
  renameSync(temporary, descriptor);
  return replacement;
}

describe("control descriptor lifecycle races", () => {
  it("starts when the old descriptor disappears between stat and privacy inspection", async () => {
    const { handle, options, descriptor } = await fixture();
    writeFileSync(descriptor, '{"ownerId":"old"}', { mode: 0o600 });
    onceAt("afterStat", descriptor, () => unlinkSync(descriptor));
    channels.push(await startLocalOrchestrationControlChannel(handle, options));
    expect(
      (await sendLocalOrchestrationControl(options, { action: "status" }))
        .ownerId,
    ).toBe(handle.status().ownerId);
  }, 30_000);

  it.each([false, true])(
    "does not suppress privacy failure when a descriptor remains (replacement=%s)",
    async (replace) => {
      const { handle, options, descriptor } = await fixture();
      writeFileSync(descriptor, '{"ownerId":"old"}', { mode: 0o600 });
      onceAt("afterStat", descriptor, () => {
        if (replace) replaceDescriptor(descriptor);
        throw new Error("control-path-privacy-unverified");
      });
      await expect(
        startLocalOrchestrationControlChannel(handle, options),
      ).rejects.toThrow("control-path-privacy-unverified");
      expect(lstatSync(descriptor).isFile()).toBe(true);
    },
    30_000,
  );

  it("closes when its descriptor disappears during privacy inspection", async () => {
    const { handle, options, descriptor } = await fixture();
    const channel = await startLocalOrchestrationControlChannel(
      handle,
      options,
    );
    onceAt("afterStat", descriptor, () => unlinkSync(descriptor));
    await expect(channel.close()).resolves.toBeUndefined();
    expect(lstatSync(descriptor, { throwIfNoEntry: false })).toBeUndefined();
  }, 30_000);

  it("closes when its verified descriptor disappears before the read", async () => {
    const { handle, options, descriptor } = await fixture();
    const channel = await startLocalOrchestrationControlChannel(
      handle,
      options,
    );
    onceAt("beforeRead", descriptor, () => unlinkSync(descriptor));
    await expect(channel.close()).resolves.toBeUndefined();
  }, 30_000);

  it("does not suppress a missing-read error when a replacement is now present", async () => {
    const { handle, options, descriptor } = await fixture();
    const channel = await startLocalOrchestrationControlChannel(
      handle,
      options,
    );
    onceAt("beforeRead", descriptor, () => {
      replaceDescriptor(descriptor);
      throw Object.assign(new Error("descriptor-read-interrupted"), {
        code: "ENOENT",
      });
    });
    await expect(channel.close()).rejects.toThrow(
      "descriptor-read-interrupted",
    );
    expect(JSON.parse(readFileSync(descriptor, "utf8")).endpoint).toBe(
      "successor",
    );
  }, 30_000);

  it("rejects replacement during verification without deleting the successor", async () => {
    const { handle, options, descriptor } = await fixture();
    const channel = await startLocalOrchestrationControlChannel(
      handle,
      options,
    );
    onceAt("afterStat", descriptor, () => {
      replaceDescriptor(descriptor);
    });
    await expect(channel.close()).rejects.toThrow(
      "control-descriptor-changed-during-privacy-verification",
    );
    expect(JSON.parse(readFileSync(descriptor, "utf8")).endpoint).toBe(
      "successor",
    );
  }, 30_000);

  it("preserves a successor replacing the descriptor after the old owner was read", async () => {
    const { handle, options, descriptor } = await fixture();
    const channel = await startLocalOrchestrationControlChannel(
      handle,
      options,
    );
    onceAt("afterRead", descriptor, () => {
      replaceDescriptor(descriptor);
    });
    await expect(channel.close()).resolves.toBeUndefined();
    expect(JSON.parse(readFileSync(descriptor, "utf8")).endpoint).toBe(
      "successor",
    );
  }, 30_000);

  it("keeps the successor authenticated channel usable after the old channel closes", async () => {
    const { handle, options, configuration, store } = await fixture();
    const channel = await startLocalOrchestrationControlChannel(
      handle,
      options,
    );
    await sendLocalOrchestrationControl(options, { action: "stop" });
    const successor = await startLocalOrchestrationService({
      configuration,
      store,
      tick: async () => undefined,
    });
    handles.push(successor);
    channels.push(
      await startLocalOrchestrationControlChannel(successor, options),
    );
    await expect(channel.close()).resolves.toBeUndefined();
    expect(
      (await sendLocalOrchestrationControl(options, { action: "status" }))
        .ownerId,
    ).toBe(successor.status().ownerId);
  }, 30_000);
});
