import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  DevSquadAdoClaimAuthority,
  DevSquadAdoClaimAuthorityInput,
  DevSquadAdoLedgerResult,
  DevSquadAdoWorkflowLedger,
} from "./DevSquadAdoWorkflowLedger.js";
import {
  openTestDevSquadAdoWorkflowLedger,
  openTestDevSquadAdoWorkflowLedgerWithClock,
} from "./DevSquadAdoWorkflowLedgerTestSupport.js";
import {
  RECORD_KIND,
  SCHEMA_VERSION,
  sealRecord,
  serializeRecord,
  workItemStorageKey,
} from "./DevSquadAdoWorkflowLedgerSchema.js";
import type { PersistedDevSquadAdoWorkflowRecordV1 } from "./DevSquadAdoWorkflowLedgerSchema.js";

const roots: string[] = [];
const tokenA = Buffer.alloc(32, 1).toString("base64url");
const tokenB = Buffer.alloc(32, 2).toString("base64url");

const valueOf = <T>(result: DevSquadAdoLedgerResult<T>): T => {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new TypeError(result.error.kind);
  return result.value;
};

const setup = async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "devsquad-ledger-race-"));
  roots.push(repositoryRoot);
  let current = new Date("2026-09-08T17:00:00.000Z");
  const opened = await openTestDevSquadAdoWorkflowLedgerWithClock(
    { repositoryRoot },
    () => new Date(current),
  );
  const ledger = valueOf(opened);
  valueOf(
    await ledger.initializeRecord({
      workItemId: 137,
      operationId: "initialize",
      phase: "implement",
      status: "ready",
    }),
  );
  return {
    ledger,
    advance(milliseconds: number) {
      current = new Date(current.getTime() + milliseconds);
    },
  };
};

const acquire = (
  ledger: DevSquadAdoWorkflowLedger,
  ownerId: string,
  claimToken: string,
  operationId = `acquire-${ownerId}`,
) =>
  ledger.acquireClaim({
    workItemId: 137,
    operationId,
    ownerId,
    claimToken,
    leaseDurationMs: 60_000,
  });

const authorityInput = (
  authority: DevSquadAdoClaimAuthority,
): DevSquadAdoClaimAuthorityInput => ({
  ownerId: authority.ownerId,
  claimToken: authority.claimToken,
  fencingValue: authority.fencingValue,
});

