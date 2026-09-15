import { execFile, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyToWorktree, getCopyOnWriteFlags } from "./CopyToWorktree.js";
import { CopyToWorktreeError, CopyToWorktreeTimeoutError } from "./errors.js";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFile: vi.fn(actual.execFile) };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, cp: vi.fn(actual.cp) };
});

const hostPlatform = process.platform;
const usePlatform = (platform: string) => {
  Object.defineProperty(process, "platform", { value: platform });
};

// T2/AC2: exercise native Windows copying and preserve Unix CoW dispatch.
describe("getCopyOnWriteFlags", () => {
  it("returns -cR on darwin (APFS clonefile)", () => {
    expect(getCopyOnWriteFlags("darwin")).toEqual(["-cR"]);
  });

  it("returns -R --reflink=auto on linux", () => {
    expect(getCopyOnWriteFlags("linux")).toEqual(["-R", "--reflink=auto"]);
  });

  it("returns -R --reflink=auto on other platforms", () => {
    expect(getCopyOnWriteFlags("freebsd")).toEqual(["-R", "--reflink=auto"]);
  });
});

type CopyCallback = (
  error: NodeJS.ErrnoException | null,
  stdout: string,
  stderr: string,
) => void;
const completeCommand = (
  error: NodeJS.ErrnoException | null = null,
  stderr = "",
) =>
  ((_command: string, _args: readonly string[], callback: CopyCallback) => {
    callback(error, "", stderr);
    return {} as ChildProcess;
  }) as typeof execFile;

