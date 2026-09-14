import { Context, Effect, Layer } from "effect";
import { join, posix, resolve } from "node:path";
import type {
  AcquireDevSquadAdoWorkflowClaimInput,
  CheckpointDevSquadAdoWorkflowInput,
  DevSquadAdoClaimAuthority,
  DevSquadAdoClaimMetadata,
  DevSquadAdoLedgerError,
  DevSquadAdoLedgerResult,
  DevSquadAdoMutationSuccess,
  DevSquadAdoRecoveryError,
  DevSquadAdoWorkflowLedger,
  DevSquadAdoWorkflowRecord,
  DevSquadAdoWorkItemId,
  InitializeDevSquadAdoWorkflowRecordInput,
  OpenDevSquadAdoWorkflowLedgerInput,
  ReleaseDevSquadAdoWorkflowClaimInput,
  RenewDevSquadAdoWorkflowClaimInput,
} from "./DevSquadAdoWorkflowLedger.js";
import {
  LedgerDirectoryLimitFailure,
  LedgerPlatformFailure,
  systemLedgerPlatform,
} from "./DevSquadAdoWorkflowLedgerPlatform.js";
import type { LedgerPlatformService } from "./DevSquadAdoWorkflowLedgerPlatform.js";
import {
  LEDGER_KIND,
  MAX_CHECKPOINTS,
  MAX_GENERATION_BYTES,
  MAX_OPERATIONS,
  MAX_PUBLICATION_ATTEMPTS,
  MAX_RECORD_DIRECTORY_ENTRIES,
  MAX_RECORDS,
  MAX_RECOVERY_ARTIFACTS,
  MAX_REFERENCE_HISTORY,
  RECORD_KIND,
  SCHEMA_VERSION,
  PersistedSchemaFailure,
  addLease,
  canonicalizeWorkItemId,
  claimTokenVerifier,
  parseManifest,
  parseRecord,
  publicRecord,
  requestDigest,
  sealRecord,
  serializeManifest,
  serializeRecord,
  timestampFromDate,
  validateAcquireInput,
  validateCheckpointInput,
  validateInitializeInput,
  validateOpenInput,
  validateReleaseInput,
  validateRenewInput,
  verifierMatches,
  workItemStorageKey,
} from "./DevSquadAdoWorkflowLedgerSchema.js";
import type {
  LedgerManifestV1,
  NormalizedAcquireInput,
  NormalizedCheckpointInput,
  NormalizedInitializeInput,
  NormalizedReleaseInput,
  NormalizedRenewInput,
  PersistedDevSquadAdoWorkflowRecordV1,
  PersistedOperationKind,
  PersistedOperationOutcomeV1,
  PersistedOperationReceiptV1,
  PersistedReferenceHistoryV1,
} from "./DevSquadAdoWorkflowLedgerSchema.js";

/**
 * Schema-v1 persistence core for slice 13 (FR-001–046 / INV-001–012),
 * following ADR-0025's offline, immutable-generation, fenced-ledger decision.
 */
export interface LedgerRuntimeService {
  readonly now: () => Date;
  readonly platform: LedgerPlatformService;
}

class LedgerRuntime extends Context.Tag(
  "sandcastle/DevSquadAdoWorkflowLedgerRuntime",
)<LedgerRuntime, LedgerRuntimeService>() {}

const systemRuntimeLayer = Layer.succeed(LedgerRuntime, {
  now: () => new Date(),
  platform: systemLedgerPlatform,
});

interface LedgerContext {
  readonly root: string;
  readonly ledgerRoot: string;
  readonly recordsRoot: string;
  readonly runtime: LedgerRuntimeService;
}

class DomainFailure {
  readonly _tag = "DomainFailure";
  constructor(readonly error: DevSquadAdoLedgerError) {}
}

class PublicationRace {
  readonly _tag = "PublicationRace";
}

const ok = <T>(value: T): DevSquadAdoLedgerResult<T> => ({ ok: true, value });
const fail = <T = never>(
  error: DevSquadAdoLedgerError,
): DevSquadAdoLedgerResult<T> => ({ ok: false, error });

const codeOf = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;

const mapPlatformFailure = (
  error: LedgerPlatformFailure,
): DevSquadAdoLedgerError => {
  if (error.kind === "path-boundary")
    return {
      kind: "path-boundary",
      ...(error.artifact === undefined ? {} : { artifact: error.artifact }),
    };
  if (error.kind === "unsupported-filesystem")
    return { kind: "unsupported-filesystem" };
  if (error.kind === "unsupported-permissions")
    return {
      kind: "unsupported-permissions",
      ...(error.artifact === undefined ? {} : { artifact: error.artifact }),
    };
  return {
    kind: "storage",
    outcome: error.published ? "indeterminate" : "unchanged",
  };
};

const safeOperation = async <T>(
  operation: () => Promise<T>,
): Promise<DevSquadAdoLedgerResult<T>> => {
  try {
    return ok(await operation());
  } catch (error) {
    if (error instanceof DomainFailure) return fail(error.error);
    if (error instanceof LedgerDirectoryLimitFailure)
      return fail({ kind: "scan-limit", limit: error.limit });
    if (error instanceof LedgerPlatformFailure)
      return fail(mapPlatformFailure(error));
    if (error instanceof PersistedSchemaFailure)
      return fail({
        kind: error.kind,
        artifact: "ledger.json",
        ...(error.kind === "unsupported-schema-version"
          ? { schemaVersion: error.schemaVersion ?? -1 }
          : {}),
      } as DevSquadAdoLedgerError);
    return fail({ kind: "storage", outcome: "unchanged" });
  }
};

const existsNoFollow = (
  platform: LedgerPlatformService,
  path: string,
): Promise<boolean> => platform.existsNoFollow(path);

const generationFilename = (revision: number): string =>
  `${String(revision).padStart(16, "0")}.json`;
const committedPattern = /^(\d{16})\.json$/;
const candidatePattern = /^\.[a-f0-9]{64}\.[a-f0-9]{32}\.tmp$/;
const capabilityProbePattern = /^\.capability-[a-f0-9]{32}\.(?:tmp|link)$/;
const recordDirectoryPattern = /^wi-[a-f0-9]{64}$/;
const artifactFor = (recordKey: string): string =>
  posix.join("records", recordKey);

// ADR-0025 data minimization: directory-entry basenames are attacker-controlled
// even when they match a recognized publication shape. Diagnostics identify
// only a containing artifact whose identity has an independent trust source.
const untrustedRecordArtifact = "records";

const schemaError = (error: unknown, artifact: string): never => {
  if (error instanceof PersistedSchemaFailure) {
    if (error.kind === "unsupported-schema-version") {
      throw new DomainFailure({
        kind: "unsupported-schema-version",
        artifact,
        schemaVersion: error.schemaVersion ?? -1,
      });
    }
    throw new DomainFailure({ kind: "corrupt-artifact", artifact });
  }
  throw error;
};

const sameArtifactIdentity = (
  left: { readonly dev: number; readonly ino: number },
  right: { readonly dev: number; readonly ino: number },
): boolean => left.dev === right.dev && left.ino === right.ino;

