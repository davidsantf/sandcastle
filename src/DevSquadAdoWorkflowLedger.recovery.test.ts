import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openTestDevSquadAdoWorkflowLedger as openDevSquadAdoWorkflowLedger } from "./DevSquadAdoWorkflowLedgerTestSupport.js";
import {
  interruptPersistenceAt,
  makeLedgerTestRuntime,
} from "./DevSquadAdoWorkflowLedgerTestSupport.js";
import { openDevSquadAdoWorkflowLedgerWithRuntime } from "./DevSquadAdoWorkflowLedgerStorage.js";
import type { LedgerPersistencePoint } from "./DevSquadAdoWorkflowLedgerPlatform.js";
import {
  MAX_GENERATION_BYTES,
  MAX_OPERATIONS,
  RECORD_KIND,
  SCHEMA_VERSION,
  canonicalJson,
  claimTokenVerifier,
  sealRecord,
  serializeRecord,
  sha256Hex,
  workItemStorageKey,
} from "./DevSquadAdoWorkflowLedgerSchema.js";
import type {
  PersistedDevSquadAdoWorkflowRecordV1,
  PersistedOperationReceiptV1,
} from "./DevSquadAdoWorkflowLedgerSchema.js";

const roots: string[] = [];
const diagnosticClaimToken = Buffer.alloc(32, 41).toString("base64url");
const diagnosticTokenVerifier = claimTokenVerifier(diagnosticClaimToken);
const rawJsonMarker = "RAW-JSON-SECRET";
const bodyMarker = "EXTERNAL-BODY-SECRET";
const credentialUrl = "https://user:password@example.test/private";
const osErrorMarker = "ENOENT: permission denied for secret artifact";
const sensitiveEntryName = `${diagnosticClaimToken}-${rawJsonMarker}-${bodyMarker}`;

const expectDiagnosticSecretsRedacted = (value: unknown): void => {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(diagnosticClaimToken);
  expect(serialized).not.toContain(diagnosticTokenVerifier);
  expect(serialized).not.toContain(rawJsonMarker);
  expect(serialized).not.toContain(bodyMarker);
  expect(serialized).not.toContain(credentialUrl);
  expect(serialized).not.toContain(osErrorMarker);
};

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const fixture = async () => {
  const repositoryRoot = await mkdtemp(
    join(tmpdir(), "devsquad-ledger-recovery-"),
  );
  roots.push(repositoryRoot);
  const opened = await openDevSquadAdoWorkflowLedger({ repositoryRoot });
  expect(opened.ok).toBe(true);
  if (!opened.ok) throw new TypeError(opened.error.kind);
  const initialized = await opened.value.initializeRecord({
    workItemId: "corrupt-me",
    operationId: "initialize-corrupt-me",
    phase: "implement",
    status: "ready",
  });
  expect(initialized.ok).toBe(true);
  const recordsRoot = join(
    repositoryRoot,
    ".sandcastle",
    "devsquad-ado",
    "records",
  );
  const recordDirectoryName = (await readdir(recordsRoot))[0]!;
  const recordDirectory = join(recordsRoot, recordDirectoryName);
  const generationName = (await readdir(recordDirectory)).find((name) =>
    name.endsWith(".json"),
  )!;
  const generationPath = join(recordDirectory, generationName);
  return {
    repositoryRoot,
    ledger: opened.value,
    recordDirectory,
    recordDirectoryName,
    generationName,
    generationPath,
  };
};

