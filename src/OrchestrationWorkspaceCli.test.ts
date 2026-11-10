import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  initializeWorkspace,
  OrchestrationWorkspaceStore,
  updateWorkspaceConfiguration,
} from "./OrchestrationWorkspace.js";
import { createOrchestrationNativeTick } from "./OrchestrationNativeHost.js";
import { OrchestrationDiscoveryError } from "./OrchestrationDiscovery.js";
import { evaluateOrchestrationFocus } from "./OrchestrationFocus.js";

const cli = path.resolve("dist", "main.js");
const invoke = (database: string, command: string, ...args: string[]) => {
  try {
    return JSON.parse(
      execFileSync(
        process.execPath,
        [
          cli,
          "orchestrate",
          "workspace",
          command,
          "--database",
          database,
          ...args,
        ],
        {
          encoding: "utf8",
          timeout: 20_000,
          stdio: ["ignore", "pipe", "pipe"],
        },
      ),
    ) as Record<string, unknown>;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "stdout" in error &&
      "stderr" in error
    )
      throw new Error(
        `${command}: ${String(error.stdout)}\n${String(error.stderr)}`,
        { cause: error },
      );
    throw error;
  }
};

describe("compiled workspace CLI", () => {
  it("rearms one failed read under the current configuration without deleting its cursor or failure history", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "workspace-retry-"),
    );
    const database = path.join(directory, "state.sqlite");
    const store = new OrchestrationWorkspaceStore(database);
    try {
      initializeWorkspace(store);
      const hub = { kind: "github" as const, repository: "fixture/project" };
      const configuration = updateWorkspaceConfiguration(
        store,
        1,
        (config) => ({
          ...config,
          projects: [
            {
              id: "fixture",
              repositoryRoot: process.cwd(),
              mode: "individual",
              hub,
            },
          ],
          discovery: [
            {
              id: "read",
              projectId: "fixture",
              hub,
              selector: { assignedTo: "owner" },
              pageSize: 10,
              maxPages: 1,
              includeReviewFeedback: false,
              includeDependencies: false,
            },
          ],
          focus: {
            ...config.focus,
            projectIds: ["fixture"],
            permissions: [{ projectId: "fixture", action: "discover" }],
          },
        }),
      );
      await createOrchestrationNativeTick({
        evaluateFocus: evaluateOrchestrationFocus,
        transport: () => async () => {
          throw new OrchestrationDiscoveryError("access", 0);
        },
      })({
        configuration,
        store,
        signal: new AbortController().signal,
        operations: {
          perform: async () => {
            throw new Error("Observe cannot perform an effect");
          },
        },
      });
      expect(() =>
        invoke(database, "discovery-retry", "--revision", "1", "--id", "read"),
      ).toThrow();
      expect(
        invoke(database, "discovery-retry", "--revision", "2", "--id", "read"),
      ).toEqual({
        sourceId: "read",
        configurationRevision: 2,
        status: "retry-armed",
      });
      expect(() =>
        invoke(database, "discovery-retry", "--revision", "2", "--id", "read"),
      ).toThrow();
      const events = store.events();
      expect(
        events.some((event) => event.kind === "intake-poll-completed"),
      ).toBe(true);
      expect(
        events.filter((event) => event.kind === "intake-poll-operator-retry"),
      ).toHaveLength(1);
      const key = events.find(
        (event) => event.kind === "intake-poll-operator-retry",
      )!.key;
      expect(store.read(key).value).toMatchObject({
        attempt: 1,
        cursor: null,
        failures: 0,
      });
    } finally {
      store.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
  it("persists validated execution controls by exact runtime revision without broadening focus", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "workspace-controls-"),
    );
    try {
      const database = path.join(directory, "state.sqlite");
      const initial = invoke(database, "init");
      const runtime = initial.runtime as Record<string, unknown>;
      const executionControls = {
        profile: "local-files",
        maxAiCredits: 30,
        maxAutopilotContinues: 0,
        timeoutMs: 240000,
        disabledMcpServers: ["fixture-server"],
      };
      const file = path.join(directory, "runtime.json");
      fs.writeFileSync(file, JSON.stringify({ ...runtime, executionControls }));
      const updated = invoke(
        database,
        "runtime",
        "--revision",
        "1",
        "--file",
        file,
      );
      expect(updated.runtime).toHaveProperty(
        "executionControls",
        executionControls,
      );
      expect(updated.focus).toMatchObject({ mode: "observe", permissions: [] });
      expect(() =>
        invoke(database, "runtime", "--revision", "1", "--file", file),
      ).toThrow();
      fs.writeFileSync(
        file,
        JSON.stringify({
          ...runtime,
          executionControls: {
            ...executionControls,
            availableTools: ["shell"],
          },
        }),
      );
      expect(() =>
        invoke(database, "runtime", "--revision", "2", "--file", file),
      ).toThrow();
      expect(invoke(database, "list")).toHaveProperty("revision", 2);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
  it("persists trusted-local only by explicit revisioned runtime edit without granting permissions", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "workspace-trust-"),
    );
    try {
      const database = path.join(directory, "state.sqlite");
      const initial = invoke(database, "init");
      expect(initial.runtime).not.toHaveProperty("executionTrust");
      const runtime = initial.runtime as Record<string, unknown>;
      const file = path.join(directory, "runtime.json");
      fs.writeFileSync(
        file,
        JSON.stringify({ ...runtime, executionTrust: "trusted-local" }),
      );
      const local = invoke(
        database,
        "runtime",
        "--revision",
        "1",
        "--file",
        file,
      );
      expect(local.runtime).toHaveProperty("executionTrust", "trusted-local");
      expect(local.focus).toMatchObject({ mode: "observe", permissions: [] });
      expect(() =>
        invoke(database, "runtime", "--revision", "1", "--file", file),
      ).toThrow();
      fs.writeFileSync(
        file,
        JSON.stringify({ ...runtime, executionTrust: "worker-verified" }),
      );
      expect(() => invoke(database, "runtime", "--file", file)).toThrow();
      fs.writeFileSync(file, JSON.stringify(runtime));
      expect(
        invoke(database, "runtime", "--revision", "2", "--file", file).runtime,
      ).not.toHaveProperty("executionTrust");
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
  it("onboards repositories without PRs, persists routes and focus, rejects stale edits and removes registrations only", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-cli-"));
    try {
      const database = path.join(directory, "state.sqlite");
      const api = path.join(directory, "api");
      const app = path.join(directory, "app");
      for (const [id, root] of [
        ["api", api],
        ["app", app],
      ]) {
        fs.mkdirSync(root!);
        execFileSync("git", ["init", "-b", "main", root!], { stdio: "pipe" });
        execFileSync(
          "git",
          ["remote", "add", "origin", `https://github.com/fixture/${id}.git`],
          { cwd: root!, stdio: "pipe" },
        );
      }
      const initial = invoke(database, "init", "--id", "sample");
      expect(initial.projects).toEqual([]);
      invoke(
        database,
        "add",
        "--id",
        "api",
        "--repository-root",
        api,
        "--github",
        "fixture/api",
        "--mode",
        "integrated",
      );
      invoke(
        database,
        "add",
        "--id",
        "app",
        "--repository-root",
        app,
        "--github",
        "fixture/app",
        "--mode",
        "integrated",
      );
      const config = invoke(database, "list");
      expect(config.revision).toBe(3);
      expect(JSON.stringify(config.projects)).not.toContain("pullRequest");
      expect(() =>
        invoke(database, "remove", "--id", "app", "--revision", "1"),
      ).toThrow();
      const routeFile = path.join(directory, "route.json");
      fs.writeFileSync(
        routeFile,
        JSON.stringify({
          id: "api-client",
          version: 1,
          producer: "api",
          consumer: "app",
          contract: "api",
          consumedDigest: "1".repeat(64),
          scopes: ["src/client"],
          baseBranch: "main",
          acceptance: [{ label: "unit", command: "npm test" }],
          maxDepth: 3,
          maxTasks: 10,
        }),
      );
      invoke(database, "route-add", "--file", routeFile);
      expect(() => invoke(database, "remove", "--id", "api")).toThrow();
      const focusFile = path.join(directory, "focus.json");
      fs.writeFileSync(
        focusFile,
        JSON.stringify({
          ...(config.focus as Record<string, unknown>),
          projectIds: ["api", "app"],
          priorities: { api: 10 },
          permissions: [{ projectId: "api", action: "discover" }],
        }),
      );
      invoke(database, "focus", "--file", focusFile);
      invoke(database, "route-remove", "--id", "api-client");
      const removed = invoke(database, "remove", "--id", "api");
      expect(removed.projects as unknown[]).toHaveLength(1);
      expect(fs.existsSync(path.join(api, ".git"))).toBe(true);
      expect((removed.focus as { permissions: unknown[] }).permissions).toEqual(
        [],
      );
      const history = invoke(database, "events");
      expect(Array.isArray(history)).toBe(true);
      expect((history as unknown as unknown[]).length).toBeGreaterThan(5);
      expect(() => invoke(database, "validate")).toThrow();
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
  it("rejects a plain directory, conflicting provider options and unknown JSON authority fields", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "workspace-cli-negative-"),
    );
    try {
      const database = path.join(directory, "state.sqlite");
      invoke(database, "init");
      expect(() =>
        invoke(
          database,
          "add",
          "--id",
          "bad",
          "--repository-root",
          directory,
          "--github",
          "fixture/bad",
        ),
      ).toThrow();
      expect(() =>
        invoke(
          database,
          "add",
          "--id",
          "bad",
          "--repository-root",
          directory,
          "--github",
          "fixture/bad",
          "--ado-project",
          "bad",
        ),
      ).toThrow();
      const file = path.join(directory, "focus.json");
      fs.writeFileSync(
        file,
        JSON.stringify({
          ...(invoke(database, "list").focus as object),
          authorizeEverything: true,
        }),
      );
      expect(() => invoke(database, "focus", "--file", file)).toThrow();
      expect(invoke(database, "list").revision).toBe(1);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
