import { createHash } from "node:crypto";
import type {
  WorkspaceStore,
  WorkspaceStoreGuard,
} from "./OrchestrationWorkspaceContract.js";
import {
  evaluateOrchestrationFocus,
  snapshotOrchestrationFocus,
  type OrchestrationFocus,
  type OrchestrationFocusTarget,
} from "./OrchestrationFocus.js";

export type ServiceWorkspaceGuard = WorkspaceStoreGuard;
export type ServiceWorkspaceStore = WorkspaceStore;

export const orchestrationServiceDigest = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export interface OrchestrationOperationRequest extends OrchestrationFocusTarget {
  /** Stable host identity for one exact action, not an attempt or pass identifier. */
  id: string;
  /** Exact host-approved effect inputs; retained only as a digest. */
  intent: unknown;
}

export interface OrchestrationOperationEvidence {
  id: string;
  projectId: string;
  action: OrchestrationFocusTarget["action"];
  state: "proposed" | "running" | "blocked" | "ready";
  diagnostic: string;
}

export interface OrchestrationOperations {
  perform<T>(
    request: OrchestrationOperationRequest,
    execute: (signal: AbortSignal) => Promise<T>,
  ): Promise<
    { state: "ready"; value: T } | { state: "blocked"; diagnostic: string }
  >;
  evidence(): OrchestrationOperationEvidence[];
  settle(): Promise<void>;
}

interface OperationEntry {
  id: string;
  passId: string;
  projectId: string;
  action: OrchestrationFocusTarget["action"];
  intentDigest: string;
}
interface OperationLedger {
  active: OperationEntry[];
  completed: number;
}

function readLedger(value: unknown): OperationLedger {
  if (value === null) return { active: [], completed: 0 };
  if (
    !value ||
    typeof value !== "object" ||
    !("active" in value) ||
    !Array.isArray(value.active) ||
    !("completed" in value) ||
    typeof value.completed !== "number" ||
    !Number.isSafeInteger(value.completed) ||
    value.completed < 0 ||
    value.active.length > 1000 ||
    value.active.some(
      (entry) =>
        !entry ||
        typeof entry !== "object" ||
        typeof entry.id !== "string" ||
        typeof entry.intentDigest !== "string" ||
        typeof entry.passId !== "string" ||
        typeof entry.projectId !== "string" ||
        typeof entry.action !== "string",
    )
  )
    throw new Error("invalid-service-operation-journal");
  return value as OperationLedger;
}
const ledgerKey = (workspaceId: string) =>
  `service-operations/${orchestrationServiceDigest(workspaceId)}`;
const effectKey = (workspaceId: string, id: string) =>
  `service-operation/${orchestrationServiceDigest([workspaceId, id])}`;
const event = (kind: string) => ({ kind, at: new Date().toISOString() });

export function readOrchestrationOperationSummary(
  store: ServiceWorkspaceStore,
  workspaceId: string,
): { reserved: number; completed: number } {
  const ledger = readLedger(store.read(ledgerKey(workspaceId)).value);
  return { reserved: ledger.active.length, completed: ledger.completed };
}

/**
 * Trusted host reconciliation only: evidence must establish settlement, not merely
 * process death. Never reopens an operation ID for automatic dispatch.
 */
export function reconcileOrchestrationOperation(options: {
  store: ServiceWorkspaceStore;
  workspaceId: string;
  operationId: string;
  evidenceDigest: string;
}): void {
  if (!/^[a-f0-9]{64}$/.test(options.evidenceDigest))
    throw new Error("host-settlement-evidence-digest-required");
  const ownerKey = `service-owner/${orchestrationServiceDigest(options.workspaceId)}`;
  const owner = options.store.read(ownerKey);
  if (
    !owner.value ||
    typeof owner.value !== "object" ||
    !("state" in owner.value) ||
    owner.value.state !== "released"
  )
    throw new Error("stop-service-before-host-reconciliation");
  const store = options.store.withGuard({
    key: ownerKey,
    version: owner.version,
    valueDigest: orchestrationServiceDigest(owner.value),
  });
  const id = orchestrationServiceDigest(options.operationId);
  const key = ledgerKey(options.workspaceId);
  const current = store.read(key);
  const ledger = readLedger(current.value);
  const entry = ledger.active.find((entry) => entry.id === id);
  if (!entry) throw new Error("no-unsettled-operation-for-host-reconciliation");
  const tombstoneKey = effectKey(options.workspaceId, id);
  const tombstone = store.read(tombstoneKey);
  if (
    !store.compareAndSwap(
      tombstoneKey,
      tombstone.version,
      {
        ...entry,
        state: "reconciled",
        evidenceDigest: options.evidenceDigest,
      },
      event("service-operation-reconciled"),
    )
  )
    throw new Error("reconciliation-conflict");
  if (
    !store.compareAndSwap(
      key,
      current.version,
      {
        active: ledger.active.filter((active) => active.id !== id),
        completed: ledger.completed + 1,
      },
      event("service-operation-settled"),
    )
  )
    throw new Error(
      "reconciliation-unacknowledged: inspect canonical evidence",
    );
}

