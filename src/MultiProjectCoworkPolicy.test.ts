import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CoworkReviewFinding,
  CoworkReviewPolicy,
  CoworkReviewRequest,
  CoworkStageCriticInvocation,
} from "./CoworkReviewContract.js";
import {
  createCoworkOrchestrationHost,
  type CoworkOrchestrationHostOptions,
} from "./MultiProjectCoworkPolicy.js";
import { MultiProjectJournal } from "./MultiProjectJournal.js";
import {
  runMultiProjectOrchestrationPass,
  type MultiProjectHost,
} from "./MultiProjectOrchestrator.js";
import {
  digest,
  parseOrchestrationCatalog,
  taskKey,
  type OrchestrationTask,
  type OrchestrationWorkerRequest,
} from "./MultiProjectProtocol.js";

const sha = "a".repeat(40);
const repaired = "b".repeat(40);
const signal = (): AbortSignal => new AbortController().signal;
const folders: string[] = [];
const journals: MultiProjectJournal[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const journal of journals.splice(0)) journal.close();
  for (const folder of folders.splice(0))
    rmSync(folder, { recursive: true, force: true });
});
const policy = (): CoworkReviewPolicy => ({
  maxAttempts: 3,
  repeatedSignatureLimit: 2,
  routing: {
    requiredDiversity: true,
    unavailable: "block",
    framework: "spec-kit",
    models: [
      {
        id: "independent-critic",
        family: "canonical-critic-family",
        stages: ["research", "design", "build", "verification", "review"],
        executor: {
          framework: "spec-kit",
          capabilityId: "fixture-executed-review",
          available: true,
        },
      },
    ],
  },
});
type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };
type FixtureOptions = Omit<
  Mutable<CoworkOrchestrationHostOptions>,
  "review" | "stage"
> & {
  review: Mutable<CoworkOrchestrationHostOptions["review"]>;
  stage: Mutable<CoworkOrchestrationHostOptions["stage"]>;
};

function fixture() {
  const folder = path.join(
    process.cwd(),
    `.cowork-policy-fixture-${randomUUID()}`,
  );
  mkdirSync(folder);
  folders.push(folder);
  const catalog = parseOrchestrationCatalog({
    id: "cowork",
    projects: ["api", "app", "docs"].map((id) => {
      const repositoryRoot = path.join(folder, id);
      mkdirSync(repositoryRoot);
      return {
        id,
        repositoryRoot,
        mode: id === "docs" ? "individual" : "integrated",
        hub: { kind: "github", repository: `fixture/${id}`, pullRequest: 1 },
      };
    }),
    tasks: ["api", "app", "docs"].map((projectId) => ({
      projectId,
      id: "one",
      title: projectId,
      brief: "accepted immutable brief",
      branch: "work/one",
      baseBranch: "main",
      scopes: ["src"],
      acceptance: [{ label: "unit", command: "independent-fixture-check" }],
      providesContracts: projectId === "api" ? ["api"] : [],
      dependsOn: projectId === "app" ? ["api:one"] : [],
      requiresContracts:
        projectId === "app" ? [{ task: "api:one", name: "api" }] : [],
    })),
    maxRounds: 30,
    invocationTimeoutMs: 1000,
  });
  let clock = 1000;
  const filename = path.join(folder, "orchestration.sqlite");
  const open = () => {
    const journal = new MultiProjectJournal(filename, () => clock);
    journals.push(journal);
    return journal;
  };
  const journal = open();
  const revisions = new Map(catalog.tasks.map((task) => [taskKey(task), sha]));
  const reviews: CoworkReviewRequest[] = [];
  const critics: CoworkStageCriticInvocation[] = [];
  const worker = vi.fn<MultiProjectHost["execute"]>(async (request) => ({
    kind: "completed",
    artifact: `actual-${request.stage}-${request.task.projectId}`,
    contracts: {},
    findings: [],
  }));
  const trusted: MultiProjectHost = {
    authorize: vi.fn(async () => true),
    execute: worker,
    resolveRevision: vi.fn(async (project, task) => {
      expect(project).toEqual(
        catalog.projects.find((entry) => entry.id === task.projectId),
      );
      return revisions.get(taskKey(task))!;
    }),
    validate: async (request) => ({
      revision: revisions.get(taskKey(request.task))!,
      evaluatedScope: 7,
      regressions: 0,
      checks: [
        {
          name: "unit",
          state: "passed",
          evidence: "fixture-negative-control-observed",
        },
      ],
      contracts: {
        ...request.contracts,
        ...Object.fromEntries(
          request.task.providesContracts.map((name) => [
            name,
            digest("real-fixture-contract"),
          ]),
        ),
      },
    }),
    observe: async (_, task) => ({
      revision: revisions.get(taskKey(task))!,
      policiesKnown: true,
      required: ["build"],
      checks: [
        { name: "build", state: "passed", evidence: "fixture-build-receipt" },
      ],
      labels: [],
    }),
  };
  const options: FixtureOptions = {
    host: trusted,
    policy: policy(),
    classify: vi.fn(async () => ({
      author: { id: "actual-author", family: "canonical-author-family" },
      risk: "ordinary" as const,
      changedFiles: ["src/main.ts"],
    })),
    review: {
      authorizeReview: vi.fn(async () => true),
      executeReview: vi.fn(async (request) => {
        reviews.push(request);
        return {
          intent: request.context.intent,
          revision: request.context.revision,
          pass: request.pass,
          modelId: request.critic.id,
          evaluatedFiles: [...request.context.changedFiles],
          findings: [],
        };
      }),
      attestReview: vi.fn(async () => true),
      verifyHumanApproval: vi.fn(async () => false),
    },
    stage: {
      authorize: vi.fn(async () => true),
      execute: vi.fn(async (invocation) => {
        critics.push(invocation);
        return {
          stage: invocation.request.stage,
          intent: invocation.request.intent,
          revision: invocation.request.revision,
          artifact: invocation.request.artifact,
          critic: invocation.critic,
          state: "passed" as const,
          findings: [],
        };
      }),
      attest: vi.fn(async () => true),
    },
  };
  const request = (
    stage: OrchestrationWorkerRequest["stage"] = "review",
    task: OrchestrationTask = catalog.tasks[0]!,
    invocation = randomUUID(),
  ): OrchestrationWorkerRequest => ({
    invocation,
    intent: digest({ invocation, stage }),
    stage,
    project: {
      id: task.projectId,
      repositoryRoot: catalog.projects.find(
        (entry) => entry.id === task.projectId,
      )!.repositoryRoot,
    },
    task,
    artifacts: {
      implement: "actual producer artifact",
      verify: "actual acceptance artifact",
    },
    contracts:
      task.projectId === "app"
        ? { "api:one:api": digest("real-fixture-contract") }
        : {},
    revision: revisions.get(taskKey(task))!,
    baseRevision: sha,
    failures: [],
  });
  const bind = (
    host = createCoworkOrchestrationHost(options),
    store = journal,
  ) => {
    const lease = store.claim(30000);
    store.initialize(catalog, lease);
    return {
      host: host.bindRun!({ runId: catalog.id, journal: store, lease }),
      lease,
    };
  };
  const records = (store = journal) =>
    store
      .hostEvents(catalog.id)
      .filter((event) => event.key.startsWith("cowork-policy:"));
  return {
    folder,
    catalog,
    journal,
    open,
    revisions,
    options,
    worker,
    trusted,
    reviews,
    critics,
    request,
    bind,
    records,
    advance: () => {
      clock += 40000;
    },
  };
}

