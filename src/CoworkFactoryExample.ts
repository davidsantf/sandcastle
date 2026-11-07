import {
  coworkDigest,
  type CoworkFactoryStore,
} from "./CoworkFactoryContract.js";
import {
  proposeCoworkItem,
  publishCoworkItem,
  type CoworkItemHost,
} from "./CoworkFactory.js";
import {
  coworkCompatibilityTask,
  evaluateCoworkImpact,
  persistCoworkImpact,
  type CoworkCompatibilityTask,
} from "./CoworkFactoryImpact.js";
import {
  runCoworkEvidencePipeline,
  type CoworkEvidenceExecutionHost,
} from "./CoworkMeasuredLoopsExecution.js";
import { runCoworkQualityComparison } from "./CoworkMeasuredLoopsComparison.js";
import {
  createCoworkReleaseProvider,
  observeCoworkRelease,
  type CoworkReleaseObservation,
} from "./CoworkFactoryRelease.js";

/** Explicit simulation: fake hubs, critics, workers and production evidence; zero network writes. */
export async function runCoworkFactoryLocalExample(store: CoworkFactoryStore) {
  const now = new Date().toISOString();
  const before = "1".repeat(64),
    after = "2".repeat(64);
  const baseRevision = "a".repeat(40),
    revision = "b".repeat(40);
  const writes: { provider: string; intent: string }[] = [];
  const impact = await evaluateCoworkImpact(
    {
      project: "producer",
      task: "producer-7",
      change: "https://example.invalid/producer/pull/7",
      revision,
      baseRevision,
      observedAt: now,
      artifact: before,
      contracts: [{ name: "api", before, after }],
      lineage: ["producer"],
      depth: 0,
      budget: 4,
    },
    [
      {
        producer: "producer",
        consumer: "consumer-github",
        contract: "api",
        consumedDigest: before,
        target: { provider: "github", repository: "example/consumer" },
        rule: { id: "api-match", version: "1" },
        mappingDigest: before,
      },
      {
        producer: "producer",
        consumer: "consumer-ado",
        contract: "api",
        consumedDigest: before,
        target: {
          provider: "azure-devops",
          organization: "example",
          project: "consumer",
          workItemType: "Task",
        },
        rule: { id: "api-match", version: "1" },
        mappingDigest: before,
      },
    ],
    {
      now,
      maxAgeMs: 60000,
      maxDepth: 3,
      host: {
        async verifyChange() {
          return true;
        },
        async verifyMapping() {
          return true;
        },
      },
    },
  );
  const candidates = await persistCoworkImpact(impact, store, now);
  const itemHost: CoworkItemHost = {
    async authorize() {
      return true;
    },
    async verifyEvidence() {
      return true;
    },
    async audit() {
      return true;
    },
    async create(item, intent) {
      writes.push({ provider: item.provider, intent });
      const target =
        item.provider === "github"
          ? { provider: item.provider, repository: item.repository }
          : {
              provider: item.provider,
              organization: item.organization,
              project: item.project,
              workItemType: item.workItemType,
            };
      return {
        state: "completed",
        receipt: {
          id: `example-${writes.length}`,
          url: `https://example.invalid/items/${writes.length}`,
          intent,
          targetDigest: coworkDigest(target),
        },
      };
    },
    async verifyReceipt(proposal, receipt) {
      return (
        receipt.intent === proposal.intent &&
        receipt.targetDigest === coworkDigest(proposal.candidate.target)
      );
    },
  };
  const tasks: CoworkCompatibilityTask[] = [];
  for (const candidate of candidates) {
    const proposal = proposeCoworkItem(candidate);
    const preview = await publishCoworkItem(proposal, {
      store,
      host: itemHost,
      now,
    });
    if (preview.state !== "preview")
      throw new Error("Simulation must preview first");
    const published = await publishCoworkItem(proposal, {
      store,
      host: itemHost,
      now,
      mode: "publish",
    });
    if (published.state !== "completed")
      throw new Error("Simulation publication did not complete");
    tasks.push(coworkCompatibilityTask(candidate, published));
  }
  const workerOutputs = tasks.map((task) => {
    // Each fixture is independent; no task or worktree is rewritten.
    const fixture = {
      consumedContract: before,
      protectedBehavior: "preserved",
    };
    const baselinePassed = fixture.consumedContract === task.contracts.api;
    const candidateFixture = { ...fixture, consumedContract: after };
    return {
      project: task.project,
      baselinePassed,
      candidatePassed: candidateFixture.consumedContract === task.contracts.api,
      protectedPassed: candidateFixture.protectedBehavior === "preserved",
    };
  });
  const host: CoworkEvidenceExecutionHost = {
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
        critic: { id: "fixture-critic", family: "fixture-family-b" },
        state: "passed",
        findings: [],
      };
    },
    async attestCritic() {
      return true;
    },
    async measure(request) {
      const fixture = {
        consumedContract: request.role === "baseline" ? before : after,
        protectedBehavior: "preserved",
      };
      return {
        executionId: `example-${request.role}-${request.repeat}`,
        source: "example-fixture-runner",
        project: "consumer-github",
        revision: request.revision,
        role: request.role,
        artifact: coworkDigest(fixture),
        observedAt: now,
        environment: before,
        workload: after,
        fixtureId: request.fixtureId,
        isolated: true,
        testIds: ["api-match"],
        assertionIds: ["contract", "protected"],
        evaluatedScope: 1,
        targetChecks: [
          { name: "contract", passed: fixture.consumedContract === after },
        ],
        protectedChecks: [
          {
            name: "protected",
            passed: fixture.protectedBehavior === "preserved",
          },
        ],
        regressions: 0,
      };
    },
    async attestMeasurement(request, receipt) {
      return (
        request.fixtureId === receipt.fixtureId &&
        request.revision === receipt.revision
      );
    },
  };
  const policy = {
    id: "example",
    version: "1",
    maxAttempts: 3,
    repeatedSignatureLimit: 2,
    deadline: new Date(Date.now() + 60000).toISOString(),
    target: "Match required api contract",
    protectedMetric: "protected",
    humanActions: ["Inspect fixture evidence before using a real host route."],
  };
  const acceptance = await runCoworkEvidencePipeline(
    {
      loopId: "example-functional",
      policy,
      project: "consumer-github",
      baselineRevision: baseRevision,
      candidateRevision: revision,
      artifact: before,
      author: { id: "fixture-author", family: "fixture-family-a" },
      contracts: { api: after },
      testIds: ["api-match"],
      assertionIds: ["contract", "protected"],
    },
    { store, host },
  );
  const timing = {
    project: "consumer-github",
    source: "example-ci",
    revision: baseRevision,
    observedAt: now,
    artifact: before,
    unit: "ms" as const,
    environment: before,
    workload: after,
    testIds: ["api-match"],
    assertionIds: ["contract", "protected"],
    behaviorDigest: after,
    evaluatedScope: 1,
    durations: [100, 100],
    checks: [{ name: "api-match", passed: true }],
    protectedMetric: {
      name: "memory",
      unit: "bytes" as const,
      value: 100,
      direction: "lower" as const,
    },
  };
  const speed = await runCoworkQualityComparison(
    {
      loopId: "example-speed",
      policy: {
        ...policy,
        target: "At least 5% faster",
        protectedMetric: "memory",
      },
      negativeControl: { loopId: "example-functional", attempt: 1 },
      comparison: {
        kind: "test-speed",
        baseline: timing,
        candidate: {
          ...timing,
          revision,
          artifact: after,
          durations: [95, 95],
        },
        maxSpreadRatio: 0.05,
      },
      now,
      maxAgeMs: 60000,
    },
    {
      store,
      host: {
        async attestPipeline() {
          return true;
        },
        async attestComparison() {
          return true;
        },
      },
    },
  );
  const document = {
    project: "consumer-github",
    source: "example-quality",
    revision: baseRevision,
    observedAt: now,
    artifact: before,
    benchmark: "fixed-docs",
    benchmarkVersion: "1",
    evaluator: "fixed-rubric",
    evaluatorVersion: "1",
    tasks: Array.from({ length: 10 }, (_, n) => ({
      id: `task-${n}`,
      output: before,
      score: n + 1,
      hardChecks: [{ name: "links", passed: true }],
    })),
  };
  const quality = await runCoworkQualityComparison(
    {
      loopId: "example-docs",
      policy: {
        ...policy,
        target: "Wins > losses; tail/hard checks preserved",
        protectedMetric: "bottom-decile",
      },
      negativeControl: { loopId: "example-functional", attempt: 1 },
      comparison: {
        kind: "document-quality",
        baseline: document,
        candidate: {
          ...document,
          revision,
          artifact: after,
          tasks: document.tasks.map((task, n) => ({
            ...task,
            output: after,
            score: task.score + (n ? 1 : 0),
          })),
        },
      },
      now,
      maxAgeMs: 60000,
    },
    {
      store,
      host: {
        async attestPipeline() {
          return true;
        },
        async attestComparison() {
          return true;
        },
      },
    },
  );
  const releaseEvidence: CoworkReleaseObservation = {
    provider: "github",
    project: "consumer-github",
    builds: [
      {
        id: "build-7",
        revision,
        state: "succeeded",
        artifact: "artifact-7",
        evidence: after,
      },
    ],
    artifacts: [
      {
        id: "artifact-7",
        build: "build-7",
        revisions: [revision],
        evidence: after,
      },
    ],
    deployments: [
      {
        id: "deployment-7",
        build: "build-7",
        artifact: "artifact-7",
        ring: "first-production",
        environment: "production",
        deployedAt: now,
        state: "succeeded",
        evidence: after,
      },
    ],
    metrics: ["failures", "protected"].map((metric) => ({
      deployment: "deployment-7",
      evidence: {
        source: "example-production",
        project: "consumer-github",
        revision,
        observedAt: now,
        metric,
        unit: "count",
        value: 0,
        evaluatedScope: 10,
        artifact: after,
        state: "known",
      },
    })),
  };
  const release = await observeCoworkRelease(
    {
      provider: "github",
      project: "consumer-github",
      mergedRevision: revision,
      mergedAt: now,
      originatingCandidate: candidates.find(
        (candidate) => candidate.project === "consumer-github",
      )!.key,
      originatingRevision: baseRevision,
      source: "example-production",
      metric: "failures",
      unit: "count",
      direction: "at-most",
      target: 0,
      protectedMetric: "protected",
      protectedUnit: "count",
      protectedDirection: "at-most",
      protectedTarget: 0,
      productionRings: ["first-production"],
      maxAgeMs: 60000,
      minEvaluatedScope: 10,
    },
    {
      store,
      now,
      provider: createCoworkReleaseProvider(
        {
          async read(request) {
            return releaseEvidence[request.resource];
          },
        },
        async () => true,
      ),
    },
  );
  return {
    mode: "fixture-only" as const,
    candidates,
    tasks,
    writes,
    workerOutputs,
    acceptance,
    speed,
    quality,
    release,
  };
}
