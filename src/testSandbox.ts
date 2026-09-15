/**
 * Test helper: creates a local (filesystem-based) SandboxService for unit tests.
 * This replaces FilesystemSandbox which has been removed.
 */
import { Effect } from "effect";
import { copyFile, mkdir } from "node:fs/promises";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CopyError, ExecError } from "./errors.js";
import { type SandboxService } from "./SandboxFactory.js";
import {
  createSandboxExec,
  sandboxPathToNative,
} from "./sandboxes/test-shared.js";

/**
 * Creates an isolated git global config env so that test sandbox
 * `git config --global` writes don't corrupt the developer's real ~/.gitconfig.
 */
const createIsolatedGitEnv = (): Record<string, string> => {
  const tmpDir = mkdtempSync(join(tmpdir(), "test-gitconfig-"));
  const globalConfigPath = join(tmpDir, ".gitconfig");
  writeFileSync(globalConfigPath, "");
  return { GIT_CONFIG_GLOBAL: globalConfigPath };
};

export const makeLocalSandbox = (sandboxDir: string): SandboxService => {
  const gitEnv = createIsolatedGitEnv();
  const env = { ...process.env, ...gitEnv };
  const exec = createSandboxExec(sandboxDir, env);

  return {
    exec: (command, options) =>
      Effect.tryPromise({
        try: () => exec(command, options),
        catch: (error) =>
          new ExecError({
            command,
            message: `Failed to exec: ${error instanceof Error ? error.message : String(error)}`,
          }),
      }),

    copyIn: (hostPath, sandboxPath) =>
      Effect.tryPromise({
        try: async () => {
          const nativePath = await sandboxPathToNative(sandboxPath, sandboxDir);
          await mkdir(dirname(nativePath), { recursive: true });
          await copyFile(hostPath, nativePath);
        },
        catch: (e) =>
          new CopyError({
            message: `Failed to copy ${hostPath} -> ${sandboxPath}: ${e}`,
          }),
      }),

    copyFileOut: (sandboxPath, hostPath) =>
      Effect.tryPromise({
        try: async () => {
          await mkdir(dirname(hostPath), { recursive: true });
          await copyFile(
            await sandboxPathToNative(sandboxPath, sandboxDir),
            hostPath,
          );
        },
        catch: (e) =>
          new CopyError({
            message: `Failed to copy ${sandboxPath} -> ${hostPath}: ${e}`,
          }),
      }),
  };
};
