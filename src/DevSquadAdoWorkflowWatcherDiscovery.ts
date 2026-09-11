import type {
  DevSquadAdoDiscoveryCandidateOutcome,
  DevSquadAdoDiscoveryIntakeSignal,
} from "./DevSquadAdoWorkflowWatcher.js";
import { guardDevSquadAdoWatcherLedger } from "./DevSquadAdoWorkflowWatcherLedger.js";
import {
  createWatcherCandidateState,
  runCandidateStep,
  finalizeWatcherCandidate,
  type PassContext,
  type CandidateState,
} from "./DevSquadAdoWorkflowWatcherPass.js";
import { randomBytes } from "node:crypto";
import type {
  DevSquadAdoDiscoveryPageRequest,
  DevSquadAdoDiscoveryPassOutcome,
  DevSquadAdoDiscoveryTraversal,
  RunDevSquadAdoDiscoveryWatchPassOptions,
} from "./DevSquadAdoWorkflowWatcher.js";
import {
  prepareDiscoveryPage,
  prepareDevSquadAdoDiscovery,
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
  const context: PassContext = {
    ledger: guardDevSquadAdoWatcherLedger(options.ledger),
    seam: options.seam,
    validated: { ...validated, candidates: [] },
    delay: options.delay,
    signal: options.signal,
    signals: [],
    cancelled: false,
  };
  const states: CandidateState[] = [];
  const outcomes: DevSquadAdoDiscoveryCandidateOutcome[] = [];
  const seen = new Set<string>();
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
    const page = prepareDiscoveryPage(
      response.value,
      identity,
      validated.discovery,
      seen,
      continuations,
    );
    if (!page.ok) {
      reason = page.reason;
      break;
    }
    if (options.signal?.aborted) {
      reason = "cancelled";
      break;
    }
    pagesValidated++;
    const next = page.next;
    for (const item of page.items) {
      seen.add(item.workItemId);
      const cleanup = {
        status: "not-required",
        reason: "no-claim-acquired",
        ledgerErrorKind: null,
        acceptedRevision: null,
      } as const;
      if (item.matching.decision !== "matched") {
        outcomes.push({
          category: "matching",
          workItemId: item.workItemId,
          kind: "skipped",
          reason:
            item.matching.decision === "facts-missing"
              ? "matching-facts-missing"
              : "matching-paused",
          matching: item.matching,
          cleanup,
        });
        continue;
      }
      if (options.signal?.aborted) {
        outcomes.push({
          category: "unprocessed",
          workItemId: item.workItemId,
          kind: "skipped",
          reason: "discovery-not-processed",
          matching: item.matching,
          cleanup,
        });
        continue;
      }
      const state = createWatcherCandidateState(item.workItemId);
      states.push(state);
      await runCandidateStep(context, state, now);
      const result = await finalizeWatcherCandidate(context, state);
      if (result.reason === "record-not-found") {
        const authorization = validated.discovery.authorizations?.find(
          (a) => a.workItemId === item.workItemId,
        );
        outcomes.push({
          category: "admission",
          workItemId: item.workItemId,
          kind: "skipped",
          reason:
            authorization?.kind === "unavailable" &&
            authorization.reason === "initial-state-missing"
              ? "admission-initial-state-missing"
              : "admission-not-authorized",
          matching: item.matching,
          cleanup,
        });
      } else
        outcomes.push({
          ...result,
          category: "observation",
          matching: item.matching,
        });
    }
    if (options.signal?.aborted) {
      reason = "cancelled";
      break;
    }
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
        discovered: seen.size,
        evaluated: seen.size,
        admitted: 0,
        paused: outcomes.filter((o) => o.category === "matching").length,
        processed: outcomes.filter((o) => o.category !== "unprocessed").length,
        initializationReplayed: 0,
        examined: states.filter((s) => s.examined).length,
        eligible: states.filter((s) => s.eligible).length,
        acted: context.signals.length,
        noChange: outcomes.filter((o) => o.kind === "no-change").length,
        suppressed: states.filter((s) => s.suppressed).length,
        skipped: outcomes.filter((o) => o.kind === "skipped").length,
        failed: outcomes.filter((o) => o.kind === "failed").length,
        cleanupReleased: outcomes.filter((o) => o.cleanup.status === "released")
          .length,
        cleanupFailed: outcomes.filter((o) => o.cleanup.status === "failed")
          .length,
        cleanupIndeterminate: outcomes.filter(
          (o) => o.cleanup.status === "indeterminate",
        ).length,
        cleanupNotRequired: outcomes.filter(
          (o) => o.cleanup.status === "not-required",
        ).length,
      },
      outcomes,
      signals: context.signals.map(
        (signal): DevSquadAdoDiscoveryIntakeSignal => ({
          ...signal,
          kind: "comment-observation",
        }),
      ),
    },
  };
};
