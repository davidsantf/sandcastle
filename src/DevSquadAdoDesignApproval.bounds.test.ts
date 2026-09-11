import { afterEach, expect, it, vi } from "vitest";
import {
  startDevSquadAdoDesignApproval as start,
  recoverDevSquadAdoDesignApproval as recover,
} from "./DevSquadAdoDesignApproval.js";
import {
  makeDecisionFixture,
  decisionAdapters,
} from "./DevSquadAdoDesignApprovalTestSupport.js";
const clean: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(clean.splice(0).map((f) => f()));
});
async function fixture() {
  const f = await makeDecisionFixture();
  clean.push(f.dispose);
  return f;
}
it("W056 retires a response beyond its monotonic per-call deadline even before timer dispatch", async () => {
  const f = await fixture();
  let now = 0;
  const r = await start(f.request, {
    ...f.dependencies,
    monotonicNow: () => now,
    verifyDesign: async (q) => {
      const p = await f.dependencies.verifyDesign(
        q,
        new AbortController().signal,
      );
      now = 5001;
      return p;
    },
  });
  expect(r.reason).toBe("dependency-timeout");
  expect(f.publishOnce).not.toHaveBeenCalled();
});
it("W056 rejects object scalars without calling dependency serialization hooks", async () => {
  const f = await fixture();
  const raw: any = structuredClone(f.record);
  const toJSON = vi.fn(() => "host-review");
  raw.phase = { toJSON };
  const r = await recover(f.request, {
    ledger: { readRecord: async () => ({ ok: true, value: raw }) },
  });
  expect(r.durableState).toBe("unreadable");
  expect(toJSON).not.toHaveBeenCalled();
});
it.each([8, 9])(
  "W056 bounds complete decision processing at %i pages",
  async (pages) => {
    const f = await fixture();
    const d = decisionAdapters(f);
    const base = d.readDecisionPage.getMockImplementation()!;
    let page = 0;
    d.readDecisionPage.mockImplementation(async (q) => {
      const r = await base(q);
      const template = r.page[10][0];
      const es = Array.from({ length: 16 }, (_, i) => {
        const n = page * 16 + i;
        const e = structuredClone(template);
        e[1] = 6 + n;
        e[2] = "event-" + n;
        e[3] = "ev-" + n;
        e[5] = "comment-" + n;
        return e;
      });
      r.page[6] = 5 + pages * 16;
      r.page[8] = 6 + page * 16;
      r.page[9] = 5 + (page + 1) * 16;
      r.page[10] = es;
      page++;
      r.page[11] = page === pages ? null : "cursor-" + page;
      r.page[12] = page === pages;
      return r;
    });
    const auth = d.authorizeHumanDecision.getMockImplementation()!;
    d.authorizeHumanDecision.mockImplementation(async (q) => {
      const r = await auth(q);
      if (q.event[1] !== 5 + pages * 16) r.witness[15] = "denied";
      return r;
    });
    const r = await start(f.request, d as any);
    expect(r.durableState).toBe(
      pages === 8 ? "approved" : "publication-confirmed",
    );
    expect(d.readDecisionPage).toHaveBeenCalledTimes(8);
    expect(d.authorizeHumanDecision).toHaveBeenCalledTimes(128);
    if (pages === 9) expect(r.reason).toBe("dependency-limit");
  },
);
it.each([4096, 4097])(
  "W056 bounds multibyte event body at %i bytes",
  async (bytes) => {
    const f = await fixture();
    const d = decisionAdapters(f, [
      "é".repeat(2048) + (bytes === 4097 ? "x" : ""),
    ]);
    const r = await start(f.request, d as any);
    expect(r.reason).toBe(
      bytes === 4096 ? "no-eligible-decision" : "input-limit",
    );
    expect(d.authorizeHumanDecision).not.toHaveBeenCalled();
  },
);
it.each(["design", "mutation", "publisher", "publication", "page", "human"])(
  "W056 abort during %s retires all later effects",
  async (stage) => {
    const f = await fixture();
    const d: any = decisionAdapters(f);
    const controller = new AbortController();
    const names: Record<string, string> = {
      design: "verifyDesign",
      mutation: "authorizeMutation",
      publisher: "publishOnce",
      publication: "verifyPublication",
      page: "readDecisionPage",
      human: "authorizeHumanDecision",
    };
    const key = names[stage]!;
    const original = d[key];
    d[key] = async (...args: any[]) => {
      const r = await original(...args);
      controller.abort();
      return r;
    };
    const r = await start({ ...f.request, signal: controller.signal }, d);
    expect(r.reason).toBe("cancelled");
    expect(r.durableState).not.toBe("approved");
    const read = await f.ledger.readRecord(137);
    if (!read.ok) throw Error("read");
    expect(
      read.value.checkpoints.filter((c) => /^dg15\.[ac]\./.test(c.operationId)),
    ).toHaveLength(0);
  },
);
it.each(["page", "human", "publisher"])(
  "W056 late %s fulfillment cannot resolve or continue",
  async (stage) => {
    const f = await fixture();
    const d: any = decisionAdapters(f);
    let entered!: () => void;
    const ready = new Promise<void>((r) => (entered = r));
    let settle!: (v: any) => void;
    let saved: any;
    const key =
      stage === "page"
        ? "readDecisionPage"
        : stage === "human"
          ? "authorizeHumanDecision"
          : "publishOnce";
    const original = d[key];
    d[key] = async (...args: any[]) => {
      saved = await original(...args);
      entered();
      return new Promise((r) => (settle = r));
    };
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const pending = start(f.request, d);
    await ready;
    await vi.advanceTimersByTimeAsync(
      stage === "publisher" ? 10000 : stage === "page" ? 5000 : 1000,
    );
    const r = await pending;
    expect(r.reason).toBe("dependency-timeout");
    settle(saved);
    await Promise.resolve();
    await Promise.resolve();
    vi.useRealTimers();
    expect((await recover(f.request, f.dependencies)).durableState).not.toBe(
      "approved",
    );
  },
);
it("W056 whole invocation expiry never permits a subsequent dependency", async () => {
  const f = await fixture();
  let now = 0;
  const r = await start(f.request, {
    ...f.dependencies,
    monotonicNow: () => now,
    verifyDesign: async (q) => {
      now = 180000;
      return f.dependencies.verifyDesign(q, new AbortController().signal);
    },
  });
  expect(r.reason).toBe("dependency-timeout");
  expect(f.publishOnce).not.toHaveBeenCalled();
});
it.each([16, 17])(
  "W056 event count per page %i is bounded before processing",
  async (count) => {
    const f = await fixture();
    const d = decisionAdapters(f, Array(count).fill("none"));
    const r = await start(f.request, d as any);
    expect(r.reason).toBe(
      count === 16 ? "no-eligible-decision" : "decision-prefix-incomplete",
    );
  },
);
it.each([64, 65])(
  "W056 artifact count %i is bounded before verification",
  async (count) => {
    const f = await fixture();
    const artifacts = Array.from(
      { length: count },
      (_, i) =>
        [
          f.request.scope,
          "artifact-" + i,
          "immutable",
          f.request.occurrence,
        ] as const,
    );
    const r = await start(
      { ...f.request, design: { ...f.request.design, artifacts } },
      f.dependencies,
    );
    expect(f.publishOnce).toHaveBeenCalledTimes(count === 64 ? 1 : 0);
    if (count === 65) expect(r.reason).toBe("input-limit");
  },
);
it.each([256, 257])(
  "W056 evidence identifier %i bytes is not truncated",
  async (count) => {
    const f = await fixture();
    const r = await start(f.request, {
      ...f.dependencies,
      verifyDesign: async (q) => ({
        ...(await f.dependencies.verifyDesign(q, new AbortController().signal)),
        verifierId: "x".repeat(count),
      }),
    });
    expect(f.publishOnce).toHaveBeenCalledTimes(count === 256 ? 1 : 0);
    if (count === 257) expect(r.reason).toBe("design-mismatch");
  },
);
it.each([10000, 10001])(
  "W056 validates at most %i checkpoint entries per recovery record",
  async (count) => {
    const f = await fixture();
    const raw: any = structuredClone(f.record);
    raw.revision = count + 1;
    raw.checkpoints = Array.from({ length: count }, (_, i) => ({
      revision: i + 2,
      operationId: "ordinary-" + i,
      acceptedAt: raw.updatedAt,
      previous: { phase: raw.phase, status: raw.status },
      resulting: { phase: raw.phase, status: raw.status },
    }));
    const r = await recover(f.request, {
      ledger: { readRecord: async () => ({ ok: true, value: raw }) },
    });
    expect(r.durableState).toBe(count === 10000 ? "unreserved" : "unreadable");
  },
);
it.each(["agent", "session"])(
  "W056 bounds %s history before copying",
  async (field) => {
    const f = await fixture();
    const raw: any = structuredClone(f.record);
    raw[field].history = Array(10001).fill(null);
    expect(
      (
        await recover(f.request, {
          ledger: { readRecord: async () => ({ ok: true, value: raw }) },
        })
      ).durableState,
    ).toBe("unreadable");
  },
);
it.each([1024, 1025])(
  "W056 private cursor %i bytes is bounded",
  async (count) => {
    const f = await fixture();
    const d = decisionAdapters(f, ["none"]);
    const base = d.readDecisionPage.getMockImplementation()!;
    let pages = 0;
    d.readDecisionPage.mockImplementation(async (q) => {
      const r = await base(q);
      r.page[6] = 7;
      if (pages++ === 0) {
        r.page[11] = "x".repeat(count);
        r.page[12] = false;
      } else {
        r.page[8] = 7;
        r.page[9] = 7;
        r.page[10][0][1] = 7;
        r.page[10][0][2] = "second";
        r.page[10][0][5] = "second-comment";
      }
      return r;
    });
    const r = await start(f.request, d as any);
    expect(r.reason).toBe(
      count === 1024 ? "no-eligible-decision" : "decision-prefix-incomplete",
    );
    expect(d.readDecisionPage).toHaveBeenCalledTimes(count === 1024 ? 2 : 1);
  },
);