const authorityOf = (
  result: Awaited<ReturnType<DevSquadAdoWorkflowLedger["acquireClaim"]>>,
): DevSquadAdoClaimAuthority => {
  const value = valueOf(result);
  return value.outcome.authority;
};

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("DevSquadAdoWorkflowLedger claims", () => {
  it("publishes exactly one authority for simultaneous acquisitions", async () => {
    const { ledger } = await setup();
    const [left, right] = await Promise.all([
      acquire(ledger, "loop-a", tokenA),
      acquire(ledger, "loop-b", tokenB),
    ]);

    expect([left, right].filter((result) => result.ok)).toHaveLength(1);
    const rejected = [left, right].find((result) => !result.ok)!;
    expect(rejected).toMatchObject({
      ok: false,
      error: { kind: "claim-conflict" },
    });
    if (!rejected.ok)
      expect(JSON.stringify(rejected.error)).not.toContain(tokenA);
    if (!rejected.ok)
      expect(JSON.stringify(rejected.error)).not.toContain(tokenB);
    const record = valueOf(await ledger.readRecord(137));
    expect(record.activeClaim?.ownerId).toBe(left.ok ? "loop-a" : "loop-b");
    expect(record.fencingCounter).toBe(1);
  }, 15_000);

  // This case performs multiple durable generations and verification reads.
  it("[CC-004] [CC-005] takes over an expired claim and rejects the stale fence without mutation", async () => {
    const { ledger, advance } = await setup();
    const first = authorityOf(await acquire(ledger, "loop-a", tokenA));
    advance(60_000);
    const second = authorityOf(await acquire(ledger, "loop-b", tokenB));
    expect(second.fencingValue).toBe(first.fencingValue + 1);

    const before = valueOf(await ledger.readRecord(137));
    const stale = await ledger.checkpoint({
      workItemId: 137,
      operationId: "stale-checkpoint",
      authority: authorityInput(first),
      expected: {
        revision: before.revision,
        phase: before.phase,
        status: before.status,
      },
      patch: { status: "must-not-write" },
    });
    expect(stale).toEqual({
      ok: false,
      error: {
        kind: "stale-fencing",
        currentFencingValue: second.fencingValue,
      },
    });
    expect(valueOf(await ledger.readRecord(137))).toEqual(before);

    const staleRenewal = await ledger.renewClaim({
      workItemId: 137,
      operationId: "stale-renewal-after-takeover",
      authority: authorityInput(first),
      leaseDurationMs: 60_000,
    });
    expect(staleRenewal).toEqual({
      ok: false,
      error: {
        kind: "stale-fencing",
        currentFencingValue: second.fencingValue,
      },
    });
    expect(valueOf(await ledger.readRecord(137))).toEqual(before);

    const staleRelease = await ledger.releaseClaim({
      workItemId: 137,
      operationId: "stale-release-after-takeover",
      authority: authorityInput(first),
    });
    expect(staleRelease).toEqual({
      ok: false,
      error: {
        kind: "stale-fencing",
        currentFencingValue: second.fencingValue,
      },
    });
    expect(valueOf(await ledger.readRecord(137))).toEqual(before);
  }, 30_000);

  it("renews from controlled accepted time without changing the fence", async () => {
    const { ledger, advance } = await setup();
    const authority = authorityOf(await acquire(ledger, "loop-a", tokenA));
    advance(10_000);
    const renewal = valueOf(
      await ledger.renewClaim({
        workItemId: 137,
        operationId: "renew-a",
        authority: authorityInput(authority),
        leaseDurationMs: 120_000,
      }),
    );
    expect(renewal.outcome.claim).toEqual({
      workItemId: "137",
      ownerId: authority.ownerId,
      fencingValue: authority.fencingValue,
      acquiredAt: "2026-09-08T17:00:00.000Z",
      heartbeatAt: "2026-09-08T17:00:10.000Z",
      expiresAt: "2026-09-08T17:02:10.000Z",
    });
    expect(renewal.outcome.claim).not.toHaveProperty("claimToken");
    expect(renewal.record.fencingCounter).toBe(authority.fencingValue);
  }, 30_000);

  it("rejects leases beyond the fixed 24-hour capacity without mutation", async () => {
    const { ledger } = await setup();
    const before = valueOf(await ledger.readRecord(137));
    expect(
      await ledger.acquireClaim({
        workItemId: 137,
        operationId: "oversized-lease",
        ownerId: "loop-a",
        claimToken: tokenA,
        leaseDurationMs: 86_400_001,
      }),
    ).toEqual({
      ok: false,
      error: {
        kind: "validation",
        field: "leaseDurationMs",
        reason: "must be a positive safe integer no greater than 86400000",
      },
    });
    expect(valueOf(await ledger.readRecord(137))).toEqual(before);
  }, 30_000);

  it("replays acquisition only for the original token and request", async () => {
    const { ledger } = await setup();
    expect(
      await ledger.acquireClaim({
        workItemId: 137,
        operationId: "invalid-token",
        ownerId: "loop-a",
        claimToken: Buffer.alloc(31, 1).toString("base64url"),
        leaseDurationMs: 60_000,
      }),
    ).toMatchObject({
      ok: false,
      error: { kind: "validation", field: "claimToken" },
    });
    expect(
      await ledger.acquireClaim({
        workItemId: 137,
        operationId: "initialize",
        ownerId: "loop-a",
        claimToken: tokenA,
        leaseDurationMs: 60_000,
      }),
    ).toEqual({ ok: false, error: { kind: "idempotency-conflict" } });
    const request = {
      workItemId: 137,
      operationId: "acquire-replay",
      ownerId: "loop-a",
      claimToken: tokenA,
      leaseDurationMs: 60_000,
    } as const;
    const accepted = valueOf(await ledger.acquireClaim(request));
    const replayed = valueOf(await ledger.acquireClaim(request));
    expect(replayed.replayed).toBe(true);
    expect(replayed.acceptedRevision).toBe(accepted.acceptedRevision);
    expect(replayed.outcome.authority.claimToken).toBe(tokenA);

    expect(
      await ledger.acquireClaim({ ...request, claimToken: tokenB }),
    ).toEqual({ ok: false, error: { kind: "idempotency-conflict" } });
    expect(valueOf(await ledger.readRecord(137)).revision).toBe(2);
  }, 30_000);

  it("[CC-014] rejects renewal with the wrong capability without changing expiry", async () => {
    const { ledger } = await setup();
    const authority = authorityOf(await acquire(ledger, "loop-a", tokenA));
    const before = valueOf(await ledger.readRecord(137));
    const renewal = await ledger.renewClaim({
      workItemId: 137,
      operationId: "unauthorized-renewal",
      authority: { ...authorityInput(authority), claimToken: tokenB },
      leaseDurationMs: 120_000,
    });
    expect(renewal).toEqual({
      ok: false,
      error: { kind: "claim-authorization" },
    });
    expect(valueOf(await ledger.readRecord(137))).toEqual(before);
  }, 30_000);

  // Release/reacquire/replay performs four durable publication cycles.
  it("[CC-015] replays an old release without clearing a later owner's claim", async () => {
    const { ledger } = await setup();
    const first = authorityOf(await acquire(ledger, "loop-a", tokenA));
    const releaseInput = {
      workItemId: 137,
      operationId: "release-a",
      authority: authorityInput(first),
    } as const;
    const released = valueOf(await ledger.releaseClaim(releaseInput));
    const second = authorityOf(await acquire(ledger, "loop-b", tokenB));

    const replayed = valueOf(await ledger.releaseClaim(releaseInput));
    expect(replayed.replayed).toBe(true);
    expect(replayed.acceptedRevision).toBe(released.acceptedRevision);
    expect(replayed.record.activeClaim).toMatchObject({
      ownerId: "loop-b",
      fencingValue: second.fencingValue,
    });
    expect(valueOf(await ledger.readRecord(137)).activeClaim?.ownerId).toBe(
      "loop-b",
    );
  }, 30_000);
});

