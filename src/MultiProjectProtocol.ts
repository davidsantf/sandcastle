import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";

export type OrchestrationStage =
  | "specify"
  | "plan"
  | "decompose"
  | "implement"
  | "verify"
  | "review"
  | "fix";

export interface OrchestrationProject {
  id: string;
  repositoryRoot: string;
  mode: "individual" | "integrated";
  hub:
    | { kind: "github"; repository: string; pullRequest?: number }
    | {
        kind: "ado";
        organization: string;
        project: string;
        repository: string;
        pullRequest?: number;
      };
}

export interface OrchestrationTask {
  id: string;
  projectId: string;
  title: string;
  brief: string;
  branch: string;
  baseBranch: string;
  pullRequest?: number;
  sourceItem?: {
    provider: "github" | "azure-devops";
    id: string;
    url: string;
    cause: { recordKey: string; recordVersion: number; recordDigest: string };
  };
  scopes: string[];
  dependsOn: string[];
  requiresContracts: { task: string; name: string }[];
  providesContracts: string[];
  acceptance: { label: string; command: string }[];
  labels: string[];
}

export interface OrchestrationCatalog {
  id: string;
  projects: OrchestrationProject[];
  tasks: OrchestrationTask[];
  maxConcurrency: number;
  maxRounds: number;
  maxRepairAttempts: number;
  invocationTimeoutMs: number;
}

export interface OrchestrationCheck {
  name: string;
  state: "passed" | "failed" | "pending" | "unknown";
  signature?: string;
  evidence?: string;
}

export interface OrchestrationHubEvidence {
  revision: string;
  policiesKnown: boolean;
  required: string[];
  checks: OrchestrationCheck[];
  labels: string[];
  diagnostic?: string;
}

export interface OrchestrationTaskState {
  key: string;
  stage: OrchestrationStage;
  status: "pending" | "running" | "completed" | "needs-input" | "unknown";
  attempts: number;
  failures: string[];
  artifacts: Partial<Record<OrchestrationStage, string>>;
  contracts: Record<string, string>;
  revision?: string;
  baseRevision?: string;
  reason?: string;
  invocation?: string;
  intent?: string;
  pendingSince?: number;
  pullRequest?: number;
  changeRequestEvidence?: string;
}

export interface OrchestrationWorkerRequest {
  invocation: string;
  intent: string;
  stage: OrchestrationStage;
  project: Pick<OrchestrationProject, "id" | "repositoryRoot">;
  task: OrchestrationTask;
  artifacts: Partial<Record<OrchestrationStage, string>>;
  contracts: Record<string, string>;
  revision?: string;
  baseRevision?: string;
  failures: string[];
}

export type OrchestrationWorkerReceipt =
  | {
      kind: "completed";
      artifact: string;
      contracts: Record<string, string>;
      findings: string[];
      amendments?: Partial<Record<"specify" | "plan" | "decompose", string>>;
    }
  | { kind: "failed"; signature: string; evidence: string }
  | { kind: "unknown"; reason: string };

const id = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);
const qualified = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,47}:[a-z][a-z0-9-]{0,47}$/);
const text = z.string().trim().min(1).max(64_000);
const branch = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (v) =>
      !v.startsWith("-") &&
      !v.endsWith("/") &&
      !v.endsWith(".") &&
      !v.includes("..") &&
      !v.includes("@{") &&
      !/[\\\s~^:?*[\]\u0000-\u001f]/.test(v) &&
      v
        .split("/")
        .every(
          (part) => part && !part.startsWith(".") && !part.endsWith(".lock"),
        ),
    "invalid Git branch",
  );
const scope = z
  .string()
  .min(1)
  .max(300)
  .refine(
    (v) =>
      v === "." ||
      (!path.posix.isAbsolute(v) &&
        !v.includes("\\") &&
        !/[:*?[\]\u0000-\u001f]/.test(v) &&
        v.split("/").every((part) => part && part !== "." && part !== "..")),
    "scopes must be literal repository-relative file or directory paths",
  );
