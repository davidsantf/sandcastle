import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  OrchestrationWorkspaceStore,
  initializeWorkspace,
  updateWorkspaceConfiguration,
  workspaceConfigurationKey,
} from "./OrchestrationWorkspace.js";
import {
  createOrchestrationProposalQueue,
  type OrchestrationProposal,
} from "./OrchestrationProposal.js";

const cli = path.resolve("dist", "main.js");
const folders: string[] = [];
const children: { child: ChildProcess; done: Promise<number | null> }[] = [];
afterEach(async () => {
  for (const { child, done } of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await done;
  }
  for (const folder of folders.splice(0))
    fs.rmSync(folder, { recursive: true, force: true });
});
function fixture() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "workspace-service-cli-"),
  );
  folders.push(directory);
  return {
    directory,
    database: path.join(directory, "state.sqlite"),
    controls: path.join(directory, "controls"),
  };
}
const args = (database: string, command: string, ...rest: string[]) => [
  cli,
  "orchestrate",
  "workspace",
  command,
  "--database",
  database,
  ...rest,
];
function capture(database: string, command: string, ...rest: string[]) {
  const result = spawnSync(process.execPath, args(database, command, ...rest), {
    encoding: "utf8",
    timeout: 40_000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}
function read(
  database: string,
  command: string,
  ...rest: string[]
): Record<string, unknown> {
  const result = capture(database, command, ...rest);
  if (result.code !== 0)
    throw new Error(`${command}: ${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}
async function start(database: string, controls: string, restart = false) {
  const child = spawn(
    process.execPath,
    args(
      database,
      restart ? "restart" : "start",
      "--control-directory",
      controls,
    ),
    {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  let stdout = "",
    stderr = "";
  const done = new Promise<number | null>((resolve) =>
    child.once("exit", resolve),
  );
  children.push({ child, done });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(new Error(`Service readiness timed out: ${stdout}\n${stderr}`)),
      40_000,
    );
    const finish = (error?: Error) => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    child.once("error", finish);
    child.once("exit", (code) =>
      finish(
        new Error(
          `Service exited before readiness (${code}): ${stdout}\n${stderr}`,
        ),
      ),
    );
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (
        stdout
          .split(/\r?\n/)
          .slice(0, -1)
          .some(
            (line) =>
              line.startsWith("{") && line.includes('"event":"service-ready"'),
          )
      )
        finish();
    });
  });
  return { child, done, output: () => stdout };
}
describe("compiled user-local service commands", () => {
  it("uses authenticated live controls, excludes manual/second owners, restarts and previews startup without installing", async () => {
    const f = fixture();
    const initial = read(f.database, "init");
    const blockedRun = capture(f.database, "run");
    expect(blockedRun.code).toBe(2);
    expect(JSON.parse(blockedRun.stdout).lastPass.result).toMatchObject({
      status: "blocked",
      evaluatedSources: 0,
    });
    const first = await start(f.database, f.controls);
    const control = (command: string, ...rest: string[]) =>
      read(f.database, command, "--control-directory", f.controls, ...rest);
    const live = control("status");
    expect(live.service).toMatchObject({
      state: expect.stringMatching(/idle|running/),
    });
    const notification = first
      .output()
      .split(/\r?\n/)
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line))
      .find((value) => value.event === "workspace-pass");
    expect(notification).toBeDefined();
    expect(live.lastPass).toMatchObject({
      passId: notification.passId,
      result: notification.result,
    });
    expect(control("pause").service).toMatchObject({ state: "paused" });
    const focusFile = path.join(f.directory, "narrow-focus.json");
    fs.writeFileSync(
      focusFile,
      JSON.stringify({ ...(initial.focus as object), maxConcurrency: 1 }),
    );
    expect(control("narrow-focus", "--file", focusFile).focus).toMatchObject({
      maxConcurrency: 1,
    });
    expect(control("resume").service).toMatchObject({ state: "idle" });
    expect(capture(f.database, "run").code).not.toBe(0);
    expect(
      capture(f.database, "start", "--control-directory", f.controls).code,
    ).not.toBe(0);
    expect(control("status").service).toMatchObject({
      operations: { reserved: 0, completed: 0 },
    });
    const artifact = control("startup");
    expect(artifact.content).toContain("start");
    expect(artifact.content).toContain("--database");
    expect(
      fs.existsSync(path.join(f.directory, String(artifact.filename))),
    ).toBe(false);
    const second = await start(f.database, f.controls, true);
    expect(await first.done).toBe(0);
    expect(control("status").service).toMatchObject({
      focus: { maxConcurrency: 1 },
    });
    expect(control("stop").service).toMatchObject({ state: "stopped" });
    expect(await second.done).toBe(0);
    expect(control("status")).toMatchObject({
      state: "not-running",
      owner: "released",
      lastFailure: null,
    });
    expect(read(f.database, "proposals")).toEqual([]);
  }, 120_000);

  it("does not advertise a ghost endpoint after immediate configuration failure, and migrates additive defaults without rewriting evidence", () => {
    const f = fixture();
    const store = new OrchestrationWorkspaceStore(f.database);
    const configuration = initializeWorkspace(store);
    const record = store.read(workspaceConfigurationKey);
    const { taskTemplates: _templates, ...legacy } = configuration;
    expect(
      store.compareAndSwap(
        workspaceConfigurationKey,
        record.version,
        { ...legacy, revision: 2 },
        { kind: "legacy-fixture", at: new Date().toISOString() },
      ),
    ).toBe(true);
    const priorEvents = store.events();
    store.close();
    const failed = capture(
      f.database,
      "start",
      "--control-directory",
      f.controls,
    );
    expect(failed.code, `${failed.stdout}\n${failed.stderr}`).toBe(2);
    expect(failed.stdout).not.toContain("service-ready");
    const result = JSON.parse(failed.stdout);
    expect(result.service).toMatchObject({
      state: "blocked",
      failureEvidence: "acknowledged",
      lastFailure: { phase: "configuration" },
    });
    expect(read(f.database, "status")).toMatchObject({
      state: "not-running",
      lastFailure: { phase: "configuration" },
    });
    expect(read(f.database, "migrate")).toMatchObject({
      revision: 3,
      taskTemplates: [],
    });
    const events = read(f.database, "events");
    expect(
      (events as unknown as unknown[]).slice(0, priorEvents.length),
    ).toEqual(priorEvents);
    const recovered = JSON.parse(capture(f.database, "run").stdout);
    expect(recovered.service).toMatchObject({ state: "stopped", passes: 1 });
    expect(recovered.lastPass.configurationRevision).toBe(3);
    expect(recovered.service.lastFailure.ownerId).not.toBe(
      recovered.service.ownerId,
    );
  }, 80_000);

  it("reviews a retained fixture proposal through the actual CLI with exact revision and digest bindings", async () => {
    const f = fixture();
    const store = new OrchestrationWorkspaceStore(f.database);
    let ready: OrchestrationProposal;
    try {
      initializeWorkspace(store);
      const configuration = updateWorkspaceConfiguration(
        store,
        1,
        (current) => ({
          ...current,
          projects: [
            {
              id: "api",
              repositoryRoot: f.directory,
              mode: "individual",
              hub: { kind: "github", repository: "fixture/api" },
            },
          ],
        }),
      );
      const queue = createOrchestrationProposalQueue({
        store,
        namespace: configuration.id,
      });
      const observed = queue.ingest(
        {
          sourceId: "fixture",
          projectId: "api",
          id: "1",
          url: "https://github.com/fixture/api/issues/1",
          kind: "issue",
          title: "Offline review fixture",
          body: "Fixture only, not a live generated plan",
          updatedAt: "2026-11-09T08:00:00Z",
          revision: "a".repeat(64),
          feedback: [],
          dependencies: [],
        },
        configuration.revision,
      );
      ready = await queue.plan(
        observed.id,
        async () => ({
          investigation: "Offline fixture call-path evidence only.",
          specification: "Preserve exact revision-bound human review.",
          plan: "Exercise the actual compiled command with retained evidence.",
          acceptance: [
            {
              criterion: "Wrong bindings cannot approve",
              verification: "Run the compiled review command regression",
            },
          ],
        }),
        AbortSignal.timeout(10_000),
      );
    } finally {
      store.close();
    }
    const reviewArgs = [
      "--id",
      ready.id,
      "--proposal-digest",
      ready.digest!,
      "--source-revision",
      ready.sourceRevision,
      "--revision",
      String(ready.configurationRevision),
      "--decision",
      "approve",
    ];
    expect(
      read(f.database, "proposal", "--id", ready.id).proposal,
    ).toMatchObject({ status: "ready", artifacts: ready.artifacts });
    const stale = [...reviewArgs];
    stale[stale.indexOf("--source-revision") + 1] = "b".repeat(64);
    expect(capture(f.database, "review", ...stale).code).toBe(2);
    expect(
      read(f.database, "proposal", "--id", ready.id).proposal,
    ).toMatchObject({ status: "ready" });
    expect(read(f.database, "review", ...reviewArgs)).toMatchObject({
      status: "approved",
      approval: {
        proposalDigest: ready.digest,
        sourceRevision: ready.sourceRevision,
        configurationRevision: ready.configurationRevision,
      },
    });
    expect(
      read(f.database, "proposal", "--id", ready.id).proposal,
    ).toMatchObject({ status: "approved", artifacts: ready.artifacts });
  }, 60_000);
});
