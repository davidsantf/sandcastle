import path from "node:path";
import { z } from "zod";
import { githubAccountAuthenticationSchema } from "./OrchestrationGithubAccount.js";
import {
  assertCopilotFileScopes,
  copilotExecutionControlsSchema,
} from "./CopilotExecutionControls.js";
import {
  parseOrchestrationCatalog,
  type OrchestrationProject,
  type OrchestrationTask,
} from "./MultiProjectProtocol.js";

export const workspaceActionSchema = z.enum([
  "discover",
  "investigate",
  "implement",
  "publish-item",
  "publish-pr",
  "downstream",
]);
export type WorkspaceAction = z.infer<typeof workspaceActionSchema>;
const identifier = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);
const literalScope = z
  .string()
  .min(1)
  .max(300)
  .refine(
    (value) =>
      value === "." ||
      (!path.posix.isAbsolute(value) &&
        !value.includes("\\") &&
        !/[:*?[\]\u0000-\u001f]/.test(value) &&
        value
          .split("/")
          .every((part) => part && part !== "." && part !== "..")),
    "literal repository-relative scope required",
  );
export const workspaceFocusSchema = z.strictObject({
  mode: z.enum(["observe", "propose", "execute"]),
  projectIds: z.array(identifier).max(100),
  team: z.string().trim().min(1).max(200).optional(),
  iteration: z.string().trim().min(1).max(200).optional(),
  query: z.string().trim().min(1).max(4000).optional(),
  priorities: z.record(identifier, z.number().int().min(-1000).max(1000)),
  maxConcurrency: z.number().int().min(1).max(16),
  budgets: z.strictObject({
    maxItems: z.number().int().min(1).max(1000),
    maxAttempts: z.number().int().min(1).max(3),
    maxRuntimeMs: z.number().int().min(100).max(3_600_000),
  }),
  permissions: z
    .array(
      z.strictObject({
        projectId: identifier,
        action: workspaceActionSchema,
      }),
    )
    .max(600),
});
export type WorkspaceFocus = z.infer<typeof workspaceFocusSchema>;
export const workspaceContractRouteSchema = z.strictObject({
  id: identifier,
  version: z.number().int().positive(),
  producer: identifier,
  consumer: identifier,
  contract: identifier,
  consumedDigest: z.string().regex(/^[a-f0-9]{64}$/),
  supersedes: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  scopes: z.array(literalScope).min(1).max(100),
  baseBranch: z.string().min(1).max(200),
  acceptance: z
    .array(
      z.strictObject({
        label: identifier,
        command: z.string().trim().min(1).max(4000),
      }),
    )
    .min(1)
    .max(50),
  maxDepth: z.number().int().min(1).max(100),
  maxTasks: z.number().int().min(1).max(1000),
});
export type WorkspaceContractRoute = z.infer<
  typeof workspaceContractRouteSchema
>;
export const workspaceDiscoveryAuthenticationSchema = z.union([
  z.strictObject({
    kind: z.literal("azure-cli"),
    expectedIdentity: z.string().trim().min(1).max(200).email(),
  }),
  githubAccountAuthenticationSchema,
]);
export const workspaceDiscoverySourceSchema = z
  .strictObject({
    id: identifier,
    projectId: identifier,
    hub: z.discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("github"),
        repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
      }),
      z.strictObject({
        kind: z.literal("ado"),
        organization: z.string().regex(/^[A-Za-z0-9_-]+$/),
        project: z.string().min(1).max(200),
        repository: z.string().min(1).max(200),
      }),
    ]),
    selector: z.union([
      z.strictObject({ assignedTo: z.string().min(1).max(200) }),
      z.strictObject({ optedInLabel: z.string().min(1).max(100) }),
      z.strictObject({
        assignedToOrLabel: z.strictObject({
          assignedTo: z.string().min(1).max(200),
          optedInLabel: z.string().min(1).max(100),
        }),
      }),
    ]),
    workItemTypes: z
      .array(z.string().trim().min(1).max(200))
      .min(1)
      .max(20)
      .refine(
        (types) => new Set(types).size === types.length,
        "duplicate work item type",
      )
      .optional(),
    authentication: workspaceDiscoveryAuthenticationSchema.optional(),
    pageSize: z.number().int().min(1).max(20).default(10),
    maxPages: z.number().int().min(1).max(20).default(5),
    includeReviewFeedback: z.boolean().default(true),
    includeDependencies: z.boolean().default(true),
    workflow: z
      .strictObject({
        kind: z.literal("github-labels"),
        approver: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/),
      })
      .optional(),
  })
  .refine(
    (source) =>
      !source.workflow ||
      (source.hub.kind === "github" && !source.includeReviewFeedback),
    "GitHub label workflow requires GitHub and separate plan/review comments (includeReviewFeedback=false)",
  )
  .refine(
    (source) => !source.workItemTypes || source.hub.kind === "ado",
    "workItemTypes requires an ADO discovery source",
  )
  .refine(
    (source) =>
      !source.authentication ||
      (source.authentication.kind === "azure-cli"
        ? source.hub.kind === "ado"
        : source.hub.kind === "github"),
    "discovery authentication must match its hub provider",
  );
