import { randomUUID } from "node:crypto";
import os from "node:os";
import {
  freezeOrchestrationValue,
  snapshotOrchestrationFocus,
  type OrchestrationFocus,
} from "./OrchestrationFocus.js";
import {
  createOrchestrationOperations,
  orchestrationServiceDigest,
  readOrchestrationOperationSummary,
  type OrchestrationOperations,
  type OrchestrationOperationEvidence,
  type ServiceWorkspaceStore,
} from "./OrchestrationOperations.js";

export interface LocalOrchestrationConfiguration {
  id: string;
  revision: number;
  focus: OrchestrationFocus;
  pollIntervalMs: number;
}

export interface LocalOrchestrationTickContext<
  C extends LocalOrchestrationConfiguration = LocalOrchestrationConfiguration,
> {
  configuration: C;
  store: ServiceWorkspaceStore;
  signal: AbortSignal;
  ownerId: string;
  passId: string;
  operations: OrchestrationOperations;
}

export interface LocalOrchestrationServiceStatus {
  state: "idle" | "running" | "paused" | "stopping" | "stopped" | "blocked";
  ownerId: string;
  passes: number;
  diagnostic: string;
  focus: OrchestrationFocus;
  operations: { reserved: number; completed: number };
  evidence: OrchestrationOperationEvidence[];
}

export interface LocalOrchestrationServiceHandle {
  status(): LocalOrchestrationServiceStatus;
  pause(): void;
  resume(): void;
  updateFocus(focus: OrchestrationFocus): void;
  stop(): Promise<void>;
  done: Promise<void>;
}

export interface LocalOrchestrationServiceOptions<
  C extends LocalOrchestrationConfiguration = LocalOrchestrationConfiguration,
> {
  configuration: C;
  store: ServiceWorkspaceStore;
  tick(context: LocalOrchestrationTickContext<C>): Promise<unknown>;
  signal?: AbortSignal;
  /** Re-parse trusted host configuration before each pass. */
  reloadConfiguration?: () => C;
}

interface Ownership {
  ownerId: string;
  pid: number;
  hostname: string;
  state: "active" | "released";
}

function ownership(value: unknown): Ownership | null {
  if (value === null) return null;
  if (
    !value ||
    typeof value !== "object" ||
    !("ownerId" in value) ||
    typeof value.ownerId !== "string" ||
    !("pid" in value) ||
    typeof value.pid !== "number" ||
    !Number.isSafeInteger(value.pid) ||
    value.pid <= 0 ||
    !("hostname" in value) ||
    typeof value.hostname !== "string" ||
    !("state" in value) ||
    (value.state !== "active" && value.state !== "released")
  )
    throw new Error("invalid-service-ownership: inspect canonical journal");
  return value as Ownership;
}

function isDead(prior: Ownership): boolean {
  if (prior.hostname !== os.hostname()) return false;
  try {
    process.kill(prior.pid, 0);
    return false;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "ESRCH";
  }
}

function snapshot<C extends LocalOrchestrationConfiguration>(
  configuration: C,
): C {
  const copy = structuredClone(configuration);
  if (
    typeof copy.id !== "string" ||
    !copy.id ||
    !Number.isSafeInteger(copy.revision) ||
    copy.revision < 1 ||
    !Number.isSafeInteger(copy.pollIntervalMs) ||
    copy.pollIntervalMs < 10
  )
    throw new Error("invalid-service-configuration");
  copy.focus = snapshotOrchestrationFocus(copy.focus);
  return freezeOrchestrationValue(copy);
}

function isNarrower(
  base: OrchestrationFocus,
  next: OrchestrationFocus,
): boolean {
  const modes = ["observe", "propose", "execute"];
  return (
    modes.indexOf(next.mode) <= modes.indexOf(base.mode) &&
    next.projectIds.every((id) => base.projectIds.includes(id)) &&
    next.permissions.every((grant) =>
      base.permissions.some(
        (allowed) =>
          grant.projectId === allowed.projectId &&
          grant.action === allowed.action,
      ),
    ) &&
    (["team", "iteration", "query"] as const).every(
      (key) => base[key] === undefined || next[key] === base[key],
    ) &&
    next.maxConcurrency <= base.maxConcurrency &&
    next.budgets.maxItems <= base.budgets.maxItems &&
    next.budgets.maxAttempts <= base.budgets.maxAttempts &&
    next.budgets.maxRuntimeMs <= base.budgets.maxRuntimeMs
  );
}