interface ChildContentionResult {
  readonly ok: boolean;
  readonly ownerId?: string;
  readonly fencingValue?: number;
  readonly expiresAt?: string;
  readonly error?: {
    readonly kind: string;
    readonly claim?: { readonly ownerId: string; readonly expiresAt: string };
  };
}

const startClaimChild = (
  repositoryRoot: string,
  ownerId: string,
  claimToken: string,
  operationId: string,
) => {
  const tsxCli = fileURLToPath(
    new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url),
  );
  const childEntry = fileURLToPath(
    new URL("DevSquadAdoWorkflowLedger.child-process.ts", import.meta.url),
  );
  const child = spawn(
    process.execPath,
    [tsxCli, childEntry, repositoryRoot, ownerId, claimToken, operationId],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stdout = "";
  let stderr = "";
  let readyResolved = false;
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
    if (!readyResolved && stdout.includes("READY\n")) {
      readyResolved = true;
      resolveReady();
    }
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.once("error", (error) => rejectReady(error));
  const result = new Promise<ChildContentionResult>((resolve, reject) => {
    child.once("close", (code) => {
      if (code !== 0) {
        reject(new Error(`claim child exited ${String(code)}: ${stderr}`));
        return;
      }
      const line = stdout
        .split(/\r?\n/)
        .find((entry) => entry.startsWith("RESULT "));
      if (!line) {
        reject(new Error("claim child returned no result"));
        return;
      }
      resolve(
        JSON.parse(line.slice("RESULT ".length)) as ChildContentionResult,
      );
    });
  });
  return {
    ready,
    go() {
      child.stdin.write("GO\n");
      child.stdin.end();
    },
    result,
  };
};

