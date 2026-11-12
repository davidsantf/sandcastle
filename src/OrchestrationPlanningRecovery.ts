import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { digest, workerReceiptSchema } from "./MultiProjectProtocol.js";
import { buildLogFilename } from "./run.js";
import { createOrchestrationProposalTask } from "./OrchestrationNativeHost.js";
import { createOrchestrationProposalQueue } from "./OrchestrationProposal.js";
import {
  OrchestrationWorkspaceStore,
  readWorkspaceConfiguration,
} from "./OrchestrationWorkspace.js";
import {
  orchestrationServiceDigest,
  readOrchestrationOperationSummary,
} from "./OrchestrationOperations.js";

const execute = promisify(execFile);
export const unstartedPlanningEvidenceSchema = z.strictObject({
  proposalId: z.string().regex(/^[a-f0-9]{64}$/),
  launchKey: z.string().regex(/^local-execution\/[a-f0-9]{64}$/),
  logDigest: z.string().regex(/^[a-f0-9]{64}$/),
  baseRevision: z.string().regex(/^[a-f0-9]{40,64}$/),
  kind: z
    .enum(["not-started", "read-only-invalid-receipt"])
    .default("not-started"),
});

/** Preserves unknown journals; settles only independently bounded, effect-free failures. */
export async function reconcileUnstartedWorkspacePlanning(
  store: OrchestrationWorkspaceStore,
  input: unknown,
) {
  const evidence = unstartedPlanningEvidenceSchema.parse(input);
  const configurationRecord = store.read("workspace:configuration");
  const config = readWorkspaceConfiguration(store);
  const ownerKey = `service-owner/${orchestrationServiceDigest(config.id)}`;
  const owner = store.read(ownerKey);
  if (
    !owner.value ||
    typeof owner.value !== "object" ||
    !("state" in owner.value) ||
    owner.value.state !== "released" ||
    readOrchestrationOperationSummary(store, config.id).reserved !== 0
  )
    throw new Error("Stop and settle service before planning reconciliation");
  const guarded = store
    .withGuard({
      key: ownerKey,
      version: owner.version,
      valueDigest: orchestrationServiceDigest(owner.value),
    })
    .withGuard({
      key: "workspace:configuration",
      version: configurationRecord.version,
      valueDigest: orchestrationServiceDigest(configurationRecord.value),
    });
  const queue = createOrchestrationProposalQueue({
    store: guarded,
    namespace: config.id,
  });
  const proposal = queue.get(evidence.proposalId).proposal;
  const launch = store.read(evidence.launchKey);
  const value = z
    .object({
      outcome: z.literal("unknown"),
      stage: z.literal("specify"),
      projectId: z.string(),
      taskId: z.string(),
      branch: z.string(),
      baseBranch: z.string(),
      configurationRevision: z.number(),
    })
    .parse(launch.value);
  const project = config.projects.find(
    (p) => p.id === proposal.source.projectId,
  );
  const template =
    config.runtime.planningOverrides?.find(
      (rule) =>
        rule.sourceId === proposal.source.sourceId &&
        rule.itemId === proposal.source.id,
    )?.template ??
    config.taskTemplates.find((t) => t.projectId === project?.id);
  if (
    !project ||
    !template ||
    proposal.configurationRevision !== config.revision ||
    value.configurationRevision !== config.revision
  )
    throw new Error("Original planning configuration must still be current");
  const task = createOrchestrationProposalTask(
    template,
    proposal.source,
    config.revision,
  );
  if (
    value.projectId !== project.id ||
    value.taskId !== task.id ||
    value.branch !== task.branch ||
    value.baseBranch !== task.baseBranch
  )
    throw new Error("Planning launch binding mismatch");
  const root = project.repositoryRoot;
  const git = async (...args: string[]) =>
    (
      await execute("git", ["-C", root, ...args], {
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      })
    ).stdout.trim();
  const worktree = path.join(
    root,
    ".sandcastle",
    "worktrees",
    task.branch.replaceAll("/", "-"),
  );
  const log = path.join(
    root,
    ".sandcastle",
    "logs",
    buildLogFilename(
      task.branch,
      undefined,
      `orchestration-${project.id}-${task.id}-specify`,
    ),
  );
  if (!fs.statSync(log).isFile() || fs.statSync(log).size > 256000)
    throw new Error("Bounded original host log required");
  const text = fs.readFileSync(log, "utf8");
  const invalidReceipt = evidence.kind === "read-only-invalid-receipt";
  const prefix = invalidReceipt
    ? "Setting up sandbox\n"
    : `Git worktree operation failed: Preparing worktree (new branch '${task.branch}')`;
  const normalized = text.replaceAll("\r", "");
  const header = normalized.slice(0, normalized.indexOf(prefix)).split("\n");
  if (header[0] === "") header.shift();
  if (
    digest(text) !== evidence.logDigest ||
    !normalized.includes(prefix) ||
    header.length !== 8 ||
    !/^--- Run started: \d{4}-\d\d-\d\dT[\d:.]+Z ---$/.test(header[0]!) ||
    header[1] !== "Sandcastle Run" ||
    header[2] !== `  Agent: orchestration-${project.id}-${task.id}-specify` ||
    header[3] !== "  Sandbox: no-sandbox" ||
    header[4] !== "  Max iterations: 1" ||
    header[5] !== `  Branch: ${task.branch}` ||
    header[6] !== "Iteration 1/1"
  )
    throw new Error(
      "Log header does not prove the original bound planning launch",
    );
  if (
    !invalidReceipt &&
    (!text.includes("Filename too long") ||
      text
        .slice(text.indexOf(prefix))
        .split("\n")
        .some(
          (line) =>
            line.trim() &&
            !line.startsWith("Git worktree operation failed:") &&
            !line.startsWith("error: unable to create file ") &&
            !line.startsWith("fatal: cannot create directory at "),
        ))
  )
    throw new Error(
      "Log does not prove the supported prelaunch checkout failure",
    );
  let receiptDigest: string | undefined;
  if (invalidReceipt) {
    const body = normalized.slice(normalized.indexOf(prefix));
    const match =
      /^Setting up sandbox\nSetting up sandbox done \([\d.]+s\)\nAgent started\n<orchestration-receipt>([^\n]+)<\/orchestration-receipt>\nAgent stopped\nCollecting commits\nCollecting commits done \([\d.]+s\)\nReached max iterations \(1\)\.\nRun complete: reached 1 iteration\(s\) without completion signal\.\n?$/.exec(
        body,
      );
    if (!match || match[1]!.includes("<orchestration-receipt>"))
      throw new Error(
        "Log does not prove a settled, single read-only planning receipt",
      );
    const receipt: unknown = JSON.parse(match[1]!);
    const shape = z
      .strictObject({
        kind: z.literal("completed"),
        artifact: z.string().min(1).max(32000),
        contracts: z
          .record(z.string(), z.string())
          .refine((value) => Object.keys(value).length === 0),
        findings: z
          .array(
            z.strictObject({
              severity: z.string().min(1).max(100),
              evidence: z.string().min(1).max(32000),
            }),
          )
          .min(1)
          .max(100),
      })
      .safeParse(receipt);
    const parsed = workerReceiptSchema.safeParse(receipt);
    if (
      !shape.success ||
      parsed.success ||
      parsed.error.issues.some((issue) => issue.path[0] !== "findings")
    )
      throw new Error(
        "Receipt is not the supported known findings-schema failure",
      );
    receiptDigest = digest(receipt);
  }
  if (
    fs.existsSync(worktree) ||
    (await git("worktree", "list", "--porcelain"))
      .split(/\r?\n/)
      .includes(`branch refs/heads/${task.branch}`) ||
    (await git("rev-parse", `refs/heads/${task.branch}`)) !==
      evidence.baseRevision ||
    (await git("reflog", "show", "--format=%H %gs", task.branch)) !==
      `${evidence.baseRevision} branch: Created from ${task.baseBranch}`
  )
    throw new Error(
      "Retained worker worktree or branch changes require independent assessment",
    );
  const settlement = {
    ...evidence,
    kind: invalidReceipt
      ? "verified-settled-read-only-receipt-failure"
      : "verified-prelaunch-worktree-failure",
    ...(receiptDigest ? { receiptDigest } : {}),
    launchVersion: launch.version,
    launchDigest: digest(launch.value),
    configurationRevision: config.revision,
  };
  const key = `planning-settlement/${proposal.id}`;
  const retained = guarded.read(key);
  if (retained.value !== null && digest(retained.value) !== digest(settlement))
    throw new Error("Conflicting planning settlement");
  if (
    retained.value === null &&
    !guarded.compareAndSwap(key, 0, settlement, {
      kind: invalidReceipt
        ? "planning-read-only-receipt-evidence"
        : "planning-prelaunch-evidence",
      at: new Date().toISOString(),
    })
  )
    throw new Error("Planning settlement fence changed");
  return queue.settlePlanningOutcome(
    proposal.id,
    digest(settlement),
    evidence.kind,
  );
}
