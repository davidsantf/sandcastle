import fs from "node:fs";
import path from "node:path";
import { createServer, type Server } from "node:http";
import { z } from "zod";
import {
  OrchestrationWorkspaceStore,
  readWorkspaceConfiguration,
} from "./OrchestrationWorkspace.js";
import { createOrchestrationProposalQueue } from "./OrchestrationProposal.js";
import { orchestrationServiceDigest } from "./OrchestrationOperations.js";
import { sendLocalOrchestrationControl } from "./LocalOrchestrationServiceControl.js";
import {
  dashboardHtml,
  dashboardCss,
  dashboardJs,
} from "./OrchestrationDashboardPage.js";
import { nativePollKey } from "./OrchestrationNativeHost.js";

export const dashboardConfigurationSchema = z
  .strictObject({
    workspaces: z
      .array(
        z.strictObject({
          name: z.string().trim().min(1).max(80),
          database: z
            .string()
            .refine(path.isAbsolute, "absolute database required"),
        }),
      )
      .min(1)
      .max(10),
  })
  .refine(
    (value) =>
      new Set(value.workspaces.map((w) => w.database.toLowerCase())).size ===
      value.workspaces.length,
    "duplicate database",
  );
type DashboardWorkspace = z.infer<
  typeof dashboardConfigurationSchema
