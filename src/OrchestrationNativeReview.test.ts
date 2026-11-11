import { describe, expect, it, vi } from "vitest";
import {
  nativeReviewKey,
  runNativeReviewLoop,
  type NativeReviewLoopOptions,
  type NativeReviewRecord,
  type NativeReviewValidation,
} from "./OrchestrationNativeReview.js";
import {
  digest,
  type OrchestrationWorkerReceipt,
  type OrchestrationWorkerRequest,
} from "./MultiProjectProtocol.js";
import type { WorkspaceStore } from "./OrchestrationWorkspaceContract.js";

const revision = (n: number) => n.toString(16).padStart(40, "0");
const completed = (findings: string[] = []): OrchestrationWorkerReceipt => ({
  kind: "completed",
  artifact: findings.length
    ? "Concrete review evidence: missing edge case"
    : "Reviewed changes and validation; no actionable findings",
  contracts: {},
  findings,
});
const positive: NativeReviewValidation = {
  state: "passed",
  evaluatedScope: 3,
  checks: [{ name: "host-unit", state: "passed", evaluatedScope: 3 }],
};
const request = (): OrchestrationWorkerRequest => ({
  invocation: "actual-initial-implementation",
  intent: digest("approved-implementation"),
  stage: "implement",
  project: { id: "api", repositoryRoot: process.cwd() },
  task: {
    id: "issue",
    projectId: "api",
    title: "Approved task",
    brief: "Fix exactly this task",
    branch: "work/issue",
    baseBranch: "main",
    scopes: ["src/value.ts"],
    dependsOn: [],
    requiresContracts: [],
    providesContracts: [],
    acceptance: [{ label: "unit", command: "host-unit" }],
    labels: [],
  },
  artifacts: {
    specify: "Approved specification",
    plan: "Approved scoped plan",
    decompose: "Approved task decomposition",
  },
  baseRevision: revision(0),
  contracts: {},
  failures: [],
});

function fixture() {
  let actual = revision(1);
  const rows = new Map<string, { version: number; value: unknown | null }>();
  const store: Pick<WorkspaceStore, "read" | "compareAndSwap"> = {
    read: (key) =>
      structuredClone(rows.get(key) ?? { version: 0, value: null }),
    compareAndSwap: (key, version, value) => {
      if ((rows.get(key)?.version ?? 0) !== version) return false;
      rows.set(key, { version: version + 1, value: structuredClone(value) });
      return true;
    },
  };
  const execute = vi.fn<NativeReviewLoopOptions["execute"]>(async () =>
    completed(),
  );
  const validate = vi.fn<NativeReviewLoopOptions["validate"]>(
    async () => positive,
  );
  const onStage = vi.fn<NonNullable<NativeReviewLoopOptions["onStage"]>>(
    async () => {},
  );
  const controller = new AbortController();
  const options: NativeReviewLoopOptions = {
    store,
    namespace: "workspace",
    runKey: "github/api/306",
    proposalId: "proposal-one",
    proposalDigest: digest("approved-proposal"),
    sourceRevision: "source-one",
    configurationRevision: 7,
    request: request(),
    revision: actual,
    timeoutMs: 30_000,
    signal: controller.signal,
    execute,
    resolveRevision: vi.fn(async () => actual),
    validate,
    assertCurrent: vi.fn(async () => {}),
    onStage,
  };
  const key = nativeReviewKey(options.namespace, options.runKey);
  const record = () => store.read(key).value as NativeReviewRecord;
  const replace = (value: NativeReviewRecord) => {
    const previous = store.read(key);
    expect(
      store.compareAndSwap(key, previous.version, value, {
        kind: "fixture",
        at: new Date().toISOString(),
      }),
    ).toBe(true);
  };
  return {
    options,
    store,
    execute,
    validate,
    onStage,
    controller,
    record,
    replace,
    setRevision: (value: string) => {
      actual = value;
    },
  };
}

