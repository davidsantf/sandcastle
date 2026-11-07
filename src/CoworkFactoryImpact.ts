import { z } from "zod";
import {
  coworkBounded,
  coworkCandidateSchema,
  coworkDigest,
  coworkDigestSchema,
  coworkEvidenceSchema,
  coworkFreeze,
  coworkIdSchema,
  coworkLinkSchema,
  coworkRevisionSchema,
  coworkTargetSchema,
  coworkTimeSchema,
  readCoworkRecord,
  writeCoworkRecord,
  type CoworkCandidate,
  type CoworkFactoryStore,
  type CoworkItemReceipt,
} from "./CoworkFactoryContract.js";
import {
  proposeCoworkItem,
  type CoworkPublicationResult,
} from "./CoworkFactory.js";

export const coworkContractChangeSchema = z.strictObject({
  project: coworkIdSchema,
  task: coworkIdSchema,
  change: coworkLinkSchema,
  revision: coworkRevisionSchema,
  baseRevision: coworkRevisionSchema,
  observedAt: coworkTimeSchema,
  artifact: coworkDigestSchema,
  contracts: z
    .array(
      z.strictObject({
        name: coworkIdSchema,
        before: coworkDigestSchema,
        after: coworkDigestSchema,
      }),
    )
    .min(1)
    .max(100),
  lineage: z.array(coworkIdSchema).min(1).max(32),
  depth: z.number().int().nonnegative().max(32),
  budget: z.number().int().positive().max(1000),
});
export type CoworkContractChange = z.infer<typeof coworkContractChangeSchema>;

export const coworkConsumerMappingSchema = z.strictObject({
  producer: coworkIdSchema,
  consumer: coworkIdSchema,
  contract: coworkIdSchema,
  consumedDigest: coworkDigestSchema,
  target: coworkTargetSchema,
  rule: z.strictObject({ id: coworkIdSchema, version: coworkIdSchema }),
  mappingDigest: coworkDigestSchema,
  supersedes: coworkDigestSchema.optional(),
});
export type CoworkConsumerMapping = z.infer<typeof coworkConsumerMappingSchema>;

export interface CoworkImpactHost {
  verifyChange(
    change: CoworkContractChange,
    signal: AbortSignal,
  ): Promise<boolean>;
  verifyMapping(
    mapping: CoworkConsumerMapping,
    signal: AbortSignal,
  ): Promise<boolean>;
}

export interface CoworkImpactResult {
  readonly candidates: readonly CoworkCandidate[];
  readonly blocked: readonly {
    readonly consumer: string;
    readonly reason: string;
  }[];
  readonly unaffected: readonly string[];
}