const sourceItemSchema = z.strictObject({
  provider: z.enum(["github", "azure-devops"]),
  id: z.string().min(1).max(200),
  url: z
    .string()
    .url()
    .refine((value) => {
      const parsed = new URL(value);
      return (
        parsed.protocol === "https:" &&
        !parsed.username &&
        !parsed.password &&
        !parsed.search &&
        !parsed.hash
      );
    }, "credential-free HTTPS item link required"),
  cause: z
    .strictObject({
      recordKey: z.string().regex(/^(?:factory|native-proposal):[a-f0-9]{64}$/),
      recordVersion: z.number().int().min(1),
      recordDigest: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .refine(
      (cause) =>
        !cause.recordKey.startsWith("factory:") || cause.recordVersion >= 2,
      "factory source causes require a completed version",
    ),
});
const hubSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("github"),
      repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
      pullRequest: z.number().int().positive().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("ado"),
      organization: z.string().regex(/^[A-Za-z0-9_-]+$/),
      project: z.string().min(1).max(200),
      repository: z.string().min(1).max(200),
      pullRequest: z.number().int().positive().optional(),
    })
    .strict(),
]);

const catalogSchema = z
  .object({
    id,
    projects: z
      .array(
        z
          .object({
            id,
            repositoryRoot: text.refine(
              (v) => path.isAbsolute(v),
              "absolute host path required",
            ),
            mode: z.enum(["individual", "integrated"]),
            hub: hubSchema,
          })
          .strict(),
      )
      .max(100),
    tasks: z
      .array(
        z
          .object({
            id,
            projectId: id,
            title: text,
            brief: text,
            branch,
            baseBranch: branch,
            pullRequest: z.number().int().positive().optional(),
            sourceItem: sourceItemSchema.optional(),
            scopes: z.array(scope).min(1).max(100),
            dependsOn: z.array(qualified).max(100).default([]),
            requiresContracts: z
              .array(z.object({ task: qualified, name: id }).strict())
              .max(100)
              .default([]),
            providesContracts: z.array(id).max(100).default([]),
            acceptance: z
              .array(z.object({ label: id, command: text }).strict())
              .min(1)
              .max(50),
            labels: z.array(z.string().min(1).max(100)).max(100).default([]),
          })
          .strict(),
      )
      .max(1_000),
    maxConcurrency: z.number().int().min(1).max(16).default(2),
    maxRounds: z.number().int().min(1).max(100).default(30),
    maxRepairAttempts: z.number().int().min(0).max(3).default(3),
    invocationTimeoutMs: z
      .number()
      .int()
      .min(100)
      .max(3_600_000)
      .default(300_000),
  })
  .strict();

export const workerReceiptSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("completed"),
      artifact: text,
      contracts: z.record(id, z.string().regex(/^[a-f0-9]{64}$/)),
      findings: z.array(text).max(100),
      amendments: z
        .partialRecord(z.enum(["specify", "plan", "decompose"]), text)
        .optional(),
    })
    .strict(),
  z
    .object({ kind: z.literal("failed"), signature: text, evidence: text })
    .strict(),
  z.object({ kind: z.literal("unknown"), reason: text }).strict(),
]);

export const taskKey = (
  task: Pick<OrchestrationTask, "id" | "projectId">,
): string => `${task.projectId}:${task.id}`;
export const digest = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const normalizeOrchestrationFailure = (detail: string): string =>
  detail
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\b[a-f0-9]{8,64}\b/gi, "<revision>")
    .replace(/\b\d+\b/g, "#")
    .replace(/\s+/g, " ")
    .trim();
export const parseWorkerReceipt = (
  value: unknown,
): OrchestrationWorkerReceipt => workerReceiptSchema.parse(value);

export const parseOrchestrationTasks = (value: unknown): OrchestrationTask[] =>
  catalogSchema.shape.tasks.element.array().min(1).max(100).parse(value);

