import {
  coworkBounded,
  coworkCandidateSchema,
  coworkDigest,
  coworkEvidenceSchema,
  coworkFactoryRecordSchema,
  coworkFreeze,
  coworkItemReceiptSchema,
  coworkProposalSchema,
  coworkRuleSchema,
  coworkTimeSchema,
  readCoworkRecord,
  writeCoworkRecord,
  type CoworkCandidate,
  type CoworkEvidence,
  type CoworkFactoryStore,
  type CoworkItemReceipt,
  type CoworkProposal,
  type CoworkRule,
} from "./CoworkFactoryContract.js";

export type CoworkSignalDecision =
  | { readonly state: "blocked" | "no-match"; readonly reason: string }
  | { readonly state: "candidate"; readonly candidate: CoworkCandidate };

export function evaluateCoworkSignal(
  evidenceInput: CoworkEvidence,
  ruleInput: CoworkRule,
  now: string,
): CoworkSignalDecision {
  const evidence = coworkEvidenceSchema.safeParse(evidenceInput);
  const rule = coworkRuleSchema.safeParse(ruleInput);
  if (
    !evidence.success ||
    !rule.success ||
    !coworkTimeSchema.safeParse(now).success
  )
    return { state: "blocked", reason: "invalid-evidence-or-rule" };
  const e = evidence.data;
  const r = rule.data;
  if (e.state !== "known")
    return { state: "blocked", reason: "unknown-evidence" };
  const age = Date.parse(now) - Date.parse(e.observedAt);
  if (age < 0 || age > r.maxAgeMs)
    return { state: "blocked", reason: "stale-evidence" };
  if (
    e.project !== r.project ||
    e.source !== r.source ||
    e.metric !== r.metric ||
    e.unit !== r.unit
  )
    return { state: "blocked", reason: "incomparable-evidence" };
  if (
    !(r.direction === "above" ? e.value > r.threshold : e.value < r.threshold)
  )
    return { state: "no-match", reason: "threshold-not-crossed" };
  const key = coworkDigest({
    project: e.project,
    source: e.source,
    revision: e.revision,
    metric: e.metric,
    rule: r.id,
    version: r.version,
    target: r.target,
  });
  return {
    state: "candidate",
    candidate: coworkCandidateSchema.parse({
      key,
      kind: "engineering",
      project: e.project,
      rule: { id: r.id, version: r.version },
      target: r.target,
      evidence: e,
      acceptance: [
        `${e.metric} (${e.unit}) must be ${r.direction === "above" ? "<=" : ">="} ${r.threshold}.`,
        `Execute nonzero relevant checks; preserve ${r.protectedMetric} without regression.`,
      ],
    }),
  };
}

export async function intakeCoworkSignal(
  input: { evidence: CoworkEvidence; rule: CoworkRule; now: string },
  store: CoworkFactoryStore,
): Promise<CoworkSignalDecision & { readonly persisted: boolean }> {
  const decision = evaluateCoworkSignal(input.evidence, input.rule, input.now);
  const evidence = coworkEvidenceSchema.safeParse(input.evidence);
  const rule = coworkRuleSchema.safeParse(input.rule);
  if (
    !evidence.success ||
    !rule.success ||
    !coworkTimeSchema.safeParse(input.now).success
  )
    return { ...decision, persisted: false };
  const identity = coworkDigest({ intake: evidence.data, rule: rule.data });
  const existing = await readCoworkRecord(store, identity);
  if (
    !existing.value &&
    !(await writeCoworkRecord(
      store,
      identity,
      existing.version,
      {
        kind: "intake",
        intent: identity,
        evidence: evidence.data,
        state: decision.state,
        reason:
          decision.state === "candidate"
            ? "threshold-crossed"
            : decision.reason,
      },
      input.now,
    ))
  )
    return { state: "blocked", reason: "intake-conflict", persisted: false };
  if (decision.state === "candidate") {
    const row = await readCoworkRecord(store, decision.candidate.key);
    if (row.value) {
      if (
        row.value.kind !== "candidate" ||
        row.value.candidate.key !== decision.candidate.key
      )
        return {
          state: "blocked",
          reason: "candidate-conflict",
          persisted: false,
        };
      return {
        state: "candidate",
        candidate: row.value.candidate,
        persisted: true,
      };
    }
    const written = await writeCoworkRecord(
      store,
      decision.candidate.key,
      row.version,
      {
        kind: "candidate",
        intent: coworkDigest(decision.candidate),
        candidate: decision.candidate,
      },
      input.now,
    );
    if (!written)
      return {
        state: "blocked",
        reason: "candidate-conflict",
        persisted: false,
      };
  }
  return { ...decision, persisted: true };
}