describe("copyToWorktree", () => {
  let hostDir: string;
  let worktreeDir: string;

  beforeEach(async () => {
    hostDir = await mkdtemp(join(tmpdir(), "cw-test-"));
    worktreeDir = await mkdtemp(join(tmpdir(), "cw-wt-"));
  });

  afterEach(async () => {
    vi.useRealTimers();
    usePlatform(hostPlatform);
    vi.resetAllMocks();
    await rm(hostDir, { recursive: true, force: true });
    await rm(worktreeDir, { recursive: true, force: true });
  });

  it("copies file contents and overwrites an existing file on the host", async () => {
    await writeFile(join(hostDir, "file.txt"), "new content");
    await writeFile(join(worktreeDir, "file.txt"), "old content");
    await Effect.runPromise(copyToWorktree(["file.txt"], hostDir, worktreeDir));
    expect(await readFile(join(worktreeDir, "file.txt"), "utf8")).toBe(
      "new content",
    );
  });

  it("recursively copies directories on the host", async () => {
    await mkdir(join(hostDir, "data", "nested"), { recursive: true });
    await writeFile(
      join(hostDir, "data", "nested", "file.txt"),
      "nested content",
    );
    await Effect.runPromise(copyToWorktree(["data"], hostDir, worktreeDir));
    expect(
      await readFile(join(worktreeDir, "data", "nested", "file.txt"), "utf8"),
    ).toBe("nested content");
  });

  it("copies recursively and overwrites using native Windows APIs without invoking cp", async () => {
    usePlatform("win32");
    await mkdir(join(hostDir, "data", "nested"), { recursive: true });
    await mkdir(join(worktreeDir, "data", "nested"), { recursive: true });
    await writeFile(join(hostDir, "data", "nested", "file.txt"), "new content");
    await writeFile(
      join(worktreeDir, "data", "nested", "file.txt"),
      "old content",
    );
    await writeFile(join(worktreeDir, "data", "retained.txt"), "retained");
    await Effect.runPromise(copyToWorktree(["data"], hostDir, worktreeDir));
    expect(
      await readFile(join(worktreeDir, "data", "nested", "file.txt"), "utf8"),
    ).toBe("new content");
    expect(
      await readFile(join(worktreeDir, "data", "retained.txt"), "utf8"),
    ).toBe("retained");
    expect(execFile).not.toHaveBeenCalled();
    expect(cp).toHaveBeenCalledWith(
      join(hostDir, "data"),
      join(worktreeDir, "data"),
      expect.objectContaining({ recursive: true, force: true }),
    );
  });

  it("fails with CopyToWorktreeError when the destination cannot be traversed", async () => {
    await mkdir(join(hostDir, "nested"));
    await writeFile(join(hostDir, "nested", "file.txt"), "content");
    await writeFile(join(worktreeDir, "nested"), "blocker");
    const result = await Effect.runPromise(
      Effect.either(copyToWorktree(["nested/file.txt"], hostDir, worktreeDir)),
    );
    expect(result).toMatchObject({
      _tag: "Left",
      left: {
        _tag: "CopyToWorktreeError",
        path: "nested/file.txt",
        stderr: expect.any(String),
      },
    });
    if (result._tag === "Left") {
      expect(result.left).toBeInstanceOf(CopyToWorktreeError);
      expect((result.left as CopyToWorktreeError).stderr).toBeTruthy();
    }
  });

  it("reports native copy errors with path and diagnostics", async () => {
    usePlatform("win32");
    await writeFile(join(hostDir, "file.txt"), "content");
    vi.mocked(cp).mockRejectedValueOnce(new Error("access denied"));
    const result = await Effect.runPromise(
      Effect.either(copyToWorktree(["file.txt"], hostDir, worktreeDir)),
    );
    expect(result).toMatchObject({
      _tag: "Left",
      left: {
        _tag: "CopyToWorktreeError",
        path: "file.txt",
        stderr: "access denied",
        exitCode: null,
        message: "Failed to copy file.txt to worktree: access denied",
      },
    });
    expect(execFile).not.toHaveBeenCalled();
  });

  it("skips missing source paths and still copies subsequent paths", async () => {
    await writeFile(join(hostDir, "file.txt"), "content");
    await Effect.runPromise(
      copyToWorktree(["nonexistent.txt", "file.txt"], hostDir, worktreeDir),
    );
    expect(existsSync(join(worktreeDir, "nonexistent.txt"))).toBe(false);
    expect(await readFile(join(worktreeDir, "file.txt"), "utf8")).toBe(
      "content",
    );
  });

  it("does not start a copy for an empty path list", async () => {
    await Effect.runPromise(copyToWorktree([], hostDir, worktreeDir));
    expect(cp).not.toHaveBeenCalled();
    expect(execFile).not.toHaveBeenCalled();
  });

  it.each(["linux", "darwin"])(
    "preserves CoW flags on %s",
    async (platform) => {
      usePlatform(platform);
      await writeFile(join(hostDir, "file.txt"), "content");
      vi.mocked(execFile).mockImplementation(completeCommand());
      await Effect.runPromise(
        copyToWorktree(["file.txt"], hostDir, worktreeDir),
      );
      expect(execFile).toHaveBeenCalledExactlyOnceWith(
        "cp",
        [
          ...getCopyOnWriteFlags(platform),
          join(hostDir, "file.txt"),
          join(worktreeDir, "file.txt"),
        ],
        expect.any(Function),
      );
      expect(cp).not.toHaveBeenCalled();
    },
  );

  it("succeeds when Unix CoW copy fails but fallback cp -R succeeds", async () => {
    usePlatform("linux");
    await writeFile(join(hostDir, "file.txt"), "content");
    vi.mocked(execFile)
      .mockImplementationOnce(completeCommand(new Error("unsupported reflink")))
      .mockImplementationOnce(completeCommand());
    await Effect.runPromise(copyToWorktree(["file.txt"], hostDir, worktreeDir));
    expect(execFile).toHaveBeenCalledTimes(2);
    expect(execFile).toHaveBeenNthCalledWith(
      2,
      "cp",
      ["-R", join(hostDir, "file.txt"), join(worktreeDir, "file.txt")],
      expect.any(Function),
    );
    expect(cp).not.toHaveBeenCalled();
  });

  it("preserves stderr and numeric exit code when Unix fallback fails", async () => {
    usePlatform("linux");
    await writeFile(join(hostDir, "file.txt"), "content");
    vi.mocked(execFile)
      .mockImplementationOnce(completeCommand(new Error("unsupported reflink")))
      .mockImplementationOnce(
        completeCommand(
          Object.assign(new Error("copy failed"), {
            code: 1,
          }) as unknown as NodeJS.ErrnoException,
          "permission denied",
        ),
      );
    const result = await Effect.runPromise(
      Effect.either(copyToWorktree(["file.txt"], hostDir, worktreeDir)),
    );
    expect(result).toMatchObject({
      _tag: "Left",
      left: {
        _tag: "CopyToWorktreeError",
        path: "file.txt",
        stderr: "permission denied",
        exitCode: 1,
      },
    });
  });

  // T6/AC6: the copy stays pending; no real filesystem copy races fake timers.
  describe.each(["win32", "linux", "darwin"])("timeouts on %s", (platform) => {
    it.each([undefined, 500])(
      "enforces the exact deadline with timeoutMs=%s",
      async (timeoutMs) => {
        usePlatform(platform);
        await writeFile(join(hostDir, "file.txt"), "content");
        vi.mocked(cp).mockImplementation(() => new Promise<void>(() => {}));
        vi.mocked(execFile).mockImplementation(() => ({}) as ChildProcess);
        vi.useFakeTimers();
        let settled = false;
        const exitPromise = Effect.runPromiseExit(
          copyToWorktree(["file.txt"], hostDir, worktreeDir, timeoutMs),
        );
        void exitPromise.then(() => {
          settled = true;
        });
        await vi.advanceTimersByTimeAsync(0);
        expect(platform === "win32" ? cp : execFile).toHaveBeenCalledTimes(1);
        const deadline = timeoutMs ?? 60_000;
        await vi.advanceTimersByTimeAsync(deadline - 1);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        const exit = await exitPromise;
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
          expect(exit.cause.error).toBeInstanceOf(CopyToWorktreeTimeoutError);
          expect(exit.cause.error).toMatchObject({
            timeoutMs: deadline,
            paths: ["file.txt"],
          });
        } else {
          throw new Error("Expected timeout failure");
        }
      },
    );
  });
});