export const parseOrchestrationCatalog = (
  value: unknown,
): OrchestrationCatalog => {
  const catalog: OrchestrationCatalog = catalogSchema.parse(value);
  const projects = new Map(catalog.projects.map((p) => [p.id, p]));
  if (projects.size !== catalog.projects.length)
    throw new Error("duplicate project ID");
  const roots = catalog.projects.map((p) =>
    path.resolve(p.repositoryRoot).toLowerCase(),
  );
  const hubs = catalog.projects.map((p) =>
    p.hub.kind === "github"
      ? `github:${p.hub.repository.toLowerCase()}`
      : `ado:${p.hub.organization}:${p.hub.project}:${p.hub.repository}`.toLowerCase(),
  );
  if (
    new Set(roots).size !== roots.length ||
    new Set(hubs).size !== hubs.length
  )
    throw new Error(
      "ambiguous repository alias: use one project per repository",
    );
  const tasks = new Map(catalog.tasks.map((t) => [taskKey(t), t]));
  if (tasks.size !== catalog.tasks.length)
    throw new Error("duplicate qualified task ID");
  const branches = new Set<string>();
  const pullRequests = new Set<string>();
  for (const task of catalog.tasks) {
    const project = projects.get(task.projectId);
    if (!project) throw new Error(`unknown project: ${task.projectId}`);
    const branchKey = `${task.projectId}:${task.branch.toLowerCase()}`;
    if (
      branches.has(branchKey) ||
      task.branch.toLowerCase() === task.baseBranch.toLowerCase()
    )
      throw new Error(
        "task branches must be distinct from other tasks and the base",
      );
    branches.add(branchKey);
    if (task.sourceItem && task.pullRequest)
      throw new Error(
        "issue-backed tasks require separate host-owned change request registration",
      );
    if (
      task.sourceItem &&
      task.sourceItem.provider !==
        (project.hub.kind === "github" ? "github" : "azure-devops")
    )
      throw new Error("source item provider must match the configured project");
    const changeRequestKey = task.sourceItem
      ? `${task.projectId}:item:${task.sourceItem.provider}:${task.sourceItem.id}`
      : (task.pullRequest ?? project.hub.pullRequest)
        ? `${task.projectId}:${task.pullRequest ?? project.hub.pullRequest}`
        : `${task.projectId}:unregistered:${task.id}`;
    if (pullRequests.has(changeRequestKey))
      throw new Error("task change requests must be distinct");
    pullRequests.add(changeRequestKey);
    if (
      new Set(task.acceptance.map((c) => c.label)).size !==
      task.acceptance.length
    )
      throw new Error("duplicate acceptance label");
    if (
      new Set(task.dependsOn).size !== task.dependsOn.length ||
      new Set(task.providesContracts).size !== task.providesContracts.length
    )
      throw new Error("duplicate prerequisite or contract");
    if (
      project.mode === "individual" &&
      (task.dependsOn.some(
        (dependency) => tasks.get(dependency)?.projectId !== task.projectId,
      ) ||
        task.requiresContracts.some(
          (contract) => tasks.get(contract.task)?.projectId !== task.projectId,
        ))
    )
      throw new Error(
        "individual projects cannot declare integrated prerequisites",
      );
    for (const dep of task.dependsOn) {
      if (!tasks.has(dep)) throw new Error(`unknown dependency: ${dep}`);
    }
    const producer = catalog.tasks.find(
      (other) =>
        other.projectId === task.projectId &&
        other.branch.toLowerCase() === task.baseBranch.toLowerCase(),
    );
    if (producer && !task.dependsOn.includes(taskKey(producer)))
      throw new Error("a task base branch requires its producer dependency");
    for (const contract of task.requiresContracts) {
      if (
        !task.dependsOn.includes(contract.task) ||
        !tasks.get(contract.task)?.providesContracts.includes(contract.name)
      )
        throw new Error(
          "contract prerequisite must name a declared dependency and contract",
        );
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (key: string): void => {
    if (visiting.has(key)) throw new Error("dependency cycle");
    if (visited.has(key)) return;
    visiting.add(key);
    for (const dep of tasks.get(key)!.dependsOn) visit(dep);
    visiting.delete(key);
    visited.add(key);
  };
  for (const key of tasks.keys()) visit(key);
  return catalog;
};

export const scopesConflict = (
  a: OrchestrationTask,
  b: OrchestrationTask,
): boolean =>
  a.projectId === b.projectId &&
  a.scopes
    .map((v) => v.toLowerCase())
    .some((x) =>
      b.scopes
        .map((v) => v.toLowerCase())
        .some(
          (y) =>
            x === "." ||
            y === "." ||
            x === y ||
            x.startsWith(`${y}/`) ||
            y.startsWith(`${x}/`),
        ),
    );

export const humanStop = (labels: readonly string[]): boolean =>
  labels.some((label) =>
    ["needs-human", "do-not-autofix", "needs-input"].includes(
      label.toLowerCase(),
    ),
  );

export const evaluateOrchestrationChecks = (
  evidence: OrchestrationHubEvidence,
  revision: string,
): {
  state: "passed" | "failed" | "pending" | "unknown";
  evaluated: number;
  signature?: string;
} => {
  const valid = z
    .object({
      revision: z.string(),
      policiesKnown: z.boolean(),
      required: z.array(z.string().min(1)),
      checks: z.array(
        z.object({
          name: z.string().min(1),
          state: z.enum(["passed", "failed", "pending", "unknown"]),
          signature: z.string().optional(),
          evidence: z.string().optional(),
        }),
      ),
      labels: z.array(z.string()),
      diagnostic: z.string().optional(),
    })
    .safeParse(evidence);
  if (!valid.success) return { state: "unknown", evaluated: 0 };
  if (
    !revision ||
    evidence.revision !== revision ||
    !evidence.policiesKnown ||
    evidence.required.length === 0 ||
    new Set(evidence.required).size !== evidence.required.length
  )
    return { state: "unknown", evaluated: 0 };
  const required = evidence.required.map((name) =>
    evidence.checks.filter((c) => c.name === name),
  );
  if (required.some((matches) => matches.length !== 1))
    return { state: "unknown", evaluated: 0 };
  const checks = required.map((matches) => matches[0]!);
  if (checks.some((c) => c.state === "unknown"))
    return { state: "unknown", evaluated: checks.length };
  const failed = checks.filter((c) => c.state === "failed");
  if (failed.length)
    return {
      state: "failed",
      evaluated: checks.length,
      signature: digest(
        failed
          .map((c) => [c.name, c.signature ?? c.evidence ?? "failed"])
          .sort(),
      ),
    };
  return {
    state: checks.some((c) => c.state === "pending") ? "pending" : "passed",
    evaluated: checks.length,
  };
};

const taskStateSchema = z
  .object({
    key: qualified,
    stage: z.enum([
      "specify",
      "plan",
      "decompose",
      "implement",
      "verify",
      "review",
      "fix",
    ]),
    status: z.enum([
      "pending",
      "running",
      "completed",
      "needs-input",
      "unknown",
    ]),
    attempts: z.number().int().min(0).max(3),
    failures: z.array(z.string()),
    artifacts: z.partialRecord(
      z.enum([
        "specify",
        "plan",
        "decompose",
        "implement",
        "verify",
        "review",
        "fix",
      ]),
      z.string(),
    ),
    contracts: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)),
    revision: z
      .string()
      .regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)
      .optional(),
    baseRevision: z
      .string()
      .regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)
      .optional(),
    reason: z.string().optional(),
    invocation: z.string().optional(),
    intent: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    pendingSince: z.number().int().nonnegative().optional(),
    pullRequest: z.number().int().positive().optional(),
    changeRequestEvidence: z.string().min(1).max(64000).optional(),
  })
  .strict();

export const parseOrchestrationTaskState = (
  value: unknown,
): OrchestrationTaskState => taskStateSchema.parse(value);
