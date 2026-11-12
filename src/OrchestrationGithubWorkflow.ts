import { execFile } from "node:child_process";
import {
  createGithubAccountEnvironment,
  type GithubAccountAuthentication,
} from "./OrchestrationGithubAccount.js";
import { z } from "zod";
import { digest } from "./MultiProjectProtocol.js";
import type {
  WorkspaceConfiguration,
  WorkspaceDiscoverySource,
} from "./OrchestrationWorkspaceContract.js";
import type {
  OrchestrationIntakeStore,
  OrchestrationProposal,
} from "./OrchestrationProposal.js";
import {
  createOrchestrationProposalQueue,
  priorProposalExecutionHold,
} from "./OrchestrationProposal.js";
import {
  createOrchestrationDiscoveryAdapter,
  type OrchestrationDiscoveryTransport,
} from "./OrchestrationDiscovery.js";
import {
  githubWorkflowAdmissionKey,
  orchestrationWorkflowLabels,
  retainedGithubWorkflowAdmission,
} from "./OrchestrationWorkflowContract.js";
import { evaluateOrchestrationFocus } from "./OrchestrationFocus.js";

export type GithubWorkflowTransport = (
  endpoint: string,
  method: "GET" | "POST" | "DELETE",
  body: unknown,
  signal: AbortSignal,
  authentication?: GithubAccountAuthentication,
) => Promise<unknown>;
export const githubWorkflowTransport: GithubWorkflowTransport = async (
  endpoint,
  method,
  body,
  signal,
  authentication,
) => {
  const env = authentication
    ? await createGithubAccountEnvironment(authentication)(signal)
    : undefined;
  return new Promise((resolve, reject) => {
    const child = execFile(
      "gh",
      [
        "api",
        endpoint,
        "--method",
        method,
        ...(body === undefined ? [] : ["--input", "-"]),
      ],
      { env, signal, timeout: 30000, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const status = /HTTP (403|404|429)\b/.exec(stderr)?.[1];
          reject(
            new Error(
              `GitHub workflow ${method} failed${status ? ` (${status})` : ""}; outcome may be unknown`,
            ),
          );
        } else {
          try {
            resolve(stdout.trim() ? JSON.parse(stdout) : null);
          } catch {
            reject(new Error("Invalid GitHub workflow response"));
          }
        }
      },
    );
    if (body !== undefined) child.stdin?.end(JSON.stringify(body));
  });
};
export const githubWorkflowKey = (
  namespace: string,
  sourceId: string,
  itemId: string,
) => `hub-workflow/${digest([namespace, sourceId, itemId])}`;
const actor = z.object({ login: z.string() });
const eventSchema = z.object({
  id: z.number().int().positive(),
  event: z.string(),
  actor,
  created_at: z.string().datetime({ offset: true }),
  label: z.object({ name: z.string() }).optional(),
});
const commentSchema = z.object({
  id: z.number().int().positive(),
  body: z.string(),
  user: actor,
  created_at: z.string().datetime({ offset: true }),
});
const approvalCommentSchema = commentSchema.extend({
  updated_at: z.string().datetime({ offset: true }),
});
export const githubPlanPublicationSchema = z.object({
  proposalId: z.string(),
  proposalDigest: z.string(),
  sourceRevision: z.string(),
  configurationRevision: z.number(),
  commentId: z.number(),
  publishedAt: z.string(),
  eventFloor: z.number(),
  bodyDigest: z.string(),
  approver: z.string(),
});
const publicationMatches = (
  p: z.infer<typeof githubPlanPublicationSchema>,
  proposal: OrchestrationProposal,
  publishedBody: string,
) =>
  p.proposalId === proposal.id &&
  p.proposalDigest === proposal.digest &&
  p.sourceRevision === proposal.sourceRevision &&
  p.configurationRevision === proposal.configurationRevision &&
  proposal.digest ===
    digest(
      JSON.stringify({
        id: proposal.id,
        sourceRevision: proposal.sourceRevision,
        configurationRevision: proposal.configurationRevision,
        artifacts: proposal.artifacts,
      }),
    ) &&
  digest(publishedBody) === p.bodyDigest;

