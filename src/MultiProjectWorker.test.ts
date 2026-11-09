import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { claudeCode } from "./AgentProvider.js";
import { createBindMountSandboxProvider } from "./SandboxProvider.js";
import { run } from "./run.js";
import {
  createSandcastleOrchestrationWorker,
  createDevsquadOrchestrationWorker,
  resolveOrchestrationGitRevision,
  type DevsquadPhaseCapability,
} from "./MultiProjectWorker.js";
import { createMultiProjectSandcastleHost } from "./MultiProjectHostFactory.js";
import { runMultiProjectEntrypoint } from "./MultiProjectEntrypoint.js";
import {
  digest,
  type OrchestrationProject,
  type OrchestrationTask,
  type OrchestrationWorkerRequest,
} from "./MultiProjectProtocol.js";

vi.mock("./run.js", () => ({ run: vi.fn() }));
const folders: string[] = [];
const signal = (): AbortSignal => new AbortController().signal;
const task: OrchestrationTask = {
  id: "one",
  projectId: "api",
  title: "API",
  brief: "brief",
  branch: "work/one",
  baseBranch: "main",
  scopes: ["src"],
  dependsOn: [],
  requiresContracts: [],
  providesContracts: [],
  acceptance: [{ label: "unit", command: "test" }],
  labels: [],
};
const project: OrchestrationProject = {
  id: "api",
  repositoryRoot: process.cwd(),
  mode: "individual",
  hub: { kind: "github", repository: "org/api", pullRequest: 7 },
};
const request = (): OrchestrationWorkerRequest => ({
  stage: "implement",
  task,
  project,
  artifacts: {},
  contracts: {},
  invocation: "test",
  intent: digest("test"),
  revision: "a".repeat(40),
  failures: [],
});
const sandbox = createBindMountSandboxProvider({
  name: "fixture",
  create: async () => {
    throw new Error("fixture must not start a sandbox");
  },
});
const agent = claudeCode("fixture-model");
const receipt = {
  kind: "completed",
  artifact: "artifact",
  contracts: {},
  findings: [],
} as const;
const result = {
  branch: task.branch,
  iterations: [],
  stdout: "",
  commits: [],
  output: { ...receipt, findings: [] },
};
beforeEach(() => vi.mocked(run).mockReset());
afterEach(() => {
  for (const folder of folders.splice(0))
    rmSync(folder, { recursive: true, force: true });
});

