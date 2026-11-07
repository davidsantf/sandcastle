import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAdoOrchestrationHub,
  createAdoReadTransport,
  createGitHubOrchestrationHub,
} from "./MultiProjectHubs.js";
import {
  evaluateOrchestrationChecks,
  type OrchestrationProject,
} from "./MultiProjectProtocol.js";

const sha = "a".repeat(40);
const stale = "b".repeat(40);
const github: OrchestrationProject = {
  id: "api",
  repositoryRoot: process.cwd(),
  mode: "individual",
  hub: { kind: "github", repository: "org/repo", pullRequest: 7 },
};
const ado: OrchestrationProject = {
  ...github,
  hub: {
    kind: "ado",
    organization: "org",
    project: "project space",
    repository: "repo",
    pullRequest: 7,
  },
};
const signal = (): AbortSignal => new AbortController().signal;
afterEach(() => vi.unstubAllGlobals());

const githubTransport = (overrides: Record<string, unknown> = {}) =>
  vi.fn(async (url: string) => {
    for (const [part, result] of Object.entries(overrides))
      if (url.includes(part)) return result;
    if (url.includes("/protection"))
      return {
        required_status_checks: {
          contexts: ["build"],
          checks: [{ context: "build", app_id: 42 }],
        },
      };
    if (url.includes("/rules/")) return [];
    if (url.includes("/check-runs"))
      return {
        total_count: 1,
        check_runs: [
          {
            id: 17,
            name: "build",
            head_sha: sha,
            status: "completed",
            conclusion: "success",
            app: { id: 42 },
          },
        ],
      };
    if (url.includes("/status?")) return { statuses: [] };
    if (url.includes("/issues/")) return { labels: [] };
    return {
      state: "open",
      merged: false,
      head: { sha, ref: "work/one" },
      base: { ref: "release/main" },
    };
  });
const adoTransport = (overrides: Record<string, unknown> = {}) =>
  vi.fn(async (url: string) => {
    for (const [part, result] of Object.entries(overrides))
      if (url.includes(part)) return result;
    if (url.includes("/configurations?"))
      return { value: [{ id: 4, isEnabled: true, isBlocking: true }] };
    if (url.includes("/evaluations?"))
      return {
        value: [
          {
            configuration: { id: 4 },
            status: "approved",
            context: { buildId: 19 },
          },
        ],
      };
    if (
      url.includes("/statuses?") ||
      url.includes("/labels?") ||
      url.includes("/iterations?")
    )
      return { value: [] };
    if (url.includes("/timeline?"))
      return {
        records: [
          { issues: [{ type: "error", message: "TS2322 src/api.ts line 14" }] },
        ],
      };
    if (url.includes("/build/builds/"))
      return { sourceVersion: sha, status: "completed", result: "succeeded" };
    return {
      status: "active",
      lastMergeSourceCommit: { commitId: sha },
      repository: { id: "repo-id", project: { id: "project-id" } },
      sourceRefName: "refs/heads/work/one",
      targetRefName: "refs/heads/main",
    };
  });