export async function evaluateCoworkImpact(
  changeInput: CoworkContractChange,
  mappingInputs: readonly CoworkConsumerMapping[],
  options: {
    readonly now: string;
    readonly maxAgeMs: number;
    readonly maxDepth: number;
    readonly host: CoworkImpactHost;
    readonly signal?: AbortSignal;
  },
): Promise<CoworkImpactResult> {
  const parsed = coworkContractChangeSchema.safeParse(changeInput);
  const mappingsParsed = z
    .array(coworkConsumerMappingSchema)
    .max(1000)
    .safeParse(mappingInputs);
  const blocked = (reason: string): CoworkImpactResult => ({
    candidates: [],
    unaffected: [],
    blocked: [{ consumer: "unknown", reason }],
  });
  if (
    !parsed.success ||
    !mappingsParsed.success ||
    !coworkTimeSchema.safeParse(options.now).success ||
    !Number.isSafeInteger(options.maxAgeMs) ||
    options.maxAgeMs <= 0 ||
    !Number.isSafeInteger(options.maxDepth) ||
    options.maxDepth < 1 ||
    options.maxDepth > 32
  )
    return blocked("invalid-impact-input");
  const change = coworkFreeze(parsed.data);
  const mappings = coworkFreeze(mappingsParsed.data);
  const signal = options.signal ?? new AbortController().signal;
  const age = Date.parse(options.now) - Date.parse(change.observedAt);
  if (age < 0 || age > options.maxAgeMs) return blocked("stale-impact");
  if (
    change.revision === change.baseRevision ||
    new Set(change.contracts.map((c) => c.name)).size !==
      change.contracts.length ||
    new Set(change.lineage).size !== change.lineage.length ||
    change.lineage.at(-1) !== change.project ||
    change.depth !== change.lineage.length - 1
  )
    return blocked("invalid-impact-provenance");
  if (
    signal.aborted ||
    !(await coworkBounded(
      (signal) => options.host.verifyChange(change, signal),
      30000,
      signal,
    ))
  )
    return blocked("unverified-impact");
  const result: {
    candidates: CoworkCandidate[];
    blocked: { consumer: string; reason: string }[];
    unaffected: string[];
  } = { candidates: [], blocked: [], unaffected: [] };
  const ordered = [...mappings].sort((a, b) =>
    `${a.consumer}:${a.contract}:${a.rule.id}`.localeCompare(
      `${b.consumer}:${b.contract}:${b.rule.id}`,
    ),
  );
  const seen = new Set<string>();
  for (const mapping of ordered) {
    if (mapping.producer !== change.project) continue;
    const identity = `${mapping.consumer}:${mapping.contract}:${mapping.rule.id}:${mapping.rule.version}`;
    if (seen.has(identity)) {
      result.blocked.push({
        consumer: mapping.consumer,
        reason: "duplicate-mapping",
      });
      // Ambiguous mappings must not retain a candidate from the earlier mapping.
      result.candidates = result.candidates.filter(
        (c) =>
          !(
            c.project === mapping.consumer &&
            c.impact?.contract === mapping.contract &&
            c.rule.id === mapping.rule.id &&
            c.rule.version === mapping.rule.version
          ),
      );
      continue;
    }
    seen.add(identity);
    const contract = change.contracts.find((c) => c.name === mapping.contract);
    if (!contract) {
      result.blocked.push({
        consumer: mapping.consumer,
        reason: "missing-contract-evidence",
      });
      continue;
    }
    if (
      contract.before === contract.after ||
      mapping.consumedDigest === contract.after
    ) {
      result.unaffected.push(mapping.consumer);
      continue;
    }
    let reason: string | undefined;
    if (mapping.consumedDigest !== contract.before)
      reason = "unknown-consumed-version";
    else if (change.lineage.includes(mapping.consumer))
      reason = "propagation-cycle";
    else if (change.depth + 1 > options.maxDepth) reason = "propagation-depth";
    else if (result.candidates.length >= change.budget)
      reason = "propagation-budget";
    else if (
      signal.aborted ||
      !(await coworkBounded(
        (signal) => options.host.verifyMapping(mapping, signal),
        30000,
        signal,
      ))
    )
      reason = "unverified-mapping";
    if (reason) {
      result.blocked.push({ consumer: mapping.consumer, reason });
      continue;
    }
    const key = coworkDigest({
      upstreamChange: change.change,
      revision: change.revision,
      requiredDigest: contract.after,
      downstream: mapping.consumer,
      contract: mapping.contract,
      rule: mapping.rule,
      target: mapping.target,
      mappingDigest: mapping.mappingDigest,
    });
    result.candidates.push(
      coworkCandidateSchema.parse({
        key,
        kind: "compatibility",
        project: mapping.consumer,
        rule: mapping.rule,
        target: mapping.target,
        evidence: coworkEvidenceSchema.parse({
          source: change.task,
          project: change.project,
          revision: change.revision,
          observedAt: change.observedAt,
          metric: mapping.contract,
          unit: "count",
          value: 1,
          evaluatedScope: 1,
          artifact: change.artifact,
          state: "known",
        }),
        acceptance: [
          `Match ${mapping.contract} contract ${contract.after} from ${change.project}.`,
          `Execute producer-consumer compatibility tests with nonzero assertions; preserve downstream behavior.`,
        ],
        impact: {
          upstreamProject: change.project,
          upstreamTask: change.task,
          upstreamChange: change.change,
          upstreamRevision: change.revision,
          contract: mapping.contract,
          previousDigest: contract.before,
          requiredDigest: contract.after,
          downstreamProject: mapping.consumer,
          mappingDigest: mapping.mappingDigest,
          lineage: [...change.lineage, mapping.consumer],
          depth: change.depth + 1,
          budget: change.budget - 1,
          ...(mapping.supersedes ? { supersedes: mapping.supersedes } : {}),
        },
      }),
    );
  }
  // Split the remaining global budget between children instead of multiplying it on fan-out.
  const remaining = change.budget - result.candidates.length;
  result.candidates.forEach((candidate, index) => {
    candidate.impact!.budget =
      Math.floor(remaining / result.candidates.length) +
      (index < remaining % result.candidates.length ? 1 : 0);
  });
  return coworkFreeze(result);
}

