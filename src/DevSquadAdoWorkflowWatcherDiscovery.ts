import { randomBytes } from "node:crypto";
import type {
  DevSquadAdoDiscoveryPageRequest,
  DevSquadAdoDiscoveryPassOutcome,
  DevSquadAdoDiscoveryTraversal,
  RunDevSquadAdoDiscoveryWatchPassOptions,
} from "./DevSquadAdoWorkflowWatcher.js";
import {
  DiscoveryJsonBudget,
  discoveryText,
  prepareDevSquadAdoDiscovery,
  record,
} from "./DevSquadAdoWorkflowWatcherDiscoveryValidation.js";
import { raceDevSquadAdoWatcherSeamCall } from "./DevSquadAdoWorkflowWatcherObservation.js";
import { computeDevSquadAdoWatcherBackoffDelayMs } from "./DevSquadAdoWorkflowWatcherValidation.js";

const readClock = (clock: () => Date): Date | null => {
  try {
    const value = clock();
    const timestamp = Date.prototype.getTime.call(value);
    return Number.isFinite(timestamp) ? new Date(timestamp) : null;
  } catch {
    return null;
  }
};

/** W039 / FR-061–064: invocation-local empty-page tracer, never a durable cursor. */
export const runDevSquadAdoDiscoveryWatchPass = async (
  input: RunDevSquadAdoDiscoveryWatchPassOptions,
): Promise<DevSquadAdoDiscoveryPassOutcome> => {
  const prepared = prepareDevSquadAdoDiscovery(input);
  if (!prepared.ok) return prepared;
  const { options, value: validated, seam } = prepared;
  const startedAt = readClock(options.clock);
  if (!startedAt)
    return {
      ok: false,
      error: {
        kind: "validation",
        field: "clock",
        reason: "must return a valid Date",
      },
    };
  const limits = validated.discovery.limits;
  const traversalId = randomBytes(32).toString("hex");
  const continuations = new Set<string>();
  let continuation: string | null = null;
  let lastReading = startedAt;
  let polls = 0;
  let pageCalls = 0;
  let pagesValidated = 0;
  let terminalPageSeen = false;
  let reason: DevSquadAdoDiscoveryTraversal["reason"] = "invalid-page";

  for (;;) {
    if (options.signal?.aborted) {
      reason = "cancelled";
      break;
    }
    if (polls >= validated.maxPolls) {
      reason = "poll-budget-exhausted";
      break;
    }
    if (pageCalls >= limits.maxPageCalls) {
      reason = "page-budget-exhausted";
      break;
    }
    const now = readClock(options.clock);
    if (!now) {
      reason = "poll-start-budget-exhausted";
      break;
    }
    lastReading = now;
    if (
      polls > 0 &&
      now.getTime() - startedAt.getTime() >= validated.maxPollStartElapsedMs
    ) {
      reason = "poll-start-budget-exhausted";
      break;
    }
    polls++;
    const identity: Omit<DevSquadAdoDiscoveryPageRequest, "signal"> =
      Object.freeze({
        binding: validated.binding,
        traversalId,
        pageOrdinal: pageCalls + 1,
        continuation,
      });
    if (options.signal?.aborted) {
      reason = "cancelled";
      break;
    }
    const response = await raceDevSquadAdoWatcherSeamCall(
      (signal) => {
        pageCalls++;
        const request: DevSquadAdoDiscoveryPageRequest = Object.freeze({
          ...identity,
          signal,
        });
        return seam.discoverWorkItemsPage(request);
      },
      {
        signal: options.signal,
        delay: options.delay,
        observationTimeoutMs: validated.observationTimeoutMs,
      },
    );
    if (options.signal?.aborted) {
      reason = "cancelled";
      break;
    }
    if (response.kind !== "value") {
      reason = response.kind === "timeout" ? "page-timeout" : "page-failed";
      break;
    }
    let next:
      | { readonly kind: "terminal" }
      | { readonly kind: "continue"; readonly continuation: string };
    try {
      const page = record(response.value);
      const budget = new DiscoveryJsonBudget(limits.maxPageBytes);
      const projected = budget.object({
        binding: () => {
          const raw = record(page.binding);
          return budget.object({
            scopeId: () => budget.scalar(discoveryText(raw.scopeId, 256, true)),
            partitionId: () =>
              budget.scalar(discoveryText(raw.partitionId, 256, true)),
            stabilityId: () =>
              budget.scalar(discoveryText(raw.stabilityId, 256, true)),
            policyVersion: () =>
              budget.scalar(discoveryText(raw.policyVersion, 256, true)),
          });
        },
        traversalId: () =>
          budget.scalar(discoveryText(page.traversalId, 64, true)),
        pageOrdinal: (): number => {
          const ordinal = page.pageOrdinal;
          if (ordinal !== identity.pageOrdinal) throw new Error("ordinal");
          return budget.scalar(ordinal);
        },
        // W040 owns whole-page item/fact matching; the W039 tracer accepts only empty pages.
        items: () =>
          budget.array(page.items, 0, () => {
            throw new Error("item");
          }),
        next: () => {
          const raw = record(page.next);
          const kind = raw.kind;
          if (kind === "terminal")
            return budget.object({ kind: () => budget.scalar(kind) });
          if (kind !== "continue") throw new Error("next");
          return budget.object({
            kind: () => budget.scalar(kind),
            continuation: () =>
              budget.scalar(
                discoveryText(
                  raw.continuation,
                  limits.maxContinuationBytes,
                  true,
                ),
              ),
          });
        },
      });
      if (projected.traversalId !== identity.traversalId) {
        reason = "invalid-page";
        break;
      }
      if (
        Object.keys(validated.binding).some(
          (key) =>
            projected.binding[key as keyof typeof validated.binding] !==
            validated.binding[key as keyof typeof validated.binding],
        )
      ) {
        reason = "unstable-scope";
        break;
      }
      next = projected.next;
      if (next.kind === "continue" && continuations.has(next.continuation)) {
        reason = "repeated-continuation";
        break;
      }
    } catch {
      reason = "invalid-page";
      break;
    }
    if (options.signal?.aborted) {
      reason = "cancelled";
      break;
    }
    pagesValidated++;
    if (next.kind === "terminal") {
      terminalPageSeen = true;
      reason = "terminal-page";
      break;
    }
    continuations.add(next.continuation);
    continuation = next.continuation;
    if (options.signal?.aborted) {
      reason = "cancelled";
      break;
    }
    if (pageCalls >= limits.maxPageCalls) {
      reason = "page-budget-exhausted";
      break;
    }
    if (polls >= validated.maxPolls) {
      reason = "poll-budget-exhausted";
      break;
    }
    try {
      await options.delay(
        computeDevSquadAdoWatcherBackoffDelayMs({
          pollIndex: polls,
          baseIntervalMs: validated.baseIntervalMs,
          multiplier: validated.multiplier,
          maxIntervalMs: validated.maxIntervalMs,
          jitter: options.backoff?.jitter,
        }),
        options.signal,
      );
    } catch {
      reason = "cancelled";
      break;
    }
  }
  if (options.signal?.aborted) reason = "cancelled";
  const traversal: DevSquadAdoDiscoveryTraversal =
    reason === "terminal-page"
      ? { status: "complete", reason, terminalPageSeen: true }
      : { status: "incomplete", reason, terminalPageSeen };
  const stopReason =
    reason === "terminal-page"
      ? "completed"
      : reason === "cancelled" ||
          reason === "poll-budget-exhausted" ||
          reason === "poll-start-budget-exhausted"
        ? reason
        : "discovery-incomplete";
  return {
    ok: true,
    value: {
      mode: "discovery",
      passId: validated.passId,
      ownerId: validated.ownerId,
      startedAt: startedAt.toISOString(),
      completedAt: lastReading.toISOString(),
      polls,
      stopReason,
      traversal,
      counts: {
        pageCalls,
        pagesValidated,
        discovered: 0,
        evaluated: 0,
        admitted: 0,
        paused: 0,
        processed: 0,
        initializationReplayed: 0,
        examined: 0,
        eligible: 0,
        acted: 0,
        noChange: 0,
        suppressed: 0,
        skipped: 0,
        failed: 0,
        cleanupReleased: 0,
        cleanupFailed: 0,
        cleanupIndeterminate: 0,
        cleanupNotRequired: 0,
      },
      outcomes: [],
      signals: [],
    },
  };
};
