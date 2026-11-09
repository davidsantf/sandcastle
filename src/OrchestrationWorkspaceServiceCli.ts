import { Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import {
  OrchestrationWorkspaceStore,
  readWorkspaceConfiguration,
} from "./OrchestrationWorkspace.js";
import type { WorkspaceConfiguration } from "./OrchestrationWorkspaceContract.js";
import {
  startLocalOrchestrationService,
  runLocalOrchestrationPass,
  readLocalOrchestrationFailure,
  type LocalOrchestrationServiceStatus,
  type LocalOrchestrationTickContext,
} from "./LocalOrchestrationService.js";
import {
  startLocalOrchestrationControlChannel,
  sendLocalOrchestrationControl,
  createLocalOrchestrationStartupArtifact,
  type LocalOrchestrationControlCommand,
} from "./LocalOrchestrationServiceControl.js";
import {
  orchestrationServiceDigest,
  readOrchestrationOperationSummary,
} from "./OrchestrationOperations.js";
import { workspaceFocusSchema } from "./OrchestrationWorkspaceContract.js";

type WorkspaceTick = (
  context: LocalOrchestrationTickContext<WorkspaceConfiguration>,
) => Promise<unknown>;
const database = Options.text("database");
const controlDirectory = Options.text("control-directory").pipe(
  Options.optional,
);
export const workspacePassKey = (id: string) =>
  `workspace-pass/${orchestrationServiceDigest(id)}`;
const controlOptions = (
  filename: string,
  configuration: WorkspaceConfiguration,
  directory: Option.Option<string>,
) => ({
  workspaceId: configuration.id,
  directory: path.resolve(
    Option.getOrElse(directory, () =>
      path.join(
        path.dirname(path.resolve(filename)),
        `.${configuration.id}-control`,
      ),
    ),
  ),
});
const ownerState = (
  store: OrchestrationWorkspaceStore,
  id: string,
): "released" | "active" | "dead" => {
  const record = store.read(
    `service-owner/${orchestrationServiceDigest(id)}`,
  ).value;
  if (record === null) return "released";
  if (
    !record ||
    typeof record !== "object" ||
    !("state" in record) ||
    !("pid" in record) ||
    typeof record.pid !== "number" ||
    !("hostname" in record) ||
    typeof record.hostname !== "string"
  )
    throw new Error("invalid-service-ownership: inspect canonical journal");
  if (record.state === "released") return "released";
  if (record.state !== "active" || record.hostname !== os.hostname())
    throw new Error(
      "service ownership is unconfirmed or belongs to a different host",
    );
  try {
    process.kill(record.pid, 0);
    return "active";
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH")
      return "dead";
    throw new Error("service owner liveness could not be confirmed", {
      cause: error,
    });
  }
};
const withStore = (
  filename: string,
  action: (
    store: OrchestrationWorkspaceStore,
    configuration: WorkspaceConfiguration,
  ) => Promise<unknown> | unknown,
) =>
  Effect.tryPromise(async () => {
    const store = new OrchestrationWorkspaceStore(path.resolve(filename));
    try {
      console.log(
        JSON.stringify(
          await action(store, readWorkspaceConfiguration(store)),
          null,
          2,
        ),
      );
    } finally {
      store.close();
    }
  });
const recoveryGuidance = (status: LocalOrchestrationServiceStatus) =>
  status.state !== "blocked"
    ? undefined
    : status.failureEvidence === "unacknowledged"
      ? "Failure evidence was not acknowledged. Verify journal storage and ownership offline; do not retry effects based on this status."
      : status.lastFailure?.phase === "configuration"
        ? "Stop, inspect workspace events and validate setup; migrate additive defaults if needed, then restart. Do not edit retained history."
        : "Inspect retained phase/cause, scoped authentication and host dependencies. Reconcile unresolved effects using independent evidence before restarting; never delete reservations.";

export function createWorkspaceServiceCommands(tick: WorkspaceTick) {
  const tracked: WorkspaceTick = async (context) => {
    const result = await tick(context);
    if (!result || typeof result !== "object")
      throw new Error("workspace tick did not return explicit pass evidence");
    const key = workspacePassKey(context.configuration.id);
    const current = context.store.read(key);
    const value = {
      configurationRevision: context.configuration.revision,
      passId: context.passId,
      at: new Date().toISOString(),
      result,
    };
    if (
      !context.store.compareAndSwap(key, current.version, value, {
        kind: "workspace-pass",
        at: value.at,
      })
    )
      throw new Error("workspace pass evidence conflict");
    return result;
  };
  const run = Command.make("run", { database }, (args) =>
    withStore(args.database, async (store, configuration) => {
      const status = await runLocalOrchestrationPass({
        configuration,
        store,
        tick: tracked,
      });
      const lastPass = store.read(workspacePassKey(configuration.id)).value;
      if (
        status.state === "blocked" ||
        !lastPass ||
        (typeof lastPass === "object" &&
          "result" in lastPass &&
          lastPass.result &&
          typeof lastPass.result === "object" &&
          "status" in lastPass.result &&
          ["blocked", "partial"].includes(String(lastPass.result.status)))
      )
        process.exitCode = 2;
      return { service: status, lastPass, recovery: recoveryGuidance(status) };
    }),
  );
  const start = (restart: boolean) =>
    Command.make(
      restart ? "restart" : "start",
      { database, controlDirectory },
      (args) =>
        withStore(args.database, async (store, configuration) => {
          const control = controlOptions(
            args.database,
            configuration,
            args.controlDirectory,
          );
          if (restart && ownerState(store, configuration.id) === "active")
            await sendLocalOrchestrationControl(control, { action: "stop" });
          const controller = new AbortController();
          const cancel = () => controller.abort();
          process.once("SIGINT", cancel);
          process.once("SIGTERM", cancel);
          let service:
            | Awaited<ReturnType<typeof startLocalOrchestrationService>>
            | undefined;
          let channel:
            | Awaited<ReturnType<typeof startLocalOrchestrationControlChannel>>
            | undefined;
          let lastNotification: string | undefined;
          try {
            service = await startLocalOrchestrationService({
              configuration,
              store,
              tick: async (context) => {
                const result = await tracked(context);
                const summary = JSON.stringify(result);
                if (summary !== lastNotification) {
                  console.log(
                    JSON.stringify({
                      event: "workspace-pass",
                      configurationRevision: context.configuration.revision,
                      passId: context.passId,
                      result,
                    }),
                  );
                  lastNotification = summary;
                }
                return result;
              },
              signal: controller.signal,
              reloadConfiguration: () => readWorkspaceConfiguration(store),
            });
            if (service.status().state !== "blocked") {
              channel = await startLocalOrchestrationControlChannel(
                service,
                control,
              );
              if (service.status().state !== "blocked")
                console.log(
                  JSON.stringify({
                    event: "service-ready",
                    workspaceId: configuration.id,
                    status: service.status(),
                  }),
                );
            }
            await service.done;
            const status = service.status();
            if (status.state === "blocked") process.exitCode = 2;
            return {
              service: status,
              lastPass: store.read(workspacePassKey(configuration.id)).value,
              recovery: recoveryGuidance(status),
            };
          } finally {
            process.removeListener("SIGINT", cancel);
            process.removeListener("SIGTERM", cancel);
            await service?.stop();
            await channel?.close();
          }
        }),
    );
  const control = (action: "status" | "pause" | "resume" | "stop") =>
    Command.make(action, { database, controlDirectory }, (args) =>
      withStore(args.database, async (store, configuration) => {
        const owner = ownerState(store, configuration.id);
        if (action === "status" && owner !== "active")
          return {
            state: owner === "dead" ? "crashed" : "not-running",
            owner,
            operations: readOrchestrationOperationSummary(
              store,
              configuration.id,
            ),
            lastFailure: readLocalOrchestrationFailure(store, configuration.id),
            lastPass: store.read(workspacePassKey(configuration.id)).value,
          };
        const status = await sendLocalOrchestrationControl(
          controlOptions(args.database, configuration, args.controlDirectory),
          { action } satisfies LocalOrchestrationControlCommand,
        );
        if (status.state === "blocked") process.exitCode = 2;
        return {
          service: status,
          lastPass: store.read(workspacePassKey(configuration.id)).value,
          recovery: recoveryGuidance(status),
        };
      }),
    );
  const narrowFocus = Command.make(
    "narrow-focus",
    { database, controlDirectory, file: Options.text("file") },
    (args) =>
      withStore(args.database, async (_store, configuration) => {
        const filename = path.resolve(args.file);
        if (
          !fs.statSync(filename).isFile() ||
          fs.statSync(filename).size > 1_048_576
        )
          throw new Error(
            "focus input must be a regular JSON file up to 1 MiB",
          );
        const focus = workspaceFocusSchema.parse(
          JSON.parse(fs.readFileSync(filename, "utf8")),
        );
        return sendLocalOrchestrationControl(
          controlOptions(args.database, configuration, args.controlDirectory),
          { action: "focus", focus },
        );
      }),
  );
  const startup = Command.make(
    "startup",
    { database, controlDirectory },
    (args) =>
      withStore(args.database, (_store, configuration) => {
        if (!process.argv[1])
          throw new Error("compiled CLI entrypoint path unavailable");
        const control = controlOptions(
          args.database,
          configuration,
          args.controlDirectory,
        );
        return createLocalOrchestrationStartupArtifact({
          executable: process.execPath,
          args: [
            path.resolve(process.argv[1]),
            "orchestrate",
            "workspace",
            "start",
            "--database",
            path.resolve(args.database),
            "--control-directory",
            control.directory,
          ],
          workingDirectory: path.dirname(path.resolve(args.database)),
        });
      }),
  );
  return [
    run,
    start(false),
    start(true),
    control("status"),
    control("pause"),
    control("resume"),
    control("stop"),
    narrowFocus,
    startup,
  ];
}
