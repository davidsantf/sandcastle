import { randomBytes } from "node:crypto";
import type {
  DevSquadAdoDiscoveryCandidateOutcome,
  DevSquadAdoDiscoveryIntakeSignal,
  DevSquadAdoDiscoveryPageRequest,
  DevSquadAdoDiscoveryPassOutcome,
  DevSquadAdoDiscoveryTraversal,
  RunDevSquadAdoDiscoveryWatchPassOptions,
} from "./DevSquadAdoWorkflowWatcher.js";
import {
  prepareDevSquadAdoDiscovery,
  prepareDiscoveryPage,
  type PreparedDiscoveryItem,
} from "./DevSquadAdoWorkflowWatcherDiscoveryValidation.js";
import {
  guardDevSquadAdoWatcherLedger,
  guardDiscoveryInitializer,
} from "./DevSquadAdoWorkflowWatcherLedger.js";
import {
  createWatcherCandidateState,
  runCandidateStep,
  finalizeWatcherCandidate,
  type PassContext,
  type CandidateState,
} from "./DevSquadAdoWorkflowWatcherPass.js";
import {
  createDiscoveryAdmission,
  runDiscoveryAdmission,
  type DiscoveryAdmissionState,
} from "./DevSquadAdoWorkflowWatcherAdmission.js";
import { raceDevSquadAdoWatcherSeamCall } from "./DevSquadAdoWorkflowWatcherObservation.js";
import { computeDevSquadAdoWatcherBackoffDelayMs } from "./DevSquadAdoWorkflowWatcherValidation.js";
const readClock = (clock: () => Date): Date | null => {
  try {
    const stamp = Date.prototype.getTime.call(clock());
    return Number.isFinite(stamp) ? new Date(stamp) : null;
  } catch {
    return null;
  }
};
interface DiscoveredState {
  readonly item: PreparedDiscoveryItem;
  observation: CandidateState | null;
  admission: DiscoveryAdmissionState | null;
  outcome: DevSquadAdoDiscoveryCandidateOutcome | null;
}
const noClaim = {
  status: "not-required",
  reason: "no-claim-acquired",
  ledgerErrorKind: null,
  acceptedRevision: null,
} as const;