describe("DevSquadAdoWorkflowLedger recovery", () => {
  it("atomically creates one valid manifest during simultaneous opens", async () => {
    const repositoryRoot = await mkdtemp(
      join(tmpdir(), "devsquad-ledger-open-race-"),
    );
    roots.push(repositoryRoot);
    const opened = await Promise.all([
      openDevSquadAdoWorkflowLedger({ repositoryRoot }),
      openDevSquadAdoWorkflowLedger({ repositoryRoot }),
    ]);
    expect(opened.every((result) => result.ok)).toBe(true);
    expect(
      await readFile(
        join(repositoryRoot, ".sandcastle", "devsquad-ado", "ledger.json"),
        "utf8",
      ),
    ).toMatch(/"schemaVersion":1/);
  }, 30_000);

  it("[CC-010] fails closed on a truncated highest generation and isolates it during listing", async () => {
    const { repositoryRoot, generationPath, ledger } = await fixture();
    expect(
      await ledger.initializeRecord({
        workItemId: "valid-neighbor",
        operationId: "initialize-valid-neighbor",
        phase: "review",
        status: "waiting",
      }),
    ).toMatchObject({ ok: true });
    await writeFile(
      generationPath,
      '{"kind":"devsquad-ado-workflow-record"',
      "utf8",
    );

    const reopened = await openDevSquadAdoWorkflowLedger({ repositoryRoot });
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(await reopened.value.readRecord("corrupt-me")).toMatchObject({
      ok: false,
      error: { kind: "corrupt-artifact" },
    });
    const listed = await reopened.value.listResumableRecords();
    expect(listed).toMatchObject({
      ok: true,
      value: {
        records: [{ workItemId: "valid-neighbor", phase: "review" }],
        recoveryErrors: [{ kind: "corrupt-artifact", severity: "error" }],
      },
    });
    expect(await readFile(generationPath, "utf8")).toBe(
      '{"kind":"devsquad-ado-workflow-record"',
    );
  }, 30_000);

  it("distinguishes an unsupported future record schema", async () => {
    const { repositoryRoot, generationPath } = await fixture();
    const value = JSON.parse(await readFile(generationPath, "utf8")) as Record<
      string,
      unknown
    >;
    value.schemaVersion = 2;
    await writeFile(generationPath, JSON.stringify(value) + "\n", "utf8");

    const reopened = await openDevSquadAdoWorkflowLedger({ repositoryRoot });
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(await reopened.value.readRecord("corrupt-me")).toMatchObject({
      ok: false,
      error: { kind: "unsupported-schema-version", schemaVersion: 2 },
    });
    expect(await reopened.value.inspectRecoveryErrors()).toMatchObject({
      ok: true,
      value: [{ kind: "unsupported-schema-version", severity: "error" }],
    });
  }, 30_000);

  it("re-lists once when a concurrent publisher candidate was absent from the first snapshot", async () => {
    const { repositoryRoot, recordDirectory, generationPath } = await fixture();
    const candidateName = `.${"a".repeat(64)}.${"b".repeat(32)}.tmp`;
    await link(generationPath, join(recordDirectory, candidateName));

    const baseRuntime = makeLedgerTestRuntime(
      () => new Date("2026-09-08T19:00:00.000Z"),
      { hit: () => undefined },
    );
    let recordDirectoryListings = 0;
    const recordArtifact = `records/${workItemStorageKey("corrupt-me")}`;
    const runtime = {
      ...baseRuntime,
      platform: {
        ...baseRuntime.platform,
        async listDirectory(
          path: string,
          artifact: string,
          maximumEntries: number,
        ) {
          const entries = await baseRuntime.platform.listDirectory(
            path,
            artifact,
            maximumEntries,
          );
          if (artifact !== recordArtifact) return entries;
          recordDirectoryListings += 1;
          return recordDirectoryListings === 1
            ? entries.filter((entry) => entry.name !== candidateName)
            : entries;
        },
      },
    };

    const reopened = await openDevSquadAdoWorkflowLedgerWithRuntime(
      { repositoryRoot },
      runtime,
    );
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(await reopened.value.readRecord("corrupt-me")).toMatchObject({
      ok: true,
      value: { revision: 1 },
    });
    expect(recordDirectoryListings).toBe(2);
  }, 30_000);

  it("reports deterministic leftover candidates without promoting them", async () => {
    const { repositoryRoot, ledger, recordDirectory, recordDirectoryName } =
      await fixture();
    const candidateName = `.${diagnosticTokenVerifier}.${"b".repeat(32)}.tmp`;
    await writeFile(
      join(recordDirectory, candidateName),
      "not a generation",
      "utf8",
    );

    const errors = await ledger.inspectRecoveryErrors();
    expect(errors).toEqual({
      ok: true,
      value: [
        {
          kind: "leftover-candidate",
          severity: "warning",
          artifact: `records/${recordDirectoryName}`,
        },
      ],
    });
    expect(await ledger.readRecord("corrupt-me")).toMatchObject({
      ok: true,
      value: { revision: 1 },
    });
    expectDiagnosticSecretsRedacted(errors);
  }, 30_000);

  it("reports a retained manifest candidate without promoting it", async () => {
    const { repositoryRoot, ledger } = await fixture();
    const candidateName = `.${diagnosticTokenVerifier}.${"d".repeat(32)}.tmp`;
    await writeFile(
      join(repositoryRoot, ".sandcastle", "devsquad-ado", candidateName),
      "not a manifest",
      "utf8",
    );
    expect(await ledger.inspectRecoveryErrors()).toEqual({
      ok: true,
      value: [
        {
          kind: "leftover-candidate",
          severity: "warning",
          artifact: ".",
        },
      ],
    });
    expectDiagnosticSecretsRedacted(await ledger.inspectRecoveryErrors());
  }, 30_000);

  it("bounds record-directory scans deterministically", async () => {
    const { ledger, recordDirectory } = await fixture();
    await Promise.all(
      Array.from({ length: 64 }, (_, index) =>
        writeFile(
          join(
            recordDirectory,
            `.${"a".repeat(64)}.${index.toString(16).padStart(32, "0")}.tmp`,
          ),
          "candidate",
          "utf8",
        ),
      ),
    );
    expect(await ledger.readRecord("corrupt-me")).toEqual({
      ok: false,
      error: { kind: "scan-limit", limit: 64 },
    });
    expect(await ledger.inspectRecoveryErrors()).toMatchObject({
      ok: true,
      value: [{ kind: "scan-limit", severity: "error" }],
    });
  }, 30_000);

  it("redacts an arbitrary top-level entry name from public errors", async () => {
    const { repositoryRoot } = await fixture();
    const ledgerRoot = join(repositoryRoot, ".sandcastle", "devsquad-ado");
    await writeFile(
      join(ledgerRoot, sensitiveEntryName),
      JSON.stringify({
        raw: rawJsonMarker,
        body: bodyMarker,
        url: credentialUrl,
        osError: osErrorMarker,
      }),
      "utf8",
    );

    const reopened = await openDevSquadAdoWorkflowLedger({ repositoryRoot });
    expect(reopened).toEqual({
      ok: false,
      error: { kind: "corrupt-artifact", artifact: "." },
    });
    expectDiagnosticSecretsRedacted(reopened);
  }, 30_000);

  it("redacts an arbitrary record-directory name from recovery diagnostics", async () => {
    const { repositoryRoot, ledger } = await fixture();
    const recordsRoot = join(
      repositoryRoot,
      ".sandcastle",
      "devsquad-ado",
      "records",
    );
    await mkdir(join(recordsRoot, sensitiveEntryName), { mode: 0o700 });

    const listed = await ledger.listResumableRecords();
    expect(listed).toMatchObject({
      ok: true,
      value: {
        records: [{ workItemId: "corrupt-me" }],
        recoveryErrors: [
          {
            kind: "corrupt-artifact",
            severity: "error",
            artifact: "records",
          },
        ],
      },
    });
    expectDiagnosticSecretsRedacted(listed);
  }, 30_000);

  it("redacts a recognized-shaped record directory from recovery diagnostics", async () => {
    const { repositoryRoot, ledger } = await fixture();
    const recordsRoot = join(
      repositoryRoot,
      ".sandcastle",
      "devsquad-ado",
      "records",
    );
    await mkdir(join(recordsRoot, `wi-${diagnosticTokenVerifier}`), {
      mode: 0o700,
    });

    const diagnostics = await ledger.inspectRecoveryErrors();
    expect(diagnostics).toEqual({
      ok: true,
      value: [
        {
          kind: "corrupt-artifact",
          severity: "error",
          artifact: "records",
        },
      ],
    });
    expectDiagnosticSecretsRedacted(diagnostics);
  }, 30_000);

  it("redacts raw operating-system text from recovery failures", async () => {
    const repositoryRoot = await mkdtemp(
      join(tmpdir(), "devsquad-ledger-os-error-"),
    );
    roots.push(repositoryRoot);
    let injectFailure = false;
    const baseRuntime = makeLedgerTestRuntime(() => new Date(), {
      hit: () => undefined,
    });
    const runtime = {
      ...baseRuntime,
      platform: {
        ...baseRuntime.platform,
        async listDirectory(
          ...args: Parameters<typeof baseRuntime.platform.listDirectory>
        ) {
          if (injectFailure) throw new Error(osErrorMarker);
          return baseRuntime.platform.listDirectory(...args);
        },
      },
    };
    const opened = await openDevSquadAdoWorkflowLedgerWithRuntime(
      { repositoryRoot },
      runtime,
    );
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    injectFailure = true;
    const diagnostics = await opened.value.inspectRecoveryErrors();
    expect(diagnostics).toEqual({
      ok: false,
      error: { kind: "storage", outcome: "unchanged" },
    });
    expectDiagnosticSecretsRedacted(diagnostics);
  }, 30_000);

  it("redacts an arbitrary in-record filename from errors and diagnostics", async () => {
    const { ledger, recordDirectory, recordDirectoryName } = await fixture();
    await writeFile(
      join(recordDirectory, sensitiveEntryName),
      JSON.stringify({
        raw: rawJsonMarker,
        body: bodyMarker,
        url: credentialUrl,
        osError: osErrorMarker,
      }),
      "utf8",
    );
    const parentArtifact = `records/${recordDirectoryName}`;

    const read = await ledger.readRecord("corrupt-me");
    expect(read).toEqual({
      ok: false,
      error: { kind: "corrupt-artifact", artifact: parentArtifact },
    });
    const diagnostics = await ledger.inspectRecoveryErrors();
    expect(diagnostics).toEqual({
      ok: true,
      value: [
        {
          kind: "corrupt-artifact",
          severity: "error",
          artifact: "records",
        },
      ],
    });
    expectDiagnosticSecretsRedacted({ read, diagnostics });
  }, 30_000);

  it("fails closed when the manifest is malformed", async () => {
    const { repositoryRoot } = await fixture();
    const manifestPath = join(
      repositoryRoot,
      ".sandcastle",
      "devsquad-ado",
      "ledger.json",
    );
    await writeFile(manifestPath, '{"schemaVersion":2}\n', "utf8");
    expect(
      await openDevSquadAdoWorkflowLedger({ repositoryRoot }),
    ).toMatchObject({
      ok: false,
      error: { kind: "corrupt-artifact", artifact: "ledger.json" },
    });
  }, 30_000);
});

