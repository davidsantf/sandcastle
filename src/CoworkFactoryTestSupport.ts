import {
  coworkDigest,
  type CoworkEvidence,
  type CoworkFactoryEvent,
  type CoworkFactoryRecord,
  type CoworkFactoryStore,
  type CoworkRule,
} from "./CoworkFactoryContract.js";
import type { CoworkItemHost } from "./CoworkFactory.js";
import type {
  CoworkContractChange,
  CoworkConsumerMapping,
} from "./CoworkFactoryImpact.js";
import type {
  CoworkExecutionEvidence,
  CoworkLoopPolicy,
} from "./CoworkMeasuredLoops.js";

export const NOW = "2026-11-07T04:00:00.000Z";
export const BASE = "a".repeat(40),
  REV = "b".repeat(40),
  NEXT = "c".repeat(40);
export const HASH = "d".repeat(64),
  OTHER = "e".repeat(64);

/** Test-only, shared-object restart fake. Not a durable production ledger. */
export class CoworkMemoryStore implements CoworkFactoryStore {
  readonly rows = new Map<
    string,
    { version: number; value: CoworkFactoryRecord }
  >();
  readonly events: CoworkFactoryEvent[] = [];
  async read(key: string) {
    return structuredClone(this.rows.get(key) ?? { version: 0, value: null });
  }
  async compareAndSwap(
    key: string,
    expectedVersion: number,
    value: CoworkFactoryRecord,
    event: CoworkFactoryEvent,
  ) {
    if ((this.rows.get(key)?.version ?? 0) !== expectedVersion) return false;
    this.rows.set(key, {
      version: expectedVersion + 1,
      value: structuredClone(value),
    });
    this.events.push(structuredClone(event));
    return true;
  }
}
export const evidence = (): CoworkEvidence => ({
  source: "ci-main",
  project: "A",
  revision: REV,
  observedAt: NOW,
  metric: "failures",
  unit: "count",
  value: 3,
  evaluatedScope: 4,
  artifact: HASH,
  state: "known",
});
export const rule = (): CoworkRule => ({
  id: "main-failures",
  version: "1",
  kind: "main-build",
  project: "A",
  source: "ci-main",
  metric: "failures",
  unit: "count",
  direction: "above",
  threshold: 0,
  maxAgeMs: 60000,
  target: { provider: "github", repository: "example/A" },
  protectedMetric: "compatibility",
});
export function itemHost(): CoworkItemHost & {
  writes: number;
  authorized: boolean;
} {
  return {
    writes: 0,
    authorized: true,
    async verifyEvidence() {
      return true;
    },
    async authorize() {
      return this.authorized;
    },
    async audit() {
      return true;
    },
    async create(item, intent) {
      this.writes++;
      const target =
        item.provider === "github"
          ? { provider: item.provider, repository: item.repository }
          : {
              provider: item.provider,
              organization: item.organization,
              project: item.project,
              workItemType: item.workItemType,
            };
      return {
        state: "completed",
        receipt: {
          id: `item-${this.writes}`,
          url: `https://example.test/items/${this.writes}`,
          intent,
          targetDigest: coworkDigest(target),
        },
      };
    },
    async verifyReceipt(proposal, receipt) {
      return (
        receipt.intent === proposal.intent &&
        receipt.targetDigest === coworkDigest(proposal.candidate.target)
      );
    },
  };
}
export const change = (): CoworkContractChange => ({
  project: "A",
  task: "A-7",
  change: "https://example.test/A/pull/7",
  revision: REV,
  baseRevision: BASE,
  observedAt: NOW,
  artifact: HASH,
  contracts: [{ name: "api", before: HASH, after: OTHER }],
  lineage: ["A"],
  depth: 0,
  budget: 5,
});
export const mapping = (consumer = "B"): CoworkConsumerMapping => ({
  producer: "A",
  consumer,
  contract: "api",
  consumedDigest: HASH,
  target: { provider: "github", repository: `example/${consumer}` },
  rule: { id: "api-match", version: "1" },
  mappingDigest: HASH,
});
export const policy = (): CoworkLoopPolicy => ({
  id: "conservative",
  version: "1",
  maxAttempts: 3,
  repeatedSignatureLimit: 2,
  deadline: "2026-11-07T05:00:00.000Z",
  target: "Nonzero fail-before-fix tests pass",
  protectedMetric: "compatibility",
  humanActions: ["Inspect evidence; authorize a narrow follow-up."],
});
export function execution(
  role: "baseline" | "candidate",
  repeat = 1,
): CoworkExecutionEvidence {
  return {
    executionId: `${role}-${repeat}`,
    source: "isolated-runner",
    project: "A",
    revision: role === "baseline" ? BASE : REV,
    role,
    artifact: HASH,
    observedAt: NOW,
    environment: HASH,
    workload: OTHER,
    fixtureId: `fixture-${role}-${repeat}`,
    isolated: true,
    testIds: ["case-1"],
    assertionIds: ["changed-behavior", "protected"],
    evaluatedScope: 1,
    targetChecks: [{ name: "changed-behavior", passed: role === "candidate" }],
    protectedChecks: [{ name: "protected", passed: true }],
    regressions: 0,
  };
}