const verifyRecognizedPublicationLink = async (
  platform: LedgerPlatformService,
  finalPath: string,
  finalArtifact: string,
  maximumBytes: number,
  final: Awaited<ReturnType<LedgerPlatformService["readRegularFile"]>>,
  directory: string,
  candidateNames: readonly string[],
  candidateArtifact: (name: string) => string,
  refreshCandidateNames?: () => Promise<readonly string[]>,
): Promise<void> => {
  if (final.stats.nlink !== 2) return;
  const hasMatchingCandidate = async (
    names: readonly string[],
    reference: typeof final,
  ): Promise<boolean> => {
    for (const candidateName of names) {
      try {
        const candidate = await platform.readRegularFile(
          join(directory, candidateName),
          candidateArtifact(candidateName),
          maximumBytes,
          2,
        );
        if (
          sameArtifactIdentity(candidate.stats, reference.stats) &&
          candidate.bytes === reference.bytes
        ) {
          return true;
        }
      } catch (error) {
        // A publisher may remove a recognized candidate after enumeration.
        if (!(error instanceof LedgerPlatformFailure)) throw error;
      }
    }
    return false;
  };

  if (await hasMatchingCandidate(candidateNames, final)) return;

  let afterCleanup = await platform.readRegularFile(
    finalPath,
    finalArtifact,
    maximumBytes,
    2,
  );
  const matchesOriginalFinal = (value: typeof afterCleanup): boolean =>
    sameArtifactIdentity(value.stats, final.stats) &&
    value.bytes === final.bytes;
  if (afterCleanup.stats.nlink === 1 && matchesOriginalFinal(afterCleanup)) {
    return;
  }

  // A concurrent publisher may have linked the generation after the first
  // directory snapshot. Re-list exactly once before treating the unexplained
  // second link as corruption; persistent inconsistency still fails closed.
  if (
    afterCleanup.stats.nlink === 2 &&
    matchesOriginalFinal(afterCleanup) &&
    refreshCandidateNames !== undefined
  ) {
    const refreshedCandidateNames = await refreshCandidateNames();
    if (await hasMatchingCandidate(refreshedCandidateNames, afterCleanup)) {
      return;
    }
    afterCleanup = await platform.readRegularFile(
      finalPath,
      finalArtifact,
      maximumBytes,
      2,
    );
    if (afterCleanup.stats.nlink === 1 && matchesOriginalFinal(afterCleanup)) {
      return;
    }
  }

  throw new DomainFailure({
    kind: "corrupt-artifact",
    artifact: finalArtifact,
  });
};

const ensureLedgerPaths = async (context: LedgerContext): Promise<void> => {
  await context.runtime.platform.assertSafeDirectory(context.ledgerRoot, ".");
  await context.runtime.platform.assertSafeDirectory(
    context.recordsRoot,
    "records",
  );
};

const ensureManifest = async (
  context: LedgerContext,
  now: Date,
): Promise<void> => {
  const { ledgerRoot } = context;
  const { platform } = context.runtime;
  const path = join(ledgerRoot, "ledger.json");
  if (!(await existsNoFollow(platform, path))) {
    const manifest: LedgerManifestV1 = {
      kind: LEDGER_KIND,
      schemaVersion: SCHEMA_VERSION,
      createdAt: timestampFromDate(now),
    };
    const bytes = serializeManifest(manifest);
    const digest = requestDigest("initialize", {
      kind: LEDGER_KIND,
      createdAt: manifest.createdAt,
    });
    const candidate = await platform.writeCandidate(ledgerRoot, digest, bytes);
    await platform.publishCandidate(
      ledgerRoot,
      candidate,
      path,
      "ledger.json",
      bytes,
    );
  }
  const read = await platform.readRegularFile(path, "ledger.json", 16_384, 2);
  if (read.stats.nlink === 2) {
    const candidateNames = (
      await platform.listDirectory(
        ledgerRoot,
        ".",
        MAX_RECORD_DIRECTORY_ENTRIES,
      )
    )
      .map((entry) => entry.name)
      .filter((name) => candidatePattern.test(name))
      .sort((left, right) => left.localeCompare(right));
    await verifyRecognizedPublicationLink(
      platform,
      path,
      "ledger.json",
      16_384,
      read,
      ledgerRoot,
      candidateNames,
      () => ".",
    );
  }
  try {
    parseManifest(read.bytes);
  } catch (error) {
    schemaError(error, "ledger.json");
  }
};

const validateLedgerTopLevel = async (
  context: LedgerContext,
): Promise<void> => {
  const entries = await context.runtime.platform.listDirectory(
    context.ledgerRoot,
    ".",
    MAX_RECORD_DIRECTORY_ENTRIES,
  );
  for (const entry of entries) {
    const isPublicationCandidate = candidatePattern.test(entry.name);
    const isCapabilityProbe = capabilityProbePattern.test(entry.name);
    if (isPublicationCandidate || isCapabilityProbe) {
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new DomainFailure({
          kind: "path-boundary",
          artifact: ".",
        });
      }
      continue;
    }
    if (entry.name === "ledger.json") {
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new DomainFailure({
          kind: "path-boundary",
          artifact: "ledger.json",
        });
      }
      continue;
    }
    if (entry.name === "records") {
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        throw new DomainFailure({
          kind: "path-boundary",
          artifact: "records",
        });
      }
      continue;
    }
    // Arbitrary directory-entry names are untrusted and may themselves be
    // credentials or payloads. Report only the fixed containing artifact.
    throw new DomainFailure({ kind: "corrupt-artifact", artifact: "." });
  }
};

const openCore = async (
  input: OpenDevSquadAdoWorkflowLedgerInput,
  runtime: LedgerRuntimeService,
): Promise<DevSquadAdoLedgerResult<DevSquadAdoWorkflowLedger>> => {
  const validated = validateOpenInput(input);
  if (!validated.ok) return validated;
  let root: string;
  try {
    root = await runtime.platform.canonicalRepositoryRoot(
      validated.value.repositoryRoot,
    );
  } catch (error) {
    if (codeOf(error) === "ENOENT")
      return fail({ kind: "repository-not-found" });
    if (
      error instanceof LedgerPlatformFailure &&
      error.kind === "path-boundary"
    ) {
      try {
        if (
          (await runtime.platform.inspectPath(
            validated.value.repositoryRoot,
          )) === "other"
        ) {
          return fail({ kind: "repository-not-directory" });
        }
      } catch {
        // The stable path-boundary category below intentionally redacts OS text.
      }
    }
    return fail(
      error instanceof LedgerPlatformFailure
        ? mapPlatformFailure(error)
        : { kind: "storage", outcome: "unchanged" },
    );
  }

  const configRoot = resolve(root, ".sandcastle");
  const ledgerRoot = resolve(configRoot, "devsquad-ado");
  const recordsRoot = resolve(ledgerRoot, "records");
  try {
    runtime.platform.assertContainedPath(root, configRoot);
    runtime.platform.assertContainedPath(root, ledgerRoot);
    runtime.platform.assertContainedPath(ledgerRoot, recordsRoot);
    await runtime.platform.ensureBoundaryDirectory(configRoot, ".sandcastle");
    await runtime.platform.ensurePrivateDirectory(ledgerRoot, ".");
    await runtime.platform.ensurePrivateDirectory(recordsRoot, "records");
    const context: LedgerContext = { root, ledgerRoot, recordsRoot, runtime };
    // ADR-0025: prove atomic publication and directory durability capability
    // before creating any committed ledger artifact.
    await runtime.platform.probeHardLinks(ledgerRoot);
    await ensureManifest(context, runtime.now());
    await validateLedgerTopLevel(context);
    return ok(makeLedger(context));
  } catch (error) {
    if (error instanceof DomainFailure) return fail(error.error);
    if (error instanceof LedgerDirectoryLimitFailure)
      return fail({ kind: "scan-limit", limit: error.limit });
    if (error instanceof LedgerPlatformFailure)
      return fail(mapPlatformFailure(error));
    if (error instanceof PersistedSchemaFailure)
      return fail({
        kind: error.kind,
        artifact: "ledger.json",
        ...(error.kind === "unsupported-schema-version"
          ? { schemaVersion: error.schemaVersion ?? -1 }
          : {}),
      } as DevSquadAdoLedgerError);
    return fail({ kind: "storage", outcome: "unchanged" });
  }
};

