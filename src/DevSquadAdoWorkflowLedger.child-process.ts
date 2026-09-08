import { openTestDevSquadAdoWorkflowLedgerWithClock } from "./DevSquadAdoWorkflowLedgerTestSupport.js";

const [repositoryRoot, ownerId, claimToken, operationId] =
  process.argv.slice(2);
if (!repositoryRoot || !ownerId || !claimToken || !operationId) {
  throw new TypeError("missing child-process ledger test argument");
}

const opened = await openTestDevSquadAdoWorkflowLedgerWithClock(
  { repositoryRoot },
  () => new Date("2026-09-08T17:00:00.000Z"),
);
if (!opened.ok) throw new TypeError(opened.error.kind);

process.stdout.write("READY\n");
await new Promise<void>((resolve) =>
  process.stdin.once("data", () => resolve()),
);
const result = await opened.value.acquireClaim({
  workItemId: 137,
  operationId,
  ownerId,
  claimToken,
  leaseDurationMs: 60_000,
});
const projection = result.ok
  ? {
      ok: true as const,
      ownerId: result.value.outcome.authority.ownerId,
      fencingValue: result.value.outcome.authority.fencingValue,
      expiresAt: result.value.outcome.authority.expiresAt,
    }
  : { ok: false as const, error: result.error };
process.stdout.write(`RESULT ${JSON.stringify(projection)}\n`);
