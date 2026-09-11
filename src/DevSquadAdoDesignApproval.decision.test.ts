import { afterEach, expect, it } from "vitest";
import {
  startDevSquadAdoDesignApproval as start,
  reconcileDevSquadAdoDesignApproval as reconcile,
} from "./DevSquadAdoDesignApproval.js";
import {
  makeDecisionFixture,
  decisionAdapters,
} from "./DevSquadAdoDesignApprovalTestSupport.js";
const clean: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(clean.splice(0).map((f) => f()));
});
async function fixture() {
  const f = await makeDecisionFixture();
  clean.push(f.dispose);
  return f;
}
it("W052 persists explicit human approval after publication, never executes", async () => {
  const f = await fixture();
  const d = decisionAdapters(f);
  const r = await start(f.request, d as any);
  expect(r).toMatchObject({
    durableState: "approved",
    verificationStatus: "verified",
  });
  expect(f.publishOnce).toHaveBeenCalledTimes(1);
  expect(d.authorizeHumanDecision).toHaveBeenCalledTimes(1);
  expect(await f.ledger.readRecord(137)).toMatchObject({
    ok: true,
    value: {
      revision: 5,
      checkpoints: [{ revision: 3 }, { revision: 4 }, { revision: 5 }],
    },
  });
  expect((await reconcile(f.request, d as any)).durableState).toBe("approved");
  expect(d.authorizeHumanDecision).toHaveBeenCalledTimes(1);
});
it("W052 first change request occupies the same durable slot", async () => {
  const f = await fixture();
  const d = decisionAdapters(f);
  const page = d.readDecisionPage.getMockImplementation()!;
  d.readDecisionPage.mockImplementation(async (q) => {
    const p = await page(q);
    p.page[10][0][12] = p.page[10][0][12].replace(
      "approve-design",
      "request-changes",
    );
    return p;
  });
  expect(await start(f.request, d as any)).toMatchObject({
    durableState: "changes-requested",
    verificationStatus: "verified",
  });
});
it.each([
  "lgtm",
  "/devsquad cancel",
  "development checkpoint approved",
  "quoted",
  "newline",
  "double-space",
  "wrong-binding",
  "prose",
])("W052 rejects %s whole-comment input", async (mode) => {
  const f = await fixture();
  const d = decisionAdapters(f);
  const page = d.readDecisionPage.getMockImplementation()!;
  d.readDecisionPage.mockImplementation(async (q) => {
    const p = await page(q);
    let b = p.page[10][0][12];
    b =
      mode === "quoted"
        ? '"' + b + '"'
        : mode === "newline"
          ? b + "\n"
          : mode === "double-space"
            ? b.replace(" ", "  ")
            : mode === "wrong-binding"
              ? b.replace(q.envelope.occurrence, q.envelope.design)
              : mode === "prose"
                ? "please " + b
                : mode;
    p.page[10][0][12] = b;
    return p;
  });
  expect(await start(f.request, d as any)).toMatchObject({
    durableState: "publication-confirmed",
    reason: "no-eligible-decision",
  });
  expect(d.authorizeHumanDecision).not.toHaveBeenCalled();
});
it.each([
  "denied",
  "unresolved",
  "wrong-actor",
  "wrong-action",
  "wrong-event",
  "wrong-binding",
])("W052 cannot approve %s authorization", async (mode) => {
  const f = await fixture();
  const d = decisionAdapters(f);
  const auth = d.authorizeHumanDecision.getMockImplementation()!;
  d.authorizeHumanDecision.mockImplementation(async (q) => {
    const a = await auth(q);
    if (mode === "unresolved") return { kind: "unavailable" } as any;
    const index: Record<string, number> = {
      denied: 15,
      "wrong-actor": 13,
      "wrong-action": 14,
      "wrong-event": 9,
      "wrong-binding": 4,
    };
    a.witness[index[mode]!] = mode === "denied" ? "denied" : "wrong";
    return a;
  });
  expect(await start(f.request, d as any)).toMatchObject({
    durableState: "publication-confirmed",
    reason:
      mode === "denied"
        ? "no-eligible-decision"
        : "decision-authorization-unresolved",
  });
});
it("W052 a lost resolution response is not effective approval", async () => {
  const f = await fixture();
  const d = decisionAdapters(f);
  const checkpoint = async (q: any) => {
    const r = await f.ledger.checkpoint(q);
    if (q.operationId.startsWith("dg15.a.")) throw Error("SECRET");
    return r;
  };
  const r = await start(f.request, {
    ...d,
    ledger: { readRecord: f.ledger.readRecord, checkpoint },
  } as any);
  expect(r.durableState).toBe("publication-confirmed");
  expect(r.verificationStatus).toBe("mutation-unconfirmed");
  expect(JSON.stringify(r)).not.toContain("SECRET");
});
