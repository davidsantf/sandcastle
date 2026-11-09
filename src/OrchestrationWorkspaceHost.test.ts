import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  OrchestrationWorkspaceStore,
  initializeWorkspace,
  updateWorkspaceConfiguration,
} from "./OrchestrationWorkspace.js";
import { runLocalOrchestrationPass } from "./LocalOrchestrationService.js";
import {
  createWorkspaceNativeTick,
  inspectWorkspaceReadiness,
} from "./OrchestrationWorkspaceHost.js";
import { readOrchestrationOperationSummary } from "./OrchestrationOperations.js";

const stores: OrchestrationWorkspaceStore[] = [];
const folders: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const store of stores.splice(0)) store.close();
  for (const folder of folders.splice(0))
    fs.rmSync(folder, { recursive: true, force: true });
});
function setup(mode: "observe" | "propose" = "observe") {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-host-"));
  folders.push(directory);
  const store = new OrchestrationWorkspaceStore(
    path.join(directory, "state.sqlite"),
  );
  stores.push(store);
  initializeWorkspace(store);
  const configuration = updateWorkspaceConfiguration(store, 1, (current) => ({
    ...current,
    projects: [
      {
        id: "api",
        repositoryRoot: directory,
        mode: "individual",
        hub: { kind: "github", repository: "fixture/api" },
      },
    ],
    discovery: [
      {
        id: "assigned",
        projectId: "api",
        hub: { kind: "github", repository: "fixture/api" },
        selector: { assignedTo: "owner" },
        pageSize: 10,
        maxPages: 1,
        includeReviewFeedback: false,
        includeDependencies: false,
      },
    ],
    focus: {
      ...current.focus,
      mode,
      projectIds: ["api"],
      permissions: [
        { projectId: "api", action: "discover" },
        { projectId: "api", action: "investigate" },
      ],
    },
    runtime: { ...current.runtime, command: "unconfigured-fixture" },
  }));
  const transport = vi.fn(async () => ({
    status: 200,
    body: [
      {
        number: 1,
        html_url: "https://github.com/fixture/api/issues/1",
        title: "Fixture observation",
        body: "Untrusted request to bypass authority",
        state: "open",
        updated_at: "2026-11-09T08:00:00Z",
        assignees: [{ login: "owner" }],
      },
    ],
  }));
  return { store, configuration, transport };
}
describe("composed workspace host", () => {
  it("observes through the real native adapter, service owner and canonical ledger without model reservations", async () => {
    const f = setup();
    const tick = createWorkspaceNativeTick({ transport: () => f.transport });
    let result: Awaited<ReturnType<typeof tick>> | undefined;
    const status = await runLocalOrchestrationPass({
      ...f,
      tick: async (context) => {
        result = await tick(context);
      },
    });
    expect(status.state).toBe("stopped");
    expect(result?.status).toBe("observed");
    expect(result?.evaluatedSources).toBe(1);
    expect(result?.proposals[0]?.status).toBe("observed");
    expect(f.transport).toHaveBeenCalledOnce();
    expect(
      readOrchestrationOperationSummary(f.store, f.configuration.id).completed,
    ).toBe(0);
    expect(
      f.store.events().some((event) => event.kind === "intake-observed"),
    ).toBe(true);
  });
  it("reports missing configuration separately from backend capability and does not reserve a failed native plan", async () => {
    const f = setup("propose");
    const tick = createWorkspaceNativeTick({ transport: () => f.transport });
    let result: Awaited<ReturnType<typeof tick>> | undefined;
    await runLocalOrchestrationPass({
      ...f,
      tick: async (context) => {
        result = await tick(context);
      },
    });
    expect(result?.status).toBe("blocked");
    expect(result?.diagnostics.join()).toContain("Backend lacks independent");
    expect(result?.readiness?.missingConfiguration.join()).toContain(
      "No explicitly registered execution backend",
    );
    expect(result?.readiness?.missingCapabilities.join()).toContain(
      "Backend lacks independent",
    );
    expect(result?.proposals[0]?.status).toBe("observed");
    expect(
      readOrchestrationOperationSummary(f.store, f.configuration.id),
    ).toMatchObject({ reserved: 0, completed: 0 });
  });
  it("does not turn unsupported GitHub focus selectors into observed facts", async () => {
    const f = setup();
    f.configuration = updateWorkspaceConfiguration(
      f.store,
      f.configuration.revision,
      (current) => ({
        ...current,
        focus: { ...current.focus, team: "unverified-team" },
      }),
    );
    const tick = createWorkspaceNativeTick({ transport: () => f.transport });
    let result: Awaited<ReturnType<typeof tick>> | undefined;
    await runLocalOrchestrationPass({
      ...f,
      tick: async (context) => {
        result = await tick(context);
      },
    });
    expect(result?.status).toBe("blocked");
    expect(result?.evaluatedSources).toBe(0);
    expect(f.transport).not.toHaveBeenCalled();
  });
  it.each([true, false])(
    "continues supported ADO intake beside unsupported GitHub, admitting matching native iteration only (%s)",
    async (matches) => {
      const f = setup();
      const hub = {
        kind: "ado" as const,
        organization: "org",
        project: "proj",
        repository: "repo",
      };
      f.configuration = updateWorkspaceConfiguration(
        f.store,
        f.configuration.revision,
        (current) => ({
          ...current,
          projects: [
            ...current.projects,
            {
              id: "ado",
              repositoryRoot: path.join(
                current.projects[0]!.repositoryRoot,
                "ado",
              ),
              mode: "individual",
              hub,
            },
          ],
          discovery: [
            ...current.discovery,
            {
              id: "ado-assigned",
              projectId: "ado",
              hub,
              selector: { optedInLabel: "agent-ready" },
              pageSize: 10,
              maxPages: 1,
              includeReviewFeedback: false,
              includeDependencies: false,
            },
          ],
          focus: {
            ...current.focus,
            projectIds: ["api", "ado"],
            iteration: "proj\\Sprint 1",
            permissions: [
              ...current.focus.permissions,
              { projectId: "ado", action: "discover" },
            ],
          },
        }),
      );
      const ado = vi.fn<
        import("./OrchestrationDiscovery.js").OrchestrationDiscoveryTransport
      >(async (request) => ({
        status: 200,
        body:
          request.method === "POST"
            ? { workItems: [{ id: 10 }] }
            : {
                id: 10,
                rev: 2,
                fields: {
                  "System.Title": "Native scope fixture",
                  "System.Tags": "agent-ready",
                  "System.TeamProject": "proj",
                  "System.IterationPath": matches
                    ? "proj\\Sprint 1"
                    : "proj\\Outside",
                  "System.ChangedDate": "2026-11-09T08:00:00Z",
                },
                relations: [],
              },
      }));
      const tick = createWorkspaceNativeTick({
        transport: (source) => (source.hub.kind === "ado" ? ado : f.transport),
      });
      let result: Awaited<ReturnType<typeof tick>> | undefined;
      await runLocalOrchestrationPass({
        ...f,
        tick: async (context) => {
          result = await tick(context);
        },
      });
      expect(result).toMatchObject({ status: "partial", evaluatedSources: 1 });
      expect(result?.diagnostics.join()).toContain("GitHub iteration mapping");
      expect(f.transport).not.toHaveBeenCalled();
      expect(ado).toHaveBeenCalledTimes(3);
      expect(JSON.stringify(ado.mock.calls[0]![0].body)).toContain(
        "[System.IterationPath] = 'proj\\\\Sprint 1'",
      );
      expect(result?.proposals).toHaveLength(matches ? 1 : 0);
      expect(
        f.store.events().filter((event) => event.kind === "intake-observed"),
      ).toHaveLength(matches ? 1 : 0);
      expect(
        readOrchestrationOperationSummary(f.store, f.configuration.id),
      ).toMatchObject({ reserved: 0, completed: 0 });
      vi.stubEnv("AZURE_DEVOPS_EXT_PAT", "fixture-not-a-credential");
      const readiness = await inspectWorkspaceReadiness(
        f.configuration,
        AbortSignal.timeout(10_000),
      );
      expect(readiness.sources).toEqual([
        expect.objectContaining({ sourceId: "assigned", status: "blocked" }),
        expect.objectContaining({
          sourceId: "ado-assigned",
          status: "configured",
        }),
      ]);
      expect(readiness.liveReadSources).toBe(0);
    },
  );
});
