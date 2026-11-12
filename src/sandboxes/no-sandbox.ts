/**
 * No-sandbox provider — runs the agent directly on the host with no container isolation.
 *
 * Usage:
 *   import { noSandbox } from "sandcastle/sandboxes/no-sandbox";
 *   await interactive({ agent: claudeCode("claude-opus-4-8"), sandbox: noSandbox() });
 *
 * Accepted by `run()`, `interactive()`, and `createSandbox()`. Skips
 * container isolation entirely — the agent executes on the host. Does not
 * pass `--dangerously-skip-permissions` to the agent — the user manages
 * permissions themselves.
 */

import { spawn, execFile, type StdioOptions } from "node:child_process";
import path from "node:path";
import { access, lstat, realpath } from "node:fs/promises";
import { createInterface } from "node:readline";
import type {
  NoSandboxProvider,
  NoSandboxHandle,
  ExecResult,
  InteractiveExecOptions,
} from "../SandboxProvider.js";
import { BoundedTail, MAX_TAIL_CHARS } from "../boundedTail.js";
import { assertCopilotFileScopes } from "../CopilotExecutionControls.js";

export interface NoSandboxOptions {
  /** Environment variables injected by this provider. Merged at launch time. */
  readonly env?: Record<string, string>;
  /**
   * Maximum number of characters of streamed `exec` output retained per stream
   * (stdout and stderr) when an `onLine` callback is supplied (default: 64KiB).
   *
   * Output is delivered live to `onLine` regardless; this only bounds the tail
   * returned in `ExecResult`, preventing a long-running agent's output from
   * overflowing V8's max string length and crashing the run.
   */
  readonly maxOutputTailChars?: number;
}

const windowsTreeTerminator = path.join(
  process.env.SystemRoot ?? "C:\\Windows",
  "System32",
  "taskkill.exe",
);
export async function assertDirectProcessSupport(): Promise<void> {
  if (!["win32", "linux", "darwin"].includes(process.platform))
    throw new Error(
      "Bounded process-tree execution is unsupported on this platform",
    );
  if (process.platform === "win32") await access(windowsTreeTerminator);
}

/**
 * Create a no-sandbox provider.
 *
 * The returned provider runs the agent directly on the host. All three
 * branch strategies are supported (head, merge-to-head, branch),
 * defaulting to head.
 */