const commentApprovalProofSchema = z.object({
  kind: z.literal("comment"),
  approvalCommentId: z.number().int().positive(),
  approvalBodyDigest: z.string(),
  actor: z.string(),
  at: z.string(),
  publication: githubPlanPublicationSchema,
});
class GithubWorkflowWriteAuthorityError extends Error {}

export function attributedWorkflowCommentApproval(input: {
  publication: z.infer<typeof githubPlanPublicationSchema>;
  proposal: OrchestrationProposal;
  comments: unknown[];
  publishedBody: string;
}) {
  const { publication: p } = input;
  if (!publicationMatches(p, input.proposal, input.publishedBody)) return null;
  const match = input.comments
    .map((row) => approvalCommentSchema.safeParse(row))
    .filter((row) => row.success)
    .map((row) => row.data)
    .filter(
      (row) =>
        /^plan approved$/i.test(row.body.trim()) &&
        row.user.login.toLowerCase() === p.approver.toLowerCase() &&
        row.id > p.commentId &&
        Date.parse(row.created_at) > Date.parse(p.publishedAt) &&
        Date.parse(row.updated_at) === Date.parse(row.created_at),
    )
    .sort((a, b) => a.id - b.id)[0];
  return match
    ? {
        kind: "comment" as const,
        approvalCommentId: match.id,
        approvalBodyDigest: digest(match.body),
        actor: match.user.login,
        at: match.created_at,
      }
    : null;
}
export function attributedWorkflowApproval(input: {
  publication: z.infer<typeof githubPlanPublicationSchema>;
  proposal: OrchestrationProposal;
  events: unknown[];
  labels: string[];
  publishedBody: string;
}) {
  const { publication: p, proposal } = input;
  if (
    !publicationMatches(p, proposal, input.publishedBody) ||
    !input.labels.includes("orchestration-implementation-ready")
  )
    return null;
  const latest = input.events
    .map((event) => eventSchema.parse(event))
    .filter(
      (e) =>
        ["labeled", "unlabeled"].includes(e.event) &&
        e.label?.name === "orchestration-implementation-ready",
    )
    .sort((a, b) => b.id - a.id)[0];
  return latest &&
    latest.event === "labeled" &&
    latest.id > p.eventFloor &&
    Date.parse(latest.created_at) > Date.parse(p.publishedAt) &&
    latest.actor.login.toLowerCase() === p.approver.toLowerCase()
    ? {
        actor: latest.actor.login,
        eventId: latest.id,
        at: latest.created_at,
        commentId: p.commentId,
        bodyDigest: p.bodyDigest,
      }
    : null;
}

