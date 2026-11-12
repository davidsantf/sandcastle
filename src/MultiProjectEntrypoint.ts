import path from "node:path";
import { pathToFileURL } from "node:url";
import { MultiProjectJournal } from "./MultiProjectJournal.js";
import { runMultiProjectDemo } from "./MultiProjectDemo.js";
import { runMultiProjectCoworkDemo } from "./MultiProjectCoworkDemo.js";
import {
  runMultiProjectOrchestrationPass,
  type MultiProjectHost,
  type MultiProjectPassResult,
} from "./MultiProjectOrchestrator.js";
import {
  parseOrchestrationCatalog,
  digest,
  type OrchestrationProject,
} from "./MultiProjectProtocol.js";
import {
  OrchestrationWorkspaceStore,
  defaultWorkspaceConfiguration,
  readWorkspaceConfiguration,
  workspaceConfigurationKey,
} from "./OrchestrationWorkspace.js";
import { runLocalOrchestrationPass } from "./LocalOrchestrationService.js";
import { evaluateOrchestrationFocus } from "./OrchestrationFocus.js";

export interface MultiProjectHostConfiguration {
  catalog: unknown;
  journalPath: string;
  host: MultiProjectHost;
}

/** A config module is trusted executable host code, not a worker proposal. */
export async function runMultiProjectEntrypoint(options: {
  config?: string;
  demoDirectory?: string;
  coworkDemoDirectory?: string;
  signal?: AbortSignal;
}) {
  if (
    [options.config, options.demoDirectory, options.coworkDemoDirectory].filter(
      Boolean,
    ).length !== 1
  )
    throw new Error("choose exactly one of --config, --demo or --cowork-demo");
  if (options.coworkDemoDirectory)
    return runMultiProjectCoworkDemo(options.coworkDemoDirectory);
  if (options.demoDirectory) return runMultiProjectDemo(options.demoDirectory);
  const configModule = await import(
    pathToFileURL(path.resolve(options.config!)).href
  );
  const config: MultiProjectHostConfiguration = configModule.default;
  if (
    !config ||
    typeof config.journalPath !== "string" ||
    !["authorize", "execute", "resolveRevision", "validate", "observe"].every(
      (key) =>
        typeof config.host?.[key as keyof MultiProjectHost] === "function",
    )
  )
    throw new Error(
      "config must export {catalog,journalPath,host} with all host capabilities",
    );
  const catalog = parseOrchestrationCatalog(config.catalog);
  const store = new OrchestrationWorkspaceStore(
    path.resolve(config.journalPath),
  );
  try {
    const configuredWorkspace =
      store.read(workspaceConfigurationKey).value !== null;
    const configuration = configuredWorkspace
      ? readWorkspaceConfiguration(store)
      : defaultWorkspaceConfiguration(catalog.id);
    const projectIdentity = (project: OrchestrationProject) => {
      const { pullRequest: _pullRequest, ...hub } = project.hub;
      const root = path.resolve(project.repositoryRoot);
      return digest({
        root: process.platform === "win32" ? root.toLowerCase() : root,
        mode: project.mode,
        hub,
      });
    };
    let result: MultiProjectPassResult | undefined;
    const status = await runLocalOrchestrationPass({
      configuration,
      store,
      signal: options.signal,
      tick: async ({
        signal,
        configuration: current,
        store: guarded,
        passId,
      }) => {
        const journal = new MultiProjectJournal(
          path.resolve(config.journalPath),
        );
        try {
          const admit = (intent: string, stage: string) => {
            signal.throwIfAborted();
            const key = `workspace-core-admission/${digest(current.id)}`;
            const prior = guarded.read(key);
            return guarded.compareAndSwap(
              key,
              prior.version,
              { passId, intentDigest: digest(intent), stage },
              {
                kind: "workspace-core-admission",
                at: new Date().toISOString(),
              },
            );
          };
          const gateHost = (host: MultiProjectHost): MultiProjectHost => ({
            ...host,
            resolveRevision: host.resolveRevision.bind(host),
            validate: host.validate.bind(host),
            observe: host.observe.bind(host),
            ...(host.beforeTasks
              ? { beforeTasks: host.beforeTasks.bind(host) }
              : {}),
            ...(host.observeSourceItem
              ? { observeSourceItem: host.observeSourceItem.bind(host) }
              : {}),
            ...(host.registerChangeRequest
              ? { registerChangeRequest: host.registerChangeRequest.bind(host) }
              : {}),
            ...(host.afterTask ? { afterTask: host.afterTask.bind(host) } : {}),
            ...(host.assessPhase
              ? { assessPhase: host.assessPhase.bind(host) }
              : {}),
            ...(host.validatePolicy
              ? { validatePolicy: host.validatePolicy.bind(host) }
              : {}),
            ...(host.bindRun
              ? { bindRun: (context) => gateHost(host.bindRun!(context)) }
              : {}),
            authorize: async (request, requestSignal) => {
              if (configuredWorkspace) {
                const registered = current.projects.find(
                  (project) => project.id === request.project.id,
                );
                const supplied = catalog.projects.find(
                  (project) => project.id === request.project.id,
                );
                if (
                  !registered ||
                  !supplied ||
                  projectIdentity(registered) !== projectIdentity(supplied) ||
                  path.resolve(request.project.repositoryRoot) !==
                    path.resolve(supplied.repositoryRoot) ||
                  !evaluateOrchestrationFocus(current.focus, {
                    projectId: request.task.projectId,
                    action: ["implement", "fix"].includes(request.stage)
                      ? "implement"
                      : "investigate",
                  }).allowed
                )
                  return false;
              }
              return (
                (await host.authorize(request, requestSignal)) &&
                admit(request.intent, request.stage)
              );
            },
            execute: async (request, requestSignal) =>
              admit(request.intent, request.stage)
                ? host.execute(request, requestSignal)
                : {
                    kind: "failed",
                    signature: "workspace-admission-fenced",
                    evidence:
                      "Workspace ownership/configuration changed; worker was not started",
                  },
          });
          result = await runMultiProjectOrchestrationPass({
            catalog,
            journal,
            host: gateHost(config.host),
            signal,
          });
        } finally {
          journal.close();
        }
      },
    });
    if (status.state === "blocked" || !result)
      throw new Error(status.diagnostic);
    return result;
  } finally {
    store.close();
  }
}
