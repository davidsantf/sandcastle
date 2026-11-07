import { describe, expect, it } from "vitest";
import {
  coworkReleaseRecurrenceCandidate,
  createCoworkReleaseProvider,
  evaluateCoworkRelease,
  observeCoworkRelease,
  type CoworkReleaseObservation,
  type CoworkReleaseRegistration,
} from "./CoworkFactoryRelease.js";
import {
  CoworkMemoryStore,
  BASE,
  HASH,
  NOW,
  REV,
  rule,
} from "./CoworkFactoryTestSupport.js";

const registration = (): CoworkReleaseRegistration => ({
  project: "A",
  provider: "github",
  mergedRevision: REV,
  mergedAt: "2026-11-07T03:00:00.000Z",
  originatingCandidate: HASH,
  originatingRevision: BASE,
  source: "production-metrics",
  metric: "failures",
  unit: "count",
  direction: "at-most",
  target: 0,
  protectedMetric: "latency",
  protectedUnit: "ms",
  protectedDirection: "at-most",
  protectedTarget: 100,
  productionRings: ["prod-first", "prod-wide"],
  maxAgeMs: 60000,
  minEvaluatedScope: 10,
});
const observation = (): CoworkReleaseObservation => ({
  project: "A",
  provider: "github",
  builds: [
    {
      id: "build-7",
      revision: REV,
      state: "succeeded",
      artifact: "artifact-7",
      evidence: HASH,
    },
  ],
  artifacts: [
    { id: "artifact-7", build: "build-7", revisions: [REV], evidence: HASH },
  ],
  deployments: [
    {
      id: "release-7",
      build: "build-7",
      artifact: "artifact-7",
      ring: "prod-first",
      environment: "production",
      deployedAt: "2026-11-07T03:30:00.000Z",
      state: "succeeded",
      evidence: HASH,
    },
  ],
  metrics: ["failures", "latency"].map((metric) => ({
    deployment: "release-7",
    evidence: {
      source: "production-metrics",
      project: "A",
      revision: REV,
      observedAt: NOW,
      metric,
      unit: metric === "failures" ? ("count" as const) : ("ms" as const),
      value: metric === "failures" ? 0 : 100,
      evaluatedScope: 10,
      artifact: HASH,
      state: "known" as const,
    },
  })),
});
describe("read-only exact commit/release/first-ring correlation", () => {
  it.each(["github", "azure-devops"] as const)(
    "verifies normalized %s evidence locally",
    (provider) => {
      expect(
        evaluateCoworkRelease(
          { ...registration(), provider },
          { ...observation(), provider },
          NOW,
        ),
      ).toMatchObject({ state: "verified", deployment: "release-7" });
    },
  );
  it.each([
    "revision",
    "artifact-revision",
    "artifact-build",
    "later-ring",
    "test-ring",
    "missing-metric",
    "unknown-metric",
    "stale",
    "zero-scope",
    "pre-deploy",
  ] as const)("awaits %s provenance instead of claiming done", (kind) => {
    const o = observation();
    if (kind === "revision") o.builds[0]!.revision = BASE;
    if (kind === "artifact-revision") o.artifacts[0]!.revisions = [BASE];
    if (kind === "artifact-build") o.artifacts[0]!.build = "other-build";
    if (kind === "later-ring") o.deployments[0]!.ring = "prod-wide";
    if (kind === "test-ring") o.deployments[0]!.environment = "test";
    if (kind === "missing-metric") o.metrics = [];
    if (kind === "unknown-metric") o.metrics[0]!.evidence.state = "unknown";
    if (kind === "stale")
      o.metrics[0]!.evidence.observedAt = "2026-11-07T03:45:00.000Z";
    if (kind === "zero-scope") o.metrics[0]!.evidence.evaluatedScope = 1;
    if (kind === "pre-deploy")
      o.metrics[0]!.evidence.observedAt = "2026-11-07T03:29:00.000Z";
    expect(evaluateCoworkRelease(registration(), o, NOW).state).toBe(
      "awaiting-evidence",
    );
  });
  it("is inconclusive for conflicting metrics or protected regressions", () => {
    const o = observation();
    o.metrics.push(structuredClone(o.metrics[0]!));
    o.metrics[2]!.evidence.value = 4;
    expect(evaluateCoworkRelease(registration(), o, NOW).state).toBe(
      "inconclusive",
    );
    const p = observation();
    p.metrics[1]!.evidence.value = 101;
    expect(evaluateCoworkRelease(registration(), p, NOW).state).toBe(
      "inconclusive",
    );
  });
  it("selects first exact production-ring deployment rather than nearby unrelated records", () => {
    const o = observation();
    o.deployments.unshift({
      ...o.deployments[0]!,
      id: "unrelated",
      build: "absent",
      deployedAt: "2026-11-07T03:00:00.000Z",
    });
    expect(evaluateCoworkRelease(registration(), o, NOW).deployment).toBe(
      "release-7",
    );
  });
  it("resurfaces a missed objective with a stable deduplicated recurrence candidate", () => {
    const o = observation();
    o.metrics[0]!.evidence.value = 3;
    const result = evaluateCoworkRelease(registration(), o, NOW);
    expect(result.state).toBe("resurfaced");
    const recurrenceRule = {
      ...rule(),
      source: "production-metrics",
      kind: "release-recurrence" as const,
    };
    const c = coworkReleaseRecurrenceCandidate(
      registration(),
      result,
      recurrenceRule,
      NOW,
    )!;
    const next = structuredClone(o);
    next.metrics[0]!.evidence.value = 5;
    const c2 = coworkReleaseRecurrenceCandidate(
      registration(),
      evaluateCoworkRelease(registration(), next, NOW),
      recurrenceRule,
      NOW,
    )!;
    expect(c.key).toBe(c2.key);
    expect(c.evidence.revision).toBe(REV);
  });
  it("executes only injected read resources, independently attests and records outcome once", async () => {
    const o = observation(),
      calls: string[] = [],
      store = new CoworkMemoryStore();
    const provider = createCoworkReleaseProvider(
      {
        async read(request) {
          calls.push(request.resource);
          return o[request.resource];
        },
      },
      async () => true,
    );
    expect(
      (
        await observeCoworkRelease(registration(), {
          provider,
          store,
          now: NOW,
        })
      ).state,
    ).toBe("verified");
    expect(
      (
        await observeCoworkRelease(registration(), {
          provider,
          store,
          now: NOW,
        })
      ).state,
    ).toBe("verified");
    expect(calls).toEqual([
      "builds",
      "artifacts",
      "deployments",
      "metrics",
      "builds",
      "artifacts",
      "deployments",
      "metrics",
    ]);
    expect(store.events).toHaveLength(1);
  });
  it("blocks host-unattested provider claims", async () => {
    const provider = createCoworkReleaseProvider(
      {
        async read(request) {
          return observation()[request.resource];
        },
      },
      async () => false,
    );
    const store = new CoworkMemoryStore();
    expect(
      (
        await observeCoworkRelease(registration(), {
          provider,
          store,
          now: NOW,
        })
      ).state,
    ).toBe("blocked");
    expect(store.events).toHaveLength(0);
  });
  it("requires target and protected metrics from the same evaluated window", () => {
    const o = observation();
    o.metrics[1]!.evidence.evaluatedScope = 11;
    expect(evaluateCoworkRelease(registration(), o, NOW)).toMatchObject({
      state: "inconclusive",
      reason: "incomparable-protected-metric-window",
    });
  });
  it("durably intakes configured recurrence once across replay and changed metric values", async () => {
    const store = new CoworkMemoryStore(),
      o = observation();
    o.metrics[0]!.evidence.value = 3;
    const provider = createCoworkReleaseProvider(
      {
        async read(request) {
          return o[request.resource];
        },
      },
      async () => true,
    );
    const recurrenceRule = {
      ...rule(),
      source: "production-metrics",
      kind: "release-recurrence" as const,
    };
    const options = { provider, store, now: NOW, recurrenceRule };
    expect((await observeCoworkRelease(registration(), options)).state).toBe(
      "resurfaced",
    );
    o.metrics[0]!.evidence.value = 5;
    expect((await observeCoworkRelease(registration(), options)).state).toBe(
      "resurfaced",
    );
    expect(
      store.events.filter((event) => event.kind === "candidate"),
    ).toHaveLength(1);
    await expect(
      observeCoworkRelease(registration(), {
        ...options,
        recurrenceRule: { ...recurrenceRule, threshold: 10 },
      }),
    ).rejects.toThrow("Recurrence rule");
  });
});
