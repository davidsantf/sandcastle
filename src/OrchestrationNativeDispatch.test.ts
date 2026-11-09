import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "./run.js";
import {
  OrchestrationWorkspaceStore,
  initializeWorkspace,
  updateWorkspaceConfiguration,
} from "./OrchestrationWorkspace.js";
import { createWorkspaceNativeTick } from "./OrchestrationWorkspaceHost.js";
import { createWorkspaceNativeDispatcher } from "./OrchestrationNativeDispatch.js";
import { createConfiguredDevsquadProposalPlanner } from "./OrchestrationNativeHost.js";
import { evaluateOrchestrationFocus } from "./OrchestrationFocus.js";
import { noSandbox } from "./sandboxes/no-sandbox.js";
import { createOrchestrationProposalQueue } from "./OrchestrationProposal.js";
import {
  createOrchestrationDiscoveryAdapter,
  type OrchestrationDiscoveredItem,
} from "./OrchestrationDiscovery.js";
import { runLocalOrchestrationPass } from "./LocalOrchestrationService.js";
import { MultiProjectJournal } from "./MultiProjectJournal.js";
import { type OrchestrationWorkerRequest } from "./MultiProjectProtocol.js";
import { readOrchestrationOperationSummary } from "./OrchestrationOperations.js";
import type { WorkspaceFocus } from "./OrchestrationWorkspaceContract.js";
import type { CopilotExecutionControls } from "./CopilotExecutionControls.js";

const controlledHelp =
  "--agent --model --max-ai-credits --max-autopilot-continues --available-tools --allow-tool --deny-tool --disable-builtin-mcps --disable-mcp-server --no-custom-instructions --no-auto-update --no-ask-user --disallow-temp-dir --sync-session";
let nativeHelp = controlledHelp;

vi.mock("./run.js", () => ({ run: vi.fn() }));
vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof import("node:child_process")>();
  return {
    ...actual,
    execFile: vi.fn((command, args, options, callback) => {
      if (command === "copilot")
        callback(
          null,
          args[0] === "--version" ? "GitHub Copilot CLI 1.0.106." : nativeHelp,
        );
      else actual.execFile(command, args, options, callback);
    }),
  };
});
const fixtures: { directory: string; store: OrchestrationWorkspaceStore }[] =
  [];
afterEach(() => {
  vi.mocked(run).mockReset();
  nativeHelp = controlledHelp;
  for (const f of fixtures.splice(0)) {
    f.store.close();
    fs.rmSync(f.directory, { recursive: true, force: true });
  }
});
const artifacts = {
  investigation:
    "Fixture investigation: scoped local regression, no live hub assertions.",
  specification:
    "Fixture spec: change only src/value.txt; preserve unrelated behavior.",
  plan: "Fixture plan: implement a scoped local change and retain host verification gates.",
  acceptance: [
    {
      criterion: "Configured regression is evaluated on the changed revision.",
      verification:
        "Run the configured host acceptance command, never accept model prose.",
    },
  ],
};
const signal = () => new AbortController().signal;
const git = (root: string, ...args: string[]) =>
  execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