interface LoadedRecord {
  readonly record: PersistedDevSquadAdoWorkflowRecordV1;
  readonly directory: string;
  readonly recordKey: string;
  readonly artifactCount: number;
  readonly warnings: readonly DevSquadAdoRecoveryError[];
}

const peekWorkItemId = (
  bytes: string,
  recordKey: string,
  artifact: string,
): string => {
  try {
    const value = JSON.parse(bytes) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value))
      throw new PersistedSchemaFailure("corrupt-artifact");
    const workItemId = (value as Record<string, unknown>).workItemId;
    if (typeof workItemId !== "string")
      throw new PersistedSchemaFailure("corrupt-artifact");
    const canonical = canonicalizeWorkItemId(workItemId);
    if (
      !canonical.ok ||
      canonical.value !== workItemId ||
      workItemStorageKey(workItemId) !== recordKey
    ) {
      throw new PersistedSchemaFailure("corrupt-artifact");
    }
    return workItemId;
  } catch (error) {
    return schemaError(error, artifact);
  }
};

const loadRecordDirectory = async (
  context: LedgerContext,
  recordKey: string,
  expectedWorkItemId?: string,
): Promise<LoadedRecord> => {
  await ensureLedgerPaths(context);
  if (!recordDirectoryPattern.test(recordKey)) {
    throw new DomainFailure({
      kind: "corrupt-artifact",
      artifact: "records",
    });
  }
  const directory = resolve(context.recordsRoot, recordKey);
  context.runtime.platform.assertContainedPath(context.recordsRoot, directory);
  const directoryArtifact =
    expectedWorkItemId === undefined
      ? untrustedRecordArtifact
      : artifactFor(recordKey);
  await context.runtime.platform.assertSafeDirectory(
    directory,
    directoryArtifact,
  );
  const entries = (
    await context.runtime.platform.listDirectory(
      directory,
      directoryArtifact,
      MAX_RECORD_DIRECTORY_ENTRIES,
    )
  ).sort((left, right) => left.name.localeCompare(right.name));
  if (entries.length > MAX_RECORD_DIRECTORY_ENTRIES) {
    throw new DomainFailure({
      kind: "scan-limit",
      limit: MAX_RECORD_DIRECTORY_ENTRIES,
    });
  }
  const committed: Array<{ readonly name: string; readonly revision: number }> =
    [];
  const candidates: string[] = [];
  for (const entry of entries) {
    const entryArtifact = directoryArtifact;
    if (entry.isDirectory() || entry.isSymbolicLink()) {
      throw new DomainFailure({
        kind: "path-boundary",
        artifact: entryArtifact,
      });
    }
    const generationMatch = committedPattern.exec(entry.name);
    if (generationMatch) {
      const revision = Number(generationMatch[1]);
      if (!Number.isSafeInteger(revision) || revision <= 0) {
        throw new DomainFailure({
          kind: "corrupt-artifact",
          artifact: entryArtifact,
        });
      }
      committed.push({ name: entry.name, revision });
      continue;
    }
    if (candidatePattern.test(entry.name)) {
      candidates.push(entry.name);
      continue;
    }
    throw new DomainFailure({
      kind: "corrupt-artifact",
      artifact: entryArtifact,
    });
  }
  if (committed.length === 0)
    throw new DomainFailure({ kind: "record-not-found" });
  committed.sort((left, right) => left.revision - right.revision);
  const highest = committed.at(-1)!;
  const artifact = directoryArtifact;
  const final = await context.runtime.platform.readRegularFile(
    join(directory, highest.name),
    artifact,
    MAX_GENERATION_BYTES,
    2,
  );
  await verifyRecognizedPublicationLink(
    context.runtime.platform,
    join(directory, highest.name),
    artifact,
    MAX_GENERATION_BYTES,
    final,
    directory,
    candidates,
    () => directoryArtifact,
    async () =>
      (
        await context.runtime.platform.listDirectory(
          directory,
          directoryArtifact,
          MAX_RECORD_DIRECTORY_ENTRIES,
        )
      )
        .map((entry) => entry.name)
        .filter((name) => candidatePattern.test(name))
        .sort((left, right) => left.localeCompare(right)),
  );
  const workItemId =
    expectedWorkItemId ?? peekWorkItemId(final.bytes, recordKey, artifact);
  if (workItemStorageKey(workItemId) !== recordKey)
    throw new DomainFailure({ kind: "corrupt-artifact", artifact });
  let record: PersistedDevSquadAdoWorkflowRecordV1;
  try {
    record = parseRecord(final.bytes, workItemId, highest.revision);
  } catch (error) {
    record = schemaError(error, artifact);
  }
  const trustedArtifact = artifactFor(recordKey);
  const warnings: DevSquadAdoRecoveryError[] = [
    ...committed.slice(0, -1).map(() => ({
      kind: "superseded-generation" as const,
      severity: "warning" as const,
      artifact: trustedArtifact,
    })),
    ...candidates.map(() => ({
      kind: "leftover-candidate" as const,
      severity: "warning" as const,
      artifact: trustedArtifact,
    })),
  ].sort((left, right) => left.artifact.localeCompare(right.artifact));
  return {
    record,
    directory,
    recordKey,
    artifactCount: entries.length,
    warnings,
  };
};

const loadRecord = async (
  context: LedgerContext,
  workItemId: string,
): Promise<LoadedRecord> => {
  const key = workItemStorageKey(workItemId);
  const directory = resolve(context.recordsRoot, key);
  if (!(await existsNoFollow(context.runtime.platform, directory)))
    throw new DomainFailure({ kind: "record-not-found" });
  return loadRecordDirectory(context, key, workItemId);
};

