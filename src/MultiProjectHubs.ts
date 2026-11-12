import { execFile } from "node:child_process";
import { z } from "zod";
import {
  digest,
  normalizeOrchestrationFailure,
} from "./MultiProjectProtocol.js";
import type {
  OrchestrationCheck,
  OrchestrationHubEvidence,
  OrchestrationProject,
} from "./MultiProjectProtocol.js";

export type OrchestrationHubTransport = (
  url: string,
  signal: AbortSignal,
) => Promise<unknown>;

const object = z.record(z.string(), z.unknown());
const revision = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const str = (value: unknown): string => z.string().parse(value);
const rows = (value: unknown): Record<string, unknown>[] =>
  z.array(object).parse(value);
const obj = (value: unknown): Record<string, unknown> => object.parse(value);
const unknownEvidence = (): OrchestrationHubEvidence => ({
  revision: "",
  policiesKnown: false,
  required: [],
  checks: [],
  labels: [],
  diagnostic: "hub transport, revision, or policy decoding unavailable",
});
const passed = new Set(["success", "succeeded", "neutral", "skipped"]);
const failureSignature = (name: string, detail: string): string =>
  `${name}:${digest(normalizeOrchestrationFailure(detail))}`;
const safeLink = (value: unknown): string => {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return "";
    url.search = "";
    url.hash = "";
    return url.href.slice(0, 1_000);
  } catch {
    return "";
  }
};

/** Host-only gh transport. CLI auth is never put into worker prompts. */
export const githubCliTransport: OrchestrationHubTransport = (
  endpoint,
  signal,
) =>
  new Promise((resolve, reject) => {
    if (!endpoint.startsWith("/repos/")) {
      reject(new Error("unsupported GitHub endpoint"));
      return;
    }
    execFile(
      "gh",
      ["api", endpoint, "-H", "Accept: application/vnd.github+json"],
      { signal, maxBuffer: 4 * 1024 * 1024, timeout: 30_000 },
      (error, stdout) => {
        if (error) {
          reject(
            new Error(
              "GitHub read failed; check host gh authentication and repository access",
            ),
          );
          return;
        }
        try {
          for (const token of [process.env.GH_TOKEN, process.env.GITHUB_TOKEN])
            if (token) stdout = stdout.replaceAll(token, "[redacted]");
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error("invalid GitHub response"));
        }
      },
    );
  });

/** Host-only native ADO transport; token remains inside this closure. */
export const createAdoReadTransport = (
  token: string,
): OrchestrationHubTransport => {
  if (!token.trim()) throw new Error("ADO host token required");
  return async (url, signal) => {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== "dev.azure.com" ||
      parsed.username ||
      parsed.password
    )
      throw new Error("unsupported ADO endpoint");
    const response = await fetch(url, {
      signal,
      redirect: "error",
      headers: {
        Authorization: `Basic ${Buffer.from(`:${token}`).toString("base64")}`,
      },
    });
    if (!response.ok)
      throw new Error(
        `ADO read failed (${response.status}); check host authentication/access`,
      );
    if (!response.body) throw new Error("ADO response body missing");
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
          throw new Error("ADO response exceeds host evidence limit");
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    const body = Buffer.concat(chunks)
      .toString("utf8")
      .replaceAll(token, "[redacted]");
    const value: unknown = JSON.parse(body);
    const continuation = response.headers.get("x-ms-continuationtoken");
    return continuation
      ? { ...obj(value), continuationToken: continuation }
      : value;
  };
};

const summarize = (state: unknown): OrchestrationCheck["state"] => {
  if (typeof state !== "string") return "unknown";
  const normalized = state.toLowerCase();
  return passed.has(normalized)
    ? "passed"
    : [
          "failure",
          "failed",
          "error",
          "canceled",
          "cancelled",
          "timed_out",
          "action_required",
        ].includes(normalized)
      ? "failed"
      : [
            "pending",
            "inprogress",
            "in_progress",
            "queued",
            "notset",
            "running",
          ].includes(normalized)
        ? "pending"
        : "unknown";
};