export type WorkspaceDiscoverySource = z.infer<
  typeof workspaceDiscoverySourceSchema
>;
export const workspacePhaseDefinitionSchema = z.strictObject({
  stage: z.enum(["specify", "plan", "decompose", "implement", "review", "fix"]),
  agentName: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/),
  definitionPath: z
    .string()
    .refine(
      (value) => path.isAbsolute(value),
      "absolute definition path required",
    ),
  definitionDigest: z.string().regex(/^[a-f0-9]{64}$/),
  pluginDirectory: z
    .string()
    .min(1)
    .refine(path.isAbsolute, "plugin directory must be absolute")
    .optional(),
  pluginManifestDigest: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  model: z.strictObject({
    id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/),
    family: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/),
  }),
});
export const workspaceLocalValidationSchema = z.strictObject({
  projectId: identifier,
  label: z.string().trim().min(1).max(200),
  executable: z
    .string()
    .min(1)
    .refine(path.isAbsolute, "absolute validation executable required"),
  args: z
    .array(
      z
        .string()
        .max(8000)
        .refine((value) => !value.includes("\0")),
    )
    .max(100),
  timeoutMs: z.number().int().min(1000).max(240000),
});
export interface WorkspaceConfiguration {
  schemaVersion: 1;
  revision: number;
  id: string;
  projects: OrchestrationProject[];
  routes: WorkspaceContractRoute[];
  discovery: WorkspaceDiscoverySource[];
  taskTemplates: OrchestrationTask[];
  focus: WorkspaceFocus;
  runtime: {
    framework: "devsquad";
    agent: string;
    model: string;
    command: string;
    executionTrust?: "independent-backend" | "trusted-local";
    executionControls?: import("./CopilotExecutionControls.js").CopilotExecutionControls;
    localValidation?: z.infer<typeof workspaceLocalValidationSchema>[];
    proposalPolicy?: {
      kind: "bounded-local";
      rules: {
        sourceId: string;
        taskTemplateId: string;
        needsInputTerms?: string[];
      }[];
    };
    reviewLoop?: { maxIterations: number };
    planningOverrides?: {
      sourceId: string;
      itemId: string;
      investigationOnly: true;
      template: OrchestrationTask;
    }[];
    phaseDefinitions: z.infer<typeof workspacePhaseDefinitionSchema>[];
  };
  pollIntervalMs: number;
}
const projectSchema = z.custom<OrchestrationProject>((value) => {
  try {
    parseOrchestrationCatalog({
      id: "validation",
      projects: [value],
      tasks: [],
    });
    return true;
  } catch {
    return false;
  }
}, "invalid project registration");
export const workspaceConfigurationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  revision: z.number().int().positive(),
  id: identifier,
  projects: z.array(projectSchema).max(100),
  routes: z.array(workspaceContractRouteSchema).max(1000),
  discovery: z.array(workspaceDiscoverySourceSchema).max(100).default([]),
  taskTemplates: z.array(z.custom<OrchestrationTask>()).max(1000).default([]),
  focus: workspaceFocusSchema,
  runtime: z.strictObject({
    framework: z.literal("devsquad"),
    agent: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/),
    model: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/),
    command: z
      .string()
      .min(1)
      .max(1000)
      .refine((value) => !/[\u0000-\u001f]/.test(value), "invalid executable"),
    executionTrust: z.enum(["independent-backend", "trusted-local"]).optional(),
    executionControls: copilotExecutionControlsSchema.optional(),
    localValidation: z
      .array(workspaceLocalValidationSchema)
      .min(1)
      .max(100)
      .optional(),
    proposalPolicy: z
      .strictObject({
        kind: z.literal("bounded-local"),
        rules: z
          .array(
            z.strictObject({
              sourceId: identifier,
              taskTemplateId: identifier,
              needsInputTerms: z
                .array(z.string().trim().min(3).max(100))
                .min(1)
                .max(50)
                .optional(),
            }),
          )
          .min(1)
          .max(100),
      })
      .optional(),
    phaseDefinitions: z
      .array(workspacePhaseDefinitionSchema)
      .max(6)
      .default([]),
    reviewLoop: z
      .strictObject({
        maxIterations: z.number().int().min(1).max(100).default(10),
      })
      .optional(),
    planningOverrides: z
      .array(
        z.strictObject({
          sourceId: identifier,
          itemId: z.string().regex(/^[1-9][0-9]*$/),
          investigationOnly: z.literal(true),
          template: z.custom<OrchestrationTask>(),
        }),
      )
      .max(100)
      .optional(),
  }),
  pollIntervalMs: z.number().int().min(100).max(3_600_000),
});
export function parseWorkspaceConfiguration(
  value: unknown,
): WorkspaceConfiguration {
  const config = workspaceConfigurationSchema.parse(value);
  const catalog = parseOrchestrationCatalog({
    id: config.id,
    projects: config.projects,
    tasks: config.taskTemplates,
  });
  if (catalog.tasks.some((task) => task.pullRequest || task.sourceItem))
    throw new Error(
      "task templates cannot register source items or change requests",
    );
  config.taskTemplates = catalog.tasks;
  const overrides = config.runtime.planningOverrides ?? [];
  if (
    new Set(overrides.map((rule) => `${rule.sourceId}/${rule.itemId}`)).size !==
    overrides.length
  )
    throw new Error("Duplicate issue planning override");
  for (const rule of overrides) {
    const source = config.discovery.find(
      (source) => source.id === rule.sourceId,
    );
    if (!source?.workflow || source.projectId !== rule.template.projectId)
      throw new Error(
        "Issue planning override requires matching GitHub label workflow",
      );
    const parsed = parseOrchestrationCatalog({
      id: config.id,
      projects: config.projects,
      tasks: [rule.template],
    }).tasks[0]!;
    if (
      parsed.sourceItem ||
      parsed.pullRequest ||
      parsed.dependsOn.length ||
      parsed.requiresContracts.length
    )
      throw new Error(
        "Investigation overrides cannot contain execution dependencies/authority",
      );
    if (config.runtime.executionControls)
      assertCopilotFileScopes(parsed.scopes);
    rule.template = parsed;
  }
  if (config.runtime.executionControls)
    for (const task of config.taskTemplates)
      assertCopilotFileScopes(task.scopes);
  if (
    config.runtime.phaseDefinitions.some(
      (definition) => definition.pluginDirectory,
    ) &&
    !config.runtime.executionControls
  )
    throw new Error(
      "process-local plugins require explicit local-files controls",
    );
  if (
    config.runtime.phaseDefinitions.some(
      (definition) =>
        Boolean(definition.pluginDirectory) !==
        Boolean(definition.pluginManifestDigest),
    )
  )
    throw new Error(
      "process-local plugins require a directory and pinned manifest digest",
    );
  const ids = new Set(config.projects.map((project) => project.id));
  const unique = (values: string[], label: string) => {
    if (new Set(values).size !== values.length)
      throw new Error(`duplicate ${label}`);
  };
  if (config.runtime.localValidation) {
    if (!config.runtime.executionControls)
      throw new Error(
        "local validation requires explicit bounded execution controls",
      );
    unique(
      config.runtime.localValidation.map(
        (check) => `${check.projectId}:${check.label}`,
      ),
      "local validation",
    );
    for (const check of config.runtime.localValidation) {
      const templates = config.taskTemplates.filter(
        (task) => task.projectId === check.projectId,
      );
      if (
        !ids.has(check.projectId) ||
        templates.length !== 1 ||
        templates[0]!.acceptance.find((item) => item.label === check.label)
          ?.command !== JSON.stringify([check.executable, ...check.args])
      )
        throw new Error(
          "local validation must match one exact trusted template acceptance argv",
        );
    }
    for (const projectId of new Set(
      config.runtime.localValidation.map((check) => check.projectId),
    )) {
      const template = config.taskTemplates.find(
        (task) => task.projectId === projectId,
      )!;
      if (
        template.acceptance.some(
          (criterion) =>
            !config.runtime.localValidation!.some(
              (check) =>
                check.projectId === projectId &&
                check.label === criterion.label,
            ),
        )
      )
        throw new Error(
          "local validation must cover every trusted acceptance criterion",
        );
    }
  }
  unique(config.focus.projectIds, "focused project");
  unique(
    config.focus.permissions.map(
      (grant) => `${grant.projectId}:${grant.action}`,
    ),
    "permission",
  );
  unique(
    config.routes.map((route) => route.id),
    "route",
  );
  unique(
    config.discovery.map((source) => source.id),
    "discovery source",
  );
  unique(
    config.runtime.phaseDefinitions.map((definition) => definition.stage),
    "phase definition",
  );
  if (config.runtime.proposalPolicy) {
    if (
      config.runtime.executionTrust !== "trusted-local" ||
      !config.runtime.executionControls
    )
      throw new Error(
        "bounded-local policy requires trusted-local execution and explicit local-files controls",
      );
    unique(
      config.runtime.proposalPolicy.rules.map((rule) => rule.sourceId),
      "policy source",
    );
    for (const rule of config.runtime.proposalPolicy.rules) {
      const source = config.discovery.find(
        (source) => source.id === rule.sourceId,
      );
      const templates = config.taskTemplates.filter(
        (task) => task.projectId === source?.projectId,
      );
      const template = templates[0];
      if (
        !source ||
        templates.length !== 1 ||
        template?.id !== rule.taskTemplateId
      )
        throw new Error(
          "bounded-local policy requires one exact registered source/project task template",
        );
      assertCopilotFileScopes(template.scopes);
      if (
        template.dependsOn.length ||
        template.requiresContracts.length ||
        template.providesContracts.length ||
        template.labels.length
      )
        throw new Error(
          "bounded-local policy cannot authorize labeled, dependent or contract-publishing templates",
        );
    }
  }
  const githubAccounts = new Map<string, string>();
  for (const source of config.discovery) {
    if (source.hub.kind === "github") {
      const repository = source.hub.repository.toLowerCase();
      const account =
        source.authentication?.kind === "github-cli"
          ? source.authentication.account.toLowerCase()
          : "";
      if (
        githubAccounts.has(repository) &&
        githubAccounts.get(repository) !== account
      )
        throw new Error(
          "GitHub repository sources require one consistent account binding",
        );
      githubAccounts.set(repository, account);
    }
    const project = config.projects.find(
      (project) => project.id === source.projectId,
    );
    if (
      !project ||
      JSON.stringify(
        project.hub.kind === "github"
          ? { kind: "github", repository: project.hub.repository }
          : {
              kind: "ado",
              organization: project.hub.organization,
              project: project.hub.project,
              repository: project.hub.repository,
            },
      ) !== JSON.stringify(source.hub)
    )
      throw new Error("discovery source must match exact registered hub");
  }
  const referenced = [
    ...config.focus.projectIds,
    ...Object.keys(config.focus.priorities),
    ...config.focus.permissions.map((grant) => grant.projectId),
  ];
  if (referenced.some((id) => !ids.has(id)))
    throw new Error("focus references unregistered project");
  const edges = new Map<string, string[]>();
  const signatures = new Set<string>();
  for (const route of config.routes) {
    if (
      !ids.has(route.producer) ||
      !ids.has(route.consumer) ||
      route.producer === route.consumer
    )
      throw new Error("route requires distinct registered projects");
    const producer = config.projects.find(
      (project) => project.id === route.producer,
    )!;
    const consumer = config.projects.find(
      (project) => project.id === route.consumer,
    )!;
    if (producer.mode !== "integrated" || consumer.mode !== "integrated")
      throw new Error("contract routes require integrated projects");
    const signature = `${route.producer}:${route.consumer}:${route.contract}`;
    if (signatures.has(signature)) throw new Error("ambiguous contract route");
    signatures.add(signature);
    if (
      !/^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(route.baseBranch) ||
      route.baseBranch.includes("..") ||
      route.baseBranch.endsWith("/") ||
      route.baseBranch.endsWith(".lock")
    )
      throw new Error("invalid route base branch");
    unique(
      route.acceptance.map((item) => item.label),
      "acceptance label",
    );
    edges.set(route.producer, [
      ...(edges.get(route.producer) ?? []),
      route.consumer,
    ]);
  }
  const active = new Set<string>(),
    visited = new Set<string>();
  const visit = (id: string) => {
    if (active.has(id)) throw new Error("contract route cycle");
    if (visited.has(id)) return;
    active.add(id);
    for (const next of edges.get(id) ?? []) visit(next);
    active.delete(id);
    visited.add(id);
  };
  for (const id of ids) visit(id);
  return config;
}
export interface WorkspaceEvent {
  sequence: number;
  key: string;
  version: number;
  kind: string;
  at: string;
  valueDigest: string;
}
export interface WorkspaceStore {
  /** Captured host guards, for atomic mutations in the same SQLite journal. */
  guards?(): readonly WorkspaceStoreGuard[];
  read(key: string): { version: number; value: unknown | null };
  compareAndSwap(
    key: string,
    expectedVersion: number,
    value: unknown,
    event: { kind: string; at: string },
  ): boolean;
  events(after?: number): WorkspaceEvent[];
  withGuard(guard: WorkspaceStoreGuard): WorkspaceStore;
}
export interface WorkspaceStoreGuard {
  key: string;
  version: number;
  valueDigest: string;
  expiresAt?: number;
}
