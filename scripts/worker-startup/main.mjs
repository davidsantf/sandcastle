import { Command } from "@effect/cli";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Effect } from "effect";
import { orchestrationWorkspaceCommand } from "../../src/OrchestrationWorkspaceCli.js";
const root = Command.make("sandcastle").pipe(
  Command.withSubcommands([
    Command.make("orchestrate").pipe(
      Command.withSubcommands([orchestrationWorkspaceCommand]),
    ),
  ]),
);
Command.run(root, { name: "sandcastle-workers", version: "1" })(
  process.argv,
).pipe(
  Effect.catchAllCause(() =>
    Effect.sync(() => {
      console.error("worker-command-failed: inspect canonical status/events");
      process.exitCode = 2;
    }),
  ),
  Effect.provide(NodeContext.layer),
  NodeRuntime.runMain,
);
