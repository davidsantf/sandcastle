import { describe, expect, it } from "vitest";
import {
  completeCoworkAttempt,
  coworkBottomDecile,
  evaluateCoworkAcceptance,
  evaluateCoworkDocumentQuality,
  evaluateCoworkLoopBounds,
  evaluateCoworkTestSpeed,
  readCoworkLoopHistory,
  reserveCoworkAttempt,
  type CoworkAcceptancePair,
  type CoworkDocumentEvidence,
  type CoworkTimingEvidence,
} from "./CoworkMeasuredLoops.js";
import {
  CoworkMemoryStore,
  BASE,
  HASH,
  NOW,
  OTHER,
  REV,
  execution,
  policy,
} from "./CoworkFactoryTestSupport.js";

const pairs = (): CoworkAcceptancePair[] =>
  [1, 2].map((n) => ({
    baseline: execution("baseline", n),
    candidate: execution("candidate", n),
  }));
const acceptance = (p = pairs()) =>
  evaluateCoworkAcceptance({
    baselineRevision: BASE,
    candidateRevision: REV,
    pairs: p,
    now: NOW,
    maxAgeMs: 60000,
  });
const timing = (role: "baseline" | "candidate"): CoworkTimingEvidence => ({
  project: "A",
  source: "ci-main-suite",
  revision: role === "baseline" ? BASE : REV,
  observedAt: NOW,
  artifact: HASH,
  unit: "ms",
  environment: HASH,
  workload: OTHER,
  testIds: ["case-1"],
  assertionIds: ["a1", "a2"],
  behaviorDigest: HASH,
  evaluatedScope: 1,
  durations: role === "baseline" ? [100, 100] : [95, 95],
  checks: [{ name: "compatibility", passed: true }],
  protectedMetric: {
    name: "memory",
    unit: "bytes",
    value: 100,
    direction: "lower",
  },
});
const document = (role: "baseline" | "candidate"): CoworkDocumentEvidence => ({
  project: "A",
  source: "quality-runner",
  revision: role === "baseline" ? BASE : REV,
  observedAt: NOW,
  artifact: HASH,
  benchmark: "docs",
  benchmarkVersion: "1",
  evaluator: "rubric",
  evaluatorVersion: "1",
  tasks: Array.from({ length: 10 }, (_, index) => ({
    id: `task-${index}`,
    output: role === "baseline" ? HASH : OTHER,
    score: index === 0 ? 1 : role === "candidate" ? index + 1 : index,
    hardChecks: [{ name: "links", passed: true }],
  })),
});
const opts = { now: NOW, maxAgeMs: 60000 };
describe("nonvacuous fail-before-fix acceptance", () => {
  it("accepts two distinct isolated baseline failures and candidate passes", () => {
    expect(acceptance()).toMatchObject({
      state: "keep",
      reason: "executed-fail-before-fix",
    });
  });
  it("rejects a test that would still pass without the change", () => {
    const p = pairs();
    p[0]!.baseline.targetChecks[0]!.passed = true;
    expect(acceptance(p)).toMatchObject({
      state: "reject",
      reason: "negative-control-did-not-fail",
    });
  });
  it("blocks stale or future executions even when assertions pass", () => {
    for (const observedAt of [
      "2026-11-07T03:00:00.000Z",
      "2026-11-08T04:00:00.000Z",
    ]) {
      const p = pairs();
      p[0]!.candidate.observedAt = observedAt;
      expect(acceptance(p)).toMatchObject({
        state: "inconclusive",
        reason: "stale-execution-evidence",
      });
    }
  });
  it.each([
    "cases",
    "assertions",
    "reused",
    "workload",
    "revision",
    "missing-repeat",
  ] as const)("never passes %s evidence", (kind) => {
    const p = pairs();
    if (kind === "cases") p[0]!.candidate.evaluatedScope = 0;
    if (kind === "assertions") p[0]!.candidate.assertionIds = [];
    if (kind === "reused")
      p[1]!.candidate.fixtureId = p[0]!.candidate.fixtureId;
    if (kind === "workload") p[1]!.baseline.workload = HASH;
    if (kind === "revision") p[0]!.candidate.revision = BASE;
    if (kind === "missing-repeat") p.pop();
    expect(acceptance(p).state).not.toBe("keep");
  });
  it("rejects relevant and protected failures and assertion loss", () => {
    const p = pairs();
    p[0]!.candidate.protectedChecks[0]!.passed = false;
    expect(acceptance(p).state).toBe("reject");
    const q = pairs();
    q[0]!.candidate.assertionIds.pop();
    expect(acceptance(q).state).not.toBe("keep");
  });
});
describe("measured >=5% test-speed target", () => {
  it.each([
    [95, "keep"],
    [95.000001, "reject"],
    [96, "reject"],
    [94, "keep"],
  ] as const)("candidate %sms returns %s against 100ms", (ms, state) => {
    expect(
      evaluateCoworkTestSpeed(
        timing("baseline"),
        {
          ...timing("candidate"),
          durations: [ms, ms],
        },
        opts,
      ).state,
    ).toBe(state);
  });
  it.each([
    "unit",
    "cases",
    "assertion-loss",
    "behavior",
    "workload",
    "revision",
    "noise",
    "stale",
    "protected",
    "test-identity",
    "nonfinite",
  ] as const)("does not keep %s evidence", (kind) => {
    const candidate = timing("candidate");
    if (kind === "unit") Object.assign(candidate, { unit: "seconds" });
    if (kind === "cases") candidate.evaluatedScope = 0;
    if (kind === "assertion-loss") candidate.assertionIds.pop();
    if (kind === "behavior") candidate.behaviorDigest = OTHER;
    if (kind === "workload") candidate.workload = HASH;
    if (kind === "revision") candidate.revision = BASE;
    if (kind === "noise") candidate.durations = [50, 140];
    if (kind === "stale") candidate.observedAt = "2026-11-07T03:00:00.000Z";
    if (kind === "protected") candidate.protectedMetric.value = 101;
    if (kind === "test-identity") candidate.testIds = ["different"];
    if (kind === "nonfinite") candidate.durations = [NaN, 50];
    expect(
      evaluateCoworkTestSpeed(timing("baseline"), candidate, opts).state,
    ).not.toBe("keep");
  });
  it("is inconclusive rather than success when timing is noisy", () => {
    expect(
      evaluateCoworkTestSpeed(
        timing("baseline"),
        {
          ...timing("candidate"),
          durations: [1, 90],
        },
        opts,
      ),
    ).toMatchObject({ state: "inconclusive", reason: "noisy-timing-evidence" });
  });
});
describe("fixed document benchmark and bottom-decile evidence", () => {
  it("keeps wins > losses with no bottom-decile/hard-check regressions", () => {
    expect(
      evaluateCoworkDocumentQuality(
        document("baseline"),
        document("candidate"),
        opts,
      ),
    ).toMatchObject({ state: "keep", wins: 9, losses: 0, tailSize: 1 });
  });
  it("defines ceil(N/10) precisely, preserving ties without expanding membership", () => {
    expect(coworkBottomDecile([2])).toEqual({ size: 1, mean: 2 });
    expect(coworkBottomDecile(Array(10).fill(2))).toEqual({ size: 1, mean: 2 });
    expect(coworkBottomDecile([0, 2, ...Array(9).fill(100)])).toEqual({
      size: 2,
      mean: 1,
    });
    expect(coworkBottomDecile([0, 0, 0, ...Array(8).fill(100)])).toEqual({
      size: 2,
      mean: 0,
    });
    expect(() => coworkBottomDecile([])).toThrow();
    expect(() => coworkBottomDecile([Infinity])).toThrow();
  });
  it("rejects a regressing tail even with more wins", () => {
    const c = document("candidate");
    c.tasks[0]!.score = 0.5;
    expect(
      evaluateCoworkDocumentQuality(document("baseline"), c, opts),
    ).toMatchObject({ state: "reject", reason: "bottom-decile-regression" });
  });
  it("rejects changed scores for identical outputs from the fixed evaluator", () => {
    const c = document("candidate");
    c.tasks[1]!.output = HASH;
    expect(
      evaluateCoworkDocumentQuality(document("baseline"), c, opts),
    ).toMatchObject({
      state: "inconclusive",
      reason: "inconsistent-evaluator-output",
    });
  });
  it.each([
    "hard",
    "ties",
    "missing",
    "duplicate",
    "nonfinite",
    "evaluator",
    "benchmark",
  ] as const)("does not keep %s output", (kind) => {
    const c = document("candidate");
    if (kind === "hard") c.tasks[1]!.hardChecks[0]!.passed = false;
    if (kind === "ties") c.tasks = document("baseline").tasks;
    if (kind === "missing") c.tasks.pop();
    if (kind === "duplicate") c.tasks[1]!.id = c.tasks[0]!.id;
    if (kind === "nonfinite") c.tasks[1]!.score = NaN;
    if (kind === "evaluator") c.evaluatorVersion = "2";
    if (kind === "benchmark") c.benchmarkVersion = "2";
    expect(
      evaluateCoworkDocumentQuality(document("baseline"), c, opts).state,
    ).not.toBe("keep");
  });
});
describe("durable measured-loop policies", () => {
  it("stops after repeated signatures across simulated restart", async () => {
    const store = new CoworkMemoryStore(),
      p = policy();
    for (let n = 1; n <= 2; n++) {
      const reserved = await reserveCoworkAttempt("loop", p, store, NOW);
      if (reserved.state !== "reserved")
        throw new Error("Expected reservation");
      await completeCoworkAttempt(
        reserved.record,
        {
          state: "reject",
          reason: "same-failure",
          evidence: [HASH],
        },
        HASH,
        store,
        NOW,
      );
    }
    expect(await reserveCoworkAttempt("loop", p, store, NOW)).toEqual({
      state: "stopped",
      reason: "repeated-signature",
    });
    expect(await readCoworkLoopHistory("loop", p, store)).toHaveLength(2);
  });
  it("supports bounded policy-specific attempts and exact deadlines", async () => {
    const store = new CoworkMemoryStore(),
      p = { ...policy(), repeatedSignatureLimit: 4 };
    for (let n = 1; n <= 3; n++) {
      const reserved = await reserveCoworkAttempt("loop", p, store, NOW);
      if (reserved.state !== "reserved")
        throw new Error("Expected reservation");
      await completeCoworkAttempt(
        reserved.record,
        {
          state: "reject",
          reason: "failed",
          evidence: [HASH],
        },
        HASH,
        store,
        NOW,
      );
    }
    expect((await reserveCoworkAttempt("loop", p, store, NOW)).state).toBe(
      "stopped",
    );
    expect(evaluateCoworkLoopBounds(p, [], p.deadline)).toEqual({
      state: "stopped",
      reason: "deadline",
    });
    expect(
      evaluateCoworkLoopBounds({ ...p, maxAttempts: 20 }, [], NOW).state,
    ).toBe("continue");
  });
  it("does not reset policy limits or an uncertain attempt on restart", async () => {
    const store = new CoworkMemoryStore(),
      p = policy();
    await reserveCoworkAttempt("loop", p, store, NOW);
    expect(await reserveCoworkAttempt("loop", p, store, NOW)).toEqual({
      state: "stopped",
      reason: "uncertain-attempt",
    });
    expect(
      await reserveCoworkAttempt("loop", { ...p, maxAttempts: 20 }, store, NOW),
    ).toEqual({ state: "stopped", reason: "policy-or-history-mismatch" });
  });
  it("records keep/reject proposals, targets, protected metric and human action list", async () => {
    const store = new CoworkMemoryStore(),
      p = policy();
    const reserved = await reserveCoworkAttempt("loop", p, store, NOW);
    if (reserved.state !== "reserved") throw new Error("Expected reservation");
    const done = await completeCoworkAttempt(
      reserved.record,
      {
        state: "keep",
        reason: "target-met",
        evidence: [HASH],
      },
      HASH,
      store,
      NOW,
    );
    expect(done).toMatchObject({
      target: p.target,
      protectedMetric: p.protectedMetric,
      humanActions: p.humanActions,
      state: "keep",
    });
    expect(await reserveCoworkAttempt("loop", p, store, NOW)).toEqual({
      state: "stopped",
      reason: "target-met",
    });
  });
});
