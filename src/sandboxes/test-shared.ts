/**
 * Shared helper for filesystem-backed test sandbox providers.
 *
 * Implements "run commands in a temp directory" — process spawning,
 * working-directory management, exit code propagation, cleanup. Both
 * `testBindMount` and `testIsolated` are thin adaptors over this helper.
 */

import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createInterface } from "node:readline";
import {
  createBindMountSandboxProvider,
  type BindMountSandboxHandle,
  type BindMountSandboxProvider,
  type ExecResult,
} from "../SandboxProvider.js";
import { BoundedTail, MAX_TAIL_CHARS } from "../boundedTail.js";

const execFileAsync = promisify(execFile);

/**
 * T3 / AC3: Node and the POSIX shell have different roots on Windows. Ask the
 * same shell that executes commands to translate paths (not command output).
 * In particular, shell /tmp is not Node's C:\\tmp. Arguments are passed
 * separately so spaces, quotes and shell metacharacters remain path data.
 */
const translatePath = async (
  path: string,
  format: "-aw" | "-au",
  cwd: string,
): Promise<string> => {
  if (process.platform !== "win32") return resolve(cwd, path);
  const { stdout } = await execFileAsync(
    "sh",
    ["-c", 'cygpath "$1" -- "$2"', "sandcastle-path", format, path],
    { cwd },
  );
  return stdout.trimEnd();
};

export const sandboxPathToNative = (
  path: string,
  nativeCwd = process.cwd(),
): Promise<string> => translatePath(path, "-aw", nativeCwd);

export const nativePathToSandbox = (path: string): Promise<string> =>
  translatePath(path, "-au", process.cwd());

interface TestExecOptions {
  onLine?: (line: string) => void;
  cwd?: string;
  sudo?: boolean;
  stdin?: string;
}

/** Run the sandbox's POSIX contract, independently of the host default shell. */
export const createSandboxExec = (
  nativeWorktreePath: string,
  env = process.env,
) => {
  const nativeCwds = new Map<string, Promise<string>>();
  return async (
    command: string,
    options?: TestExecOptions,
  ): Promise<ExecResult> => {
    let nativeCwd = nativeWorktreePath;
    if (options?.cwd !== undefined) {
      let mapped = nativeCwds.get(options.cwd);
      if (!mapped) {
        mapped = sandboxPathToNative(options.cwd, nativeWorktreePath);
        nativeCwds.set(options.cwd, mapped);
      }
      nativeCwd = await mapped;
    }
    // Windows locks a process's native startup cwd against deletion. Enter the
    // requested directory through POSIX cd instead so syncIn can replace it.
    // Both values remain separate arguments; no command or output substitution.
    const cwd = process.platform === "win32" ? process.cwd() : nativeCwd;
    const args =
      process.platform === "win32"
        ? [
            "-c",
            'cd -- "$1" && eval "shift 2; $2"',
            "sandcastle-exec",
            nativeCwd,
            command,
          ]
        : ["-c", command];
    if (options?.onLine) {
      const onLine = options.onLine;
      return new Promise((resolve, reject) => {
        const proc = spawn("sh", args, {
          cwd,
          env,
          stdio: [
            options.stdin === undefined ? "ignore" : "pipe",
            "pipe",
            "pipe",
          ],
        });
        if (options.stdin !== undefined) proc.stdin!.end(options.stdin);
        const stdoutTail = new BoundedTail(MAX_TAIL_CHARS, "\n");
        const stderrTail = new BoundedTail(MAX_TAIL_CHARS, "");
        const rl = createInterface({ input: proc.stdout! });
        rl.on("line", (line) => {
          stdoutTail.push(line);
          onLine(line);
        });
        proc.stderr!.on("data", (chunk: Buffer) => {
          stderrTail.push(chunk.toString());
        });
        proc.on("error", (error) => {
          reject(new Error(`exec failed: ${error.message}`));
        });
        proc.on("close", (code) => {
          resolve({
            stdout: stdoutTail.toString(),
            stderr: stderrTail.toString(),
            exitCode: code ?? 0,
          });
        });
      });
    }
    return new Promise((resolve, reject) => {
      const proc = execFile(
        "sh",
        args,
        {
          cwd,
          env,
          maxBuffer: 10 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          if (error && typeof error.code !== "number") {
            reject(new Error(`exec failed: ${error.message}`));
          } else {
            resolve({
              stdout: stdout.toString(),
              stderr: stderr.toString(),
              exitCode: typeof error?.code === "number" ? error.code : 0,
            });
          }
        },
      );
      proc.stdin?.end(options?.stdin);
    });
  };
};

export interface TempSandbox {
  /** POSIX shell path, suitable for sandbox commands, never a native host path. */
  readonly worktreePath: string;
  readonly toNativePath: (sandboxPath: string) => Promise<string>;
  readonly exec: ReturnType<typeof createSandboxExec>;
  readonly close: () => Promise<void>;
}

export const createTempSandbox = async (
  prefix: string,
): Promise<TempSandbox> => {
  const sandboxRoot = await mkdtemp(join(tmpdir(), prefix));
  const nativeWorktreePath = join(sandboxRoot, "workspace");
  try {
    await mkdir(nativeWorktreePath, { recursive: true });
    return {
      worktreePath: await nativePathToSandbox(nativeWorktreePath),
      toNativePath: (path) => sandboxPathToNative(path, nativeWorktreePath),
      exec: createSandboxExec(nativeWorktreePath),
      close: () => rm(sandboxRoot, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(sandboxRoot, { recursive: true, force: true });
    throw error;
  }
};

export interface StubProviderRecord {
  readonly provider: BindMountSandboxProvider;
  readonly createCalls: ReadonlyArray<unknown>;
  readonly closeCalls: { count: number };
}

/**
 * Create a no-op bind-mount sandbox provider that records `create`/`close` calls.
 * For tests that verify call contracts without exercising filesystem behaviour.
 */
export const testStubProvider = (
  options: { name?: string; worktreePath?: string } = {},
): StubProviderRecord => {
  const createCalls: unknown[] = [];
  const closeCalls = { count: 0 };
  const provider = createBindMountSandboxProvider({
    name: options.name ?? "test-stub",
    create: async (createOptions) => {
      createCalls.push(createOptions);
      const handle: BindMountSandboxHandle = {
        worktreePath: options.worktreePath ?? "/home/agent/workspace",
        exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
        copyFileIn: async () => {},
        copyFileOut: async () => {},
        close: async () => {
          closeCalls.count++;
        },
      };
      return handle;
    },
  });
  return { provider, createCalls, closeCalls };
};
