import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn, type ChildProcess } from "node:child_process";

const powershell = path.join(
  process.env.SystemRoot ?? "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);
const children: ChildProcess[] = [];
const directories: string[] = [];
async function until(check: () => Promise<boolean>, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Worker supervisor fixture timed out");
}
async function fixture(mode = "healthy") {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "worker-startup-"));
  directories.push(directory);
  await fs.copyFile(
    path.resolve("scripts", "worker-startup", "Start-Worker.ps1"),
    path.join(directory, "Start-Worker.ps1"),
  );
  await fs.writeFile(path.join(directory, "fixture.sqlite"), "fixture");
  await fs.writeFile(
    path.join(directory, "launcher.json"),
    JSON.stringify({
      nodeExe: process.execPath,
      database: path.join(directory, "fixture.sqlite"),
      workspaceId: "fixture",
      executableDirectories: [],
    }),
  );
  await fs.writeFile(
    path.join(directory, "worker.mjs"),
    `
import fs from 'node:fs';
const action=process.argv[4], mode=${JSON.stringify(mode)};
fs.appendFileSync('calls.jsonl',JSON.stringify({action,pid:process.pid})+'\\n');
if(action==='list'){console.log(JSON.stringify({id:'fixture',revision:20}));}
else if(action==='status'){
  if(mode==='unreachable'){console.error('sensitive-fixture-error');process.exit(2);}
  if(mode==='watch-dead'){console.log(JSON.stringify({owner:'dead'}));}
  else if(mode==='existing'){console.log(JSON.stringify({service:{state:'idle'}}));}
  else if(fs.existsSync('owner.pid')){
    let active=true; try{process.kill(Number(fs.readFileSync('owner.pid','utf8')),0);}catch{active=false;}
    console.log(JSON.stringify(active?{service:{state:'paused',ownerId:'fixture-owner'}}:{owner:'dead'}));
  }else console.log(JSON.stringify({owner:'released'}));
}else if(action==='start'){
  if(mode==='blocked')process.exit(2);
  if(mode==='crash')process.exit(7);
  fs.writeFileSync('owner.pid',String(process.pid));
  console.log(JSON.stringify({event:'service-ready',status:{ownerId:'fixture-owner'}}));
  setInterval(()=>{},1000);
}else if(action==='stop'){
  process.kill(Number(fs.readFileSync('owner.pid','utf8')));
  fs.rmSync('owner.pid'); console.log('{}');
}else process.exit(9);
`,
  );
  return directory;
}
function launch(directory: string) {
  const child = spawn(
    powershell,
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(directory, "Start-Worker.ps1"),
    ],
    { windowsHide: true, stdio: "ignore" },
  );
  children.push(child);
  return child;
}
async function events(
  directory: string,
): Promise<Array<{ event: string; exitCode?: number; state?: string }>> {
  try {
    return (
      await fs.readFile(
        path.join(directory, "logs", "supervisor.jsonl"),
        "utf8",
      )
    )
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
afterEach(async () => {
  for (const directory of directories)
    await fs.writeFile(path.join(directory, "stop.request"), "fixture cleanup");
  for (const child of children)
    if (child.exitCode === null)
      await until(async () => child.exitCode !== null, 30000);
  children.length = 0;
  for (const directory of directories)
    await fs.rm(directory, { recursive: true, force: true });
  directories.length = 0;
});

describe.skipIf(process.platform !== "win32")(
  "Windows worker supervisor",
  () => {
    it("keeps a singleton, preserves paused control, and stops without relaunching", async () => {
      const directory = await fixture();
      const owner = launch(directory);
      await until(async () =>
        (await events(directory)).some((e) => e.event === "ready"),
      );

      expect(
        (await events(directory)).find((e) => e.event === "ready")?.state,
      ).toBe("paused");
      const duplicate = launch(directory);
      await until(async () => duplicate.exitCode !== null);
      expect(duplicate.exitCode).toBe(0);
      await fs.writeFile(path.join(directory, "stop.request"), "stop");
      await until(async () => owner.exitCode !== null);
      expect(owner.exitCode).toBe(0);
      expect(
        (await events(directory)).filter((e) => e.event === "child-started"),
      ).toHaveLength(1);
      const calls = await fs.readFile(
        path.join(directory, "calls.jsonl"),
        "utf8",
      );
      expect(calls).toContain('"action":"stop"');
      expect(calls).not.toContain('"action":"resume"');
    }, 65000);

    it.each(["existing", "unreachable"])(
      "does not launch over an %s owner",
      async (mode) => {
        const directory = await fixture(mode);
        const owner = launch(directory);
        await until(async () => owner.exitCode !== null);
        expect(owner.exitCode).not.toBe(0);
        const history = await events(directory);
        expect(history.some((e) => e.event === "child-started")).toBe(false);
        expect(JSON.stringify(history)).not.toContain(
          "sensitive-fixture-error",
        );
      },
    );

    it("does not retry a durable blocked/unknown outcome", async () => {
      const directory = await fixture("blocked");
      const owner = launch(directory);
      await until(async () => owner.exitCode !== null);
      expect(owner.exitCode).toBe(2);
      const history = await events(directory);
      expect(history.filter((e) => e.event === "child-started")).toHaveLength(
        1,
      );
      expect(history.at(-1)?.event).toBe("worker-blocked");
    });

    it("caps unexpected crashes at three launches with numeric exit evidence", async () => {
      const directory = await fixture("crash");
      const owner = launch(directory);
      await until(async () => owner.exitCode !== null, 65000);
      expect(owner.exitCode).toBe(1);
      const history = await events(directory);
      expect(history.filter((e) => e.event === "child-started")).toHaveLength(
        3,
      );
      expect(
        history
          .filter((e) => e.event === "child-exited")
          .map((e) => e.exitCode),
      ).toEqual([7, 7, 7]);
      expect(history.at(-1)?.event).toBe("attempts-exhausted");
    }, 75000);
  },
);

async function watchdogFixture(mode: string, taskState = "Ready", fence = "") {
  const directory = await fixture(mode);
  await fs.copyFile(
    path.resolve("scripts", "worker-startup", "Watch-Workers.ps1"),
    path.join(directory, "Watch-Workers.ps1"),
  );
  await fs.writeFile(
    path.join(directory, "worker-watchdog.json"),
    JSON.stringify({
      workers: [{ taskName: "Sandcastle Worker fixture", directory }],
    }),
  );
  await fs.writeFile(
    path.join(directory, "installation.json"),
    JSON.stringify({ executable: "fixture.exe", arguments: "fixture" }),
  );
  await fs.writeFile(
    path.join(directory, "watch-fixture.ps1"),
    `
$global:taskReads = 0
function Get-ScheduledTask {
  $global:taskReads++
  $executable = 'fixture.exe'
  if ($global:taskReads -ge 2 -and '${fence}' -eq 'action') { $executable = 'changed.exe' }
  if ($global:taskReads -ge 2 -and '${fence}' -eq 'disable') { Set-Content (Join-Path $PSScriptRoot 'worker-watchdog.disabled') 'disabled' }
  return [pscustomobject]@{ State = '${taskState}'; Actions = [pscustomobject]@{ Execute = $executable; Arguments = 'fixture' } }
}
function Start-ScheduledTask { [IO.File]::AppendAllText((Join-Path $PSScriptRoot 'starts.txt'), "start\\n") }
& (Join-Path $PSScriptRoot 'Watch-Workers.ps1') -Once
exit $LASTEXITCODE
`,
  );
  return directory;
}
async function watchOnce(directory: string) {
  const child = spawn(
    powershell,
    [
      "-NoProfile",
      "-NonInteractive",
      "-File",
      path.join(directory, "watch-fixture.ps1"),
    ],
    { windowsHide: true, stdio: "ignore" },
  );
  children.push(child);
  await until(async () => child.exitCode !== null);
  expect(child.exitCode).toBe(0);
  return JSON.parse(
    await fs.readFile(
      path.join(directory, "worker-watchdog-state.json"),
      "utf8",
    ),
  ).workers[0] as { starts: number; status: string };
}
describe.skipIf(process.platform !== "win32")(
  "Dashboard worker watchdog",
  () => {
    it("persists its three-start cap across reopen and rechecks dead ownership", async () => {
      const directory = await watchdogFixture("watch-dead");
      for (let count = 1; count <= 3; count++) {
        const observed = await watchOnce(directory);
        expect(observed.starts).toBe(count);
        if (count === 1) {
          expect(await watchOnce(directory)).toMatchObject({
            starts: 1,
            status: "restart-backoff",
          });
        }
        const statePath = path.join(directory, "worker-watchdog-state.json");
        const state = JSON.parse(await fs.readFile(statePath, "utf8"));
        state.workers[0].lastAttemptAt = "2020-01-01T00:00:00Z";
        await fs.writeFile(statePath, JSON.stringify(state));
      }
      expect(await watchOnce(directory)).toMatchObject({
        starts: 3,
        status: "watchdog-restarts-exhausted",
      });
      expect(
        (await fs.readFile(path.join(directory, "starts.txt"), "utf8")).match(
          /start/g,
        ),
      ).toHaveLength(3);
      const calls = await fs.readFile(
        path.join(directory, "calls.jsonl"),
        "utf8",
      );
      expect(calls.match(/"action":"status"/g)).toHaveLength(8);
      expect(calls).not.toContain('"action":"start"');
    });
    it.each([
      ["existing", "Ready", "owner-idle"],
      ["healthy", "Ready", "released-no-automatic-resume"],
      ["watch-dead", "Disabled", "intentionally-disabled-or-stopped"],
      [
        "unreachable",
        "Ready",
        "control-or-registration-unconfirmed-no-restart",
      ],
      ["watch-dead", "Running", "worker-supervisor-handling-recovery"],
    ])("holds %s / %s without restarting", async (mode, taskState, status) => {
      const directory = await watchdogFixture(mode!, taskState!);
      expect(await watchOnce(directory)).toMatchObject({ starts: 0, status });
      await expect(
        fs.stat(path.join(directory, "starts.txt")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    });
    it.each(["action", "disable"])(
      "rechecks the %s fence before requesting a task start",
      async (fence) => {
        const directory = await watchdogFixture("watch-dead", "Ready", fence);
        expect(await watchOnce(directory)).toMatchObject({
          starts: 0,
          status: "restart-fence-changed",
        });
        await expect(
          fs.stat(path.join(directory, "starts.txt")),
        ).rejects.toMatchObject({ code: "ENOENT" });
      },
    );
    it("honors intentional stop and durable blocked/exhausted supervisor outcomes", async () => {
      const directory = await watchdogFixture("watch-dead");
      await fs.writeFile(path.join(directory, "stop.request"), "intentional");
      expect((await watchOnce(directory)).status).toBe(
        "intentionally-disabled-or-stopped",
      );
      await fs.rm(path.join(directory, "stop.request"));
      await fs.mkdir(path.join(directory, "logs"), { recursive: true });
      for (const event of ["worker-blocked", "attempts-exhausted"]) {
        await fs.writeFile(
          path.join(directory, "logs", "supervisor.jsonl"),
          JSON.stringify({ event }),
        );
        expect(await watchOnce(directory)).toMatchObject({
          starts: 0,
          status: "held-for-inspection-no-restart",
        });
      }
    });
  },
);
