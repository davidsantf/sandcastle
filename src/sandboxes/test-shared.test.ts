import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { describe, expect, it } from "vitest";
import { testBindMount } from "./test-bind-mount.js";
import { createTempSandbox } from "./test-shared.js";
import { testIsolated } from "./test-isolated.js";

// T3 / AC3: copying and POSIX exec must address the same filesystem.
describe.each(["isolated", "bind-mount"] as const)(
  "%s path contract",
  (tag) => {
    it("round-trips files through shell /tmp without rewriting command output", async () => {
      const hostDir = await mkdtemp(join(tmpdir(), "sandbox mapping host "));
      const handle =
        tag === "isolated"
          ? await testIsolated().create({ env: {} })
          : await testBindMount().create({
              worktreePath: hostDir,
              hostRepoPath: hostDir,
              mounts: [],
              env: {},
            });
      const temp = await handle.exec(
        "mktemp -d /tmp/sandcastle-mapping-XXXXXX",
      );
      expect(temp.exitCode).toBe(0);
      const sandboxDir = temp.stdout.trim();
      const sandboxFile = posix.join(sandboxDir, "nested dir", "input.txt");
      const payload = "literal /tmp/path and C:\\tmp\\path";
      try {
        const source = join(hostDir, "input.txt");
        await writeFile(source, payload);
        if ("copyIn" in handle) await handle.copyIn(source, sandboxFile);
        else await handle.copyFileIn(source, sandboxFile);
        const absoluteRead = await handle.exec(`cat "${sandboxFile}"`);
        expect(absoluteRead.exitCode).toBe(0);
        expect(absoluteRead.stdout).toBe(payload);
        const lines: string[] = [];
        for (const streaming of [false, true]) {
          const result = await handle.exec('cat "nested dir/input.txt"', {
            cwd: sandboxDir,
            ...(streaming
              ? { onLine: (line: string) => lines.push(line) }
              : {}),
          });
          expect(result.exitCode).toBe(0);
          expect(result.stdout).toBe(payload);
        }
        expect(lines).toEqual([payload]);
        expect(
          (
            await handle.exec(
              'printf "shell output" > "nested dir/output.txt"',
              { cwd: sandboxDir },
            )
          ).exitCode,
        ).toBe(0);
        const output = join(hostDir, "nested", "output.txt");
        await handle.copyFileOut(
          posix.join(sandboxDir, "nested dir/output.txt"),
          output,
        );
        expect(await readFile(output, "utf8")).toBe("shell output");
      } finally {
        await handle.exec(`rm -rf "${sandboxDir}"`);
        await handle.close();
        await rm(hostDir, { recursive: true, force: true });
      }
    });
  },
);

// syncIn replaces the worktree directory after cloning a bundle beside it.
it("allows a POSIX command to replace its working directory", async () => {
  const sandbox = await createTempSandbox("sandbox-replace-");
  try {
    const path = sandbox.worktreePath;
    const result = await sandbox.exec(
      `mkdir "${path}_clone" && printf replacement > "${path}_clone/file.txt" && rm -rf "${path}" && mv "${path}_clone" "${path}"`,
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect((await sandbox.exec("cat file.txt")).stdout).toBe("replacement");
  } finally {
    await sandbox.close();
  }
});

// T3 / AC3: implementation arguments must not leak into a sandbox command.
it.each([false, true])(
  "does not expose wrapper arguments (streaming=%s)",
  async (streaming) => {
    const sandbox = await createTempSandbox("sandbox-arguments-");
    try {
      const lines: string[] = [];
      const result = await sandbox.exec(
        'printf "%s" "$#"; printf "<%s>" "$@"',
        {
          ...(streaming ? { onLine: (line: string) => lines.push(line) } : {}),
        },
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("0<>");
      if (streaming) expect(lines).toEqual(["0<>"]);
    } finally {
      await sandbox.close();
    }
  },
);
