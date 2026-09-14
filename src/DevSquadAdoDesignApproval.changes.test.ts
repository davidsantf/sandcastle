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
const clean: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(clean.splice(0).map((f) => f()));
});
async function fixture() {
  const f = await makeDecisionFixture();
  clean.push(f.dispose);
  return f;
}
it.each(["content", "artifact"])(
  "W058 historical approval never verifies revised %s under the same occurrence",
  async (kind) => {
    const f = await fixture();
    const d = decisionAdapters(f);
    const first = await start(f.request, d as any);
    const design =
      kind === "content"
        ? { ...f.request.design, content: "revised" }
        : {
            ...f.request.design,
            artifacts: [
              [f.request.scope, "spec", "v2", f.request.occurrence] as const,
            ],
          };
    expect(await start({ ...f.request, design }, d as any)).toMatchObject({
      durableState: "approved",
      verificationStatus: "conflicting-evidence",
      reason: "design-mismatch",
      binding: first.binding,
    });
    expect(f.publishOnce).toHaveBeenCalledTimes(1);
  },
);
it("W058 revised design requires separately authorized occurrence and fresh human review", async () => {
  const f = await fixture();
  const d = decisionAdapters(f);
  const page = d.readDecisionPage.getMockImplementation()!;
  d.readDecisionPage.mockImplementation(async (q) => {
    const r = await page(q);
    r.page[10][0][12] = r.page[10][0][12].replace(
      "approve-design",
      "request-changes",
    );
    return r;
  });
  const first = await start(f.request, d as any);
  expect(first.durableState).toBe("changes-requested");
  const revised = {
    ...f.request,
    occurrence: Buffer.alloc(32, 22).toString("base64url"),
    design: { ...f.request.design, content: "new reviewed content" },
  };
  expect(
    await start(revised, {
      ...decisionAdapters(f),
      authorizeMutation: async () => ({ kind: "denied" }),
    } as any),
  ).toMatchObject({
    durableState: "unreserved",
    reason: "host-authorization-unavailable",
  });
  expect(f.publishOnce).toHaveBeenCalledTimes(1);
  const fresh = decisionAdapters(f);
  expect((await start(revised, fresh as any)).durableState).toBe("approved");
  expect(fresh.authorizeHumanDecision).toHaveBeenCalledTimes(1);
  expect(f.publishOnce).toHaveBeenCalledTimes(2);
  expect((await recover(f.request, f.dependencies)).durableState).toBe(
    "changes-requested",
  );
  expect((await reconcile(f.request, fresh as any)).durableState).toBe(
    "changes-requested",
  );
});
it("W058 an old exact mutation grant cannot authorize a new occurrence", async () => {
  const f = await fixture();
  let old: any;
  await start(f.request, {
    ...f.dependencies,
    authorizeMutation: async (q) => {
      old = q;
      return { kind: "granted", request: q };
    },
  });
  const r = await start(
    { ...f.request, occurrence: Buffer.alloc(32, 23).toString("base64url") },
    {
      ...f.dependencies,
      authorizeMutation: async () => ({ kind: "granted", request: old }),
    },
  );
  expect(r.reason).toBe("host-authorization-unavailable");
  expect(f.publishOnce).toHaveBeenCalledTimes(1);
});
it("W058 uncertain publication never automatically replaces an occurrence", async () => {
  const f = await fixture();
  const d = {
    ...f.dependencies,
    publishOnce: async () => {
      throw Error("lost");
    },
  };
  await start(f.request, d);
  await start(f.request, d);
  const r = await f.ledger.readRecord(137);
  if (!r.ok) throw Error("read");
  expect(r.value.checkpoints).toHaveLength(1);
  expect(r.value.checkpoints[0]!.operationId.split(".")[2]).toBe(
    f.request.occurrence,
  );
});