export function createGitHubOrchestrationHub(
  transport: OrchestrationHubTransport = githubCliTransport,
) {
  return async (
    project: OrchestrationProject,
    signal: AbortSignal,
    binding?: { sourceBranch: string; targetBranch: string },
  ): Promise<OrchestrationHubEvidence> => {
    if (project.hub.kind !== "github")
      throw new Error("GitHub project required");
    if (!project.hub.pullRequest)
      return {
        ...unknownEvidence(),
        diagnostic: "Change request registration required",
      };
    const base = `/repos/${project.hub.repository}`;
    try {
      const pr = obj(
        await transport(`${base}/pulls/${project.hub.pullRequest}`, signal),
      );
      const head = obj(pr.head);
      const sha = revision.parse(head.sha);
      const target = str(obj(pr.base).ref);
      if (pr.state !== "open" || pr.merged === true) return unknownEvidence();
      if (
        binding &&
        (head.ref !== binding.sourceBranch || target !== binding.targetBranch)
      )
        return unknownEvidence();
      const [
        protectionValue,
        rulesValue,
        checksValue,
        statusValue,
        issueValue,
      ] = await Promise.all([
        transport(
          `${base}/branches/${encodeURIComponent(target)}/protection`,
          signal,
        ),
        transport(
          `${base}/rules/branches/${encodeURIComponent(target)}`,
          signal,
        ),
        transport(`${base}/commits/${sha}/check-runs?per_page=100`, signal),
        transport(`${base}/commits/${sha}/status?per_page=100`, signal),
        transport(`${base}/issues/${project.hub.pullRequest}`, signal),
      ]);
      const protection = obj(protectionValue);
      const rules = rows(rulesValue);
      const requirements = new Map<string, { context: string; app?: number }>();
      const addRequired = (context: string, app?: number): void => {
        requirements.set(app && app > 0 ? `${context}@${app}` : context, {
          context,
          app,
        });
      };
      if (protection.required_status_checks) {
        const policy = obj(protection.required_status_checks);
        const checks = rows(policy.checks ?? []);
        for (const check of checks)
          addRequired(
            str(check.context),
            typeof check.app_id === "number" ? check.app_id : undefined,
          );
        for (const context of z.array(z.string()).parse(policy.contexts ?? []))
          if (!checks.some((c) => c.context === context)) addRequired(context);
      }
      let known = true;
      if (
        [
          protection.required_conversation_resolution,
          protection.required_linear_history,
        ].some((policy) => policy && obj(policy).enabled === true)
      )
        known = false;
      for (const rule of rules) {
        if (rule.type === "required_status_checks") {
          for (const check of rows(obj(rule.parameters).required_status_checks))
            addRequired(
              str(check.context),
              typeof check.integration_id === "number"
                ? check.integration_id
                : undefined,
            );
        } else if (
          !["pull_request", "non_fast_forward", "deletion"].includes(
            str(rule.type),
          )
        )
          known = false;
      }
      const checkResult = obj(checksValue);
      const statusResult = obj(statusValue);
      const runs = rows(checkResult.check_runs);
      const statuses = rows(statusResult.statuses);
      // Refuse truncated responses rather than selecting a convenient green subset.
      if (
        Number(checkResult.total_count) > runs.length ||
        statuses.length >= 100
      )
        known = false;
      const checks: OrchestrationCheck[] = [];
      for (const [name, requirement] of requirements) {
        const candidates = runs.filter(
          (c) =>
            c.name === requirement.context &&
            (!requirement.app ||
              requirement.app < 0 ||
              obj(c.app).id === requirement.app),
        );
        const legacy =
          requirement.app && requirement.app > 0
            ? []
            : statuses.filter((s) => s.context === requirement.context);
        const newest = candidates.sort(
          (a, b) => Number(b.id) - Number(a.id),
        )[0];
        const status = legacy.sort((a, b) => Number(b.id) - Number(a.id))[0];
        // Check/status namespace ambiguity cannot establish required evidence.
        if (newest && status) {
          checks.push({ name, state: "unknown" });
          continue;
        }
        const current = newest ?? status;
        if (!current) {
          checks.push({ name, state: "unknown" });
          continue;
        }
        if (newest && newest.head_sha !== sha) {
          checks.push({ name, state: "unknown" });
          continue;
        }
        const state = newest
          ? newest.status === "completed"
            ? summarize(newest.conclusion)
            : "pending"
          : summarize(current.state);
        const link = current.details_url ?? current.target_url ?? "";
        let detail = "";
        if (state === "failed" && newest) {
          const annotations = rows(
            await transport(
              `${base}/check-runs/${z.number().int().positive().parse(newest.id)}/annotations?per_page=100`,
              signal,
            ),
          );
          detail = annotations
            .slice(0, 10)
            .map(
              (annotation) =>
                `${String(annotation.path ?? "")}:${String(annotation.start_line ?? "")} ${str(annotation.message)}`,
            )
            .join("\n");
          if (!detail && newest.output) {
            const summary = obj(newest.output).summary;
            if (typeof summary === "string") detail = summary;
          }
        } else if (
          state === "failed" &&
          typeof current.description === "string"
        )
          detail = current.description;
        detail = detail.trim().slice(0, 4_000);
        checks.push({
          name,
          state,
          signature: failureSignature(
            name,
            detail ||
              str(
                newest ? (newest.conclusion ?? newest.status) : current.state,
              ),
          ),
          evidence:
            state === "failed" && !detail
              ? undefined
              : `${detail || `${name}: ${state}`}. Inspect host run ${String(current.id)} ${safeLink(link)}`,
        });
      }
      const reviewPolicy = protection.required_pull_request_reviews
        ? obj(protection.required_pull_request_reviews)
        : undefined;
      const reviewRules = rules
        .filter((r) => r.type === "pull_request")
        .map((r) => obj(r.parameters));
      if (reviewPolicy || reviewRules.length) {
        if (
          reviewPolicy?.require_code_owner_reviews === true ||
          reviewRules.some((p) => p.require_code_owner_review === true)
        )
          known = false;
        const requiredCount = Math.max(
          Number(reviewPolicy?.required_approving_review_count ?? 0),
          ...reviewRules.map((p) =>
            Number(p.required_approving_review_count ?? 0),
          ),
        );
        if (!Number.isSafeInteger(requiredCount) || requiredCount <= 0)
          known = false;
        const reviews = rows(
          await transport(
            `${base}/pulls/${project.hub.pullRequest}/reviews?per_page=100`,
            signal,
          ),
        );
        if (reviews.length >= 100) known = false;
        const latest = new Map<string, Record<string, unknown>>();
        for (const review of reviews.sort(
          (a, b) => Number(a.id) - Number(b.id),
        ))
          latest.set(str(obj(review.user).login), review);
        const approvals = [...latest.values()].filter(
          (r) => r.state === "APPROVED" && r.commit_id === sha,
        ).length;
        const denied = [...latest.values()].some(
          (r) => r.state === "CHANGES_REQUESTED",
        );
        const name = "policy:reviews";
        addRequired(name);
        checks.push({
          name,
          state: denied
            ? "failed"
            : approvals >= requiredCount
              ? "passed"
              : "pending",
          evidence: `Current-revision approvals ${approvals}/${requiredCount}`,
        });
        if (
          reviewPolicy?.require_last_push_approval === true ||
          reviewRules.some((p) => p.require_last_push_approval === true)
        )
          known = false;
      }
      const labels = rows(obj(issueValue).labels).map((label) =>
        str(label.name),
      );
      return {
        revision: sha,
        policiesKnown: known,
        required: [...requirements.keys()],
        checks,
        labels,
      };
    } catch {
      // Unknown is explicit and persisted by the host, never success-shaped.
      return unknownEvidence();
    }
  };
}

