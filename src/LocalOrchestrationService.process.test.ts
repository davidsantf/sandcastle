import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  OrchestrationWorkspaceStore,
  initializeWorkspace,
  updateWorkspaceConfiguration,
  readWorkspaceConfiguration,
  registerWorkspaceProject,
} from "./OrchestrationWorkspace.js";
import { runLocalOrchestrationPass } from "./LocalOrchestrationService.js";
import { sendLocalOrchestrationControl } from "./LocalOrchestrationServiceControl.js";
import { readOrchestrationOperationSummary } from "./OrchestrationOperations.js";
import { waitForServiceCondition } from "./LocalOrchestrationServiceTestSupport.js";

const children: ChildProcess[] = [];
const folders: string[] = [];
const stores: OrchestrationWorkspaceStore[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    }
  }
  for (const store of stores.splice(0)) store.close();
  for (const folder of folders.splice(0))
    rmSync(folder, { recursive: true, force: true });
});

function fixture() {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "sandcastle-service-process-"),
  );
  folders.push(directory);
  const filename = path.join(directory, "orchestration.sqlite");
  const marker = path.join(directory, "fixture-effects.txt");
  const store = new OrchestrationWorkspaceStore(filename);
  stores.push(store);
  initializeWorkspace(store);
  registerWorkspaceProject(store, 1, {
    id: "app",
    repositoryRoot: directory,
    mode: "individual",
    hub: { kind: "github", repository: "fixture/app" },
  });
  const configuration = updateWorkspaceConfiguration(store, 2, (value) => ({
    ...value,
    pollIntervalMs: 100,
    focus: {
      ...value.focus,
      projectIds: ["app"],
      maxConcurrency: 1,
      budgets: { maxItems: 2, maxAttempts: 2, maxRuntimeMs: 10_000 },
      permissions: [{ projectId: "app", action: "discover" }],
    },
  }));
  const start = (mode = "normal") => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        fileURLToPath(
          new URL(
            "./LocalOrchestrationService.child-process.ts",
            import.meta.url,
          ),
        ),
        filename,
        directory,
        marker,
        mode,
      ],
      { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
    children.push(child);
    let output = "";
    let errors = "";
    child.stdout!.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr!.on("data", (chunk) => {
      errors += chunk.toString();
    });
    const ready = async () => {
      await waitForServiceCondition(() => {
        if (child.exitCode !== null)
          throw new Error(`child exited before ready: ${errors}`);
        return output.includes("service-ready");
      }, 20_000);
    };
    return { child, ready, output: () => output, errors: () => errors };
  };
  return { directory, filename, marker, store, configuration, start };
}

describe("real subprocess ownership, controls, and restart", () => {
  it("recovers a killed owner but never repeats its uncertain external intent", async () => {
    const f = fixture();
    const first = f.start("crash");
    await first.ready();
    await waitForServiceCondition(() =>
      first.output().includes("effect-started"),
    );
    await expect(
      runLocalOrchestrationPass({
        configuration: f.configuration,
        store: f.store,
        tick: async () => undefined,
      }),
    ).rejects.toThrow("service-already-owned");
    first.child.kill("SIGKILL");
    await new Promise<void>((resolve) =>
      first.child.once("exit", () => resolve()),
    );
    expect(
      readOrchestrationOperationSummary(f.store, f.configuration.id).reserved,
    ).toBe(1);
    const second = f.start();
    await second.ready();
    await waitForServiceCondition(() =>
      second.output().includes("pass-blocked"),
    );
    expect(readFileSync(f.marker, "utf8")).toBe("effect\n");
    const control = { directory: f.directory, workspaceId: f.configuration.id };
    expect(
      (await sendLocalOrchestrationControl(control, { action: "status" }))
        .operations.reserved,
    ).toBe(1);
    expect(
      (await sendLocalOrchestrationControl(control, { action: "stop" })).state,
    ).toBe("stopped");
    await waitForServiceCondition(() => second.child.exitCode !== null);
    expect(second.child.exitCode).toBe(0);
    expect(readWorkspaceConfiguration(f.store).id).toBe(f.configuration.id);
  }, 45_000);

  it("allows only one service process and keeps the original control channel usable", async () => {
    const f = fixture();
    const first = f.start();
    await first.ready();
    const competing = f.start();
    await waitForServiceCondition(
      () => competing.child.exitCode !== null,
      15_000,
    );
    expect(competing.child.exitCode).not.toBe(0);
    expect(competing.errors()).toContain("service-already-owned");
    expect(existsSync(f.marker)).toBe(true);
    await sendLocalOrchestrationControl(
      { directory: f.directory, workspaceId: f.configuration.id },
      { action: "stop" },
    );
    await waitForServiceCondition(() => first.child.exitCode !== null);
    expect(first.child.exitCode).toBe(0);
    expect(readFileSync(f.marker, "utf8")).toBe("effect\n");
  }, 40_000);
});
