import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDevSquadAdoWorkflowLedger as openSystemDevSquadAdoWorkflowLedger } from "./DevSquadAdoWorkflowLedger.js";
import { openTestDevSquadAdoWorkflowLedger as openDevSquadAdoWorkflowLedger } from "./DevSquadAdoWorkflowLedgerTestSupport.js";
import type { InitializeDevSquadAdoWorkflowRecordInput } from "./DevSquadAdoWorkflowLedger.js";
import {
  RECORD_KIND,
  SCHEMA_VERSION,
  sealRecord,
  serializeRecord,
  workItemStorageKey,
} from "./DevSquadAdoWorkflowLedgerSchema.js";
import type { PersistedDevSquadAdoWorkflowRecordV1 } from "./DevSquadAdoWorkflowLedgerSchema.js";

const roots: string[] = [];

const makeRepository = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "devsquad-ledger-"));
  roots.push(root);
  return root;
};

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("DevSquadAdoWorkflowLedger", () => {
  it("initializes and reopens an exact schema-v1 workflow record", async () => {
    const repositoryRoot = await makeRepository();
    const opened = await openDevSquadAdoWorkflowLedger({ repositoryRoot });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const initialized = await opened.value.initializeRecord({
      workItemId: 137,
      operationId: "initialize-137",
      phase: "custom-security-gate",
      status: "waiting-for-host",
      branch: "users/agent/137",
      worktreePath: "C:\\repo\\.sandcastle\\worktrees\\137",
      agentId: "agent-a",
      sessionId: "session-1",
      pullRequest: { id: "481", url: "https://example.test/pull/481" },
      observations: {
        workItemCommentId: "comment-11",
        pullRequest: { threadId: "thread-12", commentId: "comment-29" },
      },
    });

    expect(initialized.ok).toBe(true);
    if (!initialized.ok) return;
    expect(initialized.value.acceptedRevision).toBe(1);
    expect(initialized.value.record).toMatchObject({
      schemaVersion: 1,
      workItemId: "137",
      revision: 1,
      phase: "custom-security-gate",
      status: "waiting-for-host",
      branch: "users/agent/137",
      worktreePath: "C:\\repo\\.sandcastle\\worktrees\\137",
      agent: { current: "agent-a" },
      session: { current: "session-1" },
      pullRequest: { id: "481", url: "https://example.test/pull/481" },
      observations: {
        workItemCommentId: "comment-11",
        pullRequest: { threadId: "thread-12", commentId: "comment-29" },
      },
      checkpoints: [],
      activeClaim: null,
      fencingCounter: 0,
    });

    const reopened = await openDevSquadAdoWorkflowLedger({ repositoryRoot });
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    const read = await reopened.value.readRecord(137);
    expect(read).toEqual({ ok: true, value: initialized.value.record });
  }, 30_000);

  // CC-008 is covered across this unsafe-ID case and the following field-validation case.
  it("[CC-008] rejects unsafe input before creating a work-item directory", async () => {
    const repositoryRoot = await makeRepository();
    const opened = await openDevSquadAdoWorkflowLedger({ repositoryRoot });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const invalid = await opened.value.initializeRecord({
      workItemId: "../137",
      operationId: "initialize-invalid",
      phase: "implement",
      status: " ",
      pullRequest: { url: "not a url" },
    });

    expect(invalid).toMatchObject({ ok: false, error: { kind: "validation" } });
    expect(
      await readdir(
        join(repositoryRoot, ".sandcastle", "devsquad-ado", "records"),
      ),
    ).toEqual([]);
  }, 30_000);

  it("rejects minimized-data and unknown-field violations without leaking values", async () => {
    const repositoryRoot = await makeRepository();
    const opened = await openDevSquadAdoWorkflowLedger({ repositoryRoot });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const cases: Array<{
      input: InitializeDevSquadAdoWorkflowRecordInput;
      field: string;
      secret?: string;
    }> = [
      {
        input: {
          workItemId: "blank-status",
          operationId: "invalid-blank",
          phase: "implement",
          status: " ",
        },
        field: "status",
      },
      {
        input: {
          workItemId: "credential-url",
          operationId: "invalid-credential-url",
          phase: "implement",
          status: "ready",
          pullRequest: { url: "https://user:secret@example.test/pull/1" },
        },
        field: "pullRequest.url",
        secret: "secret",
      },
      {
        input: {
          workItemId: "relative-worktree",
          operationId: "invalid-worktree",
          phase: "implement",
          status: "ready",
          worktreePath: "relative/worktree",
        },
        field: "worktreePath",
      },
      {
        input: {
          workItemId: "incomplete-cursor",
          operationId: "invalid-cursor",
          phase: "implement",
          status: "ready",
          observations: {
            pullRequest: { threadId: "thread-only" } as never,
          },
        },
        field: "observations.pullRequest.commentId",
      },
      {
        input: {
          workItemId: "unknown-field",
          operationId: "invalid-unknown",
          phase: "implement",
          status: "ready",
          externalBody: "must-not-persist",
        } as InitializeDevSquadAdoWorkflowRecordInput,
        field: "input",
        secret: "must-not-persist",
      },
    ];

    for (const testCase of cases) {
      const result = await opened.value.initializeRecord(testCase.input);
      expect(result).toMatchObject({
        ok: false,
        error: { kind: "validation", field: testCase.field },
      });
      if (testCase.secret) {
        expect(JSON.stringify(result)).not.toContain(testCase.secret);
      }
    }
    expect(
      await readdir(
        join(repositoryRoot, ".sandcastle", "devsquad-ado", "records"),
      ),
    ).toEqual([]);
  }, 30_000);

  it("persists only a claim-token verifier", async () => {
    const repositoryRoot = await makeRepository();
    const opened = await openDevSquadAdoWorkflowLedger({ repositoryRoot });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    await opened.value.initializeRecord({
      workItemId: "token-check",
      operationId: "initialize-token-check",
      phase: "implement",
      status: "ready",
    });
    const claimToken = Buffer.alloc(32, 7).toString("base64url");
    const acquired = await opened.value.acquireClaim({
      workItemId: "token-check",
      operationId: "acquire-token-check",
      ownerId: "loop-a",
      claimToken,
      leaseDurationMs: 60_000,
    });
    expect(acquired.ok).toBe(true);

    const recordDirectories = await readdir(
      join(repositoryRoot, ".sandcastle", "devsquad-ado", "records"),
    );
    const files = await readdir(
      join(
        repositoryRoot,
        ".sandcastle",
        "devsquad-ado",
        "records",
        recordDirectories[0]!,
      ),
    );
    const latest = files
      .filter((file) => file.endsWith(".json"))
      .sort()
      .at(-1)!;
    const persisted = await readFile(
      join(
        repositoryRoot,
        ".sandcastle",
        "devsquad-ado",
        "records",
        recordDirectories[0]!,
        latest,
      ),
      "utf8",
    );
    expect(persisted).not.toContain(claimToken);
    expect(JSON.stringify(acquired)).toContain(claimToken);
  }, 30_000);
});

