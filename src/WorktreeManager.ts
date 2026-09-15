import { Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import { basename, dirname, join, normalize, posix, relative } from "node:path";
import { WorktreeError, WorktreeTimeoutError, withTimeout } from "./errors.js";

const WORKTREE_TIMEOUT_MS = 30_000;

/**
 * Git global flags that prevent `git worktree add -b` from writing upstream
 * tracking config to `.git/config`. Without these, a user's global
 * `branch.autoSetupMerge` or `push.autoSetupRemote` can cause a config write
 * that races with other processes holding `.git/config.lock`.
 */
const NO_CONFIG_LOCK_FLAGS = [
  "-c",
  "branch.autoSetupMerge=false",
  "-c",
  "push.autoSetupRemote=false",
];

/** Format a timestamp as YYYYMMDD-HHMMSS */
const formatTimestamp = (date: Date): string => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
};

/**
 * Short random hex suffix appended to generated temp branch names. Three
 * bytes (six hex chars) is enough entropy to keep concurrent `run()` /
 * `RunResult.fork()` calls within the same second from colliding on branch
 * names — the second-granularity timestamp alone is not (see ADR 0018).
 */
const randomBranchSuffix = (): string => randomBytes(3).toString("hex");

/** Sanitize a name for use in branch names and directory names. */
export const sanitizeName = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]/g, "-");

const execGit = (
  args: string[],
  cwd: string,
): Effect.Effect<string, WorktreeError> =>
  Effect.async((resume) => {
    // Force the C locale so git emits English, machine-stable messages. Several
    // callers match git's stderr (e.g. "invalid reference") to decide control
    // flow; under a localized locale gettext translates those strings and the
    // matches silently fail, breaking worktree creation (issue #595).
    execFile(
      "git",
      args,
      { cwd, env: { ...process.env, LC_ALL: "C" } },
      (error, stdout, stderr) => {
        if (error) {
          resume(
            Effect.fail(
              new WorktreeError({
                message: stderr?.trim() || error.message,
              }),
            ),
          );
        } else {
          resume(Effect.succeed(stdout));
        }
      },
    );
  });

/**
 * Generates a temporary branch name.
 * When name is provided: `sandcastle/<sanitized-name>/<YYYYMMDD-HHMMSS>-<random>`.
 * Otherwise: `sandcastle/<YYYYMMDD-HHMMSS>-<random>`.
 *
 * The random suffix prevents collisions between concurrent calls within the
 * same wall-clock second — relevant for fan-out via `RunResult.fork()` and
 * for plain `Promise.all([run(), run()])` callers.
 */
export const generateTempBranchName = (name?: string): string => {
  const ts = formatTimestamp(new Date());
  const suffix = randomBranchSuffix();
  if (name) {
    return `sandcastle/${sanitizeName(name)}/${ts}-${suffix}`;
  }
  return `sandcastle/${ts}-${suffix}`;
};

/** Returns the name of the currently checked-out branch in the given repo directory. */
export const getCurrentBranch = (
  repoDir: string,
): Effect.Effect<string, WorktreeError> =>
  execGit(["rev-parse", "--abbrev-ref", "HEAD"], repoDir).pipe(
    Effect.map((output) => output.trim()),
  );

export interface WorktreeInfo {
  path: string;
  branch: string;
}

/** A single entry parsed from `git worktree list --porcelain`. */
export interface WorktreeEntry {
  path: string;
  /** `null` for a detached HEAD (e.g. mid-rebase). */
  branch: string | null;
}

/**
 * Normalizes path separators to forward slashes.
 *
 * `git worktree list --porcelain` reports paths with forward slashes on every
 * platform, but `node:path.join` produces backslashes on Windows. Comparing
 * the two without normalizing fails on Windows, so all path comparisons in
 * this module run both sides through this first.
 */
const normalizePath = (p: string): string => p.replace(/\\/g, "/");

/**
 * Finds an existing worktree that collides with `branch` or `worktreePath`.
 *
 * Matches by branch first, then falls back to a path match — covering the
 * mid-rebase detached-HEAD case where git reports a `null` branch. The path
 * fallback normalizes separators so it works on Windows.
 */
export const findCollidingWorktree = (
  existing: readonly WorktreeEntry[],
  branch: string,
  worktreePath: string,
): WorktreeEntry | undefined =>
  existing.find((wt) => wt.branch === branch) ??
  existing.find((wt) => normalizePath(wt.path) === normalizePath(worktreePath));

