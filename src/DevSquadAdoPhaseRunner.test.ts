import { afterEach, describe, expect, it } from "vitest";
import {
  recoverDevSquadAdoPhase,
  runDevSquadAdoPhase,
} from "./DevSquadAdoPhaseRunner.js";
import { makePhaseFixture } from "./DevSquadAdoPhaseTestSupport.js";

const clean: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(clean.splice(0).map((dispose) => dispose()));
});
async function fixture(kind: "prepare" | "implement" = "implement") {
  const value = await makePhaseFixture(kind);
  clean.push(value.dispose);
  return value;
}

describe("DevSquad ADO phase runner success and settled failure", () => {
  it("records one preparation reservation and terminal success", async () => {
    const f = await fixture("prepare");
    expect(await runDevSquadAdoPhase(f.request, f.dependencies)).toMatchObject({
      state: "completed",
      reason: "recorded",
      reservationRevision: 6,
      terminalRevision: 7,
    });
    expect(f.prepare).toHaveBeenCalledTimes(1);
    expect(f.authorizePhase.mock.calls.map(([q]) => q.action)).toEqual([
      "reserve",
      "dispatch",
      "complete",
    ]);
    const read = await f.ledger.readRecord("137");
    expect(read.ok && read.value).toMatchObject({
      revision: 7,
      phase: "host-selected-next",
      status: "ready",
    });
  });

  it("composes the existing adapter and validates before success", async () => {
    const f = await fixture();
    expect(await runDevSquadAdoPhase(f.request, f.dependencies)).toMatchObject({
      state: "completed",
      reason: "recorded",
      reservationRevision: 6,
      terminalRevision: 7,
    });
    expect(f.execute).toHaveBeenCalledTimes(1);
    expect(f.runValidationCommand).toHaveBeenCalledTimes(2);
    expect(f.verifyDesignAuthorization).toHaveBeenCalledTimes(3);
    expect(f.verifyCurrentTarget).toHaveBeenCalledTimes(3);
  });

  it("records adapter validation failure as the selected failure state", async () => {
    const f = await fixture();
    f.runValidationCommand.mockResolvedValueOnce({
      status: "failed",
      exitCode: 1,
    });
    expect(await runDevSquadAdoPhase(f.request, f.dependencies)).toMatchObject({
      state: "failed",
      reason: "recorded",
      terminalRevision: 7,
    });
    const read = await f.ledger.readRecord("137");
    expect(read.ok && read.value).toMatchObject({
      phase: "host-selected-recovery",
      status: "failed",
    });
    expect(
      await recoverDevSquadAdoPhase(f.input, {
        ledger: f.ledger,
        utcNow: f.dependencies.utcNow,
        verifyTerminalReceipt: f.verifyTerminalReceipt,
      }),
    ).toMatchObject({ state: "failed", reason: "recorded" });
  });

  it("records a settled preparation failure without treating it as uncertainty", async () => {
    const f = await fixture("prepare");
    f.prepare.mockResolvedValueOnce({
      kind: "failed",
      artifactDigest: Buffer.alloc(32, 20).toString("base64url"),
    });
    expect(await runDevSquadAdoPhase(f.request, f.dependencies)).toMatchObject({
      state: "failed",
      reason: "recorded",
      terminalRevision: 7,
    });
    expect(f.authorizePhase.mock.calls.at(-1)![0].action).toBe("fail");
  });

  it("recovers terminal history read-only only after trusted audit verification", async () => {
    const f = await fixture("prepare");
    const first = await runDevSquadAdoPhase(f.request, f.dependencies);
    expect(
      await recoverDevSquadAdoPhase(f.input, {
        ledger: { readRecord: f.ledger.readRecord },
        utcNow: f.dependencies.utcNow,
        verifyTerminalReceipt: f.verifyTerminalReceipt,
      }),
    ).toEqual(first);
    expect(f.verifyTerminalReceipt).toHaveBeenCalledTimes(1);
  });

  it("does not trust a retained terminal commitment without host audit evidence", async () => {
    const f = await fixture("prepare");
    await runDevSquadAdoPhase(f.request, f.dependencies);
    expect(
      await recoverDevSquadAdoPhase(f.input, {
        ledger: f.ledger,
        utcNow: f.dependencies.utcNow,
      }),
    ).toMatchObject({ state: "blocked", reason: "receipt-unverified" });
  });
});
