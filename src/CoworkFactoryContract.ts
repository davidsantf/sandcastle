import { createHash } from "node:crypto";
import { z } from "zod";

export const coworkDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const coworkRevisionSchema = z
  .string()
  .regex(/^[a-f0-9]{40}([a-f0-9]{24})?$/);
export const coworkIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/);
export const coworkTimeSchema = z.string().datetime();
export const coworkLinkSchema = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  }, "Expected a credential-free HTTPS evidence link");

export const coworkEvidenceSchema = z
  .strictObject({
    source: coworkIdSchema,
    project: coworkIdSchema,
    revision: coworkRevisionSchema,
    observedAt: coworkTimeSchema,
    metric: coworkIdSchema,
    unit: z.enum(["count", "ms", "bytes", "ratio", "score"]),
    value: z.number().finite(),
    evaluatedScope: z.number().int().positive(),
    artifact: coworkDigestSchema,
    state: z.enum(["known", "unknown"]),
  })
  .superRefine((evidence, context) => {
    if (
      (evidence.unit !== "score" && evidence.value < 0) ||
      ((evidence.unit === "count" || evidence.unit === "bytes") &&
        !Number.isSafeInteger(evidence.value))
    )
      context.addIssue({ code: "custom", message: "Invalid metric domain" });
  });
export type CoworkEvidence = z.infer<typeof coworkEvidenceSchema>;

export const coworkTargetSchema = z.discriminatedUnion("provider", [
  z.strictObject({
    provider: z.literal("github"),
    repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  }),
  z.strictObject({
    provider: z.literal("azure-devops"),
    organization: coworkIdSchema,
    project: coworkIdSchema,
    workItemType: coworkIdSchema,
  }),
]);
export type CoworkTarget = z.infer<typeof coworkTargetSchema>;

export const coworkRuleSchema = z.strictObject({
  id: coworkIdSchema,
  version: coworkIdSchema,
  kind: z.enum([
    "error-cluster",
    "regression",
    "tool-feedback",
    "main-build",
    "instruction-budget",
    "file-budget",
    "release-recurrence",
  ]),
  project: coworkIdSchema,
  source: coworkIdSchema,
  metric: coworkIdSchema,
  unit: z.enum(["count", "ms", "bytes", "ratio", "score"]),
  direction: z.enum(["above", "below"]),
  threshold: z.number().finite(),
  maxAgeMs: z.number().int().positive().max(604800000),
  target: coworkTargetSchema,
  protectedMetric: coworkIdSchema,
});
export type CoworkRule = z.infer<typeof coworkRuleSchema>;

export const coworkImpactSchema = z.strictObject({
  upstreamProject: coworkIdSchema,
  upstreamTask: coworkIdSchema,
  upstreamChange: coworkLinkSchema,
  upstreamRevision: coworkRevisionSchema,
  contract: coworkIdSchema,
  previousDigest: coworkDigestSchema,
  requiredDigest: coworkDigestSchema,
  downstreamProject: coworkIdSchema,
  mappingDigest: coworkDigestSchema,
  lineage: z.array(coworkIdSchema).min(1).max(32),
  depth: z.number().int().nonnegative().max(32),
  budget: z.number().int().nonnegative().max(1000),
  supersedes: coworkDigestSchema.optional(),
});
export type CoworkImpact = z.infer<typeof coworkImpactSchema>;