export function proposeCoworkItem(input: CoworkCandidate): CoworkProposal {
  const candidate = coworkCandidateSchema.parse(input);
  const title =
    candidate.kind === "compatibility"
      ? `Match ${candidate.impact?.contract} contract in ${candidate.project}`
      : `Resolve ${candidate.evidence.metric} in ${candidate.project}`;
  const impact = candidate.impact;
  const body = [
    `Rule: ${candidate.rule.id}@${candidate.rule.version}`,
    `Source: ${candidate.evidence.source}`,
    `Revision: ${candidate.evidence.revision}`,
    `Evidence: ${candidate.evidence.artifact}`,
    `Observed: ${candidate.evidence.value} ${candidate.evidence.unit}`,
    ...(impact
      ? [
          `Upstream task: ${impact.upstreamTask}`,
          `Upstream change: ${impact.upstreamChange}`,
          `Required contract: ${impact.contract}@${impact.requiredDigest}`,
          `Mapping: ${impact.mappingDigest}`,
          `Lineage: ${impact.lineage.join(" -> ")}`,
          ...(impact.supersedes ? [`Follows up: ${impact.supersedes}`] : []),
        ]
      : []),
    "",
    "Acceptance:",
    ...candidate.acceptance.map((check) => `- ${check}`),
    "",
    `Deduplication: ${candidate.key}`,
  ].join("\n");
  return coworkFreeze({
    candidate,
    title,
    body,
    intent: coworkDigest({ candidate, title, body }),
  });
}

export type CoworkNativeItem =
  | {
      readonly provider: "github";
      readonly repository: string;
      readonly title: string;
      readonly body: string;
    }
  | {
      readonly provider: "azure-devops";
      readonly organization: string;
      readonly project: string;
      readonly workItemType: string;
      readonly fields: {
        readonly "System.Title": string;
        readonly "System.Description": string;
      };
    };

export function normalizeCoworkItem(
  proposal: CoworkProposal,
): CoworkNativeItem {
  const p = coworkProposalSchema.parse(proposal);
  const t = p.candidate.target;
  return t.provider === "github"
    ? { ...t, title: p.title, body: p.body }
    : {
        ...t,
        fields: { "System.Title": p.title, "System.Description": p.body },
      };
}

export interface CoworkItemHost {
  /** Trusted configured routes may authorize automatically; the proposal itself cannot. */
  authorize(proposal: CoworkProposal, signal: AbortSignal): Promise<boolean>;
  verifyEvidence(
    candidate: CoworkCandidate,
    signal: AbortSignal,
  ): Promise<boolean>;
  audit(proposal: CoworkProposal, signal: AbortSignal): Promise<boolean>;
  create(
    item: CoworkNativeItem,
    intent: string,
    signal: AbortSignal,
  ): Promise<
    | { readonly state: "completed"; readonly receipt: CoworkItemReceipt }
    | { readonly state: "unknown" | "failed" }
  >;
  verifyReceipt(
    proposal: CoworkProposal,
    receipt: CoworkItemReceipt,
    signal: AbortSignal,
  ): Promise<boolean>;
}

export type CoworkPublicationResult =
  | { readonly state: "preview"; readonly proposal: CoworkProposal }
  | { readonly state: "blocked" | "unknown"; readonly reason: string }
  | {
      readonly state: "completed";
      readonly receipt: CoworkItemReceipt;
      readonly recordKey: string;
      readonly recordVersion: number;
      readonly recordDigest: string;
    };

function publicationIdentity(proposal: CoworkProposal): string {
  return coworkDigest({
    publication: proposal.candidate.key,
    target: proposal.candidate.target,
  });
}

function validReceipt(
  proposal: CoworkProposal,
  receipt: CoworkItemReceipt,
): boolean {
  return (
    coworkItemReceiptSchema.safeParse(receipt).success &&
    receipt.intent === proposal.intent &&
    receipt.targetDigest === coworkDigest(proposal.candidate.target)
  );
}

function completedPublication(
  proposal: CoworkProposal,
  receipt: CoworkItemReceipt,
  version: number,
  record: unknown,
): CoworkPublicationResult {
  return {
    state: "completed",
    receipt: coworkFreeze(receipt),
    recordKey: `factory:${publicationIdentity(proposal)}`,
    recordVersion: version,
    recordDigest: coworkDigest(record),
  };
}