const PRE_PUBLICATION_POINTS = [
  "candidate-created",
  "candidate-written",
  "candidate-synced",
  "candidate-closed",
  "candidate-validated",
] as const satisfies readonly LedgerPersistencePoint[];

const POST_PUBLICATION_POINTS = [
  "publication-linked",
  "published-file-synced",
  "publication-directory-synced",
  "candidate-unlinked",
  "cleanup-directory-synced",
  "committed-verified",
  "before-acknowledge",
] as const satisfies readonly LedgerPersistencePoint[];

const writeResealedRecord = async (
  path: string,
  value: Record<string, unknown>,
): Promise<void> => {
  delete value.integrity;
  value.integrity = {
    algorithm: "sha256",
    digest: sha256Hex(canonicalJson(value)),
  };
  await writeFile(path, `${canonicalJson(value)}\n`, "utf8");
};

describe("DevSquadAdoWorkflowLedger persistence interruption matrix", () => {
  it.each([...PRE_PUBLICATION_POINTS, ...POST_PUBLICATION_POINTS])(
    "[CC-009] recovers and exactly retries a mutation interrupted at %s",
    async (point) => {
      const repositoryRoot = await mkdtemp(
        join(tmpdir(), `devsquad-ledger-fault-${point}-`),
      );
      roots.push(repositoryRoot);
      const now = () => new Date("2026-09-08T19:00:00.000Z");
      let selected: LedgerPersistencePoint | undefined;
      const faults = {
        hit(hitPoint: LedgerPersistencePoint) {
          if (hitPoint === selected) {
            return interruptPersistenceAt(hitPoint).hit(hitPoint);
          }
        },
      };
      const runtime = makeLedgerTestRuntime(now, faults);
      const opened = await openDevSquadAdoWorkflowLedgerWithRuntime(
        { repositoryRoot },
        runtime,
      );
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;
      const ledger = opened.value;
      expect(
        await ledger.initializeRecord({
          workItemId: "fault-matrix",
          operationId: "initialize-fault-matrix",
          phase: "implement",
          status: "ready",
        }),
      ).toMatchObject({ ok: true });
      const claimToken = Buffer.alloc(32, 23).toString("base64url");
      const acquired = await ledger.acquireClaim({
        workItemId: "fault-matrix",
        operationId: "acquire-fault-matrix",
        ownerId: "fault-owner",
        claimToken,
        leaseDurationMs: 60_000,
      });
      expect(acquired.ok).toBe(true);
      if (!acquired.ok) return;
      const oldRecord = acquired.value.record;
      const request = {
        workItemId: "fault-matrix",
        operationId: "checkpoint-fault-matrix",
        authority: {
          ownerId: "fault-owner",
          claimToken,
          fencingValue: acquired.value.outcome.authority.fencingValue,
        },
        expected: {
          revision: oldRecord.revision,
          phase: oldRecord.phase,
          status: oldRecord.status,
        },
        patch: {
          status: "complete-new-generation-secret-payload",
          observations: { workItemCommentId: "cursor-after-interruption" },
        },
      } as const;

      selected = point;
      const interrupted = await ledger.checkpoint(request);
      expect(interrupted).toEqual({
        ok: false,
        error: {
          kind: "storage",
          outcome: PRE_PUBLICATION_POINTS.includes(
            point as (typeof PRE_PUBLICATION_POINTS)[number],
          )
            ? "unchanged"
            : "indeterminate",
        },
      });
      const redacted = JSON.stringify(interrupted);
      expect(redacted).not.toContain(claimToken);
      expect(redacted).not.toContain(claimTokenVerifier(claimToken));
      expect(redacted).not.toContain("complete-new-generation-secret-payload");

      selected = undefined;
      const reopened = await openDevSquadAdoWorkflowLedgerWithRuntime(
        { repositoryRoot },
        runtime,
      );
      expect(reopened.ok).toBe(true);
      if (!reopened.ok) return;
      const recovered = await reopened.value.readRecord("fault-matrix");
      expect(recovered.ok).toBe(true);
      if (!recovered.ok) return;
      if (
        PRE_PUBLICATION_POINTS.includes(
          point as (typeof PRE_PUBLICATION_POINTS)[number],
        )
      ) {
        expect(recovered.value).toEqual(oldRecord);
      } else {
        expect(recovered.value).toMatchObject({
          revision: oldRecord.revision + 1,
          phase: "implement",
          status: "complete-new-generation-secret-payload",
          observations: {
            workItemCommentId: "cursor-after-interruption",
          },
          checkpoints: [
            {
              revision: oldRecord.revision + 1,
              operationId: "checkpoint-fault-matrix",
              previous: { phase: "implement", status: "ready" },
              resulting: {
                phase: "implement",
                status: "complete-new-generation-secret-payload",
              },
            },
          ],
        });
      }

      const diagnostics = await reopened.value.inspectRecoveryErrors();
      expect(JSON.stringify(diagnostics)).not.toContain(claimToken);
      expect(JSON.stringify(diagnostics)).not.toContain(
        claimTokenVerifier(claimToken),
      );
      expect(JSON.stringify(diagnostics)).not.toContain(
        "complete-new-generation-secret-payload",
      );

      const retry = await reopened.value.checkpoint(request);
      expect(retry).toMatchObject({
        ok: true,
        value: {
          acceptedRevision: oldRecord.revision + 1,
          replayed: POST_PUBLICATION_POINTS.includes(
            point as (typeof POST_PUBLICATION_POINTS)[number],
          ),
          record: {
            revision: oldRecord.revision + 1,
            status: "complete-new-generation-secret-payload",
            observations: {
              workItemCommentId: "cursor-after-interruption",
            },
          },
        },
      });

      const finalReopen = await openDevSquadAdoWorkflowLedgerWithRuntime(
        { repositoryRoot },
        runtime,
      );
      expect(finalReopen.ok).toBe(true);
      if (!finalReopen.ok || !retry.ok) return;
      expect(await finalReopen.value.readRecord("fault-matrix")).toEqual({
        ok: true,
        value: retry.value.record,
      });
    },
    20_000,
  );
});

