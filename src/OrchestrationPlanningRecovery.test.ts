import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";
import {
  OrchestrationWorkspaceStore,
  initializeWorkspace,
  updateWorkspaceConfiguration,
} from "./OrchestrationWorkspace.js";
import { reconcileUnstartedWorkspacePlanning } from "./OrchestrationPlanningRecovery.js";
import { orchestrationServiceDigest } from "./OrchestrationOperations.js";
import { createOrchestrationProposalQueue } from "./OrchestrationProposal.js";
import { intakeTestItem } from "./OrchestrationProposal.test.js";
import { createOrchestrationProposalTask } from "./OrchestrationNativeHost.js";
import { buildLogFilename } from "./run.js";
import { digest } from "./MultiProjectProtocol.js";
const roots: string[] = [];
const event = () => ({
  kind: "fixture-evidence",
  at: new Date().toISOString(),
});
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => fs.rmSync(root, { force: true, recursive: true })),
);
async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planning-recovery-"));
  roots.push(root);
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "-b", "main");
  git("config", "user.email", "fixture@example.test");
  git("config", "user.name", "Fixture");
  git("commit", "--allow-empty", "-m", "base");
  const store = new OrchestrationWorkspaceStore(
    path.join(root, "fixture.sqlite"),
  );
  initializeWorkspace(store, "fixture");
  const config = updateWorkspaceConfiguration(store, 1, (c) => ({
    ...c,
    projects: [
      {
        id: "api",
        repositoryRoot: root,
        mode: "individual",
        hub: { kind: "github", repository: "org/api" },
      },
    ],
    taskTemplates: [
      {
        id: "code",
        projectId: "api",
        title: "Scoped correction",
        branch: "orchestration/code",
        baseBranch: "main",
        brief: "Fix scoped code",
        scopes: ["code.ts"],
        dependsOn: [],
        requiresContracts: [],
        providesContracts: [],
        acceptance: [{ label: "regression", command: "trusted" }],
        labels: [],
      },
    ],
  }));
  const queue = createOrchestrationProposalQueue({
    store,
    namespace: config.id,
  });
  const proposal = queue.ingest(intakeTestItem(), config.revision);
  await queue
    .plan(
      proposal.id,
      async () => {
        throw new Error("prelaunch");
      },
      new AbortController().signal,
    )
    .catch(() => undefined);
  const task = createOrchestrationProposalTask(
    config.taskTemplates[0]!,
    proposal.source,
    config.revision,
  );
  git("branch", task.branch, "main");
  const baseRevision = git("rev-parse", task.branch);
  const launchKey = `local-execution/${digest("launch")}`;
  store.compareAndSwap(
    launchKey,
    0,
    {
      outcome: "unknown",
      stage: "specify",
      projectId: "api",
      taskId: task.id,
      branch: task.branch,
      baseBranch: "main",
      configurationRevision: config.revision,
    },
    event(),
  );
  const ownerKey = `service-owner/${orchestrationServiceDigest(config.id)}`;
  store.compareAndSwap(ownerKey, 0, { state: "released" }, event());
  const log = path.join(
    root,
    ".sandcastle",
    "logs",
    buildLogFilename(
      task.branch,
      undefined,
      `orchestration-api-${task.id}-specify`,
    ),
  );
  fs.mkdirSync(path.dirname(log), { recursive: true });
  const text = `\n--- Run started: 2026-11-11T20:20:13.062Z ---\nSandcastle Run\n  Agent: orchestration-api-${task.id}-specify\n  Sandbox: no-sandbox\n  Max iterations: 1\n  Branch: ${task.branch}\nIteration 1/1\nGit worktree operation failed: Preparing worktree (new branch '${task.branch}')\nerror: unable to create file long/path: Filename too long\nfatal: cannot create directory at 'long/path': Filename too long\n`;
  fs.writeFileSync(log, text);
  return {
    root,
    store,
    queue,
    git,
    task,
    ownerKey,
    log,
    evidence: {
      proposalId: proposal.id,
      launchKey,
      logDigest: digest(text),
      baseRevision,
    },
  };
}
it("settles only independently verified prelaunch failure and preserves original unknown reservation", async () => {
  const f = await fixture();
  try {
    const result = await reconcileUnstartedWorkspacePlanning(
      f.store,
      f.evidence,
    );
    expect(result.status).toBe("unknown");
    expect(result.planningSettlement?.kind).toBe("not-started");
    expect(
      (f.store.read(f.evidence.launchKey).value as { outcome: string }).outcome,
    ).toBe("unknown");
    expect(
      (await reconcileUnstartedWorkspacePlanning(f.store, f.evidence))
        .planningSettlement,
    ).toEqual(result.planningSettlement);
  } finally {
    f.store.close();
  }
});
it.each(["owner", "branch", "model-log", "digest", "worktree"])(
  "rejects ambiguous %s evidence",
  async (change) => {
    const f = await fixture();
    try {
      if (change === "owner")
        f.store.compareAndSwap(f.ownerKey, 1, { state: "active" }, event());
      if (change === "branch")
        f.git(
          "update-ref",
          `refs/heads/${f.task.branch}`,
          f.git(
            "commit-tree",
            "HEAD^{tree}",
            "-p",
            "HEAD",
            "-m",
            "retained work",
          ),
        );
      if (change === "model-log") {
        fs.appendFileSync(f.log, "Model invocation completed\n");
        f.evidence.logDigest = digest(fs.readFileSync(f.log, "utf8"));
      }
      if (change === "digest") f.evidence.logDigest = digest("wrong");
      if (change === "worktree")
        fs.mkdirSync(
          path.join(
            f.root,
            ".sandcastle",
            "worktrees",
            f.task.branch.replaceAll("/", "-"),
          ),
          { recursive: true },
        );
      await expect(
        reconcileUnstartedWorkspacePlanning(f.store, f.evidence),
      ).rejects.toThrow();
      expect(
        f.queue.get(f.evidence.proposalId).proposal.planningSettlement,
      ).toBeUndefined();
    } finally {
      f.store.close();
    }
  },
);
it.each([
  "settled",
  "trailing-model",
  "valid-receipt",
  "edited-branch",
  "missing-footer",
])(
  "reconciles only a settled effect-free invalid receipt: %s",
  async (change) => {
    const f = await fixture();
    try {
      const receipt = {
        kind: "completed",
        artifact: "Investigation, with external facts explicitly unverified.",
        contracts: {},
        findings:
          change === "valid-receipt"
            ? ["Blocked: authenticated inspection unavailable"]
            : [
                {
                  severity: "blocked",
                  evidence: "Authenticated inspection unavailable",
                },
              ],
      };
      const original = fs.readFileSync(f.log, "utf8");
      let text =
        original.slice(0, original.indexOf("Git worktree operation failed:")) +
        `Setting up sandbox\nSetting up sandbox done (0.5s)\nAgent started\n<orchestration-receipt>${JSON.stringify(receipt)}</orchestration-receipt>\nAgent stopped\nCollecting commits\nCollecting commits done (0.1s)\nReached max iterations (1).\nRun complete: reached 1 iteration(s) without completion signal.\n`;
      if (change === "trailing-model") text += "Agent started\n";
      if (change === "missing-footer")
        text = text.slice(0, text.indexOf("Agent stopped"));
      if (change === "edited-branch")
        f.git(
          "update-ref",
          `refs/heads/${f.task.branch}`,
          f.git(
            "commit-tree",
            "HEAD^{tree}",
            "-p",
            "HEAD",
            "-m",
            "unassessed change",
          ),
        );
      fs.writeFileSync(f.log, text);
      const evidence = {
        ...f.evidence,
        kind: "read-only-invalid-receipt",
        logDigest: digest(text),
      };
      if (change !== "settled") {
        await expect(
          reconcileUnstartedWorkspacePlanning(f.store, evidence),
        ).rejects.toThrow();
        expect(
          f.queue.get(evidence.proposalId).proposal.planningSettlement,
        ).toBeUndefined();
        return;
      }
      const result = await reconcileUnstartedWorkspacePlanning(
        f.store,
        evidence,
      );
      expect(result).toMatchObject({
        status: "unknown",
        planningSettlement: { kind: "read-only-invalid-receipt" },
      });
      expect(result.artifacts).toBeUndefined();
      expect(
        (f.store.read(evidence.launchKey).value as { outcome: string }).outcome,
      ).toBe("unknown");
      expect(
        (await reconcileUnstartedWorkspacePlanning(f.store, evidence))
          .planningSettlement,
      ).toEqual(result.planningSettlement);
    } finally {
      f.store.close();
    }
  },
);