export const noSandbox = (options?: NoSandboxOptions): NoSandboxProvider => ({
  tag: "none",
  name: "no-sandbox",
  env: options?.env ?? {},
  create: async (createOptions): Promise<NoSandboxHandle> => {
    const worktreePath = createOptions.worktreePath;
    const processEnv = { ...process.env, ...createOptions.env };
    const maxOutputTailChars = options?.maxOutputTailChars ?? MAX_TAIL_CHARS;
    const active = new Map<AbortController, Promise<ExecResult>>();

    const handle: NoSandboxHandle = {
      worktreePath,
      execFile: async (file, args, opts) => {
        opts.signal.throwIfAborted();
        if (!Number.isSafeInteger(opts.timeoutMs) || opts.timeoutMs < 1)
          throw new Error("Direct process timeout must be a positive integer");
        await assertDirectProcessSupport();
        const cwd = opts.cwd ?? worktreePath;
        const argv = [...args];
        if (opts.scopedFiles) {
          assertCopilotFileScopes(opts.scopedFiles);
          const canonical = await realpath(cwd);
          if (/[\u0000-\u001f()*?[\]{}]/.test(canonical))
            throw new Error(
              "Local file root cannot be represented by literal tool approvals",
            );
          for (const scope of opts.scopedFiles) {
            let target = canonical;
            let directory = false;
            for (const part of scope.split(/[\\/]/)) {
              target = path.join(target, part);
              try {
                const metadata = await lstat(target);
                if (metadata.isSymbolicLink())
                  throw new Error(
                    "Symbolic links are not supported in local file scopes",
                  );
                directory = metadata.isDirectory();
              } catch (error) {
                if (
                  !(
                    error instanceof Error &&
                    "code" in error &&
                    error.code === "ENOENT"
                  )
                )
                  throw error;
                directory = false;
              }
            }
            for (const kind of ["read", "write"])
              argv.push(
                "--allow-tool",
                `${kind}(${target}${directory ? `${path.sep}**` : ""})`,
              );
          }
        }
        opts.signal.throwIfAborted();
        const controller = new AbortController();
        const abort = () => controller.abort(opts.signal.reason);
        opts.signal.addEventListener("abort", abort, { once: true });
        const execution = new Promise<ExecResult>((resolve, reject) => {
          const stdout = new BoundedTail(maxOutputTailChars, "\n");
          const stderr = new BoundedTail(maxOutputTailChars, "");
          // A separate POSIX group permits cancellation of descendants as well as the CLI.
          const proc = spawn(file, argv, {
            cwd,
            env: processEnv,
            shell: false,
            detached: process.platform !== "win32",
            stdio: [
              opts.stdin === undefined ? "ignore" : "pipe",
              "pipe",
              "pipe",
            ],
          });
          let canceled = false;
          let termination: Promise<void> | undefined;
          const terminate = () => {
            if (canceled) return;
            canceled = true;
            if (proc.pid === undefined) return;
            const pid = proc.pid;
            termination = new Promise<void>((done, fail) => {
              if (process.platform === "win32") {
                // /PID and /T target only this owned child and its descendants.
                execFile(
                  windowsTreeTerminator,
                  ["/PID", String(pid), "/T", "/F"],
                  { windowsHide: true, timeout: 10000 },
                  (error) => {
                    if (
                      error &&
                      proc.exitCode === null &&
                      proc.signalCode === null
                    )
                      fail(new Error("Owned process-tree termination failed"));
                    else done();
                  },
                );
              } else {
                try {
                  process.kill(-pid, "SIGKILL");
                  done();
                } catch (error) {
                  if (
                    error instanceof Error &&
                    "code" in error &&
                    error.code === "ESRCH"
                  )
                    done();
                  else fail(error);
                }
              }
            });
            // Observe rejection immediately; settlement below reports it.
            void termination.catch((error) => {
              cleanup();
              reject(error);
            });
          };
          controller.signal.addEventListener("abort", terminate, {
            once: true,
          });
          const timer = setTimeout(
            () =>
              controller.abort(new Error("Direct process deadline exceeded")),
            opts.timeoutMs,
          );
          const cleanup = () => {
            clearTimeout(timer);
            controller.signal.removeEventListener("abort", terminate);
          };
          if (opts.stdin !== undefined) proc.stdin!.end(opts.stdin);
          const lines = createInterface({ input: proc.stdout! });
          lines.on("line", (line) => {
            stdout.push(line);
            opts.onLine?.(line);
          });
          proc.stderr!.on("data", (chunk: Buffer) =>
            stderr.push(chunk.toString()),
          );
          proc.once("error", (error) => {
            cleanup();
            reject(new Error(`Direct process launch failed: ${error.message}`));
          });
          proc.once("close", async (code) => {
            cleanup();
            try {
              await termination;
              if (canceled)
                throw new Error(
                  "Direct process canceled or deadline exceeded; outcome is unknown",
                );
              resolve({
                stdout: stdout.toString(),
                stderr: stderr.toString(),
                exitCode: code ?? 1,
              });
            } catch (error) {
              reject(error);
            }
          });
          if (controller.signal.aborted) terminate();
        });
        active.set(controller, execution);
        try {
          return await execution;
        } finally {
          opts.signal.removeEventListener("abort", abort);
          active.delete(controller);
        }
      },

      exec: (
        command: string,
        opts?: {
          onLine?: (line: string) => void;
          cwd?: string;
          sudo?: boolean;
          stdin?: string;
        },
      ): Promise<ExecResult> => {
        // sudo is a no-op for no-sandbox — the user is already on the host
        const cwd = opts?.cwd ?? worktreePath;
        const isWindows = process.platform === "win32";
        // PowerShell and cmd.exe don't ship `sh`, so on Windows route the
        // command string through cmd.exe instead. `/d` skips AutoRun, `/s`
        // preserves the quoted command verbatim, `/c` runs it and exits.
        // `windowsVerbatimArguments` keeps Node from re-quoting our args.
        const shellCmd = isWindows ? "cmd.exe" : "sh";
        const shellArgs = isWindows
          ? ["/d", "/s", "/c", command]
          : ["-c", command];

        return new Promise((resolve, reject) => {
          const proc = spawn(shellCmd, shellArgs, {
            cwd,
            env: processEnv,
            stdio: [
              opts?.stdin !== undefined ? "pipe" : "ignore",
              "pipe",
              "pipe",
            ],
            windowsVerbatimArguments: isWindows,
          });

          if (opts?.stdin !== undefined) {
            proc.stdin!.write(opts.stdin);
            proc.stdin!.end();
          }

          proc.on("error", (error) => {
            reject(new Error(`exec failed: ${error.message}`));
          });

          if (opts?.onLine) {
            const onLine = opts.onLine;
            const stdoutTail = new BoundedTail(maxOutputTailChars, "\n");
            const stderrTail = new BoundedTail(maxOutputTailChars, "");
            const rl = createInterface({ input: proc.stdout! });
            rl.on("line", (line) => {
              stdoutTail.push(line);
              onLine(line);
            });
            proc.stderr!.on("data", (chunk: Buffer) => {
              stderrTail.push(chunk.toString());
            });
            proc.on("close", (code) => {
              resolve({
                stdout: stdoutTail.toString(),
                stderr: stderrTail.toString(),
                exitCode: code ?? 0,
              });
            });
          } else {
            const stdoutChunks: string[] = [];
            const stderrChunks: string[] = [];
            proc.stdout!.on("data", (chunk: Buffer) => {
              stdoutChunks.push(chunk.toString());
            });
            proc.stderr!.on("data", (chunk: Buffer) => {
              stderrChunks.push(chunk.toString());
            });
            proc.on("close", (code) => {
              resolve({
                stdout: stdoutChunks.join(""),
                stderr: stderrChunks.join(""),
                exitCode: code ?? 0,
              });
            });
          }
        });
      },

      interactiveExec: (
        args: string[],
        opts: InteractiveExecOptions,
      ): Promise<{ exitCode: number }> => {
        return new Promise((resolve, reject) => {
          const [cmd, ...rest] = args;
          // Agent CLIs on Windows are typically installed as `.cmd`/`.ps1`
          // npm wrappers; bare `spawn("claude", …)` only resolves `.exe`
          // without `shell: true`, so let cmd.exe handle PATHEXT lookup.
          const proc = spawn(cmd!, rest, {
            cwd: opts.cwd ?? worktreePath,
            env: processEnv,
            stdio: [opts.stdin, opts.stdout, opts.stderr] as StdioOptions,
            shell: process.platform === "win32",
          });

          proc.on("error", (error: Error) => {
            reject(new Error(`exec failed: ${error.message}`));
          });

          proc.on("close", (code: number | null) => {
            resolve({ exitCode: code ?? 0 });
          });
        });
      },

      close: async (): Promise<void> => {
        const pending = [...active];
        for (const [controller] of pending) controller.abort();
        const settled = await Promise.allSettled(
          pending.map(([, execution]) => execution),
        );
        if (
          settled.some(
            (result) =>
              result.status === "rejected" &&
              result.reason instanceof Error &&
              result.reason.message === "Owned process-tree termination failed",
          )
        )
          throw new Error("Owned process-tree termination failed");
      },
    };

    return handle;
  },
});
