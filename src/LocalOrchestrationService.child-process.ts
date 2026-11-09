import { appendFileSync } from "node:fs";
import {
  OrchestrationWorkspaceStore,
  readWorkspaceConfiguration,
} from "./OrchestrationWorkspace.js";
import { startLocalOrchestrationService } from "./LocalOrchestrationService.js";
import { startLocalOrchestrationControlChannel } from "./LocalOrchestrationServiceControl.js";

const [filename, directory, marker, mode] = process.argv.slice(2);
if (!filename || !directory || !marker)
  throw new Error("local-service-child-requires-fixture-paths");
const store = new OrchestrationWorkspaceStore(filename);
const configuration = readWorkspaceConfiguration(store);
const handle = await startLocalOrchestrationService({
  configuration,
  store,
  reloadConfiguration: () => readWorkspaceConfiguration(store),
  tick: async (context) => {
    const outcome = await context.operations.perform(
      {
        id: "fixture-effect:account:app:target:one",
        projectId: "app",
        action: "discover",
        intent: { fixture: "one" },
      },
      async () => {
        appendFileSync(marker, "effect\n");
        process.stdout.write("effect-started\n");
        if (mode === "crash") await new Promise<void>(() => undefined);
        return "fixture-receipt";
      },
    );
    process.stdout.write(`pass-${outcome.state}\n`);
  },
});
const channel = await startLocalOrchestrationControlChannel(handle, {
  directory,
  workspaceId: configuration.id,
});
process.stdout.write("service-ready\n");
const cancel = () => {
  void handle.stop();
};
process.on("SIGTERM", cancel);
process.on("SIGINT", cancel);
await handle.done;
await channel.close();
store.close();