describe("native GitHub readiness adapter", () => {
  it("reads PR revision, branch rules, required app-bound checks, and labels", async () => {
    const transport = githubTransport();
    const evidence = await createGitHubOrchestrationHub(transport)(
      github,
      signal(),
    );
    expect(evidence.required).toEqual(["build@42"]);
    expect(evaluateOrchestrationChecks(evidence, sha)).toEqual({
      state: "passed",
      evaluated: 1,
    });
    const urls = transport.mock.calls.map(([url]) => url);
    expect(urls).toContain("/repos/org/repo/pulls/7");
    expect(urls).toContain(
      "/repos/org/repo/branches/release%2Fmain/protection",
    );
    expect(urls).toContain(
      `/repos/org/repo/commits/${sha}/check-runs?per_page=100`,
    );
  });
  it.each([
    {
      "/check-runs": {
        total_count: 1,
        check_runs: [
          {
            id: 1,
            name: "build",
            head_sha: stale,
            status: "completed",
            conclusion: "success",
            app: { id: 42 },
          },
        ],
      },
    },
    { "/check-runs": { total_count: 200, check_runs: [] } },
    { "/rules/": [{ type: "required_workflows" }] },
    { "/protection": { required_status_checks: { contexts: [], checks: [] } } },
  ])(
    "rejects stale, truncated, unsupported or vacuous evidence %#",
    async (overrides) => {
      const evidence = await createGitHubOrchestrationHub(
        githubTransport(overrides),
      )(github, signal());
      expect(evaluateOrchestrationChecks(evidence, sha).state).toBe("unknown");
    },
  );
  it("returns explicit unknown diagnostic for unavailable transport", async () => {
    const evidence = await createGitHubOrchestrationHub(async () => {
      throw new Error("token secret");
    })(github, signal());
    expect(evidence.policiesKnown).toBe(false);
    expect(evidence.diagnostic).toBeTruthy();
    expect(JSON.stringify(evidence)).not.toContain("token secret");
  });
  it("requires the actual registered PR source and target branches", async () => {
    const observe = createGitHubOrchestrationHub(githubTransport());
    expect(
      (
        await observe(github, signal(), {
          sourceBranch: "work/one",
          targetBranch: "release/main",
        })
      ).policiesKnown,
    ).toBe(true);
    expect(
      (
        await observe(github, signal(), {
          sourceBranch: "wrong",
          targetBranch: "release/main",
        })
      ).policiesKnown,
    ).toBe(false);
    expect(
      (
        await observe(github, signal(), {
          sourceBranch: "work/one",
          targetBranch: "wrong",
        })
      ).policiesKnown,
    ).toBe(false);
  });
  it("does not let another app satisfy an app-bound required check", async () => {
    const evidence = await createGitHubOrchestrationHub(
      githubTransport({
        "/check-runs": {
          total_count: 1,
          check_runs: [
            {
              id: 1,
              name: "build",
              head_sha: sha,
              status: "completed",
              conclusion: "success",
              app: { id: 999 },
            },
          ],
        },
      }),
    )(github, signal());
    expect(evaluateOrchestrationChecks(evidence, sha).state).toBe("unknown");
  });
  it("binds review approvals to the current head and refuses code-owner ambiguity", async () => {
    const evidence = await createGitHubOrchestrationHub(
      githubTransport({
        "/protection": {
          required_status_checks: { contexts: ["build"], checks: [] },
          required_pull_request_reviews: { required_approving_review_count: 1 },
        },
        "/reviews?": [
          {
            id: 1,
            state: "APPROVED",
            commit_id: stale,
            user: { login: "reviewer" },
          },
        ],
      }),
    )(github, signal());
    expect(
      evidence.checks.find((c) => c.name === "policy:reviews")?.state,
    ).toBe("pending");
    const ambiguous = await createGitHubOrchestrationHub(
      githubTransport({
        "/protection": {
          required_pull_request_reviews: {
            require_code_owner_reviews: true,
            required_approving_review_count: 1,
          },
        },
        "/reviews?": [],
      }),
    )(github, signal());
    expect(ambiguous.policiesKnown).toBe(false);
  });
  it("does not conflate legacy status and check-run namespaces", async () => {
    const evidence = await createGitHubOrchestrationHub(
      githubTransport({
        "/protection": {
          required_status_checks: { contexts: ["build"], checks: [] },
        },
        "/status?": {
          statuses: [{ id: 9, context: "build", state: "success" }],
        },
      }),
    )(github, signal());
    expect(evaluateOrchestrationChecks(evidence, sha).state).toBe("unknown");
  });
  it("fetches concrete check annotations and strips credentials from links", async () => {
    const transport = githubTransport({
      "/check-runs?": {
        total_count: 1,
        check_runs: [
          {
            id: 17,
            name: "build",
            head_sha: sha,
            status: "completed",
            conclusion: "failure",
            app: { id: 42 },
            details_url:
              "https://github.com/org/repo/actions/runs/17?token=do-not-expose",
          },
        ],
      },
      "/annotations?": [
        {
          path: "src/api.ts",
          start_line: 14,
          message: "TS2322: type mismatch",
        },
      ],
    });
    const evidence = await createGitHubOrchestrationHub(transport)(
      github,
      signal(),
    );
    expect(evidence.checks[0]?.evidence).toContain("TS2322");
    expect(evidence.checks[0]?.evidence).not.toContain("do-not-expose");
    expect(
      transport.mock.calls.some(([url]) =>
        url.includes("/check-runs/17/annotations?"),
      ),
    ).toBe(true);
  });
});

