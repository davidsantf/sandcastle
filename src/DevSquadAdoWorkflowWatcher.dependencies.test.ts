import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import * as packageEntryPoint from "./index.js";
import type {
  DevSquadAdoWatchCandidateOutcomeKind,
  DevSquadAdoWatchReasonCode,
  DevSquadAdoWatchStopReason,
  DevSquadAdoWatcherOperationStep,
  DevSquadAdoWatcherSeamMethodName,
} from "./DevSquadAdoWorkflowWatcher.js";
import {
  cleanupWatcherRepositories,
  createDeterministicClock,
  createRecordingDelay,
  createRecordingWatcherSeam,
  createWatcherLedgerFixture,
  seedWatcherRecord,
} from "./DevSquadAdoWorkflowWatcherTestSupport.js";

/**
 * Modules that make up the watcher graph. The runtime graph is walked from the
 * public contract module; type-only imports are erased by the compiler and are
 * therefore not part of what the watcher can reach at run time.
 */
const WATCHER_ENTRY_POINT = "DevSquadAdoWorkflowWatcher.ts";

const WATCHER_MODULES = [
  "DevSquadAdoWorkflowWatcher.ts",
  "DevSquadAdoWorkflowWatcherValidation.ts",
  "DevSquadAdoWorkflowWatcherObservation.ts",
  "DevSquadAdoWorkflowWatcherPass.ts",
] as const;

const FORBIDDEN =
  /(?:Ado(?:ControlPlane|FeedbackLoop|Team|PullRequest|OneWorkItemFlow)|DevSquadSandcastleExecutionAdapter|AgentProvider|AgentStreamEmitter|Sandbox|sandboxes\/|Worktree|Docker|Podman|Orchestrator|InitService|interactive|cli|main|node:(?:http|https|http2|net|dgram|tls|dns|child_process|cluster|worker_threads|repl|vm)|undici|@azure|@octokit|mcp|simple-git|isomorphic-git)/i;

const RUNTIME_IMPORT =
  /(?:^|\n)\s*import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/g;
const EXPORT_FROM =
  /(?:^|\n)\s*export\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/g;
const ANY_SPECIFIER = /from\s+["']([^"']+)["']/g;

/** Compile-time exact-union equality, independent of member ordering. */
type Equals<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;

const REASON_CODES = [
  "new-work-item-comment",
  "new-pull-request-activity",
  "new-observations",
  "no-new-observations",
  "intake-rules-unmatched",
  "incomplete-pull-request-cursor",
  "record-not-found",
  "claim-conflict",
  "claim-expired",
  "claim-authorization",
  "stale-fencing",
  "revision-conflict",
  "state-conflict",
  "idempotency-conflict",
  "checkpoint-indeterminate",
  "observation-failed",
  "observation-timeout",
  "pull-request-observation-unavailable",
  "invalid-observation-identifier",
  "ledger-recovery",
  "ledger-capacity",
  "cancelled",
] as const;

const STOP_REASONS = [
  "candidates-resolved",
  "poll-budget-exhausted",
  "duration-budget-exhausted",
  "cancelled",
] as const;

const OUTCOME_KINDS = [
  "acted",
  "no-change",
  "intake-suppressed",
  "skipped",
  "failed",
] as const;

const OPERATION_STEPS = ["claim", "renew", "checkpoint", "release"] as const;

const SEAM_METHODS = [
  "observeWorkItemComments",
  "observePullRequestActivity",
] as const;

const REASON_UNION_IS_EXACT: Equals<
  DevSquadAdoWatchReasonCode,
  (typeof REASON_CODES)[number]
> = true;
const STOP_UNION_IS_EXACT: Equals<
  DevSquadAdoWatchStopReason,
  (typeof STOP_REASONS)[number]
> = true;
const OUTCOME_UNION_IS_EXACT: Equals<
  DevSquadAdoWatchCandidateOutcomeKind,
  (typeof OUTCOME_KINDS)[number]
> = true;
const STEP_UNION_IS_EXACT: Equals<
  DevSquadAdoWatcherOperationStep,
  (typeof OPERATION_STEPS)[number]
> = true;
const SEAM_UNION_IS_EXACT: Equals<
  DevSquadAdoWatcherSeamMethodName,
  (typeof SEAM_METHODS)[number]
> = true;

const readModule = async (filename: string): Promise<string> =>
  await readFile(fileURLToPath(new URL(filename, import.meta.url)), "utf8");