export async function publishCoworkItem(
  proposalInput: CoworkProposal,
  options: {
    readonly mode?: "preview" | "publish";
    readonly now: string;
    readonly store: CoworkFactoryStore;
    readonly host: CoworkItemHost;
    readonly signal?: AbortSignal;
    readonly timeoutMs?: number;
  },
): Promise<CoworkPublicationResult> {
  const parsed = coworkProposalSchema.safeParse(proposalInput);
  if (!parsed.success || !coworkTimeSchema.safeParse(options.now).success)
    return { state: "blocked", reason: "invalid-proposal" };
  const proposal = coworkFreeze(parsed.data);
  if (
    proposeCoworkItem(proposal.candidate).intent !== proposal.intent ||
    coworkDigest({
      candidate: proposal.candidate,
      title: proposal.title,
      body: proposal.body,
    }) !== proposal.intent
  )
    return { state: "blocked", reason: "proposal-intent-mismatch" };
  if (options.mode !== "publish") return { state: "preview", proposal };
  const signal = options.signal ?? new AbortController().signal;
  const call = <T>(fn: (signal: AbortSignal) => Promise<T>) =>
    coworkBounded(fn, options.timeoutMs ?? 30000, signal);
  const identity = publicationIdentity(proposal);
  const prior = await readCoworkRecord(options.store, identity);
  if (prior.value) {
    if (
      prior.value.kind !== "publication" ||
      prior.value.intent !== proposal.intent
    )
      return { state: "blocked", reason: "publication-conflict" };
    const retainedReceipt = prior.value.receipt;
    if (
      prior.value.state === "completed" &&
      retainedReceipt &&
      validReceipt(proposal, retainedReceipt) &&
      (await call((signal) =>
        options.host.verifyReceipt(
          proposal,
          coworkFreeze(retainedReceipt),
          signal,
        ),
      ))
    )
      return completedPublication(
        proposal,
        retainedReceipt,
        prior.version,
        prior.value,
      );
    return {
      state: "unknown",
      reason: "retained-reservation-requires-reconciliation",
    };
  }
  if (
    signal.aborted ||
    !(await call((signal) =>
      options.host.verifyEvidence(proposal.candidate, signal),
    )) ||
    !(await call((signal) => options.host.authorize(proposal, signal))) ||
    !(await call((signal) => options.host.audit(proposal, signal))) ||
    signal.aborted
  )
    return {
      state: "blocked",
      reason: "host-authorization-or-evidence-unavailable",
    };
  const reserved = coworkFactoryRecordSchema.parse({
    kind: "publication",
    intent: proposal.intent,
    proposal,
    state: "reserved",
  });
  if (
    !(await writeCoworkRecord(
      options.store,
      identity,
      0,
      reserved,
      options.now,
    ))
  )
    return { state: "unknown", reason: "reservation-conflict" };
  // A thrown transport can have written remotely. The retained reservation forbids retry.
  let outcome: Awaited<ReturnType<CoworkItemHost["create"]>>;
  try {
    if (signal.aborted)
      return { state: "unknown", reason: "cancelled-after-reservation" };
    outcome = await call((signal) =>
      options.host.create(
        coworkFreeze(normalizeCoworkItem(proposal)),
        proposal.intent,
        signal,
      ),
    );
  } catch {
    return { state: "unknown", reason: "transport-outcome-unknown" };
  }
  const receipt = outcome.state === "completed" ? outcome.receipt : undefined;
  const verified =
    receipt &&
    validReceipt(proposal, receipt) &&
    (await call((signal) =>
      options.host.verifyReceipt(proposal, coworkFreeze(receipt), signal),
    ));
  const record = coworkFactoryRecordSchema.parse(
    verified
      ? { ...reserved, state: "completed", receipt }
      : { ...reserved, state: "unknown" },
  );
  if (
    !(await writeCoworkRecord(options.store, identity, 1, record, options.now))
  )
    return { state: "unknown", reason: "terminal-persistence-unknown" };
  return verified && receipt
    ? completedPublication(proposal, receipt, 2, record)
    : { state: "unknown", reason: "receipt-unverified" };
}

export async function reconcileCoworkItem(
  proposal: CoworkProposal,
  receipt: CoworkItemReceipt,
  options: {
    readonly store: CoworkFactoryStore;
    readonly host: CoworkItemHost;
    readonly now: string;
    readonly signal?: AbortSignal;
    readonly timeoutMs?: number;
  },
): Promise<CoworkPublicationResult> {
  const p = coworkFreeze(coworkProposalSchema.parse(proposal));
  if (
    proposeCoworkItem(p.candidate).intent !== p.intent ||
    coworkDigest({ candidate: p.candidate, title: p.title, body: p.body }) !==
      p.intent
  )
    return { state: "blocked", reason: "proposal-intent-mismatch" };
  const identity = publicationIdentity(p);
  const prior = await readCoworkRecord(options.store, identity);
  const signal = options.signal ?? new AbortController().signal;
  if (
    !prior.value ||
    prior.value.kind !== "publication" ||
    prior.value.intent !== p.intent ||
    !validReceipt(p, receipt) ||
    !(await coworkBounded(
      (signal) => options.host.verifyReceipt(p, coworkFreeze(receipt), signal),
      options.timeoutMs ?? 30000,
      signal,
    )) ||
    signal.aborted
  )
    return { state: "blocked", reason: "reconciliation-evidence-unavailable" };
  if (prior.value.state === "completed") {
    if (
      !prior.value.receipt ||
      coworkDigest(prior.value.receipt) !== coworkDigest(receipt)
    )
      return { state: "blocked", reason: "reconciliation-receipt-conflict" };
    return completedPublication(
      p,
      prior.value.receipt,
      prior.version,
      prior.value,
    );
  }
  const record = coworkFactoryRecordSchema.parse({
    ...prior.value,
    state: "completed",
    receipt,
  });
  if (
    !(await writeCoworkRecord(
      options.store,
      identity,
      prior.version,
      record,
      options.now,
    ))
  )
    return { state: "unknown", reason: "reconciliation-conflict" };
  return completedPublication(p, receipt, prior.version + 1, record);
}