describe("explicit installed DevSquad execution", () => {
  const capability = (
    stage: DevsquadPhaseCapability["stage"] = "implement",
  ): DevsquadPhaseCapability => ({
    framework: "devsquad",
    provider: "copilot",
    stage,
    capabilityId: `devsquad.${stage}`,
    agentName: `devsquad.${stage === "fix" ? "implement" : stage}`,
    definitionDigest: "d".repeat(64),
    model: { id: "fixture-model", family: "fixture-family" },
    available: true,
  });
  const fixture = (selected: DevsquadPhaseCapability | null = capability()) => {
    const authorizeCapability = vi.fn(async () => true);
    const attestExecution = vi.fn(async () => true);
    const resolveCapability = vi.fn(async () => selected);
    const execute = createDevsquadOrchestrationWorker({
      sandbox: () => sandbox,
      resolveCapability,
      authorizeCapability,
      attestExecution,
    });
    vi.mocked(run).mockResolvedValue(result);
    return { execute, resolveCapability, authorizeCapability, attestExecution };
  };
  it("wires the configured framework executor into the runnable host", async () => {
    const framework = fixture();
    const host = createMultiProjectSandcastleHost({
      execute: framework.execute,
      authorize: async () => true,
      validate: async () => {
        throw new Error("this fixture does not run acceptance");
      },
    });
    expect(await host.execute(request(), signal())).toEqual(receipt);
    expect(framework.authorizeCapability).toHaveBeenCalledOnce();
    expect(framework.attestExecution).toHaveBeenCalledOnce();
  });
  it.each([
    "specify",
    "plan",
    "decompose",
    "implement",
    "fix",
    "review",
  ] as const)(
    "invokes the actual named %s capability through run",
    async (stage) => {
      const selected = capability(stage);
      const host = fixture(selected);
      const input = { ...request(), stage };
      const abort = signal();
      expect(await host.execute(input, abort)).toEqual(receipt);
      const invocation = vi.mocked(run).mock.calls[0]![0];
      expect(
        invocation.agent.buildPrintCommand({
          prompt: "fixture",
          dangerouslySkipPermissions: false,
        }).command,
      ).toContain(`--agent '${selected.agentName}'`);
      expect(invocation.maxIterations).toBe(1);
      expect(invocation.signal).toBe(abort);
      expect(host.authorizeCapability).toHaveBeenCalledWith(
        input,
        selected,
        abort,
      );
      expect(host.attestExecution).toHaveBeenCalledWith(
        input,
        selected,
        result,
        abort,
      );
    },
  );
  it.each([
    null,
    { ...capability(), available: false },
    { ...capability(), stage: "plan" as const },
    { ...capability(), definitionDigest: "unverified" },
  ])(
    "has no generic fallback for unavailable or mismatched capabilities",
    async (selected) => {
      const host = fixture(selected);
      expect(await host.execute(request(), signal())).toMatchObject({
        kind: "failed",
        signature: "devsquad-capability-unavailable",
      });
      expect(run).not.toHaveBeenCalled();
      expect(host.authorizeCapability).not.toHaveBeenCalled();
    },
  );
  it("requires authorization and keeps unattested outcomes unknown", async () => {
    const host = fixture();
    host.authorizeCapability.mockResolvedValue(false);
    expect(await host.execute(request(), signal())).toMatchObject({
      kind: "failed",
      signature: "devsquad-route-not-authorized",
    });
    expect(run).not.toHaveBeenCalled();
    host.authorizeCapability.mockResolvedValue(true);
    host.attestExecution.mockResolvedValue(false);
    expect(await host.execute(request(), signal())).toMatchObject({
      kind: "unknown",
    });
  });
  it("binds authorization to immutable model and agent definitions", async () => {
    const selected = { ...capability(), model: { ...capability().model } };
    const host = fixture(selected);
    host.authorizeCapability.mockImplementation(async () => {
      selected.agentName = "generic";
      selected.model.id = "other-model";
      return true;
    });
    expect(await host.execute(request(), signal())).toEqual(receipt);
    const invocation = vi.mocked(run).mock.calls[0]![0];
    const command = invocation.agent.buildPrintCommand({
      prompt: "fixture",
      dangerouslySkipPermissions: false,
    }).command;
    expect(command).toContain("--agent 'devsquad.implement'");
    expect(command).toContain("--model 'fixture-model'");
    expect(command).not.toContain("generic");
  });
  it("does not dispatch after cancellation or use an agent for host verification", async () => {
    const host = fixture();
    const abort = new AbortController();
    host.authorizeCapability.mockImplementation(async () => {
      abort.abort();
      return true;
    });
    expect(await host.execute(request(), abort.signal)).toMatchObject({
      kind: "unknown",
    });
    await expect(
      host.execute({ ...request(), stage: "verify" }, signal()),
    ).rejects.toThrow(/host/);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("real worker and host wiring", () => {
  it("uses the existing bounded run API with isolated branch strategy, receipt schema, and cancellation", async () => {
    vi.mocked(run).mockResolvedValue(result);
    const execute = createSandcastleOrchestrationWorker({
      agent,
      sandbox: () => sandbox,
    });
    const abort = signal();
    await expect(execute(request(), abort)).resolves.toEqual(receipt);
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: project.repositoryRoot,
        signal: abort,
        agent,
        sandbox,
        maxIterations: 1,
        branchStrategy: {
          type: "branch",
          branch: task.branch,
          baseBranch: task.baseBranch,
        },
        output: expect.objectContaining({ tag: "orchestration-receipt" }),
      }),
    );
  });
  it.each(["wrong-branch", "dirty-worktree"])(
    "keeps %s outcomes unknown",
    async (failure) => {
      vi.mocked(run).mockResolvedValue({
        ...result,
        ...(failure === "wrong-branch"
          ? { branch: "unexpected" }
          : { preservedWorktreePath: "preserved" }),
      });
      const execute = createSandcastleOrchestrationWorker({
        agent,
        sandbox: () => sandbox,
      });
      await expect(execute(request(), signal())).resolves.toMatchObject({
        kind: "unknown",
      });
    },
  );
  it("rejects host verification as a worker phase and invalid authority receipts", async () => {
    const execute = createSandcastleOrchestrationWorker({
      agent,
      sandbox: () => sandbox,
    });
    await expect(
      execute({ ...request(), stage: "verify" }, signal()),
    ).rejects.toThrow(/host/);
    expect(run).not.toHaveBeenCalled();
    const invalid = { ...result, output: { ...result.output, approved: true } };
    vi.mocked(run).mockResolvedValue(invalid);
    await expect(execute(request(), signal())).rejects.toThrow();
  });
  it("routes task-specific PRs and fails closed for mismatched branch bindings or missing ADO capability", async () => {
    const transport = vi.fn(async (url: string) => {
      if (url.includes("/pulls/"))
        return {
          state: "open",
          head: { sha: "a".repeat(40), ref: "another-branch" },
          base: { ref: "main" },
        };
      throw new Error("unexpected request after failed binding");
    });
    const host = createMultiProjectSandcastleHost({
      agent,
      sandbox: () => sandbox,
      authorize: async () => false,
      validate: async () => {
        throw new Error("validation must be supplied by the host");
      },
      githubTransport: transport,
    });
    const evidence = await host.observe(
      project,
      { ...task, pullRequest: 9 },
      signal(),
    );
    expect(evidence.policiesKnown).toBe(false);
    expect(transport).toHaveBeenCalledWith(
      "/repos/org/api/pulls/9",
      expect.any(AbortSignal),
    );
    const ado = await host.observe(
      {
        ...project,
        hub: {
          kind: "ado",
          organization: "org",
          project: "project",
          repository: "repo",
          pullRequest: 7,
        },
      },
      task,
      signal(),
    );
    expect(ado.diagnostic).toContain("not configured");
  });
  it("rejects ambiguous CLI input and modules without trusted capabilities", async () => {
    await expect(runMultiProjectEntrypoint({})).rejects.toThrow(/exactly one/);
    await expect(
      runMultiProjectEntrypoint({ config: "unused", demoDirectory: "unused" }),
    ).rejects.toThrow(/exactly one/);
    const folder = mkdtempSync(path.join(os.tmpdir(), "sandcastle-config-"));
    folders.push(folder);
    const config = path.join(folder, "invalid.mjs");
    writeFileSync(
      config,
      "export default {catalog: {}, journalPath: 'relative.sqlite', host: {}}",
    );
    await expect(runMultiProjectEntrypoint({ config })).rejects.toThrow(
      /capabilities/,
    );
  });
});

describe("read-only Git revision and file-scope verifier", () => {
  const repository = (): string => {
    const root = mkdtempSync(path.join(os.tmpdir(), "sandcastle-git-"));
    folders.push(root);
    execFileSync("git", ["init", "--quiet", "--initial-branch=main", root]);
    execFileSync("git", ["-C", root, "config", "core.autocrlf", "false"]);
    mkdirSync(path.join(root, "src"));
    writeFileSync(path.join(root, "src", "api.ts"), "baseline\n");
    commit(root);
    return root;
  };
  const commit = (root: string): void => {
    execFileSync("git", ["-C", root, "add", "--all"]);
    execFileSync("git", [
      "-C",
      root,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "--no-verify",
      "-m",
      "Fixture\n\nCo-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>",
    ]);
  };
  it("resolves the base before branch creation and the actual scoped task commit afterward", async () => {
    const root = repository();
    const p = { ...project, repositoryRoot: root };
    const base = await resolveOrchestrationGitRevision(p, task, signal());
    execFileSync("git", ["-C", root, "checkout", "--quiet", "-b", task.branch]);
    writeFileSync(path.join(root, "src", "api.ts"), "changed\n");
    commit(root);
    const actual = await resolveOrchestrationGitRevision(p, task, signal());
    expect(actual).not.toBe(base);
    expect(actual).toBe(
      execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
    );
  });
  it("rejects committed files outside scope, preserving leading whitespace in filenames", async () => {
    const root = repository();
    execFileSync("git", ["-C", root, "checkout", "--quiet", "-b", task.branch]);
    mkdirSync(path.join(root, " src"));
    writeFileSync(path.join(root, " src", "api.ts"), "outside scope\n");
    commit(root);
    await expect(
      resolveOrchestrationGitRevision(
        { ...project, repositoryRoot: root },
        task,
        signal(),
      ),
    ).rejects.toThrow(/outside/);
  });
  it("rejects existing case aliases instead of silently falling back to the base", async () => {
    const root = repository();
    execFileSync("git", ["-C", root, "branch", task.branch.toUpperCase()]);
    await expect(
      resolveOrchestrationGitRevision(
        { ...project, repositoryRoot: root },
        task,
        signal(),
      ),
    ).rejects.toThrow(/case-aliased/);
  });
  it("retains the original baseline when a moving target branch could otherwise hide out-of-scope edits", async () => {
    const root = repository();
    const p = { ...project, repositoryRoot: root };
    const baseline = await resolveOrchestrationGitRevision(p, task, signal());
    execFileSync("git", ["-C", root, "checkout", "--quiet", "-b", task.branch]);
    writeFileSync(path.join(root, "outside.txt"), "unauthorized\n");
    commit(root);
    execFileSync("git", ["-C", root, "branch", "--force", "main", task.branch]);
    await expect(
      resolveOrchestrationGitRevision(p, task, signal(), baseline),
    ).rejects.toThrow(/outside/);
  });
});