const findReceipt = (
  record: PersistedDevSquadAdoWorkflowRecordV1,
  operationId: string,
  operationKind: PersistedOperationKind,
  digest: string,
): PersistedOperationReceiptV1 | undefined => {
  const receipt = record.operations.find(
    (entry) => entry.operationId === operationId,
  );
  if (
    receipt !== undefined &&
    (receipt.operationKind !== operationKind ||
      receipt.requestDigest !== digest)
  ) {
    throw new DomainFailure({ kind: "idempotency-conflict" });
  }
  return receipt;
};

const replayMutation = (
  record: PersistedDevSquadAdoWorkflowRecordV1,
  receipt: PersistedOperationReceiptV1,
  claimToken?: string,
): DevSquadAdoMutationSuccess<
  | PersistedOperationOutcomeV1
  | {
      readonly kind: "claim-acquired";
      readonly authority: DevSquadAdoClaimAuthority;
    }
> => {
  const outcome =
    receipt.outcome.kind === "claim-acquired"
      ? {
          kind: "claim-acquired" as const,
          authority: { ...receipt.outcome.claim, claimToken: claimToken! },
        }
      : receipt.outcome;
  return {
    acceptedRevision: receipt.acceptedRevision,
    acceptedAt: receipt.acceptedAt,
    replayed: true,
    outcome,
    record: publicRecord(record),
  };
};

const makeReceipt = (
  operationId: string,
  operationKind: PersistedOperationKind,
  digest: string,
  acceptedRevision: number,
  acceptedAt: string,
  outcome: PersistedOperationOutcomeV1,
): PersistedOperationReceiptV1 => ({
  operationId,
  operationKind,
  requestDigest: digest,
  acceptedRevision,
  acceptedAt,
  outcome,
});

const assertMutationCapacity = (
  record: PersistedDevSquadAdoWorkflowRecordV1,
  resource?: "checkpoints" | "agent-history" | "session-history",
): void => {
  if (record.operations.length >= MAX_OPERATIONS)
    throw new DomainFailure({
      kind: "capacity-exceeded",
      resource: "operations",
      limit: MAX_OPERATIONS,
    });
  if (
    resource === "checkpoints" &&
    record.checkpoints.length >= MAX_CHECKPOINTS
  )
    throw new DomainFailure({
      kind: "capacity-exceeded",
      resource,
      limit: MAX_CHECKPOINTS,
    });
  if (
    resource === "agent-history" &&
    record.execution.agent.history.length >= MAX_REFERENCE_HISTORY
  )
    throw new DomainFailure({
      kind: "capacity-exceeded",
      resource,
      limit: MAX_REFERENCE_HISTORY,
    });
  if (
    resource === "session-history" &&
    record.execution.session.history.length >= MAX_REFERENCE_HISTORY
  )
    throw new DomainFailure({
      kind: "capacity-exceeded",
      resource,
      limit: MAX_REFERENCE_HISTORY,
    });
};

const publishRecord = async (
  context: LedgerContext,
  loaded: {
    readonly directory: string;
    readonly record?: PersistedDevSquadAdoWorkflowRecordV1;
  },
  record: PersistedDevSquadAdoWorkflowRecordV1,
  digest: string,
  notAfter?: string,
): Promise<void> => {
  const authorizePublication = () => {
    if (
      notAfter !== undefined &&
      timestampFromDate(context.runtime.now()) >= notAfter
    )
      throw new DomainFailure({
        kind: "validation",
        field: "notAfter",
        reason: "expired before acceptance",
      });
  };
  const bytes = serializeRecord(record);
  if (Buffer.byteLength(bytes, "utf8") > MAX_GENERATION_BYTES) {
    throw new DomainFailure({
      kind: "capacity-exceeded",
      resource: "generation-bytes",
      limit: MAX_GENERATION_BYTES,
    });
  }
  const candidate = await context.runtime.platform.writeCandidate(
    loaded.directory,
    digest,
    bytes,
  );
  try {
    parseRecord(bytes, record.workItemId, record.revision);
  } catch (error) {
    await context.runtime.platform.removeFileBestEffort(candidate.path);
    schemaError(error, candidate.name);
  }
  const finalName = generationFilename(record.revision);
  const result = await context.runtime.platform.publishCandidate(
    loaded.directory,
    candidate,
    join(loaded.directory, finalName),
    finalName,
    bytes,
    authorizePublication,
  );
  if (result === "exists") throw new PublicationRace();
  if (loaded.record !== undefined) {
    for (
      let revision = Math.max(
        1,
        loaded.record.revision - MAX_RECORD_DIRECTORY_ENTRIES,
      );
      revision <= loaded.record.revision;
      revision++
    ) {
      await context.runtime.platform.removeFileBestEffort(
        join(loaded.directory, generationFilename(revision)),
      );
    }
  }
  await context.runtime.platform.persistencePoint(
    "before-acknowledge",
    finalName,
    true,
  );
};

const claimMetadata = (
  workItemId: string,
  active: NonNullable<PersistedDevSquadAdoWorkflowRecordV1["claim"]["active"]>,
): DevSquadAdoClaimMetadata => ({
  workItemId,
  ownerId: active.ownerId,
  fencingValue: active.fencingValue,
  acquiredAt: active.acquiredAt,
  heartbeatAt: active.heartbeatAt,
  expiresAt: active.expiresAt,
});

const requireAuthority = (
  record: PersistedDevSquadAdoWorkflowRecordV1,
  authority: {
    readonly ownerId: string;
    readonly claimToken: string;
    readonly fencingValue: number;
  },
  now: string,
): NonNullable<PersistedDevSquadAdoWorkflowRecordV1["claim"]["active"]> => {
  const active = record.claim.active;
  if (active === null) throw new DomainFailure({ kind: "claim-not-held" });
  if (authority.fencingValue !== active.fencingValue)
    throw new DomainFailure({
      kind: "stale-fencing",
      currentFencingValue: active.fencingValue,
    });
  if (
    !verifierMatches(authority.claimToken, active.tokenVerifier) ||
    authority.ownerId !== active.ownerId
  ) {
    throw new DomainFailure({ kind: "claim-authorization" });
  }
  if (now >= active.expiresAt)
    throw new DomainFailure({
      kind: "claim-expired",
      expiredAt: active.expiresAt,
    });
  return active;
};

const assertRecordCapacityAndDirectory = async (
  context: LedgerContext,
  workItemId: string,
): Promise<{ directory: string; recordKey: string }> => {
  await ensureLedgerPaths(context);
  const recordKey = workItemStorageKey(workItemId);
  const directory = resolve(context.recordsRoot, recordKey);
  context.runtime.platform.assertContainedPath(context.recordsRoot, directory);
  if (!(await existsNoFollow(context.runtime.platform, directory))) {
    const entries = await context.runtime.platform.listDirectory(
      context.recordsRoot,
      "records",
      MAX_RECORDS,
    );
    if (entries.length >= MAX_RECORDS)
      throw new DomainFailure({
        kind: "capacity-exceeded",
        resource: "records",
        limit: MAX_RECORDS,
      });
    for (const entry of entries) {
      if (
        !recordDirectoryPattern.test(entry.name) ||
        !entry.isDirectory() ||
        entry.isSymbolicLink()
      ) {
        throw new DomainFailure({
          kind: "corrupt-artifact",
          artifact: untrustedRecordArtifact,
        });
      }
    }
  }
  await context.runtime.platform.ensurePrivateDirectory(
    directory,
    artifactFor(recordKey),
  );
  return { directory, recordKey };
};

