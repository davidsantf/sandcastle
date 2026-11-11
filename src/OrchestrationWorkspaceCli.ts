import { Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";
import fs from "node:fs";
import path from "node:path";
import {
  readDashboardConfiguration,
  startOrchestrationDashboard,
} from "./OrchestrationDashboard.js";
import {
  verifyWorkspaceRepositoryRoot,
  validateWorkspaceRepositories,
} from "./OrchestrationWorkspaceRepositories.js";
export {
  verifyWorkspaceRepositoryRoot,
  validateWorkspaceRepositories,
} from "./OrchestrationWorkspaceRepositories.js";
import {
  OrchestrationWorkspaceStore,
  initializeWorkspace,
  readWorkspaceConfiguration,
  updateWorkspaceConfiguration,
  migrateWorkspaceConfiguration,
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
import { createWorkspaceServiceCommands } from "./OrchestrationWorkspaceServiceCli.js";
import {
  inspectWorkspaceReadiness,
  runWorkspaceNativeTick,
} from "./OrchestrationWorkspaceHost.js";
import {
  createOrchestrationProposalQueue,
  type OrchestrationProposal,
} from "./OrchestrationProposal.js";
import { runLocalOrchestrationPass } from "./LocalOrchestrationService.js";
import { retryOrchestrationDiscovery } from "./OrchestrationNativeHost.js";
import { reconcileUnstartedWorkspacePlanning } from "./OrchestrationPlanningRecovery.js";

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
const reconcilePlanning = Command.make(
  "reconcile-planning",
  { database, file },
  (args) =>
    withWorkspace(args.database, async (store) => {
      const result = await reconcileUnstartedWorkspacePlanning(
        store,
        readJson(args.file),
      );
      return {
        id: result.id,
        status: result.status,
        planningSettlement: result.planningSettlement,
      };
    }),
);
const migrate = Command.make("migrate", { database }, (args) =>
  withWorkspace(args.database, migrateWorkspaceConfiguration),
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
const discoveryRetry = Command.make(
  "discovery-retry",
  { database, revision: Options.integer("revision"), id },
  (args) =>
    withWorkspace(args.database, async (store) => {
      const configuration = readWorkspaceConfiguration(store);
      if (configuration.revision !== args.revision)
        throw new Error("workspace configuration changed; reload before retry");
      let result: ReturnType<typeof retryOrchestrationDiscovery> | undefined;
      const service = await runLocalOrchestrationPass({
        configuration,
        store,
        tick: async (context) => {
          result = retryOrchestrationDiscovery(context, args.id);
        },
      });
      if (service.state === "blocked" || !result) {
        process.exitCode = 2;
        return { status: "blocked", service };
      }
      return result;
    }),
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
const validate = Command.make(
  "validate",
  { database, live: Options.boolean("live") },
  (args) =>
    withWorkspace(args.database, async (store) => {
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
      const readiness = await inspectWorkspaceReadiness(
        configuration,
        AbortSignal.timeout(60_000),
        args.live,
        store,
      );
      blockers.push(
        ...readiness.diagnostics,
        ...readiness.sources
          .filter((source) => source.status === "blocked")
          .map((source) => `${source.sourceId}: ${source.diagnostic}`),
      );
      const executionReady = readiness.native.executionReady;
      if (
        blockers.length ||
        !executionReady ||
        projects.some((project) => project.status !== "ready")
      )
        process.exitCode = 2;
      return {
        status:
          blockers.length ||
          !executionReady ||
          projects.some((project) => project.status !== "ready")
            ? "blocked"
            : "configured",
        configurationRevision: configuration.revision,
        projects,
        blockers,
        readiness,
        liveExecutionVerified: false,
      };
    }),
);
const proposals = Command.make("proposals", { database }, (args) =>
  withWorkspace(args.database, (store) => {
    const configuration = readWorkspaceConfiguration(store);
    return createOrchestrationProposalQueue({
      store,
      namespace: configuration.id,
    }).list();
  }),
);
const proposal = Command.make("proposal", { database, id }, (args) =>
  withWorkspace(args.database, (store) => {
    const configuration = readWorkspaceConfiguration(store);
    return createOrchestrationProposalQueue({
      store,
      namespace: configuration.id,
    }).get(args.id);
  }),
);
const review = Command.make(
  "review",
  {
    database,
    id,
    revision: Options.integer("revision"),
    proposalDigest: Options.text("proposal-digest"),
    sourceRevision: Options.text("source-revision"),
    decision: Options.choice("decision", ["approve", "reject"]),
  },
  (args) =>
    withWorkspace(args.database, async (store) => {
      const configuration = readWorkspaceConfiguration(store);
      if (configuration.revision !== args.revision)
        throw new Error("Stale configuration review; reload current proposal");
      let reviewed: OrchestrationProposal | undefined;
      const service = await runLocalOrchestrationPass({
        configuration,
        store,
        tick: async (context) => {
          reviewed = createOrchestrationProposalQueue({
            store: context.store,
            namespace: configuration.id,
          }).review({
            proposalId: args.id,
            proposalDigest: args.proposalDigest,
            sourceRevision: args.sourceRevision,
            configurationRevision: args.revision,
            decision: args.decision,
          });
        },
      });
      if (service.state === "blocked" || !reviewed) {
        process.exitCode = 2;
        return { status: "blocked", service };
      }
      return reviewed;
    }),
);
const events = Command.make(
  "events",
  { database, after: Options.integer("after").pipe(Options.withDefault(0)) },
  (args) => withWorkspace(args.database, (store) => store.events(args.after)),
);
export const orchestrationWorkspaceCommand = Command.make("workspace").pipe(
  Command.withSubcommands([
    Command.make(
      "dashboard",
      {
        file: Options.text("file"),
        port: Options.integer("port").pipe(Options.withDefault(4318)),
      },
      (args) =>
        Effect.tryPromise(async () => {
          if (args.port < 1 || args.port > 65535)
            throw new Error("Invalid dashboard port");
          const dashboard = await startOrchestrationDashboard({
            ...readDashboardConfiguration(path.resolve(args.file)),
            port: args.port,
          });
          console.log(
            JSON.stringify({
              event: "dashboard-ready",
              url: dashboard.url,
              readOnly: true,
            }),
          );
          await new Promise<void>((resolve) => {
            const stop = () => {
              void dashboard.close().then(resolve);
            };
            process.once("SIGINT", stop);
            process.once("SIGTERM", stop);
          });
        }),
    ),
    init,
    migrate,
    add,
    remove,
    list,
    routeAdd,
    routeRemove,
    routes,
    focus,
    discoveryAdd,
    discoveryRemove,
    discoveryRetry,
    runtime,
    templateAdd,
    templateRemove,
    validate,
    events,
    proposals,
    proposal,
    review,
    reconcilePlanning,
    ...createWorkspaceServiceCommands(runWorkspaceNativeTick),
  ]),
);