/** Host-only, narrowly enumerated issue effects; never accepts commands from hub content. */
export function createGithubWorkflow(options: {
  configuration: WorkspaceConfiguration;
  store: OrchestrationIntakeStore;
  transport?: GithubWorkflowTransport;
  discoveryTransport?: (
    source: WorkspaceDiscoverySource,
  ) => OrchestrationDiscoveryTransport | undefined;
}) {
  const { configuration: config, store } = options;
  const selectedTransport = options.transport ?? githubWorkflowTransport;
  const transport: GithubWorkflowTransport = (
    endpoint,
    method,
    body,
    signal,
    authentication,
  ) => {
    const repository = /^\/?repos\/([^/]+\/[^/?]+)(?:\/|\?|$)/.exec(
      endpoint,
    )?.[1];
    const source = repository
      ? config.discovery.find(
          (source) =>
            source.hub.kind === "github" &&
            source.hub.repository.toLowerCase() === repository.toLowerCase(),
        )
      : undefined;
    const binding =
      authentication ??
      (source?.authentication?.kind === "github-cli"
        ? source.authentication
        : undefined);
    return binding
      ? selectedTransport(endpoint, method, body, signal, binding)
      : selectedTransport(endpoint, method, body, signal);
  };
  const queue = createOrchestrationProposalQueue({
    store,
    namespace: config.id,
  });
  const write = (key: string, value: unknown, kind: string) => {
    if (
      !store.compareAndSwap(key, store.read(key).version, value, {
        kind,
        at: new Date().toISOString(),
      })
    )
      throw new Error("GitHub workflow journal fence changed");
  };
  const sourceFor = (proposal: OrchestrationProposal) => {
    const source = config.discovery.find(
      (s) => s.id === proposal.source.sourceId,
    );
    if (
      !source?.workflow ||
      source.hub.kind !== "github" ||
      proposal.source.kind !== "issue" ||
      proposal.configurationRevision !== config.revision ||
      !/^[1-9][0-9]*$/.test(proposal.source.id)
    )
      throw new Error("Current registered GitHub issue workflow required");
    return {
      source,
      repository: source.hub.repository,
      approver: source.workflow.approver,
      endpoint: `repos/${source.hub.repository}/issues/${proposal.source.id}`,
    };
  };
  const currentSource = async (
    proposal: OrchestrationProposal,
    signal: AbortSignal,
  ) => {
    const { source } = sourceFor(proposal);
    const fresh = await createOrchestrationDiscoveryAdapter(
      source,
      options.discoveryTransport?.(source),
      config.focus,
      retainedGithubWorkflowAdmission(config, store),
    ).refresh(proposal.source, signal);
    if (
      fresh.revision !== proposal.sourceRevision ||
      priorProposalExecutionHold(
        proposal,
        queue.list().map((entry) => entry.proposal),
      )
    )
      throw new Error(
        "Source changed or prior execution remains unresolved; workflow effect blocked",
      );
    return fresh;
  };
  const current = async (
    proposal: OrchestrationProposal,
    signal: AbortSignal,
  ) => {
    const { repository, source } = sourceFor(proposal);
    const fresh = await currentSource(proposal, signal);
    if (
      config.focus.mode !== "execute" ||
      !evaluateOrchestrationFocus(config.focus, {
        projectId: fresh.projectId,
        action: "publish-item",
        ...("scope" in fresh ? fresh.scope : {}),
      }).allowed
    )
      throw new GithubWorkflowWriteAuthorityError(
        "GitHub workflow requires configured issue write authority: execute mode and an exact publish-item grant in the configured focus; no provider write attempted",
      );
    const permissions = z
      .object({
        permissions: z.object({
          push: z.boolean().optional(),
          triage: z.boolean().optional(),
        }),
      })
      .parse(
        await transport(`repos/${repository}`, "GET", undefined, signal),
      ).permissions;
    if (!permissions.push && !permissions.triage)
      throw new Error(
        "GitHub workflow requires repository issue/label write permission",
      );
    const identity = actor.parse(
      await transport(
        "user",
        "GET",
        undefined,
        signal,
        source.authentication?.kind === "github-cli"
          ? source.authentication
          : undefined,
      ),
    ).login;
    if (
      source.authentication?.kind === "github-cli" &&
      identity.toLowerCase() !== source.authentication.account.toLowerCase()
    )
      throw new Error(
        "Configured GitHub workflow account identity mismatch; no write attempted",
      );
    return { fresh, identity };
  };
  const pages = async (endpoint: string, signal: AbortSignal) => {
    const values: unknown[] = [];
    for (let page = 1; page <= 5; page++) {
      const rows = z
        .array(z.unknown())
        .parse(
          await transport(
            `${endpoint}?per_page=100&page=${page}`,
            "GET",
            undefined,
            signal,
          ),
        );
      values.push(...rows);
      if (rows.length < 100) return values;
    }
    throw new Error(
      "GitHub workflow evidence pagination limit; cannot infer approval/outcome",
    );
  };
  const effectKey = (proposal: OrchestrationProposal, id: string) =>
    `hub-workflow-effect/${digest([config.id, proposal.source.sourceId, proposal.source.id, id])}`;
  const effect = async (
    proposal: OrchestrationProposal,
    id: string,
    inspect: () => Promise<boolean>,
    mutate: () => Promise<unknown>,
    signal: AbortSignal,
  ) => {
    const key = effectKey(proposal, id);
    if (await inspect()) {
      if (digest(store.read(key).value) !== digest({ state: "confirmed", id }))
        write(
          key,
          { state: "confirmed", id },
          "github-workflow-effect-confirmed",
        );
      return;
    }
    const existing = store.read(key);
    if (existing.value !== null)
      throw new Error(
        "GitHub workflow effect uncertain or changed; no blind retry",
      );
    await current(proposal, signal);
    if (
      !store.compareAndSwap(
        key,
        existing.version,
        { state: "reserved", id },
        {
          kind: "github-workflow-effect-reserved",
          at: new Date().toISOString(),
        },
      )
    )
      throw new Error("GitHub workflow effect reservation changed");
    await mutate();
    if (!(await inspect()))
      throw new Error("GitHub workflow effect not confirmed");
    write(key, { state: "confirmed", id }, "github-workflow-effect-confirmed");
  };
  const state = (
    proposal: OrchestrationProposal,
    patch: Record<string, unknown>,
  ) => {
    const key = githubWorkflowKey(
      config.id,
      proposal.source.sourceId,
      proposal.source.id,
    );
    const existing = store.read(key).value;
    write(
      key,
      {
        ...(existing && typeof existing === "object" ? existing : {}),
        proposalId: proposal.id,
        configurationRevision: config.revision,
        sourceRevision: proposal.sourceRevision,
        ...patch,
      },
      "github-workflow-state",
    );
  };
  const labels = async (endpoint: string, signal: AbortSignal) =>
    z
      .array(z.object({ name: z.string() }))
      .parse(await transport(`${endpoint}/labels`, "GET", undefined, signal))
      .map((label) => label.name);
  const stage = async (
    proposal: OrchestrationProposal,
    next: string,
    cycle: string,
    signal: AbortSignal,
    attributedApproval?: "label" | "comment",
  ) => {
    if (
      !orchestrationWorkflowLabels.includes(next) ||
      next === "orchestration-ready" ||
      (next === "orchestration-implementation-ready" && !attributedApproval) ||
      next === "orchestration-finished"
    )
      throw new Error("Host cannot fabricate user approval or finished proof");
    const { source, repository, endpoint } = sourceFor(proposal);
    await current(proposal, signal);
    state(proposal, {
      sync: "blocked",
      diagnostic:
        "Stage transition is in progress or uncertain; exclusive remote stage confirmation is required.",
    });
    const names = z
      .array(z.object({ name: z.string() }))
      .parse(
        await transport(
          `repos/${repository}/labels?per_page=100`,
          "GET",
          undefined,
          signal,
        ),
      )
      .map((label) => label.name);
    for (const name of orchestrationWorkflowLabels.filter(
      (name) => !names.includes(name),
    )) {
      await effect(
        proposal,
        `create-label:${name}`,
        async () => {
          const all = await pages(`repos/${repository}/labels`, signal);
          return all.some(
            (label) =>
              z.object({ name: z.string() }).parse(label).name === name,
          );
        },
        () =>
          transport(
            `repos/${repository}/labels`,
            "POST",
            {
              name,
              color: name.includes("approval") ? "d4a72c" : "0969da",
              description: `Orchestration workflow: ${name.replace("orchestration-", "")}`,
            },
            signal,
          ),
        signal,
      );
    }
    if (
      next === "orchestration-implementation-ready" &&
      attributedApproval === "label"
    ) {
      if (!(await labels(endpoint, signal)).includes(next))
        throw new Error("Attributed user approval label is no longer present");
    } else {
      await effect(
        proposal,
        `${proposal.id}:${cycle}:add:${next}`,
        async () => (await labels(endpoint, signal)).includes(next),
        () =>
          transport(`${endpoint}/labels`, "POST", { labels: [next] }, signal),
        signal,
      );
    }
    const previous = await labels(endpoint, signal);
    for (const old of orchestrationWorkflowLabels.filter(
      (name) =>
        name !== next &&
        (previous.includes(name) ||
          store.read(
            effectKey(proposal, `${proposal.id}:${cycle}:remove:${name}`),
          ).value !== null),
    )) {
      if (old === "orchestration-ready" && previous.includes(old)) {
        await current(proposal, signal);
        write(
          githubWorkflowAdmissionKey(config, source, proposal.source.id),
          { admitted: true },
          "github-workflow-admitted-continuity",
        );
      }
      await effect(
        proposal,
        `${proposal.id}:${cycle}:remove:${old}`,
        async () => !(await labels(endpoint, signal)).includes(old),
        () =>
          transport(
            `${endpoint}/labels/${encodeURIComponent(old)}`,
            "DELETE",
            undefined,
            signal,
          ),
        signal,
      );
    }
    const actual = (await labels(endpoint, signal)).filter((name) =>
      orchestrationWorkflowLabels.includes(name),
    );
    if (actual.length !== 1 || actual[0] !== next)
      throw new Error("GitHub workflow stage changed before confirmation");
    state(proposal, { stage: next, sync: "confirmed", diagnostic: "" });
  };
  const comment = async (
    proposal: OrchestrationProposal,
    id: string,
    body: string,
    signal: AbortSignal,
  ) => {
    const { endpoint } = sourceFor(proposal);
    if (
      body.length > 58000 ||
      /(?:gh[pousr]_[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9._-]{20,}|-----BEGIN .*PRIVATE KEY)/.test(
        body,
      )
    )
      throw new Error("Workflow comment exceeds safe publication boundaries");
    const marker = `<!-- sandcastle-workflow:${digest([config.id, proposal.id, id])} -->`;
    const text = `${body}\n\n${marker}`;
    const { identity } = await current(proposal, signal);
    const matches = async () =>
      (await pages(`${endpoint}/comments`, signal))
        .map((row) => commentSchema.parse(row))
        .filter(
          (row) =>
            row.user.login.toLowerCase() === identity.toLowerCase() &&
            row.body === text,
        );
    await effect(
      proposal,
      `comment:${id}:${digest(text)}`,
      async () => (await matches()).length === 1,
      () => transport(`${endpoint}/comments`, "POST", { body: text }, signal),
      signal,
    );
    const found = await matches();
    if (found.length !== 1)
      throw new Error("Ambiguous workflow publication evidence");
    return found[0]!;
  };
  return {
    enabled: (proposal: OrchestrationProposal) =>
      Boolean(
        config.discovery.find(
          (source) => source.id === proposal.source.sourceId,
        )?.workflow,
      ),
    async assertApproved(proposal: OrchestrationProposal, signal: AbortSignal) {
      const { endpoint } = sourceFor(proposal);
      await currentSource(proposal, signal);
      const key = `${githubWorkflowKey(config.id, proposal.source.sourceId, proposal.source.id)}/plan/${proposal.id}`;
      const proof = z
        .union([
          commentApprovalProofSchema,
          z.object({
            eventId: z.number(),
            actor: z.string(),
            publication: githubPlanPublicationSchema,
          }),
        ])
        .parse(store.read(`${key}/approval`).value);
      const published = commentSchema.parse(
        await transport(
          `${endpoint.split("/issues/")[0]}/issues/comments/${proof.publication.commentId}`,
          "GET",
          undefined,
          signal,
        ),
      );
      if (
        published.id !== proof.publication.commentId ||
        published.created_at !== proof.publication.publishedAt
      )
        throw new Error(
          "Published plan identity or creation timestamp changed",
        );
      let verifiedActor: string | undefined;
      if ("kind" in proof) {
        const approval = await transport(
          `${endpoint.split("/issues/")[0]}/issues/comments/${proof.approvalCommentId}`,
          "GET",
          undefined,
          signal,
        );
        const verified = attributedWorkflowCommentApproval({
          publication: proof.publication,
          proposal,
          publishedBody: published.body,
          comments: [approval],
        });
        if (
          verified?.approvalCommentId === proof.approvalCommentId &&
          verified.approvalBodyDigest === proof.approvalBodyDigest &&
          verified.at === proof.at
        )
          verifiedActor = verified.actor;
      } else {
        const approvalEvents = (await pages(`${endpoint}/events`, signal)).map(
          (row) => eventSchema.parse(row),
        );
        const latest = approvalEvents
          .filter(
            (event) =>
              ["labeled", "unlabeled"].includes(event.event) &&
              event.label?.name === "orchestration-implementation-ready",
          )
          .sort((a, b) => b.id - a.id)[0];
        const removalId = `${proposal.id}:initial-implementation:remove:orchestration-implementation-ready`;
        const removal = store.read(
          `hub-workflow-effect/${digest([
            config.id,
            proposal.source.sourceId,
            proposal.source.id,
            removalId,
          ])}`,
        ).value;
        const removedByHost =
          latest?.event === "unlabeled" &&
          latest.actor.login.toLowerCase() ===
            actor
              .parse(await transport("user", "GET", undefined, signal))
              .login.toLowerCase() &&
          digest(removal) === digest({ state: "confirmed", id: removalId });
        if (latest?.id !== proof.eventId && !removedByHost)
          throw new Error(
            "User approval was removed or replaced; dispatch is blocked",
          );
        const verified = attributedWorkflowApproval({
          publication: proof.publication,
          proposal,
          publishedBody: published.body,
          labels: ["orchestration-implementation-ready"],
          events: approvalEvents.filter((row) => row.id === proof.eventId),
        });
        verifiedActor = verified?.actor;
      }
      if (
        !verifiedActor ||
        verifiedActor !== proof.actor ||
        proposal.policyDecision ||
        !proposal.approval ||
        config.runtime.planningOverrides?.some(
          (rule) =>
            rule.sourceId === proposal.source.sourceId &&
            rule.itemId === proposal.source.id,
        )
      )
        throw new Error(
          "Exact attributed user approval is missing, changed or investigation-only",
        );
    },
    stage: (
      proposal: OrchestrationProposal,
      next: string,
      cycle: string,
      signal: AbortSignal,
    ) => stage(proposal, next, cycle, signal),
    syncFailure(proposal: OrchestrationProposal, error?: unknown) {
      const diagnostic =
        error instanceof GithubWorkflowWriteAuthorityError
          ? error.message
          : "GitHub stage/comment synchronization failed or is uncertain; inspect retained effect evidence. No approval or completion inferred.";
      state(proposal, {
        sync: "blocked",
        diagnostic,
      });
      return diagnostic;
    },
    async reconcilePublishedPlan(
      proposal: OrchestrationProposal,
      signal: AbortSignal,
    ) {
      if (
        config.focus.mode !== "execute" ||
        proposal.status !== "superseded" ||
        !proposal.artifacts ||
        !proposal.digest ||
        proposal.configurationRevision !== config.revision
      )
        return false;
      const { endpoint } = sourceFor(proposal);
      const key = `${githubWorkflowKey(config.id, proposal.source.sourceId, proposal.source.id)}/plan/${proposal.id}`;
      const stored = store.read(key).value;
      if (stored === null) return false;
      const publication = githubPlanPublicationSchema.parse(stored);
      const fresh = await currentSource(proposal, signal);
      if (
        !evaluateOrchestrationFocus(config.focus, {
          projectId: fresh.projectId,
          action: "discover",
          ...("scope" in fresh ? fresh.scope : {}),
        }).allowed
      )
        throw new Error(
          "Published plan restoration is outside current discovery scope",
        );
      const published = commentSchema.parse(
        await transport(
          `${endpoint.split("/issues/")[0]}/issues/comments/${publication.commentId}`,
          "GET",
          undefined,
          signal,
        ),
      );
      if (
        published.id !== publication.commentId ||
        published.created_at !== publication.publishedAt ||
        !publicationMatches(publication, proposal, published.body)
      )
        throw new Error(
          "Published plan restoration lacks exact unchanged remote publication evidence",
        );
      queue.restorePublishedWorkflowPlan({
        proposalId: proposal.id,
        configurationRevision: config.revision,
        item: fresh,
        publicationDigest: digest(publication),
      });
      state(proposal, {
        sync: "blocked",
        diagnostic:
          "Exact published plan restored after verified workflow-only revision migration; current attributed approval and configured write authority must still be checked",
      });
      return true;
    },
    async blocked(
      proposal: OrchestrationProposal,
      reason: string,
      signal: AbortSignal,
    ) {
      state(proposal, { sync: "blocked", diagnostic: reason });
      await comment(
        proposal,
        `blocked:${digest(reason)}`,
        `**Orchestration blocked:** ${reason}\n\nNo completion, publication, merge or deployment is claimed.`,
        signal,
      );
    },
    async reviewEvent(
      proposal: OrchestrationProposal,
      event: {
        stage: "reviewing" | "implementing" | "blocked";
        revision: string;
        attempt: number;
        findings: string[];
        reason?: string;
        validation?: {
          evaluatedScope: number;
          checks: { name: string; state: string }[];
        };
      },
      signal: AbortSignal,
    ) {
      state(proposal, { review: event });
      if (event.findings.length)
        await comment(
          proposal,
          `review:${event.revision}:${event.attempt}`,
          [
            `## Review findings — iteration ${event.attempt}`,
            `Reviewed commit: \`${event.revision}\`; approved plan: \`${proposal.digest}\`.`,
            event.validation
              ? `Local validation: ${event.validation.evaluatedScope} evaluated checks; ${event.validation.checks.map((check) => `${check.name}: ${check.state}`).join(", ")}. This is not independent proof.`
              : "Local validation evidence is retained in the canonical journal; no independent proof is inferred.",
            ...event.findings.map(
              (finding) => `- ${finding.replaceAll("@", "@\u200b")}`,
            ),
            "Fixes remain inside the approved plan and configured file scope. Local validation is repeated before a fresh, separate read-only review.",
          ].join("\n\n"),
          signal,
        );
      if (event.stage === "blocked") {
        if (event.reason?.includes("requires new user approval"))
          await stage(
            proposal,
            "orchestration-user-approval",
            `review-${event.attempt}-scope-approval`,
            signal,
          );
        await this.blocked(
          proposal,
          event.reason ?? "Reviewer could not establish a safe result",
          signal,
        );
      } else {
        await stage(
          proposal,
          `orchestration-${event.stage}`,
          `review-${event.attempt}-${event.stage}`,
          signal,
        );
      }
    },
    async ready(proposal: OrchestrationProposal, signal: AbortSignal) {
      const { endpoint, approver } = sourceFor(proposal);
      if (
        !proposal.artifacts ||
        !proposal.digest ||
        proposal.status !== "ready" ||
        queue.get(proposal.id)?.proposal.status !== "ready"
      )
        return;
      await current(proposal, signal);
      const key = `${githubWorkflowKey(config.id, proposal.source.sourceId, proposal.source.id)}/plan/${proposal.id}`;
      let publication =
        store.read(key).value === null
          ? null
          : githubPlanPublicationSchema.parse(store.read(key).value);
      if (!publication) {
        const events = (await pages(`${endpoint}/events`, signal)).map((row) =>
          eventSchema.parse(row),
        );
        const body = [
          "## Orchestration plan — user approval required",
          `Plan digest: \`${proposal.digest}\`\nSource revision: \`${proposal.sourceRevision}\`\nConfiguration revision: **${config.revision}**`,
          "### Investigation",
          proposal.artifacts.investigation,
          "### Specification",
          proposal.artifacts.specification,
          "### Plan",
          proposal.artifacts.plan,
          "### Host validation",
          ...proposal.artifacts.acceptance.map(
            (check) => `- ${check.criterion}: ${check.verification}`,
          ),
          `Only **${approver}** can approve this exact, unchanged plan by posting a new comment containing only \`plan approved\` (case-insensitive, surrounding whitespace allowed), or by adding \`orchestration-implementation-ready\`, after this comment. Approval comments must have a provider creation timestamp strictly later than this plan and must never have been edited. Quoted phrases, additional text, old comments and other authors are not approval. The next verified host transition adds implementation-ready and removes previous workflow stages. The host retains admission when it removes \`orchestration-ready\`; unrelated labels are preserved.`,
          "This does not authorize scope expansion, uploads, credentials changes, push, pull requests, merge or deployment. Investigation-only issues remain implementation-blocked.",
        ]
          .join("\n\n")
          .replaceAll("@", "@\u200b");
        const published = await comment(proposal, "plan", body, signal);
        publication = {
          proposalId: proposal.id,
          proposalDigest: proposal.digest,
          sourceRevision: proposal.sourceRevision,
          configurationRevision: config.revision,
          commentId: published.id,
          publishedAt: published.created_at,
          eventFloor: Math.max(0, ...events.map((event) => event.id)),
          bodyDigest: digest(published.body),
          approver,
        };
        write(key, publication, "github-plan-published");
      }
      if (store.read(`${key}/stage-confirmed`).value === null) {
        if (
          !(await labels(endpoint, signal)).includes(
            "orchestration-implementation-ready",
          )
        )
          await stage(
            proposal,
            "orchestration-user-approval",
            "plan-published",
            signal,
          );
        write(
          `${key}/stage-confirmed`,
          true,
          "github-plan-approval-stage-confirmed",
        );
      }
      const published = commentSchema.parse(
        await transport(
          `${endpoint.split("/issues/")[0]}/issues/comments/${publication.commentId}`,
          "GET",
          undefined,
          signal,
        ),
      );
      const approvalLabels = await labels(endpoint, signal);
      if (
        published.id !== publication.commentId ||
        published.created_at !== publication.publishedAt ||
        publication.approver.toLowerCase() !== approver.toLowerCase()
      )
        throw new Error(
          "Published plan identity, creation timestamp or configured approver changed",
        );
      const labelProof = attributedWorkflowApproval({
        publication,
        proposal,
        publishedBody: published.body,
        labels: approvalLabels,
        events: await pages(`${endpoint}/events`, signal),
      });
      const proof =
        (store.read(`${key}/comment-approval-transition`).value === null
          ? labelProof
          : null) ??
        attributedWorkflowCommentApproval({
          publication,
          proposal,
          publishedBody: published.body,
          comments: await pages(`${endpoint}/comments`, signal),
        });
      if (!proof) {
        const stages = approvalLabels.filter((name) =>
          orchestrationWorkflowLabels.includes(name),
        );
        const synchronized =
          stages.length === 1 && stages[0] === "orchestration-user-approval";
        state(proposal, {
          stage: "orchestration-user-approval",
          sync: synchronized ? "confirmed" : "blocked",
          diagnostic: `Waiting for ${approver} to approve published plan ${proposal.digest}${synchronized ? "" : "; remote workflow stages are not synchronized, and no approval is inferred"}`,
        });
        return;
      }
      if (
        config.runtime.planningOverrides?.some(
          (rule) =>
            rule.sourceId === proposal.source.sourceId &&
            rule.itemId === proposal.source.id,
        )
      ) {
        await this.blocked(
          proposal,
          "This issue is approved for investigation/planning only; implementation or external upload requires a new explicitly scoped plan and host configuration.",
          signal,
        );
        return;
      }
      let consumptionKey: string | undefined;
      const binding = { ...proof, publication };
      if ("kind" in proof) {
        consumptionKey = `hub-workflow-comment-approval/${digest([
          config.id,
          proposal.source.sourceId,
          proposal.source.id,
          proof.approvalCommentId,
        ])}`;
        const consumed = store.read(consumptionKey);
        if (consumed.value !== null) {
          const existing = z
            .object({
              state: z.enum(["reserved", "confirmed"]),
              binding: commentApprovalProofSchema,
            })
            .parse(consumed.value);
          if (digest(existing.binding) !== digest(binding))
            throw new Error(
              "Approval comment is already bound to another published plan",
            );
        } else if (
          !store.compareAndSwap(
            consumptionKey,
            consumed.version,
            { state: "reserved", binding },
            {
              kind: "github-comment-approval-reserved",
              at: new Date().toISOString(),
            },
          )
        )
          throw new Error(
            "Concurrent approval comment reservation; no workflow effect replayed",
          );
        write(
          `${key}/comment-approval-transition`,
          binding,
          "github-comment-approval-stage-reserved",
        );
      }
      await stage(
        proposal,
        "orchestration-implementation-ready",
        "kind" in proof
          ? `attributed-comment-approval-${proof.approvalCommentId}`
          : `attributed-approval-${proof.eventId}`,
        signal,
        "kind" in proof ? "comment" : "label",
      );
      if ("kind" in proof) {
        const freshProof = attributedWorkflowCommentApproval({
          publication,
          proposal,
          publishedBody: commentSchema.parse(
            await transport(
              `${endpoint.split("/issues/")[0]}/issues/comments/${publication.commentId}`,
              "GET",
              undefined,
              signal,
            ),
          ).body,
          comments: [
            await transport(
              `${endpoint.split("/issues/")[0]}/issues/comments/${proof.approvalCommentId}`,
              "GET",
              undefined,
              signal,
            ),
          ],
        });
        if (digest(freshProof) !== digest(proof))
          throw new Error(
            "Approval comment changed during stage synchronization; no plan approval granted",
          );
      }
      write(`${key}/approval`, binding, "github-attributed-plan-approved");
      queue.review({
        proposalId: proposal.id,
        proposalDigest: proposal.digest,
        sourceRevision: proposal.sourceRevision,
        configurationRevision: config.revision,
        decision: "approve",
      });
      if (consumptionKey)
        write(
          consumptionKey,
          { state: "confirmed", binding },
          "github-comment-approval-confirmed",
        );
      state(proposal, {
        stage: "orchestration-implementation-ready",
        sync: "confirmed",
        diagnostic: "",
      });
    },
  };
}