describe("bounded native named reviewer/fix loop", () => {
  it("reserves a separate exact review invocation only after positive host validation", async () => {
    const f = fixture();
    f.execute.mockImplementation(async (input, signal) => {
      expect(f.validate).toHaveBeenCalledWith(revision(1), signal);
      expect(input.stage).toBe("review");
      expect(input.invocation).not.toBe(f.options.request.invocation);
      expect(input.intent).not.toBe(f.options.request.intent);
      const reservation = f.record().history.at(-1)!;
      expect(reservation).toMatchObject({
        state: "reserved",
        invocation: input.invocation,
        requestDigest: digest(input),
        revision: revision(1),
        bindingDigest: f.record().bindingDigest,
      });
      expect(JSON.parse(input.artifacts.verify!)).toMatchObject({
        revision: revision(1),
        validation: positive,
        approvedArtifacts: f.options.request.artifacts,
        originalImplementationInvocation: f.options.request.invocation,
        backendAttested: false,
      });
      return completed();
    });
    expect(await runNativeReviewLoop(f.options)).toMatchObject({
      state: "clean",
      revision: revision(1),
      findings: [],
      attempts: 1,
    });
    expect(f.execute).toHaveBeenCalledOnce();
    expect(f.record()).toMatchObject({
      state: "clean",
      trust: "trusted-local",
      backendAttested: false,
      maxIterations: 10,
      history: [
        expect.objectContaining({ state: "completed", receipt: completed() }),
      ],
    });
    expect(await runNativeReviewLoop(f.options)).toMatchObject({
      state: "clean",
    });
    expect(f.execute).toHaveBeenCalledOnce();
  });

  it("fixes findings within the original scopes then validates the new commit before fresh review", async () => {
    const f = fixture();
    const original = structuredClone(f.options.request);
    f.execute.mockImplementation(async (input) => {
      if (input.stage === "fix") {
        expect(input.failures).toEqual(["Handle empty input in src/value.ts"]);
        expect(f.record().attempts).toBe(2);
        f.setRevision(revision(2));
        return completed();
      }
      return completed(
        input.revision === revision(1)
          ? ["Handle empty input in src/value.ts"]
          : [],
      );
    });
    expect(await runNativeReviewLoop(f.options)).toMatchObject({
      state: "clean",
      revision: revision(2),
      findings: [],
      attempts: 2,
    });
    const requests = f.execute.mock.calls.map(([input]) => input);
    expect(requests.map((input) => [input.stage, input.revision])).toEqual([
      ["review", revision(1)],
      ["fix", revision(1)],
      ["review", revision(2)],
    ]);
    expect(new Set(requests.map((input) => input.invocation)).size).toBe(3);
    for (const input of requests) {
      expect(input.task).toEqual({
        ...original.task,
        brief:
          input.stage === "review"
            ? expect.stringContaining(original.task.brief)
            : original.task.brief,
      });
      if (input.stage === "review")
        expect(input.task.brief).toContain("APPROVAL_REQUIRED:");
      expect(input.project).toEqual(original.project);
      expect(input.baseRevision).toBe(original.baseRevision);
      expect(input.contracts).toEqual(original.contracts);
      for (const stage of ["specify", "plan", "decompose"] as const)
        expect(input.artifacts[stage]).toBe(original.artifacts[stage]);
    }
    expect(f.options.request).toEqual(original);
    expect(f.validate.mock.calls.map(([sha]) => sha)).toEqual([
      revision(1),
      revision(2),
    ]);
    expect(f.onStage).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "reviewing",
        findings: ["Handle empty input in src/value.ts"],
      }),
    );
    expect(f.record().history.map((entry) => entry.resultingRevision)).toEqual([
      revision(1),
      revision(2),
      revision(2),
    ]);
    expect(
      await runNativeReviewLoop({ ...f.options, revision: revision(2) }),
    ).toMatchObject({ state: "clean", attempts: 2 });
    expect(f.execute).toHaveBeenCalledTimes(3);
  });

  it.each([
    { kind: "failed", signature: "review-failed", evidence: "Reviewer failed" },
    { kind: "unknown", reason: "Reviewer outcome uncertain" },
  ] as const)(
    "blocks a $kind reviewer and never replays after reopen",
    async (receipt) => {
      const f = fixture();
      f.execute.mockResolvedValue(receipt);
      expect(await runNativeReviewLoop(f.options)).toMatchObject({
        state: receipt.kind,
      });
      expect(await runNativeReviewLoop(f.options)).toMatchObject({
        state: receipt.kind,
      });
      expect(f.execute).toHaveBeenCalledOnce();
      expect(f.record().history[0]?.receipt).toEqual(receipt);
      expect(
        f.onStage.mock.calls.filter(([event]) => event.stage === "blocked"),
      ).toHaveLength(1);
    },
  );

  it("holds interrupted running reservations on reopen without a new model launch", async () => {
    const f = fixture();
    await runNativeReviewLoop(f.options);
    const reserved = f.record();
    reserved.state = "running";
    reserved.history[0]!.state = "reserved";
    delete reserved.history[0]!.receipt;
    f.replace(reserved);
    f.execute.mockClear();
    const deadline = reserved.deadline;
    expect(
      await runNativeReviewLoop({ ...f.options, timeoutMs: 3_600_000 }),
    ).toMatchObject({
      state: "unknown",
      attempts: 1,
      evidence: expect.stringContaining("no replay"),
    });
    expect(await runNativeReviewLoop(f.options)).toMatchObject({
      state: "unknown",
    });
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.record().deadline).toBe(deadline);
    expect(f.record().history[0]!.state).toBe("reserved");
  });

  it.each(["failed", "unknown"] as const)(
    "blocks a %s fix and retains the findings",
    async (kind) => {
      const f = fixture();
      f.execute.mockResolvedValueOnce(
        completed(["Concrete actionable finding"]),
      );

      f.execute.mockResolvedValueOnce(
        kind === "failed"
          ? {
              kind,
              signature: "fix-failed",
              evidence: "Fix could not complete",
            }
          : { kind, reason: "Fix outcome uncertain" },
      );
      expect(await runNativeReviewLoop(f.options)).toMatchObject({
        state: kind,
        attempts: 2,
        findings: ["Concrete actionable finding"],
      });
      await runNativeReviewLoop(f.options);
      expect(f.execute).toHaveBeenCalledTimes(2);
    },
  );

  it.each(["specify", "plan", "decompose"] as const)(
    "blocks fix %s amendments before further validation or review",
    async (stage) => {
      const f = fixture();
      const original = structuredClone(f.options.request);
      const amended = {
        kind: "completed" as const,
        artifact: "Proposed expansion",
        contracts: {},
        findings: [],
        amendments: { [stage]: "Requires an expanded approved artifact" },
      };
      f.execute.mockResolvedValueOnce(
        completed(["Concrete actionable finding"]),
      );
      f.execute.mockImplementationOnce(async (input) => {
        expect(input.task).toEqual(original.task);
        expect(input.artifacts.plan).toBe(original.artifacts.plan);
        f.setRevision(revision(2));
        return amended;
      });
      expect(await runNativeReviewLoop(f.options)).toMatchObject({
        state: "failed",
        attempts: 2,
        findings: ["Concrete actionable finding"],
        evidence: "Approved plan/scope expansion requires new user approval",
      });
      expect(f.record().history.at(-1)?.receipt).toEqual(amended);
      expect(f.execute.mock.calls.map(([input]) => input.stage)).toEqual([
        "review",
        "fix",
      ]);
      expect(f.validate).toHaveBeenCalledOnce();
      expect(f.options.request).toEqual(original);
      await runNativeReviewLoop(f.options);
      expect(f.execute).toHaveBeenCalledTimes(2);
      expect(
        f.onStage.mock.calls.filter(([event]) => event.stage === "blocked"),
      ).toHaveLength(1);
    },
  );

  it("blocks explicit approval-required reviewer findings before invoking fix", async () => {
    const f = fixture();
    const original = structuredClone(f.options.request);
    const finding =
      "APPROVAL_REQUIRED: Fix requires changing the approved plan and another task's scope";
    f.execute.mockResolvedValue(completed([finding]));
    expect(await runNativeReviewLoop(f.options)).toMatchObject({
      state: "failed",
      attempts: 1,
      findings: [finding],
      evidence: "Approved plan/scope expansion requires new user approval",
    });
    expect(f.execute).toHaveBeenCalledOnce();
    const reviewed = f.execute.mock.calls[0]![0];
    expect(reviewed.task.brief).toContain("APPROVAL_REQUIRED:");
    expect(reviewed.task.scopes).toEqual(original.task.scopes);
    expect(reviewed.artifacts.plan).toBe(original.artifacts.plan);
    expect(f.options.request).toEqual(original);
    expect(f.onStage).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "blocked",
        reason: "Approved plan/scope expansion requires new user approval",
        findings: [finding],
      }),
    );
    await runNativeReviewLoop(f.options);
    expect(f.execute).toHaveBeenCalledOnce();
  });

  it("blocks reviewer amendments with the same explicit user-approval reason", async () => {
    const f = fixture();
    f.execute.mockResolvedValue({
      kind: "completed",
      artifact: "Review proposes plan changes",
      contracts: {},
      findings: ["Expanded plan is needed"],
      amendments: { plan: "Expanded plan proposal" },
    });
    expect(await runNativeReviewLoop(f.options)).toMatchObject({
      state: "failed",
      findings: ["Expanded plan is needed"],
      evidence: "Approved plan/scope expansion requires new user approval",
    });
    expect(f.execute).toHaveBeenCalledOnce();
  });

  it.each([
    null,
    { ...positive, state: "unknown" },
    { ...positive, evaluatedScope: 0 },
    { ...positive, checks: [] },
  ])(
    "requires positive nonzero initial local validation (%j)",
    async (validation) => {
      const f = fixture();
      f.validate.mockResolvedValue(validation);
      expect(await runNativeReviewLoop(f.options)).toMatchObject({
        state: "unknown",
      });
      expect(f.execute).not.toHaveBeenCalled();
    },
  );

  it("requires positive validation again after a fix before the next reviewer", async () => {
    const f = fixture();
    f.validate
      .mockResolvedValueOnce(positive)
      .mockResolvedValueOnce({ ...positive, evaluatedScope: 0 });
    f.execute.mockImplementation(async (input) => {
      if (input.stage === "fix") f.setRevision(revision(2));
      return completed(["Concrete actionable finding"]);
    });
    expect(await runNativeReviewLoop(f.options)).toMatchObject({
      state: "unknown",
      revision: revision(2),
      findings: ["Concrete actionable finding"],
    });
    expect(f.execute.mock.calls.map(([input]) => input.stage)).toEqual([
      "review",
      "fix",
    ]);
  });

  it("rejects a stale initial commit without invoking a reviewer", async () => {
    const f = fixture();
    f.setRevision(revision(2));
    expect(await runNativeReviewLoop(f.options)).toMatchObject({
      state: "unknown",
      evidence: expect.stringContaining("commit changed"),
    });
    expect(f.execute).not.toHaveBeenCalled();
  });

  it("rejects a reviewer that edits the actual branch even with a clean receipt", async () => {
    const f = fixture();
    f.execute.mockImplementation(async () => {
      f.setRevision(revision(2));
      return completed();
    });
    expect(await runNativeReviewLoop(f.options)).toMatchObject({
      state: "unknown",
      evidence: expect.stringContaining("editing reviewer rejected"),
    });
    expect(f.record().history[0]).toMatchObject({
      state: "completed",
      resultingRevision: revision(2),
      receipt: completed(),
    });
    await runNativeReviewLoop(f.options);
    expect(f.execute).toHaveBeenCalledOnce();
  });

  it.each([false, true])(
    "never reuses clean verdicts after commit changes (updated caller: %s)",
    async (updated) => {
      const f = fixture();
      await runNativeReviewLoop(f.options);
      f.setRevision(revision(2));
      const outcome = await runNativeReviewLoop({
        ...f.options,
        revision: updated ? revision(2) : revision(1),
      });
      expect(outcome.state).not.toBe("clean");
      expect(f.execute).toHaveBeenCalledOnce();
    },
  );

  it("exhausts the default ten total implementations without an eleventh or replay", async () => {
    const f = fixture();
    let implementations = 1;
    f.execute.mockImplementation(async (input) => {
      if (input.stage === "fix") {
        implementations++;
        f.setRevision(revision(implementations));
        return completed();
      }
      return completed([`Actual finding at implementation ${implementations}`]);
    });
    expect(await runNativeReviewLoop(f.options)).toMatchObject({
      state: "exhausted",
      attempts: 10,
      revision: revision(10),
      findings: ["Actual finding at implementation 10"],
      evidence: expect.stringContaining(
        "Iteration limit reached (10); remaining findings require human input.",
      ),
    });
    expect(implementations).toBe(10);
    expect(
      f.execute.mock.calls.filter(([input]) => input.stage === "review"),
    ).toHaveLength(10);
    expect(
      f.execute.mock.calls.filter(([input]) => input.stage === "fix"),
    ).toHaveLength(9);
    expect(f.record().history).toHaveLength(19);
    expect(
      await runNativeReviewLoop({ ...f.options, revision: revision(10) }),
    ).toMatchObject({
      state: "exhausted",
      attempts: 10,
      findings: ["Actual finding at implementation 10"],
    });
    expect(implementations).toBe(10);
    expect(
      f.onStage.mock.calls.filter(([event]) => event.stage === "blocked"),
    ).toHaveLength(1);
    expect(f.onStage).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "blocked",
        reason: expect.stringContaining(
          "Iteration limit reached (10); remaining findings require human input.",
        ),
        findings: ["Actual finding at implementation 10"],
      }),
    );
  });

  it.each([1, 2, 11])(
    "honors an explicit %i iteration cap",
    async (maxIterations) => {
      const f = fixture();
      let implementations = 1;
      f.execute.mockImplementation(async (input) => {
        if (input.stage === "fix") f.setRevision(revision(++implementations));
        return completed(["Unresolved concrete finding"]);
      });
      expect(
        await runNativeReviewLoop({ ...f.options, maxIterations }),
      ).toMatchObject({ state: "exhausted", attempts: maxIterations });
      expect(implementations).toBe(maxIterations);
      expect(f.record().history).toHaveLength(2 * maxIterations - 1);
    },
  );

  it.each([0, -1, 1.5, 101, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects a non-integer/out-of-range iteration cap %s before reservation",
    async (maxIterations) => {
      const f = fixture();
      await expect(
        runNativeReviewLoop({ ...f.options, maxIterations }),
      ).rejects.toThrow();
      expect(f.execute).not.toHaveBeenCalled();
      expect(f.record()).toBeNull();
    },
  );

  it("does not interpret null iteration configuration as the default budget", async () => {
    const f = fixture();
    await expect(
      runNativeReviewLoop({
        ...f.options,
        maxIterations: null as unknown as number,
      }),
    ).rejects.toThrow();
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.record()).toBeNull();
  });

  it.each(["proposal", "configuration", "source", "plan", "budget"] as const)(
    "retains the stable run count and fails closed on changed %s binding",
    async (change) => {
      const f = fixture();
      const options = { ...f.options, maxIterations: 1 };
      f.execute.mockResolvedValue(completed(["Actual retained finding"]));
      await runNativeReviewLoop(options);
      const first = f.record();
      const changed = structuredClone(f.options.request);
      changed.artifacts.plan = "Different plan";
      const updated = {
        ...options,
        ...(change === "proposal"
          ? { proposalId: "proposal-two", proposalDigest: digest("two") }
          : {}),
        ...(change === "configuration" ? { configurationRevision: 8 } : {}),
        ...(change === "source" ? { sourceRevision: "source-two" } : {}),
        ...(change === "plan" ? { request: changed } : {}),
        ...(change === "budget" ? { maxIterations: 10 } : {}),
      };
      expect(await runNativeReviewLoop(updated)).toMatchObject({
        state: "failed",
        attempts: 1,
        findings: ["Actual retained finding"],
        evidence: expect.stringContaining("cannot reset"),
      });
      expect(f.record().binding).toEqual(first.binding);
      expect(f.record().deadline).toBe(first.deadline);
      expect(f.record().maxIterations).toBe(1);
      expect(f.execute).toHaveBeenCalledOnce();
    },
  );

  it("allows only a separately identified host run to allocate a new budget", async () => {
    const f = fixture();
    f.execute.mockResolvedValue(completed(["Actual finding"]));
    await runNativeReviewLoop({ ...f.options, maxIterations: 1 });
    f.execute.mockResolvedValue(completed());
    expect(
      await runNativeReviewLoop({
        ...f.options,
        runKey: "explicit-new-host-run",
      }),
    ).toMatchObject({ state: "clean", attempts: 1 });
    expect(f.record()).toMatchObject({ state: "exhausted", attempts: 1 });
  });

  it("enforces the persisted wall-clock deadline without expanding time budgets", async () => {
    const f = fixture();
    const now = vi.spyOn(Date, "now");
    let time = Date.now();
    now.mockImplementation(() => time);
    f.execute.mockImplementation(async () => {
      time += 30_001;
      return completed(["Deadline finding"]);
    });
    try {
      expect(await runNativeReviewLoop(f.options)).toMatchObject({
        state: "unknown",
        evidence: expect.stringContaining("deadline"),
      });
      const deadline = f.record().deadline;
      await runNativeReviewLoop({ ...f.options, timeoutMs: 3_600_000 });
      expect(f.record().deadline).toBe(deadline);
      expect(f.execute).toHaveBeenCalledOnce();
    } finally {
      now.mockRestore();
    }
  });

  it("bounds a nonsettling reviewer, propagates abort, and holds its unknown reservation", async () => {
    const f = fixture();
    let passedSignal: AbortSignal | undefined;
    f.execute.mockImplementation(async (_input, signal) => {
      passedSignal = signal;
      return new Promise(() => {});
    });
    expect(
      await runNativeReviewLoop({ ...f.options, timeoutMs: 40 }),
    ).toMatchObject({ state: "unknown", attempts: 1 });
    expect(passedSignal?.aborted).toBe(true);
    expect(f.record().history[0]?.state).toBe("reserved");
    await runNativeReviewLoop(f.options);
    expect(f.execute).toHaveBeenCalledOnce();
  });

  it("never launches on an already-aborted inherited signal", async () => {
    const f = fixture();
    f.controller.abort();
    expect(await runNativeReviewLoop(f.options)).toMatchObject({
      state: "unknown",
    });
    expect(f.execute).not.toHaveBeenCalled();
  });

  it("persists reviewer receipt before reporting findings and never replays on callback failure", async () => {
    const f = fixture();
    f.execute.mockResolvedValue(completed(["Finding worth posting"]));
    f.onStage.mockImplementation(async (event) => {
      if (event.stage === "reviewing" && event.findings.length) {
        expect(f.record().history[0]!.receipt).toEqual(
          completed(["Finding worth posting"]),
        );
        throw new Error("Comment write failed");
      }
    });
    expect(await runNativeReviewLoop(f.options)).toMatchObject({
      state: "unknown",
      findings: ["Finding worth posting"],
      evidence: expect.stringContaining("Comment write failed"),
    });
    await runNativeReviewLoop(f.options);
    expect(f.execute).toHaveBeenCalledOnce();
    expect(
      f.onStage.mock.calls.filter(([event]) => event.stage === "blocked"),
    ).toHaveLength(1);
  });

  it("keeps a failed blocked callback explicit and at-most-once across reopen", async () => {
    const f = fixture();
    f.execute.mockResolvedValue({
      kind: "failed",
      signature: "review",
      evidence: "Failure",
    });
    f.onStage.mockImplementation(async (event) => {
      if (event.stage === "blocked") throw new Error("Labels unavailable");
    });
    expect(await runNativeReviewLoop(f.options)).toMatchObject({
      state: "unknown",
      evidence: expect.stringContaining("blocked notification failed"),
    });
    await runNativeReviewLoop(f.options);
    expect(
      f.onStage.mock.calls.filter(([event]) => event.stage === "blocked"),
    ).toHaveLength(1);
    expect(f.execute).toHaveBeenCalledOnce();
  });

  it("does not turn a rejected or malformed reviewer response into success", async () => {
    const f = fixture();
    f.execute.mockRejectedValue(new Error("Transport failed"));
    expect(await runNativeReviewLoop(f.options)).toMatchObject({
      state: "unknown",
    });
    await runNativeReviewLoop(f.options);
    expect(f.execute).toHaveBeenCalledOnce();
    const malformed = fixture();
    malformed.execute.mockResolvedValue({
      kind: "completed",
    } as OrchestrationWorkerReceipt);
    expect(await runNativeReviewLoop(malformed.options)).toMatchObject({
      state: "unknown",
    });
  });

  it("refuses a lost reservation CAS without invoking a model", async () => {
    const f = fixture();
    vi.spyOn(f.store, "compareAndSwap").mockReturnValue(false);
    expect(await runNativeReviewLoop(f.options)).toMatchObject({
      state: "unknown",
    });
    expect(f.execute).not.toHaveBeenCalled();
  });
});