describe("DevSquadAdoWorkflowLedger checkpoints", () => {
  it("[CC-001] [CC-002] [CC-007] [CC-013] round-trips unknown workflow state, execution history, and opaque cursors", async () => {
    const repositoryRoot = await makeRepository();
    const opened = await openDevSquadAdoWorkflowLedger({ repositoryRoot });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const ledger = opened.value;
    const initialized = await ledger.initializeRecord({
      workItemId: "ADO-137",
      operationId: "initialize-ado-137",
      phase: "implement",
      status: "ready",
      agentId: "agent-a",
      sessionId: "session-1",
    });
    expect(initialized.ok).toBe(true);
    const claimToken = Buffer.alloc(32, 3).toString("base64url");
    const acquired = await ledger.acquireClaim({
      workItemId: "ADO-137",
      operationId: "acquire-ado-137",
      ownerId: "loop-a",
      claimToken,
      leaseDurationMs: 60_000,
    });
    expect(acquired.ok).toBe(true);
    if (!acquired.ok) return;
    const authority = {
      ownerId: acquired.value.outcome.authority.ownerId,
      claimToken,
      fencingValue: acquired.value.outcome.authority.fencingValue,
    };

    const checkpoint = await ledger.checkpoint({
      workItemId: "ADO-137",
      operationId: "checkpoint-custom-gate",
      authority,
      expected: {
        revision: acquired.value.record.revision,
        phase: "implement",
        status: "ready",
      },
      patch: {
        phase: "custom-security-gate",
        status: "waiting",
        branch: "users/agent/137",
        worktreePath: "/repo/.sandcastle/worktrees/137",
        agentId: "agent-b",
        sessionId: "session-2",
        pullRequest: { id: "481", url: "https://example.test/pull/481" },
        observations: {
          workItemCommentId: "481",
          pullRequest: { threadId: "12", commentId: "29" },
        },
      },
    });
    expect(checkpoint.ok).toBe(true);
    if (!checkpoint.ok) return;
    expect(checkpoint.value.outcome.checkpoint).toMatchObject({
      revision: 3,
      previous: { phase: "implement", status: "ready" },
      resulting: { phase: "custom-security-gate", status: "waiting" },
    });
    expect(checkpoint.value.record.agent).toMatchObject({
      current: "agent-b",
      history: [
        { id: "agent-a", revision: 1 },
        { id: "agent-b", revision: 3 },
      ],
    });
    expect(checkpoint.value.record.session).toMatchObject({
      current: "session-2",
      history: [
        { id: "session-1", revision: 1 },
        { id: "session-2", revision: 3 },
      ],
    });
    expect(checkpoint.value.record.observations).toEqual({
      workItemCommentId: "481",
      pullRequest: { threadId: "12", commentId: "29" },
    });

    const reopened = await openDevSquadAdoWorkflowLedger({ repositoryRoot });
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(await reopened.value.readRecord("ADO-137")).toEqual({
      ok: true,
      value: checkpoint.value.record,
    });
  }, 15_000);

  // SC-007 performs 100 verifier-backed replay reads under full-suite load.
  it("[CC-011] [CC-012] replays a checkpoint without another revision and rejects changed reuse", async () => {
    const repositoryRoot = await makeRepository();
    const opened = await openDevSquadAdoWorkflowLedger({ repositoryRoot });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const ledger = opened.value;
    await ledger.initializeRecord({
      workItemId: 9,
      operationId: "init-9",
      phase: "implement",
      status: "ready",
    });
    const token = Buffer.alloc(32, 4).toString("base64url");
    const acquired = await ledger.acquireClaim({
      workItemId: 9,
      operationId: "acquire-9",
      ownerId: "loop-a",
      claimToken: token,
      leaseDurationMs: 60_000,
    });
    expect(acquired.ok).toBe(true);
    if (!acquired.ok) return;
    const authority = {
      ownerId: "loop-a",
      claimToken: token,
      fencingValue: acquired.value.outcome.authority.fencingValue,
    };
    const request = {
      workItemId: 9,
      operationId: "checkpoint-9",
      authority,
      expected: { revision: 2, phase: "implement", status: "ready" },
      patch: { status: "running" },
    } as const;
    const accepted = await ledger.checkpoint(request);
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;

    for (let retry = 0; retry < 100; retry++) {
      const replay = await ledger.checkpoint(request);
      expect(replay).toMatchObject({
        ok: true,
        value: { acceptedRevision: 3, replayed: true },
      });
    }
    expect(await ledger.readRecord(9)).toMatchObject({
      ok: true,
      value: { revision: 3, checkpoints: [{ revision: 3 }] },
    });

    const conflict = await ledger.checkpoint({
      ...request,
      patch: { status: "different" },
    });
    expect(conflict).toEqual({
      ok: false,
      error: { kind: "idempotency-conflict" },
    });
  }, 60_000);

  // The conflict proof includes durable setup and unchanged-state verification.
  it("[CC-006] distinguishes revision and expected-state conflicts without mutation", async () => {
    const repositoryRoot = await makeRepository();
    const opened = await openDevSquadAdoWorkflowLedger({ repositoryRoot });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const ledger = opened.value;
    await ledger.initializeRecord({
      workItemId: 10,
      operationId: "init-10",
      phase: "review",
      status: "ready",
    });
    const token = Buffer.alloc(32, 5).toString("base64url");
    const acquired = await ledger.acquireClaim({
      workItemId: 10,
      operationId: "acquire-10",
      ownerId: "loop-a",
      claimToken: token,
      leaseDurationMs: 60_000,
    });
    expect(acquired.ok).toBe(true);
    if (!acquired.ok) return;
    const authority = {
      ownerId: "loop-a",
      claimToken: token,
      fencingValue: acquired.value.outcome.authority.fencingValue,
    };
    const before = acquired.value.record;
    const staleRevision = await ledger.checkpoint({
      workItemId: 10,
      operationId: "stale-revision",
      authority,
      expected: { revision: 1, phase: "review", status: "ready" },
      patch: { status: "running" },
    });
    expect(staleRevision).toEqual({
      ok: false,
      error: {
        kind: "revision-conflict",
        expectedRevision: 1,
        currentRevision: 2,
      },
    });
    const staleState = await ledger.checkpoint({
      workItemId: 10,
      operationId: "stale-state",
      authority,
      expected: { revision: 2, phase: "implement", status: "ready" },
      patch: { status: "running" },
    });
    expect(staleState).toEqual({
      ok: false,
      error: {
        kind: "state-conflict",
        current: { phase: "review", status: "ready" },
      },
    });
    expect(await ledger.readRecord(10)).toEqual({ ok: true, value: before });
  }, 30_000);
});