export function createOrchestrationOperations(options: {
  workspaceId: string;
  store: ServiceWorkspaceStore;
  focus: OrchestrationFocus;
  signal: AbortSignal;
  passId: string;
}): OrchestrationOperations {
  const focus = snapshotOrchestrationFocus(options.focus);
  const evidence: OrchestrationOperationEvidence[] = [];
  let running = 0;
  let attempts = 0;
  let closed = false;
  const items = new Set<string>();
  const started = performance.now();
  const pending = new Set<Promise<unknown>>();
  return {
    evidence: () => structuredClone(evidence),
    async settle() {
      closed = true;
      while (pending.size) await Promise.allSettled([...pending]);
    },
    perform<T>(
      request: OrchestrationOperationRequest,
      execute: (signal: AbortSignal) => Promise<T>,
    ) {
      const promise = perform(request, execute);
      pending.add(promise);
      void promise
        .finally(() => pending.delete(promise))
        .catch(() => undefined);
      return promise;
    },
  };

  async function perform<T>(
    request: OrchestrationOperationRequest,
    execute: (signal: AbortSignal) => Promise<T>,
  ): Promise<
    { state: "ready"; value: T } | { state: "blocked"; diagnostic: string }
  > {
    const { signal, store } = options;
    const target = { ...request };
    const decision = evaluateOrchestrationFocus(focus, target);
    const record: OrchestrationOperationEvidence = {
      id: orchestrationServiceDigest(request.id),
      projectId: request.projectId,
      action: request.action,
      state: "proposed",
      diagnostic: "awaiting-reservation",
    };
    if (evidence.length < 1000) evidence.push(record);
    const blocked = (diagnostic: string) => {
      record.state = "blocked";
      record.diagnostic = diagnostic;
      return { state: "blocked" as const, diagnostic };
    };
    if (!decision.allowed) return blocked(decision.reason);
    if (signal.aborted || closed) return blocked("pass-cancelled");
    if (typeof target.id !== "string" || !target.id || target.id.length > 4000)
      return blocked("invalid-exact-operation-identity");
    if (
      attempts >= focus.budgets.maxAttempts ||
      (!items.has(target.id) && items.size >= focus.budgets.maxItems) ||
      running >= focus.maxConcurrency ||
      performance.now() - started >= focus.budgets.maxRuntimeMs
    )
      return blocked("focus-budget-exhausted");
    const id = orchestrationServiceDigest(target.id);
    const intentDigest = orchestrationServiceDigest({
      projectId: target.projectId,
      action: target.action,
      intent: target.intent,
    });
    const tombstoneKey = effectKey(options.workspaceId, id);
    const tombstone = store.read(tombstoneKey);
    if (tombstone.value !== null) {
      if (
        !tombstone.value ||
        typeof tombstone.value !== "object" ||
        !("intentDigest" in tombstone.value) ||
        tombstone.value.intentDigest !== intentDigest
      )
        return blocked("operation-identity-conflicts-with-reserved-intent");
      return blocked(
        "reserved-outcome: reconcile canonical evidence; do not retry",
      );
    }
    const key = ledgerKey(options.workspaceId);
    const prior = store.read(key);
    const ledger = readLedger(prior.value);
    if (ledger.active.some((entry) => entry.id === id))
      return blocked("unsettled-operation: reconcile; do not retry");
    if (
      ledger.active.length >= focus.maxConcurrency ||
      ledger.active.length >= 1000
    )
      return blocked("unsettled-operation-concurrency-limit");
    const reserved: OperationEntry = {
      id,
      passId: options.passId,
      projectId: target.projectId,
      action: target.action,
      intentDigest,
    };
    // Account uncertainty first. A crash between these two commits can omit an
    // effect, but cannot create an unaccounted external callback.
    if (
      !store.compareAndSwap(
        key,
        prior.version,
        {
          ...ledger,
          active: [...ledger.active, reserved],
        },
        event("service-operation-admitted"),
      )
    )
      return blocked("admission-conflict-or-ownership-lost");
    if (
      !store.compareAndSwap(
        tombstoneKey,
        tombstone.version,
        {
          ...reserved,
          state: "reserved",
        },
        event("service-operation-reserved"),
      )
    )
      return blocked("reservation-conflict: reconcile; do not retry");
    running++;
    attempts++;
    items.add(target.id);
    record.state = "running";
    record.diagnostic = "host-action-running";
    try {
      const value = await execute(signal);
      if (
        !store.compareAndSwap(
          tombstoneKey,
          tombstone.version + 1,
          {
            ...reserved,
            state: "completed",
          },
          event("service-operation-completed"),
        )
      )
        return blocked("completion-unacknowledged: reconcile; do not retry");
      const latest = store.read(key);
      const current = readLedger(latest.value);
      if (
        !current.active.some(
          (entry) => entry.id === id && entry.passId === options.passId,
        ) ||
        !store.compareAndSwap(
          key,
          latest.version,
          {
            active: current.active.filter((entry) => entry.id !== id),
            completed: current.completed + 1,
          },
          event("service-operation-settled"),
        )
      )
        return blocked("settlement-unacknowledged: reconcile; do not retry");
      record.state = "ready";
      record.diagnostic = "host-action-completed";
      return { state: "ready", value };
    } catch {
      return blocked("host-action-unacknowledged: reconcile; do not retry");
    } finally {
      running--;
    }
  }
}
