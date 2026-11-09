import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  OrchestrationWorkspaceStore,
  initializeWorkspace,
  readWorkspaceConfiguration,
  updateWorkspaceConfiguration,
  registerWorkspaceProject,
  removeWorkspaceProject,
  registerWorkspaceRoute,
  removeWorkspaceRoute,
} from "./OrchestrationWorkspace.js";
import { parseWorkspaceConfiguration } from "./OrchestrationWorkspaceContract.js";
import { digest, parseOrchestrationCatalog } from "./MultiProjectProtocol.js";
import { MultiProjectJournal } from "./MultiProjectJournal.js";
import {
  createGitHubOrchestrationHub,
  createAdoOrchestrationHub,
} from "./MultiProjectHubs.js";

const stores: OrchestrationWorkspaceStore[] = [],
  folders: string[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const folder of folders.splice(0))
    fs.rmSync(folder, { recursive: true, force: true });
});
const setup = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-"));
  folders.push(directory);
  const filename = path.join(directory, "orchestration.sqlite");
  const store = new OrchestrationWorkspaceStore(filename);
  stores.push(store);
  return { directory, filename, store };
};
const project = (id: string, root: string) => ({
  id,
  repositoryRoot: root,
  mode: "integrated" as const,
  hub: { kind: "github" as const, repository: `fixture/${id}` },
});
const route = {
  id: "api-client",
  version: 1,
  producer: "api",
  consumer: "app",
  contract: "api",
  consumedDigest: "1".repeat(64),
  scopes: ["src/client"],
  baseBranch: "main",
  acceptance: [{ label: "test", command: "npm test" }],
  maxDepth: 3,
  maxTasks: 10,
};