const initializeRecord = async (
  context: LedgerContext,
  input: InitializeDevSquadAdoWorkflowRecordInput,
): Promise<
  DevSquadAdoLedgerResult<
    DevSquadAdoMutationSuccess<{ readonly kind: "initialized" }>
  >
> => {
  const validated = validateInitializeInput(input);
  if (!validated.ok) return validated;
  return safeOperation(async () => {
    const normalized = validated.value;
    const acceptedAt = timestampFromDate(context.runtime.now());
    const digest = requestDigest("initialize", normalized);
    const location = await assertRecordCapacityAndDirectory(
      context,
      normalized.workItemId,
    );
    try {
      const existing = await loadRecordDirectory(
        context,
        location.recordKey,
        normalized.workItemId,
      );
      const receipt = findReceipt(
        existing.record,
        normalized.operationId,
        "initialize",
        digest,
      );
      if (receipt !== undefined)
        return replayMutation(
          existing.record,
          receipt,
        ) as DevSquadAdoMutationSuccess<{ readonly kind: "initialized" }>;
      throw new DomainFailure({ kind: "record-already-exists" });
    } catch (error) {
      if (
        !(error instanceof DomainFailure) ||
        error.error.kind !== "record-not-found"
      )
        throw error;
    }

    const outcome = { kind: "initialized" as const };
    const receipt = makeReceipt(
      normalized.operationId,
      "initialize",
      digest,
      1,
      acceptedAt,
      outcome,
    );
    const reference = (id: string | null): PersistedReferenceHistoryV1 => ({
      current: id,
      history:
        id === null ? [] : [{ id, revision: 1, activatedAt: acceptedAt }],
    });
    const record = sealRecord({
      kind: RECORD_KIND,
      schemaVersion: SCHEMA_VERSION,
      workItemId: normalized.workItemId,
      revision: 1,
      createdAt: acceptedAt,
      updatedAt: acceptedAt,
      workflow: { phase: normalized.phase, status: normalized.status },
      execution: {
        branch: normalized.branch,
        worktreePath: normalized.worktreePath,
        agent: reference(normalized.agentId),
        session: reference(normalized.sessionId),
      },
      pullRequest: normalized.pullRequest,
      observations: normalized.observations,
      checkpoints: [],
      claim: { fencingCounter: 0, active: null },
      operations: [receipt],
      previousGenerationDigest: null,
    });
    try {
      await publishRecord(
        context,
        { directory: location.directory },
        record,
        digest,
      );
    } catch (error) {
      if (!(error instanceof PublicationRace)) throw error;
      const winner = await loadRecordDirectory(
        context,
        location.recordKey,
        normalized.workItemId,
      );
      const receiptAfterRace = findReceipt(
        winner.record,
        normalized.operationId,
        "initialize",
        digest,
      );
      if (receiptAfterRace !== undefined)
        return replayMutation(
          winner.record,
          receiptAfterRace,
        ) as DevSquadAdoMutationSuccess<{ readonly kind: "initialized" }>;
      throw new DomainFailure({ kind: "record-already-exists" });
    }
    return {
      acceptedRevision: 1,
      acceptedAt,
      replayed: false,
      outcome,
      record: publicRecord(record),
    };
  });
};

const readRecord = async (
  context: LedgerContext,
  workItemId: DevSquadAdoWorkItemId,
): Promise<DevSquadAdoLedgerResult<DevSquadAdoWorkflowRecord>> => {
  const canonical = canonicalizeWorkItemId(workItemId);
  if (!canonical.ok) return canonical;
  return safeOperation(async () =>
    publicRecord((await loadRecord(context, canonical.value)).record),
  );
};

const recoveryFromError = (
  error: unknown,
  artifact: string,
): DevSquadAdoRecoveryError => {
  if (error instanceof LedgerDirectoryLimitFailure) {
    return { kind: "scan-limit", severity: "error", artifact };
  }
  if (error instanceof DomainFailure) {
    if (error.error.kind === "unsupported-schema-version")
      return {
        kind: "unsupported-schema-version",
        severity: "error",
        artifact: error.error.artifact,
      };
    if (error.error.kind === "path-boundary")
      return {
        kind: "path-boundary",
        severity: "error",
        artifact: error.error.artifact ?? artifact,
      };
    if (error.error.kind === "unsupported-permissions")
      return {
        kind: "unsupported-permissions",
        severity: "error",
        artifact: error.error.artifact ?? artifact,
      };
    if (error.error.kind === "scan-limit")
      return { kind: "scan-limit", severity: "error", artifact };
    return { kind: "corrupt-artifact", severity: "error", artifact };
  }
  if (error instanceof LedgerPlatformFailure) {
    if (error.kind === "path-boundary")
      return {
        kind: "path-boundary",
        severity: "error",
        artifact: error.artifact ?? artifact,
      };
    if (error.kind === "unsupported-permissions")
      return {
        kind: "unsupported-permissions",
        severity: "error",
        artifact: error.artifact ?? artifact,
      };
  }
  return { kind: "corrupt-artifact", severity: "error", artifact };
};

const LISTING_CONCURRENCY = 32;

const mapBounded = async <Input, Output>(
  values: readonly Input[],
  concurrency: number,
  operation: (value: Input) => Promise<Output>,
): Promise<Output[]> => {
  const results = new Array<Output>(values.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await operation(values[index]!);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () =>
      worker(),
    ),
  );
  return results;
};

type RecordScanOutcome =
  | { readonly loaded: LoadedRecord }
  | { readonly recoveryError: DevSquadAdoRecoveryError }
  | { readonly error: unknown; readonly artifact: string };