const runtimeSpecifiers = (source: string): readonly string[] => {
  const found: string[] = [];
  for (const pattern of [RUNTIME_IMPORT, EXPORT_FROM]) {
    pattern.lastIndex = 0;
    let match = pattern.exec(source);
    while (match !== null) {
      if (match[1] !== undefined) found.push(match[1]);
      match = pattern.exec(source);
    }
  }
  return found;
};

const walkRuntimeGraph = async (
  entry: string,
): Promise<ReadonlyMap<string, readonly string[]>> => {
  const graph = new Map<string, readonly string[]>();
  const queue = [entry];
  while (queue.length > 0) {
    const filename = queue.pop() as string;
    if (graph.has(filename)) continue;
    const source = await readModule(filename);
    const specifiers = runtimeSpecifiers(source);
    graph.set(filename, specifiers);
    for (const specifier of specifiers) {
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) continue;
      queue.push(specifier.replace(/^\.\//, "").replace(/\.js$/, ".ts"));
    }
  }
  return graph;
};

afterEach(cleanupWatcherRepositories);

describe("DevSquadAdoWorkflowWatcher dependency boundary", () => {
  it("[TEST-024][CC-020] reaches no network-capable, CLI, git, sandbox, agent, or control-plane module", async () => {
    const graph = await walkRuntimeGraph(WATCHER_ENTRY_POINT);
    expect(graph.size).toBeGreaterThanOrEqual(WATCHER_MODULES.length);
    for (const [filename, specifiers] of graph) {
      expect(specifiers.join("\n"), filename).not.toMatch(FORBIDDEN);
    }
    expect([...graph.keys()].sort()).toEqual(
      [
        "DevSquadAdoWorkflowLedgerSchema.ts",
        "DevSquadAdoWorkflowWatcher.ts",
        "DevSquadAdoWorkflowWatcherObservation.ts",
        "DevSquadAdoWorkflowWatcherPass.ts",
        "DevSquadAdoWorkflowWatcherValidation.ts",
      ].sort(),
    );
  });

  it("[TEST-024] keeps Effect out of every watcher module, including type positions", async () => {
    for (const filename of WATCHER_MODULES) {
      const source = await readModule(filename);
      expect(source, filename).not.toMatch(/from\s+["'](?:effect|@effect\/)/);
    }
  });

  it("[TEST-024] declares no forbidden specifier even in type-only positions", async () => {
    for (const filename of WATCHER_MODULES) {
      const source = await readModule(filename);
      ANY_SPECIFIER.lastIndex = 0;
      const specifiers = [...source.matchAll(ANY_SPECIFIER)].map(
        (match) => match[1],
      );
      expect(specifiers.join("\n"), filename).not.toMatch(FORBIDDEN);
    }
  });

  it("[TEST-024][CC-020] runs a full pass with only injected observations and repository-local state", async () => {
    const fixture = await createWatcherLedgerFixture(
      () => new Date("2026-01-01T00:00:00.000Z"),
    );
    await seedWatcherRecord(fixture.ledger, {
      workItemId: 137,
      revision: 4,
      phase: "implement",
      status: "ready",
      workItemCommentId: "480",
    });
    const seam = createRecordingWatcherSeam({
      comments: () => ({ commentIds: ["480", "481"] }),
    });
    const delaySource = createRecordingDelay({ observationTimeoutMs: 5_000 });

    const outcome = await packageEntryPoint.runDevSquadAdoWorkflowWatchPass({
      ledger: fixture.ledger,
      seam: seam.seam,
      passId: "pass-offline",
      ownerId: "watch-a",
      candidates: [137],
      intakeRules: { phases: ["implement"], statuses: ["ready"] },
      budgets: {
        maxPolls: 1,
        maxPassDurationMs: 600_000,
        observationTimeoutMs: 5_000,
      },
      clock: createDeterministicClock(["2026-01-01T00:00:10.000Z"]).clock,
      delay: delaySource.delay,
    });

    expect(outcome).toMatchObject({ ok: true });
    if (!outcome.ok) return;
    expect(outcome.value.outcomes[0]).toMatchObject({ kind: "acted" });
    expect(delaySource.backoffs()).toEqual([]);
  }, 60_000);
});

describe("DevSquadAdoWorkflowWatcher public surface", () => {
  it("[TEST-025] exposes every watcher operation from the package entry point", () => {
    expect(typeof packageEntryPoint.runDevSquadAdoWorkflowWatchPass).toBe(
      "function",
    );
    expect(
      typeof packageEntryPoint.validateDevSquadAdoWorkflowWatchPassOptions,
    ).toBe("function");
    expect(typeof packageEntryPoint.deriveDevSquadAdoWatcherOperationId).toBe(
      "function",
    );
    expect(
      packageEntryPoint.deriveDevSquadAdoWatcherOperationId({
        passId: "pass-1",
        workItemId: "137",
        step: "checkpoint",
        ordinal: 0,
      }),
    ).toMatch(/^dsw1\.checkpoint\.[0-9a-f]{32}$/);
  });

  it("[TEST-025] exports every public watcher type from the package entry point", async () => {
    const source = await readModule("index.ts");
    const exported = [
      "DevSquadAdoWatchBackoffConfig",
      "DevSquadAdoWatchBudgets",
      "DevSquadAdoWatchCandidateOutcome",
      "DevSquadAdoWatchCandidateOutcomeKind",
      "DevSquadAdoWatchClaimMetadata",
      "DevSquadAdoWatchError",
      "DevSquadAdoWatchIntakeRules",
      "DevSquadAdoWatchIntakeSignal",
      "DevSquadAdoWatchLeaseConfig",
      "DevSquadAdoWatchObservationKind",
      "DevSquadAdoWatchPassCounts",
      "DevSquadAdoWatchPassOutcome",
      "DevSquadAdoWatchPassResult",
      "DevSquadAdoWatchReasonCode",
      "DevSquadAdoWatchStopReason",
      "DevSquadAdoWatchValidatedPass",
      "DevSquadAdoWatchValidationResult",
      "DevSquadAdoWatcherObservationSeam",
      "DevSquadAdoWatcherOperationIdentity",
      "DevSquadAdoWatcherOperationStep",
      "DevSquadAdoWatcherPullRequestObservation",
      "DevSquadAdoWatcherPullRequestObservationEntry",
      "DevSquadAdoWatcherPullRequestObservationInput",
      "DevSquadAdoWatcherSeamMethodName",
      "DevSquadAdoWatcherWorkItemObservation",
      "DevSquadAdoWatcherWorkItemObservationInput",
      "RunDevSquadAdoWorkflowWatchPassOptions",
    ] as const;
    for (const name of exported) {
      expect(source, name).toContain(`  ${name},`);
    }
  });

  it("[TEST-025] pins the reason, stop, and outcome-kind unions to their documented members", async () => {
    expect(REASON_UNION_IS_EXACT).toBe(true);
    expect(STOP_UNION_IS_EXACT).toBe(true);
    expect(OUTCOME_UNION_IS_EXACT).toBe(true);
    expect(STEP_UNION_IS_EXACT).toBe(true);
    expect(SEAM_UNION_IS_EXACT).toBe(true);
    expect(REASON_CODES).toHaveLength(22);
    expect(STOP_REASONS).toHaveLength(4);

    const source = await readModule("DevSquadAdoWorkflowWatcher.ts");
    const union = (name: string): readonly string[] => {
      const start = source.indexOf(`export type ${name} =`);
      expect(start, name).toBeGreaterThan(-1);
      const end = source.indexOf(";", start);
      return [...source.slice(start, end).matchAll(/"([A-Za-z-]+)"/g)].map(
        (match) => match[1] as string,
      );
    };

    expect(union("DevSquadAdoWatchReasonCode")).toEqual([...REASON_CODES]);
    expect(union("DevSquadAdoWatchStopReason")).toEqual([...STOP_REASONS]);
    expect(union("DevSquadAdoWatchCandidateOutcomeKind")).toEqual([
      ...OUTCOME_KINDS,
    ]);
    expect(union("DevSquadAdoWatcherOperationStep")).toEqual([
      ...OPERATION_STEPS,
    ]);
    expect(union("DevSquadAdoWatcherSeamMethodName")).toEqual([
      ...SEAM_METHODS,
    ]);
    expect(union("DevSquadAdoWatchObservationKind")).toEqual([
      "work-item-comment",
      "pull-request-thread",
    ]);
  });

  it("[TEST-025] documents every public declaration with JSDoc", async () => {
    for (const filename of WATCHER_MODULES) {
      const source = await readModule(filename);
      const lines = source.split("\n");
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index] as string;
        if (!/^export (?:const|interface|type) /.test(line)) continue;
        const previous = (lines[index - 1] ?? "").trim();
        expect(
          previous === "*/" || previous.startsWith("/**"),
          `${filename}:${String(index + 1)} ${line}`,
        ).toBe(true);
      }
    }
  });
});