describe("versioned orchestration workspace", () => {
  it("initializes empty and registers without unrelated PRs; removals never touch repositories", () => {
    const f = setup();
    expect(initializeWorkspace(f.store).projects).toEqual([]);
    fs.mkdirSync(path.join(f.directory, "api"));
    fs.mkdirSync(path.join(f.directory, "app"));
    registerWorkspaceProject(
      f.store,
      1,
      project("api", path.join(f.directory, "api")),
    );
    registerWorkspaceProject(
      f.store,
      2,
      project("app", path.join(f.directory, "app")),
    );
    registerWorkspaceRoute(f.store, 3, route);
    expect(() => removeWorkspaceProject(f.store, 4, "api")).toThrow("routes");
    removeWorkspaceRoute(f.store, 4, route.id);
    removeWorkspaceProject(f.store, 5, "api");
    expect(fs.existsSync(path.join(f.directory, "api"))).toBe(true);
    expect(
      readWorkspaceConfiguration(f.store).projects.map((p) => p.id),
    ).toEqual(["app"]);
    expect(() => updateWorkspaceConfiguration(f.store, 1, (c) => c)).toThrow(
      "changed",
    );
  });
  it("rejects aliases, cycles, unknown focus and altered workspace identity", () => {
    const f = setup(),
      config = initializeWorkspace(f.store);
    const a = project("api", path.join(f.directory, "api")),
      b = project("app", path.join(f.directory, "app"));
    expect(() =>
      parseWorkspaceConfiguration({
        ...config,
        projects: [a, { ...b, repositoryRoot: a.repositoryRoot }],
      }),
    ).toThrow("alias");
    expect(() =>
      parseWorkspaceConfiguration({
        ...config,
        projects: [a, b],
        routes: [
          route,
          { ...route, id: "back", producer: "app", consumer: "api" },
        ],
      }),
    ).toThrow("cycle");
    expect(() =>
      parseWorkspaceConfiguration({
        ...config,
        focus: { ...config.focus, projectIds: ["missing"] },
      }),
    ).toThrow("unregistered");
    expect(() =>
      updateWorkspaceConfiguration(f.store, 1, (c) => ({
        ...c,
        id: "different",
      })),
    ).toThrow("immutable");
    expect(f.store.events()).toHaveLength(1);
  });
  it("shares the core SQLite file and retains CAS/evidence after reopen", () => {
    const f = setup();
    initializeWorkspace(f.store);
    const journal = new MultiProjectJournal(f.filename);
    const lease = journal.claim(30000);
    journal.initialize(
      parseOrchestrationCatalog({ id: "empty", projects: [], tasks: [] }),
      lease,
    );
    journal.release(lease);
    journal.close();
    expect(
      f.store.compareAndSwap(
        "proposal:one",
        0,
        { status: "proposed" },
        { kind: "proposal-created", at: new Date().toISOString() },
      ),
    ).toBe(true);
    expect(
      f.store.compareAndSwap(
        "proposal:one",
        0,
        { status: "other" },
        { kind: "proposal-created", at: new Date().toISOString() },
      ),
    ).toBe(false);
    f.store.close();
    stores.splice(stores.indexOf(f.store), 1);
    const reopened = new OrchestrationWorkspaceStore(f.filename);
    stores.push(reopened);
    expect(reopened.read("proposal:one")).toMatchObject({
      version: 1,
      value: { status: "proposed" },
    });
    expect(reopened.events()).toHaveLength(2);
  });
  it("atomically fences stale owners and configuration guards before writing any projection/event", () => {
    const f = setup(),
      config = initializeWorkspace(f.store);
    const event = { kind: "ownership", at: new Date().toISOString() };
    const owner = { ownerId: "one" };
    f.store.compareAndSwap("service:owner", 0, owner, event);
    const guarded = f.store
      .withGuard({
        key: "service:owner",
        version: 1,
        valueDigest: digest(owner),
      })
      .withGuard({
        key: "workspace:configuration",
        version: 1,
        valueDigest: digest(config),
      });
    expect(
      guarded.compareAndSwap("work:one", 0, { state: "reserved" }, event),
    ).toBe(true);
    updateWorkspaceConfiguration(f.store, 1, (c) => ({
      ...c,
      pollIntervalMs: 2000,
    }));
    expect(() =>
      guarded.compareAndSwap("work:two", 0, { state: "reserved" }, event),
    ).toThrow("stale");
    expect(f.store.read("work:two").version).toBe(0);
    const before = f.store.events().length;
    f.store.compareAndSwap("service:owner", 1, { ownerId: "two" }, event);
    expect(() =>
      guarded.compareAndSwap("work:one", 1, { state: "completed" }, event),
    ).toThrow("stale");
    expect(f.store.events().length).toBe(before + 1);
    expect(f.store.read("work:one").value).toEqual({ state: "reserved" });
  });
  it("rejects malformed/unbounded records before durable mutation", () => {
    const f = setup(),
      event = { kind: "test", at: new Date().toISOString() };
    expect(() => f.store.compareAndSwap("bad key", 0, {}, event)).toThrow();
    expect(() =>
      f.store.compareAndSwap("good:key", 0, { fn: () => true }, event),
    ).toThrow("JSON");
    expect(() =>
      f.store.compareAndSwap("good:key", 0, "a".repeat(1_048_577), event),
    ).toThrow("byte");
    expect(f.store.events()).toEqual([]);
  });
  it("does not call undefined provider PR endpoints when a project has no PR", async () => {
    const f = setup(),
      p = project("api", f.directory);
    const transport = async () => {
      throw new Error("transport must not run");
    };
    const github = await createGitHubOrchestrationHub(transport)(
      p,
      new AbortController().signal,
    );
    const ado = await createAdoOrchestrationHub(transport)(
      {
        ...p,
        hub: {
          kind: "ado",
          organization: "fixture",
          project: "api",
          repository: "api",
        },
      },
      new AbortController().signal,
    );
    expect(github.policiesKnown).toBe(false);
    expect(ado.policiesKnown).toBe(false);
    expect(github.diagnostic).toContain("registration");
    expect(
      parseOrchestrationCatalog({ id: "no-pr", projects: [p], tasks: [] }),
    ).toMatchObject({ tasks: [] });
  });
});
