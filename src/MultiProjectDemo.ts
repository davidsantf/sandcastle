import { mkdirSync } from "node:fs";
import path from "node:path";
import { MultiProjectJournal } from "./MultiProjectJournal.js";
import {
  runMultiProjectOrchestrationPass,
  type MultiProjectHost,
} from "./MultiProjectOrchestrator.js";
import {
  digest,
  parseOrchestrationCatalog,
  type OrchestrationProject,
} from "./MultiProjectProtocol.js";
import {
  createAdoOrchestrationHub,
  createGitHubOrchestrationHub,
} from "./MultiProjectHubs.js";

const sha = "a".repeat(40);
const contract = digest("shared API v1");

export async function runMultiProjectDemo(directory: string) {
  const root = path.resolve(directory);
  const githubRoot = path.join(root, "github-project");
  const adoRoot = path.join(root, "ado-project");
  const independentRoot = path.join(root, "independent-project");
  for (const folder of [githubRoot, adoRoot, independentRoot])
    mkdirSync(folder, { recursive: true });
  const github = createGitHubOrchestrationHub(async (url) => {
    if (url.includes("/protection"))
      return { required_status_checks: { contexts: ["build"], checks: [] } };
    if (url.includes("/rules/")) return [];
    if (url.includes("/check-runs"))
      return {
        total_count: 1,
        check_runs: [
          {
            id: 1,
            name: "build",
            head_sha: sha,
            status: "completed",
            conclusion: "success",
            app: { id: 1 },
          },
        ],
      };
    if (url.includes("/status?")) return { statuses: [] };
    if (url.includes("/issues/")) return { labels: [] };
    return { state: "open", head: { sha }, base: { ref: "main" } };
  });
  const ado = createAdoOrchestrationHub(async (url) => {
    if (url.includes("/configurations?"))
      return { value: [{ id: 1, isEnabled: true, isBlocking: true }] };
    if (url.includes("/evaluations?"))
      return {
        value: [
          {
            configuration: { id: 1 },
            status: "approved",
            context: { buildId: 1 },
          },
        ],
      };
    if (
      url.includes("/statuses?") ||
      url.includes("/labels?") ||
      url.includes("/iterations?")
    )
      return { value: [] };
    if (url.includes("/build/builds/"))
      return { sourceVersion: sha, status: "completed", result: "succeeded" };
    return {
      status: "active",
      lastMergeSourceCommit: { commitId: sha },
      repository: { id: "repo", project: { id: "project" } },
      targetRefName: "refs/heads/main",
    };
  });
  const task = (projectId: string, id: string) => ({
    projectId,
    id,
    title: `${projectId} ${id}`,
    brief: "Safe scripted demonstration; no agent or remote write.",
    branch: `demo/${id}`,
    baseBranch: "main",
    scopes: ["src"],
    acceptance: [{ label: "unit", command: "fake-host-validation" }],
  });
  const catalog = parseOrchestrationCatalog({
    id: "demo",
    projects: [
      {
        id: "api",
        repositoryRoot: githubRoot,
        mode: "integrated",
        hub: { kind: "github", repository: "demo/api", pullRequest: 1 },
      },
      {
        id: "app",
        repositoryRoot: adoRoot,
        mode: "integrated",
        hub: {
          kind: "ado",
          organization: "demo",
          project: "demo",
          repository: "app",
          pullRequest: 1,
        },
      },
      {
        id: "docs",
        repositoryRoot: independentRoot,
        mode: "individual",
        hub: { kind: "github", repository: "demo/docs", pullRequest: 1 },
      },
    ],
    tasks: [
      { ...task("api", "contract"), providesContracts: ["api"] },
      {
        ...task("app", "consumer"),
        dependsOn: ["api:contract"],
        requiresContracts: [{ task: "api:contract", name: "api" }],
      },
      task("docs", "guide"),
    ],
  });
  const host: MultiProjectHost = {
    authorize: async () => true, // Explicitly trusted fake-only policy.
    execute: async (request) => ({
      kind: "completed",
      artifact: `${request.stage} artifact for ${request.task.projectId}:${request.task.id}`,
      contracts: {},
      findings: [],
    }),
    resolveRevision: async () => sha,
    validate: async (request) => ({
      revision: sha,
      evaluatedScope: 1,
      regressions: 0,
      checks: [{ name: "unit", state: "passed" }],
      contracts: {
        ...request.contracts,
        ...(request.task.providesContracts.includes("api")
          ? { api: contract }
          : {}),
      },
    }),
    observe: async (project: OrchestrationProject, _task, signal) =>
      project.hub.kind === "github"
        ? github(project, signal)
        : ado(project, signal),
  };
  const journal = new MultiProjectJournal(
    path.join(root, "orchestration.sqlite"),
  );
  try {
    const result = await runMultiProjectOrchestrationPass({
      catalog,
      journal,
      host,
    });
    return { ...result, eventCount: journal.events(catalog.id).length };
  } finally {
    journal.close();
  }
}