const blocker: CoworkReviewFinding = {
  category: "correctness",
  signature: "actual-bug",
  evidence: "fixture/negative-control",
};
const advisory: CoworkReviewFinding = {
  category: "advisory",
  signature: "style",
  evidence: "fixture/style",
};
function findings(
  f: ReturnType<typeof fixture>,
  values: CoworkReviewFinding[],
) {
  f.options.review.executeReview = vi.fn(async (request) => {
    f.reviews.push(request);
    return {
      intent: request.context.intent,
      revision: request.context.revision,
      pass: request.pass,
      modelId: request.critic.id,
      evaluatedFiles: [...request.context.changedFiles],
      findings: values,
    };
  });
}

describe("concrete cowork core integration (fixture-only independent executors)", () => {
  it("keeps issue-backed planning, registered-PR verification and review on one immutable task identity", async () => {
    const f = fixture();
    const task = f.catalog.tasks[2]!;
    task.sourceItem = {
      provider: "github",
      id: "42",
      url: "https://github.com/fixture/docs/issues/42",
      cause: {
        recordKey: `factory:${digest("fixture-accepted-issue")}`,
        recordVersion: 2,
        recordDigest: digest("fixture-issue-proposal"),
      },
    };
    f.options.classify = async () => ({
      author: { id: "actual-author", family: "canonical-author-family" },
      risk: "critical",
      changedFiles: ["src/main.ts"],
    });
    f.options.review.verifyHumanApproval = vi.fn(async () => true);
    const phaseRequests: OrchestrationWorkerRequest[] = [];
    const execute = f.options.stage.execute;
    f.options.stage.execute = async (invocation, s, producer) => {
      phaseRequests.push(producer.request);
      return execute(invocation, s, producer);
    };
    const policyHost = createCoworkOrchestrationHost(f.options);
    const register = vi.fn<
      NonNullable<MultiProjectHost["registerChangeRequest"]>
    >(async (request) => {
      expect(request.task.pullRequest).toBeUndefined();
      expect(request.task.sourceItem).toEqual(task.sourceItem);
      return {
        state: "registered",
        pullRequest: 73,
        revision: sha,
        evidence: "fixture/independent-PR-registration",
      };
    });
    // Mirrors the parent's separate outer factory pipeline without changing its implementation.
    const host: MultiProjectHost = {
      ...policyHost,
      bindRun(context) {
        return {
          ...policyHost.bindRun!(context),
          observeSourceItem: async () => ({
            labels: [],
            evidence: "fixture/issue-labels",
          }),
          registerChangeRequest: register,
        };
      },
    };
    const result = await runMultiProjectOrchestrationPass({
      catalog: { ...f.catalog, tasks: [task] },
      journal: f.journal,
      host,
    });
    expect(result.status, JSON.stringify(result.tasks)).toBe("completed");
    expect(register).toHaveBeenCalledTimes(1);
    expect(
      phaseRequests.find((request) => request.stage === "plan")!.task
        .pullRequest,
    ).toBeUndefined();
    expect(
      phaseRequests.find((request) => request.stage === "verify")!.task
        .pullRequest,
    ).toBe(73);
    expect(
      new Set([
        ...f.critics.map((invocation) => invocation.request.intent),
        ...f.reviews.map((request) => request.context.intent),
      ]).size,
    ).toBe(1);
    expect(f.reviews).toHaveLength(6);
    const reviewAuthorizations = vi.mocked(f.options.review.authorizeReview)
      .mock.calls;
    expect(
      reviewAuthorizations.every(
        ([invocation, , request]) =>
          request.task.pullRequest === 73 &&
          request.task.sourceItem?.id === "42" &&
          invocation.context.artifacts["host-request"] === request.intent,
      ),
    ).toBe(true);
    const approvals = vi.mocked(f.options.review.verifyHumanApproval).mock
      .calls;
    expect(
      approvals.some(
        ([, , , request]) => request.task.pullRequest === undefined,
      ),
    ).toBe(true);
    expect(
      approvals.some(([, , , request]) => request.task.pullRequest === 73),
    ).toBe(true);
    expect(task.pullRequest).toBeUndefined();
    expect(
      f.journal.catalog(f.catalog.id).tasks[0]!.pullRequest,
    ).toBeUndefined();
    expect(f.journal.states(f.catalog.id)[0]!.pullRequest).toBe(73);
    const final = f.records().at(-1)!.value;
    expect(final).toMatchObject({
      history: [{ attempt: 1 }],
      invocations: expect.any(Array),
    });
    expect(JSON.stringify(final)).toContain('"pullRequest":73');
  });

  it("rejects a forged or omitted effective PR and any other dynamic immutable-task mutation", async () => {
    const f = fixture();
    const task = f.catalog.tasks[2]!;
    task.sourceItem = {
      provider: "github",
      id: "42",
      url: "https://github.com/fixture/docs/issues/42",
      cause: {
        recordKey: `factory:${digest("fixture-issue")}`,
        recordVersion: 2,
        recordDigest: digest("fixture-accepted-issue"),
      },
    };
    const bound = f.bind();
    expect(
      await bound.host.assessPhase!(
        f.request("plan", task),
        {
          kind: "completed",
          artifact: "accepted-issue-plan",
          contracts: {},
          findings: [],
        },
        sha,
        signal(),
      ),
    ).toMatchObject({ state: "passed" });
    const previous = f.journal
      .states(f.catalog.id)
      .find((state) => state.key === taskKey(task))!;
    f.journal.checkpoint(
      f.catalog.id,
      bound.lease,
      previous,
      {
        ...previous,
        pullRequest: 73,
        changeRequestEvidence: "fixture/registered-PR",
      },
      randomUUID(),
      "change-request-registered",
    );
    const before = f.records().length;
    for (const effective of [
      { ...task, pullRequest: 74 },
      task,
      { ...task, pullRequest: 73, brief: "forged accepted task" },
    ]) {
      expect(
        await bound.host.execute(f.request("review", effective), signal()),
      ).toMatchObject({ kind: "unknown" });
    }
    expect(f.options.review.executeReview).not.toHaveBeenCalled();
    expect(f.options.classify).toHaveBeenCalledTimes(1);
    expect(f.records()).toHaveLength(before);
    expect(
      f.journal
        .catalog(f.catalog.id)
        .tasks.find((entry) => taskKey(entry) === taskKey(task))!.pullRequest,
    ).toBeUndefined();
  });

  it("runs the real core across independent and contract-integrated tasks with exact context and measured verification", async () => {
    const f = fixture();
    const host = createCoworkOrchestrationHost(f.options);
    const result = await runMultiProjectOrchestrationPass({
      catalog: f.catalog,
      journal: f.journal,
      host,
    });
    expect(
      result.status,
      JSON.stringify(
        result.tasks.map(({ key, status, reason }) => ({
          key,
          status,
          reason,
        })),
      ),
    ).toBe("completed");
    expect(result.tasks).toHaveLength(3);
    expect(result.tasks.every((task) => task.status === "completed")).toBe(
      true,
    );
    expect(f.reviews).toHaveLength(18);
    const app = f.reviews.find(
      (request) => request.context.projectId === "app",
    )!;
    expect(app.context.taskId).toBe("one");
    expect(app.context.contracts).toEqual({
      "api:one:api": digest("real-fixture-contract"),
    });
    expect(
      f.reviews.find((request) => request.context.projectId === "docs")!.context
        .contracts,
    ).toEqual({});
    expect(
      f.reviews.every((request) => request.executor.framework === "spec-kit"),
    ).toBe(true);
    expect(f.critics.map((entry) => entry.request.stage)).toEqual(
      expect.arrayContaining(["research", "design", "build", "verification"]),
    );
    const verification = f
      .records()
      .filter(
        (event) =>
          event.event &&
          JSON.stringify(event.value).includes('"evaluatedScope":7'),
      )
      .at(-1);
    expect(verification).toBeDefined();
    expect(
      f.worker.mock.calls.every(([request]) => request.stage !== "review"),
    ).toBe(true);
  });

  it("makes an empty-findings authorization block needs-input, never green or repair", async () => {
    const f = fixture();
    f.options.review.authorizeReview = vi.fn(async () => false);
    const result = await runMultiProjectOrchestrationPass({
      catalog: f.catalog,
      journal: f.journal,
      host: createCoworkOrchestrationHost(f.options),
    });
    expect(result.status).toBe("needs-input");
    expect(result.tasks.every((task) => task.attempts === 0)).toBe(true);
    expect(
      result.tasks.some((task) => task.reason?.includes("policy-denied")),
    ).toBe(true);
    expect(f.options.review.executeReview).not.toHaveBeenCalled();
  });

  it("maps only attested blocking findings into core repair, with canonical category/signature/evidence", async () => {
    const f = fixture();
    findings(f, [blocker, advisory]);
    const bound = f.bind();
    const receipt = await bound.host.execute(f.request(), signal());
    expect(receipt).toMatchObject({
      kind: "completed",
      findings: ["correctness:actual-bug evidence:fixture/negative-control"],
    });
    if (receipt.kind !== "completed") throw new Error("missing fixture review");
    expect(receipt.artifact).toContain('"category":"advisory"');
    expect(receipt.artifact).toContain("review-attestation");
    expect(receipt.artifact).toContain("review-audit");
    expect(f.options.review.attestReview).toHaveBeenCalledTimes(1);
  });

  it("advisory findings survive full audit/artifact but do not block", async () => {
    const f = fixture();
    findings(f, [advisory]);
    const receipt = await f.bind().host.execute(f.request(), signal());
    expect(receipt).toMatchObject({ kind: "completed", findings: [] });
    expect(f.reviews).toHaveLength(6);
    if (receipt.kind === "completed")
      expect(receipt.artifact).toContain('"category":"advisory"');
  });

  it("requires critical human approval for the exact dynamic invocation context", async () => {
    const f = fixture();
    f.options.classify = async () => ({
      author: { id: "actual-author", family: "canonical-author-family" },
      risk: "critical",
      changedFiles: ["src/main.ts"],
    });
    const bound = f.bind();
    const request = f.request();
    expect(await bound.host.execute(request, signal())).toMatchObject({
      kind: "failed",
      evidence: "critical-human-gate",
    });
    expect(f.options.review.verifyHumanApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        artifacts: expect.objectContaining({ "host-request": request.intent }),
      }),
      [{ id: "independent-critic", family: "canonical-critic-family" }],
      expect.any(AbortSignal),
      request,
    );
  });

  it("cannot manufacture authority from a receipt or unverified identity", async () => {
    const f = fixture();
    f.options.review.attestReview = vi.fn(async () => false);
    findings(f, [blocker]);
    expect(await f.bind().host.execute(f.request(), signal())).toMatchObject({
      kind: "unknown",
    });
    expect(JSON.stringify(f.records().at(-1)?.value)).toContain(
      '"attested":false',
    );
    expect(JSON.stringify(f.records().at(-1)?.value)).toContain(
      '"status":"unknown"',
    );
  });

  it("rejects receipt-injected authorization fields rather than trusting callback prose", async () => {
    const f = fixture();
    f.options.review.executeReview = async (request) => ({
      intent: request.context.intent,
      revision: request.context.revision,
      pass: request.pass,
      modelId: request.critic.id,
      evaluatedFiles: [...request.context.changedFiles],
      findings: [],
      authorized: true,
    });
    expect(await f.bind().host.execute(f.request(), signal())).toMatchObject({
      kind: "unknown",
    });
    expect(f.options.review.attestReview).not.toHaveBeenCalled();
    expect(
      f
        .records()
        .some((event) =>
          JSON.stringify(event.value).includes('"authorized":true'),
        ),
    ).toBe(true);
  });

  it("has neither framework fallback nor alias-family diversity fallback", async () => {
    const f = fixture();
    f.options.policy = {
      ...policy(),
      routing: { ...policy().routing, framework: "devsquad" },
    };
    expect(await f.bind().host.execute(f.request(), signal())).toMatchObject({
      kind: "failed",
      evidence: "critic-diversity-unavailable",
    });
    expect(f.options.review.executeReview).not.toHaveBeenCalled();
    const g = fixture();
    g.options.classify = async () => ({
      author: {
        id: "different-model-alias",
        family: "canonical-critic-family",
      },
      risk: "ordinary",
      changedFiles: ["src/main.ts"],
    });
    expect(await g.bind().host.execute(g.request(), signal())).toMatchObject({
      kind: "failed",
    });
    expect(g.options.review.executeReview).not.toHaveBeenCalled();
  });

  it("rejects invalid independent context without empty-findings success", async () => {
    const f = fixture();
    const request = f.request();
    request.contracts = { "api:one:api": "not-a-digest" };
    expect(await f.bind().host.execute(request, signal())).toMatchObject({
      kind: "failed",
      evidence: "invalid-input",
    });
    expect(f.options.review.executeReview).not.toHaveBeenCalled();
  });

  it("preserves stable contiguous history across repaired revisions and core bounded repair", async () => {
    const f = fixture();
    let first = true;
    f.options.review.executeReview = async (request) => {
      f.reviews.push(request);
      const current = first ? [blocker] : [];
      if (first) first = false;
      return {
        intent: request.context.intent,
        revision: request.context.revision,
        pass: request.pass,
        modelId: request.critic.id,
        evaluatedFiles: [...request.context.changedFiles],
        findings: current,
      };
    };
    f.trusted.execute = async (request) => {
      if (request.stage === "fix")
        f.revisions.set(taskKey(request.task), repaired);
      return {
        kind: "completed",
        artifact: `real-${request.stage}-${f.revisions.get(taskKey(request.task))}`,
        contracts: {},
        findings: [],
      };
    };
    const result = await runMultiProjectOrchestrationPass({
      catalog: f.catalog,
      journal: f.journal,
      host: createCoworkOrchestrationHost(f.options),
    });
    expect(
      result.status,
      JSON.stringify(
        result.tasks.map(({ key, status, reason }) => ({
          key,
          status,
          reason,
        })),
      ),
    ).toBe("completed");
    const apiReviews = f.reviews.filter(
      (request) => request.context.projectId === "api",
    );
    expect(
      new Set(apiReviews.map((request) => request.context.intent)).size,
    ).toBe(1);
    expect(apiReviews.map((request) => request.attempt)).toEqual([
      1, 2, 2, 2, 2, 2, 2,
    ]);
    expect(apiReviews[0]!.context.revision).toBe(sha);
    expect(apiReviews.at(-1)!.context.revision).toBe(repaired);
    expect(
      new Set(
        apiReviews.map((request) => request.context.artifacts["host-request"]),
      ).size,
    ).toBe(2);
    const last = f
      .records()
      .filter((event) =>
        JSON.stringify(event.value).includes('"projectId":"api"'),
      )
      .at(-1)!;
    expect(last.value).toMatchObject({
      history: [
        { attempt: 1, revision: sha, blockingSignature: expect.any(String) },
        { attempt: 2, revision: repaired, blockingSignature: null },
      ],
    });
  });

  it("stops repeated canonical blockers and retains every terminal audit", async () => {
    const f = fixture();
    findings(f, [blocker]);
    const bound = f.bind();
    expect(await bound.host.execute(f.request(), signal())).toMatchObject({
      kind: "completed",
    });
    f.revisions.set("api:one", repaired);
    expect(await bound.host.execute(f.request(), signal())).toMatchObject({
      kind: "failed",
      evidence: "repeated-findings",
    });
    expect(f.records().at(-1)?.value).toMatchObject({
      history: [
        { attempt: 1, revision: sha },
        { attempt: 2, revision: repaired },
      ],
      invocations: [
        { status: "completed", result: { state: "blocked" } },
        { status: "completed", result: { state: "stopped" } },
      ],
    });
  });
});