describe("DevSquadAdoWorkflowLedger host-level contention", () => {
  it("[CC-003] produces one authority and exact token-free conflict metadata in 1,000 separate-handle races", async () => {
    const repositoryRoot = await mkdtemp(
      join(tmpdir(), "devsquad-ledger-1000-races-"),
    );
    roots.push(repositoryRoot);
    const acceptedAt = "2026-09-08T17:00:00.000Z";
    const first = valueOf(
      await openTestDevSquadAdoWorkflowLedgerWithClock(
        { repositoryRoot },
        () => new Date(acceptedAt),
      ),
    );
    const trialCount = 1_000;
    const batchSize = 100;
    const recordsRoot = join(
      repositoryRoot,
      ".sandcastle",
      "devsquad-ado",
      "records",
    );

    // Prebuild strict revision-one fixtures so the 1,000 trials measure
    // compare-and-publish contention rather than O(n^2) record enumeration.
    for (let offset = 0; offset < trialCount; offset += batchSize) {
      await Promise.all(
        Array.from(
          { length: Math.min(batchSize, trialCount - offset) },
          async (_, index) => {
            const workItemId = `race-${offset + index}`;
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
              observations: { workItemCommentId: null, pullRequest: null },
              checkpoints: [],
              claim: { fencingCounter: 0, active: null },
              operations: [
                {
                  operationId: `initialize-race-${offset + index}`,
                  operationKind: "initialize",
                  requestDigest: "a".repeat(64),
                  acceptedRevision: 1,
                  acceptedAt,
                  outcome: { kind: "initialized" },
                },
              ],
              previousGenerationDigest: null,
            };
            const directory = join(recordsRoot, workItemStorageKey(workItemId));
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
    const second = valueOf(
      await openTestDevSquadAdoWorkflowLedgerWithClock(
        { repositoryRoot },
        () => new Date(acceptedAt),
      ),
    );

    let authorities = 0;
    for (let offset = 0; offset < trialCount; offset += batchSize) {
      const trialResults = await Promise.all(
        Array.from(
          { length: Math.min(batchSize, trialCount - offset) },
          async (_, index) => {
            const trial = offset + index;
            const leftToken = Buffer.alloc(32, (trial % 250) + 1).toString(
              "base64url",
            );
            const rightToken = Buffer.alloc(
              32,
              ((trial + 97) % 250) + 1,
            ).toString("base64url");
            const [left, right] = await Promise.all([
              first.acquireClaim({
                workItemId: `race-${trial}`,
                operationId: `acquire-left-${trial}`,
                ownerId: `left-${trial}`,
                claimToken: leftToken,
                leaseDurationMs: 60_000,
              }),
              second.acquireClaim({
                workItemId: `race-${trial}`,
                operationId: `acquire-right-${trial}`,
                ownerId: `right-${trial}`,
                claimToken: rightToken,
                leaseDurationMs: 60_000,
              }),
            ]);
            const accepted = [left, right].filter((result) => result.ok);
            const rejected = [left, right].find((result) => !result.ok);
            expect(accepted).toHaveLength(1);
            expect(rejected).toBeDefined();
            const winner = accepted[0]!;
            if (!winner.ok || rejected === undefined || rejected.ok) return 0;
            expect(rejected.error).toEqual({
              kind: "claim-conflict",
              claim: {
                ...winner.value.record.activeClaim,
                workItemId: `race-${trial}`,
              },
            });
            const conflictJson = JSON.stringify(rejected.error);
            expect(conflictJson).not.toContain(leftToken);
            expect(conflictJson).not.toContain(rightToken);
            expect(winner.value.record.fencingCounter).toBe(1);
            expect(winner.value.record.activeClaim?.ownerId).toBe(
              winner.value.outcome.authority.ownerId,
            );
            return 1;
          },
        ),
      );
      authorities += trialResults.reduce<number>(
        (total, count) => total + count,
        0,
      );
    }
    expect(authorities).toBe(trialCount);
  }, 120_000);

  it("serializes claim publication across two independently synchronized child processes", async () => {
    const repositoryRoot = await mkdtemp(
      join(tmpdir(), "devsquad-ledger-child-race-"),
    );
    roots.push(repositoryRoot);
    const ledger = valueOf(
      await openTestDevSquadAdoWorkflowLedger({ repositoryRoot }),
    );
    valueOf(
      await ledger.initializeRecord({
        workItemId: 137,
        operationId: "initialize-child-race",
        phase: "implement",
        status: "ready",
      }),
    );
    const left = startClaimChild(
      repositoryRoot,
      "child-left",
      tokenA,
      "child-left-acquire",
    );
    const right = startClaimChild(
      repositoryRoot,
      "child-right",
      tokenB,
      "child-right-acquire",
    );
    await Promise.all([left.ready, right.ready]);
    left.go();
    right.go();
    const results = await Promise.all([left.result, right.result]);
    const accepted = results.filter((result) => result.ok);
    const rejected = results.find((result) => !result.ok);
    expect(accepted).toHaveLength(1);
    expect(rejected).toBeDefined();
    expect(rejected?.error).toEqual({
      kind: "claim-conflict",
      claim: {
        workItemId: "137",
        ownerId: accepted[0]!.ownerId,
        fencingValue: accepted[0]!.fencingValue,
        acquiredAt: "2026-09-08T17:00:00.000Z",
        heartbeatAt: "2026-09-08T17:00:00.000Z",
        expiresAt: accepted[0]!.expiresAt,
      },
    });
    expect(JSON.stringify(rejected)).not.toContain(tokenA);
    expect(JSON.stringify(rejected)).not.toContain(tokenB);

    const reopened = valueOf(
      await openTestDevSquadAdoWorkflowLedger({ repositoryRoot }),
    );
    const record = valueOf(await reopened.readRecord(137));
    expect(record.fencingCounter).toBe(1);
    expect(record.activeClaim?.ownerId).toBe(accepted[0]!.ownerId);
  }, 30_000);
});
