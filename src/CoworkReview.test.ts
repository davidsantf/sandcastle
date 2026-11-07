import { describe, expect, it } from "vitest";
import {
  runCoworkReview,
  runCoworkStageCritic,
  selectCoworkCritic,
} from "./CoworkReview.js";
import {
  coworkReviewPasses,
  type CoworkFindingCategory,
  type CoworkReviewAudit,
  type CoworkReviewContext,
  type CoworkReviewHost,
  type CoworkReviewPolicy,
  type CoworkReviewReceipt,
  type CoworkReviewRequest,
  type CoworkStageCriticHost,
  type CoworkStageCriticRequest,
} from "./CoworkReviewContract.js";

const context: CoworkReviewContext = {
  intent: "a".repeat(64),
  revision: "b".repeat(40),
  projectId: "project",
  taskId: "task",
  artifacts: { spec: "c".repeat(64), plan: "d".repeat(64) },
  contracts: { api: "e".repeat(64) },
  changedFiles: ["src/Example.ts", "src/Example.test.ts"],
  author: { id: "author-model", family: "author-family" },
  risk: "ordinary",
};
const policy: CoworkReviewPolicy = {
  maxAttempts: 3,
  repeatedSignatureLimit: 2,
  routing: {
    requiredDiversity: true,
    unavailable: "block",
    framework: "devsquad",
    models: [
      {
        id: "critic-model",
        family: "critic-family",
        stages: [
          "research",
          "design",
          "build",
          "verification",
          "review",
          "change-request-proposal",
        ],
        executor: {
          framework: "devsquad",
          capabilityId: "devsquad.review",
          available: true,
        },
      },
    ],
  },
};

function fakeHost(
  options: {
    category?: CoworkFindingCategory;
    override?: Partial<CoworkReviewHost>;
  } = {},
) {
  const requests: CoworkReviewRequest[] = [];
  const audits: CoworkReviewAudit[] = [];
  let humanCalls = 0;
  const host: CoworkReviewHost = {
    authorizeReview: async () => true,
    resolveRevision: async () => context.revision,
    executeReview: async (request) => {
      requests.push(request);
      return {
        intent: request.context.intent,
        revision: request.context.revision,
        pass: request.pass,
        modelId: request.critic.id,
        evaluatedFiles: request.context.changedFiles,
        findings: options.category
          ? [
              {
                category: options.category,
                signature: "distinguishing-test",
                evidence: "evidence/test-control",
              },
            ]
          : [],
      };
    },
    attestReview: async () => true,
    verifyHumanApproval: async () => {
      humanCalls++;
      return false;
    },
    audit: async (audit) => {
      audits.push(audit);
    },
    ...options.override,
  };
  return { host, requests, audits, humanCalls: () => humanCalls };
}

describe("host-attested canonical critic routing", () => {
  it.each([
    "research",
    "design",
    "build",
    "verification",
    "review",
    "change-request-proposal",
  ] as const)(
    "selects a different family for %s without overriding runtime models",
    (stage) => {
      expect(
        selectCoworkCritic({ ...policy.routing, author: context.author, stage })
          .state,
      ).toBe("selected");
    },
  );
  it("does not treat another alias in the author's family as diversity", () => {
    const models = policy.routing.models.map((model) => ({
      ...model,
      family: context.author.family,
    }));
    expect(
      selectCoworkCritic({
        ...policy.routing,
        models,
        author: context.author,
        stage: "review",
      }),
    ).toMatchObject({
      state: "blocked",
      reason: "critic-diversity-unavailable",
    });
    expect(
      selectCoworkCritic({
        ...policy.routing,
        models,
        unavailable: "human",
        author: context.author,
        stage: "review",
      }).state,
    ).toBe("needs-human");
  });
  it("rejects duplicate identities and author-family conflict", () => {
    const model = policy.routing.models[0]!;
    expect(
      selectCoworkCritic({
        ...policy.routing,
        models: [model, model],
        author: context.author,
        stage: "review",
      }).state,
    ).toBe("blocked");
    expect(
      selectCoworkCritic({
        ...policy.routing,
        models: [{ ...model, id: context.author.id }],
        author: context.author,
        stage: "review",
      }),
    ).toMatchObject({ reason: "author-family-conflict" });
  });
  it("fails closed for unavailable or wrong framework capabilities", () => {
    for (const executor of [
      {
        framework: "devsquad" as const,
        capabilityId: "devsquad.review",
        available: false,
      },
      {
        framework: "custom" as const,
        capabilityId: "generic-worker",
        available: true,
      },
    ]) {
      expect(
        selectCoworkCritic({
          ...policy.routing,
          author: context.author,
          stage: "review",
          models: policy.routing.models.map((model) => ({
            ...model,
            executor,
          })),
        }).state,
      ).toBe("blocked");
    }
  });
});