describe("DevSquadAdoWorkflowLedger strict persisted-schema recovery", () => {
  it("rejects a resealed work-item identity mismatch", async () => {
    const { ledger, generationPath } = await fixture();
    const value = JSON.parse(await readFile(generationPath, "utf8")) as Record<
      string,
      unknown
    >;
    value.workItemId = "different-identity";
    await writeResealedRecord(generationPath, value);
    expect(await ledger.readRecord("corrupt-me")).toMatchObject({
      ok: false,
      error: { kind: "corrupt-artifact" },
    });
  }, 30_000);

  it("rejects an integrity digest mismatch", async () => {
    const { ledger, generationPath } = await fixture();
    const original = await readFile(generationPath, "utf8");
    expect(original).toContain('"status":"ready"');
    await writeFile(
      generationPath,
      original.replace('"status":"ready"', '"status":"rogue"'),
      "utf8",
    );
    expect(await ledger.readRecord("corrupt-me")).toMatchObject({
      ok: false,
      error: { kind: "corrupt-artifact" },
    });
  }, 30_000);

  it("rejects a correctly resealed but impossible operation/revision schema", async () => {
    const { ledger, generationPath } = await fixture();
    const value = JSON.parse(await readFile(generationPath, "utf8")) as Record<
      string,
      unknown
    >;
    value.operations = [];
    await writeResealedRecord(generationPath, value);
    expect(await ledger.readRecord("corrupt-me")).toMatchObject({
      ok: false,
      error: { kind: "corrupt-artifact" },
    });
  }, 30_000);

  // Durable claim setup plus corruption verification can exceed the default
  // timeout when the full filesystem-heavy suite runs in parallel.
  it("never falls back to a valid lower revision when the highest is corrupt", async () => {
    const { ledger, recordDirectory, generationPath } = await fixture();
    const revisionOne = await readFile(generationPath, "utf8");
    const claimToken = Buffer.alloc(32, 29).toString("base64url");
    expect(
      await ledger.acquireClaim({
        workItemId: "corrupt-me",
        operationId: "claim-before-corruption",
        ownerId: "corruption-owner",
        claimToken,
        leaseDurationMs: 60_000,
      }),
    ).toMatchObject({ ok: true });
    await writeFile(
      join(recordDirectory, "0000000000000001.json"),
      revisionOne,
      "utf8",
    );
    const highest = (await readdir(recordDirectory))
      .filter((name) => name.endsWith(".json"))
      .sort()
      .at(-1)!;
    await writeFile(join(recordDirectory, highest), "{truncated", "utf8");

    expect(await ledger.readRecord("corrupt-me")).toMatchObject({
      ok: false,
      error: {
        kind: "corrupt-artifact",
        artifact: `records/${workItemStorageKey("corrupt-me")}`,
      },
    });
    expect(await readFile(join(recordDirectory, highest), "utf8")).toBe(
      "{truncated",
    );
    expect(await readFile(generationPath, "utf8")).toBe(revisionOne);
  }, 30_000);
});

