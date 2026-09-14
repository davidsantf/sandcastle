import { randomUUID } from "node:crypto";
import { constants, type Dirent, type Stats } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  opendir,
  realpath,
  unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export type LedgerPlatformFailureKind =
  | "path-boundary"
  | "unsupported-filesystem"
  | "unsupported-permissions"
  | "storage";

/** Persistence boundaries named by ADR-0025 / CC-009. */
export type LedgerPersistencePoint =
  | "candidate-created"
  | "candidate-written"
  | "candidate-synced"
  | "candidate-closed"
  | "candidate-validated"
  | "publication-linked"
  | "published-file-synced"
  | "publication-directory-synced"
  | "candidate-unlinked"
  | "cleanup-directory-synced"
  | "committed-verified"
  | "before-acknowledge";

/** Required internal fault service. Production always supplies the no-op service. */
export interface LedgerPersistenceFaultService {
  readonly hit: (point: LedgerPersistencePoint) => void | Promise<void>;
}

export const noLedgerPersistenceFaults: LedgerPersistenceFaultService = {
  hit: () => undefined,
};

export class LedgerDirectoryLimitFailure extends Error {
  readonly _tag = "LedgerDirectoryLimitFailure";
  constructor(readonly limit: number) {
    super("scan-limit");
  }
}

export class LedgerPlatformFailure extends Error {
  readonly _tag = "LedgerPlatformFailure";
  constructor(
    readonly kind: LedgerPlatformFailureKind,
    readonly artifact?: string,
    readonly published = false,
  ) {
    super(kind);
  }
}

class LedgerPersistenceInterruption extends LedgerPlatformFailure {
  readonly interrupted = true;

  constructor(artifact: string | undefined, published: boolean) {
    super("storage", artifact, published);
  }
}

export interface ReadRegularFileResult {
  readonly bytes: string;
  readonly stats: Stats;
}

export interface CandidateFile {
  readonly path: string;
  readonly name: string;
  readonly stats: Stats;
}

/** Mandatory filesystem/capability boundary used by every ledger path. */
export interface LedgerPlatformService {
  readonly canonicalRepositoryRoot: (repositoryRoot: string) => Promise<string>;
  readonly inspectPath: (
    path: string,
  ) => Promise<"missing" | "directory" | "symlink" | "other">;
  readonly existsNoFollow: (path: string) => Promise<boolean>;
  readonly assertContainedPath: (root: string, path: string) => void;
  readonly ensureBoundaryDirectory: (
    path: string,
    artifact: string,
  ) => Promise<void>;
  readonly ensurePrivateDirectory: (
    path: string,
    artifact: string,
  ) => Promise<void>;
  readonly assertSafeDirectory: (
    path: string,
    artifact: string,
  ) => Promise<Stats>;
  readonly listDirectory: (
    path: string,
    artifact: string,
    maximumEntries: number,
  ) => Promise<Dirent[]>;
  readonly readRegularFile: (
    path: string,
    artifact: string,
    maximumBytes: number,
    allowedLinks?: number,
  ) => Promise<ReadRegularFileResult>;
  readonly writeCandidate: (
    directory: string,
    operationDigest: string,
    bytes: string,
  ) => Promise<CandidateFile>;
  readonly removeFileBestEffort: (path: string) => Promise<void>;
  readonly publishCandidate: (
    directory: string,
    candidate: CandidateFile,
    finalPath: string,
    finalArtifact: string,
    bytes: string,
    authorizePublication?: () => void,
  ) => Promise<"published" | "exists">;
  readonly probeHardLinks: (directory: string) => Promise<void>;
  readonly persistencePoint: (
    point: LedgerPersistencePoint,
    artifact: string | undefined,
    published: boolean,
  ) => Promise<void>;
}

type PermissionCapability = "posix-owner-only" | "trusted-test" | "unsupported";
type DirectorySyncCapability = "posix" | "trusted-test" | "unsupported";

