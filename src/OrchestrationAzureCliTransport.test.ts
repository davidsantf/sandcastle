import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createOrchestrationAzureCliReadTransport,
  OrchestrationAzureCliAuthError,
} from "./OrchestrationAzureCliTransport.js";
import { workspaceDiscoveryTransport } from "./OrchestrationWorkspaceHost.js";
import { workspaceDiscoverySourceSchema } from "./OrchestrationWorkspaceContract.js";

const resource = "499b84ac-1321-427f-aa17-267ca6975798";
const now = Date.parse("2026-11-10T12:00:00Z");
const account = {
  id: "11111111-1111-4111-8111-111111111111",
  tenantId: "22222222-2222-4222-8222-222222222222",
  user: { name: "owner@example.test", type: "user" },
};
const request = {
  method: "POST" as const,
  url: "https://dev.azure.com/org/proj/_apis/wit/wiql?api-version=7.1",
  body: { query: "fixture read query" },
};
const signal = () => new AbortController().signal;
function token(claims = {}, metadata = {}) {
  const payload = {
    aud: resource,
    tid: account.tenantId,
    exp: now / 1000 + 3600,
    upn: account.user.name,
    ...claims,
  };
  return {
    tokenType: "Bearer",
    expires_on: String(now / 1000 + 3600),
    accessToken: `eyJhbGciOiJmaXh0dXJlIn0.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.Zml4dHVyZQ`,
    ...metadata,
  };
}
function fixture() {
  let time = now;
  const execute = vi.fn(async (args: string[]) =>
    JSON.stringify(args[1] === "show" ? account : token()),
  );
  const read = vi.fn(async () => ({ status: 200, body: { value: [] } }));
  const transport = vi.fn(() => read);
  const invoke = createOrchestrationAzureCliReadTransport(
    { expectedIdentity: account.user.name },
    { execute, transport, now: () => time },
  );
  return {
    invoke,
    execute,
    transport,
    read,
    time: (value: number) => {
      time = value;
    },
  };
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("explicit host Azure CLI ADO authentication", () => {
  it("requests only the ADO resource with the verified account, caches in memory and preserves read request and signal", async () => {
    const f = fixture();
    const s = signal();
    await f.invoke(request, s);
    await f.invoke(request, s);
    expect(f.execute.mock.calls.map(([args]) => args)).toEqual([
      ["account", "show", "--output", "json", "--only-show-errors"],
      [
        "account",
        "get-access-token",
        "--resource",
        resource,
        "--tenant",
        account.tenantId,
        "--subscription",
        account.id,
        "--output",
        "json",
        "--only-show-errors",
      ],
      ["account", "show", "--output", "json", "--only-show-errors"],
      ["account", "show", "--output", "json", "--only-show-errors"],
    ]);
    expect(f.transport).toHaveBeenCalledWith({
      kind: "bearer",
      token: token().accessToken,
    });
    expect(f.read).toHaveBeenCalledWith(request, s);
  });
  it("refreshes before expiry and does not use a stale cached token when refresh fails", async () => {
    const f = fixture();
    await f.invoke(request, signal());
    f.time(now + 3_540_000);
    f.execute.mockImplementation(async (args) => {
      if (args[1] !== "show") throw new Error("sensitive-stderr-token");
      return JSON.stringify(account);
    });
    await expect(f.invoke(request, signal())).rejects.toMatchObject({
      reason: "reauthentication-required",
    });
    expect(f.read).toHaveBeenCalledTimes(1);
    f.execute.mockImplementation(async (args) =>
      JSON.stringify(
        args[1] === "show"
          ? account
          : token(
              { exp: now / 1000 + 7200 },
              { expires_on: now / 1000 + 7200 },
            ),
      ),
    );
    await f.invoke(request, signal());
    expect(f.read).toHaveBeenCalledTimes(2);
    expect(
      f.execute.mock.calls.filter(([args]) => args[1] === "get-access-token"),
    ).toHaveLength(3);
  });
  it.each(["before-first-token", "cached-token", "during-acquisition"])(
    "rejects a different account %s without using its credentials",
    async (when) => {
      const f = fixture();
      if (when === "cached-token") await f.invoke(request, signal());
      let shows = 0;
      f.execute.mockImplementation(async (args) => {
        if (args[1] !== "show") return JSON.stringify(token());
        shows++;
        return JSON.stringify(
          when === "during-acquisition" && shows === 1
            ? account
            : {
                ...account,
                user: { ...account.user, name: "different@example.test" },
              },
        );
      });
      await expect(f.invoke(request, signal())).rejects.toMatchObject({
        reason: "identity-mismatch",
      });
      expect(f.read).toHaveBeenCalledTimes(when === "cached-token" ? 1 : 0);
    },
  );
  it.each([
    ["audience", { aud: "https://management.azure.com/" }, {}],
    ["identity", { upn: "different@example.test" }, {}],
    ["tenant", { tid: "33333333-3333-4333-8333-333333333333" }, {}],
    ["missing identity", { upn: undefined }, {}],
    ["expired claims", { exp: now / 1000 - 1 }, {}],
    ["expired metadata", {}, { expires_on: now / 1000 - 1 }],
    ["missing expiry", {}, { expires_on: undefined }],
    ["wrong token type", {}, { tokenType: "Basic" }],
    ["missing token", {}, { accessToken: undefined }],
    ["malformed token", {}, { accessToken: "fixture-not-a-token" }],
  ])(
    "rejects %s without remote reads or raw credential errors",
    async (_label, claims, metadata) => {
      const f = fixture();
      f.execute.mockImplementation(async (args) =>
        JSON.stringify(args[1] === "show" ? account : token(claims, metadata)),
      );
      await expect(f.invoke(request, signal())).rejects.toMatchObject({
        reason: "invalid-token",
      });
      expect(f.read).not.toHaveBeenCalled();
    },
  );
  it("redacts failed subprocess output and never retries login or a rejected HTTP credential", async () => {
    const f = fixture();
    f.execute.mockRejectedValue(
      new Error("raw-credential-in-subprocess-stderr"),
    );
    let failure: unknown;
    try {
      await f.invoke(request, signal());
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(OrchestrationAzureCliAuthError);
    expect(String(failure)).not.toContain("raw-credential");
    expect(failure).not.toHaveProperty("cause");
    expect(f.execute).toHaveBeenCalledOnce();
    f.execute.mockImplementation(async (args) =>
      JSON.stringify(args[1] === "show" ? account : token()),
    );
    f.read.mockResolvedValue({ status: 401, body: { value: [] } });
    await expect(f.invoke(request, signal())).rejects.toMatchObject({
      reason: "access-denied",
    });
    expect(f.read).toHaveBeenCalledOnce();
  });
  it("sends a Bearer header through the production read-only ADO transport and rejects mutations", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response('{"value":[]}', { status: 200 }),
    );
    vi.stubGlobal("fetch", fetch);
    const f = fixture();
    const invoke = createOrchestrationAzureCliReadTransport(
      { expectedIdentity: account.user.name },
      { execute: f.execute, now: () => now },
    );
    await invoke(request, signal());
    expect(fetch).toHaveBeenCalledOnce();
    const sent = fetch.mock.calls[0]!;
    expect(String(sent[0])).toBe(request.url);
    expect(sent[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify(request.body),
      redirect: "error",
    });
    const authorization = new Headers(sent[1]?.headers).get("authorization");
    expect(authorization?.startsWith("Bearer ")).toBe(true);
    expect(authorization?.slice(7) === token().accessToken).toBe(true);
    await expect(
      invoke(
        {
          ...request,
          url: "https://dev.azure.com/org/proj/_apis/wit/workitems",
        },
        signal(),
      ),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("requires explicit ADO-only revisioned selection and retains the legacy PAT default without fallback", () => {
    const source = {
      id: "fixture",
      projectId: "api",
      hub: {
        kind: "ado",
        organization: "org",
        project: "proj",
        repository: "repo",
      },
      selector: { assignedTo: account.user.name },
    };
    vi.stubEnv("AZURE_DEVOPS_EXT_PAT", "");
    const legacy = workspaceDiscoverySourceSchema.parse(source);
    expect(workspaceDiscoveryTransport(legacy)).toBeUndefined();
    const authentication = {
      kind: "azure-cli",
      expectedIdentity: account.user.name,
    };
    const explicit = workspaceDiscoverySourceSchema.parse({
      ...source,
      authentication,
    });
    expect(workspaceDiscoveryTransport(explicit)).toBeTypeOf("function");
    vi.stubEnv("AZURE_DEVOPS_EXT_PAT", "fixture-pat");
    expect(workspaceDiscoveryTransport(legacy)).toBeTypeOf("function");
    expect(workspaceDiscoveryTransport(explicit)).toBe(
      workspaceDiscoveryTransport(explicit),
    );
    expect(() =>
      workspaceDiscoverySourceSchema.parse({
        ...source,
        hub: { kind: "github", repository: "fixture/api" },
        authentication,
      }),
    ).toThrow();
    expect(() =>
      workspaceDiscoverySourceSchema.parse({
        ...source,
        authentication: { ...authentication, token: "not-configurable" },
      }),
    ).toThrow();
  });
  it("honors cancellation before reading an account or using a cached token", async () => {
    const f = fixture();
    const abort = new AbortController();
    abort.abort();
    await expect(f.invoke(request, abort.signal)).rejects.toThrow();
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.read).not.toHaveBeenCalled();
  });
});