>["workspaces"][number];
const objectSchema = z.record(z.string(), z.unknown());
const record = (value: unknown) => objectSchema.parse(value);
const optionalRecord = (value: unknown) => (value == null ? {} : record(value));
const clean = (value: unknown, maximum = 600) =>
  typeof value === "string"
    ? value
        .replace(
          /Bearer\s+\S+|(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]+/gi,
          "[redacted]",
        )
        .replace(/(?:token|secret|password)\s*[=:]\s*\S+/gi, "[redacted]")
        .replace(/[A-Za-z]:[\\/][^\s"']+|\\\\[^\s"']+/g, "[local path]")
        .slice(0, maximum)
    : "";
const strings = (value: unknown) =>
  Array.isArray(value) ? value.map((v) => clean(v)).filter(Boolean) : [];
const sourceUrl = (value: string) => {
  const url = new URL(value);
  return url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    ["github.com", "dev.azure.com"].includes(url.hostname)
    ? url.href
    : undefined;
};
export function dashboardHealth(
  state: string,
  lastPoll: string | undefined,
  interval: number,
  now: number,
) {
  if (["not-running", "crashed", "offline"].includes(state)) return "offline";
  if (state === "blocked") return "blocked";
  const time = lastPoll ? Date.parse(lastPoll) : NaN;
  if (!Number.isFinite(time) || now - time > Math.max(interval * 3, 180000))
    return "stale";
  return "online";
}
export async function readDashboardWorkspace(
  workspace: DashboardWorkspace,
  options: {
    now?: number;
    control?: typeof sendLocalOrchestrationControl;
  } = {},
) {
  const store = new OrchestrationWorkspaceStore(workspace.database, Date.now, {
    readOnly: true,
  });
  try {
    const config = readWorkspaceConfiguration(store);
    const suffix = orchestrationServiceDigest(config.id);
    const owner = optionalRecord(store.read(`service-owner/${suffix}`).value);
    let state = owner.state === "active" ? "offline" : "not-running";
    let controlError = "";
    if (owner.state === "active") {
      try {
        const status = await (options.control ?? sendLocalOrchestrationControl)(
          {
            workspaceId: config.id,
            directory: path.join(
              path.dirname(workspace.database),
              `.${config.id}-control`,
            ),
          },
          { action: "status" },
        );
        state = status.state;
      } catch {
        controlError =
          "Owner is recorded, but authenticated local control is unreachable. Inspect the host; no restart attempted.";
      }
    }
    const pass = optionalRecord(store.read(`workspace-pass/${suffix}`).value);
    const result = optionalRecord(pass.result);
    const failure = optionalRecord(
      store.read(`service-failure/${suffix}`).value,
    );
    const currentRevision = pass.configurationRevision === config.revision;
    const phases = store.inspectRecords("local-execution/", 100).map((row) => {
      const value = record(row.value);
      return {
        stage: clean(value.stage),
        outcome: clean(value.outcome),
        at: row.at,
        agent: clean(value.requestedAgent, 200),
        task: clean(value.taskId, 100),
        currentConfiguration: value.configurationRevision === config.revision,
        evidence:
          "Native CLI launch provenance, not independent backend attestation",
      };
    });
    const proposals = createOrchestrationProposalQueue({
      store,
      namespace: config.id,
    })
      .list()
      .map(({ proposal }) => ({
        id: proposal.id,
        issue: proposal.source.id,
        url: sourceUrl(proposal.source.url),
        title: clean(proposal.source.title, 250),
        state: proposal.status,
        revision: proposal.configurationRevision,
        currentConfiguration:
          proposal.configurationRevision === config.revision,
        unresolvedPrior: Boolean(proposal.supersededFrom),
        diagnostic: clean(proposal.diagnostic),
        artifacts: proposal.artifacts
          ? {
              investigation: true,
              specification: true,
              plan: true,
            }
          : undefined,
      }));
    const validations = store
      .inspectRecords("native-local-validation/", 100)
      .map((row) => {
        const value = record(row.value);
        return {
          at: row.at,
          state: clean(value.state),
          evaluatedScope: Number(value.evaluatedScope ?? 0),
          diagnostic: clean(value.diagnostic),
          independentReview: false,
        };
      });
    const events = store
      .recentEvents()
      .reverse()
      .map((e) => ({
        sequence: e.sequence,
        kind: e.kind,
        at: e.at,
      }));
    const blockers = strings(result.diagnostics);
    if (controlError) blockers.unshift(controlError);
    if (owner.state !== "active" && failure.classification)
      blockers.unshift(
        `Service stopped after ${clean(failure.phase)} failure (${clean(failure.classification)}) at ${clean(failure.at)}.`,
      );
    const polls = config.discovery.map((source) => {
      const key = nativePollKey(config, source);
      const value = optionalRecord(store.read(key).value);
      const successful = store.inspectRecordHistory(key).find((row) => {
        const event = record(row.value);
        return (
          event.failures === 0 &&
          event.diagnostic === "" &&
          event.cursor != null
        );
      });
      return { diagnostic: clean(value.diagnostic), at: successful?.at };
    });
    const lastPoll =
      polls.length && polls.every((p) => p.at)
        ? polls.map((p) => p.at!).sort()[0]
        : undefined;
    const health = dashboardHealth(
      state,
      lastPoll,
      config.pollIntervalMs,
      options.now ?? Date.now(),
    );
    if (health === "stale")
      blockers.unshift(
        "Polling evidence is stale; a live control response is not a successful source read.",
      );
    const current = proposals.filter(
      (p) => p.currentConfiguration && p.state !== "superseded",
    );
    for (const poll of polls) {
      const diagnostic = poll.diagnostic;
      if (diagnostic && !blockers.includes(diagnostic))
        blockers.push(diagnostic);
    }
    return {
      name: workspace.name,
      id: config.id,
      health,
      serviceState: state,
      mode: config.focus.mode,
      revision: config.revision,
      lastSuccessfulPoll: lastPoll,
      lastCompletedPass: typeof pass.at === "string" ? pass.at : undefined,
      pollEvidenceBoundary:
        "Oldest last-success across current sources, searched within 200 retained events per source. Missing means unknown, not zero eligible.",
      passConfigurationCurrent: currentRevision,
      evaluatedSources: Number(result.evaluatedSources ?? 0),
      currentEligibility:
        "Not independently re-queried. Current-revision retained observations are not a live eligible count.",
      retainedCount: proposals.length,
      currentObservations: current.length,
      activePhases:
        state === "running"
          ? phases.filter(
              (p) => p.currentConfiguration && p.outcome === "admitted",
            ).length
          : 0,
      activity:
        state === "running"
          ? "Pass in progress; inspect phase evidence below"
          : controlError
            ? "Control unreachable; worker liveness is unknown"
            : state === "paused"
              ? "Paused; previously admitted work may still settle"
              : blockers.length
                ? "No active phase confirmed; attention required"
                : "Idle between polls; no active phase confirmed",
      scope: config.discovery.map((source) => ({
        hub: source.hub.kind,
        project: source.hub.repository,
        eligibility:
          "assignedToOrLabel" in source.selector
            ? `Assigned to configured user OR exact ${source.selector.assignedToOrLabel.optedInLabel}`
            : "assignedTo" in source.selector
              ? "Assigned to configured user"
              : `Exact ${source.selector.optedInLabel}`,
        workItemTypes: source.workItemTypes ?? [],
        team: config.focus.team,
        iteration: config.focus.iteration,
        query: config.focus.query,
      })),
      writableScopes: config.taskTemplates.flatMap((t) => t.scopes),
      blockers,
      proposals,
      phases,
      validations,
      events,
      proofBoundary:
        "Live canonical journals only. Local tests are not independent review; fixture proofs are not live task progress. Workers are native CLI subprocesses, not app sessions.",
    };
  } finally {
    store.close();
  }
}
export async function startOrchestrationDashboard(options: {
  workspaces: DashboardWorkspace[];
  port?: number;
  read?: typeof readDashboardWorkspace;
}) {
  const configured = dashboardConfigurationSchema.parse({
    workspaces: options.workspaces,
  });
  let pending: Promise<unknown> | undefined;
  let cached: unknown;
  let cachedAt = 0;
  const snapshot = () => {
    if (pending) return pending;
    if (cached && Date.now() - cachedAt < 10000) return Promise.resolve(cached);
    pending = Promise.all(
      configured.workspaces.map(async (workspace) => {
        try {
          return await (options.read ?? readDashboardWorkspace)(workspace);
        } catch {
          return {
            name: workspace.name,
            health: "error",
            error:
              "Canonical journal unavailable or invalid. Inspect local status; no repair attempted.",
          };
        }
      }),
    )
      .then((projects) => {
        cachedAt = Date.now();
        cached = { updatedAt: new Date(cachedAt).toISOString(), projects };
        return cached;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
  let origin = "";
  const server: Server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    if (
      request.headers.host !== new URL(origin).host ||
      (request.headers.origin && request.headers.origin !== origin) ||
      (request.headers["sec-fetch-site"] === "cross-site" &&
        !(
          request.method === "GET" &&
          request.url === "/" &&
          request.headers["sec-fetch-mode"] === "navigate"
        ))
    ) {
      response.writeHead(403).end("Local same-origin access only");
      return;
    }
    if (request.method !== "GET") {
      response.writeHead(405, { Allow: "GET" }).end("Read-only");
      return;
    }
    const assets: Record<string, [string, string]> = {
      "/": ["text/html; charset=utf-8", dashboardHtml],
      "/dashboard.css": ["text/css; charset=utf-8", dashboardCss],
      "/dashboard.js": ["text/javascript; charset=utf-8", dashboardJs],
    };
    if (request.url && assets[request.url]) {
      const [type, body] = assets[request.url]!;
      response.writeHead(200, { "Content-Type": type }).end(body);
      return;
    }
    if (request.url !== "/api/state") {
      response.writeHead(404).end("Not found");
      return;
    }
    try {
      response
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify(await snapshot()));
    } catch {
      response.writeHead(503).end('{"error":"Status collection failed"}');
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 4318, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Dashboard address unavailable");
  origin = `http://127.0.0.1:${address.port}`;
  return {
    server,
    url: origin,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
export function readDashboardConfiguration(filename: string) {
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536)
    throw new Error("Invalid local dashboard configuration");
  return dashboardConfigurationSchema.parse(
    JSON.parse(fs.readFileSync(filename, "utf8")),
  );
}