const scanRecords = async (
  context: LedgerContext,
): Promise<{
  readonly records: DevSquadAdoWorkflowRecord[];
  readonly errors: DevSquadAdoRecoveryError[];
}> => {
  await ensureLedgerPaths(context);
  const ledgerEntries = (
    await context.runtime.platform.listDirectory(
      context.ledgerRoot,
      ".",
      MAX_RECORD_DIRECTORY_ENTRIES,
    )
  ).sort((left, right) => left.name.localeCompare(right.name));
  const entries = (
    await context.runtime.platform.listDirectory(
      context.recordsRoot,
      "records",
      MAX_RECORDS,
    )
  ).sort((left, right) => left.name.localeCompare(right.name));
  if (entries.length > MAX_RECORDS)
    throw new DomainFailure({ kind: "scan-limit", limit: MAX_RECORDS });
  let artifacts = ledgerEntries.length + entries.length;
  const records: DevSquadAdoWorkflowRecord[] = [];
  const errors: DevSquadAdoRecoveryError[] = [];

  for (const entry of ledgerEntries) {
    if (candidatePattern.test(entry.name)) {
      errors.push(
        entry.isFile() && !entry.isSymbolicLink()
          ? {
              kind: "leftover-candidate",
              severity: "warning",
              artifact: ".",
            }
          : {
              kind: "path-boundary",
              severity: "error",
              artifact: ".",
            },
      );
      continue;
    }
    if (capabilityProbePattern.test(entry.name)) {
      if (!entry.isFile() || entry.isSymbolicLink()) {
        errors.push({
          kind: "path-boundary",
          severity: "error",
          artifact: ".",
        });
      }
      continue;
    }
    if (entry.name === "ledger.json" || entry.name === "records") continue;
    errors.push({
      kind: "corrupt-artifact",
      severity: "error",
      artifact: ".",
    });
  }

  // SC-005: filesystem work is bounded while indexed results preserve the
  // deterministic directory order and cap simultaneous descriptors.
  const outcomes = await mapBounded(
    entries,
    LISTING_CONCURRENCY,
    async (entry): Promise<RecordScanOutcome> => {
      const validRecordKey = recordDirectoryPattern.test(entry.name);
      const artifact = untrustedRecordArtifact;
      if (!validRecordKey || !entry.isDirectory() || entry.isSymbolicLink()) {
        return {
          recoveryError: {
            kind: entry.isSymbolicLink() ? "path-boundary" : "corrupt-artifact",
            severity: "error",
            artifact,
          },
        };
      }
      try {
        return {
          loaded: await loadRecordDirectory(context, entry.name),
        };
      } catch (error) {
        return { error, artifact };
      }
    },
  );

  for (const outcome of outcomes) {
    if ("recoveryError" in outcome) {
      errors.push(outcome.recoveryError);
      continue;
    }
    if ("error" in outcome) {
      if (
        outcome.error instanceof DomainFailure &&
        outcome.error.error.kind === "scan-limit" &&
        outcome.error.error.limit === MAX_RECOVERY_ARTIFACTS
      ) {
        throw outcome.error;
      }
      errors.push(recoveryFromError(outcome.error, outcome.artifact));
      continue;
    }
    artifacts += outcome.loaded.artifactCount;
    if (artifacts > MAX_RECOVERY_ARTIFACTS) {
      throw new DomainFailure({
        kind: "scan-limit",
        limit: MAX_RECOVERY_ARTIFACTS,
      });
    }
    records.push(publicRecord(outcome.loaded.record));
    errors.push(...outcome.loaded.warnings);
  }
  errors.sort(
    (left, right) =>
      left.artifact.localeCompare(right.artifact) ||
      left.kind.localeCompare(right.kind),
  );
  return { records, errors };
};

const listResumableRecords = async (
  context: LedgerContext,
): Promise<
  DevSquadAdoLedgerResult<{
    readonly records: readonly DevSquadAdoWorkflowRecord[];
    readonly recoveryErrors: readonly DevSquadAdoRecoveryError[];
  }>
> =>
  safeOperation(async () => {
    const scanned = await scanRecords(context);
    return { records: scanned.records, recoveryErrors: scanned.errors };
  });

const inspectRecoveryErrors = async (
  context: LedgerContext,
): Promise<DevSquadAdoLedgerResult<readonly DevSquadAdoRecoveryError[]>> =>
  safeOperation(async () => (await scanRecords(context)).errors);

const unsealRecord = (
  record: PersistedDevSquadAdoWorkflowRecordV1,
): Omit<PersistedDevSquadAdoWorkflowRecordV1, "integrity"> => {
  const { integrity: _integrity, ...unsealed } = record;
  return unsealed;
};

const acquireClaim = async (
  context: LedgerContext,
  input: AcquireDevSquadAdoWorkflowClaimInput,
): Promise<
  DevSquadAdoLedgerResult<
    DevSquadAdoMutationSuccess<{
      readonly kind: "claim-acquired";
      readonly authority: DevSquadAdoClaimAuthority;
    }>
  >
> => {
  const validated = validateAcquireInput(input);
  if (!validated.ok) return validated;
  return safeOperation(async () => {
    const normalized: NormalizedAcquireInput = validated.value;
    const nowDate = context.runtime.now();
    const acceptedAt = timestampFromDate(nowDate);
    const digest = requestDigest("acquire-claim", normalized);
    for (let attempt = 0; attempt < MAX_PUBLICATION_ATTEMPTS; attempt++) {
      const loaded = await loadRecord(context, normalized.workItemId);
      const replay = findReceipt(
        loaded.record,
        normalized.operationId,
        "acquire-claim",
        digest,
      );
      if (replay !== undefined)
        return replayMutation(
          loaded.record,
          replay,
          normalized.claimToken,
        ) as DevSquadAdoMutationSuccess<{
          readonly kind: "claim-acquired";
          readonly authority: DevSquadAdoClaimAuthority;
        }>;
      if (
        loaded.record.claim.active !== null &&
        acceptedAt < loaded.record.claim.active.expiresAt
      ) {
        throw new DomainFailure({
          kind: "claim-conflict",
          claim: claimMetadata(
            normalized.workItemId,
            loaded.record.claim.active,
          ),
        });
      }
      assertMutationCapacity(loaded.record);
      if (!Number.isSafeInteger(loaded.record.claim.fencingCounter + 1))
        throw new DomainFailure({
          kind: "capacity-exceeded",
          resource: "operations",
          limit: MAX_OPERATIONS,
        });
      const nextRevision = loaded.record.revision + 1;
      const active = {
        ownerId: normalized.ownerId,
        tokenVerifier: claimTokenVerifier(normalized.claimToken),
        fencingValue: loaded.record.claim.fencingCounter + 1,
        acquiredAt: acceptedAt,
        heartbeatAt: acceptedAt,
        expiresAt: addLease(nowDate, normalized.leaseDurationMs),
      };
      const metadata = claimMetadata(normalized.workItemId, active);
      const persistedOutcome = {
        kind: "claim-acquired" as const,
        claim: metadata,
      };
      const receipt = makeReceipt(
        normalized.operationId,
        "acquire-claim",
        digest,
        nextRevision,
        acceptedAt,
        persistedOutcome,
      );
      const record = sealRecord({
        ...unsealRecord(loaded.record),
        revision: nextRevision,
        updatedAt: acceptedAt,
        claim: { fencingCounter: active.fencingValue, active },
        operations: [...loaded.record.operations, receipt],
        previousGenerationDigest: loaded.record.integrity.digest,
      });
      try {
        await publishRecord(context, loaded, record, digest);
        return {
          acceptedRevision: nextRevision,
          acceptedAt,
          replayed: false,
          outcome: {
            kind: "claim-acquired",
            authority: { ...metadata, claimToken: normalized.claimToken },
          },
          record: publicRecord(record),
        };
      } catch (error) {
        if (!(error instanceof PublicationRace)) throw error;
      }
    }
    throw new DomainFailure({
      kind: "contention",
      attempts: MAX_PUBLICATION_ATTEMPTS,
    });
  });
};