describe("DevSquadAdoWorkflowLedger production durability", () => {
  it.runIf(process.platform === "linux")(
    "executes initialize, acquire, checkpoint, reopen, list, and release through the Linux production platform",
    async ({ skip }) => {
      const repositoryRoot = await makeRepository();
      const opened = await openSystemDevSquadAdoWorkflowLedger({
        repositoryRoot,
      });
      if (
        !opened.ok &&
        (opened.error.kind === "unsupported-filesystem" ||
          opened.error.kind === "unsupported-permissions")
      ) {
        skip();
        return;
      }
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;

      const initialized = await opened.value.initializeRecord({
        workItemId: "linux-production-e2e",
        operationId: "initialize-linux-production-e2e",
        phase: "implement",
        status: "ready",
        branch: "users/agent/linux-production-e2e",
        worktreePath: "/repo/.sandcastle/worktrees/linux-production-e2e",
      });
      expect(initialized.ok).toBe(true);
      if (!initialized.ok) return;
      expect(initialized.value.acceptedAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );

      const claimToken = Buffer.alloc(32, 31).toString("base64url");
      const acquired = await opened.value.acquireClaim({
        workItemId: "linux-production-e2e",
        operationId: "acquire-linux-production-e2e",
        ownerId: "linux-production-owner",
        claimToken,
        leaseDurationMs: 60_000,
      });
      expect(acquired.ok).toBe(true);
      if (!acquired.ok) return;

      const authority = acquired.value.outcome.authority;
      const checkpointed = await opened.value.checkpoint({
        workItemId: "linux-production-e2e",
        operationId: "checkpoint-linux-production-e2e",
        authority,
        expected: {
          revision: acquired.value.record.revision,
          phase: acquired.value.record.phase,
          status: acquired.value.record.status,
        },
        patch: { status: "checkpointed" },
      });
      expect(checkpointed.ok).toBe(true);
      if (!checkpointed.ok) return;

      const reopened = await openSystemDevSquadAdoWorkflowLedger({
        repositoryRoot,
      });
      expect(reopened.ok).toBe(true);
      if (!reopened.ok) return;
      expect(await reopened.value.readRecord("linux-production-e2e")).toEqual({
        ok: true,
        value: checkpointed.value.record,
      });
      expect(await reopened.value.listResumableRecords()).toMatchObject({
        ok: true,
        value: {
          records: [
            { workItemId: "linux-production-e2e", status: "checkpointed" },
          ],
          recoveryErrors: [],
        },
      });
      expect(
        await reopened.value.releaseClaim({
          workItemId: "linux-production-e2e",
          operationId: "release-linux-production-e2e",
          authority,
        }),
      ).toMatchObject({
        ok: true,
        value: { record: { activeClaim: null } },
      });
    },
    30_000,
  );
});

