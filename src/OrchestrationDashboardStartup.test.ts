import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createServer } from "node:net";
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
async function until(check: () => Promise<boolean>, timeout = 40000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Dashboard supervisor fixture timed out");
}
async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test port");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}
async function fixture(source: string) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "dashboard-startup-"),
  );
  directories.push(directory);
  await fs.copyFile(
    path.resolve("scripts", "dashboard-startup", "Start-Dashboard.ps1"),
    path.join(directory, "Start-Dashboard.ps1"),
  );
  await fs.writeFile(
    path.join(directory, "launcher.json"),
    JSON.stringify({ nodeExe: process.execPath }),
  );
  await fs.writeFile(path.join(directory, "dashboard.json"), "{}");
  await fs.writeFile(path.join(directory, "dashboard.mjs"), source);
  return directory;
}
function launch(directory: string, port: number) {
  const child = spawn(
    powershell,
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(directory, "Start-Dashboard.ps1"),
      "-Port",
      String(port),
    ],
    { windowsHide: true, stdio: "ignore" },
  );
  children.push(child);
  return child;
}
async function events(directory: string): Promise<
  Array<{
    event: string;
    attempt?: number;
    childPid?: number;
    exitCode?: number;
  }>
> {
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
  for (const directory of directories) {
    await fs.writeFile(path.join(directory, "stop.request"), "test cleanup");
  }
  for (const child of children) {
    if (child.exitCode === null) {
      await until(async () => child.exitCode !== null, 15000);
    }
  }
  children.length = 0;
  for (const directory of directories)
    await fs.rm(directory, { recursive: true, force: true });
  directories.length = 0;
});

describe.skipIf(process.platform !== "win32")(
  "Windows dashboard supervisor",
  () => {
    it("holds an OS-backed singleton, logs readiness, recovers one crash and honors stop", async () => {
      const directory = await fixture(`
      import {createServer} from 'node:http';
      createServer((_,response)=>response.end(JSON.stringify({
        updatedAt: new Date().toISOString(), projects:[{name:'fixture'}]
      }))).listen(Number(process.argv[3]), '127.0.0.1');
    `);
      const port = await freePort();
      const owner = launch(directory, port);
      await until(async () =>
        (await events(directory)).some((e) => e.event === "ready"),
      );
      const second = launch(directory, port);
      await until(async () => second.exitCode !== null);
      expect(second.exitCode).toBe(0);
      expect(
        (await events(directory)).filter((e) => e.event === "child-started"),
      ).toHaveLength(1);
      expect(
        (await events(directory)).some((e) => e.event === "already-running"),
      ).toBe(true);
      const first = (await events(directory)).find(
        (e) => e.event === "child-started",
      );
      if (!first?.childPid) throw new Error("Missing supervised child");
      process.kill(first.childPid);
      await until(
        async () =>
          (await events(directory)).filter((e) => e.event === "ready")
            .length === 2,
      );
      expect(
        (await events(directory)).filter((e) => e.event === "child-started"),
      ).toHaveLength(2);
      await fs.writeFile(path.join(directory, "stop.request"), "stop");
      await until(async () => owner.exitCode !== null);
      expect(owner.exitCode).toBe(0);
      expect(
        (await events(directory)).some((e) => e.event === "stop-requested"),
      ).toBe(true);
    }, 65000);

    it("stops after three failed children with explicit exit evidence, never a fourth", async () => {
      const directory = await fixture("process.exit(7);");
      const owner = launch(directory, await freePort());
      await until(async () => owner.exitCode !== null, 65000);
      expect(owner.exitCode).toBe(1);
      const history = await events(directory);
      expect(
        history
          .filter((e) => e.event === "child-started")
          .map((e) => e.attempt),
      ).toEqual([1, 2, 3]);
      expect(
        history
          .filter((e) => e.event === "child-exited")
          .map((e) => e.exitCode),
      ).toEqual([7, 7, 7]);
      expect(history.at(-1)?.event).toBe("attempts-exhausted");
    }, 75000);

    it("fails closed on an unrelated listener without spawning or terminating it", async () => {
      const directory = await fixture("throw new Error('must not start');");
      const server = createServer();
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      try {
        const address = server.address();
        if (!address || typeof address === "string")
          throw new Error("Missing fixture port");
        const owner = launch(directory, address.port);
        await until(async () => owner.exitCode !== null);
        expect(owner.exitCode).toBe(2);
        expect(server.listening).toBe(true);
        expect((await events(directory)).map((e) => e.event)).toEqual([
          "port-conflict",
        ]);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }, 30000);
  },
);