export async function persistCoworkImpact(
  result: CoworkImpactResult,
  store: CoworkFactoryStore,
  now: string,
): Promise<readonly CoworkCandidate[]> {
  const retained: CoworkCandidate[] = [];
  for (const candidate of result.candidates) {
    const parsed = coworkCandidateSchema.parse(candidate);
    const headKey = coworkDigest({
      impactHead: parsed.impact?.upstreamProject,
      downstream: parsed.project,
      contract: parsed.impact?.contract,
      rule: parsed.rule,
      target: parsed.target,
    });
    const head = await readCoworkRecord(store, headKey);
    const prior = await readCoworkRecord(store, parsed.key);
    if (prior.value) {
      if (
        prior.value.kind !== "candidate" ||
        coworkDigest(prior.value.candidate) !== coworkDigest(parsed)
      )
        throw new Error("Conflicting compatibility candidate");
      retained.push(prior.value.candidate);
    } else {
      if (
        head.value &&
        (head.value.kind !== "candidate" ||
          parsed.impact?.supersedes !== head.value.candidate.key)
      )
        throw new Error(
          "New upstream revision requires explicit compatibility follow-up",
        );
      if (
        !(await writeCoworkRecord(
          store,
          parsed.key,
          0,
          {
            kind: "candidate",
            intent: coworkDigest(parsed),
            candidate: parsed,
          },
          now,
        ))
      )
        throw new Error("Compatibility candidate CAS conflict");
      retained.push(parsed);
    }
    if (
      !head.value ||
      (head.value.kind === "candidate" &&
        parsed.impact?.supersedes === head.value.candidate.key)
    ) {
      if (
        !(await writeCoworkRecord(
          store,
          headKey,
          head.version,
          {
            kind: "candidate",
            intent: coworkDigest(parsed),
            candidate: parsed,
          },
          now,
        ))
      )
        throw new Error("Compatibility follow-up CAS conflict");
    }
  }
  return coworkFreeze(retained);
}

export interface CoworkCompatibilityTask {
  readonly id: string;
  readonly project: string;
  readonly kind: "compatibility";
  readonly sourceItem: {
    readonly target: CoworkCandidate["target"];
    readonly receipt: CoworkItemReceipt;
  };
  readonly origin: NonNullable<CoworkCandidate["impact"]>;
  readonly acceptance: readonly string[];
  readonly contracts: Readonly<Record<string, string>>;
  readonly registration: "awaiting-change-request";
  readonly cause: {
    readonly recordKey: string;
    readonly recordVersion: number;
    readonly recordDigest: string;
  };
}

/** Core must verify the retained completed record and route before catalog append. */
export function coworkCompatibilityTask(
  input: CoworkCandidate,
  published: Extract<CoworkPublicationResult, { state: "completed" }>,
): CoworkCompatibilityTask {
  const candidate = coworkCandidateSchema.parse(input);
  const impact = candidate.impact;
  if (
    candidate.kind !== "compatibility" ||
    !impact ||
    published.receipt.targetDigest !== coworkDigest(candidate.target) ||
    published.receipt.intent !== proposeCoworkItem(candidate).intent ||
    published.recordKey !==
      `factory:${coworkDigest({
        publication: candidate.key,
        target: candidate.target,
      })}` ||
    !coworkDigestSchema.safeParse(published.recordDigest).success ||
    published.recordVersion < 2
  )
    throw new Error(
      "A verified completed compatibility publication is required",
    );
  return coworkFreeze({
    id: `compat-${candidate.key}`,
    project: candidate.project,
    kind: "compatibility",
    sourceItem: { target: candidate.target, receipt: published.receipt },
    origin: impact,
    acceptance: candidate.acceptance,
    contracts: { [impact.contract]: impact.requiredDigest },
    registration: "awaiting-change-request",
    cause: {
      recordKey: published.recordKey,
      recordVersion: published.recordVersion,
      recordDigest: published.recordDigest,
    },
  });
}