/**
 * Component-aware containment of already-canonical filesystem identities.
 * This lexical helper also accepts Git's forward slashes on Windows; callers
 * must resolve existing paths before using it as a filesystem safety boundary.
 */
export const isManagedWorktreePath = (
  worktreePath: string,
  worktreesDir: string,
): boolean => {
  const child = posix.relative(
    normalizePath(worktreesDir),
    normalizePath(worktreePath),
  );
  return (
    child !== "" &&
    child !== ".." &&
    !child.startsWith("../") &&
    !posix.isAbsolute(child)
  );
};

// T1 / AC1: ordinary realpath can retain Windows 8.3 aliases. All existing
// filesystem identities cross this native boundary; never fall back lexically.
// Only ENOENT positively establishes absence. Permission/I/O failures are errors.
const existingIdentity = (
  path: string,
): Effect.Effect<string | null, WorktreeError> =>
  Effect.try({
    try: () => {
      try {
        return realpathSync.native(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    catch: (error) =>
      new WorktreeError({
        message: `Cannot establish filesystem identity for '${path}': ${String(error)}`,
      }),
  });

const filesystemIdentity = (
  path: string,
): Effect.Effect<string, WorktreeError> =>
  existingIdentity(path).pipe(
    Effect.flatMap((identity) =>
      identity === null
        ? Effect.fail(
            new WorktreeError({
              message: `Cannot establish filesystem identity for missing path '${path}'`,
            }),
          )
        : Effect.succeed(identity),
    ),
  );

const requireManagedIdentity = (
  path: string,
  root: string,
): Effect.Effect<void, WorktreeError> =>
  isManagedWorktreePath(path, root)
    ? Effect.void
    : Effect.fail(
        new WorktreeError({
          message: `Refusing unsafe worktree path '${path}': outside managed root '${root}'`,
        }),
      );

/**
 * Whether a directory entry under `.sandcastle/worktrees/` is orphaned — not
 * present in the set of active worktree paths reported by git. Both sides are
 * normalized so paths from `join` (backslashes on Windows) match git's
 * forward-slash output.
 */
export const isOrphanedWorktreePath = (
  entryPath: string,
  activeWorktreePaths: Iterable<string>,
): boolean => {
  const normalizedEntry = normalizePath(entryPath);
  for (const active of activeWorktreePaths) {
    if (normalizePath(active) === normalizedEntry) return false;
  }
  return true;
};

/** Parses `git worktree list --porcelain` output into structured entries. */
const listWorktrees = (
  repoDir: string,
): Effect.Effect<WorktreeEntry[], WorktreeError> =>
  execGit(["worktree", "list", "--porcelain"], repoDir).pipe(
    Effect.map((output) => {
      const entries: WorktreeEntry[] = [];
      let currentPath: string | null = null;
      let currentBranch: string | null = null;

      for (const line of output.split("\n")) {
        if (line.startsWith("worktree ")) {
          if (currentPath !== null) {
            entries.push({ path: currentPath, branch: currentBranch });
          }
          currentPath = line.slice("worktree ".length).trim();
          currentBranch = null;
        } else if (line.startsWith("branch ")) {
          // "branch refs/heads/my-branch" -> "my-branch"
          currentBranch = line.slice("branch refs/heads/".length).trim();
        }
      }

      if (currentPath !== null) {
        entries.push({ path: currentPath, branch: currentBranch });
      }

      return entries;
    }),
  );

/**
 * On the clean-reuse path, fetches `origin/<branch>` into the worktree and
 * fast-forwards local HEAD. Skipped silently (with an explanatory log) when:
 *
 * - HEAD is not attached to `<branch>` — a mid-rebase worktree paused at an
 *   `edit`/`exec`/`break` instruction has a clean working tree but a detached
 *   HEAD pointing at the pause point. `git merge --ff-only` there would
 *   silently advance HEAD past the pause and break `git rebase --continue`;
 * - the fetch fails (no `origin`, unreachable network, branch missing on
 *   origin) — the worktree is reused as-is, never breaking the run; or
 * - the local branch has diverged from `origin/<branch>` (unpushed commits +
 *   moved origin), in which case `--ff-only` refuses and the unpushed work
 *   is preserved exactly as it was.
 *
 * Errors here are non-fatal by design (ADR 0003): the worst case is the same
 * stale-but-usable worktree the caller would have had before this refresh
 * existed.
 */
const fastForwardFromOrigin = (
  worktreePath: string,
  branch: string,
): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    // `symbolic-ref --quiet HEAD` exits non-zero when HEAD is detached;
    // map both failure and an unexpected target to "" so the predicate
    // below treats them the same as "not on this branch".
    const headRef = yield* execGit(
      ["symbolic-ref", "--quiet", "HEAD"],
      worktreePath,
    ).pipe(
      Effect.map((s) => s.trim()),
      Effect.orElseSucceed(() => ""),
    );
    if (headRef !== `refs/heads/${branch}`) {
      console.log(
        `Reusing worktree at ${worktreePath} (branch '${branch}') — HEAD is not on '${branch}', skipping origin refresh`,
      );
      return;
    }
    const fetchResult = yield* Effect.either(
      execGit(
        [...NO_CONFIG_LOCK_FLAGS, "fetch", "origin", branch],
        worktreePath,
      ),
    );
    if (fetchResult._tag === "Left") {
      console.log(
        `Could not fetch from origin (reusing worktree at ${worktreePath} as-is, branch '${branch}')`,
      );
      return;
    }
    const before = yield* execGit(["rev-parse", "HEAD"], worktreePath).pipe(
      Effect.map((s) => s.trim()),
      Effect.orElseSucceed(() => ""),
    );
    const mergeResult = yield* Effect.either(
      execGit(
        [...NO_CONFIG_LOCK_FLAGS, "merge", "--ff-only", `origin/${branch}`],
        worktreePath,
      ),
    );
    if (mergeResult._tag === "Left") {
      console.log(
        `Branch '${branch}' has diverged from origin (reusing worktree at ${worktreePath} as-is)`,
      );
      return;
    }
    const after = yield* execGit(["rev-parse", "HEAD"], worktreePath).pipe(
      Effect.map((s) => s.trim()),
      Effect.orElseSucceed(() => ""),
    );
    if (before && after && before !== after) {
      console.log(
        `Fast-forwarded worktree at ${worktreePath} (branch '${branch}') to origin/${branch}`,
      );
    } else {
      console.log(
        `Reusing existing worktree at ${worktreePath} (branch '${branch}')`,
      );
    }
  });

/**
 * Creates a git worktree at `.sandcastle/worktrees/<name>/`.
 *
 * - If `branch` is specified, checks out that branch.
 * - If not, creates a temporary `sandcastle/<timestamp>` branch.
 *
 * When `branch` collides with an existing managed worktree:
 * - Clean → reuses the existing worktree and fast-forwards it from
 *   `origin/<branch>` when it is strictly behind (ADR 0003). A failed fetch
 *   or a diverged branch is non-fatal and falls back to plain reuse.
 * - Dirty (uncommitted changes) → reuses with a console warning, no refresh.
 *
 * Collisions with the main working tree or external worktrees always throw.
 */
export const create = (
  repoDir: string,
  opts?: {
    branch?: string;
    baseBranch?: string;
    name?: string;
  },
): Effect.Effect<
  WorktreeInfo,
  WorktreeError | WorktreeTimeoutError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const realRepoDir = yield* filesystemIdentity(repoDir);
    const worktreesDir = join(repoDir, ".sandcastle", "worktrees");
    yield* fs
      .makeDirectory(worktreesDir, { recursive: true })
      .pipe(Effect.mapError((e) => new WorktreeError({ message: e.message })));

    const realWorktreesDir = yield* filesystemIdentity(worktreesDir);

    let branch: string;
    let worktreeName: string;

    if (opts?.branch) {
      branch = opts.branch;
      worktreeName = branch.replace(/\//g, "-");
    } else {
      const timestamp = formatTimestamp(new Date());
      const suffix = randomBranchSuffix();
      if (opts?.name) {
        const sanitized = sanitizeName(opts.name);
        branch = `sandcastle/${sanitized}/${timestamp}-${suffix}`;
        worktreeName = `sandcastle-${sanitized}-${timestamp}-${suffix}`;
      } else {
        branch = `sandcastle/${timestamp}-${suffix}`;
        worktreeName = `sandcastle-${timestamp}-${suffix}`;
      }
    }

    const worktreePath = join(worktreesDir, worktreeName);
    yield* requireManagedIdentity(worktreePath, worktreesDir);
    const targetIdentity = yield* existingIdentity(worktreePath);
    if (targetIdentity !== null)
      yield* requireManagedIdentity(targetIdentity, realWorktreesDir);

    if (opts?.branch) {
      // Proactively detect collision before git produces a confusing error.
      // Match by branch first; fall back to target path (covers mid-rebase
      // detached-HEAD state where the branch field is null).
      const existing = yield* listWorktrees(repoDir);
      // Resolve both Git paths and the requested path, including detached HEAD.
      // Keep branch-first priority even if the requested directory also exists.
      let collision = existing.find((wt) => wt.branch === branch);
      if (!collision && targetIdentity !== null) {
        for (const entry of existing) {
          if ((yield* existingIdentity(entry.path)) === targetIdentity) {
            collision = entry;
            break;
          }
        }
      }
      if (collision) {
        // Only reuse worktrees managed by sandcastle (under .sandcastle/worktrees/)
        const collisionIdentity = yield* filesystemIdentity(collision.path);
        if (
          collision !== existing[0] &&
          collisionIdentity !== realRepoDir &&
          isManagedWorktreePath(collisionIdentity, realWorktreesDir)
        ) {
          // Preserve the repo anchor across a linked .sandcastle. Returning the
          // resolved external storage path would make remove() ascend the wrong repo.
          const managedPath = join(
            worktreesDir,
            relative(realWorktreesDir, collisionIdentity),
          );
          const dirty = yield* hasUncommittedChanges(managedPath);
          if (dirty) {
            console.warn(
              `Reusing worktree at ${managedPath} (branch '${branch}') — worktree has uncommitted changes`,
            );
          } else {
            yield* fastForwardFromOrigin(managedPath, branch);
          }
          return { path: managedPath, branch };
        }
        // Branch is checked out in the main working tree or external worktree
        yield* Effect.fail(
          new WorktreeError({
            message:
              `Branch '${branch}' is already checked out in worktree at '${collision.path}'. ` +
              `Sandcastle's branch and merge-to-head strategies run the agent in a git worktree under .sandcastle/worktrees/, ` +
              `and git refuses to check out the same branch in two worktrees at once (HEAD would become ambiguous). ` +
              `Pick a different branch, or switch the main working tree to a different branch before re-running.`,
          }),
        );
      }
      yield* execGit(
        [...NO_CONFIG_LOCK_FLAGS, "worktree", "add", worktreePath, branch],
        repoDir,
      ).pipe(
        Effect.catchAll((e) => {
          if (e.message.includes("invalid reference")) {
            return execGit(
              [
                ...NO_CONFIG_LOCK_FLAGS,
                "worktree",
                "add",
                "-b",
                branch,
                worktreePath,
                opts?.baseBranch ?? "HEAD",
              ],
              repoDir,
            );
          }
          return Effect.fail(e);
        }),
      );
    } else {
      yield* execGit(
        [
          ...NO_CONFIG_LOCK_FLAGS,
          "worktree",
          "add",
          "-b",
          branch,
          worktreePath,
          "HEAD",
        ],
        repoDir,
      ).pipe(
        Effect.catchAll((e) => {
          if (
            e.message.includes("already checked out") ||
            e.message.includes("already exists")
          ) {
            return Effect.fail(
              new WorktreeError({
                message:
                  `Branch '${branch}' is already checked out in another worktree. ` +
                  `Use a different branch name, or wait for the other run to finish.`,
              }),
            );
          }
          return Effect.fail(e);
        }),
      );
    }

    return { path: worktreePath, branch };
  }).pipe(
    withTimeout(
      WORKTREE_TIMEOUT_MS,
      () =>
        new WorktreeTimeoutError({
          message: `Worktree creation timed out after ${WORKTREE_TIMEOUT_MS}ms`,
          timeoutMs: WORKTREE_TIMEOUT_MS,
          path: repoDir,
          operation: "create",
        }),
    ),
  );

