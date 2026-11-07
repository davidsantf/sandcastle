import { describe, expect, it, vi } from "vitest";
import {
  createCoworkNativeItemHost,
  type CoworkNativeItemTransport,
} from "./CoworkNativeItems.js";
import { coworkDigest } from "./CoworkFactoryContract.js";

const signal = () => new AbortController().signal;
const policy = {
  authorize: async () => true,
  verifyEvidence: async () => true,
  audit: async () => true,
  verifyReceipt: async () => true,
};
describe("native issue mappings (injected transport; no live writes)", () => {
  it("maps GitHub issue JSON and binds the native receipt to the exact configured target", async () => {
    const request = vi.fn<CoworkNativeItemTransport["request"]>(async () => ({
      number: 42,
      html_url: "https://github.com/example/app/issues/42",
    }));
    const host = createCoworkNativeItemHost({
      ...policy,
      transport: { request },
    });
    const target = { provider: "github" as const, repository: "example/app" };
    const intent = "a".repeat(64);
    const result = await host.create(
      { ...target, title: "Match API", body: "Protected assertions" },
      intent,
      signal(),
    );
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      provider: "github",
      method: "POST",
      url: "https://api.github.com/repos/example/app/issues",
      body: { title: "Match API", body: "Protected assertions" },
      intent,
    });
    expect(result).toEqual({
      state: "completed",
      receipt: {
        id: "42",
        url: "https://github.com/example/app/issues/42",
        intent,
        targetDigest: coworkDigest(target),
      },
    });
  });
  it("maps ADO fields into JSON Patch without exposing transport credentials", async () => {
    const request = vi.fn<CoworkNativeItemTransport["request"]>(async () => ({
      id: 43,
    }));
    const host = createCoworkNativeItemHost({
      ...policy,
      transport: { request },
    });
    const result = await host.create(
      {
        provider: "azure-devops",
        organization: "example",
        project: "app",
        workItemType: "Task",
        fields: {
          "System.Title": "Match API",
          "System.Description": "Protected assertions",
        },
      },
      "b".repeat(64),
      signal(),
    );
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      method: "PATCH",
      contentType: "application/json-patch+json",
      url: "https://dev.azure.com/example/app/_apis/wit/workitems/$Task?api-version=7.1",
      body: [
        { op: "add", path: "/fields/System.Title", value: "Match API" },
        {
          op: "add",
          path: "/fields/System.Description",
          value: "Protected assertions",
        },
      ],
    });
    expect(result.state).toBe("completed");
    expect(JSON.stringify(request.mock.calls)).not.toMatch(
      /authorization|password|token/i,
    );
  });
  it.each([
    null,
    {},
    { number: 0 },
    { number: 42, html_url: "https://github.com/foreign/app/issues/42" },
  ])(
    "does not invent a successful issue receipt from malformed or foreign native JSON",
    async (reply) => {
      const host = createCoworkNativeItemHost({
        ...policy,
        transport: { request: async () => reply },
      });
      expect(
        await host.create(
          {
            provider: "github",
            repository: "example/app",
            title: "Match",
            body: "Contract",
          },
          "a".repeat(64),
          signal(),
        ),
      ).toEqual({ state: "unknown" });
    },
  );
  it("rejects credential-bearing and non-HTTPS configured hosts", () => {
    for (const githubApiUrl of [
      "http://api.example.invalid",
      "https://secret@api.example.invalid",
    ])
      expect(() =>
        createCoworkNativeItemHost({
          ...policy,
          githubApiUrl,
          transport: { request: async () => null },
        }),
      ).toThrow(/Credential-free/);
  });
});