describe("DevSquadAdoWorkflowLedger listing acceptance", () => {
  it.skipIf(process.platform === "win32")(
    "opens and lists 1,000 valid records within one second on a supported production filesystem",
    async () => {
      const repositoryRoot = await makeRepository();
      const acceptedAt = "2026-09-08T17:00:00.000Z";
      const setup = await openSystemDevSquadAdoWorkflowLedger({
        repositoryRoot,
      });
      expect(setup.ok).toBe(true);
      if (!setup.ok) return;
      const recordsRoot = join(
        repositoryRoot,
        ".sandcastle",
        "devsquad-ado",
        "records",
      );
      const recordCount = 1_000;
      const fixtureBatchSize = 50;

      // SC-005: fixture construction is deliberately outside the timed
      // reopen/list window and bounded to avoid descriptor fanout.
      for (let offset = 0; offset < recordCount; offset += fixtureBatchSize) {
        await Promise.all(
          Array.from(
            {
              length: Math.min(fixtureBatchSize, recordCount - offset),
            },
            async (_, index) => {
              const workItemId = `listing-${offset + index}`;
              const unsealed: Omit<
                PersistedDevSquadAdoWorkflowRecordV1,
                "integrity"
              > = {
                kind: RECORD_KIND,
                schemaVersion: SCHEMA_VERSION,
                workItemId,
                revision: 1,
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
                observations: {
                  workItemCommentId: null,
                  pullRequest: null,
                },
                checkpoints: [],
                claim: { fencingCounter: 0, active: null },
                operations: [
                  {
                    operationId: `initialize-listing-${offset + index}`,
                    operationKind: "initialize",
                    requestDigest: "a".repeat(64),
                    acceptedRevision: 1,
                    acceptedAt,
                    outcome: { kind: "initialized" },
                  },
                ],
                previousGenerationDigest: null,
              };
              const directory = join(
                recordsRoot,
                workItemStorageKey(workItemId),
              );
              await mkdir(directory, { mode: 0o700 });
              await writeFile(
                join(directory, "0000000000000001.json"),
                serializeRecord(sealRecord(unsealed)),
                { encoding: "utf8", mode: 0o600 },
              );
            },
          ),
        );
      }

      const startedAt = performance.now();
      const reopened = await openSystemDevSquadAdoWorkflowLedger({
        repositoryRoot,
      });
      expect(reopened.ok).toBe(true);
      if (!reopened.ok) return;
      const listed = await reopened.value.listResumableRecords();
      const elapsedMs = performance.now() - startedAt;

      expect(listed.ok).toBe(true);
      if (!listed.ok) return;
      expect(listed.value.records).toHaveLength(recordCount);
      expect(listed.value.recoveryErrors).toEqual([]);
      expect(
        new Set(listed.value.records.map((record) => record.workItemId)).size,
      ).toBe(recordCount);
      expect(elapsedMs).toBeLessThan(1_000);
    },
    180_000,
  );
});