/**
 * Returns true if the worktree at `worktreePath` has any uncommitted changes:
 * unstaged modifications, staged changes, or untracked files.
 */
export const hasUncommittedChanges = (
  worktreePath: string,
): Effect.Effect<boolean, WorktreeError> =>
  execGit(["status", "--porcelain"], worktreePath).pipe(
    Effect.map((output) => output.trim().length > 0),
  );

/**
 * Removes a worktree and its git metadata.
 *
 * The `worktreePath` must be a path inside `.sandcastle/worktrees/` so that
 * the main repository directory can be derived from it.
 */
export const remove = (
  worktreePath: string,
): Effect.Effect<void, WorktreeError> =>
  Effect.gen(function* () {
    // T1 / AC1: derive the anchor BEFORE resolving a linked managed root, then
    // validate the layout and both identities before Git can remove anything.
    const path = normalize(worktreePath);
    const worktreesDir = dirname(path);
    const configDir = dirname(worktreesDir);
    if (
      basename(worktreesDir) !== "worktrees" ||
      basename(configDir) !== ".sandcastle"
    ) {
      return yield* Effect.fail(
        new WorktreeError({
          message: `Refusing unsafe worktree path '${worktreePath}': expected .sandcastle/worktrees/<name>`,
        }),
      );
    }
    const repoDir = yield* filesystemIdentity(dirname(configDir));
    const rootIdentity = yield* filesystemIdentity(worktreesDir);
    const identity = yield* filesystemIdentity(path);
    yield* requireManagedIdentity(identity, rootIdentity);
    const existing = yield* listWorktrees(repoDir);
    const mainIdentity = existing[0]
      ? yield* filesystemIdentity(existing[0].path)
      : repoDir;
    if (identity === repoDir || identity === mainIdentity) {
      return yield* Effect.fail(
        new WorktreeError({
          message: `Refusing to remove the main repository at '${path}'`,
        }),
      );
    }
    // Pass the validated entry, not a resolved symlink target, to deletion.
    yield* execGit(["worktree", "remove", "--force", path], repoDir);
  });

