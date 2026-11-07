import { describe, expect, it, vi } from "vitest";
import {
  evaluateCoworkSignal,
  intakeCoworkSignal,
  normalizeCoworkItem,
  proposeCoworkItem,
  publishCoworkItem,
  reconcileCoworkItem,
} from "./CoworkFactory.js";
import {
  coworkDigest,
  coworkBounded,
  coworkFactoryRecordSchema,
} from "./CoworkFactoryContract.js";
import {
  CoworkMemoryStore,
  NOW,
  evidence,
  itemHost,
  rule,
} from "./CoworkFactoryTestSupport.js";

function candidate() {
  const result = evaluateCoworkSignal(evidence(), rule(), NOW);
  if (result.state !== "candidate")
    throw new Error("Expected fixture candidate");
  return result.candidate;
}
describe("deterministic engineering intake", () => {
  it.each([
    "error-cluster",
    "regression",
    "tool-feedback",
    "main-build",
    "instruction-budget",
    "file-budget",
    "release-recurrence",
  ] as const)("maps %s to an objectively scoped proposal", (kind) => {
    const result = evaluateCoworkSignal(evidence(), { ...rule(), kind }, NOW);
    expect(result.state).toBe("candidate");
    if (result.state === "candidate") {
      expect(result.candidate.acceptance).toHaveLength(2);
      expect(result.candidate.rule.version).toBe("1");
    }
  });
  it("deduplicates timestamp and observed metric changes but distinguishes revision/rule", () => {
    const original = candidate();
    const next = evaluateCoworkSignal(
      { ...evidence(), value: 4, observedAt: "2026-11-07T04:00:01.000Z" },
      rule(),
      "2026-11-07T04:00:01.000Z",
    );
    expect(next.state === "candidate" && next.candidate.key).toBe(original.key);
    const different = evaluateCoworkSignal(
      evidence(),
      { ...rule(), version: "2" },
      NOW,
    );
    expect(different.state === "candidate" && different.candidate.key).not.toBe(
      original.key,
    );
  });
  it.each([
    ["unknown", { state: "unknown" }],
    ["zero", { evaluatedScope: 0 }],
    ["nonfinite", { value: NaN }],
    ["negative-count", { value: -1 }],
    ["fractional-count", { value: 0.5 }],
    ["unit", { unit: "ms" }],
    ["project", { project: "B" }],
  ])("blocks %s evidence", (_, patch) => {
    expect(
      evaluateCoworkSignal(
        { ...evidence(), ...patch } as ReturnType<typeof evidence>,
        rule(),
        NOW,
      ).state,
    ).toBe("blocked");
  });
  it("checks exact freshness and threshold boundaries", () => {
    expect(
      evaluateCoworkSignal(evidence(), rule(), "2026-11-07T04:01:00.000Z")
        .state,
    ).toBe("candidate");
    expect(
      evaluateCoworkSignal(evidence(), rule(), "2026-11-07T04:01:00.001Z")
        .state,
    ).toBe("blocked");
    expect(
      evaluateCoworkSignal({ ...evidence(), value: 0 }, rule(), NOW).state,
    ).toBe("no-match");
    expect(
      evaluateCoworkSignal(evidence(), rule(), "2026-11-07T03:59:59.000Z")
        .state,
    ).toBe("blocked");
  });
  it("retains candidate/intake/event state across simulated restart", async () => {
    const store = new CoworkMemoryStore();
    const input = { evidence: evidence(), rule: rule(), now: NOW };
    const first = await intakeCoworkSignal(input, store);
    const replay = await intakeCoworkSignal(input, store);
    expect(first).toEqual(replay);
    expect(store.events).toHaveLength(2);
    expect(
      [...store.rows.values()].map((row) => row.value.kind).sort(),
    ).toEqual(["candidate", "intake"]);
  });
  it("does not accept a synchronous host result that overran its deadline", async () => {
    vi.useFakeTimers();
    try {
      const start = Date.now();
      await expect(
        coworkBounded(async () => {
          vi.setSystemTime(start + 1001);
          return "not-in-time";
        }, 1000),
      ).rejects.toThrow("deadline");
    } finally {
      vi.useRealTimers();
    }
  });
});
describe("approved mixed-hub item transport", () => {
  it("previews by default with zero host calls/writes", async () => {
    const host = itemHost(),
      store = new CoworkMemoryStore();
    host.verifyEvidence = async () => {
      throw new Error("must not call host");
    };
    expect(
      (
        await publishCoworkItem(proposeCoworkItem(candidate()), {
          host,
          store,
          now: NOW,
        })
      ).state,
    ).toBe("preview");
    expect(host.writes).toBe(0);
    expect(store.events).toHaveLength(0);
  });
  it("blocks denied routes and unverifiable source evidence", async () => {
    const host = itemHost(),
      store = new CoworkMemoryStore();
    host.authorized = false;
    expect(
      (
        await publishCoworkItem(proposeCoworkItem(candidate()), {
          host,
          store,
          now: NOW,
          mode: "publish",
        })
      ).state,
    ).toBe("blocked");
    host.authorized = true;
    host.verifyEvidence = async () => false;
    expect(
      (
        await publishCoworkItem(proposeCoworkItem(candidate()), {
          host,
          store,
          now: NOW,
          mode: "publish",
        })
      ).state,
    ).toBe("blocked");
    expect(host.writes).toBe(0);
  });
  it.each(["github", "azure-devops"] as const)(
    "normalizes and publishes %s once across restart",
    async (provider) => {
      const c = candidate();
      if (provider === "azure-devops")
        c.target = {
          provider,
          organization: "example",
          project: "B",
          workItemType: "Task",
        };
      const proposal = proposeCoworkItem(c),
        host = itemHost(),
        store = new CoworkMemoryStore();
      const payload = normalizeCoworkItem(proposal);
      expect(payload.provider).toBe(provider);
      if (payload.provider === "azure-devops")
        expect(payload.fields["System.Title"]).toBe(proposal.title);
      const options = { mode: "publish" as const, host, store, now: NOW };
      const first = await publishCoworkItem(proposal, options);
      expect(first.state).toBe("completed");
      expect(await publishCoworkItem(proposal, options)).toEqual(first);
      expect(host.writes).toBe(1);
      expect(store.events.map((event) => event.kind)).toEqual([
        "publication",
        "publication",
      ]);
    },
  );
  it("reserves atomically before create and prevents concurrent dispatch", async () => {
    const store = new CoworkMemoryStore(),
      host = itemHost(),
      proposal = proposeCoworkItem(candidate());
    const create = host.create.bind(host);
    host.create = async (...args) => {
      expect([...store.rows.values()][0]?.value).toMatchObject({
        state: "reserved",
      });
      return create(...args);
    };
    const results = await Promise.all(
      [1, 2].map(() =>
        publishCoworkItem(proposal, {
          mode: "publish",
          store,
          host,
          now: NOW,
        }),
      ),
    );
    expect(results.some((result) => result.state === "completed")).toBe(true);
    expect(host.writes).toBe(1);
  });
  it("retains unknown writes without retry; independently reconciles a bound receipt", async () => {
    const store = new CoworkMemoryStore(),
      host = itemHost(),
      proposal = proposeCoworkItem(candidate());
    host.create = async () => {
      host.writes++;
      throw new Error("network lost after write");
    };
    const options = { mode: "publish" as const, host, store, now: NOW };
    expect((await publishCoworkItem(proposal, options)).state).toBe("unknown");
    expect((await publishCoworkItem(proposal, options)).state).toBe("unknown");
    expect(host.writes).toBe(1);
    const receipt = {
      id: "remote-7",
      url: "https://example.test/items/7",
      intent: proposal.intent,
      targetDigest: coworkDigest(proposal.candidate.target),
    };
    expect(
      (
        await reconcileCoworkItem(
          proposal,
          { ...receipt, intent: "f".repeat(64) },
          options,
        )
      ).state,
    ).toBe("blocked");
    expect((await reconcileCoworkItem(proposal, receipt, options)).state).toBe(
      "completed",
    );
    expect((await publishCoworkItem(proposal, options)).state).toBe(
      "completed",
    );
    expect(host.writes).toBe(1);
  });
  it("never trusts a success-shaped malformed receipt", async () => {
    const host = itemHost(),
      store = new CoworkMemoryStore(),
      proposal = proposeCoworkItem(candidate());
    host.create = async () => ({
      state: "completed",
      receipt: {
        id: "7",
        url: "https://example.test/7",
        intent: "f".repeat(64),
        targetDigest: "f".repeat(64),
      },
    });
    expect(
      (
        await publishCoworkItem(proposal, {
          mode: "publish",
          host,
          store,
          now: NOW,
        })
      ).state,
    ).toBe("unknown");
  });
  it("rejects extra serialized fields and edited proposal bodies", async () => {
    expect(
      coworkFactoryRecordSchema.safeParse({
        kind: "candidate",
        candidate: candidate(),
        intent: "f".repeat(64),
        credentials: "not-allowed",
      }).success,
    ).toBe(false);
    const proposal = proposeCoworkItem(candidate());
    expect(
      (
        await publishCoworkItem(
          { ...proposal, body: "edited" },
          {
            host: itemHost(),
            store: new CoworkMemoryStore(),
            now: NOW,
            mode: "publish",
          },
        )
      ).state,
    ).toBe("blocked");
  });
});
