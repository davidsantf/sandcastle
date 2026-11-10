import { execFile } from "node:child_process";
import { z } from "zod";
import { digest } from "./MultiProjectProtocol.js";
import {
  workspaceDiscoverySourceSchema,
  type WorkspaceDiscoverySource,
  type WorkspaceFocus,
} from "./OrchestrationWorkspaceContract.js";

export const orchestrationDiscoverySourceSchema =
  workspaceDiscoverySourceSchema;
export type OrchestrationDiscoverySource = WorkspaceDiscoverySource;
export type OrchestrationDiscoveryScope = Pick<
  WorkspaceFocus,
  "team" | "iteration" | "query"
>;
const queryId =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const orchestrationDiscoveryScopeFactsSchema = z.strictObject({
  team: z.string().min(1).max(200).optional(),
  iteration: z.string().min(1).max(200).optional(),
  query: z.string().regex(queryId).optional(),
});
export type OrchestrationDiscoveryScopeFacts = z.infer<
  typeof orchestrationDiscoveryScopeFactsSchema
>;
const sourceScopeReadiness = (
  source: OrchestrationDiscoverySource,
  focus: OrchestrationDiscoveryScope,
) => {
  const diagnostics: string[] = [];
  for (const selector of ["team", "iteration", "query"] as const) {
    if (focus[selector] === undefined) continue;
    if (source.hub.kind === "github")
      diagnostics.push(
        `Source ${source.id}: Native GitHub ${selector} mapping is unverified/unsupported`,
      );
    else if (selector === "query" && !queryId.test(focus.query!))
      diagnostics.push(
        `Source ${source.id}: ADO query scope requires an exact saved flat-query GUID`,
      );
    else if (
      selector === "iteration" &&
      focus.iteration !== source.hub.project &&
      !focus.iteration!.startsWith(`${source.hub.project}\\`)
    )
      diagnostics.push(
        `Source ${source.id}: ADO iteration scope requires a full native project iteration path`,
      );
  }
  return {
    sourceId: source.id,
    projectId: source.projectId,
    supported: diagnostics.length === 0,
    diagnostics,
  };
};
/** Static representability only; item facts still require native reads and matching. */
export function getOrchestrationNativeScopeReadiness(configuration: {
  focus: OrchestrationDiscoveryScope;
  discovery: OrchestrationDiscoverySource[];
}) {
  const sources = configuration.discovery.map((source) =>
    sourceScopeReadiness(source, configuration.focus),
  );
  return {
    sources,
    hasSupportedSource: sources.some((source) => source.supported),
    diagnostics: sources.flatMap((source) => source.diagnostics),
  };
}
export interface OrchestrationDiscoveredItem {
  sourceId: string;
  projectId: string;
  id: string;
  url: string;
  kind: "issue" | "pull-request" | "work-item";
  title: string;
  body: string;
  updatedAt: string;
  revision: string;
  feedback: unknown[];
  dependencies: unknown[];
  labels?: string[];
  scope?: OrchestrationDiscoveryScopeFacts;
}
export interface OrchestrationDiscoveryCursor {
  page: number;
  afterId: number;
  cycle: number;
}
export interface OrchestrationDiscoveryRequest {
  url: string;
  method: "GET" | "POST";
  body?: unknown;
}
export interface OrchestrationDiscoveryResponse {
  status: number;
  body: unknown;
  retryAfterMs?: number;
}
export type OrchestrationDiscoveryTransport = (
  request: OrchestrationDiscoveryRequest,
  signal: AbortSignal,
) => Promise<OrchestrationDiscoveryResponse>;

export class OrchestrationDiscoveryError extends Error {
  constructor(
    readonly code:
      | "access"
      | "rate-limit"
      | "incomplete"
      | "invalid"
      | "transport"
      | "scope"
      | "unsupported",
    readonly retryAfterMs = 60_000,
  ) {
    super(`Native discovery ${code}; source cursor was not advanced`);
  }
}
const record = z.record(z.string(), z.unknown());
const obj = (v: unknown) => record.parse(v);
const rows = (v: unknown) => z.array(record).max(1_000).parse(v);
const text = (v: unknown, limit = 64_000) =>
  z
    .string()
    .max(limit)
    .parse(v ?? "");
