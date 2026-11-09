import { mkdirSync } from "node:fs";
import path from "node:path";
import { MultiProjectJournal } from "./MultiProjectJournal.js";
import {
  runMultiProjectOrchestrationPass,
  type MultiProjectHost,
} from "./MultiProjectOrchestrator.js";
import { parseOrchestrationCatalog, taskKey } from "./MultiProjectProtocol.js";
import { coworkDigest } from "./CoworkFactoryContract.js";
import { createCoworkOrchestrationFactory } from "./MultiProjectCoworkFactory.js";
import { createCoworkOrchestrationHost } from "./MultiProjectCoworkPolicy.js";
import { evaluateCoworkInstructions } from "./CoworkGovernance.js";
import {
  evaluateCoworkDependencies,
  type CoworkDependencyFile,
} from "./CoworkGovernanceDependencies.js";
import { runCoworkEvidencePipeline } from "./CoworkMeasuredLoopsExecution.js";
import { runCoworkQualityComparison } from "./CoworkMeasuredLoopsComparison.js";
import {
  createCoworkReleaseProvider,
  observeCoworkRelease,
} from "./CoworkFactoryRelease.js";
import { createCoworkNativeItemHost } from "./CoworkNativeItems.js";
import type { CoworkCriticStage } from "./CoworkReviewContract.js";

/**
 * Offline composed integration fixture, not a live framework, hub or telemetry run.
 * Only the SQLite journal and fixture directories are written.
 */
