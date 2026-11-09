import path from "node:path";
import { z } from "zod";
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
export const workspaceDiscoverySourceSchema = z.strictObject({
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
  ]),
  pageSize: z.number().int().min(1).max(20).default(10),
  maxPages: z.number().int().min(1).max(20).default(5),
  includeReviewFeedback: z.boolean().default(true),
  includeDependencies: z.boolean().default(true),
});
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
  model: z.strictObject({
    id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/),
    family: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/),
  }),
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
    phaseDefinitions: z
      .array(workspacePhaseDefinitionSchema)
      .max(6)
      .default([]),
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
  const ids = new Set(config.projects.map((project) => project.id));
  const unique = (values: string[], label: string) => {
    if (new Set(values).size !== values.length)
      throw new Error(`duplicate ${label}`);
  };
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
  for (const source of config.discovery) {
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
