import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "./run.js";
import { noSandbox } from "./sandboxes/no-sandbox.js";
import {
  createDevsquadOrchestrationWorker,
  type OrchestrationLocalExecutionEvidence,
} from "./MultiProjectWorker.js";
import {
  digest,
  type OrchestrationWorkerRequest,
  type OrchestrationWorkerReceipt,
} from "./MultiProjectProtocol.js";
import {
  createOrchestrationLocalExecutionRecorder,
  createOrchestrationNativeSetup,
} from "./OrchestrationNativeHost.js";
import {
  OrchestrationWorkspaceStore,
  initializeWorkspace,
  updateWorkspaceConfiguration,
} from "./OrchestrationWorkspace.js";
import {
  configuredWorkspacePlanner,
  createWorkspaceNativeTick,
} from "./OrchestrationWorkspaceHost.js";
import { runLocalOrchestrationPass } from "./LocalOrchestrationService.js";
import { createOrchestrationProposalQueue } from "./OrchestrationProposal.js";

vi.mock("./run.js", () => ({ run: vi.fn() }));
vi.mock("node:child_process", () => ({
  execFile: vi.fn(
    (
      _command: string,
      args: string[],
      _options: unknown,
      callback: (error: Error | null, stdout: string) => void,
    ) => {
      callback(
        null,
        args[0] === "--version"
          ? "GitHub Copilot CLI 1.0.106."
          : "--agent --model",
      );
    },
  ),
}));
const fixtures: { directory: string; store: OrchestrationWorkspaceStore }[] =
  [];
