import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runMultiProjectEntrypoint } from "./MultiProjectEntrypoint.js";
import {
  OrchestrationWorkspaceStore,
  initializeWorkspace,
  updateWorkspaceConfiguration,
} from "./OrchestrationWorkspace.js";
import {
  startLocalOrchestrationService,
  type LocalOrchestrationServiceHandle,
} from "./LocalOrchestrationService.js";

const stores: OrchestrationWorkspaceStore[] = [];
const folders: string[] = [];
const services: LocalOrchestrationServiceHandle[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) await service.stop();
  for (const store of stores.splice(0)) store.close();
  for (const folder of folders.splice(0))
    fs.rmSync(folder, { recursive: true, force: true });
});
const setup = (withTask = false, bind = false, changeConfiguration = false) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "legacy-workspace-"));
  folders.push(directory);
  const database = path.join(directory, "orchestration.sqlite");
  const store = new OrchestrationWorkspaceStore(database);
  stores.push(store);
  const configuration = initializeWorkspace(store);
  const catalog = {
    id: "legacy",
    projects: withTask
      ? [
          {
            id: "api",
            repositoryRoot: directory,
            mode: "individual",
            hub: { kind: "github", repository: "fixture/api" },
          },
        ]
      : [],
    tasks: withTask
      ? [
          {
            id: "work",
            projectId: "api",
            title: "Work",
            brief: "Local fixture",
            branch: "agent/work",
            baseBranch: "main",
            scopes: ["src"],
            acceptance: [{ label: "unit", command: "unused" }],
          },
        ]
      : [],
  };
  const config = path.join(directory, "host.mjs");
  fs.writeFileSync(
    config,
    `${changeConfiguration ? `import {OrchestrationWorkspaceStore,readWorkspaceConfiguration,updateWorkspaceConfiguration} from ${JSON.stringify(pathToFileURL(path.resolve("dist", "index.js")).href)};` : ""}
  export default {
    catalog:${JSON.stringify(catalog)},journalPath:${JSON.stringify(database)},
    host:{
      ${bind ? "bindRun(){return {...this,authorize:async()=>true};}," : ""}
      authorize:async()=>{${
        changeConfiguration
          ? `
        const store=new OrchestrationWorkspaceStore(${JSON.stringify(database)});
        try {
          const current=readWorkspaceConfiguration(store);
          updateWorkspaceConfiguration(store,current.revision,value=>({...value,focus:{...value.focus,permissions:[]}}));
        } finally {store.close();}
      `
          : ""
      }return true;},
      resolveRevision:async()=>"${"a".repeat(40)}",
      execute:async()=>{throw new Error("worker must not run");},
      validate:async()=>{throw new Error("validation must not run");},
      observe:async()=>{throw new Error("hub must not run");}
    }
  };`,
  );
  return { store, configuration, config, directory };
};
describe("legacy explicit-host manual ownership", () => {
  it("preserves prototype methods and their original receiver through the workspace gate", async () => {
    const f = setup();
    fs.writeFileSync(
      f.config,
      `
      class Host {
        #revision = "${"a".repeat(40)}";
        async authorize(){return false;}
        async resolveRevision(){return this.#revision;}
        async execute(){throw new Error("worker must not run");}
        async validate(){throw new Error("validation must not run");}
        async observe(){throw new Error("hub must not run");}
        async beforeTasks(){return {
          state:"passed",revision:this.#revision,evaluatedScope:1,
          checks:[{name:"fixture",state:"passed",required:true,revision:this.#revision,evidence:"Prototype receiver verified"}],
          evidence:"Local host prototype fixture only"
        };}
      }
      export default {catalog:{id:"legacy",projects:[],tasks:[]},journalPath:${JSON.stringify(path.join(f.directory, "orchestration.sqlite"))},host:new Host()};
    `,
    );
    const result = await runMultiProjectEntrypoint({ config: f.config });
    expect(result.status).toBe("completed");
    expect(result.evaluatedChecks).toBe(1);
  });
  it("shares the service owner before opening a core pass, and runs after graceful stop", async () => {
    const f = setup();
    const service = await startLocalOrchestrationService({
      configuration: f.configuration,
      store: f.store,
      tick: async () => undefined,
    });
    services.push(service);
    await expect(
      runMultiProjectEntrypoint({ config: f.config }),
    ).rejects.toThrow("service-already-owned");
    await service.stop();
    const result = await runMultiProjectEntrypoint({ config: f.config });
    expect(result.status).toBe("completed");
    expect(result.dispatched).toBe(0);
  });
  it("does not bypass an existing workspace focus through a trusted-host manual entrypoint", async () => {
    const f = setup(true);
    const result = await runMultiProjectEntrypoint({ config: f.config });
    expect(result.status).toBe("needs-input");
    expect(result.dispatched).toBe(0);
    expect(result.tasks[0]?.reason).toContain("authorization denied");
  });
  it("retains the workspace dispatch gate after a trusted host binds its run", async () => {
    const f = setup(true, true);
    const result = await runMultiProjectEntrypoint({ config: f.config });
    expect(result.status).toBe("needs-input");
    expect(result.dispatched).toBe(0);
    expect(result.tasks[0]?.reason).toContain("authorization denied");
  });
  it("fences an old manual admission when configuration changes during host authorization", async () => {
    const f = setup(true, false, true);
    updateWorkspaceConfiguration(
      f.store,
      f.configuration.revision,
      (current) => ({
        ...current,
        projects: [
          {
            id: "api",
            repositoryRoot: f.directory,
            mode: "individual",
            hub: { kind: "github", repository: "fixture/api" },
          },
        ],
        focus: {
          ...current.focus,
          mode: "propose",
          projectIds: ["api"],
          permissions: [{ projectId: "api", action: "investigate" }],
        },
      }),
    );
    const result = await runMultiProjectEntrypoint({ config: f.config });
    expect(result.status).toBe("needs-input");
    expect(result.dispatched).toBe(0);
    expect(f.store.read("workspace:configuration").version).toBe(3);
    expect(result.tasks[0]?.reason).toContain("authorization");
  }, 30_000);
});