/**
 * Prunes stale git worktree metadata and removes orphaned directories under
 * `.sandcastle/worktrees/`.
 */
export const pruneStale = (
  repoDir: string,
): Effect.Effect<
  void,
  WorktreeError | WorktreeTimeoutError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    yield* filesystemIdentity(repoDir);
    const worktreesDir = join(repoDir, ".sandcastle", "worktrees");
    const rootIdentity = yield* existingIdentity(worktreesDir);

    // T1 / AC1: preflight every active identity before even pruning metadata.
    // An inaccessible active worktree must never authorize candidate deletion.
    const activeWorktreePaths = new Set<string>();
    for (const entry of yield* listWorktrees(repoDir)) {
      const identity = yield* existingIdentity(entry.path);
      if (identity !== null) activeWorktreePaths.add(identity);
    }

    const orphans: string[] = [];
    if (rootIdentity !== null) {
      const entries = yield* fs
        .readDirectory(worktreesDir)
        .pipe(
          Effect.mapError((e) => new WorktreeError({ message: e.message })),
        );
      // Preflight ALL candidates before deletion, so a later identity error
      // cannot leave an earlier orphan removed. The root itself may be linked;
      // an entry escaping that canonical root is not a managed worktree.
      for (const entry of entries) {
        const entryPath = join(worktreesDir, entry);
        const identity = yield* existingIdentity(entryPath);
        if (identity === null) continue;
        yield* requireManagedIdentity(identity, rootIdentity);
        const info = yield* fs
          .stat(entryPath)
          .pipe(
            Effect.mapError((e) => new WorktreeError({ message: e.message })),
          );
        if (
          info.type === "Directory" &&
          isOrphanedWorktreePath(identity, activeWorktreePaths)
        ) {
          orphans.push(entryPath);
        }
      }
    }

    // Positively missing worktrees still get their stale metadata pruned.
    yield* execGit(["worktree", "prune"], repoDir);
    for (const entryPath of orphans) {
      // Never pass a resolved external target to a recursive removal.
      yield* fs.remove(entryPath, { recursive: true, force: true }).pipe(
        Effect.mapError(
          (e) =>
            new WorktreeError({
              message: `Failed to remove ${entryPath}: ${e.message}`,
            }),
        ),
      );
    }
  }).pipe(
    withTimeout(
      WORKTREE_TIMEOUT_MS,
      () =>
        new WorktreeTimeoutError({
          message: `Worktree prune timed out after ${WORKTREE_TIMEOUT_MS}ms`,
          timeoutMs: WORKTREE_TIMEOUT_MS,
          path: repoDir,
          operation: "prune",
        }),
    ),
  );