export const coworkCandidateSchema = z
  .strictObject({
    key: coworkDigestSchema,
    kind: z.enum(["engineering", "compatibility"]),
    project: coworkIdSchema,
    rule: z.strictObject({ id: coworkIdSchema, version: coworkIdSchema }),
    target: coworkTargetSchema,
    evidence: coworkEvidenceSchema,
    acceptance: z.array(z.string().min(1).max(1000)).min(2).max(10),
    impact: coworkImpactSchema.optional(),
  })
  .superRefine((candidate, context) => {
    const impact = candidate.impact;
    if (candidate.kind === "engineering") {
      if (impact || candidate.project !== candidate.evidence.project)
        context.addIssue({
          code: "custom",
          message: "Engineering candidate provenance mismatch",
        });
    } else if (
      !impact ||
      impact.downstreamProject !== candidate.project ||
      impact.upstreamProject !== candidate.evidence.project ||
      impact.upstreamRevision !== candidate.evidence.revision ||
      impact.contract !== candidate.evidence.metric ||
      impact.previousDigest === impact.requiredDigest ||
      impact.depth !== impact.lineage.length - 1 ||
      impact.lineage.at(-1) !== candidate.project ||
      new Set(impact.lineage).size !== impact.lineage.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Compatibility candidate provenance mismatch",
      });
    }
  });
export type CoworkCandidate = z.infer<typeof coworkCandidateSchema>;

export const coworkProposalSchema = z.strictObject({
  intent: coworkDigestSchema,
  candidate: coworkCandidateSchema,
  title: z.string().min(1).max(300),
  body: z.string().min(1).max(10000),
});
export type CoworkProposal = z.infer<typeof coworkProposalSchema>;

export const coworkItemReceiptSchema = z.strictObject({
  id: coworkIdSchema,
  url: coworkLinkSchema,
  intent: coworkDigestSchema,
  targetDigest: coworkDigestSchema,
});
export type CoworkItemReceipt = z.infer<typeof coworkItemReceiptSchema>;

const intakeRecord = z.strictObject({
  kind: z.literal("intake"),
  intent: coworkDigestSchema,
  evidence: coworkEvidenceSchema,
  state: z.enum(["blocked", "no-match", "candidate"]),
  reason: coworkIdSchema,
});
const candidateRecord = z.strictObject({
  kind: z.literal("candidate"),
  intent: coworkDigestSchema,
  candidate: coworkCandidateSchema,
});
const publicationRecord = z.strictObject({
  kind: z.literal("publication"),
  intent: coworkDigestSchema,
  proposal: coworkProposalSchema,
  state: z.enum(["reserved", "completed", "unknown"]),
  receipt: coworkItemReceiptSchema.optional(),
});
const measurementRecord = z.strictObject({
  kind: z.literal("measurement"),
  intent: coworkDigestSchema,
  loopId: coworkIdSchema,
  policy: z.strictObject({ id: coworkIdSchema, version: coworkIdSchema }),
  policyDigest: coworkDigestSchema,
  context: z
    .strictObject({
      project: coworkIdSchema,
      baseRevision: coworkRevisionSchema,
      revision: coworkRevisionSchema,
      artifact: coworkDigestSchema,
    })
    .optional(),
  attempt: z.number().int().positive().max(1000),
  signature: coworkDigestSchema,
  deadline: coworkTimeSchema,
  target: z.string().min(1).max(1000),
  protectedMetric: coworkIdSchema,
  state: z.enum(["reserved", "keep", "reject", "inconclusive", "stopped"]),
  evidence: z.array(coworkDigestSchema).max(100),
  reason: coworkIdSchema,
  humanActions: z.array(z.string().min(1).max(1000)).max(10),
});
const releaseRecord = z.strictObject({
  kind: z.literal("release"),
  intent: coworkDigestSchema,
  project: coworkIdSchema,
  mergedRevision: coworkRevisionSchema,
  originatingCandidate: coworkDigestSchema,
  state: z.enum([
    "awaiting-evidence",
    "blocked",
    "verified",
    "resurfaced",
    "inconclusive",
  ]),
  evidence: z.array(coworkDigestSchema).max(100),
  reason: coworkIdSchema,
  recurrence: coworkDigestSchema.optional(),
});
export const coworkFactoryRecordSchema = z.discriminatedUnion("kind", [
  intakeRecord,
  candidateRecord,
  publicationRecord,
  measurementRecord,
  releaseRecord,
]);
export type CoworkFactoryRecord = z.infer<typeof coworkFactoryRecordSchema>;
export type CoworkMeasurementRecord = z.infer<typeof measurementRecord>;

