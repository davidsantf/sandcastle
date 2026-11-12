import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createGithubAccountEnvironment,
  githubAccountAuthenticationSchema,
} from "./OrchestrationGithubAccount.js";
import {
  createOrchestrationDiscoveryAdapter,
  orchestrationDiscoverySourceSchema,
} from "./OrchestrationDiscovery.js";
import { githubWorkflowTransport } from "./OrchestrationGithubWorkflow.js";

const native = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  execFile: native.execute,
}));
const authentication = {
  kind: "github-cli" as const,
  account: "configured_user",
  allowedAccounts: ["configured_user"],
};
const signal = () => new AbortController().signal;
function fixture(identity = "configured_user", denied = false) {
  native.execute.mockImplementation(
    (
      _command: string,
      args: string[],
      _options: { env?: NodeJS.ProcessEnv },
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      if (args[0] === "auth") callback(null, "fixture-selected-token\n", "");
      else if (args.includes("user"))
        callback(null, JSON.stringify({ login: identity }), "");
      else if (denied)
        callback(new Error("private provider error"), "", "HTTP 403");
      else
        callback(
          null,
          args.includes("--include") ? "HTTP/2.0 200 OK\r\n\r\n[]" : "{}",
          "",
        );
      return { stdin: { end: vi.fn() } };
    },
  );
}
beforeEach(() => {
  native.execute.mockReset();
  vi.stubEnv("GH_TOKEN", "fixture-unrelated-owner");
  vi.stubEnv("GITHUB_TOKEN", "fixture-other-owner");
  vi.stubEnv("GH_HOST", "unrelated.example.test");
});
afterEach(() => vi.unstubAllEnvs());

it("selects only the linked allowed account and leaves inherited/global authentication untouched", async () => {
  fixture();
  const env = await createGithubAccountEnvironment(authentication)(signal());
  expect(native.execute.mock.calls[0]![1]).toEqual([
    "auth",
    "token",
    "--hostname",
    "github.com",
    "--user",
    "configured_user",
  ]);
  expect(native.execute.mock.calls[0]![2].env).not.toHaveProperty("GH_TOKEN");
  expect(env.GH_TOKEN).toBe("fixture-selected-token");
  expect(env.GH_HOST).toBe("github.com");
  expect(env.GITHUB_TOKEN).toBeUndefined();
  expect(process.env.GH_TOKEN).toBe("fixture-unrelated-owner");
  expect(process.env.GH_HOST).toBe("unrelated.example.test");
});

it.each([
  { ...authentication, account: "different_user" },
  { ...authentication, allowedAccounts: [] },
  {
    ...authentication,
    allowedAccounts: ["configured_user", "CONFIGURED_USER"],
  },
  { ...authentication, token: "credentials-do-not-belong-in-configuration" },
])("rejects invalid or unlinked account configuration: %j", (input) => {
  expect(githubAccountAuthenticationSchema.safeParse(input).success).toBe(
    false,
  );
  expect(native.execute).not.toHaveBeenCalled();
});

it("does not fall back to another account when the selected credential is missing", async () => {
  native.execute.mockImplementation(
    (
      _command: string,
      _args: string[],
      _options: unknown,
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      callback(new Error("fixture-private-token"), "", "fixture-private-token");
    },
  );
  await expect(
    createGithubAccountEnvironment(authentication)(signal()),
  ).rejects.toThrow("credential-unavailable");
  expect(native.execute).toHaveBeenCalledTimes(1);
});

it.each(["", "two token-values"])(
  "rejects an unusable selected credential without probing a different identity",
  async (token) => {
    const execute = vi.fn(async () => token);
    await expect(
      createGithubAccountEnvironment(authentication, execute)(signal()),
    ).rejects.toThrow("credential-unavailable");
    expect(execute).toHaveBeenCalledTimes(1);
  },
);

it.each(["invalid JSON fixture-private-token", '{"login":null}'])(
  "redacts unverifiable provider identity evidence and performs no repository operation",
  async (response) => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce("fixture-private-token")
      .mockResolvedValueOnce(response);
    await expect(
      createGithubAccountEnvironment(authentication, execute)(signal()),
    ).rejects.toThrow(
      "Configured GitHub account identity-unverified; inspect its existing sign-in and repository access. No account fallback or global switch performed.",
    );
    expect(execute).toHaveBeenCalledTimes(2);
  },
);

it("blocks discovery before any repository request if the selected token identifies another user", async () => {
  fixture("unrelated_owner");
  const adapter = createOrchestrationDiscoveryAdapter(
    orchestrationDiscoverySourceSchema.parse({
      id: "github",
      projectId: "api",
      hub: { kind: "github", repository: "fixture/api" },
      selector: { assignedTo: "owner" },
      authentication,
    }),
  );
  await expect(adapter.poll(null, signal())).rejects.toThrow(
    "identity-mismatch",
  );
  expect(native.execute).toHaveBeenCalledTimes(2);
});

it("uses the same pinned identity for actual native discovery requests", async () => {
  fixture();
  const adapter = createOrchestrationDiscoveryAdapter(
    orchestrationDiscoverySourceSchema.parse({
      id: "github",
      projectId: "api",
      hub: { kind: "github", repository: "fixture/api" },
      selector: { assignedTo: "owner" },
      authentication,
    }),
  );
  expect((await adapter.poll(null, signal())).items).toEqual([]);
  expect(native.execute.mock.calls.at(-1)![1]).toContain("--include");
  expect(native.execute.mock.calls.at(-1)![2].env.GH_TOKEN).toBe(
    "fixture-selected-token",
  );
});

it("blocks a workflow write on identity mismatch before launching its mutation", async () => {
  fixture("unrelated_owner");
  await expect(
    githubWorkflowTransport(
      "repos/fixture/api/issues/1/comments",
      "POST",
      { body: "fixture" },
      signal(),
      authentication,
    ),
  ).rejects.toThrow("identity-mismatch");
  expect(native.execute).toHaveBeenCalledTimes(2);
});

it("reports access denial under the configured identity without trying an owner account", async () => {
  fixture("configured_user", true);
  await expect(
    githubWorkflowTransport(
      "repos/fixture/api/issues/1/comments",
      "POST",
      { body: "fixture" },
      signal(),
      authentication,
    ),
  ).rejects.toThrow("(403)");
  expect(native.execute).toHaveBeenCalledTimes(3);
  expect(native.execute.mock.calls.at(-1)![2].env.GH_TOKEN).toBe(
    "fixture-selected-token",
  );
  expect(
    native.execute.mock.calls.filter((call) => call[1][0] === "auth"),
  ).toHaveLength(1);
});

it("rejects linking GitHub authentication to an ADO source", () => {
  expect(
    orchestrationDiscoverySourceSchema.safeParse({
      id: "ado",
      projectId: "api",
      hub: {
        kind: "ado",
        organization: "org",
        project: "project",
        repository: "api",
      },
      selector: { assignedTo: "owner" },
      authentication,
    }).success,
  ).toBe(false);
});
