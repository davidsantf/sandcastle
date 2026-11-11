import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { digest } from "./MultiProjectProtocol.js";
import { noSandbox } from "./sandboxes/no-sandbox.js";
import type { WorkspaceConfiguration } from "./OrchestrationWorkspaceContract.js";
import type { OrchestrationIntakeStore } from "./OrchestrationProposal.js";

const receiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  state: z.enum(["passed", "failed"]),
  evaluatedScope: z.number().int().nonnegative(),
});
const recordSchema = z.object({
  revision: z.string(),
  configurationRevision: z.number().int().positive(),
  commandsDigest: z.string(),
  state: z.enum(["reserved", "passed", "failed", "unknown"]),
  diagnostic: z.string().optional(),
  evaluatedScope: z.number().int().nonnegative(),
  checks: z.array(
    z.object({
      name: z.string(),
      state: z.enum(["passed", "failed", "unknown"]),
      exitCode: z.number().int().optional(),
      evaluatedScope: z.number().int().nonnegative(),
      stdoutDigest: z.string().optional(),
      stderrDigest: z.string().optional(),
    }),
  ),
});
export const nativeValidationKey = (workspaceId: string, proposalId: string) =>
  `native-local-validation/${digest([workspaceId, proposalId])}`;
export function readNativeLocalValidation(
  store: OrchestrationIntakeStore,
  key: string,
) {
  const value = store.read(key).value;
  return value == null ? undefined : recordSchema.parse(value);
}

/** Host-registered argv only; untrusted tests still run on the host, not in a sandbox. */
export async function runNativeLocalValidation(options: {
  configuration: WorkspaceConfiguration;
  proposalId: string;
  projectId: string;
  repositoryRoot: string;
  revision: string;
  signal: AbortSignal;
  store: OrchestrationIntakeStore;
  assertCurrent: () => Promise<unknown>;
  write: (key: string, value: unknown, kind: string) => void;
}) {
  const checks = options.configuration.runtime.localValidation?.filter(
    (check) => check.projectId === options.projectId,
  );
  if (!checks?.length) return undefined;
  const key = nativeValidationKey(options.configuration.id, options.proposalId);
  const previous = readNativeLocalValidation(options.store, key);
  if (previous) {
    if (
      previous.revision !== options.revision ||
      previous.configurationRevision !== options.configuration.revision ||
      previous.commandsDigest !== digest(checks)
    )
      throw new Error("Retained local validation binding changed; no replay");
    return previous;
  }
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(options.revision))
    throw new Error(
      "Local validation requires an exact implementation revision",
    );
  await options.assertCurrent();
  const record: z.infer<typeof recordSchema> = {
    revision: options.revision,
    configurationRevision: options.configuration.revision,
    commandsDigest: digest(checks),
    state: "reserved",
    evaluatedScope: 0,
    checks: [],
  };
  options.write(key, record, "native-local-validation-reserved");
  const temporary = await mkdtemp(
    path.join(os.tmpdir(), "sandcastle-validation-"),
  );
  const snapshot = path.join(temporary, "snapshot");
  const hooks = path.join(temporary, "hooks");
  await mkdir(hooks);
  const environment: Record<string, string> = Object.fromEntries(
    Object.keys(process.env).map((name) => [name, ""]),
  );
  for (const name of [
    "PATH",
    "Path",
    "SystemRoot",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "TMPDIR",
  ])
    if (process.env[name]) environment[name] = process.env[name]!;
  Object.assign(environment, {
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONNOUSERSITE: "1",
    NPM_CONFIG_OFFLINE: "true",
    UV_OFFLINE: "1",
    GIT_CONFIG_NOSYSTEM: "1",
  });
  const handle = await noSandbox({ maxOutputTailChars: 16000 }).create({
    worktreePath: options.repositoryRoot,
    env: environment,
  });
  const exec = async (
    executable: string,
    args: string[],
    cwd: string,
    timeoutMs = 30000,
  ) =>
    handle.execFile!(executable, args, {
      cwd,
      timeoutMs,
      signal: options.signal,
    });
  let created = false;
  try {
    const added = await exec(
      "git",
      [
        "-c",
        `core.hooksPath=${hooks}`,
        "-C",
        options.repositoryRoot,
        "worktree",
        "add",
        "--detach",
        snapshot,
        options.revision,
      ],
      options.repositoryRoot,
    );
    if (added.exitCode !== 0)
      throw new Error("Validation snapshot creation failed");
    created = true;
    for (const check of checks) {
      await options.assertCurrent();
      const result = await exec(
        check.executable,
        check.args,
        snapshot,
        check.timeoutMs,
      );
      const parsed = receiptSchema.safeParse(
        (() => {
          try {
            return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1) ?? "");
          } catch {
            return undefined;
          }
        })(),
      );
      const valid =
        parsed.success &&
        parsed.data.evaluatedScope > 0 &&
        (result.exitCode === 0) === (parsed.data.state === "passed");
      const evaluatedScope = parsed.success ? parsed.data.evaluatedScope : 0;
      const state = valid ? parsed.data.state : "unknown";
      record.checks.push({
        name: check.label,
        state,
        exitCode: result.exitCode,
        evaluatedScope,
        stdoutDigest: digest(result.stdout),
        stderrDigest: digest(result.stderr),
      });
      record.evaluatedScope += evaluatedScope;
      if (state !== "passed") {
        record.state = state;
        record.diagnostic = valid
          ? `Host check ${check.label} failed with exit ${result.exitCode}`
          : `Host check ${check.label} returned missing, inconsistent or zero-scope evidence`;
        break;
      }
    }
    if (record.state === "reserved") record.state = "passed";
    const head = await exec("git", ["rev-parse", "HEAD"], snapshot);
    const dirty = await exec("git", ["status", "--porcelain"], snapshot);
    if (
      head.exitCode !== 0 ||
      head.stdout.trim() !== options.revision ||
      dirty.exitCode !== 0 ||
      dirty.stdout.trim()
    ) {
      record.state = "unknown";
      record.diagnostic =
        "Validation modified its pinned snapshot or Git state was unavailable";
    }
    await options.assertCurrent();
  } catch (error) {
    record.state = "unknown";
    record.diagnostic =
      error instanceof Error &&
      /^(Direct process|Owned process|Validation snapshot|Implementation changed)/.test(
        error.message,
      )
        ? error.message
        : "Local validation lost its source, permission or ownership binding; outcome unknown";
  } finally {
    await handle.close();
    if (created) {
      const cleanup = await noSandbox().create({
        worktreePath: options.repositoryRoot,
        env: environment,
      });
      try {
        const result = await cleanup.execFile!(
          "git",
          [
            "-C",
            options.repositoryRoot,
            "worktree",
            "remove",
            "--force",
            snapshot,
          ],
          { signal: new AbortController().signal, timeoutMs: 30000 },
        );
        if (result.exitCode !== 0)
          throw new Error("Owned validation snapshot cleanup failed");
      } finally {
        await cleanup.close();
      }
    }
    await rm(temporary, { recursive: true, force: true });
  }
  options.write(key, record, "native-local-validation-recorded");
  options.signal.throwIfAborted();
  return record;
}
