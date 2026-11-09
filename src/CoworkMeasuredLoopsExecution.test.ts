import { expect, it } from "vitest";
import {
  runCoworkEvidencePipeline,
  type CoworkEvidenceExecutionHost,
} from "./CoworkMeasuredLoopsExecution.js";
import { coworkDigest } from "./CoworkFactoryContract.js";
import {
  CoworkMemoryStore,
  BASE,
  HASH,
  REV,
  execution,
  policy,
} from "./CoworkFactoryTestSupport.js";

function input() {
  return {
    loopId: "functional",
    policy: {
      ...policy(),
      deadline: new Date(Date.now() + 60000).toISOString(),
    },
    project: "A",
    baselineRevision: BASE,
    candidateRevision: REV,
    artifact: HASH,
    author: { id: "author", family: "family-a" },
    contracts: { api: HASH },
    testIds: ["case-1"],
    assertionIds: ["changed-behavior", "protected"],
  };
}
function host(): CoworkEvidenceExecutionHost {
  return {
    async authorizeStage() {
      return true;
    },
    async executeStage(request) {
      return { state: "completed", artifact: coworkDigest(request) };
    },
    async attestStage() {
      return true;
    },
    async critic(request) {
      return {
        stage: request.stage,
        intent: request.intent,
        revision: request.revision,
        artifact: request.artifact,
        critic: { id: "critic", family: "family-b" },
        state: "passed",
        findings: [],
      };
    },
    async attestCritic() {
      return true;
    },
    async measure(request) {
      // A genuine negative control executed against independent fixture state.
      const fixture = { samples: [1, 2, 3], protected: "stable" };
      const changedBehavior =
        request.role === "baseline"
          ? (samples: number[]) => samples.length + 1
          : (samples: number[]) => samples.length;
      const targetPassed = changedBehavior(fixture.samples) === 3;
      const receipt = execution(request.role, request.repeat);
      return {
        ...receipt,
        fixtureId: request.fixtureId,
        observedAt: new Date().toISOString(),
        targetChecks: [{ name: "changed-behavior", passed: targetPassed }],
        protectedChecks: [
          { name: "protected", passed: fixture.protected === "stable" },
        ],
      };
    },
    async attestMeasurement(request, receipt) {
      return (
        receipt.fixtureId === request.fixtureId &&
        receipt.revision === request.revision
      );
    },
  };
}
it("executes fail-without/pass-with fixtures and critics at all six stages", async () => {
  const store = new CoworkMemoryStore(),
    h = host(),
    stages: string[] = [];
  const critic = h.critic;
  h.critic = async (request, signal) => {
    stages.push(request.stage);
    return critic(request, signal);
  };
  const result = await runCoworkEvidencePipeline(input(), { store, host: h });
  expect(result.state).toBe("keep");
  expect(stages).toEqual([
    "research",
    "design",
    "build",
    "verification",
    "review",
    "change-request-proposal",
  ]);
  expect(store.events).toHaveLength(2);
});
it.each([
  "same-family",
  "unattested",
  "wrong-intent",
  "blocking-finding",
] as const)(
  "blocks %s criticism without trusting a model echo",
  async (kind) => {
    const h = host(),
      critic = h.critic;
    h.critic = async (request, signal) => {
      const receipt = await critic(request, signal);
      if (kind === "same-family")
        Object.assign(receipt.critic, { family: "family-a" });
      if (kind === "wrong-intent") Object.assign(receipt, { intent: HASH });
      if (kind === "blocking-finding")
        Object.assign(receipt, { findings: ["must-fix"] });
      return receipt;
    };
    if (kind === "unattested") h.attestCritic = async () => false;
    expect(
      (
        await runCoworkEvidencePipeline(input(), {
          store: new CoworkMemoryStore(),
          host: h,
        })
      ).state,
    ).toBe("inconclusive");
  },
);
it("retains unknown stage effects and forbids restart redispatch", async () => {
  const h = host(),
    store = new CoworkMemoryStore(),
    i = input();
  let dispatched = 0;
  h.executeStage = async () => {
    dispatched++;
    return { state: "unknown", artifact: HASH };
  };
  expect((await runCoworkEvidencePipeline(i, { store, host: h })).state).toBe(
    "unknown",
  );
  expect(await runCoworkEvidencePipeline(i, { store, host: h })).toEqual({
    state: "stopped",
    reason: "uncertain-attempt",
  });
  expect(dispatched).toBe(1);
});
it("bounds a nonsettling host and retains unknown attempt", async () => {
  const h = host(),
    store = new CoworkMemoryStore();
  h.executeStage = () => new Promise(() => {});
  const before = Date.now();
  expect(
    (
      await runCoworkEvidencePipeline(input(), {
        store,
        host: h,
        timeoutMs: 10,
      })
    ).state,
  ).toBe("unknown");
  expect(Date.now() - before).toBeLessThan(1000);
});
it("requires host-measured execution provenance and nonzero scope", async () => {
  const h = host();
  h.attestMeasurement = async () => false;
  expect(
    (
      await runCoworkEvidencePipeline(input(), {
        store: new CoworkMemoryStore(),
        host: h,
      })
    ).state,
  ).toBe("unknown");
  expect(
    (
      await runCoworkEvidencePipeline(
        { ...input(), testIds: [] },
        {
          store: new CoworkMemoryStore(),
          host: host(),
        },
      )
    ).state,
  ).toBe("stopped");
});