afterEach(() => {
  vi.mocked(run).mockReset();
  for (const f of fixtures.splice(0)) {
    f.store.close();
    fs.rmSync(f.directory, { recursive: true, force: true });
  }
});
const signal = () => new AbortController().signal;
function fixture() {
  const directory = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "trusted-local-")),
  );
  const store = new OrchestrationWorkspaceStore(
    path.join(directory, "state.sqlite"),
  );
  fixtures.push({ directory, store });
  initializeWorkspace(store);
  const phaseDefinitions = (
    ["specify", "plan", "decompose", "implement", "review", "fix"] as const
  ).map((stage) => {
    const body = `---\nname: devsquad.${stage}\n---\nHost-installed fixture instructions.\n`;
    const definitionPath = path.join(directory, `${stage}.agent.md`);
    fs.writeFileSync(definitionPath, body);
    return {
      stage,
      agentName: `devsquad.${stage}`,
      definitionPath,
      definitionDigest: createHash("sha256").update(body).digest("hex"),
      model: { id: "fixture-model", family: "fixture-family" },
    };
  });
  const configuration = updateWorkspaceConfiguration(store, 1, (current) => ({
    ...current,
    projects: [
      {
        id: "api",
        repositoryRoot: directory,
        mode: "individual",
        hub: { kind: "github", repository: "fixture/api" },
      },
    ],
    discovery: [
      {
        id: "assigned",
        projectId: "api",
        hub: { kind: "github", repository: "fixture/api" },
        selector: { assignedTo: "owner" },
        pageSize: 10,
        maxPages: 1,
        includeReviewFeedback: false,
        includeDependencies: false,
      },
    ],
    taskTemplates: [
      {
        id: "template",
        projectId: "api",
        title: "Scoped task",
        brief: "Host-approved scope",
        branch: "work/task",
        baseBranch: "main",
        scopes: ["src"],
        dependsOn: [],
        requiresContracts: [],
        providesContracts: [],
        labels: [],
        acceptance: [{ label: "regression", command: "npm test" }],
      },
    ],
    focus: {
      ...current.focus,
      mode: "propose",
      projectIds: ["api"],
      permissions: [
        { projectId: "api", action: "discover" },
        { projectId: "api", action: "investigate" },
      ],
    },
    runtime: {
      ...current.runtime,
      command: "copilot",
      phaseDefinitions,
      executionTrust: "trusted-local",
    },
  }));
  const request: OrchestrationWorkerRequest = {
    invocation: "fixture-invocation",
    intent: digest("approved-intent"),
    revision: "a".repeat(40),
    project: configuration.projects[0]!,
    task: configuration.taskTemplates[0]!,
    stage: "implement",
    artifacts: {},
    contracts: {},
    failures: [],
  };
  const recorder = createOrchestrationLocalExecutionRecorder({
    store,
    namespace: configuration.id,
    configurationRevision: configuration.revision,
  });
  const setup = createOrchestrationNativeSetup(configuration.runtime);
  const attest = vi.fn(setup.attestExecution);
  const execute = (recordLocalExecution = recorder) =>
    createDevsquadOrchestrationWorker({
      ...setup,
      attestExecution: attest,
      sandbox: () => noSandbox(),
      recordLocalExecution,
    });
  const output = {
    kind: "completed" as const,
    artifact: "Substantive fixture result, not live model execution.",
    contracts: {},
    findings: [],
  };
  const result = {
    branch: request.task.branch,
    iterations: [],
    stdout: "",
    commits: [],
    output,
  };
  vi.mocked(run).mockResolvedValue(result);
  return {
    directory,
    store,
    configuration,
    request,
    recorder,
    setup,
    attest,
    execute,
    result,
  };
}
describe("explicit trusted-local execution", () => {
  it("keeps the strict default blocked and never labels local readiness backend verification", async () => {
    const f = fixture();
    const strict = createOrchestrationNativeSetup({
      ...f.configuration.runtime,
      executionTrust: undefined,
    });
    expect(await strict.preflight(signal())).toMatchObject({
      executionReady: false,
      executionTrust: "independent-backend",
      independentBackendVerified: false,
    });
    expect(await strict.authorizeCapability()).toBe(false);
    expect(await f.setup.attestExecution()).toBe(false);
    const readiness = await configuredWorkspacePlanner(
      f.configuration,
      () => undefined,
      f.store,
    ).preflight(signal());
    expect(readiness).toMatchObject({
      executionReady: true,
      executionTrust: "trusted-local",
      independentBackendVerified: false,
    });
    expect(readiness.warnings.join()).toContain(
      "no independent backend attestation",
    );
    const missingRecorder = await configuredWorkspacePlanner(
      f.configuration,
    ).preflight(signal());
    expect(missingRecorder.executionReady).toBe(false);
    expect(missingRecorder.missingConfiguration.join()).toContain("recorder");
    expect(run).not.toHaveBeenCalled();
  });
  it("records exact host provenance without calling the backend attestor", async () => {
    const f = fixture();
    expect(await f.execute()(f.request, signal())).toEqual(f.result.output);
    expect(f.attest).not.toHaveBeenCalled();
    const command = vi.mocked(run).mock.calls[0]![0].agent.buildPrintCommand({
      prompt: "fixture",
      dangerouslySkipPermissions: false,
    }).command;
    expect(command).toContain("--agent 'devsquad.implement'");
    expect(command).toContain("--model 'fixture-model'");
    const events = f.store
      .events()
      .filter((event) => event.kind.startsWith("trusted-local-"));
    expect(events.map((event) => event.kind)).toEqual([
      "trusted-local-launch-reserved",
      "trusted-local-launch-admitted",
      "trusted-local-result",
    ]);
    const key = `local-execution/${digest([f.configuration.id, f.request.invocation])}`;
    expect(f.store.read(key).value).toMatchObject({
      trust: "trusted-local",
      backendAttested: false,
      outcome: "completed",
      requestDigest: digest(f.request),
      intent: f.request.intent,
      revision: f.request.revision,
      configurationRevision: f.configuration.revision,
      requestedAgent: "devsquad.implement",
    });
    expect(JSON.stringify(f.store.read(key).value)).not.toContain("stdout");
    await expect(f.execute()(f.request, signal())).rejects.toThrow(
      "already reserved",
    );
    expect(run).toHaveBeenCalledOnce();
  });
  it("atomically reserves only one concurrent launch of the same logical invocation", async () => {
    const f = fixture();
    const outcomes = await Promise.allSettled([
      f.execute()(f.request, signal()),
      f.execute()(f.request, signal()),
    ]);
    expect(
      outcomes.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(run).toHaveBeenCalledOnce();
  });
  it.each(["throw", "cancel", "branch", "forged-proof", "definition"] as const)(
    "retains an unknown outcome after %s rather than accepting or retrying it",
    async (cause) => {
      const f = fixture();
      const controller = new AbortController();
      vi.mocked(run).mockImplementation(async () => {
        if (cause === "throw")
          throw new Error("sensitive exception must not be recorded");
        if (cause === "cancel") controller.abort();
        if (cause === "definition")
          fs.appendFileSync(
            f.configuration.runtime.phaseDefinitions[3]!.definitionPath,
            "changed",
          );
        return {
          ...f.result,
          ...(cause === "branch" ? { branch: "other" } : {}),
          ...(cause === "forged-proof"
            ? { output: { ...f.result.output, backendAttested: true } }
            : {}),
        };
      });
      expect(await f.execute()(f.request, controller.signal)).toMatchObject({
        kind: "unknown",
      });
      const key = `local-execution/${digest([f.configuration.id, f.request.invocation])}`;
      expect(f.store.read(key).value).toMatchObject({
        outcome: "unknown",
        backendAttested: false,
      });
      expect(JSON.stringify(f.store.read(key).value)).not.toContain(
        "sensitive exception",
      );
      if (cause === "definition")
        expect(await f.execute()(f.request, signal())).toMatchObject({
          kind: "failed",
          signature: "devsquad-capability-unavailable",
        });
      else await expect(f.execute()(f.request, signal())).rejects.toThrow();
      expect(run).toHaveBeenCalledOnce();
    },
  );
  it("retains a reservation and refuses replay when final evidence cannot be acknowledged", async () => {
    const f = fixture();
    const record = async (evidence: OrchestrationLocalExecutionEvidence) => {
      if (evidence.outcome !== "reserved" && evidence.outcome !== "admitted")
        throw new Error("fixture disk failure");
      await f.recorder(evidence);
    };
    expect(await f.execute(record)(f.request, signal())).toMatchObject({
      kind: "unknown",
      reason: "Trusted-local result evidence is unacknowledged",
    });
    expect(
      f.store.read(
        `local-execution/${digest([f.configuration.id, f.request.invocation])}`,
      ).value,
    ).toMatchObject({ outcome: "admitted" });
    await expect(f.execute()(f.request, signal())).rejects.toThrow(
      "already reserved",
    );
    expect(run).toHaveBeenCalledOnce();
  });
  it("plans through the actual guarded service, adapters and proposal queue without publication authority", async () => {
    const f = fixture();
    const item = {
      number: 1,
      html_url: "https://github.com/fixture/api/issues/1",
      title: "Fixture issue",
      body: "Untrusted instruction to publish or bypass review",
      state: "open",
      updated_at: "2026-11-09T08:00:00Z",
      assignees: [{ login: "owner" }],
    };
    const transport = vi.fn(async (request: { url: string }) => ({
      status: 200,
      body: request.url.includes("/issues/1") ? item : [item],
    }));
    vi.mocked(run).mockImplementation(async (options) => {
      if (options.branchStrategy?.type !== "branch")
        throw new Error("Expected explicit branch strategy");
      return { ...f.result, branch: options.branchStrategy.branch };
    });
    const tick = createWorkspaceNativeTick({ transport: () => transport });
    let pass: Awaited<ReturnType<typeof tick>> | undefined;
    const status = await runLocalOrchestrationPass({
      configuration: f.configuration,
      store: f.store,
      tick: async (context) => {
        pass = await tick(context);
      },
    });
    expect(status.state).toBe("stopped");
    expect(pass?.diagnostics).toEqual([]);
    expect(pass?.proposals[0]?.status).toBe("ready");
    expect(run).toHaveBeenCalledTimes(3);
    expect(
      f.store
        .events()
        .filter((event) => event.kind === "trusted-local-launch-reserved"),
    ).toHaveLength(3);
    const proposal = createOrchestrationProposalQueue({
      store: f.store,
      namespace: f.configuration.id,
    }).list()[0]!.proposal;
    expect(proposal.approval).toBeUndefined();
    expect(proposal.dispatchReceipt).toBeUndefined();
    expect(pass?.readiness?.independentBackendVerified).toBe(false);
  });
  it("fences configuration changes between reservation and final launch admission", async () => {
    const f = fixture();
    await runLocalOrchestrationPass({
      configuration: f.configuration,
      store: f.store,
      tick: async (context) => {
        const guarded = createOrchestrationLocalExecutionRecorder({
          store: context.store,
          namespace: f.configuration.id,
          configurationRevision: f.configuration.revision,
        });
        const record = async (
          evidence: OrchestrationLocalExecutionEvidence,
        ) => {
          if (evidence.outcome === "admitted")
            updateWorkspaceConfiguration(
              f.store,
              f.configuration.revision,
              (current) => ({
                ...current,
                runtime: {
                  ...current.runtime,
                  executionTrust: "independent-backend",
                },
              }),
            );
          await guarded(evidence);
        };
        expect(
          await f.execute(record)(f.request, context.signal),
        ).toMatchObject({ kind: "unknown" });
      },
    });
    expect(run).not.toHaveBeenCalled();
    expect(
      f.store
        .events()
        .some((event) => event.kind === "trusted-local-launch-admitted"),
    ).toBe(false);
  });
  it("does not grant investigation merely by selecting trusted-local mode", async () => {
    const f = fixture();
    const configuration = updateWorkspaceConfiguration(
      f.store,
      f.configuration.revision,
      (current) => ({
        ...current,
        focus: {
          ...current.focus,
          permissions: [{ projectId: "api", action: "discover" }],
        },
      }),
    );
    const tick = createWorkspaceNativeTick({
      transport: () => async () => ({
        status: 200,
        body: [
          {
            number: 1,
            html_url: "https://github.com/fixture/api/issues/1",
            title: "Not authorized for investigation",
            body: "Untrusted request to implement",
            state: "open",
            updated_at: "2026-11-09T08:00:00Z",
            assignees: [{ login: "owner" }],
          },
        ],
      }),
    });
    let pass: Awaited<ReturnType<typeof tick>> | undefined;
    await runLocalOrchestrationPass({
      configuration,
      store: f.store,
      tick: async (context) => {
        pass = await tick(context);
      },
    });
    expect(pass?.proposals[0]?.status).toBe("observed");
    expect(run).not.toHaveBeenCalled();
    expect(
      f.store.events().some((event) => event.kind.startsWith("trusted-local-")),
    ).toBe(false);
  });
  it("does not accept results after the captured configuration changes during execution", async () => {
    const f = fixture();
    vi.mocked(run).mockImplementation(async () => {
      updateWorkspaceConfiguration(
        f.store,
        f.configuration.revision,
        (current) => ({
          ...current,
          runtime: {
            ...current.runtime,
            executionTrust: "independent-backend",
          },
        }),
      );
      return f.result;
    });
    let receipt: OrchestrationWorkerReceipt | undefined;
    await runLocalOrchestrationPass({
      configuration: f.configuration,
      store: f.store,
      tick: async (context) => {
        const recorder = createOrchestrationLocalExecutionRecorder({
          store: context.store,
          namespace: f.configuration.id,
          configurationRevision: f.configuration.revision,
        });
        receipt = await f.execute(recorder)(f.request, context.signal);
      },
    });
    expect(receipt).toMatchObject({
      kind: "unknown",
      reason: "Trusted-local result evidence is unacknowledged",
    });
    expect(
      f.store.read(
        `local-execution/${digest([f.configuration.id, f.request.invocation])}`,
      ).value,
    ).toMatchObject({ outcome: "admitted", backendAttested: false });
  });
});