describe("native ADO readiness adapter", () => {
  it("resolves source revision, required policies, build revision/results, and labels", async () => {
    const transport = adoTransport();
    const evidence = await createAdoOrchestrationHub(transport)(ado, signal());
    expect(evaluateOrchestrationChecks(evidence, sha)).toEqual({
      state: "passed",
      evaluated: 1,
    });
    expect(
      transport.mock.calls.some(([url]) =>
        url.includes("project%20space/_apis/build/builds/19?"),
      ),
    ).toBe(true);
    expect(
      transport.mock.calls.some(([url]) =>
        url.includes("repositoryId=repo-id&refName=refs%2Fheads%2Fmain"),
      ),
    ).toBe(true);
    expect(
      transport.mock.calls.some(([url]) =>
        url.includes("/_apis/git/policy/configurations?"),
      ),
    ).toBe(true);
  });
  it.each([
    {
      "/build/builds/": {
        sourceVersion: stale,
        status: "completed",
        result: "succeeded",
      },
    },
    { "/configurations?": { value: [] } },
    { "/evaluations?": { value: [] } },
    {
      "/configurations?": {
        value: [{ id: 4, isEnabled: true, isBlocking: true }],
        continuationToken: "next",
      },
    },
    {
      "/evaluations?": {
        value: [{ configuration: { id: 4 }, status: "approved", context: {} }],
      },
    },
  ])(
    "rejects stale, missing, truncated and unresolved policies %#",
    async (overrides) => {
      const evidence = await createAdoOrchestrationHub(adoTransport(overrides))(
        ado,
        signal(),
      );
      expect(evaluateOrchestrationChecks(evidence, sha).state).toBe("unknown");
    },
  );
  it("never treats a passing build with pending policy as green", async () => {
    const evidence = await createAdoOrchestrationHub(
      adoTransport({
        "/evaluations?": {
          value: [
            {
              configuration: { id: 4 },
              status: "queued",
              context: { buildId: 19 },
            },
          ],
        },
      }),
    )(ado, signal());
    expect(evaluateOrchestrationChecks(evidence, sha).state).toBe("pending");
  });
  it("requires exact source/target bindings and current policy configuration revisions", async () => {
    const observe = createAdoOrchestrationHub(adoTransport());
    expect(
      (
        await observe(ado, signal(), {
          sourceBranch: "work/one",
          targetBranch: "main",
        })
      ).policiesKnown,
    ).toBe(true);
    expect(
      (
        await observe(ado, signal(), {
          sourceBranch: "wrong",
          targetBranch: "main",
        })
      ).policiesKnown,
    ).toBe(false);
    const outdated = await createAdoOrchestrationHub(
      adoTransport({
        "/configurations?": {
          value: [{ id: 4, revision: 2, isEnabled: true, isBlocking: true }],
        },
        "/evaluations?": {
          value: [
            {
              configuration: { id: 4, revision: 1 },
              status: "approved",
              context: { buildId: 19 },
            },
          ],
        },
      }),
    )(ado, signal());
    expect(evaluateOrchestrationChecks(outdated, sha).state).toBe("unknown");
  });
  it("returns actionable failure evidence and human labels", async () => {
    const evidence = await createAdoOrchestrationHub(
      adoTransport({
        "/build/builds/19?": {
          sourceVersion: sha,
          status: "completed",
          result: "failed",
        },
        "/evaluations?": {
          value: [
            {
              configuration: { id: 4 },
              status: "rejected",
              context: { buildId: 19 },
            },
          ],
        },
        "/labels?": { value: [{ name: "needs-human" }] },
      }),
    )(ado, signal());
    expect(evaluateOrchestrationChecks(evidence, sha).state).toBe("failed");
    expect(evidence.checks[0]?.evidence).toContain("logs");
    expect(evidence.checks[0]?.evidence).toContain("TS2322");
    expect(evidence.labels).toEqual(["needs-human"]);
  });
  it("refuses sending host credentials to an unapproved origin", async () => {
    const transport = createAdoReadTransport("host-only-token");
    await expect(
      transport("https://example.com/api", signal()),
    ).rejects.toThrow(/endpoint/);
  });
  it("redacts host tokens from response evidence and detects continuation headers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ value: [{ message: "private-test-token" }] }),
            { headers: { "x-ms-continuationtoken": "next" } },
          ),
      ),
    );
    const result = await createAdoReadTransport("private-test-token")(
      "https://dev.azure.com/org/project/api",
      signal(),
    );
    expect(result).toEqual({
      value: [{ message: "[redacted]" }],
      continuationToken: "next",
    });
    expect(JSON.stringify(result)).not.toContain("private-test-token");
  });
  it("rejects oversized native HTTP evidence before decoding", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("x".repeat(4 * 1024 * 1024 + 1))),
    );
    await expect(
      createAdoReadTransport("private-test-token")(
        "https://dev.azure.com/org/project/api",
        signal(),
      ),
    ).rejects.toThrow(/evidence limit/);
  });
  it("does not offer repair without actionable timeline diagnostics", async () => {
    const evidence = await createAdoOrchestrationHub(
      adoTransport({
        "/build/builds/19?": {
          sourceVersion: sha,
          status: "completed",
          result: "failed",
        },
        "/timeline?": { records: [] },
      }),
    )(ado, signal());
    expect(evidence.checks[0]?.state).toBe("failed");
    expect(evidence.checks[0]?.evidence).toBeUndefined();
  });
  it("binds status policies to the real latest PR iteration and policy approval", async () => {
    const overrides = {
      "/configurations?": {
        value: [
          {
            id: 4,
            revision: 2,
            isEnabled: true,
            isBlocking: true,
            settings: { statusName: "build", statusGenre: "ci" },
          },
        ],
      },
      "/evaluations?": {
        value: [
          {
            configuration: { id: 4, revision: 2 },
            status: "approved",
            context: {},
          },
        ],
      },
      "/iterations?": {
        value: [{ id: 3, sourceRefCommit: { commitId: sha } }],
      },
      "/statuses?": {
        value: [
          {
            iterationId: 3,
            context: { name: "build", genre: "ci" },
            state: "succeeded",
          },
        ],
      },
    };
    const evidence = await createAdoOrchestrationHub(adoTransport(overrides))(
      ado,
      signal(),
    );
    expect(evaluateOrchestrationChecks(evidence, sha).state).toBe("passed");
    const outdated = await createAdoOrchestrationHub(
      adoTransport({
        ...overrides,
        "/iterations?": {
          value: [{ id: 4, sourceRefCommit: { commitId: stale } }],
        },
      }),
    )(ado, signal());
    expect(evaluateOrchestrationChecks(outdated, sha).state).toBe("unknown");
    const pending = await createAdoOrchestrationHub(
      adoTransport({
        ...overrides,
        "/evaluations?": {
          value: [
            {
              configuration: { id: 4, revision: 2 },
              status: "queued",
              context: {},
            },
          ],
        },
      }),
    )(ado, signal());
    expect(evaluateOrchestrationChecks(pending, sha).state).toBe("pending");
  });
});
