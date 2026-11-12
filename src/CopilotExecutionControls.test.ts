import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Effect } from "effect";
import { copilot } from "./AgentProvider.js";
import { copilotExecutionControlsSchema } from "./CopilotExecutionControls.js";
import { noSandbox } from "./sandboxes/no-sandbox.js";
import { makeSandboxFromHandle } from "./SandboxFactory.js";
import { defaultWorkspaceConfiguration } from "./OrchestrationWorkspace.js";
import { parseWorkspaceConfiguration } from "./OrchestrationWorkspaceContract.js";

const controls = {
  profile: "local-files" as const,
  maxAiCredits: 30,
  maxAutopilotContinues: 0,
  timeoutMs: 2000,
  disabledMcpServers: ["fixture-mcp"],
};
const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0))
    fs.rmSync(folder, { recursive: true, force: true });
});
const folder = () => {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), "bounded-native-"));
  folders.push(value);
  return value;
};
describe("host-owned native execution controls", () => {
  it("generates exact shell-free argv and overrides broad inherited auto-approval", () => {
    const agent = copilot("auto", {
      agent: "devsquad:devsquad.implement",
      pluginDirectory: process.cwd(),
      executionControls: controls,
      fileScopes: ["src/value.txt"],
      env: { COPILOT_ALLOW_ALL: "true", COPILOT_ASSISTED_APPROVAL: "true" },
    });
    const prompt = "quotes ' \" & %PATH% | $(exit) \n next line";
    const command = agent.buildPrintCommand({
      prompt,
      dangerouslySkipPermissions: true,
    });
    expect(command.process).toMatchObject({
      file: "copilot",
      timeoutMs: 2000,
      scopedFiles: ["src/value.txt"],
    });
    const args = command.process!.args;
    expect(args.slice(0, 6)).toEqual([
      "-p",
      prompt,
      "--output-format",
      "json",
      "--model",
      "auto",
    ]);
    for (const pair of [
      ["--agent", "devsquad:devsquad.implement"],
      ["--plugin-dir", process.cwd()],
      ["--max-ai-credits", "30"],
      ["--max-autopilot-continues", "0"],
      ["--disable-mcp-server", "fixture-mcp"],
      ["--deny-tool", "shell"],
      ["--deny-tool", "url"],
      ["--deny-tool", "memory"],
    ])
      expect(args.join("\0")).toContain(pair.join("\0"));
    expect(args).toContain("--disable-builtin-mcps");
    expect(args).toContain("--sync-session=off");
    expect(args).not.toContain("--allow-all-tools");
    expect(agent.env).toMatchObject({
      COPILOT_ALLOW_ALL: "false",
      COPILOT_ASSISTED_APPROVAL: "false",
      LLMLAB_PYTHON_AUTO_SETUP: "0",
    });
    expect(() =>
      agent.buildInteractiveArgs!({
        prompt,
        dangerouslySkipPermissions: false,
      }),
    ).toThrow(/non-interactive/);
  });
  it("rejects process-local plugin loading without explicit controls or an absolute path", () => {
    expect(() => copilot("auto", { pluginDirectory: process.cwd() })).toThrow();
    expect(() =>
      copilot("auto", {
        pluginDirectory: "../plugin",
        executionControls: controls,
        fileScopes: ["README.md"],
      }),
    ).toThrow();
  });
  it.each([
    { maxAiCredits: 29 },
    { maxAiCredits: Infinity },
    { timeoutMs: 0 },
    { maxAutopilotContinues: -1 },
    { profile: "unrestricted" },
    { disabledMcpServers: ["same", "same"] },
    { availableTools: ["shell"] },
  ])("rejects invalid/unsupported controls %j", (change) => {
    expect(() =>
      copilotExecutionControlsSchema.parse({ ...controls, ...change }),
    ).toThrow();
    const config = defaultWorkspaceConfiguration();
    expect(() =>
      parseWorkspaceConfiguration({
        ...config,
        runtime: {
          ...config.runtime,
          executionControls: { ...controls, ...change },
        },
      }),
    ).toThrow();
  });
  it.each([
    "../escape",
    "/absolute",
    "C:\\absolute",
    ".git/config",
    "src/**",
    "src/value)",
    "src/{one,two}",
  ])("rejects nonliteral or escaping scope %s", (scope) => {
    expect(() =>
      copilot("auto", { executionControls: controls, fileScopes: [scope] }),
    ).toThrow();
  });
  it("never downgrades unsupported backend controls to a shell", async () => {
    const exec = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    const sandbox = makeSandboxFromHandle({
      worktreePath: process.cwd(),
      exec,
      interactiveExec: async () => ({ exitCode: 0 }),
      close: async () => {},
    });
    await expect(
      Effect.runPromise(
        sandbox.exec("must not execute", {
          process: { file: process.execPath, args: [], timeoutMs: 1000 },
        }),
      ),
    ).rejects.toThrow(/does not support bounded direct/);
    expect(exec).not.toHaveBeenCalled();
  });
  it("transports exact special argv and derives absolute task approvals in the real host runner", async () => {
    const cwd = folder();
    fs.mkdirSync(path.join(cwd, "src"));
    fs.writeFileSync(path.join(cwd, "src", "value.txt"), "fixture");
    const handle = await noSandbox().create({ worktreePath: cwd, env: {} });
    const special = "a ' \" & %PATH% | $(exit)\nline";
    const result = await handle.execFile!(
      process.execPath,
      ["-e", "console.log(JSON.stringify(process.argv.slice(1)))", special],
      {
        signal: new AbortController().signal,
        timeoutMs: 3000,
        scopedFiles: ["src/value.txt"],
      },
    );
    const args = JSON.parse(result.stdout);
    expect(args).toEqual([
      special,
      "--allow-tool",
      `read(${path.join(fs.realpathSync.native(cwd), "src", "value.txt")})`,
      "--allow-tool",
      `write(${path.join(fs.realpathSync.native(cwd), "src", "value.txt")})`,
    ]);
    await handle.close();
  });
  it("kills the owned process tree on an actual deadline", async () => {
    const cwd = folder();
    const childPid = path.join(cwd, "child.pid");
    const handle = await noSandbox().create({ worktreePath: cwd, env: {} });
    const script = `const {spawn}=require("node:child_process");const fs=require("node:fs");const p=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"inherit"});fs.writeFileSync(${JSON.stringify(childPid)},String(p.pid));console.log("ready");setInterval(()=>{},1000);`;
    await expect(
      handle.execFile!(process.execPath, ["-e", script], {
        signal: new AbortController().signal,
        timeoutMs: 1200,
      }),
    ).rejects.toThrow(/deadline|canceled/);
    const pid = Number(fs.readFileSync(childPid, "utf8"));
    expect(() => process.kill(pid, 0)).toThrow();
    await handle.close();
  }, 15000);
  it("rejects unrepresentable root approvals before spawning", async () => {
    const cwd = path.join(folder(), "root (not a literal rule)");
    fs.mkdirSync(cwd);
    const marker = path.join(cwd, "must-not-run");
    const handle = await noSandbox().create({ worktreePath: cwd, env: {} });
    await expect(
      handle.execFile!(
        process.execPath,
        [
          "-e",
          `require("node:fs").writeFileSync(${JSON.stringify(marker)},"wrong")`,
        ],
        {
          signal: new AbortController().signal,
          timeoutMs: 2000,
          scopedFiles: ["src/value.txt"],
        },
      ),
    ).rejects.toThrow(/literal tool approvals/);
    expect(fs.existsSync(marker)).toBe(false);
    await handle.close();
  });
  it("cancels actual direct execution through the Effect runner and awaits cleanup", async () => {
    const cwd = folder();
    const handle = await noSandbox().create({ worktreePath: cwd, env: {} });
    const sandbox = makeSandboxFromHandle(handle);
    let pid = 0;
    const controller = new AbortController();
    const result = Effect.runPromise(
      sandbox.exec("unused shell", {
        process: {
          file: process.execPath,
          args: ["-e", "console.log(process.pid);setInterval(()=>{},1000)"],
          timeoutMs: 10000,
        },
        onLine: (line) => {
          pid = Number(line);
          controller.abort();
        },
      }),
      { signal: controller.signal },
    );
    await expect(result).rejects.toThrow();
    await handle.close();
    expect(pid).toBeGreaterThan(0);
    expect(() => process.kill(pid, 0)).toThrow();
  }, 15000);
});