async function fixture(
  provider: "github" | "ado" = "github",
  mode: WorkspaceFocus["mode"] = "execute",
  implementationGrant = true,
  executionControls?: CopilotExecutionControls,
) {
  const directory = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "native-dispatch-")),
  );
  const repositoryRoot = path.join(directory, "repository");
  fs.mkdirSync(path.join(repositoryRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(repositoryRoot, "src", "value.txt"), "baseline\n");
  git(repositoryRoot, "init", "-b", "main");
  git(repositoryRoot, "add", ".");
  git(
    repositoryRoot,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "fixture baseline",
  );
  git(
    repositoryRoot,
    "remote",
    "add",
    "origin",
    provider === "github"
      ? "https://github.com/fixture/api.git"
      : "https://dev.azure.com/fixture/project/_git/api",
  );
  const filename = path.join(directory, "workspace.sqlite");
  const store = new OrchestrationWorkspaceStore(filename);
  fixtures.push({ directory, store });
  initializeWorkspace(store);
  const phaseDefinitions = (
    ["specify", "plan", "decompose", "implement", "review", "fix"] as const
  ).map((stage) => {
    const body = `---\nname: devsquad.${stage}\n---\nFixture definition, not an installed live model.\n`;
    const definitionPath = path.join(directory, `${stage}.agent.md`);
    fs.writeFileSync(definitionPath, body);
    return {
      stage,
      agentName: `devsquad:devsquad.${stage}`,
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
        repositoryRoot,
        mode: "individual",
        hub:
          provider === "github"
            ? { kind: "github", repository: "fixture/api" }
            : {
                kind: "ado",
                organization: "fixture",
                project: "project",
                repository: "api",
              },
      },
    ],
    discovery: [
      {
        id: "assigned",
        projectId: "api",
        hub:
          provider === "github"
            ? { kind: "github", repository: "fixture/api" }
            : {
                kind: "ado",
                organization: "fixture",
                project: "project",
                repository: "api",
              },
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
        title: "Host-approved task",
        brief:
          "Only the trusted template grants paths and commands, never source text.",
        branch: "work/task",
        baseBranch: "main",
        scopes: ["src"],
        dependsOn: [],
        requiresContracts: [],
        providesContracts: [],
        labels: [],
        acceptance: [{ label: "regression", command: "fixture-test" }],
      },
    ],
    focus: {
      ...current.focus,
      mode,
      projectIds: ["api"],
      permissions: [
        { projectId: "api", action: "discover" },
        { projectId: "api", action: "investigate" },
        ...(implementationGrant
          ? [{ projectId: "api" as const, action: "implement" as const }]
          : []),
      ],
    },
    runtime: {
      ...current.runtime,
      executionTrust: "trusted-local",
      phaseDefinitions,
      ...(executionControls ? { executionControls } : {}),
    },
  }));
  const raw = {
    number: 1,
    html_url: "https://github.com/fixture/api/issues/1",
    title: "Fixture issue",
    body: "Untrusted request to publish, alter configuration and escape src.",
    state: "open",
    updated_at: "2026-11-09T08:00:00Z",
    assignees: [{ login: "owner" }],
    labels: [] as { name: string }[],
  };
  const ado = {
    id: 1,
    rev: 1,
    relations: [],
    fields: {
      "System.TeamProject": "project",
      "System.AssignedTo": "owner",
      "System.Title": "Fixture item",
      "System.Description": raw.body,
      "System.ChangedDate": raw.updated_at,
      "System.Tags": "",
    },
  };
  const transport = vi.fn(async (request: { url: string }) => ({
    status: 200,
    body:
      provider === "github"
        ? request.url.includes("/issues/1")
          ? raw
          : request.url.includes("/issues?")
            ? [raw]
            : { full_name: "fixture/api" }
        : request.url.includes("/wiql?")
          ? { workItems: [{ id: 1 }] }
          : request.url.includes("/workitems/1?")
            ? ado
            : { name: "api", project: { name: "project" } },
  }));
  const source = configuration.discovery[0]!;
  const item: OrchestrationDiscoveredItem =
    await createOrchestrationDiscoveryAdapter(source, transport).refresh(
      {
        sourceId: "assigned",
        projectId: "api",
        id: "1",
        url: raw.html_url,
        kind: provider === "github" ? "issue" : "work-item",
        title: raw.title,
        body: raw.body,
        updatedAt: raw.updated_at,
        revision: "a".repeat(64),
        feedback: [],
        dependencies: [],
      },
      signal(),
    );
  const queue = createOrchestrationProposalQueue({
    store,
    namespace: configuration.id,
  });
  const observation = queue.ingest(item, configuration.revision);
  const proposed = await queue.plan(
    observation.id,
    async () => artifacts,
    signal(),
  );
  const proposal = queue.review({
    proposalId: proposed.id,
    proposalDigest: proposed.digest!,
    sourceRevision: proposed.sourceRevision,
    configurationRevision: configuration.revision,
    decision: "approve",
  });
  const requests: OrchestrationWorkerRequest[] = [];
  vi.mocked(run).mockImplementation(async (options) => {
    const prompt = String(options.prompt);
    const request: OrchestrationWorkerRequest = JSON.parse(
      prompt
        .split("Host request (JSON data):\n")[1]!
        .split("\n\nReturn exactly")[0]!,
    );
    requests.push(request);
    git(
      repositoryRoot,
      "checkout",
      "-b",
      request.task.branch,
      request.task.baseBranch,
    );
    fs.writeFileSync(
      path.join(repositoryRoot, "src", "value.txt"),
      "fixture implementation\n",
    );
    git(repositoryRoot, "add", "src/value.txt");
    git(
      repositoryRoot,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-m",
      "fixture scoped implementation",
    );
    return {
      branch: request.task.branch,
      iterations: [],
      stdout: "",
      commits: [],
      output: {
        kind: "completed",
        artifact:
          "Fixture local implementation commit, not live model execution.",
        contracts: {},
        findings: [],
      },
    };
  });
  const tick = createWorkspaceNativeTick({
    transport: () => transport,
    invoke: run,
  });
  const pass = async (activeConfiguration = configuration) => {
    let result: Awaited<ReturnType<typeof tick>> | undefined;
    const status = await runLocalOrchestrationPass({
      configuration: activeConfiguration,
      store,
      tick: async (context) => {
        result = await tick({ ...context, journalPath: filename });
      },
    });
    return { result, status };
  };
  return {
    directory,
    filename,
    repositoryRoot,
    store,
    configuration,
    source,
    item,
    raw,
    ado,
    queue,
    proposal,
    transport,
    requests,
    pass,
  };
}
describe("built-in native implementation lifecycle (fixture runner and hub)", () => {
  const controls: CopilotExecutionControls = {
    profile: "local-files",
    maxAiCredits: 30,
    maxAutopilotContinues: 0,
    timeoutMs: 2000,
    disabledMcpServers: ["fixture-server"],
  };
  it("keeps the same runtime controls on every configured proposal-planning phase", async () => {
    const f = await fixture("github", "propose", false, controls);
    vi.mocked(run).mockImplementation(async (options) => ({
      branch: JSON.parse(
        String(options.prompt)
          .split("Host request (JSON data):\n")[1]!
          .split("\n\nReturn exactly")[0]!,
      ).task.branch,
      iterations: [],
      stdout: "",
      commits: [],
      output: {
        kind: "completed",
        artifact: "Fixture substantive planning artifact.",
        contracts: {},
        findings: [],
      },
    }));
    const planner = createConfiguredDevsquadProposalPlanner({
      configuration: f.configuration,
      tasks: f.configuration.taskTemplates,
      evaluateFocus: evaluateOrchestrationFocus,
      sandbox: () => noSandbox(),
      recordLocalExecution: async () => {},
      transport: () => f.transport,
    });
    expect(
      (await planner.plan(f.item, f.configuration, signal())).plan,
    ).toContain("Fixture");
    expect(run).toHaveBeenCalledTimes(3);
    for (const [options] of vi.mocked(run).mock.calls) {
      const command = options.agent.buildPrintCommand({
        prompt: "fixture",
        dangerouslySkipPermissions: true,
      });
      expect(command.process).toMatchObject({
        file: "copilot",
        timeoutMs: 2000,
        scopedFiles: ["src"],
      });
      expect(command.process!.args.join("\0")).toContain(
        "--disable-mcp-server\0fixture-server",
      );
      expect(command.process!.args).not.toContain("--allow-all-tools");
    }
  });
  it("propagates revisioned runtime controls through public native tick to actual provider argv", async () => {
    const f = await fixture("github", "execute", true, controls);
    await f.pass();
    expect(run).toHaveBeenCalledOnce();
    const launch = vi.mocked(run).mock.calls[0]![0];
    const process = launch.agent.buildPrintCommand({
      prompt: "fixture",
      dangerouslySkipPermissions: true,
    }).process;
    expect(process).toMatchObject({
      file: "copilot",
      timeoutMs: 2000,
      scopedFiles: ["src"],
    });
    expect(process!.args.join("\0")).toContain("--max-ai-credits\0" + "30");
    expect(process!.args.join("\0")).toContain(
      "--disable-mcp-server\0fixture-server",
    );
    expect(launch.agent.env).toMatchObject({ COPILOT_ALLOW_ALL: "false" });
    const record = f.store
      .events()
      .find((event) => event.kind === "trusted-local-launch-admitted")!;
    expect(f.store.read(record.key).value).toHaveProperty(
      "executionControlsDigest",
    );
  });
  it("blocks unsupported native control flags before operation/launch reservation", async () => {
    const f = await fixture("github", "execute", true, controls);
    nativeHelp = "--agent --model";
    const { result } = await f.pass();
    expect(result!.status).toBe("blocked");
    expect(result!.diagnostics.join()).toContain("execution-control flags");
    expect(run).not.toHaveBeenCalled();
    expect(
      f.store
        .events()
        .some((event) => event.kind === "trusted-local-launch-reserved"),
    ).toBe(false);
    expect(result!.lifecycles).toEqual([]);
  });
  it.each(["github", "ado"] as const)(
    "dispatches an approved %s proposal through the real lifecycle, not publication",
    async (provider) => {
      const f = await fixture(provider);
      const { result, status } = await f.pass();
      expect(status.state).toBe("stopped");
      expect(run).toHaveBeenCalledOnce();
      expect(f.requests[0]).toMatchObject({
        stage: "implement",
        artifacts: { specify: artifacts.specification, plan: artifacts.plan },
        task: {
          scopes: ["src"],
          acceptance: [{ command: "fixture-test" }],
          sourceItem: { id: "1" },
        },
      });
      expect(f.requests[0]!.task.sourceItem?.cause.recordKey).toMatch(
        /^native-proposal:/,
      );
      expect(f.requests[0]!.task.brief).not.toContain("Untrusted request");
      expect(result?.lifecycles[0]?.tasks[0]).toMatchObject({
        status: "needs-input",
        implementationRecorded: true,
      });
      expect(result?.lifecycles[0]?.tasks[0]?.reason).toContain("independent");
      expect(result?.status).toBe("partial");
      expect(f.queue.get(f.proposal.id).proposal).toMatchObject({
        status: "dispatched",
        dispatchReceipt: expect.stringMatching(/^native-admission:/),
      });
      expect(
        readOrchestrationOperationSummary(f.store, f.configuration.id).reserved,
      ).toBe(0);
      const journal = new MultiProjectJournal(f.filename);
      try {
        expect(journal.allReservations()).toHaveLength(1);
        expect(
          journal
            .events(result!.lifecycles[0]!.runId)
            .some((e) => e.kind === "native-approved-artifacts-seeded"),
        ).toBe(true);
      } finally {
        journal.close();
      }
      await f.pass();
      expect(run).toHaveBeenCalledOnce();
      expect(
        f.store
          .events()
          .filter((e) => e.kind === "trusted-local-launch-admitted"),
      ).toHaveLength(1);
      const launch = f.store
        .events()
        .find((e) => e.kind === "trusted-local-launch-admitted")!;
      expect(f.store.read(launch.key).value).toMatchObject({
        requestedAgent: "devsquad:devsquad.implement",
        backendAttested: false,
      });
      git(f.repositoryRoot, "checkout", "main");
      git(f.repositoryRoot, "branch", "-D", f.requests[0]!.task.branch);
      expect(git(f.repositoryRoot, "status", "--porcelain")).toBe("");
      const reconciled = new MultiProjectJournal(f.filename);
      const lease = reconciled.claim(30_000);
      try {
        reconciled.reconcile(
          result!.lifecycles[0]!.runId,
          lease,
          result!.lifecycles[0]!.tasks[0]!.key,
          "abandon",
          "Fixture host verified worker settled, generated branch removed and checkout clean.",
        );
        expect(reconciled.allReservations()).toHaveLength(0);
      } finally {
        reconciled.release(lease);
        reconciled.close();
      }
    },
  );
  it.each(["observe", "propose"] as const)(
    "does not admit approved implementations in %s mode",
    async (mode) => {
      const f = await fixture("github", mode);
      await f.pass();
      expect(run).not.toHaveBeenCalled();
      expect(
        f.store.events().some((e) => e.kind === "native-lifecycle-admitted"),
      ).toBe(false);
    },
  );
  it("requires an explicit implement grant despite approval and trusted-local opt-in", async () => {
    const f = await fixture("github", "execute", false);
    await f.pass();
    expect(run).not.toHaveBeenCalled();
    expect(
      f.store.events().some((e) => e.kind === "native-lifecycle-admitted"),
    ).toBe(false);
  });
  it("refreshes source revisions and human-stop labels before admission", async () => {
    const f = await fixture();
    f.raw.labels.push({ name: "needs-human" });
    await f.pass();
    expect(run).not.toHaveBeenCalled();
    expect(f.queue.get(f.proposal.id).proposal.status).toBe("superseded");
    expect(
      f.store.events().some((e) => e.kind === "native-lifecycle-admitted"),
    ).toBe(false);
  });
  it("rejects forged proposal approval before core admission", async () => {
    const f = await fixture();
    let diagnostic = "";
    await runLocalOrchestrationPass({
      configuration: f.configuration,
      store: f.store,
      tick: async (context) => {
        const dispatch = createWorkspaceNativeDispatcher({
          context: { ...context, journalPath: f.filename },
          transport: () => f.transport,
          invoke: run,
        });
        try {
          await dispatch.dispatch(
            f.item,
            {
              ...f.proposal,
              digest: "forged",
            },
            context.signal,
          );
        } catch (error) {
          diagnostic = String(error);
        }
      },
    });
    expect(diagnostic).toContain("exact approved");
    expect(run).not.toHaveBeenCalled();
    expect(
      f.store.events().some((e) => e.kind === "native-lifecycle-admitted"),
    ).toBe(false);
  });
  it("retains old lifecycle evidence across configuration changes without new effects", async () => {
    const f = await fixture();
    await f.pass();
    const configuration = updateWorkspaceConfiguration(
      f.store,
      f.configuration.revision,
      (current) => ({
        ...current,
        discovery: [],
        focus: { ...current.focus, projectIds: [], permissions: [] },
        runtime: { ...current.runtime, executionTrust: "independent-backend" },
      }),
    );
    const { result } = await f.pass(configuration);
    expect(result?.lifecycles[0]).toMatchObject({
      currentConfiguration: false,
      tasks: [{ status: "needs-input", implementationRecorded: true }],
    });
    expect(run).toHaveBeenCalledOnce();
  });
  it("checks workspace guards inside core transactions, not only before a call", async () => {
    const f = await fixture();
    let guardError: unknown;
    await runLocalOrchestrationPass({
      configuration: f.configuration,
      store: f.store,
      tick: async (context) => {
        const journal = new MultiProjectJournal(
          f.filename,
          Date.now,
          context.store.guards!(),
        );
        updateWorkspaceConfiguration(
          f.store,
          f.configuration.revision,
          (current) => ({ ...current, pollIntervalMs: 2000 }),
        );
        try {
          journal.claim(30_000);
        } catch (error) {
          guardError = error;
        } finally {
          journal.close();
        }
      },
    });
    expect(guardError).toBeInstanceOf(Error);
    expect(String(guardError)).toContain("ownership guard");
    expect(run).not.toHaveBeenCalled();
  });
  it("fences a configuration mutation between local reservation and admission", async () => {
    const f = await fixture();
    const implementation = f.transport.getMockImplementation()!;
    let changed = false;
    f.transport.mockImplementation(async (request) => {
      if (
        !changed &&
        f.store.events().some((e) => e.kind === "trusted-local-launch-reserved")
      ) {
        changed = true;
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
      }
      return implementation(request);
    });
    const { status, result } = await f.pass();
    expect(changed).toBe(true);
    expect(status.evidence).toContainEqual(
      expect.objectContaining({
        state: "blocked",
        diagnostic: "host-action-unacknowledged: reconcile; do not retry",
      }),
    );
    expect(result?.status).toBe("partial");
    expect(run).not.toHaveBeenCalled();
    expect(
      f.store.events().some((e) => e.kind === "trusted-local-launch-admitted"),
    ).toBe(false);
  });
  it("retains an unknown implementation outcome and never repeats the invocation", async () => {
    const f = await fixture();
    vi.mocked(run).mockRejectedValue(
      new Error("Fixture transport failed after possible effect"),
    );
    const { result } = await f.pass();
    expect(result?.lifecycles[0]?.tasks[0]?.status).toBe("unknown");
    await f.pass();
    expect(run).toHaveBeenCalledOnce();
    const journal = new MultiProjectJournal(f.filename);
    try {
      expect(journal.allReservations()).toHaveLength(1);
    } finally {
      journal.close();
    }
  });
  it("blocks a mismatching origin before the worker can launch", async () => {
    const f = await fixture();
    git(
      f.repositoryRoot,
      "remote",
      "set-url",
      "origin",
      "https://github.com/fixture/wrong",
    );
    await f.pass();
    expect(run).not.toHaveBeenCalled();
    expect(f.queue.get(f.proposal.id).proposal.status).toBe("unknown");
  });
  it("does not let a stale retained lane prevent recovery of another admitted source", async () => {
    const f = await fixture();
    const secondRaw = {
      ...f.raw,
      number: 2,
      html_url: "https://github.com/fixture/api/issues/2",
    };
    const original = f.transport.getMockImplementation()!;
    f.transport.mockImplementation(async (request) =>
      request.url.includes("/issues/2")
        ? { status: 200, body: secondRaw }
        : original(request),
    );
    const second = await createOrchestrationDiscoveryAdapter(
      f.source,
      f.transport,
    ).refresh({ ...f.item, id: "2", url: secondRaw.html_url }, signal());
    const observation = f.queue.ingest(second, f.configuration.revision);
    const planned = await f.queue.plan(
      observation.id,
      async () => artifacts,
      signal(),
    );
    const proposal = f.queue.review({
      proposalId: planned.id,
      proposalDigest: planned.digest!,
      sourceRevision: planned.sourceRevision,
      configurationRevision: planned.configurationRevision,
      decision: "approve",
    });
    await runLocalOrchestrationPass({
      configuration: f.configuration,
      store: f.store,
      tick: async (context) => {
        const dispatcher = createWorkspaceNativeDispatcher({
          context: { ...context, journalPath: f.filename },
          transport: () => f.transport,
          invoke: run,
        });
        for (const id of [f.proposal.id, proposal.id]) {
          await f.queue.execute(
            { proposalId: id, configurationRevision: f.configuration.revision },
            {
              authorize: () => true,
              refresh: async (item) => item,
              dispatch: (item, approved) =>
                dispatcher.dispatch(item, approved, AbortSignal.abort()),
            },
            context.signal,
          );
        }
      },
    });
    f.raw.body = "Changed source invalidates the first retained approval.";
    const observed: {
      diagnostics: string[];
      implementationRecorded?: boolean;
    } = { diagnostics: [] };
    await runLocalOrchestrationPass({
      configuration: f.configuration,
      store: f.store,
      tick: async (context) => {
        const dispatcher = createWorkspaceNativeDispatcher({
          context: { ...context, journalPath: f.filename },
          transport: () => f.transport,
          invoke: run,
        });
        observed.diagnostics = await dispatcher.recover(context.signal);
        observed.implementationRecorded = dispatcher
          .summaries()
          .find(
            (entry) => entry.proposalId === proposal.id,
          )?.tasks[0]?.implementationRecorded;
      },
    });
    expect(run).toHaveBeenCalledOnce();
    expect(
      observed.diagnostics.some(
        (entry) =>
          entry.includes(f.proposal.id) && entry.includes("reconciliation"),
      ),
    ).toBe(true);
    expect(observed.implementationRecorded).toBe(true);
  });
  it("exposes retained real lifecycle evidence through compiled manual and service commands", async () => {
    const f = await fixture();
    const first = await f.pass();
    updateWorkspaceConfiguration(
      f.store,
      f.configuration.revision,
      (current) => ({
        ...current,
        discovery: [],
        focus: { ...current.focus, projectIds: [], permissions: [] },
      }),
    );
    const cliArgs = (command: string) => [
      path.resolve("dist", "main.js"),
      "orchestrate",
      "workspace",
      command,
      "--database",
      f.filename,
    ];
    let manual = "";
    try {
      execFileSync(process.execPath, cliArgs("run"), {
        encoding: "utf8",
        stdio: "pipe",
        timeout: 30_000,
      });
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "status" in error &&
        error.status === 2 &&
        "stdout" in error
      )
        manual = String(error.stdout);
      else throw error;
    }
    expect(JSON.parse(manual).lastPass.result.lifecycles).toMatchObject([
      {
        runId: first.result!.lifecycles[0]!.runId,
        currentConfiguration: false,
        tasks: [{ status: "needs-input", implementationRecorded: true }],
      },
    ]);
    const controls = path.join(f.directory, "controls");
    const child = spawn(
      process.execPath,
      [...cliArgs("start"), "--control-directory", controls],
      {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    const done = new Promise((resolve) => child.once("exit", resolve));
    let stdout = "",
      stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Fixture service readiness: ${stderr}`)),
          40_000,
        );
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once("exit", () => {
          clearTimeout(timer);
          reject(new Error(`Fixture service exited: ${stderr}`));
        });
        child.stdout.on("data", (chunk: Buffer) => {
          stdout += chunk.toString();
          if (stdout.includes('"event":"service-ready"')) {
            clearTimeout(timer);
            resolve();
          }
        });
      });
      const pass = stdout
        .split(/\r?\n/)
        .filter((line) => line.startsWith("{"))
        .map((line) => JSON.parse(line))
        .find((entry) => entry.event === "workspace-pass");
      expect(pass.result.lifecycles[0].tasks[0]).toMatchObject({
        implementationRecorded: true,
      });
      execFileSync(
        process.execPath,
        [...cliArgs("stop"), "--control-directory", controls],
        {
          stdio: "pipe",
          timeout: 30_000,
        },
      );
      expect(await done).toBe(0);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await done;
    }
    expect(run).toHaveBeenCalledOnce();
  }, 80_000);
  it.each(["admission", "initialize", "binding", "seed", "running"])(
    "recovers a real process exit after %s without duplicate implementation",
    async (phase) => {
      const f = await fixture();
      const fixtureData = path.join(f.directory, "process-fixture.json");
      fs.writeFileSync(
        fixtureData,
        JSON.stringify({
          filename: f.filename,
          raw: f.raw,
          proposalId: f.proposal.id,
          phase,
        }),
      );
      const script = path.join(f.directory, "crash.mjs");
      const entrypoint = pathToFileURL(path.resolve("dist", "index.js")).href;
      fs.writeFileSync(
        script,
        `
import fs from "node:fs";
import {
  OrchestrationWorkspaceStore, readWorkspaceConfiguration, runLocalOrchestrationPass,
  createWorkspaceNativeDispatcher, createOrchestrationProposalQueue, MultiProjectJournal,
} from ${JSON.stringify(entrypoint)};
const data = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const actualNow = Date.now;
Date.now = () => actualNow() - 60000; // Fixture-only: expire the dead core owner without a 30s sleep.
for (const [phase, method] of [["initialize", "initialize"], ["binding", "compareAndSwapHostRecord"], ["seed", "checkpoint"]]) {
  if (data.phase !== phase) continue;
  const original = MultiProjectJournal.prototype[method];
  MultiProjectJournal.prototype[method] = function(...args) {
    const result = original.apply(this, args);
    if (phase !== "seed" || args[5] === "native-approved-artifacts-seeded") process.exit(19);
    return result;
  };
}
const store = new OrchestrationWorkspaceStore(data.filename);
const configuration = readWorkspaceConfiguration(store);
const transport = async () => ({status: 200, body: data.raw});
await runLocalOrchestrationPass({
  configuration, store,
  tick: async (context) => {
    const guardedStore = {
      ...context.store,
      compareAndSwap(...args) {
        const result = context.store.compareAndSwap(...args);
        if (data.phase === "admission" && args[3]?.kind === "native-lifecycle-admitted") process.exit(19);
        return result;
      },
    };
    const dispatcher = createWorkspaceNativeDispatcher({
      context: {...context, store: guardedStore, journalPath: data.filename}, transport: () => transport,
      invoke: async () => process.exit(19),
    });
    const queue = createOrchestrationProposalQueue({store: context.store, namespace: configuration.id});
    const proposal = queue.get(data.proposalId).proposal;
    await context.operations.perform({
      id: "proposal:" + proposal.id + ":dispatch", projectId: "api", action: "implement",
      intent: {proposalDigest: proposal.digest, sourceRevision: proposal.sourceRevision, configurationRevision: configuration.revision},
    }, (signal) => queue.execute({
      proposalId: proposal.id, configurationRevision: configuration.revision,
    }, {
      authorize: () => true,
      refresh: async (item) => item,
      dispatch: (item, approved, signal) => dispatcher.dispatch(item, approved, signal),
    }, signal));
  },
});
store.close();
process.exit(20);
`,
      );
      let exitCode = 0;
      try {
        execFileSync(process.execPath, [script, fixtureData], {
          timeout: 30_000,
          stdio: "pipe",
        });
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "status" in error &&
          typeof error.status === "number"
        )
          exitCode = error.status;
        else throw error;
      }
      expect(exitCode).toBe(19);
      const { result, status } = await f.pass();
      expect(status.state).toBe("stopped");
      expect(result?.lifecycles).toHaveLength(1);
      if (phase === "running") {
        expect(run).not.toHaveBeenCalled();
        expect(result?.lifecycles[0]?.tasks[0]?.status).toBe("unknown");
      } else {
        expect(run).toHaveBeenCalledOnce();
        expect(result?.lifecycles[0]?.tasks[0]).toMatchObject({
          status: "needs-input",
          implementationRecorded: true,
        });
      }
      await f.pass();
      expect(run).toHaveBeenCalledTimes(phase === "running" ? 0 : 1);
      expect(
        readOrchestrationOperationSummary(f.store, f.configuration.id).reserved,
      ).toBe(1);
    },
    60_000,
  );
});