const owns = (value: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const updateReference = (
  history: PersistedReferenceHistoryV1,
  patch: string | null,
  revision: number,
  acceptedAt: string,
): PersistedReferenceHistoryV1 => ({
  current: patch,
  history:
    patch !== null && patch !== history.current
      ? [...history.history, { id: patch, revision, activatedAt: acceptedAt }]
      : history.history,
});

const checkpoint = async (
  context: LedgerContext,
  input: CheckpointDevSquadAdoWorkflowInput,
): Promise<
  DevSquadAdoLedgerResult<
    DevSquadAdoMutationSuccess<{
      readonly kind: "checkpointed";
      readonly checkpoint: import("./DevSquadAdoWorkflowLedger.js").DevSquadAdoCheckpointEntry;
    }>
  >
> => {
  const validated = validateCheckpointInput(input);
  if (!validated.ok) return validated;
  return safeOperation(async () => {
    const normalized: NormalizedCheckpointInput = validated.value;
    const digest = requestDigest("checkpoint", normalized);
    const loaded = await loadRecord(context, normalized.workItemId);
    const replay = findReceipt(
      loaded.record,
      normalized.operationId,
      "checkpoint",
      digest,
    );
    if (replay !== undefined)
      return replayMutation(
        loaded.record,
        replay,
      ) as DevSquadAdoMutationSuccess<{
        readonly kind: "checkpointed";
        readonly checkpoint: import("./DevSquadAdoWorkflowLedger.js").DevSquadAdoCheckpointEntry;
      }>;
    const acceptedAt = timestampFromDate(context.runtime.now());
    if (
      normalized.notAfter !== undefined &&
      acceptedAt >= normalized.notAfter
    ) {
      throw new DomainFailure({
        kind: "validation",
        field: "notAfter",
        reason: "expired before acceptance",
      });
    }
    requireAuthority(loaded.record, normalized.authority, acceptedAt);
    if (normalized.expected.revision !== loaded.record.revision) {
      throw new DomainFailure({
        kind: "revision-conflict",
        expectedRevision: normalized.expected.revision,
        currentRevision: loaded.record.revision,
      });
    }
    if (
      normalized.expected.phase !== loaded.record.workflow.phase ||
      normalized.expected.status !== loaded.record.workflow.status
    ) {
      throw new DomainFailure({
        kind: "state-conflict",
        current: { ...loaded.record.workflow },
      });
    }
    assertMutationCapacity(loaded.record, "checkpoints");
    const nextRevision = loaded.record.revision + 1;
    if (
      owns(normalized.patch, "agentId") &&
      normalized.patch.agentId !== null &&
      normalized.patch.agentId !== loaded.record.execution.agent.current
    ) {
      assertMutationCapacity(loaded.record, "agent-history");
    }
    if (
      owns(normalized.patch, "sessionId") &&
      normalized.patch.sessionId !== null &&
      normalized.patch.sessionId !== loaded.record.execution.session.current
    ) {
      assertMutationCapacity(loaded.record, "session-history");
    }
    const workflow = {
      phase: normalized.patch.phase ?? loaded.record.workflow.phase,
      status: normalized.patch.status ?? loaded.record.workflow.status,
    };
    const checkpointEntry = {
      revision: nextRevision,
      operationId: normalized.operationId,
      acceptedAt,
      previous: { ...loaded.record.workflow },
      resulting: { ...workflow },
    };
    const agent = owns(normalized.patch, "agentId")
      ? updateReference(
          loaded.record.execution.agent,
          normalized.patch.agentId!,
          nextRevision,
          acceptedAt,
        )
      : loaded.record.execution.agent;
    const session = owns(normalized.patch, "sessionId")
      ? updateReference(
          loaded.record.execution.session,
          normalized.patch.sessionId!,
          nextRevision,
          acceptedAt,
        )
      : loaded.record.execution.session;
    const pullRequestPatch = normalized.patch.pullRequest;
    const pullRequest =
      pullRequestPatch === undefined
        ? loaded.record.pullRequest
        : {
            id: owns(pullRequestPatch, "id")
              ? pullRequestPatch.id!
              : loaded.record.pullRequest.id,
            url: owns(pullRequestPatch, "url")
              ? pullRequestPatch.url!
              : loaded.record.pullRequest.url,
          };
    const observationPatch = normalized.patch.observations;
    const observations =
      observationPatch === undefined
        ? loaded.record.observations
        : {
            workItemCommentId: owns(observationPatch, "workItemCommentId")
              ? observationPatch.workItemCommentId!
              : loaded.record.observations.workItemCommentId,
            pullRequest: owns(observationPatch, "pullRequest")
              ? observationPatch.pullRequest!
              : loaded.record.observations.pullRequest,
          };
    const persistedOutcome = {
      kind: "checkpointed" as const,
      checkpoint: checkpointEntry,
    };
    const receipt = makeReceipt(
      normalized.operationId,
      "checkpoint",
      digest,
      nextRevision,
      acceptedAt,
      persistedOutcome,
    );
    const record = sealRecord({
      ...unsealRecord(loaded.record),
      revision: nextRevision,
      updatedAt: acceptedAt,
      workflow,
      execution: {
        branch: owns(normalized.patch, "branch")
          ? normalized.patch.branch!
          : loaded.record.execution.branch,
        worktreePath: owns(normalized.patch, "worktreePath")
          ? normalized.patch.worktreePath!
          : loaded.record.execution.worktreePath,
        agent,
        session,
      },
      pullRequest,
      observations,
      checkpoints: [...loaded.record.checkpoints, checkpointEntry],
      operations: [...loaded.record.operations, receipt],
      previousGenerationDigest: loaded.record.integrity.digest,
    });
    try {
      await publishRecord(context, loaded, record, digest, normalized.notAfter);
    } catch (error) {
      if (!(error instanceof PublicationRace)) throw error;
      const winner = await loadRecord(context, normalized.workItemId);
      const receiptAfterRace = findReceipt(
        winner.record,
        normalized.operationId,
        "checkpoint",
        digest,
      );
      if (receiptAfterRace !== undefined)
        return replayMutation(
          winner.record,
          receiptAfterRace,
        ) as DevSquadAdoMutationSuccess<{
          readonly kind: "checkpointed";
          readonly checkpoint: import("./DevSquadAdoWorkflowLedger.js").DevSquadAdoCheckpointEntry;
        }>;
      throw new DomainFailure({
        kind: "revision-conflict",
        expectedRevision: normalized.expected.revision,
        currentRevision: winner.record.revision,
      });
    }
    return {
      acceptedRevision: nextRevision,
      acceptedAt,
      replayed: false,
      outcome: persistedOutcome,
      record: publicRecord(record),
    };
  });
};

const renewClaim = async (
  context: LedgerContext,
  input: RenewDevSquadAdoWorkflowClaimInput,
): Promise<
  DevSquadAdoLedgerResult<
    DevSquadAdoMutationSuccess<{
      readonly kind: "claim-renewed";
      readonly claim: DevSquadAdoClaimMetadata;
    }>
  >
> => {
  const validated = validateRenewInput(input);
  if (!validated.ok) return validated;
  return safeOperation(async () => {
    const normalized: NormalizedRenewInput = validated.value;
    const nowDate = context.runtime.now();
    const acceptedAt = timestampFromDate(nowDate);
    const digest = requestDigest("renew-claim", normalized);
    for (let attempt = 0; attempt < MAX_PUBLICATION_ATTEMPTS; attempt++) {
      const loaded = await loadRecord(context, normalized.workItemId);
      const replay = findReceipt(
        loaded.record,
        normalized.operationId,
        "renew-claim",
        digest,
      );
      if (replay !== undefined)
        return replayMutation(
          loaded.record,
          replay,
        ) as DevSquadAdoMutationSuccess<{
          readonly kind: "claim-renewed";
          readonly claim: DevSquadAdoClaimMetadata;
        }>;
      const active = requireAuthority(
        loaded.record,
        normalized.authority,
        acceptedAt,
      );
      assertMutationCapacity(loaded.record);
      const nextRevision = loaded.record.revision + 1;
      const renewed = {
        ...active,
        heartbeatAt: acceptedAt,
        expiresAt: addLease(nowDate, normalized.leaseDurationMs),
      };
      const metadata = claimMetadata(normalized.workItemId, renewed);
      const persistedOutcome = {
        kind: "claim-renewed" as const,
        claim: metadata,
      };
      const receipt = makeReceipt(
        normalized.operationId,
        "renew-claim",
        digest,
        nextRevision,
        acceptedAt,
        persistedOutcome,
      );
      const record = sealRecord({
        ...unsealRecord(loaded.record),
        revision: nextRevision,
        updatedAt: acceptedAt,
        claim: {
          fencingCounter: loaded.record.claim.fencingCounter,
          active: renewed,
        },
        operations: [...loaded.record.operations, receipt],
        previousGenerationDigest: loaded.record.integrity.digest,
      });
      try {
        await publishRecord(context, loaded, record, digest);
        return {
          acceptedRevision: nextRevision,
          acceptedAt,
          replayed: false,
          outcome: persistedOutcome,
          record: publicRecord(record),
        };
      } catch (error) {
        if (!(error instanceof PublicationRace)) throw error;
      }
    }
    throw new DomainFailure({
      kind: "contention",
      attempts: MAX_PUBLICATION_ATTEMPTS,
    });
  });
};

const releaseClaim = async (
  context: LedgerContext,
  input: ReleaseDevSquadAdoWorkflowClaimInput,
): Promise<
  DevSquadAdoLedgerResult<
    DevSquadAdoMutationSuccess<{
      readonly kind: "claim-released";
      readonly releasedClaim: {
        readonly ownerId: string;
        readonly fencingValue: number;
        readonly releasedAt: string;
      };
    }>
  >
> => {
  const validated = validateReleaseInput(input);
  if (!validated.ok) return validated;
  return safeOperation(async () => {
    const normalized: NormalizedReleaseInput = validated.value;
    const acceptedAt = timestampFromDate(context.runtime.now());
    const digest = requestDigest("release-claim", normalized);
    for (let attempt = 0; attempt < MAX_PUBLICATION_ATTEMPTS; attempt++) {
      const loaded = await loadRecord(context, normalized.workItemId);
      const replay = findReceipt(
        loaded.record,
        normalized.operationId,
        "release-claim",
        digest,
      );
      if (replay !== undefined)
        return replayMutation(
          loaded.record,
          replay,
        ) as DevSquadAdoMutationSuccess<{
          readonly kind: "claim-released";
          readonly releasedClaim: {
            readonly ownerId: string;
            readonly fencingValue: number;
            readonly releasedAt: string;
          };
        }>;
      const active = requireAuthority(
        loaded.record,
        normalized.authority,
        acceptedAt,
      );
      assertMutationCapacity(loaded.record);
      const nextRevision = loaded.record.revision + 1;
      const releasedClaim = {
        ownerId: active.ownerId,
        fencingValue: active.fencingValue,
        releasedAt: acceptedAt,
      };
      const persistedOutcome = {
        kind: "claim-released" as const,
        releasedClaim,
      };
      const receipt = makeReceipt(
        normalized.operationId,
        "release-claim",
        digest,
        nextRevision,
        acceptedAt,
        persistedOutcome,
      );
      const record = sealRecord({
        ...unsealRecord(loaded.record),
        revision: nextRevision,
        updatedAt: acceptedAt,
        claim: {
          fencingCounter: loaded.record.claim.fencingCounter,
          active: null,
        },
        operations: [...loaded.record.operations, receipt],
        previousGenerationDigest: loaded.record.integrity.digest,
      });
      try {
        await publishRecord(context, loaded, record, digest);
        return {
          acceptedRevision: nextRevision,
          acceptedAt,
          replayed: false,
          outcome: persistedOutcome,
          record: publicRecord(record),
        };
      } catch (error) {
        if (!(error instanceof PublicationRace)) throw error;
      }
    }
    throw new DomainFailure({
      kind: "contention",
      attempts: MAX_PUBLICATION_ATTEMPTS,
    });
  });
};

const runResult = <T>(
  effect: Effect.Effect<DevSquadAdoLedgerResult<T>>,
): Promise<DevSquadAdoLedgerResult<T>> => Effect.runPromise(effect);

const makeLedger = (context: LedgerContext): DevSquadAdoWorkflowLedger => ({
  initializeRecord: (input) =>
    runResult(Effect.promise(() => initializeRecord(context, input))),
  readRecord: (workItemId) =>
    runResult(Effect.promise(() => readRecord(context, workItemId))),
  listResumableRecords: () =>
    runResult(Effect.promise(() => listResumableRecords(context))),
  checkpoint: (input) =>
    runResult(Effect.promise(() => checkpoint(context, input))),
  acquireClaim: (input) =>
    runResult(Effect.promise(() => acquireClaim(context, input))),
  renewClaim: (input) =>
    runResult(Effect.promise(() => renewClaim(context, input))),
  releaseClaim: (input) =>
    runResult(Effect.promise(() => releaseClaim(context, input))),
  inspectRecoveryErrors: () =>
    runResult(Effect.promise(() => inspectRecoveryErrors(context))),
});

const openEffect = (
  input: OpenDevSquadAdoWorkflowLedgerInput,
): Effect.Effect<
  DevSquadAdoLedgerResult<DevSquadAdoWorkflowLedger>,
  never,
  LedgerRuntime
> =>
  Effect.gen(function* () {
    const runtime = yield* LedgerRuntime;
    return yield* Effect.promise(() => openCore(input, runtime));
  });

export const openDevSquadAdoWorkflowLedgerStorage = (
  input: OpenDevSquadAdoWorkflowLedgerInput,
): Promise<DevSquadAdoLedgerResult<DevSquadAdoWorkflowLedger>> =>
  Effect.runPromise(openEffect(input).pipe(Effect.provide(systemRuntimeLayer)));

/** @internal Required runtime entry point for deterministic conformance tests. */
export const openDevSquadAdoWorkflowLedgerWithRuntime = (
  input: OpenDevSquadAdoWorkflowLedgerInput,
  runtime: LedgerRuntimeService,
): Promise<DevSquadAdoLedgerResult<DevSquadAdoWorkflowLedger>> =>
  Effect.runPromise(
    openEffect(input).pipe(
      Effect.provide(Layer.succeed(LedgerRuntime, runtime)),
    ),
  );