export function createAdoOrchestrationHub(
  transport: OrchestrationHubTransport,
) {
  return async (
    project: OrchestrationProject,
    signal: AbortSignal,
    binding?: { sourceBranch: string; targetBranch: string },
  ): Promise<OrchestrationHubEvidence> => {
    if (project.hub.kind !== "ado") throw new Error("ADO project required");
    if (!project.hub.pullRequest)
      return {
        ...unknownEvidence(),
        diagnostic: "Change request registration required",
      };
    const hub = project.hub;
    const base = `https://dev.azure.com/${encodeURIComponent(hub.organization)}/${encodeURIComponent(hub.project)}`;
    const repo = `${base}/_apis/git/repositories/${encodeURIComponent(hub.repository)}`;
    try {
      const pr = obj(
        await transport(
          `${repo}/pullrequests/${hub.pullRequest}?api-version=7.1`,
          signal,
        ),
      );
      if (pr.status !== "active") return unknownEvidence();
      if (
        binding &&
        (pr.sourceRefName !== `refs/heads/${binding.sourceBranch}` ||
          pr.targetRefName !== `refs/heads/${binding.targetBranch}`)
      )
        return unknownEvidence();
      const sha = revision.parse(obj(pr.lastMergeSourceCommit).commitId);
      const repositoryId = str(obj(pr.repository).id);
      const artifact = encodeURIComponent(
        `vstfs:///CodeReview/CodeReviewId/${str(obj(obj(pr.repository).project).id)}/${hub.pullRequest}`,
      );
      const [
        policyValue,
        evaluationValue,
        statusValue,
        labelsValue,
        iterationValue,
      ] = await Promise.all([
        transport(
          `${base}/_apis/git/policy/configurations?repositoryId=${encodeURIComponent(repositoryId)}&refName=${encodeURIComponent(str(pr.targetRefName))}&api-version=5.0-preview.1`,
          signal,
        ),
        transport(
          `${base}/_apis/policy/evaluations?artifactId=${artifact}&api-version=7.1-preview.1`,
          signal,
        ),
        transport(
          `${repo}/pullrequests/${hub.pullRequest}/statuses?api-version=7.1`,
          signal,
        ),
        transport(
          `${repo}/pullrequests/${hub.pullRequest}/labels?api-version=7.1-preview.1`,
          signal,
        ),
        transport(
          `${repo}/pullrequests/${hub.pullRequest}/iterations?api-version=7.1`,
          signal,
        ),
      ]);
      const policies = rows(obj(policyValue).value).filter(
        (p) => p.isEnabled === true && p.isBlocking === true,
      );
      const evaluations = rows(obj(evaluationValue).value);
      const statuses = rows(obj(statusValue).value);
      const latestIteration = rows(obj(iterationValue).value).sort(
        (a, b) => Number(b.id) - Number(a.id),
      )[0];
      let known = [
        policyValue,
        evaluationValue,
        statusValue,
        labelsValue,
        iterationValue,
      ].every(
        (v) => !obj(v).continuationToken && !obj(v)["x-ms-continuationtoken"],
      );
      const required: string[] = [];
      const checks: OrchestrationCheck[] = [];
      for (const policy of policies) {
        const name = `policy:${String(policy.id)}`;
        required.push(name);
        const matches = evaluations.filter(
          (e) => obj(e.configuration).id === policy.id,
        );
        if (matches.length !== 1) {
          checks.push({ name, state: "unknown" });
          continue;
        }
        const evaluation = matches[0]!;
        if (
          typeof policy.revision === "number" &&
          obj(evaluation.configuration).revision !== policy.revision
        ) {
          checks.push({ name, state: "unknown" });
          continue;
        }
        const context = obj(evaluation.context ?? {});
        const buildId = context.buildId;
        if (typeof buildId === "number") {
          const build = obj(
            await transport(
              `${base}/_apis/build/builds/${buildId}?api-version=7.1`,
              signal,
            ),
          );
          const state =
            build.sourceVersion !== sha
              ? "unknown"
              : build.status === "completed"
                ? summarize(build.result)
                : "pending";
          const policyState =
            evaluation.status === "approved"
              ? state
              : evaluation.status === "rejected"
                ? "failed"
                : "pending";
          let detail = "";
          if (state !== "unknown" && policyState === "failed") {
            const timeline = obj(
              await transport(
                `${base}/_apis/build/builds/${buildId}/timeline?api-version=7.1`,
                signal,
              ),
            );
            detail = rows(timeline.records)
              .flatMap((record) =>
                rows(record.issues ?? [])
                  .filter((issue) => issue.type === "error")
                  .map((issue) => str(issue.message)),
              )
              .slice(0, 10)
              .join("\n")
              .trim()
              .slice(0, 4_000);
          }
          checks.push({
            name,
            state: state === "unknown" ? "unknown" : policyState,
            signature: failureSignature(name, detail || String(build.result)),
            evidence:
              policyState === "failed" && !detail
                ? undefined
                : `${detail || `ADO build ${buildId}: ${String(build.result ?? build.status)}`}; logs ${base}/_apis/build/builds/${buildId}/logs?api-version=7.1`,
          });
        } else {
          // Status/review evaluations need exact revision evidence; no guessed approval.
          const statusName = obj(policy.settings ?? {}).statusName;
          const statusGenre = obj(policy.settings ?? {}).statusGenre;
          const matching = statuses.filter(
            (s) =>
              obj(s.context).name === statusName &&
              obj(s.context).genre === statusGenre &&
              s.iterationId === latestIteration?.id,
          );
          if (
            typeof statusName === "string" &&
            matching.length === 1 &&
            typeof latestIteration?.id === "number" &&
            obj(latestIteration.sourceRefCommit).commitId === sha
          )
            checks.push({
              name,
              state:
                evaluation.status === "approved"
                  ? summarize(matching[0]!.state)
                  : evaluation.status === "rejected"
                    ? "failed"
                    : "pending",
              signature: failureSignature(
                name,
                String(matching[0]!.description ?? matching[0]!.state),
              ),
              evidence:
                typeof matching[0]!.description === "string"
                  ? `${name}: ${matching[0]!.description}`
                  : undefined,
            });
          else {
            known = false;
            checks.push({ name, state: "unknown" });
          }
        }
      }
      const labels = rows(obj(labelsValue).value).map((label) =>
        str(label.name),
      );
      return { revision: sha, policiesKnown: known, required, checks, labels };
    } catch {
      return unknownEvidence();
    }
  };
}
