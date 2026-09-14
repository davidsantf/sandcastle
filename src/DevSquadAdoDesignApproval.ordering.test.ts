import { afterEach, expect, it } from "vitest";
import { startDevSquadAdoDesignApproval as start } from "./DevSquadAdoDesignApproval.js";
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
async function run(mode: string) {
  const f = await fixture();
  const d = decisionAdapters(f);
  const base = d.readDecisionPage.getMockImplementation()!;
  d.readDecisionPage.mockImplementation(async (q) => {
    const r = await base(q);
    const e = r.page[10][0];
    const first = structuredClone(e);
    first[12] = "not a command";
    first[2] = "z-opaque";
    const second = structuredClone(e);
    second[1] = 7;
    second[2] = "a-opaque";
    second[5] = "comment-second";
    const third = structuredClone(second);
    third[1] = 8;
    third[2] = "delete-event";
    third[4] = "delete";
    third[6] = "v2";
    third[7] = "v1";
    third[12] = null;
    if (mode === "edit" || mode === "missing-version") {
      second[4] = "edit";
      second[5] = first[5];
      second[6] = "v2";
      second[7] = mode === "edit" ? "v1" : "lost-version";
    }
    if (mode === "denied" || mode === "unresolved")
      first[12] = e[12].replace("approve-design", "request-changes");
    r.page[6] = mode === "delete" ? 8 : 7;
    if (mode === "partition-single") {
      r.page[9] = 7;
      r.page[10] = [first, second];
      return r;
    }
    if (q.cursor === null) {
      r.page[9] = 6;
      r.page[10] = [first];
      r.page[11] = "next";
      r.page[12] = false;
    } else {
      r.page[8] = 7;
      r.page[9] = r.page[6];
      r.page[10] = mode === "delete" ? [second, third] : [second];
      if (mode === "gap") r.page[8] = 8;
      if (mode === "overlap") r.page[8] = 6;
      if (mode === "duplicate") second[2] = first[2];
      if (mode === "snapshot") r.page[5] = "changed";
      if (mode === "cursor") r.page[7] = "wrong";
      if (mode === "cycle") {
        r.page[11] = "next";
        r.page[12] = false;
        second[12] = "none";
        r.page[6] = 8;
      }
      if (mode === "false-empty") {
        r.page[10] = [];
        r.page[9] = 6;
      }
    }
    return r;
  });
  if (mode === "denied" || mode === "unresolved") {
    const auth = d.authorizeHumanDecision.getMockImplementation()!;
    d.authorizeHumanDecision.mockImplementation(async (q) => {
      if (q.event[1] === 6) {
        if (mode === "unresolved") return { kind: "unavailable" } as any;
        const r = await auth(q);
        r.witness[15] = "denied";
        return r;
      }
      return auth(q);
    });
  }
  const r = await start(f.request, d as any);
  const record = await f.ledger.readRecord(137);
  return { r, d, record };
}
it.each(["multipage", "edit", "delete", "denied"])(
  "W053 selects first authorized event in %s stream",
  async (mode) => {
    const { r, d } = await run(mode);
    expect(r.durableState).toBe("approved");
    expect(d.readDecisionPage).toHaveBeenCalledTimes(2);
  },
);
it("W053 semantic resolution identity is independent of page partitioning", async () => {
  const a = await run("multipage"),
    b = await run("partition-single");
  expect(a.r.durableState).toBe("approved");
  expect(b.r.durableState).toBe("approved");
  if (!a.record.ok || !b.record.ok) throw Error("read");
  expect(a.record.value.checkpoints.at(-1)?.operationId).toBe(
    b.record.value.checkpoints.at(-1)?.operationId,
  );
});
it.each([
  "gap",
  "overlap",
  "duplicate",
  "snapshot",
  "cursor",
  "cycle",
  "false-empty",
  "missing-version",
])("W053 blocks %s prefix", async (mode) => {
  const { r } = await run(mode);
  expect(r).toMatchObject({
    durableState: "publication-confirmed",
    reason: "decision-prefix-incomplete",
  });
});
it("W053 earlier unresolved authorization blocks later command", async () => {
  const { r, d } = await run("unresolved");
  expect(r.reason).toBe("decision-authorization-unresolved");
  expect(d.authorizeHumanDecision).toHaveBeenCalledTimes(1);
});