describe("same-database fenced durable policy reservations", () => {
  it("persists each unverified receipt and attestation before the next external pass", async () => {
    const f = fixture();
    const execute = f.options.review.executeReview;
    f.options.review.executeReview = async (request, s, coreRequest) => {
      const last = JSON.stringify(f.records().at(-1)?.value);
      expect(last).toContain('"status":"reserved"');
      expect(last).toContain(`"pass":"${request.pass}"`);
      if (request.pass !== "fast") {
        expect(last).toContain("unverified-review-receipt");
        expect(last).toContain("review-attestation");
      }
      return execute(request, s, coreRequest);
    };
    expect(await f.bind().host.execute(f.request(), signal())).toMatchObject({
      kind: "completed",
    });
    const events = f.records();
    expect(events[0]?.value).toMatchObject({
      history: [{ attempt: 1 }],
      invocations: [{ status: "reserved", attempt: 1 }],
    });
    expect(events.at(-1)?.value).toMatchObject({
      history: [{ attempt: 1 }],
      invocations: [{ status: "completed" }],
    });
    expect(events.every((event, index) => event.version === index + 1)).toBe(
      true,
    );
    expect(f.journal.readHostRecord(events[0]!.key).value).toEqual(
      events.at(-1)!.value,
    );
  });

  it("injects reserve CAS failure without allocating history or dispatching externally", async () => {
    const f = fixture();
    const bound = f.bind();
    vi.spyOn(f.journal, "compareAndSwapHostRecord").mockReturnValueOnce(false);
    expect(await bound.host.execute(f.request(), signal())).toMatchObject({
      kind: "unknown",
    });
    expect(f.options.review.executeReview).not.toHaveBeenCalled();
    expect(f.records()).toHaveLength(0);
  });

  it("keeps receipt/history/reservation atomic when outcome CAS fails and refuses a new attempt", async () => {
    const f = fixture();
    const bound = f.bind();
    const original = f.journal.compareAndSwapHostRecord.bind(f.journal);
    vi.spyOn(f.journal, "compareAndSwapHostRecord").mockImplementation(
      (...args) =>
        JSON.stringify(args[5]).includes('"kind":"outcome"')
          ? false
          : original(...args),
    );
    expect(await bound.host.execute(f.request(), signal())).toMatchObject({
      kind: "unknown",
    });
    const last = f.records().at(-1)!;
    expect(last.value).toMatchObject({
      history: [{ attempt: 1 }],
      invocations: [{ status: "reserved" }],
    });
    expect(JSON.stringify(last.value)).toContain("review-audit");
    expect(await bound.host.execute(f.request(), signal())).toMatchObject({
      kind: "unknown",
    });
    expect(f.options.review.executeReview).toHaveBeenCalledTimes(6);
  });

  it("retains unknown timeout reservations across restart, never redispatches", async () => {
    const f = fixture();
    f.options.review.executeReview = vi.fn(async () => {
      throw new Error("fixture external timeout");
    });
    const bound = f.bind();
    expect(await bound.host.execute(f.request(), signal())).toMatchObject({
      kind: "unknown",
    });
    f.journal.release(bound.lease);
    const reopened = f.open();
    const next = f.bind(createCoworkOrchestrationHost(f.options), reopened);
    expect(await next.host.execute(f.request(), signal())).toMatchObject({
      kind: "unknown",
    });
    expect(f.options.review.executeReview).toHaveBeenCalledTimes(1);
    expect(f.records(reopened).at(-1)?.value).toMatchObject({
      history: [{ attempt: 1 }],
      invocations: [{ status: "unknown" }],
    });
  });

  it("a real core deadline retains the external reservation and a resumed pass does not retry", async () => {
    const f = fixture();
    f.options.review.executeReview = vi.fn(
      async () => new Promise<never>(() => {}),
    );
    const host = createCoworkOrchestrationHost(f.options);
    const first = await runMultiProjectOrchestrationPass({
      catalog: f.catalog,
      journal: f.journal,
      host,
    });
    expect(first.tasks.some((task) => task.status === "unknown")).toBe(true);
    const calls = vi.mocked(f.options.review.executeReview).mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    expect(JSON.stringify(f.records().at(-1)?.value)).toContain(
      '"status":"reserved"',
    );
    const next = await runMultiProjectOrchestrationPass({
      catalog: f.catalog,
      journal: f.journal,
      host,
    });
    expect(next.dispatched).toBe(0);
    expect(f.options.review.executeReview).toHaveBeenCalledTimes(calls);
  });

  it("keeps an aborted dispatch reserved and refuses retry", async () => {
    const f = fixture();
    const controller = new AbortController();
    f.options.review.executeReview = vi.fn(async () => {
      controller.abort();
      throw new Error("aborted fixture");
    });
    const bound = f.bind();
    expect(
      await bound.host.execute(f.request(), controller.signal),
    ).toMatchObject({ kind: "unknown" });
    expect(f.records().at(-1)?.value).toMatchObject({
      invocations: [{ status: "reserved" }],
    });
    expect(await bound.host.execute(f.request(), signal())).toMatchObject({
      kind: "unknown",
    });
    expect(f.options.review.executeReview).toHaveBeenCalledTimes(1);
  });

  it("a late old callback cannot write through a later bind or a mutated supplied lease", async () => {
    const f = fixture();
    let deliver: (() => void) | undefined;
    f.options.review.executeReview = vi.fn(async (request) => {
      await new Promise<void>((resolve) => {
        deliver = resolve;
      });
      return {
        intent: request.context.intent,
        revision: request.context.revision,
        pass: request.pass,
        modelId: request.critic.id,
        evaluatedFiles: [...request.context.changedFiles],
        findings: [],
      };
    });
    const host = createCoworkOrchestrationHost(f.options);
    const old = f.bind(host);
    const pending = old.host.execute(f.request(), signal());
    await vi.waitFor(() => expect(deliver).toBeDefined());
    const before = f.records().length;
    f.advance();
    const next = f.bind(host);
    old.lease.owner = next.lease.owner;
    old.lease.fence = next.lease.fence;
    deliver!();
    expect(await pending).toMatchObject({ kind: "unknown" });
    expect(f.records()).toHaveLength(before);
    expect(await next.host.execute(f.request(), signal())).toMatchObject({
      kind: "unknown",
    });
    expect(f.options.review.executeReview).toHaveBeenCalledTimes(1);
  });

  it("blocks completed exact replay instead of treating cached evidence as fresh authority", async () => {
    const f = fixture();
    const bound = f.bind();
    const request = f.request();
    expect(await bound.host.execute(request, signal())).toMatchObject({
      kind: "completed",
    });
    expect(await bound.host.execute(request, signal())).toMatchObject({
      kind: "unknown",
    });
    expect(f.options.review.executeReview).toHaveBeenCalledTimes(6);
    expect(f.records().at(-1)?.value).toMatchObject({
      history: [{ attempt: 1 }],
    });
  });

  it("snapshots routing and refuses changed accepted policy instead of silently resetting scope", async () => {
    const f = fixture();
    const original = policy();
    f.options.policy = original;
    const host = createCoworkOrchestrationHost(f.options);
    const bound = f.bind(host);
    (original.routing.models[0]!.executor as { available: boolean }).available =
      false;
    expect(await bound.host.execute(f.request(), signal())).toMatchObject({
      kind: "completed",
    });
    f.journal.release(bound.lease);
    f.options.policy = { ...policy(), repeatedSignatureLimit: 3 };
    const changed = f.bind(createCoworkOrchestrationHost(f.options));
    expect(await changed.host.execute(f.request(), signal())).toMatchObject({
      kind: "unknown",
    });
    expect(f.options.review.executeReview).toHaveBeenCalledTimes(6);
  });

  it("validates unknown projection shape and contiguous history rather than casting persisted JSON", async () => {
    const f = fixture();
    const bound = f.bind();
    const request = f.request();
    const key = `cowork-policy:${digest({ run: f.catalog.id, task: taskKey(request.task) })}`;
    expect(
      f.journal.compareAndSwapHostRecord(
        f.catalog.id,
        bound.lease,
        key,
        0,
        {
          schema: 1,
          scope: key.split(":")[1],
          definition: digest("fake"),
          history: [{ attempt: 7 }],
          invocations: [],
        },
        { kind: "fixture-malformed-projection" },
      ),
    ).toBe(true);
    expect(await bound.host.execute(request, signal())).toMatchObject({
      kind: "unknown",
    });
    expect(f.options.review.executeReview).not.toHaveBeenCalled();
  });
});

