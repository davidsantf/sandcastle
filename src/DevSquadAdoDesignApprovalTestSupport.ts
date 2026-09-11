import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openTestDevSquadAdoWorkflowLedgerWithClock } from "./DevSquadAdoWorkflowLedgerTestSupport.js";

// W048: portable isolated fixture, not production Windows durability evidence.
export const gateOccurrence = Buffer.alloc(32, 15).toString("base64url");
export async function makeDesignGateFixture() {
  const root = await mkdtemp(join(tmpdir(), "design-gate-"));
  const now = () => new Date("2026-09-11T12:00:00.000Z");
  const opened = await openTestDevSquadAdoWorkflowLedgerWithClock(
    { repositoryRoot: root },
    now,
  );
  if (!opened.ok) throw new Error("fixture-open-failed");
  const ledger = opened.value;
  const seeded = await ledger.initializeRecord({
    workItemId: 137,
    operationId: "seed",
    phase: "host-review",
    status: "waiting",
  });
  if (!seeded.ok) throw new Error("fixture-seed-failed");
  return {
    root,
    ledger,
    record: seeded.value.record,
    now,
    request: { workItemId: 137, occurrence: gateOccurrence },
    dispose: () => rm(root, { recursive: true, force: true }),
  };
}