/** W043 / FR-061-064: bounded invocation-local traversal and retained guarded item steps. */
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
    // W042: retain the captured discovery union, not the supplied-mode view.
    seam,
    mode: "discovery",
    validated: { ...validated, candidates: [] },
    delay: options.delay,
    signal: options.signal,
    signals: [],
    cancelled: false,
  };
  const initialize = guardDiscoveryInitializer(options.ledger);
  const states: DiscoveredState[] = [],
    signals: DevSquadAdoDiscoveryIntakeSignal[] = [];
  const seen = new Set<string>(),
    continuations = new Set<string>();
  const traversalId = randomBytes(32).toString("hex");
  let continuation: string | null = null;
  let lastReading = startedAt,
    polls = 0,
    pageCalls = 0,
    pagesValidated = 0,
    terminalPageSeen = false;
  let reason: DevSquadAdoDiscoveryTraversal["reason"] = "invalid-page";
  const isPending = (state: DiscoveredState): boolean =>
    state.admission !== null ? state.admission.pending : state.outcome === null;
  const pending = () => states.some(isPending);
  const finishObservation = async (state: DiscoveredState): Promise<void> => {
    if (
      state.observation === null ||
      state.admission !== null ||
      state.outcome !== null
    )
      return;
    state.outcome = {
      ...(await finalizeWatcherCandidate(context, state.observation)),
      category: "observation",
      matching: state.item.matching,
    };
  };
  // Terminal evidence ends ordinary no-change states, not unfinished mutations.
  const finishQuietObservations = async (): Promise<void> => {
    for (const state of states) {
      const observation = state.observation;
      if (
        observation !== null &&
        observation.pendingCheckpoint === null &&
        observation.claim === null
      )
        await finishObservation(state);
    }
  };
  const step = async (state: DiscoveredState, now: Date): Promise<void> => {
    if (options.signal?.aborted) return;
    if (state.admission) {
      const signal = await runDiscoveryAdmission(
        state.admission,
        initialize,
        validated.intakePhases,
        validated.intakeStatuses,
        options.signal,
      );
      if (signal) signals.push(signal);
      state.outcome = state.admission.outcome;
      return;
    }
    if (state.outcome) return;
    const { item } = state;
    if (item.matching.decision !== "matched") {
      state.outcome = {
        category: "matching",
        workItemId: item.workItemId,
        kind: "skipped",
        reason:
          item.matching.decision === "facts-missing"
            ? "matching-facts-missing"
            : "matching-paused",
        matching: item.matching,
        cleanup: noClaim,
      };
      return;
    }
    const observation =
      state.observation ?? createWatcherCandidateState(item.workItemId);
    state.observation = observation;
    await runCandidateStep(context, observation, now);
    for (const signal of context.signals.splice(0))
      signals.push({ ...signal, kind: "comment-observation" });
    // W043: never finalize a pending step here: finalization clears its original
    // checkpoint submission and releases the authority needed on the next poll.
    // W046 SKEP1: mutation failures are not evidence of initial absence.
    if (observation.initialReadMissing) {
      state.admission = createDiscoveryAdmission(
        item.workItemId,
        item.matching,
        validated.discovery.authorizations?.find(
          (a) => a.workItemId === item.workItemId,
        ),
      );
      const signal = await runDiscoveryAdmission(
        state.admission,
        initialize,
        validated.intakePhases,
        validated.intakeStatuses,
        options.signal,
      );
      if (signal) signals.push(signal);
      state.outcome = state.admission.outcome;
    } else if (observation.resolved !== null) await finishObservation(state);
  };
  for (;;) {
    if (options.signal?.aborted) {
      reason = "cancelled";
      break;
    }
    if (polls >= validated.maxPolls) {
      reason = "poll-budget-exhausted";
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
    for (const state of states) if (isPending(state)) await step(state, now);
    if (options.signal?.aborted) {
      reason = "cancelled";
      break;
    }
    if (!terminalPageSeen) {
      if (pageCalls >= limits.maxPageCalls) {
        reason = "page-budget-exhausted";
        break;
      }
      const identity: Omit<DevSquadAdoDiscoveryPageRequest, "signal"> =
        Object.freeze({
          binding: validated.binding,
          traversalId,
          pageOrdinal: pageCalls + 1,
          continuation,
        });
      const response = await raceDevSquadAdoWatcherSeamCall(
        (signal) => {
          pageCalls++;
          return seam.discoverWorkItemsPage(
            Object.freeze({ ...identity, signal }),
          );
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
      if (page.next.kind === "terminal") terminalPageSeen = true;
      else {
        continuation = page.next.continuation;
        continuations.add(continuation);
      }
      const added: DiscoveredState[] = [];
      for (const item of page.items) {
        seen.add(item.workItemId);
        const state: DiscoveredState = {
          item,
          observation: null,
          admission: null,
          outcome: null,
        };
        states.push(state);
        added.push(state);
      }
      for (const state of added) await step(state, now);
    }
    if (options.signal?.aborted) {
      reason = "cancelled";
      break;
    }
    if (terminalPageSeen) await finishQuietObservations();
    if (terminalPageSeen && !pending()) {
      reason = "terminal-page";
      break;
    }
    if (!terminalPageSeen && pageCalls >= limits.maxPageCalls) {
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
  // W043: budget/invalid-page exits still clean up each retained validated claim
  // exactly once; do not turn this finalization into terminal traversal evidence.
  context.cancelled = options.signal?.aborted === true;
  for (const state of states) await finishObservation(state);
  const outcomes: DevSquadAdoDiscoveryCandidateOutcome[] = states.map(
    (s) =>
      s.outcome ?? {
        category: "unprocessed",
        workItemId: s.item.workItemId,
        kind: "skipped",
        reason: "discovery-not-processed",
        matching: s.item.matching,
        cleanup: noClaim,
      },
  );
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
      outcomes,
      signals,
      counts: {
        pageCalls,
        pagesValidated,
        discovered: seen.size,
        evaluated: seen.size,
        admitted: states.filter(
          (s) => s.admission?.outcome.acceptance.kind === "fresh",
        ).length,
        initializationReplayed: states.filter(
          (s) => s.admission?.outcome.acceptance.kind === "replayed",
        ).length,
        // W044 / CC-034: matching completed for the whole accepted page,
        // even when cancellation leaves its item effects unscheduled.
        paused: states.filter((s) => s.item.matching.decision !== "matched")
          .length,
        processed: outcomes.filter((o) => o.category !== "unprocessed").length,
        examined: states.filter((s) => s.observation?.examined).length,
        eligible: states.filter((s) => s.observation?.eligible).length,
        acted: signals.length,
        noChange: outcomes.filter((o) => o.kind === "no-change").length,
        suppressed: states.filter((s) => s.observation?.suppressed).length,
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
    },
  };
};