export async function startLocalOrchestrationService<
  C extends LocalOrchestrationConfiguration,
>(
  options: LocalOrchestrationServiceOptions<C>,
): Promise<LocalOrchestrationServiceHandle> {
  return start(options, false);
}

export async function runLocalOrchestrationPass<
  C extends LocalOrchestrationConfiguration,
>(
  options: LocalOrchestrationServiceOptions<C>,
): Promise<LocalOrchestrationServiceStatus> {
  const handle = start(options, true);
  await handle.done;
  return handle.status();
}

function start<C extends LocalOrchestrationConfiguration>(
  options: LocalOrchestrationServiceOptions<C>,
  once: boolean,
): LocalOrchestrationServiceHandle {
  let configuration = snapshot(options.configuration);
  const store = options.store;
  const namespace = orchestrationServiceDigest(configuration.id);
  const ownerKey = `service-owner/${namespace}`;
  const controlKey = `service-control/${namespace}`;
  const prior = store.read(ownerKey);
  const previousOwner = ownership(prior.value);
  if (previousOwner?.state === "active" && !isDead(previousOwner))
    throw new Error(
      "service-already-owned: live, inaccessible, or foreign-host owner",
    );
  const owner: Ownership = {
    ownerId: randomUUID(),
    pid: process.pid,
    hostname: os.hostname(),
    state: "active",
  };
  const event = (kind: string) => ({ kind, at: new Date().toISOString() });
  if (
    !store.compareAndSwap(
      ownerKey,
      prior.version,
      owner,
      event("service-owned"),
    )
  )
    throw new Error("service-ownership-conflict");
  const ownerVersion = prior.version + 1;
  const guarded = store.withGuard({
    key: ownerKey,
    version: ownerVersion,
    valueDigest: orchestrationServiceDigest(owner),
  });
  let paused = false;
  let focus = configuration.focus;
  let controlVersion = 0;
  let state: LocalOrchestrationServiceStatus["state"] = "idle";
  let diagnostic = "service-started";
  let passes = 0;
  let stopping = false;
  let active: AbortController | undefined;
  let activeOperations: OrchestrationOperations | undefined;
  let lastEvidence: OrchestrationOperationEvidence[] = [];
  let wake: (() => void) | undefined;

  function writeControl() {
    const record = guarded.read(controlKey);
    const value = {
      paused,
      focus,
      configurationRevision: configuration.revision,
    };
    if (
      !guarded.compareAndSwap(
        controlKey,
        record.version,
        value,
        event("service-control"),
      )
    )
      throw new Error("service-control-conflict-or-ownership-lost");
    controlVersion = record.version + 1;
    active?.abort();
    wake?.();
  }
  try {
    const persisted = guarded.read(controlKey).value;
    if (
      persisted &&
      typeof persisted === "object" &&
      "configurationRevision" in persisted &&
      persisted.configurationRevision === configuration.revision
    ) {
      if (
        !("paused" in persisted) ||
        typeof persisted.paused !== "boolean" ||
        !("focus" in persisted)
      )
        throw new Error("invalid-service-control");
      const restored = snapshotOrchestrationFocus(
        persisted.focus as OrchestrationFocus,
      );
      if (!isNarrower(configuration.focus, restored))
        throw new Error("persisted-focus-exceeds-trusted-configuration");
      paused = persisted.paused;
      focus = restored;
    }
    writeControl();
  } catch (error) {
    guarded.compareAndSwap(
      ownerKey,
      ownerVersion,
      { ...owner, state: "released" },
      event("service-start-failed"),
    );
    throw error;
  }
  const cancel = () => {
    stopping = true;
    active?.abort();
    wake?.();
  };
  options.signal?.addEventListener("abort", cancel, { once: true });
  if (options.signal?.aborted) cancel();
  const status = (): LocalOrchestrationServiceStatus => ({
    state,
    ownerId: owner.ownerId,
    passes,
    diagnostic,
    focus: structuredClone(focus),
    operations: readOrchestrationOperationSummary(store, configuration.id),
    evidence: activeOperations?.evidence() ?? structuredClone(lastEvidence),
  });
  const done = loop();
  return {
    status,
    done,
    pause() {
      if (stopping) throw new Error("service-stopping");
      paused = true;
      writeControl();
      state = "paused";
      diagnostic = "paused: admitted effects may still settle";
    },
    resume() {
      if (stopping) throw new Error("service-stopping");
      paused = false;
      writeControl();
      state = "idle";
      diagnostic = "service-resumed";
    },
    updateFocus(next) {
      if (stopping) throw new Error("service-stopping");
      const candidate = snapshotOrchestrationFocus(next);
      if (!isNarrower(configuration.focus, candidate))
        throw new Error("focus-expansion-requires-trusted-host-configuration");
      focus = candidate;
      writeControl();
    },
    async stop() {
      if (!stopping) {
        state = "stopping";
        cancel();
      }
      await done;
    },
  };

  async function loop(): Promise<void> {
    try {
      while (!stopping) {
        if (!paused) {
          if (options.reloadConfiguration) {
            const latest = snapshot(options.reloadConfiguration());
            if (latest.id !== configuration.id)
              throw new Error("workspace-identity-changed");
            if (latest.revision !== configuration.revision) {
              configuration = latest;
              focus = latest.focus;
              writeControl();
            }
          }
          let passStore = guarded.withGuard({
            key: controlKey,
            version: controlVersion,
            valueDigest: orchestrationServiceDigest({
              paused,
              focus,
              configurationRevision: configuration.revision,
            }),
          });
          const configRecord = store.read("workspace:configuration");
          if (configRecord.value !== null) {
            if (
              orchestrationServiceDigest(configRecord.value) !==
              orchestrationServiceDigest(configuration)
            )
              throw new Error(
                "configuration-changed: reload trusted host configuration",
              );
            passStore = passStore.withGuard({
              key: "workspace:configuration",
              version: configRecord.version,
              valueDigest: orchestrationServiceDigest(configRecord.value),
            });
          }
          active = new AbortController();
          const timer = setTimeout(() => {
            diagnostic =
              "pass-deadline: waiting for cooperative callback settlement";
            active?.abort();
          }, focus.budgets.maxRuntimeMs);
          const passId = randomUUID();
          const operations = createOrchestrationOperations({
            workspaceId: configuration.id,
            store: passStore,
            focus,
            signal: active.signal,
            passId,
          });
          activeOperations = operations;
          state = "running";
          try {
            await options.tick({
              configuration: freezeOrchestrationValue({
                ...structuredClone(configuration),
                focus,
              }),
              store: passStore,
              signal: active.signal,
              ownerId: owner.ownerId,
              passId,
              operations,
            });
          } finally {
            active.abort();
            await operations.settle();
            lastEvidence = operations.evidence();
            activeOperations = undefined;
            clearTimeout(timer);
            active = undefined;
            writeControl();
          }
          passes++;
          state = paused ? "paused" : "idle";
          diagnostic = paused ? "service-paused" : "pass-completed";
        }
        if (once) break;
        await new Promise<void>((resolve) => {
          const timer = setTimeout(finish, configuration.pollIntervalMs);
          function finish() {
            clearTimeout(timer);
            wake = undefined;
            resolve();
          }
          wake = finish;
          if (stopping) finish();
        });
      }
      state = "stopped";
    } catch {
      state = "blocked";
      diagnostic =
        "service-pass-failed: inspect canonical journal and host configuration";
    } finally {
      stopping = true;
      options.signal?.removeEventListener("abort", cancel);
      try {
        if (
          !guarded.compareAndSwap(
            ownerKey,
            ownerVersion,
            { ...owner, state: "released" },
            event("service-released"),
          )
        ) {
          state = "blocked";
          diagnostic = "service-ownership-lost: no further effects permitted";
        }
      } catch {
        state = "blocked";
        diagnostic =
          "service-release-unacknowledged: inspect ownership and canonical journal";
      }
    }
  }
}
