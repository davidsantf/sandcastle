import { afterEach, expect, it } from "vitest";
import {
  startDevSquadAdoDesignApproval as start,
  reconcileDevSquadAdoDesignApproval as reconcile,
  recoverDevSquadAdoDesignApproval as recover,
} from "./DevSquadAdoDesignApproval.js";
import {
  makeDecisionFixture,
  decisionAdapters,
} from "./DevSquadAdoDesignApprovalTestSupport.js";
import { openTestDevSquadAdoWorkflowLedgerWithClock } from "./DevSquadAdoWorkflowLedgerTestSupport.js";
const clean: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(clean.splice(0).map((f) => f()));
});
async function fixture() {
  const f = await makeDecisionFixture();
  clean.push(f.dispose);
  return f;
}
it.each(["reservation", "publication", "resolution"])(
  "W055 reopens durable %s after lost original acknowledgement",
  async (stage) => {
    const f = await fixture();
    const d = decisionAdapters(f);
    const prefix =
      stage === "reservation"
        ? "dg15.r."
        : stage === "publication"
          ? "dg15.p."
          : "dg15.a.";
    const first = await start(f.request, {
      ...d,
      ledger: {
        readRecord: f.ledger.readRecord,
        checkpoint: async (
          q: import("./DevSquadAdoWorkflowLedger.js").CheckpointDevSquadAdoWorkflowInput,
        ) => {
          const r = await f.ledger.checkpoint(q);
          if (q.operationId.startsWith(prefix)) throw Error("LOST-SECRET");
          return r;
        },
      },
    } as any);
    expect(first.verificationStatus).toBe("mutation-unconfirmed");
    const opened = await openTestDevSquadAdoWorkflowLedgerWithClock(
      { repositoryRoot: f.root },
      f.now,
    );
    if (!opened.ok) throw Error("reopen");
    const r = await recover(f.request, { ledger: opened.value });
    expect(r).toMatchObject({
      durableState:
        stage === "reservation"
          ? "attempt-consumed"
          : stage === "publication"
            ? "publication-confirmed"
            : "approved",
      checkpointRevisions: {
        reservation: 3,
        publication: stage === "reservation" ? null : 4,
        resolution: stage === "resolution" ? 5 : null,
      },
    });
    expect(f.publishOnce).toHaveBeenCalledTimes(
      stage === "reservation" ? 0 : 1,
    );
    expect(JSON.stringify(r)).not.toContain("LOST-SECRET");
    if (stage === "reservation") {
      await start(f.request, { ...f.dependencies, ledger: opened.value });
      expect(f.publishOnce).not.toHaveBeenCalled();
    }
  },
);
it("W055 reports historical approval with unavailable witnesses and no capability", async () => {
  const f = await fixture();
  await start(f.request, decisionAdapters(f) as any);
  const r = await recover(f.request, { ledger: f.ledger });
  expect(r).toMatchObject({
    durableState: "approved",
    verificationStatus: "evidence-unavailable",
    checkpointRevisions: { reservation: 3, publication: 4, resolution: 5 },
  });
  expect(
    await reconcile({ ...f.request, authority: undefined }, f.dependencies),
  ).toMatchObject({
    durableState: "approved",
    verificationStatus: "evidence-unavailable",
  });
});
it("W055 lost publisher response reconciles original receipt only", async () => {
  const f = await fixture();
  const d = decisionAdapters(f);
  const publish = d.publishOnce;
  await start(f.request, {
    ...f.dependencies,
    publishOnce: async (q, s) => {
      await publish(q, s);
      throw Error("lost");
    },
  });
  expect(await reconcile(f.request, d as any)).toMatchObject({
    durableState: "approved",
    checkpointRevisions: { reservation: 3, publication: 4, resolution: 5 },
  });
  expect(f.publishOnce).toHaveBeenCalledTimes(1);
});