describe("DevSquadAdoWorkflowLedger representative capacity boundaries", () => {
  it("rejects an oversized committed generation before parsing or allocation", async () => {
    const { ledger, generationPath } = await fixture();
    await writeFile(
      generationPath,
      Buffer.alloc(MAX_GENERATION_BYTES + 1, 0x20),
    );
    expect(await ledger.readRecord("corrupt-me")).toMatchObject({
      ok: false,
      error: { kind: "path-boundary" },
    });
    expect((await stat(generationPath)).size).toBe(MAX_GENERATION_BYTES + 1);
  }, 30_000);

  it("fails closed at the schema-v1 operation receipt capacity", async () => {
    const repositoryRoot = await mkdtemp(
      join(tmpdir(), "devsquad-ledger-operation-capacity-"),
    );
    roots.push(repositoryRoot);
    const opened = await openDevSquadAdoWorkflowLedger({ repositoryRoot });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const acceptedAt = "2026-09-08T21:00:00.000Z";
    const workItemId = "operation-capacity";
    const releaseOutcome = {
      kind: "claim-released" as const,
      releasedClaim: {
        ownerId: "former-owner",
        fencingValue: 1,
        releasedAt: acceptedAt,
      },
    };
    const operations: PersistedOperationReceiptV1[] = [
      {
        operationId: "initialize-capacity",
        operationKind: "initialize",
        requestDigest: "a".repeat(64),
        acceptedRevision: 1,
        acceptedAt,
        outcome: { kind: "initialized" },
      },
      ...Array.from({ length: MAX_OPERATIONS - 1 }, (_, index) => ({
        operationId: `historical-release-${index + 2}`,
        operationKind: "release-claim" as const,
        requestDigest: "b".repeat(64),
        acceptedRevision: index + 2,
        acceptedAt,
        outcome: releaseOutcome,
      })),
    ];
    const unsealed: Omit<PersistedDevSquadAdoWorkflowRecordV1, "integrity"> = {
      kind: RECORD_KIND,
      schemaVersion: SCHEMA_VERSION,
      workItemId,
      revision: MAX_OPERATIONS,
      createdAt: acceptedAt,
      updatedAt: acceptedAt,
      workflow: { phase: "implement", status: "ready" },
      execution: {
        branch: null,
        worktreePath: null,
        agent: { current: null, history: [] },
        session: { current: null, history: [] },
      },
      pullRequest: { id: null, url: null },
      observations: { workItemCommentId: null, pullRequest: null },
      checkpoints: [],
      claim: { fencingCounter: 1, active: null },
      operations,
      previousGenerationDigest: "c".repeat(64),
    };
    const bytes = serializeRecord(sealRecord(unsealed));
    expect(Buffer.byteLength(bytes, "utf8")).toBeLessThan(MAX_GENERATION_BYTES);
    const directory = join(
      repositoryRoot,
      ".sandcastle",
      "devsquad-ado",
      "records",
      workItemStorageKey(workItemId),
    );
    await mkdir(directory, { mode: 0o700 });
    await writeFile(
      join(directory, `${String(MAX_OPERATIONS).padStart(16, "0")}.json`),
      bytes,
      { encoding: "utf8", mode: 0o600 },
    );

    const token = Buffer.alloc(32, 31).toString("base64url");
    const result = await opened.value.acquireClaim({
      workItemId,
      operationId: "must-not-exceed-operation-capacity",
      ownerId: "new-owner",
      claimToken: token,
      leaseDurationMs: 60_000,
    });
    expect(result).toEqual({
      ok: false,
      error: {
        kind: "capacity-exceeded",
        resource: "operations",
        limit: MAX_OPERATIONS,
      },
    });
    expect(JSON.stringify(result)).not.toContain(token);
  }, 20_000);
});