describe("post-producer stage gates and applicable governance", () => {
  it("retains original implementation artifact and independent source before critic; parent checkpoints it too", async () => {
    const f = fixture();
    const catalog = { ...f.catalog, tasks: [f.catalog.tasks[2]!] };
    f.trusted.execute = async (request) => {
      if (request.stage === "implement")
        f.revisions.set(taskKey(request.task), repaired);
      return {
        kind: "completed",
        artifact: `actual-${request.stage}`,
        contracts: {},
        findings: [],
      };
    };
    const execute = f.options.stage.execute;
    f.options.stage.execute = async (invocation, s, producer) => {
      if (invocation.request.stage === "build") {
        expect(producer.artifact).toMatchObject({
          kind: "completed",
          artifact: "actual-implement",
        });
        expect(producer.revision).toBe(repaired);
        const state = f.journal
          .states(f.catalog.id)
          .find((entry) => entry.key === "docs:one")!;
        expect(state.status).toBe("running");
        expect(state.artifacts.implement).toBe("actual-implement");
        expect(state.revision).toBe(repaired);
        const persisted = JSON.stringify(f.records().at(-1)?.value);
        expect(persisted).toContain('"sourceRevision":"' + repaired + '"');
        expect(persisted).toContain('"artifact":"actual-implement"');
        expect(persisted).toContain("producer-evidence");
      }
      return execute(invocation, s, producer);
    };
    expect(
      (
        await runMultiProjectOrchestrationPass({
          catalog,
          journal: f.journal,
          host: createCoworkOrchestrationHost(f.options),
        })
      ).status,
    ).toBe("completed");
  });

  it("known governance failure stops before verification critic and preserves applicability evidence", async () => {
    const f = fixture();
    f.options.governance = {
      collect: async () => ({
        applicable: ["instruction-budgets"],
        inventory: "fixture/host-inventory",
      }),
      evaluate: async () => ({
        state: "failed",
        evaluatedScope: 4,
        checks: [
          {
            name: "budget",
            state: "failed",
            evidence: ["fixture/budget-exceeded"],
          },
        ],
      }),
    };
    const result = await runMultiProjectOrchestrationPass({
      catalog: f.catalog,
      journal: f.journal,
      host: createCoworkOrchestrationHost(f.options),
    });
    expect(result.status).toBe("needs-input");
    expect(result.tasks.every((task) => task.attempts === 0)).toBe(true);
    expect(
      f.critics.every(
        (invocation) => invocation.request.stage !== "verification",
      ),
    ).toBe(true);
    expect(JSON.stringify(f.records().at(-1)?.value)).toContain(
      "governance-applicability",
    );
    expect(JSON.stringify(f.records().at(-1)?.value)).toContain(
      "fixture/budget-exceeded",
    );
  });

  it.each([
    { state: "passed" as const, evaluatedScope: 0, checks: [] },
    {
      state: "passed" as const,
      evaluatedScope: 0,
      checks: [
        {
          name: "budget",
          state: "passed" as const,
          evidence: ["fixture/budget"],
        },
      ],
    },
  ])("rejects vacuous governance scope/checks %#", async (result) => {
    const f = fixture();
    f.options.governance = {
      collect: async () => ({ applicable: true }),
      evaluate: async () => result,
    };
    const bound = f.bind();
    const request = f.request("verify");
    const validation = await bound.host.validate(request, signal());
    expect(
      await bound.host.validatePolicy!(request, validation, signal()),
    ).toMatchObject({ state: "unknown" });
    expect(f.options.stage.execute).not.toHaveBeenCalled();
  });

  it("preserves real measurable acceptance scope alongside actual applicable governance checks", async () => {
    const f = fixture();
    f.options.governance = {
      collect: async () => ({
        applicable: ["budget"],
        evidence: "fixture/host-inventory",
      }),
      evaluate: async () => ({
        state: "passed",
        evaluatedScope: 3,
        checks: [
          {
            name: "budget",
            state: "passed",
            evidence: ["fixture/validated-budget"],
          },
        ],
      }),
    };
    const bound = f.bind();
    const request = f.request("verify");
    const validation = await bound.host.validate(request, signal());
    expect(
      await bound.host.validatePolicy!(request, validation, signal()),
    ).toMatchObject({
      state: "passed",
      evaluatedScope: 7,
      checks: [
        { name: "unit", state: "passed" },
        { name: "cowork-governance:budget", state: "passed" },
        { name: "cowork-verification", state: "passed" },
      ],
    });
  });

  it("rejects unverified stage receipt and stale source instead of advancing", async () => {
    const f = fixture();
    f.options.stage.attest = vi.fn(async () => false);
    const bound = f.bind();
    const request = f.request("implement");
    expect(
      await bound.host.assessPhase!(
        request,
        {
          kind: "completed",
          artifact: "actual-source",
          contracts: {},
          findings: [],
        },
        sha,
        signal(),
      ),
    ).toMatchObject({ state: "unknown" });
    const g = fixture();
    const execute = g.options.stage.execute;
    g.options.stage.execute = async (invocation, s, producer) => {
      const receipt = await execute(invocation, s, producer);
      g.revisions.set("api:one", repaired);
      return receipt;
    };
    const b = g.bind();
    expect(
      await b.host.assessPhase!(
        g.request("implement"),
        {
          kind: "completed",
          artifact: "actual-source",
          contracts: {},
          findings: [],
        },
        sha,
        signal(),
      ),
    ).toMatchObject({ state: "stale" });
  });

  it("requires critical human approval for an independently attested stage as well", async () => {
    const f = fixture();
    f.options.classify = async () => ({
      author: { id: "actual-author", family: "canonical-author-family" },
      risk: "critical",
      changedFiles: ["src/main.ts"],
    });
    const bound = f.bind();
    expect(
      await bound.host.assessPhase!(
        f.request("implement"),
        {
          kind: "completed",
          artifact: "critical-producer",
          contracts: {},
          findings: [],
        },
        sha,
        signal(),
      ),
    ).toMatchObject({ state: "needs-human", evidence: "critical-human-gate" });
    expect(f.options.review.verifyHumanApproval).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(f.records().at(-1)?.value)).toContain(
      '"approved":false',
    );
  });

  it("keeps independently verified positive critical approval, not worker declarations", async () => {
    const f = fixture();
    f.options.classify = async () => ({
      author: { id: "actual-author", family: "canonical-author-family" },
      risk: "critical",
      changedFiles: ["src/main.ts"],
    });
    f.options.review.verifyHumanApproval = vi.fn(async () => true);
    expect(await f.bind().host.execute(f.request(), signal())).toMatchObject({
      kind: "completed",
      findings: [],
    });
    expect(JSON.stringify(f.records().at(-1)?.value)).toContain(
      '"approved":true',
    );
  });

  it("retains inherited passing checks and does not bypass an inherited known policy block", async () => {
    const f = fixture();
    f.trusted.assessPhase = async (_, __, revision) => ({
      state: "passed",
      revision,
      evaluatedScope: 4,
      checks: [
        {
          name: "base-policy",
          state: "passed",
          evidence: "fixture/base-policy",
        },
      ],
      evidence: "fixture/base-policy-audit",
    });
    const bound = f.bind();
    expect(
      await bound.host.assessPhase!(
        f.request("implement"),
        {
          kind: "completed",
          artifact: "actual-producer",
          contracts: {},
          findings: [],
        },
        sha,
        signal(),
      ),
    ).toMatchObject({
      state: "passed",
      checks: [
        { name: "inherited:base-policy", state: "passed" },
        { name: "cowork-build", state: "passed" },
      ],
    });
    const g = fixture();
    g.trusted.assessPhase = async (_, __, revision) => ({
      state: "blocked",
      revision,
      evaluatedScope: 1,
      checks: [{ name: "base-policy", state: "failed" }],
      evidence: "fixture/base-denied",
    });
    const other = g.bind();
    expect(
      await other.host.assessPhase!(
        g.request("implement"),
        {
          kind: "completed",
          artifact: "actual-producer",
          contracts: {},
          findings: [],
        },
        sha,
        signal(),
      ),
    ).toMatchObject({ state: "blocked", evidence: "fixture/base-denied" });
    expect(g.options.stage.execute).not.toHaveBeenCalled();
  });

  it("rejects zero-scope acceptance evidence before any verification critic", async () => {
    const f = fixture();
    const bound = f.bind();
    const request = f.request("verify");
    const evidence = await bound.host.validate(request, signal());
    expect(
      await bound.host.validatePolicy!(
        request,
        { ...evidence, evaluatedScope: 0 },
        signal(),
      ),
    ).toMatchObject({ state: "unknown" });
    expect(f.options.stage.execute).not.toHaveBeenCalled();
  });

  it("composes an existing bindRun on a fresh immutable lease capture", async () => {
    const f = fixture();
    const bindRun = vi.fn<NonNullable<MultiProjectHost["bindRun"]>>(
      (context) => {
        expect(Object.isFrozen(context.lease)).toBe(true);
        return { ...f.trusted, bindRun: undefined };
      },
    );
    f.trusted.bindRun = bindRun;
    const bound = f.bind();
    expect(await bound.host.execute(f.request(), signal())).toMatchObject({
      kind: "completed",
    });
    expect(bindRun).toHaveBeenCalledTimes(1);
    expect(bindRun.mock.calls[0]![0].lease).not.toBe(bound.lease);
  });

  it("does not provide a permissive production policy or unbound review execution", async () => {
    const f = fixture();
    expect(() =>
      createCoworkOrchestrationHost({
        ...f.options,
        policy: {
          ...policy(),
          routing: { ...policy().routing, requiredDiversity: false },
        },
      }),
    ).toThrow(/explicit diverse/);
    expect(
      await createCoworkOrchestrationHost(f.options).execute(
        f.request(),
        signal(),
      ),
    ).toMatchObject({ kind: "unknown" });
    expect(f.options.review.executeReview).not.toHaveBeenCalled();
  });
});
