import { Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  OrchestrationWorkspaceStore,
  initializeWorkspace,
  readWorkspaceConfiguration,
  updateWorkspaceConfiguration,
  registerWorkspaceProject,
  removeWorkspaceProject,
  registerWorkspaceRoute,
  removeWorkspaceRoute,
} from "./OrchestrationWorkspace.js";
import {
  workspaceContractRouteSchema,
  workspaceDiscoverySourceSchema,
  workspaceFocusSchema,
  workspaceConfigurationSchema,
  parseWorkspaceConfiguration,
  type WorkspaceConfiguration,
} from "./OrchestrationWorkspaceContract.js";
import type { OrchestrationProject } from "./MultiProjectProtocol.js";

const database = Options.text("database").pipe(
  Options.withDescription(
    "Local SQLite file shared by workspace, service and core journal",
  ),
);
const revision = Options.integer("revision").pipe(Options.optional);
const file = Options.text("file").pipe(
  Options.withDescription(
    "Trusted local JSON configuration file (not hub content)",
  ),
);
const id = Options.text("id");
const readJson = (filename: string): unknown => {
  const resolved = path.resolve(filename);
  if (!fs.statSync(resolved).isFile() || fs.statSync(resolved).size > 1_048_576)
    throw new Error(
      "configuration input must be a regular JSON file up to 1 MiB",
    );
  return JSON.parse(fs.readFileSync(resolved, "utf8")) as unknown;
};
const withWorkspace = (
  filename: string,
  execute: (store: OrchestrationWorkspaceStore) => unknown | Promise<unknown>,
) =>
  Effect.tryPromise(async () => {
    const store = new OrchestrationWorkspaceStore(path.resolve(filename));
    try {
      const result = await execute(store);
      console.log(JSON.stringify(result, null, 2));
    } finally {
      store.close();
    }
  });
const expectedRevision = (
  store: OrchestrationWorkspaceStore,
  supplied: Option.Option<number>,
) => {
  const current = readWorkspaceConfiguration(store);
  const expected = Option.getOrElse(supplied, () => current.revision);
  if (expected !== current.revision)
    throw new Error("workspace configuration changed; reload before editing");
  return expected;
};

export function verifyWorkspaceRepositoryRoot(repositoryRoot: string): string {
  const canonical = fs.realpathSync.native(path.resolve(repositoryRoot));
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: canonical,
    encoding: "utf8",
    timeout: 10_000,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  }).trim();
  const actual = fs.realpathSync.native(root);
  const normalize = (value: string) =>
    process.platform === "win32"
      ? path.resolve(value).toLowerCase()
      : path.resolve(value);
  if (normalize(actual) !== normalize(canonical))
    throw new Error("repository-root must be the exact Git checkout root");
  return canonical;
}

