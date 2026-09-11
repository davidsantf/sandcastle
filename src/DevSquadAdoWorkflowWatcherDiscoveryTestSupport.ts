import { vi } from "vitest";
import type {
  DevSquadAdoWorkflowLedger,
  RunDevSquadAdoDiscoveryWatchPassOptions,
} from "./index.js";
// W039 / TEST-025/032/038: the same exported invocation serves both modes.
export const discoveryOptions = () => {
  const effect = vi.fn(async () => {
    throw new Error("unexpected effect");
  });
  const ledger = {
    readRecord: effect,
    acquireClaim: effect,
    renewClaim: effect,
    releaseClaim: effect,
    checkpoint: effect,
    initializeRecord: effect,
  } as unknown as DevSquadAdoWorkflowLedger;
  const clock = vi.fn(() => new Date("2026-09-10T00:00:00.000Z"));
  const timers: AbortSignal[] = [];
  const options: RunDevSquadAdoDiscoveryWatchPassOptions = {
    mode: "discovery",
    ledger,
    passId: "discovery-pass",
    ownerId: "host",
    intakeRules: { phases: ["ready"], statuses: ["open"] },
    budgets: {
      maxPolls: 4,
      maxPollStartElapsedMs: 1000,
      observationTimeoutMs: 10,
    },
    clock,
    delay: vi.fn((_ms, signal) => {
      if (signal) timers.push(signal);
      return new Promise<void>((resolve) =>
        signal?.addEventListener("abort", () => resolve(), { once: true }),
      );
    }),
    seam: {
      discoverWorkItemsPage: vi.fn(async (request) => ({
        binding: request.binding,
        traversalId: request.traversalId,
        pageOrdinal: request.pageOrdinal,
        items: [],
        next: { kind: "terminal" as const },
      })),
      observeWorkItemComments: effect,
    },
    discovery: {
      scope: {
        scopeId: "scope",
        partitionId: "partition",
        stabilityId: "stable",
        stableForInvocation: true,
      },
      policy: { version: "policy-v1", filters: [] },
      limits: {
        maxPageCalls: 32,
        maxItems: 1000,
        maxEntriesPerPage: 128,
        maxCollectionValues: 128,
        maxPathSegments: 32,
        maxOpaqueValueBytes: 1024,
        maxContinuationBytes: 4096,
        maxPolicyBytes: 65536,
        maxPageBytes: 1048576,
        maxAuthorizationBytes: 262144,
      },
    },
  };
  return { options, effect, clock, timers };
};