export interface CoworkFactoryEvent {
  readonly kind: CoworkFactoryRecord["kind"];
  readonly intent: string;
  readonly at: string;
  readonly recordDigest: string;
}

/** Implement with the core journal's same-DB fenced CAS and atomic event append. */
export interface CoworkFactoryStore {
  read(
    key: string,
  ): Promise<{ readonly version: number; readonly value: unknown }>;
  compareAndSwap(
    key: string,
    expectedVersion: number,
    record: CoworkFactoryRecord,
    event: CoworkFactoryEvent,
  ): Promise<boolean>;
}

export function coworkDigest(value: unknown): string {
  function canonical(input: unknown): string {
    if (
      input === null ||
      typeof input === "boolean" ||
      typeof input === "string"
    )
      return JSON.stringify(input);
    if (typeof input === "number" && Number.isFinite(input))
      return JSON.stringify(input);
    if (Array.isArray(input)) return `[${input.map(canonical).join(",")}]`;
    if (
      typeof input === "object" &&
      input !== null &&
      (Object.getPrototypeOf(input) === Object.prototype ||
        Object.getPrototypeOf(input) === null)
    )
      return `{${Object.entries(input)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
        .join(",")}}`;
    throw new Error("Cowork digest requires finite JSON data");
  }
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export function coworkFreeze<T>(value: T): T {
  const copy: T = structuredClone(value);
  const freeze = (input: unknown): void => {
    if (input !== null && typeof input === "object") {
      Object.values(input).forEach(freeze);
      Object.freeze(input);
    }
  };
  freeze(copy);
  return copy;
}

export const coworkStoreKey = (identity: string): string =>
  `factory:${coworkDigestSchema.parse(identity)}`;

export async function coworkBounded<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parent?: AbortSignal,
  deadline?: string,
): Promise<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000)
    throw new Error("Cowork timeout must be 1..300000ms");
  const remaining = deadline
    ? Math.min(
        timeoutMs,
        Date.parse(coworkTimeSchema.parse(deadline)) - Date.now(),
      )
    : timeoutMs;
  if (remaining <= 0 || parent?.aborted)
    throw new Error("Cowork deadline or cancellation");
  const controller = new AbortController();
  let rejectAbort: (reason: Error) => void = () => {};
  const abort = () => {
    controller.abort();
    rejectAbort(new Error("Cowork deadline or cancellation"));
  };
  const interrupted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  parent?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, remaining);
  const started = Date.now();
  try {
    const result = await Promise.race([
      operation(controller.signal),
      interrupted,
    ]);
    if (
      Date.now() - started >= remaining ||
      controller.signal.aborted ||
      parent?.aborted
    )
      throw new Error("Cowork deadline or cancellation");
    return result;
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", abort);
  }
}

export async function readCoworkRecord(
  store: CoworkFactoryStore,
  identity: string,
) {
  const row = await store.read(coworkStoreKey(identity));
  if (
    !Number.isSafeInteger(row.version) ||
    row.version < 0 ||
    (row.value === null) !== (row.version === 0)
  )
    throw new Error("Invalid Cowork store version");
  return {
    version: row.version,
    value:
      row.value === null ? null : coworkFactoryRecordSchema.parse(row.value),
  };
}

export async function writeCoworkRecord(
  store: CoworkFactoryStore,
  identity: string,
  version: number,
  record: CoworkFactoryRecord,
  at: string,
): Promise<boolean> {
  const snapshot = coworkFreeze(coworkFactoryRecordSchema.parse(record));
  return store.compareAndSwap(
    coworkStoreKey(identity),
    version,
    snapshot,
    coworkFreeze({
      kind: snapshot.kind,
      intent: snapshot.intent,
      at: coworkTimeSchema.parse(at),
      recordDigest: coworkDigest(snapshot),
    }),
  );
}