export function validateWorkspaceRepositories(
  configuration: WorkspaceConfiguration,
) {
  return configuration.projects.map((project) => {
    try {
      verifyWorkspaceRepositoryRoot(project.repositoryRoot);
      const remote = execFileSync("git", ["remote", "get-url", "origin"], {
        cwd: project.repositoryRoot,
        encoding: "utf8",
        timeout: 10_000,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      }).trim();
      const expected =
        project.hub.kind === "github"
          ? `github.com/${project.hub.repository}`
          : `dev.azure.com/${project.hub.organization}/${project.hub.project}/_git/${project.hub.repository}`;
      const normalized = decodeURIComponent(remote)
        .replace(/^git@github\.com:/i, "github.com/")
        .replace(/^https:\/\/(?:[^/@]+@)?/i, "")
        .replace(/\.git\/?$/, "")
        .replace(/\/$/, "");
      if (normalized.toLowerCase() !== expected.toLowerCase())
        return {
          projectId: project.id,
          status: "blocked" as const,
          diagnostic:
            "origin does not match registered hub; execution is not ready",
        };
      return {
        projectId: project.id,
        status: "ready" as const,
        diagnostic:
          "Git root and origin match registration; no write or worker capability implied",
      };
    } catch (error) {
      return {
        projectId: project.id,
        status: "blocked" as const,
        diagnostic: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

const init = Command.make(
  "init",
  { database, id: Options.text("id").pipe(Options.withDefault("local")) },
  (args) =>
    withWorkspace(args.database, (store) =>
      initializeWorkspace(store, args.id),
    ),
);
const list = Command.make("list", { database }, (args) =>
  withWorkspace(args.database, readWorkspaceConfiguration),
);
const add = Command.make(
  "add",
  {
    database,
    revision,
    id,
    repositoryRoot: Options.text("repository-root"),
    mode: Options.choice("mode", ["individual", "integrated"]).pipe(
      Options.withDefault("individual"),
    ),
    github: Options.text("github").pipe(Options.optional),
    adoOrganization: Options.text("ado-organization").pipe(Options.optional),
    adoProject: Options.text("ado-project").pipe(Options.optional),
    adoRepository: Options.text("ado-repository").pipe(Options.optional),
  },
  (args) =>
    withWorkspace(args.database, (store) => {
      const github = Option.getOrUndefined(args.github);
      const organization = Option.getOrUndefined(args.adoOrganization);
      const project = Option.getOrUndefined(args.adoProject);
      const repository = Option.getOrUndefined(args.adoRepository);
      let hub: OrchestrationProject["hub"];
      if (github && !organization && !project && !repository)
        hub = { kind: "github", repository: github };
      else if (!github && organization && project && repository)
        hub = { kind: "ado", organization, project, repository };
      else
        throw new Error(
          "provide exactly --github owner/repo or all three --ado-* options",
        );
      return registerWorkspaceProject(
        store,
        expectedRevision(store, args.revision),
        {
          id: args.id,
          repositoryRoot: verifyWorkspaceRepositoryRoot(args.repositoryRoot),
          mode: args.mode,
          hub,
        },
      );
    }),
);
const remove = Command.make("remove", { database, revision, id }, (args) =>
  withWorkspace(args.database, (store) =>
    removeWorkspaceProject(
      store,
      expectedRevision(store, args.revision),
      args.id,
    ),
  ),
);
const routeAdd = Command.make(
  "route-add",
  { database, revision, file },
  (args) =>
    withWorkspace(args.database, (store) =>
      registerWorkspaceRoute(
        store,
        expectedRevision(store, args.revision),
        workspaceContractRouteSchema.parse(readJson(args.file)),
      ),
    ),
);
const routeRemove = Command.make(
  "route-remove",
  { database, revision, id },
  (args) =>
    withWorkspace(args.database, (store) =>
      removeWorkspaceRoute(
        store,
        expectedRevision(store, args.revision),
        args.id,
      ),
    ),
);
const routes = Command.make("routes", { database }, (args) =>
  withWorkspace(
    args.database,
    (store) => readWorkspaceConfiguration(store).routes,
  ),
);
const focus = Command.make("focus", { database, revision, file }, (args) =>
  withWorkspace(args.database, (store) => {
    const next = workspaceFocusSchema.parse(readJson(args.file));
    return updateWorkspaceConfiguration(
      store,
      expectedRevision(store, args.revision),
      (config) => ({ ...config, focus: next }),
    );
  }),
);
const discoveryAdd = Command.make(
  "discovery-add",
  { database, revision, file },
  (args) =>
    withWorkspace(args.database, (store) => {
      const source = workspaceDiscoverySourceSchema.parse(readJson(args.file));
      return updateWorkspaceConfiguration(
        store,
        expectedRevision(store, args.revision),
        (config) => ({ ...config, discovery: [...config.discovery, source] }),
      );
    }),
);
const discoveryRemove = Command.make(
  "discovery-remove",
  { database, revision, id },
  (args) =>
    withWorkspace(args.database, (store) =>
      updateWorkspaceConfiguration(
        store,
        expectedRevision(store, args.revision),
        (config) => {
          if (!config.discovery.some((source) => source.id === args.id))
            throw new Error("unknown discovery source");
          return {
            ...config,
            discovery: config.discovery.filter(
              (source) => source.id !== args.id,
            ),
          };
        },
      ),
    ),
);
const runtime = Command.make("runtime", { database, revision, file }, (args) =>
  withWorkspace(args.database, (store) => {
    const next = workspaceConfigurationSchema.shape.runtime.parse(
      readJson(args.file),
    );
    return updateWorkspaceConfiguration(
      store,
      expectedRevision(store, args.revision),
      (config) => ({ ...config, runtime: next }),
    );
  }),
);
const templateAdd = Command.make(
  "task-template-add",
  { database, revision, file },
  (args) =>
    withWorkspace(args.database, (store) => {
      const template = readJson(args.file);
      return updateWorkspaceConfiguration(
        store,
        expectedRevision(store, args.revision),
        (config) =>
          parseWorkspaceConfiguration({
            ...config,
            taskTemplates: [...config.taskTemplates, template],
          }),
      );
    }),
);
const templateRemove = Command.make(
  "task-template-remove",
  { database, revision, id },
  (args) =>
    withWorkspace(args.database, (store) =>
      updateWorkspaceConfiguration(
        store,
        expectedRevision(store, args.revision),
        (config) => {
          if (!config.taskTemplates.some((task) => task.id === args.id))
            throw new Error("unknown task template");
          return {
            ...config,
            taskTemplates: config.taskTemplates.filter(
              (task) => task.id !== args.id,
            ),
          };
        },
      ),
    ),
);
const validate = Command.make("validate", { database }, (args) =>
  withWorkspace(args.database, (store) => {
    const configuration = readWorkspaceConfiguration(store);
    const projects = validateWorkspaceRepositories(configuration);
    const blockers = [
      ...(!projects.length ? ["No repositories registered"] : []),
      ...(!configuration.focus.projectIds.length
        ? ["No focused repositories selected"]
        : []),
      ...(!configuration.discovery.length
        ? ["No explicit discovery sources configured"]
        : []),
      ...(!configuration.runtime.phaseDefinitions.length
        ? ["No verified installed DevSquad phase registry configured"]
        : []),
    ];
    if (
      blockers.length ||
      projects.some((project) => project.status !== "ready")
    )
      process.exitCode = 2;
    return {
      status:
        blockers.length ||
        projects.some((project) => project.status !== "ready")
          ? "blocked"
          : "configured",
      configurationRevision: configuration.revision,
      projects,
      blockers,
      liveExecutionVerified: false,
    };
  }),
);
const events = Command.make(
  "events",
  { database, after: Options.integer("after").pipe(Options.withDefault(0)) },
  (args) => withWorkspace(args.database, (store) => store.events(args.after)),
);
export const orchestrationWorkspaceCommand = Command.make("workspace").pipe(
  Command.withSubcommands([
    init,
    add,
    remove,
    list,
    routeAdd,
    routeRemove,
    routes,
    focus,
    discoveryAdd,
    discoveryRemove,
    runtime,
    templateAdd,
    templateRemove,
    validate,
    events,
  ]),
);