export async function runMultiProjectCoworkDemo(directory: string) {
  const root = path.resolve(directory);
  for (const id of ["api", "app", "docs"])
    mkdirSync(path.join(root, id), { recursive: true });
  const initial = "a".repeat(40),
    revision = "b".repeat(40);
  const previous = coworkDigest("contract-v1"),
    required = coworkDigest("contract-v2");
  const catalog = parseOrchestrationCatalog({
    id: "cowork-demo",
    projects: [
      {
        id: "api",
        mode: "integrated",
        repositoryRoot: path.join(root, "api"),
        hub: { kind: "github", repository: "fixture/api", pullRequest: 7 },
      },
      {
        id: "app",
        mode: "integrated",
        repositoryRoot: path.join(root, "app"),
        hub: {
          kind: "ado",
          organization: "fixture",
          project: "app",
          repository: "app",
          pullRequest: 8,
        },
      },
      {
        id: "docs",
        mode: "individual",
        repositoryRoot: path.join(root, "docs"),
        hub: { kind: "github", repository: "fixture/docs", pullRequest: 9 },
      },
    ],
    tasks: ["api", "docs"].map((projectId) => ({
      id: "one",
      projectId,
      title: `Fixture ${projectId}`,
      brief: "Offline scripted fixture; preserve protected behavior.",
      branch: `fixture/${projectId}`,
      baseBranch: "main",
      scopes: ["src"],
      acceptance: [{ label: "fixture", command: "fixture-only-contract-test" }],
      providesContracts: projectId === "api" ? ["api"] : [],
    })),
    maxConcurrency: 2,
    maxRounds: 30,
  });
  const journal = new MultiProjectJournal(
    path.join(root, "orchestration.sqlite"),
  );
  const sources = new Map(
    journal
      .states(catalog.id)
      .map((state) => [state.key, state.revision ?? initial]),
  );
  const source = (task: { projectId: string; id: string }) =>
    sources.get(taskKey(task)) ?? initial;
  const counters = {
    items: 0,
    pullRequests: 0,
    stageCritics: 0,
    reviewPasses: 0,
    measurements: 0,
    comparisons: 0,
    releaseReads: 0,
  };
  const stages: CoworkCriticStage[] = [
    "research",
    "design",
    "build",
    "verification",
    "review",
    "change-request-proposal",
  ];
  const policy = {
    routing: {
      framework: "devsquad" as const,
      requiredDiversity: true,
      unavailable: "block" as const,
      models: [
        {
          id: "fixture-critic",
          family: "fixture-family-b",
          stages,
          executor: {
            framework: "devsquad" as const,
            capabilityId: "fixture-only-devsquad-review",
            available: true,
          },
        },
      ],
    },
    maxAttempts: 3,
    repeatedSignatureLimit: 2,
  };
  const base: MultiProjectHost = {
    authorize: async () => true,
    execute: async (request) => {
      if (request.stage === "implement")
        sources.set(taskKey(request.task), revision);
      return {
        kind: "completed",
        artifact: `${request.stage}:${taskKey(request.task)}`,
        contracts: {},
        findings: [],
      };
    },
    resolveRevision: async (_project, task) => source(task),
    validate: async (request) => ({
      revision: source(request.task),
      evaluatedScope: 2,
      regressions: 0,
      checks: [{ name: "fixture", state: "passed" }],
      contracts: {
        ...request.contracts,
        ...(request.project.id === "api" ? { api: required } : {}),
      },
    }),
    observe: async (_project, task) => ({
      revision: source(task),
      policiesKnown: true,
      required: ["fixture-ci"],
      checks: [{ name: "fixture-ci", state: "passed" }],
      labels: [],
    }),
  };
  const reviewed = createCoworkOrchestrationHost({
    host: base,
    policy,
    classify: async () => ({
      author: { id: "fixture-author", family: "fixture-family-a" },
      risk: "ordinary",
      changedFiles: ["src/api.ts"],
    }),
    review: {
      authorizeReview: async () => true,
      attestReview: async () => true,
      verifyHumanApproval: async () => false,
      executeReview: async (request) => {
        counters.reviewPasses++;
        return {
          intent: request.context.intent,
          revision: request.context.revision,
          pass: request.pass,
          modelId: request.critic.id,
          evaluatedFiles: request.context.changedFiles,
          findings: [],
        };
      },
    },
    stage: {
      authorize: async () => true,
      attest: async () => true,
      execute: async (invocation) => {
        counters.stageCritics++;
        return {
          stage: invocation.request.stage,
          intent: invocation.request.intent,
          revision: invocation.request.revision,
          artifact: invocation.request.artifact,
          critic: invocation.critic,
          state: "passed",
          findings: [],
        };
      },
    },
    governance: {
      collect: async () => null,
      evaluate: async () => {
        const entry = {
          file: "src/AGENTS.md",
          scope: "src",
          version: 1,
          content: "Preserve protected assertions.",
          operation: "edit" as const,
        };
        const instructions = evaluateCoworkInstructions(
          {
            entries: [entry],
            negativeControl: [{ ...entry, content: "x".repeat(101) }],
          },
          {
            maxBytesPerFile: 100,
            maxTotalBytes: 200,
            maxEntries: 1,
            files: ["src/api.ts"],
            generatedFiles: [],
            previousVersions: {},
          },
        );
        const inventory: CoworkDependencyFile[] = [
          {
            file: "src/Contract.ts",
            source: "export interface API { value: string }",
            component: "api",
            role: "contract",
            governed: true,
          },
          {
            file: "src/Implementation.ts",
            source: "export const value = 1;",
            component: "api",
            role: "implementation",
            governed: true,
          },
        ];
        const dependencies = evaluateCoworkDependencies(inventory);
        const negative = evaluateCoworkDependencies([
          {
            ...inventory[0]!,
            source:
              "import './Implementation.js'; export interface API { value: string }",
          },
          inventory[1]!,
        ]);
        return {
          state:
            instructions.state === "passed" &&
            dependencies.state === "passed" &&
            negative.state === "failed"
              ? "passed"
              : "failed",
          evaluatedScope:
            instructions.evaluatedScope + dependencies.evaluatedScope,
          checks: [
            ...instructions.checks,
            ...dependencies.checks.map((check) => ({
              ...check,
              name: `dependency:${check.name}`,
            })),
            {
              name: "dependency-negative-control",
              state: negative.state === "failed" ? "passed" : "failed",
              evidence: negative.violations.map(
                (violation) => violation.identity,
              ),
            },
          ],
        };
      },
    },
  });
  const host = createCoworkOrchestrationFactory({
    base: reviewed,
    routes: [
      {
        mapping: {
          producer: "api",
          consumer: "app",
          contract: "api",
          consumedDigest: previous,
          target: {
            provider: "azure-devops",
            organization: "fixture",
            project: "app",
            workItemType: "Task",
          },
          rule: { id: "api-match", version: "1" },
          mappingDigest: coworkDigest("fixture-rule"),
        },
        scopes: ["src/client"],
        baseBranch: "main",
        acceptance: [
          { label: "fixture", command: "fixture-only-contract-test" },
        ],
      },
    ],
    impactHost: {
      verifyChange: async () => true,
      verifyMapping: async () => true,
    },
    inspectChange: async (_project, task, state) => ({
      project: "api",
      task: taskKey(task),
      change: "https://github.com/fixture/api/pull/7",
      revision: state.revision!,
      baseRevision: state.baseRevision!,
      observedAt: new Date().toISOString(),
      artifact: coworkDigest(state.artifacts),
      contracts: [{ name: "api", before: previous, after: required }],
      lineage: ["api"],
      depth: 0,
      budget: 4,
    }),
    itemHost: createCoworkNativeItemHost({
      authorize: async () => true,
      verifyEvidence: async () => true,
      audit: async () => true,
      verifyReceipt: async (proposal, receipt) =>
        receipt.intent === proposal.intent &&
        receipt.targetDigest === coworkDigest(proposal.candidate.target),
      transport: {
        request: async () => {
          counters.items++;
          return { id: 42 };
        },
      },
    }),
    authorizeRegistration: async () => true,
    observeSourceItem: async () => ({
      labels: [],
      evidence: "Fixture item labels",
    }),
    changeRequests: {
      authorize: async () => true,
      attest: async () => true,
      create: async (request, intent) => {
        counters.pullRequests++;
        return {
          state: "completed",
          receipt: {
            intent,
            revision: request.revision!,
            pullRequest: 17,
            url: "https://dev.azure.com/fixture/app/_git/app/pullrequest/17",
          },
        };
      },
    },
    validateTask: async (request, evidence, store, signal) => {
      const now = new Date().toISOString();
      const loopId = `fixture-${coworkDigest({ task: taskKey(request.task), revision: evidence.revision }).slice(0, 40)}`;
      const loopPolicy = {
        id: "fixture",
        version: "1",
        maxAttempts: 3,
        repeatedSignatureLimit: 2,
        deadline: new Date(Date.now() + 60000).toISOString(),
        target: "Match required contract",
        protectedMetric: "protected",
        humanActions: [
          "Configure real independent framework and measurement providers.",
        ],
      };
      const acceptance = await runCoworkEvidencePipeline(
        {
          loopId,
          policy: loopPolicy,
          project: request.project.id,
          baselineRevision: request.baseRevision!,
          candidateRevision: evidence.revision,
          artifact: previous,
          author: { id: "fixture-author", family: "fixture-family-a" },
          contracts: { api: required },
          testIds: ["contract-test"],
          assertionIds: ["contract", "protected"],
        },
        {
          store,
          signal,
          host: {
            authorizeStage: async () => true,
            attestStage: async () => true,
            attestCritic: async () => true,
            executeStage: async (stage) => ({
              state: "completed",
              artifact: coworkDigest(stage),
            }),
            critic: async (stage) => ({
              stage: stage.stage,
              intent: stage.intent,
              revision: stage.revision,
              artifact: stage.artifact,
              critic: { id: "fixture-critic", family: "fixture-family-b" },
              state: "passed",
              findings: [],
            }),
            attestMeasurement: async (input, receipt) =>
              input.fixtureId === receipt.fixtureId &&
              input.revision === receipt.revision,
            measure: async (input) => {
              counters.measurements++;
              const isolated = {
                consumedContract:
                  input.role === "baseline" ? previous : required,
                protected: true,
              };
              return {
                executionId: `${loopId}-${input.role}-${input.repeat}`,
                source: "fixture-runner",
                project: input.project,
                revision: input.revision,
                role: input.role,
                artifact: coworkDigest(isolated),
                observedAt: now,
                environment: previous,
                workload: required,
                fixtureId: input.fixtureId,
                isolated: true,
                testIds: [...input.testIds],
                assertionIds: [...input.assertionIds],
                evaluatedScope: 1,
                targetChecks: [
                  {
                    name: "contract",
                    passed: isolated.consumedContract === required,
                  },
                ],
                protectedChecks: [
                  { name: "protected", passed: isolated.protected },
                ],
                regressions: 0,
              };
            },
          },
        },
      );
      if (acceptance.state !== "keep")
        return {
          state: "blocked",
          revision: evidence.revision,
          evaluatedScope: 1,
          checks: [{ name: "negative-control", state: "failed" }],
          evidence: acceptance.reason,
        };
      const timing = {
        project: request.project.id,
        source: "fixture-ci",
        revision: request.baseRevision!,
        observedAt: now,
        artifact: previous,
        unit: "ms" as const,
        environment: previous,
        workload: required,
        testIds: ["contract-test"],
        assertionIds: ["contract", "protected"],
        behaviorDigest: required,
        evaluatedScope: 1,
        durations: [100, 100],
        checks: [{ name: "contract-test", passed: true }],
        protectedMetric: {
          name: "memory",
          unit: "bytes" as const,
          value: 100,
          direction: "lower" as const,
        },
      };
      const speed = await runCoworkQualityComparison(
        {
          loopId: `${loopId}-speed`,
          policy: {
            ...loopPolicy,
            target: "At least 5% faster",
            protectedMetric: "memory",
          },
          negativeControl: { loopId, attempt: 1 },
          comparison: {
            kind: "test-speed",
            baseline: timing,
            candidate: {
              ...timing,
              revision: evidence.revision,
              artifact: required,
              durations: [95, 95],
            },
            maxSpreadRatio: 0.05,
          },
          now,
          maxAgeMs: 60000,
        },
        {
          store,
          signal,
          host: {
            attestPipeline: async () => true,
            attestComparison: async () => true,
          },
        },
      );
      counters.comparisons++;
      const document = {
        project: request.project.id,
        source: "fixture-quality",
        revision: request.baseRevision!,
        observedAt: now,
        artifact: previous,
        benchmark: "fixed-docs",
        benchmarkVersion: "1",
        evaluator: "fixed-rubric",
        evaluatorVersion: "1",
        tasks: Array.from({ length: 10 }, (_, index) => ({
          id: `task-${index}`,
          output: previous,
          score: index + 1,
          hardChecks: [{ name: "links", passed: true }],
        })),
      };
      const quality = await runCoworkQualityComparison(
        {
          loopId: `${loopId}-docs`,
          policy: {
            ...loopPolicy,
            target: "Wins exceed losses with preserved tail and hard checks",
            protectedMetric: "bottom-decile",
          },
          negativeControl: { loopId, attempt: 1 },
          comparison: {
            kind: "document-quality",
            baseline: document,
            candidate: {
              ...document,
              revision: evidence.revision,
              artifact: required,
              tasks: document.tasks.map((task, index) => ({
                ...task,
                output: required,
                score: task.score + (index ? 1 : 0),
              })),
            },
          },
          now,
          maxAgeMs: 60000,
        },
        {
          store,
          signal,
          host: {
            attestPipeline: async () => true,
            attestComparison: async () => true,
          },
        },
      );
      counters.comparisons++;
      return {
        state:
          speed.state === "keep" && quality.state === "keep"
            ? "passed"
            : "blocked",
        revision: evidence.revision,
        evaluatedScope: 2,
        checks: [
          { name: "executed-negative-control", state: "passed" },
          {
            name: "test-speed-parity",
            state: speed.state === "keep" ? "passed" : "failed",
          },
          {
            name: "fixed-document-tail-hard-checks",
            state: quality.state === "keep" ? "passed" : "failed",
          },
        ],
        evidence: `Fixture-only measured pipeline and comparison: ${speed.reason}`,
      };
    },
    observeRelease: async (project, _task, state, store, signal) => {
      const now = new Date().toISOString();
      const observation = {
        provider:
          project.hub.kind === "github"
            ? ("github" as const)
            : ("azure-devops" as const),
        project: project.id,
        builds: [
          {
            id: "build-1",
            revision: state.revision!,
            state: "succeeded",
            artifact: "artifact-1",
            evidence: required,
          },
        ],
        artifacts: [
          {
            id: "artifact-1",
            build: "build-1",
            revisions: [state.revision!],
            evidence: required,
          },
        ],
        deployments: [
          {
            id: "deploy-1",
            build: "build-1",
            artifact: "artifact-1",
            ring: "first-production",
            environment: "production",
            deployedAt: now,
            state: "succeeded",
            evidence: required,
          },
        ],
        metrics: ["failures", "protected"].map((metric) => ({
          deployment: "deploy-1",
          evidence: {
            source: "fixture-release",
            project: project.id,
            revision: state.revision!,
            observedAt: now,
            metric,
            unit: "count",
            value: 0,
            evaluatedScope: 10,
            artifact: required,
            state: "known",
          },
        })),
      };
      const release = await observeCoworkRelease(
        {
          provider: observation.provider,
          project: project.id,
          mergedRevision: state.revision!,
          mergedAt: now,
          originatingCandidate: required,
          originatingRevision: state.baseRevision!,
          source: "fixture-release",
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
          signal,
          provider: createCoworkReleaseProvider(
            {
              read: async (query) => {
                counters.releaseReads++;
                return observation[query.resource];
              },
            },
            async () => true,
          ),
        },
      );
      return {
        state: release.state === "verified" ? "passed" : "blocked",
        revision: state.revision!,
        evaluatedScope: 10,
        checks: [
          {
            name: "read-only-first-ring",
            state: release.state === "verified" ? "passed" : "failed",
          },
        ],
        evidence:
          "Synthetic release data; no merge, deployment or live observation performed.",
      };
    },
  });
  try {
    const result = await runMultiProjectOrchestrationPass({
      catalog,
      journal,
      host,
    });
    return {
      ...result,
      mode: "fixture-only" as const,
      counters,
      eventCount: journal.events(catalog.id).length,
      hostEventCount: journal.hostEvents(catalog.id).length,
    };
  } finally {
    journal.close();
  }
}