const positive = (v: unknown) => z.number().int().positive().parse(v);
const timestamp = (v: unknown) => z.iso.datetime({ offset: true }).parse(v);
const stableEvidence = (values: unknown[]) =>
  values.sort((a, b) => {
    const left = JSON.stringify(a),
      right = JSON.stringify(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
const cursorSchema = z.strictObject({
  page: z.number().int().min(1).max(100_000),
  afterId: z.number().int().min(0),
  cycle: z.number().int().min(0),
});
const safeUrl = (v: unknown): string => {
  const url = new URL(z.string().max(2_000).parse(v));
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new OrchestrationDiscoveryError("invalid");
  return url.href;
};

/** Uses the existing gh account. Error bodies and credentials are never logged. */
export const orchestrationGithubReadTransport: OrchestrationDiscoveryTransport =
  (request, signal) =>
    new Promise((resolve, reject) => {
      if (
        request.method !== "GET" ||
        !/^\/repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/|\?|$)/.test(
          request.url,
        ) ||
        /[\r\n]/.test(request.url)
      ) {
        reject(new OrchestrationDiscoveryError("invalid"));
        return;
      }
      execFile(
        "gh",
        [
          "api",
          "--include",
          "--method",
          "GET",
          request.url,
          "-H",
          "Accept: application/vnd.github+json",
        ],
        { signal, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
        (error, stdout) => {
          const split = stdout.search(/\r?\n\r?\n/);
          const header = stdout.slice(0, split);
          const status = Number(/^HTTP\/\S+ (\d+)/m.exec(header)?.[1]);
          if (!status || split < 0) {
            reject(new OrchestrationDiscoveryError("transport"));
            return;
          }
          const retry = /^retry-after:\s*(\d+)/im.exec(header)?.[1];
          const reset = /^x-ratelimit-reset:\s*(\d+)/im.exec(header)?.[1];
          const exhausted = /^x-ratelimit-remaining:\s*0\s*$/im.test(header);
          if (status === 429 || (status === 403 && (exhausted || retry))) {
            resolve({
              status: 429,
              body: null,
              retryAfterMs: retry
                ? Number(retry) * 1_000
                : reset
                  ? Math.max(1_000, Number(reset) * 1_000 - Date.now())
                  : 60_000,
            });
            return;
          }
          if (error || status >= 400) {
            resolve({ status, body: null });
            return;
          }
          try {
            let body = stdout.slice(split).trim();
            for (const token of [
              process.env.GH_TOKEN,
              process.env.GITHUB_TOKEN,
            ])
              if (token) body = body.replaceAll(token, "[redacted]");
            resolve({ status, body: JSON.parse(body) });
          } catch {
            reject(new OrchestrationDiscoveryError("invalid"));
          }
        },
      );
    });

/** WIQL POST is a read operation; arbitrary ADO mutations are not supported. */
export function createOrchestrationAdoReadTransport(credential: {
  kind: "bearer" | "pat";
  token: string;
}): OrchestrationDiscoveryTransport {
  if (!credential.token.trim())
    throw new Error("Existing ADO credential required");
  return async (request, signal) => {
    const url = new URL(request.url);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "dev.azure.com" ||
      url.username ||
      url.password ||
      url.hash ||
      (request.method === "POST" && !url.pathname.endsWith("/_apis/wit/wiql"))
    )
      throw new OrchestrationDiscoveryError("invalid");
    const response = await fetch(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      redirect: "error",
      method: request.method,
      headers: {
        Authorization:
          credential.kind === "bearer"
            ? `Bearer ${credential.token}`
            : `Basic ${Buffer.from(`:${credential.token}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body:
        request.body === undefined ? undefined : JSON.stringify(request.body),
    });
    if (!response.ok) {
      const retryHeader = response.headers.get("retry-after");
      const retry =
        retryHeader === null
          ? 60_000
          : /^\d+$/.test(retryHeader)
            ? Number(retryHeader) * 1_000
            : Date.parse(retryHeader) - Date.now();
      return {
        status: response.status,
        body: null,
        retryAfterMs: Number.isFinite(retry)
          ? Math.min(3_600_000, Math.max(1_000, retry))
          : 60_000,
      };
    }
    if (!response.body) throw new OrchestrationDiscoveryError("invalid");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 4 * 1024 * 1024) {
          await reader.cancel();
          throw new OrchestrationDiscoveryError("incomplete");
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    const body: unknown = JSON.parse(
      Buffer.concat(chunks)
        .toString("utf8")
        .replaceAll(credential.token, "[redacted]"),
    );
    if (response.headers.get("x-ms-continuationtoken"))
      throw new OrchestrationDiscoveryError("incomplete");
    return { status: response.status, body };
  };
}

export function createOrchestrationDiscoveryAdapter(
  input: OrchestrationDiscoverySource,
  transport?: OrchestrationDiscoveryTransport,
  focus: OrchestrationDiscoveryScope = {},
) {
  const source = orchestrationDiscoverySourceSchema.parse(input);
  if (!sourceScopeReadiness(source, focus).supported)
    throw new OrchestrationDiscoveryError("unsupported");
  const selectedScope: OrchestrationDiscoveryScope = Object.fromEntries(
    (["team", "iteration", "query"] as const).flatMap((key) =>
      focus[key] === undefined ? [] : [[key, focus[key]]],
    ),
  );
  const native =
    transport ??
    (source.hub.kind === "github"
      ? orchestrationGithubReadTransport
      : undefined);
  const hub = source.hub;
  const selector = source.selector;
  const assignment =
    "assignedTo" in selector
      ? selector.assignedTo
      : "assignedToOrLabel" in selector
        ? selector.assignedToOrLabel.assignedTo
        : undefined;
  const optIn =
    "optedInLabel" in selector
      ? selector.optedInLabel
      : "assignedToOrLabel" in selector
        ? selector.assignedToOrLabel.optedInLabel
        : undefined;
  const eligible = (assignees: unknown[], labels: unknown[]) =>
    (assignment !== undefined &&
      assignees.some(
        (value) =>
          typeof value === "string" &&
          value.toLowerCase() === assignment.toLowerCase(),
      )) ||
    (optIn !== undefined && labels.includes(optIn));
  const githubEligible = (item: Record<string, unknown>) =>
    eligible(
      rows(item.assignees ?? []).map((value) => value.login),
      rows(item.labels ?? []).map((value) => value.name),
    );
  const base =
    hub.kind === "github"
      ? `/repos/${hub.repository}`
      : `https://dev.azure.com/${hub.organization}/${encodeURIComponent(hub.project)}`;
  const request = async (
    url: string,
    signal: AbortSignal,
    body?: unknown,
  ): Promise<unknown> => {
    if (!native) throw new OrchestrationDiscoveryError("access");
    signal.throwIfAborted();
    let response: OrchestrationDiscoveryResponse;
    try {
      response = await native(
        { url, method: body === undefined ? "GET" : "POST", body },
        signal,
      );
    } catch (error) {
      if (error instanceof OrchestrationDiscoveryError || signal.aborted)
        throw error;
      throw new OrchestrationDiscoveryError("transport");
    }
    if (response.status === 429) {
      const delay = response.retryAfterMs ?? 60_000;
      throw new OrchestrationDiscoveryError(
        "rate-limit",
        Number.isFinite(delay)
          ? Math.min(3_600_000, Math.max(1_000, delay))
          : 60_000,
      );
    }
    if (response.status < 200 || response.status >= 300)
      throw new OrchestrationDiscoveryError("access");
    return response.body;
  };
  const githubPages = async (endpoint: string, signal: AbortSignal) => {
    const all: Record<string, unknown>[] = [];
    for (let page = 1; page <= source.maxPages; page++) {
      const batch = rows(
        await request(`${endpoint}?per_page=100&page=${page}`, signal),
      );
      all.push(...batch);
      if (batch.length < 100) return all;
    }
    throw new OrchestrationDiscoveryError("incomplete");
  };
  const observeGithub = async (
    item: Record<string, unknown>,
    signal: AbortSignal,
  ) => {
    const number = positive(item.number);
    const feedback: unknown[] = [];
    const dependencies: unknown[] = [];
    if (source.includeReviewFeedback) {
      const comments = await githubPages(
        `${base}/issues/${number}/comments`,
        signal,
      );
      feedback.push(
        ...comments.map((c) => ({
          kind: "comment",
          id: positive(c.id),
          body: text(c.body),
          updatedAt: timestamp(c.updated_at),
        })),
      );
      if (item.pull_request) {
        const reviews = await githubPages(
          `${base}/pulls/${number}/reviews`,
          signal,
        );
        const inline = await githubPages(
          `${base}/pulls/${number}/comments`,
          signal,
        );
        feedback.push(
          ...reviews.map((c) => ({
            kind: "review",
            id: positive(c.id),
            state: text(c.state, 100),
            body: text(c.body),
            updatedAt: c.submitted_at ? timestamp(c.submitted_at) : "",
          })),
          ...inline.map((c) => ({
            kind: "inline",
            id: positive(c.id),
            body: text(c.body),
            updatedAt: timestamp(c.updated_at),
          })),
        );
      }
    }
    if (source.includeDependencies) {
      const blocked = await githubPages(
        `${base}/issues/${number}/dependencies/blocked_by`,
        signal,
      );
      dependencies.push(
        ...blocked.map((d) => {
          const id = positive(d.number),
            url = safeUrl(d.html_url);
          if (
            !new RegExp(
              `^https://github\\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/(issues|pull)/${id}$`,
            ).test(url)
          )
            throw new OrchestrationDiscoveryError("invalid");
          return {
            id,
            url,
            state: text(d.state, 100),
            updatedAt: timestamp(d.updated_at),
          };
        }),
      );
    }
    const url = safeUrl(item.html_url);
    if (
      hub.kind !== "github" ||
      url.toLowerCase() !==
        `https://github.com/${hub.repository}/${item.pull_request ? "pull" : "issues"}/${number}`.toLowerCase()
    )
      throw new OrchestrationDiscoveryError("invalid");
    const snapshot = {
      sourceId: source.id,
      projectId: source.projectId,
      id: String(number),
      url,
      kind: item.pull_request ? ("pull-request" as const) : ("issue" as const),
      title: text(item.title, 2_000),
      body: text(item.body),
      updatedAt: timestamp(item.updated_at),
      feedback: stableEvidence(feedback),
      dependencies: stableEvidence(dependencies),
      labels: rows(item.labels ?? [])
        .map((label) => text(label.name, 200))
        .sort(),
    };
    return { ...snapshot, revision: digest(JSON.stringify(snapshot)) };
  };
  const quote = (v: string) => `'${v.replaceAll("'", "''")}'`;
  const adoSelector = `(${[
    ...(assignment === undefined
      ? []
      : [`[System.AssignedTo] = ${quote(assignment)}`]),
    ...(optIn === undefined ? [] : [`[System.Tags] CONTAINS ${quote(optIn)}`]),
  ].join(
    " OR ",
  )})${source.workItemTypes ? ` AND [System.WorkItemType] IN (${source.workItemTypes.map(quote).join(", ")})` : ""}`;
  type AdoScope = {
    clauses: string[];
    team?: {
      id: string;
      identity: string;
      areas: { value: string; includeChildren: boolean }[];
    };
    query?: { identity: string; items: Set<number> };
  };
  const resolveAdoScope = async (signal: AbortSignal): Promise<AdoScope> => {
    const resolved: AdoScope = { clauses: [] };
    if (hub.kind !== "ado") return resolved;
    if (selectedScope.iteration !== undefined)
      resolved.clauses.push(
        `[System.IterationPath] = ${quote(selectedScope.iteration)}`,
      );
    if (selectedScope.team === undefined && selectedScope.query === undefined)
      return resolved;
    const repository = obj(
      await request(
        `${base}/_apis/git/repositories/${encodeURIComponent(hub.repository)}?api-version=7.1`,
        signal,
      ),
    );
    const project = obj(repository.project);
    if (
      ![repository.name, repository.id].some(
        (value) =>
          typeof value === "string" &&
          value.toLowerCase() === hub.repository.toLowerCase(),
      ) ||
      text(project.name, 200) !== hub.project ||
      !queryId.test(text(project.id, 200))
    )
      throw new OrchestrationDiscoveryError("invalid");
    const projectNames = [text(project.name, 200), text(project.id, 200)];
    const matchesUrl = (value: unknown, paths: string[]) => {
      const url = new URL(safeUrl(value));
      return (
        url.origin === "https://dev.azure.com" &&
        paths.some((path) => url.pathname.toLowerCase() === path.toLowerCase())
      );
    };
    if (selectedScope.team !== undefined) {
      const team = obj(
        await request(
          `https://dev.azure.com/${hub.organization}/_apis/projects/${encodeURIComponent(hub.project)}/teams/${encodeURIComponent(selectedScope.team)}?api-version=7.1`,
          signal,
        ),
      );
      const teamId = text(team.id, 200),
        teamName = text(team.name, 200);
      const identity = [teamId, teamName].find(
        (value) => value === selectedScope.team,
      );
      if (
        !identity ||
        !queryId.test(teamId) ||
        !matchesUrl(
          team.url,
          projectNames.map(
            (name) =>
              `/${hub.organization}/_apis/projects/${encodeURIComponent(name)}/teams/${teamId}`,
          ),
        )
      )
        throw new OrchestrationDiscoveryError("scope");
      const settings = obj(
        await request(
          `${base}/${encodeURIComponent(teamId)}/_apis/work/teamsettings/teamfieldvalues?api-version=7.1`,
          signal,
        ),
      );
      if (
        obj(settings.field).referenceName !== "System.AreaPath" ||
        !matchesUrl(
          settings.url,
          projectNames.map(
            (name) =>
              `/${hub.organization}/${encodeURIComponent(name)}/${teamId}/_apis/work/teamsettings/teamfieldvalues`,
          ),
        )
      )
        throw new OrchestrationDiscoveryError("scope");
      const areas = z
        .array(
          z.object({
            value: z.string().min(1).max(2_000),
            includeChildren: z.boolean(),
          }),
        )
        .min(1)
        .max(100)
        .parse(settings.values);
      if (
        areas.some(
          (area) =>
            area.value !== hub.project &&
            !area.value.startsWith(`${hub.project}\\`),
        )
      )
        throw new OrchestrationDiscoveryError("scope");
      resolved.team = { id: teamId, identity, areas };
      resolved.clauses.push(
        `(${areas
          .map(
            (area) =>
              `[System.AreaPath] ${area.includeChildren ? "UNDER" : "="} ${quote(area.value)}`,
          )
          .join(" OR ")})`,
      );
    }
    if (selectedScope.query !== undefined) {
      const query = obj(
        await request(
          `${base}/_apis/wit/queries/${selectedScope.query}?$expand=clauses&api-version=7.1`,
          signal,
        ),
      );
      const identity = text(query.id, 200);
      if (
        identity !== selectedScope.query ||
        query.queryType !== "flat" ||
        query.isDeleted === true ||
        query.isFolder === true ||
        !matchesUrl(
          query.url,
          projectNames.map(
            (name) =>
              `/${hub.organization}/${encodeURIComponent(name)}/_apis/wit/queries/${identity}`,
          ),
        )
      )
        throw new OrchestrationDiscoveryError("scope");
      const limit = Math.min(1_000, source.maxPages * 100);
      const result = obj(
        await request(
          `${base}${resolved.team ? `/${encodeURIComponent(resolved.team.id)}` : ""}/_apis/wit/wiql/${identity}?$top=${limit + 1}&api-version=7.1`,
          signal,
        ),
      );
      if (result.queryType !== "flat")
        throw new OrchestrationDiscoveryError("unsupported");
      const items = z
        .array(record)
        .max(limit + 1)
        .parse(result.workItems);
      if (items.length > limit)
        throw new OrchestrationDiscoveryError("incomplete");
      const ids = new Set(items.map((item) => positive(item.id)));
      resolved.query = { identity, items: ids };
      resolved.clauses.push(
        ids.size ? `[System.Id] IN (${[...ids].join(",")})` : "[System.Id] = 0",
      );
    }
    return resolved;
  };
  const verifyAdoProject = async (
    id: number,
    signal: AbortSignal,
    clauses: string[] = [],
  ) => {
    if (hub.kind !== "ado") throw new OrchestrationDiscoveryError("invalid");
    const result = obj(
      await request(`${base}/_apis/wit/wiql?$top=1&api-version=7.1`, signal, {
        query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = ${quote(hub.project)} AND [System.Id] = ${id}${clauses.map((clause) => ` AND ${clause}`).join("")}`,
      }),
    );
    const matches = rows(result.workItems);
    if (matches.length !== 1 || matches[0]!.id !== id)
      throw new OrchestrationDiscoveryError("access");
  };
  const observeAdo = async (
    id: number,
    signal: AbortSignal,
    scoped: AdoScope,
  ) => {
    if (scoped.query && !scoped.query.items.has(id))
      throw new OrchestrationDiscoveryError("scope");
    await verifyAdoProject(id, signal, [...scoped.clauses, adoSelector]);
    const item = obj(
      await request(
        `${base}/_apis/wit/workitems/${id}?$expand=relations&api-version=7.1`,
        signal,
      ),
    );
    const fields = obj(item.fields);
    const assigned = fields["System.AssignedTo"];
    const actual =
      typeof assigned === "string"
        ? [assigned]
        : assigned
          ? [obj(assigned).uniqueName, obj(assigned).id]
          : [];
    if (
      !eligible(
        actual,
        text(fields["System.Tags"])
          .split(";")
          .map((value) => value.trim()),
      )
    )
      throw new OrchestrationDiscoveryError("access");
    if (
      source.workItemTypes &&
      !source.workItemTypes.includes(text(fields["System.WorkItemType"], 200))
    )
      throw new OrchestrationDiscoveryError("scope");
    if (
      hub.kind !== "ado" ||
      item.id !== id ||
      text(fields["System.TeamProject"], 200).toLowerCase() !==
        hub.project.toLowerCase()
    )
      throw new OrchestrationDiscoveryError("invalid");
    const scope: OrchestrationDiscoveryScopeFacts = {};
    if (selectedScope.iteration !== undefined) {
      const iteration = text(fields["System.IterationPath"], 200);
      if (iteration !== selectedScope.iteration)
        throw new OrchestrationDiscoveryError("scope");
      scope.iteration = iteration;
    }
    if (scoped.team) {
      const area = text(fields["System.AreaPath"], 2_000);
      if (
        !scoped.team.areas.some(
          (value) =>
            area === value.value ||
            (value.includeChildren && area.startsWith(`${value.value}\\`)),
        )
      )
        throw new OrchestrationDiscoveryError("scope");
      scope.team = scoped.team.identity;
    }
    if (scoped.query) scope.query = scoped.query.identity;
    const relations = rows(item.relations ?? []);
    const dependencies: unknown[] = [];
    const feedback: unknown[] = [];
    if (source.includeDependencies) {
      const links = relations.filter((r) =>
        text(r.rel, 200).startsWith("System.LinkTypes.Dependency"),
      );
      if (links.length > 100)
        throw new OrchestrationDiscoveryError("incomplete");
      for (const relation of links) {
        const url = new URL(safeUrl(relation.url));
        if (
          hub.kind !== "ado" ||
          url.hostname !== "dev.azure.com" ||
          !url.pathname.startsWith(`/${hub.organization}/`) ||
          !/\/_apis\/wit\/workItems\/\d+$/i.test(url.pathname)
        )
          throw new OrchestrationDiscoveryError("invalid");
        const dependencyId = positive(
          Number(/\/(\d+)$/.exec(url.pathname)?.[1]),
        );
        await verifyAdoProject(dependencyId, signal);
        const related = obj(
          await request(
            `${base}/_apis/wit/workitems/${dependencyId}?api-version=7.1`,
            signal,
          ),
        );
        const f = obj(related.fields);
        if (
          related.id !== dependencyId ||
          text(f["System.TeamProject"], 200).toLowerCase() !==
            hub.project.toLowerCase()
        )
          throw new OrchestrationDiscoveryError("invalid");
        dependencies.push({
          id: positive(related.id),
          relation: text(relation.rel, 200),
          revision: positive(related.rev),
          state: text(f["System.State"], 200),
        });
      }
    }
    if (source.includeReviewFeedback) {
      let continuation = "";
      for (let page = 1; page <= source.maxPages; page++) {
        const comments = obj(
          await request(
            `${base}/_apis/wit/workItems/${id}/comments?$top=100&api-version=7.1-preview.4${continuation ? `&continuationToken=${encodeURIComponent(continuation)}` : ""}`,
            signal,
          ),
        );
        feedback.push(
          ...rows(comments.comments ?? []).map((c) => ({
            kind: "comment",
            id: positive(c.id),
            body: text(c.text),
            updatedAt: c.modifiedDate ? timestamp(c.modifiedDate) : "",
          })),
        );
        continuation =
          comments.continuationToken === undefined
            ? ""
            : text(String(comments.continuationToken), 2_000);
        if (!continuation) break;
        if (page === source.maxPages)
          throw new OrchestrationDiscoveryError("incomplete");
      }
      for (const relation of relations.filter(
        (r) => r.rel === "ArtifactLink",
      )) {
        const link = text(relation.url, 2_000);
        if (!link.startsWith("vstfs:///Git/PullRequestId/")) continue;
        const pieces = decodeURIComponent(
          link.slice("vstfs:///Git/PullRequestId/".length),
        ).split("/");
        if (pieces.length !== 3 || !/^\d+$/.test(pieces[2]!))
          throw new OrchestrationDiscoveryError("invalid");
        const repository = encodeURIComponent(hub.repository);
        const pr = pieces[2]!;
        // Resolve against the configured repository; never follow arbitrary relation URLs.
        const prBase = `${base}/_apis/git/repositories/${repository}/pullRequests/${pr}`;
        const detail = obj(await request(`${prBase}?api-version=7.1`, signal));
        const repositoryDetail = obj(detail.repository),
          projectDetail = obj(repositoryDetail.project);
        if (
          text(repositoryDetail.id, 200).toLowerCase() !==
            pieces[1]!.toLowerCase() ||
          text(projectDetail.id, 200).toLowerCase() !==
            pieces[0]!.toLowerCase() ||
          ![projectDetail.name, projectDetail.id].some(
            (value) =>
              typeof value === "string" &&
              value.toLowerCase() === hub.project.toLowerCase(),
          )
        )
          throw new OrchestrationDiscoveryError("invalid");
        const threads = obj(
          await request(`${prBase}/threads?api-version=7.1`, signal),
        );
        for (const thread of rows(threads.value))
          feedback.push({
            kind: "review-thread",
            pullRequest: pr,
            id: positive(thread.id),
            status: text(thread.status, 100),
            comments: stableEvidence(
              rows(thread.comments ?? []).map((c) => ({
                id: positive(c.id),
                body: text(c.content),
                updatedAt: c.lastUpdatedDate
                  ? timestamp(c.lastUpdatedDate)
                  : "",
              })),
            ),
          });
      }
    }
    const snapshot = {
      sourceId: source.id,
      projectId: source.projectId,
      id: String(id),
      url: `${base}/_workitems/edit/${id}`,
      kind: "work-item" as const,
      title: text(fields["System.Title"], 2_000),
      body: text(fields["System.Description"]),
      updatedAt: timestamp(fields["System.ChangedDate"]),
      itemRevision: positive(item.rev),
      feedback: stableEvidence(feedback),
      dependencies: stableEvidence(dependencies),
      labels: text(fields["System.Tags"])
        .split(";")
        .map((label) => label.trim())
        .filter(Boolean)
        .sort(),
      ...(Object.keys(scope).length ? { scope } : {}),
    };
    return { ...snapshot, revision: digest(JSON.stringify(snapshot)) };
  };
  return {
    source,
    async refresh(item: OrchestrationDiscoveredItem, signal: AbortSignal) {
      if (
        item.sourceId !== source.id ||
        item.projectId !== source.projectId ||
        !/^[1-9]\d*$/.test(item.id)
      )
        throw new OrchestrationDiscoveryError("invalid");
      if (hub.kind === "ado")
        return observeAdo(
          positive(Number(item.id)),
          signal,
          await resolveAdoScope(signal),
        );
      const value = obj(await request(`${base}/issues/${item.id}`, signal));
      if (positive(value.number) !== positive(Number(item.id)))
        throw new OrchestrationDiscoveryError("invalid");
      if (!githubEligible(value) || value.state !== "open")
        throw new OrchestrationDiscoveryError("access");
      return observeGithub(value, signal);
    },
    async preflight(signal: AbortSignal) {
      const value = obj(
        await request(
          hub.kind === "github"
            ? base
            : `${base}/_apis/git/repositories/${encodeURIComponent(hub.repository)}?api-version=7.1`,
          signal,
        ),
      );
      if (
        hub.kind === "github" &&
        text(value.full_name, 500).toLowerCase() !==
          hub.repository.toLowerCase()
      )
        throw new OrchestrationDiscoveryError("invalid");
      if (hub.kind === "ado") {
        const project = obj(value.project);
        if (
          ![value.name, value.id].some(
            (v) =>
              typeof v === "string" &&
              v.toLowerCase() === hub.repository.toLowerCase(),
          ) ||
          ![project.name, project.id].some(
            (v) =>
              typeof v === "string" &&
              v.toLowerCase() === hub.project.toLowerCase(),
          )
        )
          throw new OrchestrationDiscoveryError("invalid");
      }
      return {
        readable: true as const,
        sourceId: source.id,
        authority: "read-only" as const,
      };
    },
    async poll(
      previous: OrchestrationDiscoveryCursor | null,
      signal: AbortSignal,
    ): Promise<{
      items: OrchestrationDiscoveredItem[];
      cursor: OrchestrationDiscoveryCursor;
    }> {
      const cursor = cursorSchema.parse(
        previous ?? { page: 1, afterId: 0, cycle: 0 },
      );
      if (hub.kind === "github") {
        const filters = [
          ...(assignment === undefined
            ? []
            : [
                {
                  query: `assignee=${encodeURIComponent(assignment)}`,
                  matches: (item: Record<string, unknown>) =>
                    rows(item.assignees ?? []).some(
                      (value) =>
                        typeof value.login === "string" &&
                        value.login.toLowerCase() === assignment.toLowerCase(),
                    ),
                },
              ]),
          ...(optIn === undefined
            ? []
            : [
                {
                  query: `labels=${encodeURIComponent(optIn)}`,
                  matches: (item: Record<string, unknown>) =>
                    rows(item.labels ?? []).some(
                      (value) => value.name === optIn,
                    ),
                },
              ]),
        ];
        const batch = new Map<number, Record<string, unknown>>();
        let more = false;
        for (const filter of filters) {
          const page = rows(
            await request(
              `${base}/issues?state=open&sort=created&direction=asc&${filter.query}&per_page=${source.pageSize}&page=${cursor.page}`,
              signal,
            ),
          );
          if (page.length > source.pageSize)
            throw new OrchestrationDiscoveryError("invalid");
          more ||= page.length === source.pageSize;
          for (const item of page) {
            if (!filter.matches(item) || item.state !== "open")
              throw new OrchestrationDiscoveryError("invalid");
            const number = positive(item.number);
            const previous = batch.get(number);
            // A concurrent reassignment/tag edit between the two native reads needs a fresh pass.
            if (previous && JSON.stringify(previous) !== JSON.stringify(item))
              throw new OrchestrationDiscoveryError("incomplete");
            batch.set(number, item);
          }
        }
        const items: OrchestrationDiscoveredItem[] = [];
        for (const item of batch.values()) {
          if (!githubEligible(item) || item.state !== "open")
            throw new OrchestrationDiscoveryError("invalid");
          items.push(await observeGithub(item, signal));
        }
        return {
          items,
          cursor: more
            ? { ...cursor, page: cursor.page + 1 }
            : { page: 1, afterId: 0, cycle: cursor.cycle + 1 },
        };
      }
      const scoped = await resolveAdoScope(signal);
      const result = obj(
        await request(
          `${base}/_apis/wit/wiql?$top=${source.pageSize}&api-version=7.1`,
          signal,
          {
            query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = ${quote(hub.project)} AND ${adoSelector}${scoped.clauses.map((clause) => ` AND ${clause}`).join("")} AND [System.Id] > ${cursor.afterId} ORDER BY [System.Id] ASC`,
          },
        ),
      );
      const batch = rows(result.workItems);
      if (batch.length > source.pageSize)
        throw new OrchestrationDiscoveryError("invalid");
      const items: OrchestrationDiscoveredItem[] = [];
      let afterId = cursor.afterId;
      for (const item of batch) {
        const id = positive(item.id);
        if (id <= afterId) throw new OrchestrationDiscoveryError("invalid");
        const observed = await observeAdo(id, signal, scoped);
        items.push(observed);
        afterId = id;
      }
      return {
        items,
        cursor:
          batch.length === source.pageSize
            ? { ...cursor, afterId }
            : { page: 1, afterId: 0, cycle: cursor.cycle + 1 },
      };
    },
  };
}
