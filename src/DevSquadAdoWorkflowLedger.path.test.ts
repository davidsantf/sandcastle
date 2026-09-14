import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDevSquadAdoWorkflowLedger as openSystemDevSquadAdoWorkflowLedger } from "./DevSquadAdoWorkflowLedger.js";
import { openTestDevSquadAdoWorkflowLedger as openDevSquadAdoWorkflowLedger } from "./DevSquadAdoWorkflowLedgerTestSupport.js";
import {
  makeLedgerTestRuntime,
  openTestDevSquadAdoWorkflowLedgerWithClock,
} from "./DevSquadAdoWorkflowLedgerTestSupport.js";
import {
  LedgerPlatformFailure,
  noLedgerPersistenceFaults,
} from "./DevSquadAdoWorkflowLedgerPlatform.js";
import { openDevSquadAdoWorkflowLedgerWithRuntime } from "./DevSquadAdoWorkflowLedgerStorage.js";

const roots: string[] = [];
const makeRoot = async (prefix = "devsquad-ledger-path-") => {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
};

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("DevSquadAdoWorkflowLedger path safety", () => {
  it("fails closed when the production platform cannot establish Windows ACL and durability capabilities", async () => {
    if (process.platform !== "win32") return;
    const root = await makeRoot();
    expect(
      await openSystemDevSquadAdoWorkflowLedger({ repositoryRoot: root }),
    ).toEqual({
      ok: false,
      error: { kind: "unsupported-permissions", artifact: "." },
    });
  }, 30_000);

  it("requires an existing absolute repository directory", async () => {
    expect(
      await openDevSquadAdoWorkflowLedger({ repositoryRoot: "relative/repo" }),
    ).toEqual({
      ok: false,
      error: { kind: "path-boundary" },
    });
    const root = await makeRoot();
    const file = join(root, "not-a-directory");
    await writeFile(file, "file", "utf8");
    expect(
      await openDevSquadAdoWorkflowLedger({ repositoryRoot: file }),
    ).toEqual({
      ok: false,
      error: { kind: "repository-not-directory" },
    });
    expect(
      await openDevSquadAdoWorkflowLedger({
        repositoryRoot: join(root, "missing"),
      }),
    ).toEqual({
      ok: false,
      error: { kind: "repository-not-found" },
    });
  }, 30_000);

  it.each(["../137", "137/child", "137\\child", "line\nfeed", "e\u0301"])(
    "rejects unsafe work-item identifier %j before creating an ID artifact",
    async (workItemId) => {
      const root = await makeRoot();
      const opened = await openDevSquadAdoWorkflowLedger({
        repositoryRoot: root,
      });
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;
      expect(
        await opened.value.initializeRecord({
          workItemId,
          operationId: "invalid-id",
          phase: "implement",
          status: "ready",
        }),
      ).toMatchObject({
        ok: false,
        error: { kind: "validation", field: "workItemId" },
      });
    },
  );

  // Three independent durable fixtures can overlap other full-suite disk load.
  it("accepts stored POSIX, Windows-drive, and UNC worktree paths without accessing them", async () => {
    const paths = [
      "/host/repo/.sandcastle/worktrees/1",
      "C:\\repo\\.sandcastle\\worktrees\\2",
      "\\\\server\\share\\worktrees\\3",
    ];
    for (const [index, worktreePath] of paths.entries()) {
      const root = await makeRoot();
      const opened = await openDevSquadAdoWorkflowLedger({
        repositoryRoot: root,
      });
      expect(opened.ok).toBe(true);
      if (!opened.ok) continue;
      expect(
        await opened.value.initializeRecord({
          workItemId: index + 1,
          operationId: `initialize-${index}`,
          phase: "implement",
          status: "ready",
          worktreePath,
        }),
      ).toMatchObject({ ok: true, value: { record: { worktreePath } } });
    }
  }, 30_000);

  it("rejects a symlink substituted for the records directory", async () => {
    const root = await makeRoot();
    const opened = await openDevSquadAdoWorkflowLedger({
      repositoryRoot: root,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const records = join(root, ".sandcastle", "devsquad-ado", "records");
    const moved = join(root, "moved-records");
    await mkdir(moved);
    await rm(records, { recursive: true, force: true });
    try {
      await symlink(
        moved,
        records,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch {
      return;
    }
    expect(await opened.value.listResumableRecords()).toMatchObject({
      ok: false,
      error: { kind: "path-boundary", artifact: "records" },
    });
  }, 30_000);

  it("does not treat a sibling-prefix path as repository containment", async () => {
    const root = await makeRoot("ledger-root-");
    const sibling = `${root}-sibling`;
    await mkdir(sibling);
    roots.push(sibling);
    expect(relative(root, sibling).startsWith("..")).toBe(true);
    const opened = await openDevSquadAdoWorkflowLedger({
      repositoryRoot: sibling,
    });
    expect(opened.ok).toBe(true);
    expect(
      await openDevSquadAdoWorkflowLedger({ repositoryRoot: root }),
    ).toMatchObject({ ok: true });
  }, 30_000);

  it("rejects unsupported filesystem capability before creating a manifest", async () => {
    const root = await makeRoot();
    const base = makeLedgerTestRuntime(
      () => new Date("2026-09-08T20:00:00.000Z"),
      noLedgerPersistenceFaults,
    );
    const result = await openDevSquadAdoWorkflowLedgerWithRuntime(
      { repositoryRoot: root },
      {
        ...base,
        platform: {
          ...base.platform,
          probeHardLinks: async () => {
            throw new LedgerPlatformFailure("unsupported-filesystem");
          },
        },
      },
    );
    expect(result).toEqual({
      ok: false,
      error: { kind: "unsupported-filesystem" },
    });
    await expect(
      readFile(
        join(root, ".sandcastle", "devsquad-ado", "ledger.json"),
        "utf8",
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
  }, 30_000);

  it("surfaces owner-only permission violations on supported POSIX production paths", async () => {
    if (process.platform === "win32") return;
    const root = await makeRoot();
    const opened = await openSystemDevSquadAdoWorkflowLedger({
      repositoryRoot: root,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(
      await opened.value.initializeRecord({
        workItemId: "permission-check",
        operationId: "initialize-permission-check",
        phase: "implement",
        status: "ready",
      }),
    ).toMatchObject({ ok: true });
    const recordsRoot = join(root, ".sandcastle", "devsquad-ado", "records");
    const recordDirectory = join(recordsRoot, (await readdir(recordsRoot))[0]!);
    await chmod(recordDirectory, 0o755);
    expect(await opened.value.readRecord("permission-check")).toMatchObject({
      ok: false,
      error: { kind: "unsupported-permissions" },
    });
  }, 30_000);

  it("rejects a committed artifact replaced by a symbolic link where supported", async () => {
    const root = await makeRoot();
    const opened = await openDevSquadAdoWorkflowLedger({
      repositoryRoot: root,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(
      await opened.value.initializeRecord({
        workItemId: "artifact-symlink",
        operationId: "initialize-artifact-symlink",
        phase: "implement",
        status: "ready",
      }),
    ).toMatchObject({ ok: true });
    const recordsRoot = join(root, ".sandcastle", "devsquad-ado", "records");
    const recordDirectory = join(recordsRoot, (await readdir(recordsRoot))[0]!);
    const generation = join(recordDirectory, "0000000000000001.json");
    const outside = join(root, "outside-generation.json");
    await writeFile(outside, await readFile(generation, "utf8"), "utf8");
    await rm(generation);
    try {
      await symlink(outside, generation, "file");
    } catch {
      return;
    }
    expect(await opened.value.readRecord("artifact-symlink")).toMatchObject({
      ok: false,
      error: { kind: "path-boundary" },
    });
  }, 30_000);

  it("rejects an unexpected manifest hard link outside the ledger", async () => {
    const root = await makeRoot();
    const opened = await openDevSquadAdoWorkflowLedger({
      repositoryRoot: root,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const manifest = join(root, ".sandcastle", "devsquad-ado", "ledger.json");
    await link(manifest, join(root, "unexpected-manifest-link.json"));

    expect(
      await openDevSquadAdoWorkflowLedger({ repositoryRoot: root }),
    ).toEqual({
      ok: false,
      error: { kind: "corrupt-artifact", artifact: "ledger.json" },
    });

    await link(manifest, join(root, "second-unexpected-manifest-link.json"));
    expect(
      await openDevSquadAdoWorkflowLedger({ repositoryRoot: root }),
    ).toEqual({
      ok: false,
      error: { kind: "path-boundary", artifact: "ledger.json" },
    });
  }, 30_000);

  it("rejects an unexpected hard-link artifact identity", async () => {
    const root = await makeRoot();
    const opened = await openTestDevSquadAdoWorkflowLedgerWithClock(
      { repositoryRoot: root },
      () => new Date("2026-09-08T20:00:00.000Z"),
    );
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(
      await opened.value.initializeRecord({
        workItemId: "artifact-hard-link",
        operationId: "initialize-artifact-hard-link",
        phase: "implement",
        status: "ready",
      }),
    ).toMatchObject({ ok: true });
    const recordsRoot = join(root, ".sandcastle", "devsquad-ado", "records");
    const recordDirectory = join(recordsRoot, (await readdir(recordsRoot))[0]!);
    const generation = join(recordDirectory, "0000000000000001.json");
    await link(generation, join(root, "unexpected-generation-link.json"));
    expect(await opened.value.readRecord("artifact-hard-link")).toMatchObject({
      ok: false,
      error: { kind: "corrupt-artifact" },
    });
  }, 30_000);
});