interface NodePlatformCapabilities {
  readonly permissions: PermissionCapability;
  readonly directorySync: DirectorySyncCapability;
  readonly noFollowOpen: boolean;
  readonly flushFiles: boolean;
}

const errorCode = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;

const sameIdentity = (left: Stats, right: Stats): boolean =>
  left.dev === right.dev && left.ino === right.ino;

const makeNodeLedgerPlatform = (
  capabilities: NodePlatformCapabilities,
  faults: LedgerPersistenceFaultService,
): LedgerPlatformService => {
  const persistencePoint = async (
    point: LedgerPersistencePoint,
    artifact: string | undefined,
    published: boolean,
  ): Promise<void> => {
    try {
      await faults.hit(point);
    } catch {
      throw new LedgerPersistenceInterruption(artifact, published);
    }
  };

  const assertOwnerOnly = (stats: Stats, artifact: string): void => {
    if (capabilities.permissions === "unsupported") {
      throw new LedgerPlatformFailure("unsupported-permissions", artifact);
    }
    if (
      capabilities.permissions === "posix-owner-only" &&
      (stats.mode & 0o077) !== 0
    ) {
      throw new LedgerPlatformFailure("unsupported-permissions", artifact);
    }
  };

  const assertNotUntrustedWritable = (stats: Stats, artifact: string): void => {
    if (capabilities.permissions === "unsupported") {
      throw new LedgerPlatformFailure("unsupported-permissions", artifact);
    }
    if (
      capabilities.permissions === "posix-owner-only" &&
      (stats.mode & 0o022) !== 0
    ) {
      throw new LedgerPlatformFailure("unsupported-permissions", artifact);
    }
  };

  const inspectPath = async (
    path: string,
  ): Promise<"missing" | "directory" | "symlink" | "other"> => {
    try {
      const stats = await lstat(path);
      if (stats.isSymbolicLink()) return "symlink";
      if (stats.isDirectory()) return "directory";
      return "other";
    } catch (error) {
      if (errorCode(error) === "ENOENT") return "missing";
      throw new LedgerPlatformFailure("storage");
    }
  };

  const existsNoFollow = async (path: string): Promise<boolean> =>
    (await inspectPath(path)) !== "missing";

  const assertContainedPath = (root: string, path: string): void => {
    const child = relative(root, path);
    if (
      child === "" ||
      child === ".." ||
      child.startsWith(`..${sep}`) ||
      isAbsolute(child)
    ) {
      throw new LedgerPlatformFailure("path-boundary");
    }
  };

  const canonicalRepositoryRoot = async (
    repositoryRoot: string,
  ): Promise<string> => {
    if (!isAbsolute(repositoryRoot)) {
      throw new LedgerPlatformFailure("path-boundary");
    }
    let stats: Stats;
    try {
      stats = await lstat(repositoryRoot);
    } catch (error) {
      if (errorCode(error) === "ENOENT") throw error;
      throw new LedgerPlatformFailure("storage");
    }
    if (stats.isSymbolicLink())
      throw new LedgerPlatformFailure("path-boundary");
    if (!stats.isDirectory()) throw new LedgerPlatformFailure("path-boundary");
    assertNotUntrustedWritable(stats, ".");
    return realpath(repositoryRoot);
  };

  const ensureDirectory = async (
    path: string,
    artifact: string,
    ownerOnly: boolean,
  ): Promise<void> => {
    let created = false;
    try {
      await mkdir(path, { mode: 0o700 });
      created = true;
    } catch (error) {
      if (errorCode(error) !== "EEXIST")
        throw new LedgerPlatformFailure("storage", artifact);
    }
    let stats: Stats;
    try {
      stats = await lstat(path);
    } catch {
      throw new LedgerPlatformFailure("storage", artifact);
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new LedgerPlatformFailure("path-boundary", artifact);
    }
    if (ownerOnly) assertOwnerOnly(stats, artifact);
    else assertNotUntrustedWritable(stats, artifact);
    // FR-023 / INV-005: a newly created record or ledger directory must be
    // durable in its parent before a child generation can be acknowledged.
    if (created) await syncDirectory(dirname(path), artifact);
  };

  const ensureBoundaryDirectory = (
    path: string,
    artifact: string,
  ): Promise<void> => ensureDirectory(path, artifact, false);

  const ensurePrivateDirectory = (
    path: string,
    artifact: string,
  ): Promise<void> => ensureDirectory(path, artifact, true);

  const assertSafeDirectory = async (
    path: string,
    artifact: string,
  ): Promise<Stats> => {
    let stats: Stats;
    try {
      stats = await lstat(path);
    } catch {
      throw new LedgerPlatformFailure("storage", artifact);
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new LedgerPlatformFailure("path-boundary", artifact);
    }
    assertOwnerOnly(stats, artifact);
    return stats;
  };

  const listDirectory = async (
    path: string,
    artifact: string,
    maximumEntries: number,
  ): Promise<Dirent[]> => {
    await assertSafeDirectory(path, artifact);
    let directory;
    try {
      directory = await opendir(path);
      const entries: Dirent[] = [];
      for await (const entry of directory) {
        if (entries.length >= maximumEntries) {
          throw new LedgerDirectoryLimitFailure(maximumEntries);
        }
        entries.push(entry);
      }
      return entries;
    } catch (error) {
      if (
        error instanceof LedgerPlatformFailure ||
        error instanceof LedgerDirectoryLimitFailure
      ) {
        throw error;
      }
      throw new LedgerPlatformFailure("storage", artifact);
    } finally {
      await directory?.close().catch(() => undefined);
    }
  };

  const readOpenFlags = capabilities.noFollowOpen
    ? constants.O_RDONLY | constants.O_NOFOLLOW
    : constants.O_RDONLY;
  const writeOpenFlags = capabilities.noFollowOpen
    ? constants.O_RDWR | constants.O_NOFOLLOW
    : constants.O_RDWR;

  const readRegularFile = async (
    path: string,
    artifact: string,
    maximumBytes: number,
    allowedLinks = 1,
  ): Promise<ReadRegularFileResult> => {
    let before: Stats;
    try {
      before = await lstat(path);
    } catch {
      throw new LedgerPlatformFailure("storage", artifact);
    }
    if (before.isSymbolicLink() || !before.isFile()) {
      throw new LedgerPlatformFailure("path-boundary", artifact);
    }
    assertOwnerOnly(before, artifact);
    if (
      before.size > maximumBytes ||
      before.nlink < 1 ||
      before.nlink > allowedLinks
    ) {
      throw new LedgerPlatformFailure("path-boundary", artifact);
    }
    let handle;
    try {
      handle = await open(path, readOpenFlags);
      const opened = await handle.stat();
      if (!sameIdentity(before, opened) || !opened.isFile()) {
        throw new LedgerPlatformFailure("path-boundary", artifact);
      }
      const bytes = await handle.readFile({ encoding: "utf8" });
      const after = await handle.stat();
      if (
        !sameIdentity(opened, after) ||
        after.size !== Buffer.byteLength(bytes, "utf8")
      ) {
        throw new LedgerPlatformFailure("path-boundary", artifact);
      }
      return { bytes, stats: after };
    } catch (error) {
      if (error instanceof LedgerPlatformFailure) throw error;
      throw new LedgerPlatformFailure("storage", artifact);
    } finally {
      await handle?.close().catch(() => undefined);
    }
  };

  const syncDirectory = async (
    path: string,
    artifact: string,
  ): Promise<void> => {
    if (capabilities.directorySync === "unsupported") {
      throw new LedgerPlatformFailure("unsupported-filesystem", artifact);
    }
    if (capabilities.directorySync === "trusted-test") return;
    let handle;
    try {
      handle = await open(path, readOpenFlags);
      await handle.sync();
    } catch {
      throw new LedgerPlatformFailure("unsupported-filesystem", artifact);
    } finally {
      await handle?.close().catch(() => undefined);
    }
  };

  const writeAll = async (
    handle: Awaited<ReturnType<typeof open>>,
    bytes: Buffer,
  ): Promise<void> => {
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.write(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (result.bytesWritten <= 0) throw new LedgerPlatformFailure("storage");
      offset += result.bytesWritten;
    }
  };

  const createExclusiveFile = async (
    path: string,
    artifact: string,
    text: string,
  ): Promise<boolean> => {
    const createFlags = capabilities.noFollowOpen
      ? constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW
      : constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL;
    let handle;
    try {
      handle = await open(path, createFlags, 0o600);
    } catch (error) {
      if (errorCode(error) === "EEXIST") return false;
      throw new LedgerPlatformFailure("storage", artifact);
    }
    try {
      await persistencePoint("candidate-created", artifact, false);
      await writeAll(handle, Buffer.from(text, "utf8"));
      await persistencePoint("candidate-written", artifact, false);
      if (capabilities.flushFiles) await handle.sync();
      await persistencePoint("candidate-synced", artifact, false);
    } catch (error) {
      if (error instanceof LedgerPlatformFailure) throw error;
      throw new LedgerPlatformFailure("storage", artifact);
    } finally {
      await handle.close().catch(() => undefined);
    }
    await persistencePoint("candidate-closed", artifact, false);
    return true;
  };

  const removeFileBestEffort = async (path: string): Promise<void> => {
    await unlink(path).catch(() => undefined);
  };

  const writeCandidate = async (
    directory: string,
    operationDigest: string,
    bytes: string,
  ): Promise<CandidateFile> => {
    const name = `.${operationDigest}.${randomUUID().replace(/-/g, "")}.tmp`;
    const path = resolve(directory, name);
    assertContainedPath(directory, path);
    const created = await createExclusiveFile(path, name, bytes);
    if (!created) throw new LedgerPlatformFailure("storage", name);
    try {
      const directoryStats = await assertSafeDirectory(directory, ".");
      const verified = await readRegularFile(
        path,
        name,
        Buffer.byteLength(bytes, "utf8"),
        1,
      );
      if (
        verified.bytes !== bytes ||
        verified.stats.nlink !== 1 ||
        verified.stats.dev !== directoryStats.dev
      ) {
        throw new LedgerPlatformFailure("path-boundary", name);
      }
      await persistencePoint("candidate-validated", name, false);
      return { path, name, stats: verified.stats };
    } catch (error) {
      if (!(error instanceof LedgerPersistenceInterruption)) {
        await unlink(path).catch(() => undefined);
      }
      throw error;
    }
  };

  const publishCandidate = async (
    directory: string,
    candidate: CandidateFile,
    finalPath: string,
    finalArtifact: string,
    bytes: string,
    authorizePublication?: () => void,
  ): Promise<"published" | "exists"> => {
    try {
      authorizePublication?.();
      await link(candidate.path, finalPath);
    } catch (error) {
      if (errorCode(error) === "EEXIST") {
        await removeFileBestEffort(candidate.path);
        return "exists";
      }
      await removeFileBestEffort(candidate.path);
      const code = errorCode(error);
      if (
        code === "EXDEV" ||
        code === "EPERM" ||
        code === "ENOTSUP" ||
        code === "EOPNOTSUPP"
      ) {
        throw new LedgerPlatformFailure(
          "unsupported-filesystem",
          finalArtifact,
        );
      }
      if (code === undefined) throw error;
      throw new LedgerPlatformFailure("storage", finalArtifact);
    }

    try {
      await persistencePoint("publication-linked", finalArtifact, true);
      const final = await readRegularFile(
        finalPath,
        finalArtifact,
        Buffer.byteLength(bytes, "utf8"),
        2,
      );
      if (
        !sameIdentity(candidate.stats, final.stats) ||
        final.stats.nlink !== 2 ||
        final.bytes !== bytes
      ) {
        throw new LedgerPlatformFailure("path-boundary", finalArtifact, true);
      }
      let finalHandle;
      try {
        finalHandle = await open(finalPath, writeOpenFlags);
        const opened = await finalHandle.stat();
        if (!sameIdentity(final.stats, opened) || !opened.isFile()) {
          throw new LedgerPlatformFailure("path-boundary", finalArtifact, true);
        }
        if (capabilities.flushFiles) await finalHandle.sync();
      } finally {
        await finalHandle?.close().catch(() => undefined);
      }
      await persistencePoint("published-file-synced", finalArtifact, true);
      await syncDirectory(directory, finalArtifact);
      await persistencePoint(
        "publication-directory-synced",
        finalArtifact,
        true,
      );
      await unlink(candidate.path);
      await persistencePoint("candidate-unlinked", finalArtifact, true);
      await syncDirectory(directory, finalArtifact);
      await persistencePoint("cleanup-directory-synced", finalArtifact, true);
      const durable = await readRegularFile(
        finalPath,
        finalArtifact,
        Buffer.byteLength(bytes, "utf8"),
        1,
      );
      if (
        !sameIdentity(candidate.stats, durable.stats) ||
        durable.bytes !== bytes ||
        durable.stats.nlink !== 1
      ) {
        throw new LedgerPlatformFailure("path-boundary", finalArtifact, true);
      }
      await persistencePoint("committed-verified", finalArtifact, true);
      return "published";
    } catch (error) {
      if (error instanceof LedgerPlatformFailure) {
        throw new LedgerPlatformFailure(error.kind, error.artifact, true);
      }
      throw new LedgerPlatformFailure("storage", finalArtifact, true);
    }
  };

  const probeHardLinks = async (directory: string): Promise<void> => {
    const suffix = randomUUID().replace(/-/g, "");
    const source = resolve(directory, `.capability-${suffix}.tmp`);
    const destination = resolve(directory, `.capability-${suffix}.link`);
    try {
      const created = await createExclusiveFile(
        source,
        ".capability.tmp",
        "capability\n",
      );
      if (!created) throw new LedgerPlatformFailure("unsupported-filesystem");
      await link(source, destination);
      const sourceStats = await lstat(source);
      const destinationStats = await lstat(destination);
      assertOwnerOnly(sourceStats, ".capability.tmp");
      assertOwnerOnly(destinationStats, ".capability.link");
      if (
        !sameIdentity(sourceStats, destinationStats) ||
        sourceStats.nlink !== 2
      ) {
        throw new LedgerPlatformFailure("unsupported-filesystem");
      }
      await syncDirectory(directory, ".");
    } catch (error) {
      if (error instanceof LedgerPlatformFailure) throw error;
      throw new LedgerPlatformFailure("unsupported-filesystem");
    } finally {
      await unlink(destination).catch(() => undefined);
      await unlink(source).catch(() => undefined);
    }
  };

  return {
    canonicalRepositoryRoot,
    inspectPath,
    existsNoFollow,
    assertContainedPath,
    ensureBoundaryDirectory,
    ensurePrivateDirectory,
    assertSafeDirectory,
    listDirectory,
    readRegularFile,
    writeCandidate,
    removeFileBestEffort,
    publishCandidate,
    probeHardLinks,
    persistencePoint,
  };
};

/** Concrete production service. Windows fails closed before ledger creation. */
export const systemLedgerPlatform: LedgerPlatformService =
  makeNodeLedgerPlatform(
    process.platform === "win32"
      ? {
          permissions: "unsupported",
          directorySync: "unsupported",
          noFollowOpen: false,
          flushFiles: true,
        }
      : {
          permissions: "posix-owner-only",
          directorySync: "posix",
          noFollowOpen: true,
          flushFiles: true,
        },
    noLedgerPersistenceFaults,
  );

/**
 * Internal portable test platform. It trusts the isolated fixture ACL boundary,
 * retains real exclusive hard-link publication, and models flush barriers.
 */
export const makeTrustedTestLedgerPlatform = (
  faults: LedgerPersistenceFaultService,
): LedgerPlatformService =>
  makeNodeLedgerPlatform(
    {
      permissions: "trusted-test",
      directorySync: "trusted-test",
      noFollowOpen: process.platform !== "win32",
      flushFiles: false,
    },
    faults,
  );