describe("staged review evidence, not worker approval", () => {
  it("runs fast first then every meaningful pass with frozen nonsecret prompts", async () => {
    const fake = fakeHost();
    const result = await runCoworkReview(context, policy, fake.host);
    expect(result.state).toBe("ready");
    expect(result.reason).toBe("reviewed-not-authorized");
    expect(fake.requests.map((request) => request.pass)).toEqual(
      coworkReviewPasses,
    );
    expect(
      fake.requests.every((request) =>
        Object.isFrozen(request.context.artifacts),
      ),
    ).toBe(true);
    expect(fake.requests[0]!.executor.capabilityId).toBe("devsquad.review");
    expect(JSON.parse(fake.requests[0]!.prompt)).not.toHaveProperty(
      "credentials",
    );
    expect(fake.audits).toHaveLength(1);
  });

  describe("executed stage critic gate", () => {
    const request: CoworkStageCriticRequest = {
      stage: "research",
      intent: context.intent,
      revision: context.revision,
      artifact: "f".repeat(64),
      author: context.author,
      contracts: context.contracts,
    };
    const host: CoworkStageCriticHost = {
      authorize: async () => true,
      execute: async (invocation) => ({
        stage: invocation.request.stage,
        intent: invocation.request.intent,
        revision: invocation.request.revision,
        artifact: invocation.request.artifact,
        critic: invocation.critic,
        state: "passed",
        findings: [],
      }),
      attest: async () => true,
      resolveRevision: async () => context.revision,
      audit: async () => {},
    };
    it.each([
      "research",
      "design",
      "build",
      "verification",
      "review",
      "change-request-proposal",
    ] as const)(
      "runs a host-attested configured critic for %s",
      async (stage) => {
        expect(
          (
            await runCoworkStageCritic(
              { ...request, stage },
              policy.routing,
              host,
            )
          ).state,
        ).toBe("passed");
      },
    );
    it("cannot accept family echoes without host attestation", async () => {
      expect(
        (
          await runCoworkStageCritic(request, policy.routing, {
            ...host,
            attest: async () => false,
          })
        ).state,
      ).toBe("unknown");
    });
    it("rejects stale binding and success-shaped findings", async () => {
      for (const bad of [
        { artifact: "a".repeat(64) },
        { findings: ["blocking-signature"] },
        {
          critic: {
            id: "critic-model",
            family: "critic-family",
            approved: true,
          },
        },
      ]) {
        expect(
          (
            await runCoworkStageCritic(request, policy.routing, {
              ...host,
              execute: async (invocation, signal) => ({
                ...(await host.execute(invocation, signal)),
                ...bad,
              }),
            })
          ).state,
        ).toBe("unknown");
      }
    });
    it("fails closed for unavailable framework and authorization denial", async () => {
      expect(
        (
          await runCoworkStageCritic(
            request,
            { ...policy.routing, models: [] },
            host,
          )
        ).state,
      ).toBe("blocked");
      expect(
        (
          await runCoworkStageCritic(request, policy.routing, {
            ...host,
            authorize: async () => false,
          })
        ).state,
      ).toBe("blocked");
    });
    it("retains uncertainty and revision invalidation during execution and audit", async () => {
      expect(
        (
          await runCoworkStageCritic(request, policy.routing, {
            ...host,
            execute: async () => {
              throw new Error("no proof");
            },
          })
        ).state,
      ).toBe("unknown");
      let current = context.revision;
      expect(
        (
          await runCoworkStageCritic(request, policy.routing, {
            ...host,
            resolveRevision: async () => current,
            audit: async () => {
              current = "a".repeat(40);
            },
          })
        ).state,
      ).toBe("stale");
    });
  });
  it.each([
    "correctness",
    "security",
    "data-loss",
    "missing-meaningful-tests",
  ] as const)("%s blocks without auto-approval", async (category) => {
    const fake = fakeHost({ category });
    expect(await runCoworkReview(context, policy, fake.host)).toMatchObject({
      state: "blocked",
      reason: "blocking-findings",
    });
    expect(fake.requests).toHaveLength(1);
  });
  it("keeps advisory findings without forcing more rounds", async () => {
    const fake = fakeHost({ category: "advisory" });
    expect(await runCoworkReview(context, policy, fake.host)).toMatchObject({
      state: "ready",
      blockingSignature: null,
    });
    expect(fake.requests).toHaveLength(6);
    expect(
      fake.audits[0]!.receipts.flatMap((receipt) => receipt.findings),
    ).toHaveLength(6);
  });
  it("requires independent host human verification for critical changes", async () => {
    const fake = fakeHost();
    expect(
      await runCoworkReview(
        { ...context, risk: "critical" },
        policy,
        fake.host,
      ),
    ).toMatchObject({ state: "needs-human", reason: "critical-human-gate" });
    expect(fake.humanCalls()).toBe(1);
    const approved = fakeHost({
      override: {
        verifyHumanApproval: async (bound, reviewers) => {
          expect(bound.revision).toBe(context.revision);
          expect(reviewers[0]!.family).not.toBe(context.author.family);
          return true;
        },
      },
    });
    expect(
      (
        await runCoworkReview(
          { ...context, risk: "critical" },
          policy,
          approved.host,
        )
      ).state,
    ).toBe("ready");
  });
  it("rejects worker-supplied approval/risk fields", async () => {
    const fake = fakeHost({
      override: {
        executeReview: async (request) => ({
          intent: context.intent,
          revision: context.revision,
          pass: request.pass,
          modelId: request.critic.id,
          evaluatedFiles: context.changedFiles,
          findings: [],
          approved: true,
          risk: "ordinary",
        }),
      },
    });
    expect(
      (
        await runCoworkReview(
          { ...context, risk: "critical" },
          policy,
          fake.host,
        )
      ).state,
    ).toBe("unknown");
    expect(fake.humanCalls()).toBe(0);
  });
  it("invalidates evidence when revision changes in review, approval or audit", async () => {
    for (const seam of [
      "executeReview",
      "verifyHumanApproval",
      "audit",
    ] as const) {
      let current = context.revision;
      const base = fakeHost();
      const host: CoworkReviewHost = {
        ...base.host,
        resolveRevision: async () => current,
        verifyHumanApproval: async () => true,
        [seam]: async (...args: unknown[]) => {
          current = "f".repeat(40);
          if (seam === "executeReview") {
            return base.host.executeReview(
              args[0] as CoworkReviewRequest,
              new AbortController().signal,
            );
          }
          if (seam === "verifyHumanApproval") return true;
          return undefined;
        },
      };
      expect(
        (await runCoworkReview({ ...context, risk: "critical" }, policy, host))
          .state,
      ).toBe("stale");
    }
  });
  it("stops repeated findings across changed revisions and exhausted attempts", async () => {
    const fake = fakeHost({ category: "correctness" });
    const first = await runCoworkReview(context, policy, fake.host);
    const history = [
      {
        intent: context.intent,
        revision: "f".repeat(40),
        attempt: 1,
        blockingSignature: first.blockingSignature,
      },
    ];
    expect(
      await runCoworkReview(context, policy, fake.host, history),
    ).toMatchObject({
      state: "stopped",
      reason: "repeated-findings",
      attempt: 2,
    });
    expect(
      await runCoworkReview(
        context,
        policy,
        fake.host,
        [1, 2, 3].map((attempt) => ({
          intent: context.intent,
          revision: context.revision,
          attempt,
          blockingSignature: null,
        })),
      ),
    ).toMatchObject({ state: "stopped", reason: "attempt-limit" });
  });
  it("rejects unbound or noncontiguous history", async () => {
    expect(
      (
        await runCoworkReview(context, policy, fakeHost().host, [
          {
            intent: "f".repeat(64),
            revision: context.revision,
            attempt: 2,
            blockingSignature: null,
          },
        ])
      ).state,
    ).toBe("blocked");
  });
  it("requires full changed-file coverage and actual executed identity", async () => {
    for (const override of [
      { attestReview: async () => false },
      {
        executeReview: async (
          request: CoworkReviewRequest,
        ): Promise<CoworkReviewReceipt> => ({
          intent: context.intent,
          revision: context.revision,
          pass: request.pass,
          modelId: request.critic.id,
          evaluatedFiles: [context.changedFiles[0]!],
          findings: [],
        }),
      },
    ]) {
      const fake = fakeHost({ override });
      expect((await runCoworkReview(context, policy, fake.host)).state).toBe(
        "unknown",
      );
    }
  });
  it("rejects mismatched binding and empty evidence scope", async () => {
    for (const bad of [
      { revision: "f".repeat(40) },
      { intent: "f".repeat(64) },
      { modelId: "author-model" },
      { evaluatedFiles: [] },
    ]) {
      const base = fakeHost();
      const fake = fakeHost({
        override: {
          executeReview: async (request, signal) => ({
            ...(await base.host.executeReview(request, signal)),
            ...bad,
          }),
        },
      });
      expect((await runCoworkReview(context, policy, fake.host)).state).toBe(
        "unknown",
      );
    }
  });
  it("preserves external uncertainty and audit failure, rather than known stop", async () => {
    for (const override of [
      {
        executeReview: async (): Promise<CoworkReviewReceipt> => {
          throw new Error("secret");
        },
      },
      {
        audit: async () => {
          throw new Error("secret");
        },
      },
    ]) {
      const fake = fakeHost({ override });
      const result = await runCoworkReview(context, policy, fake.host);
      expect(result.state).toBe("unknown");
      expect(JSON.stringify(result)).not.toContain("secret");
    }
  });
  it("does not dispatch after denial or cancellation", async () => {
    const denied = fakeHost({
      override: { authorizeReview: async () => false },
    });
    expect((await runCoworkReview(context, policy, denied.host)).state).toBe(
      "blocked",
    );
    expect(denied.requests).toHaveLength(0);
    const aborted = fakeHost();
    const controller = new AbortController();
    controller.abort();
    expect(
      (
        await runCoworkReview(
          context,
          policy,
          aborted.host,
          [],
          controller.signal,
        )
      ).state,
    ).toBe("stopped");
    expect(aborted.requests).toHaveLength(0);
  });
  it("never accepts late completion after abort", async () => {
    const controller = new AbortController();
    const base = fakeHost();
    const fake = fakeHost({
      override: {
        executeReview: async (request, signal) => {
          const receipt = await base.host.executeReview(request, signal);
          controller.abort();
          return receipt;
        },
      },
    });
    expect(
      (await runCoworkReview(context, policy, fake.host, [], controller.signal))
        .state,
    ).toBe("unknown");
  });
});
