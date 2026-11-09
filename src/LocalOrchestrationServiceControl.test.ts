import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  chmodSync,
} from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {
  startLocalOrchestrationControlChannel,
  sendLocalOrchestrationControl,
  createLocalOrchestrationStartupArtifact,
} from "./LocalOrchestrationServiceControl.js";
import {
  startLocalOrchestrationService,
  type LocalOrchestrationServiceHandle,
} from "./LocalOrchestrationService.js";
import {
  closeMemoryServiceStores,
  localServiceConfiguration,
  memoryServiceStore,
  waitForServiceCondition,
} from "./LocalOrchestrationServiceTestSupport.js";

const folders: string[] = [];
const handles: LocalOrchestrationServiceHandle[] = [];
const channels: { close(): Promise<void> }[] = [];
afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.stop();
  for (const channel of channels.splice(0)) await channel.close();
  closeMemoryServiceStores();
  for (const folder of folders.splice(0))
    rmSync(folder, { recursive: true, force: true });
});
const folder = () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "sandcastle-control-"));
  folders.push(directory);
  return directory;
};

describe("private authenticated local controls", () => {
  it("uses the real OS channel for status, pause, narrow focus, resume, and stop", async () => {
    const configuration = localServiceConfiguration();
    const options = { directory: folder(), workspaceId: configuration.id };
    let passes = 0;
    const handle = await startLocalOrchestrationService({
      configuration,
      store: memoryServiceStore(),
      tick: async () => {
        passes++;
      },
    });
    handles.push(handle);
    const channel = await startLocalOrchestrationControlChannel(
      handle,
      options,
    );
    channels.push(channel);
    expect(
      (await sendLocalOrchestrationControl(options, { action: "status" }))
        .ownerId,
    ).toBe(handle.status().ownerId);
    expect(
      (await sendLocalOrchestrationControl(options, { action: "pause" })).state,
    ).toBe("paused");
    const count = passes;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(passes).toBe(count);
    expect(
      (
        await sendLocalOrchestrationControl(options, {
          action: "focus",
          focus: {
            ...configuration.focus,
            maxConcurrency: 1,
            priorities: { app: 42 },
          },
        })
      ).focus.maxConcurrency,
    ).toBe(1);
    await expect(
      sendLocalOrchestrationControl(options, {
        action: "focus",
        focus: { ...configuration.focus, mode: "execute" },
      }),
    ).rejects.toThrow("control-rejected");
    await sendLocalOrchestrationControl(options, { action: "resume" });
    await waitForServiceCondition(() => passes > count);
    expect(
      (await sendLocalOrchestrationControl(options, { action: "stop" })).state,
    ).toBe("stopped");
  }, 30_000);

  it("rejects forged controls without state changes or credential disclosure", async () => {
    const configuration = localServiceConfiguration();
    const options = { directory: folder(), workspaceId: configuration.id };
    const handle = await startLocalOrchestrationService({
      configuration,
      store: memoryServiceStore(),
      tick: async () => undefined,
    });
    handles.push(handle);
    channels.push(await startLocalOrchestrationControlChannel(handle, options));
    const filename = readdirSync(options.directory).find((name) =>
      name.endsWith(".json"),
    )!;
    const descriptor = JSON.parse(
      readFileSync(path.join(options.directory, filename), "utf8"),
    );
    const lines: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection(descriptor.endpoint);
      socket.on("error", reject);
      socket.on("data", (chunk) => {
        lines.push(chunk.toString());
        if (lines.length === 1)
          socket.write(
            JSON.stringify({
              command: { action: "pause" },
              proof: "0".repeat(64),
            }) + "\n",
          );
      });
      socket.on("end", resolve);
    });
    expect(handle.status().state).not.toBe("paused");
    expect(lines.join("")).not.toContain(descriptor.secret);
    expect(lines.join("")).toContain("control-rejected");
  }, 30_000);

  it.skipIf(process.platform === "win32")(
    "refuses a broadly accessible POSIX control directory",
    async () => {
      const directory = folder();
      chmodSync(directory, 0o755);
      const handle = await startLocalOrchestrationService({
        configuration: localServiceConfiguration(),
        store: memoryServiceStore(),
        tick: async () => undefined,
      });
      handles.push(handle);
      await expect(
        startLocalOrchestrationControlChannel(handle, {
          directory,
          workspaceId: "fixture",
        }),
      ).rejects.toThrow("owner-only");
    },
  );
});

describe("startup preview, never registration", () => {
  it.each(["win32", "linux", "darwin"] as const)(
    "generates reviewable %s startup artifacts without installing",
    (platform) => {
      const artifact = createLocalOrchestrationStartupArtifact({
        platform,
        executable: process.execPath,
        args: [
          "--import",
          "tsx",
          "a script with spaces",
          'quote"inside',
          "amp&less<",
        ],
        workingDirectory: process.cwd(),
      });
      expect(artifact.diagnostic).toContain("Preview only");
      expect(artifact.content).toContain(
        platform === "linux" ? "[Service]" : "<?xml",
      );
      if (platform !== "linux")
        expect(artifact.content).toContain("amp&amp;less&lt;");
      if (platform === "win32") {
        expect(artifact.content).toContain("LeastPrivilege");
        expect(artifact.content).toContain("UTF-8");
      }
    },
  );
  it("rejects line injection and unsupported OS startup honestly", () => {
    expect(() =>
      createLocalOrchestrationStartupArtifact({
        executable: process.execPath,
        args: ["\nmalicious"],
        workingDirectory: process.cwd(),
      }),
    ).toThrow("single-line");
    expect(() =>
      createLocalOrchestrationStartupArtifact({
        platform: "freebsd",
        executable: process.execPath,
        args: [],
        workingDirectory: process.cwd(),
      }),
    ).toThrow("unsupported");
  });
});
