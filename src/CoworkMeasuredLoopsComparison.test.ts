import { expect, it } from "vitest";
import { runCoworkQualityComparison } from "./CoworkMeasuredLoopsComparison.js";
import {
  CoworkMemoryStore,
  BASE,
  HASH,
  NOW,
  REV,
  policy,
} from "./CoworkFactoryTestSupport.js";

it("does not accept model-told timing without a retained executed negative-control pipeline", async () => {
  const timing = {
    project: "A",
    source: "ci-main",
    revision: BASE,
    observedAt: NOW,
    artifact: HASH,
    unit: "ms" as const,
    environment: HASH,
    workload: HASH,
    testIds: ["case"],
    assertionIds: ["assertion"],
    behaviorDigest: HASH,
    evaluatedScope: 1,
    durations: [100, 100],
    checks: [{ name: "coverage", passed: true }],
    protectedMetric: {
      name: "memory",
      unit: "bytes" as const,
      value: 100,
      direction: "lower" as const,
    },
  };
  const result = await runCoworkQualityComparison(
    {
      loopId: "speed",
      policy: policy(),
      negativeControl: { loopId: "absent", attempt: 1 },
      comparison: {
        kind: "test-speed",
        baseline: timing,
        candidate: { ...timing, revision: REV, durations: [90, 90] },
        maxSpreadRatio: 0.05,
      },
      now: NOW,
      maxAgeMs: 60000,
    },
    {
      store: new CoworkMemoryStore(),
      host: {
        async attestPipeline() {
          throw new Error("must not call");
        },
        async attestComparison() {
          throw new Error("must not call");
        },
      },
    },
  );
  expect(result).toEqual({
    state: "stopped",
    reason: "executed-pipeline-or-comparison-unverified",
  });
});
