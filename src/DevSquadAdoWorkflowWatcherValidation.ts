import {
  inspectDevSquadAdoWatchMode,
  prepareDevSquadAdoDiscovery,
} from "./DevSquadAdoWorkflowWatcherDiscoveryValidation.js";
import type {
  DevSquadAdoDiscoveryValidationResult,
  DevSquadAdoWorkflowWatchPassRequest,
  RunDevSquadAdoDiscoveryWatchPassOptions,
} from "./DevSquadAdoWorkflowWatcher.js";
import { randomBytes } from "node:crypto";
import {
  canonicalJson,
  canonicalizeWorkItemId,
  sha256Hex,
} from "./DevSquadAdoWorkflowLedgerSchema.js";
import type {
  DevSquadAdoWatchError,
  DevSquadAdoWatchValidatedPass,
  DevSquadAdoWatchValidationResult,
  DevSquadAdoWatcherOperationIdentity,
  DevSquadAdoWatcherSeamMethodName,
  RunDevSquadAdoWorkflowWatchPassOptions,
} from "./DevSquadAdoWorkflowWatcher.js";
import type { DevSquadAdoWorkItemId } from "./DevSquadAdoWorkflowLedger.js";

/** Fail-closed structural bounds shared by validation and derivation. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;
const MAX_CANDIDATES = 1_000;
const MAX_POLLS_CEILING = 10_000;
const MAX_LEASE_MS = 86_400_000;

/** Default claim lease duration in milliseconds (ADR-0026). */
export const DEFAULT_LEASE_DURATION_MS = 60_000;
/** Default backoff base interval in milliseconds (ADR-0026). */
export const DEFAULT_BASE_INTERVAL_MS = 1_000;
/** Default backoff multiplier (ADR-0026). */
export const DEFAULT_MULTIPLIER = 2;
/** Default backoff interval ceiling in milliseconds (ADR-0026). */
export const DEFAULT_MAX_INTERVAL_MS = 30_000;
/** Maximum UTF-8 byte length of one projected observation identifier. */
export const MAX_OBSERVATION_IDENTIFIER_BYTES = 1_024;

const utf8Length = (value: string): number => Buffer.byteLength(value, "utf8");

const invalid = (
  field: string,
  reason: string,
): { readonly ok: false; readonly error: DevSquadAdoWatchError } => ({
  ok: false,
  error: { kind: "validation", field, reason },
});

const seamContract = (
  method: DevSquadAdoWatcherSeamMethodName,
  reason: "missing" | "not-a-function",
): { readonly ok: false; readonly error: DevSquadAdoWatchError } => ({
  ok: false,
  error: { kind: "seam-contract", method, reason },
});

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isCallable = (value: unknown): value is (...args: never[]) => unknown =>
  typeof value === "function";

class InputFieldError extends Error {
  constructor(
    readonly field: string,
    reason = "must be readable",
  ) {
    super(reason);
  }
}

const readInputField = <T>(field: string, read: () => T): T => {
  try {
    return read();
  } catch {
    throw new InputFieldError(field);
  }
};

const snapshotSignal = (
  signal: AbortSignal | undefined,
): AbortSignal | undefined => {
  if (signal === undefined) return undefined;
  if (typeof signal !== "object" || signal === null)
    throw new InputFieldError("signal", "must be an AbortSignal");
  const aborted = readInputField("signal", () => signal.aborted);
  const add = readInputField("signal", () => signal.addEventListener);
  const remove = readInputField("signal", () => signal.removeEventListener);
  if (typeof aborted !== "boolean" || !isCallable(add) || !isCallable(remove))
    throw new InputFieldError("signal", "must be an AbortSignal");
  const addBound = add.bind(signal);
  const removeBound = remove.bind(signal);
  let unreadable = false;
  return new Proxy(new AbortController().signal, {
    get(_target, key) {
      if (key === "addEventListener") return addBound;
      if (key === "removeEventListener") return removeBound;
      if (key === "aborted") {
        // Cancellation stays live. Losing the required state after preflight
        // fails closed as cancellation, without leaking an accessor exception.
        try {
          const current = signal.aborted;
          if (typeof current !== "boolean") unreadable = true;
          return unreadable || current;
        } catch {
          unreadable = true;
          return true;
        }
      }
      const value: unknown = Reflect.get(signal, key, signal);
      return typeof value === "function" ? value.bind(signal) : value;
    },
  });
};

const boundedText = (
  value: unknown,
  field: string,
  maximumBytes: number,
):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: DevSquadAdoWatchError } => {
  if (typeof value !== "string") return invalid(field, "must be a string");
  if (value.trim().length === 0) return invalid(field, "must not be blank");
  if (CONTROL.test(value))
    return invalid(field, "contains a control character");
  if (value.normalize("NFC") !== value)
    return invalid(field, "must be NFC-normalized");
  if (utf8Length(value) > maximumBytes)
    return invalid(field, "exceeds the byte limit");
  return { ok: true, value };
};

const positiveInteger = (
  value: unknown,
  field: string,
  maximum?: number,
):
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly error: DevSquadAdoWatchError } => {
  if (!Number.isSafeInteger(value) || (value as number) <= 0)
    return invalid(field, "must be a positive safe integer");
  if (maximum !== undefined && (value as number) > maximum)
    return invalid(field, `must not exceed ${String(maximum)}`);
  return { ok: true, value: value as number };
};

const nonNegativeInteger = (
  value: unknown,
  field: string,
):
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly error: DevSquadAdoWatchError } => {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    return invalid(field, "must be a nonnegative safe integer");
  return { ok: true, value: value as number };
};

const exactSet = (
  value: unknown,
  field: string,
):
  | { readonly ok: true; readonly value: readonly string[] }
  | { readonly ok: false; readonly error: DevSquadAdoWatchError } => {
  if (!Array.isArray(value)) return invalid(field, "must be an array");
  const seen = new Set<string>();
  const result: string[] = [];
  try {
    const length = value.length;
    if (!Number.isSafeInteger(length) || length < 0)
      return invalid(field, "must have a valid array length");
    if (length === 0) return invalid(field, "must not be empty");
    for (let index = 0; index < length; index++) {
      if (value.length !== length)
        return invalid(field, "must not change during validation");
      const entryField = `${field}[${String(index)}]`;
      const raw: unknown = value[index];
      if (value.length !== length)
        return invalid(field, "must not change during validation");
      const entry = boundedText(raw, entryField, 256);
      if (!entry.ok) return entry;
      if (seen.has(entry.value))
        return invalid(entryField, "duplicates an earlier entry");
      seen.add(entry.value);
      result.push(entry.value);
    }
  } catch {
    return invalid(field, "must be readable");
  }
  return { ok: true, value: result };
};

/**
 * Canonicalize, deduplicate, and byte-order a candidate set.
 *
 * Ordering is total, locale-independent, and independent of input order:
 * candidates are canonicalized through the ledger's work-item rules and then
 * compared as UTF-8 bytes.
 */
export const canonicalizeDevSquadAdoWatchCandidates = (
  candidates: readonly DevSquadAdoWorkItemId[],
):
  | { readonly ok: true; readonly value: readonly string[] }
  | { readonly ok: false; readonly error: DevSquadAdoWatchError } => {
  if (!Array.isArray(candidates))
    return invalid("candidates", "must be an array");
  let entries: unknown[];
  try {
    const length = candidates.length;
    if (!Number.isSafeInteger(length) || length < 0)
      return invalid("candidates", "must have a valid array length");
    if (length === 0) return invalid("candidates", "must not be empty");
    if (length > MAX_CANDIDATES)
      return invalid("candidates", `must not exceed ${String(MAX_CANDIDATES)}`);
    entries = [];
    for (let index = 0; index < length; index++) {
      if (candidates.length !== length || entries.length >= MAX_CANDIDATES)
        return invalid("candidates", "must not change during validation");
      const entry: unknown = candidates[index];
      if (candidates.length !== length)
        return invalid("candidates", "must not change during validation");
      entries.push(entry);
    }
  } catch {
    return invalid("candidates", "must be readable");
  }
  const seen = new Set<string>();
  const canonical: string[] = [];
  for (let index = 0; index < entries.length; index++) {
    const field = `candidates[${String(index)}]`;
    const parsed = canonicalizeWorkItemId(
      entries[index] as DevSquadAdoWorkItemId,
    );
    if (!parsed.ok) {
      const error = parsed.error;
      return invalid(
        field,
        error.kind === "validation" ? error.reason : "is not a valid work item",
      );
    }
    if (seen.has(parsed.value))
      return invalid(field, "duplicates an earlier candidate");
    seen.add(parsed.value);
    canonical.push(parsed.value);
  }
  canonical.sort((left, right) =>
    Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")),
  );
  return { ok: true, value: canonical };
};

/**
 * Structurally validate watch pass options before any observation or mutation.
 *
 * Validation runs to completion before the pass touches the seam or the
 * ledger, and reports the first failure with a stable field path. The injected
 * clock is never invoked here so a scripted test clock stays aligned with the
 * "one reading per poll" contract.
 */
const validateOptions = (
  options: RunDevSquadAdoWorkflowWatchPassOptions,
  allowEmptyCandidates = false,
): DevSquadAdoWatchValidationResult => {
  if (!isObject(options)) return invalid("options", "must be an object");

  const ledger: unknown = options.ledger;
  if (!isObject(ledger) && typeof ledger !== "function")
    return invalid("ledger", "must be an object");
  for (const method of [
    "readRecord",
    "acquireClaim",
    "renewClaim",
    "releaseClaim",
    "checkpoint",
  ] as const) {
    let candidate: unknown;
    try {
      candidate = (ledger as Record<string, unknown>)[method];
    } catch {
      return invalid(`ledger.${method}`, "must be readable");
    }
    if (candidate === undefined)
      return invalid(`ledger.${method}`, "is missing");
    if (!isCallable(candidate))
      return invalid(`ledger.${method}`, "must be a function");
  }

  const seam: unknown = options.seam;
  if (!isObject(seam) && typeof seam !== "function")
    return invalid("seam", "must be an object");
  let observeWorkItemComments: unknown;
  try {
    observeWorkItemComments = (seam as Record<string, unknown>)
      .observeWorkItemComments;
  } catch {
    return invalid("seam.observeWorkItemComments", "must be readable");
  }
  if (observeWorkItemComments === undefined)
    return seamContract("observeWorkItemComments", "missing");
  if (!isCallable(observeWorkItemComments))
    return seamContract("observeWorkItemComments", "not-a-function");
  let observePullRequestActivity: unknown;
  try {
    observePullRequestActivity = (seam as Record<string, unknown>)
      .observePullRequestActivity;
  } catch {
    return invalid("seam.observePullRequestActivity", "must be readable");
  }
  if (
    observePullRequestActivity !== undefined &&
    !isCallable(observePullRequestActivity)
  )
    return seamContract("observePullRequestActivity", "not-a-function");

  const passId = boundedText(options.passId, "passId", 120);
  if (!passId.ok) return passId;
  const ownerId = boundedText(options.ownerId, "ownerId", 256);
  if (!ownerId.ok) return ownerId;

  const candidates =
    allowEmptyCandidates &&
    Array.isArray(options.candidates) &&
    options.candidates.length === 0
      ? { ok: true as const, value: [] as readonly string[] }
      : canonicalizeDevSquadAdoWatchCandidates(
          options.candidates as readonly DevSquadAdoWorkItemId[],
        );
  if (!candidates.ok) return candidates;

  if (!isObject(options.intakeRules))
    return invalid("intakeRules", "must be an object");
  const phases = exactSet(options.intakeRules.phases, "intakeRules.phases");
  if (!phases.ok) return phases;
  const statuses = exactSet(
    options.intakeRules.statuses,
    "intakeRules.statuses",
  );
  if (!statuses.ok) return statuses;

  if (!isObject(options.budgets))
    return invalid("budgets", "must be an object");
  const maxPolls = positiveInteger(
    options.budgets.maxPolls,
    "budgets.maxPolls",
    MAX_POLLS_CEILING,
  );
  if (!maxPolls.ok) return maxPolls;
  const maxPollStartElapsedMs = positiveInteger(
    options.budgets.maxPollStartElapsedMs,
    "budgets.maxPollStartElapsedMs",
  );
  if (!maxPollStartElapsedMs.ok) return maxPollStartElapsedMs;
  const observationTimeoutMs = positiveInteger(
    options.budgets.observationTimeoutMs,
    "budgets.observationTimeoutMs",
  );
  if (!observationTimeoutMs.ok) return observationTimeoutMs;

  const leaseConfig: unknown = options.lease;
  if (leaseConfig !== undefined && !isObject(leaseConfig))
    return invalid("lease", "must be an object");
  const leaseRecord = (leaseConfig ?? {}) as Record<string, unknown>;
  let leaseDurationMs = DEFAULT_LEASE_DURATION_MS;
  if (leaseRecord.leaseDurationMs !== undefined) {
    const parsed = positiveInteger(
      leaseRecord.leaseDurationMs,
      "lease.leaseDurationMs",
      MAX_LEASE_MS,
    );
    if (!parsed.ok) return parsed;
    leaseDurationMs = parsed.value;
  }
  let renewalThresholdMs = Math.max(1, Math.trunc(leaseDurationMs / 3));
  const suppliedThreshold = leaseRecord.renewalThresholdMs !== undefined;
  if (suppliedThreshold) {
    const parsed = positiveInteger(
      leaseRecord.renewalThresholdMs,
      "lease.renewalThresholdMs",
    );
    if (!parsed.ok) return parsed;
    renewalThresholdMs = parsed.value;
  }
  // A derived threshold is floored at one millisecond, so a one-millisecond
  // lease leaves no room for it. The offending input is then the lease the
  // caller actually supplied, not the threshold they never named.
  if (renewalThresholdMs >= leaseDurationMs)
    return suppliedThreshold
      ? invalid(
          "lease.renewalThresholdMs",
          "must be strictly less than lease.leaseDurationMs",
        )
      : invalid(
          "lease.leaseDurationMs",
          "must be at least 2 when lease.renewalThresholdMs is not supplied",
        );

  const backoffConfig: unknown = options.backoff;
  if (backoffConfig !== undefined && !isObject(backoffConfig))
    return invalid("backoff", "must be an object");
  const backoffRecord = (backoffConfig ?? {}) as Record<string, unknown>;
  let baseIntervalMs = DEFAULT_BASE_INTERVAL_MS;
  if (backoffRecord.baseIntervalMs !== undefined) {
    const parsed = nonNegativeInteger(
      backoffRecord.baseIntervalMs,
      "backoff.baseIntervalMs",
    );
    if (!parsed.ok) return parsed;
    baseIntervalMs = parsed.value;
  }
  let multiplier = DEFAULT_MULTIPLIER;
  if (backoffRecord.multiplier !== undefined) {
    if (
      typeof backoffRecord.multiplier !== "number" ||
      !Number.isFinite(backoffRecord.multiplier) ||
      backoffRecord.multiplier < 1
    )
      return invalid(
        "backoff.multiplier",
        "must be a finite number greater than or equal to 1",
      );
    multiplier = backoffRecord.multiplier;
  }
  let maxIntervalMs = DEFAULT_MAX_INTERVAL_MS;
  if (backoffRecord.maxIntervalMs !== undefined) {
    const parsed = nonNegativeInteger(
      backoffRecord.maxIntervalMs,
      "backoff.maxIntervalMs",
    );
    if (!parsed.ok) return parsed;
    maxIntervalMs = parsed.value;
  }
  if (maxIntervalMs < baseIntervalMs)
    return invalid(
      "backoff.maxIntervalMs",
      "must be greater than or equal to backoff.baseIntervalMs",
    );
  if (backoffRecord.jitter !== undefined && !isCallable(backoffRecord.jitter))
    return invalid("backoff.jitter", "must be a function");

  if (!isCallable(options.clock)) return invalid("clock", "must be a function");
  if (!isCallable(options.delay)) return invalid("delay", "must be a function");
  if (options.signal !== undefined) {
    const signal = options.signal;
    if (
      typeof signal !== "object" ||
      signal === null ||
      typeof signal.aborted !== "boolean" ||
      !isCallable(signal.addEventListener) ||
      !isCallable(signal.removeEventListener)
    )
      return invalid("signal", "must be an AbortSignal");
  }

  const value: DevSquadAdoWatchValidatedPass = {
    passId: passId.value,
    ownerId: ownerId.value,
    candidates: candidates.value,
    intakePhases: phases.value,
    intakeStatuses: statuses.value,
    maxPolls: maxPolls.value,
    maxPollStartElapsedMs: maxPollStartElapsedMs.value,
    observationTimeoutMs: observationTimeoutMs.value,
    leaseDurationMs,
    renewalThresholdMs,
    baseIntervalMs,
    multiplier,
    maxIntervalMs,
  };
  return { ok: true, value };
};

/** Snapshot only required configuration fields before validation and use. */
export const prepareDevSquadAdoWorkflowWatchPassOptions = (
  input: RunDevSquadAdoWorkflowWatchPassOptions,
  allowEmptyCandidates = false,
):
  | {
      readonly ok: true;
      readonly value: DevSquadAdoWatchValidatedPass;
      readonly options: RunDevSquadAdoWorkflowWatchPassOptions;
    }
  | { readonly ok: false; readonly error: DevSquadAdoWatchError } => {
  if (!isObject(input)) return invalid("options", "must be an object");
  // This catch surrounds input inspection only, never execution of the pass.
  let options: RunDevSquadAdoWorkflowWatchPassOptions;
  try {
    const intake = readInputField("intakeRules", () => input.intakeRules);
    const budgets = readInputField("budgets", () => input.budgets);
    const lease = readInputField("lease", () => input.lease);
    const backoff = readInputField("backoff", () => input.backoff);
    options = {
      ledger: readInputField("ledger", () => input.ledger),
      seam: readInputField("seam", () => input.seam),
      passId: readInputField("passId", () => input.passId),
      ownerId: readInputField("ownerId", () => input.ownerId),
      candidates: readInputField("candidates", () => input.candidates),
      clock: readInputField("clock", () => input.clock),
      delay: readInputField("delay", () => input.delay),
      signal: snapshotSignal(readInputField("signal", () => input.signal)),
      intakeRules: isObject(intake)
        ? {
            phases: readInputField("intakeRules.phases", () => intake.phases),
            statuses: readInputField(
              "intakeRules.statuses",
              () => intake.statuses,
            ),
          }
        : intake,
      budgets: isObject(budgets)
        ? {
            maxPolls: readInputField(
              "budgets.maxPolls",
              () => budgets.maxPolls,
            ),
            maxPollStartElapsedMs: readInputField(
              "budgets.maxPollStartElapsedMs",
              () => budgets.maxPollStartElapsedMs,
            ),
            observationTimeoutMs: readInputField(
              "budgets.observationTimeoutMs",
              () => budgets.observationTimeoutMs,
            ),
          }
        : budgets,
      lease:
        typeof lease === "object" && lease !== null && !Array.isArray(lease)
          ? {
              leaseDurationMs: readInputField(
                "lease.leaseDurationMs",
                () => lease.leaseDurationMs,
              ),
              renewalThresholdMs: readInputField(
                "lease.renewalThresholdMs",
                () => lease.renewalThresholdMs,
              ),
            }
          : lease,
      backoff:
        typeof backoff === "object" &&
        backoff !== null &&
        !Array.isArray(backoff)
          ? {
              baseIntervalMs: readInputField(
                "backoff.baseIntervalMs",
                () => backoff.baseIntervalMs,
              ),
              multiplier: readInputField(
                "backoff.multiplier",
                () => backoff.multiplier,
              ),
              maxIntervalMs: readInputField(
                "backoff.maxIntervalMs",
                () => backoff.maxIntervalMs,
              ),
              jitter: readInputField("backoff.jitter", () => backoff.jitter),
            }
          : backoff,
    };
  } catch (error) {
    if (error instanceof InputFieldError)
      return invalid(error.field, error.message);
    throw error;
  }
  const result = validateOptions(options, allowEmptyCandidates);
  return result.ok ? { ...result, options } : result;
};

/** Validate required configuration without invoking injected dependencies. */
export function validateDevSquadAdoWorkflowWatchPassOptions(
  options: RunDevSquadAdoWorkflowWatchPassOptions,
): DevSquadAdoWatchValidationResult;
export function validateDevSquadAdoWorkflowWatchPassOptions(
  options: RunDevSquadAdoDiscoveryWatchPassOptions,
): DevSquadAdoDiscoveryValidationResult;
export function validateDevSquadAdoWorkflowWatchPassOptions(
  options: DevSquadAdoWorkflowWatchPassRequest,
): DevSquadAdoWatchValidationResult | DevSquadAdoDiscoveryValidationResult;
export function validateDevSquadAdoWorkflowWatchPassOptions(
  options: DevSquadAdoWorkflowWatchPassRequest,
): DevSquadAdoWatchValidationResult | DevSquadAdoDiscoveryValidationResult {
  const mode = inspectDevSquadAdoWatchMode(options);
  if (!mode.ok) return mode;
  if (mode.value === "discovery") {
    const result = prepareDevSquadAdoDiscovery(
      options as RunDevSquadAdoDiscoveryWatchPassOptions,
    );
    return result.ok ? { ok: true, value: result.value } : result;
  }
  const result = prepareDevSquadAdoWorkflowWatchPassOptions(
    options as RunDevSquadAdoWorkflowWatchPassOptions,
  );
  return result.ok ? { ok: true, value: result.value } : result;
}

/**
 * Derive the ledger operation identifier for one watcher step.
 *
 * ```text
 * operationId = "dsw2." + step + "." + sha256hex(canonicalJson(identity)).slice(0, 32)
 * ```
 *
 * The identity object is canonically serialized, which removes delimiter
 * ambiguity between long pass and work-item identifiers and keeps the result
 * inside the ledger's 256-byte identifier bound.
 *
 * The two identity arms are deliberately scoped differently.
 *
 * A **claim-lifecycle** identifier (`claim`, `renew`, `release`) is scoped to a
 * random `claimEpoch` minted per acquisition. The ledger folds the capability
 * token into its idempotency digest and that token is freshly random every
 * acquisition, so an epoch-free identifier would make a second acquisition
 * under the same `passId` a permanent `idempotency-conflict` — poisoning the
 * pass identity for that candidate forever. Scoping by epoch keeps capability
 * tokens random *and* keeps the same `passId` replayable.
 *
 * A **checkpoint** identifier is scoped to the exact cursor advance it
 * publishes. Retrying the same advance reproduces the identifier, so an
 * already-durable mutation replays instead of duplicating; publishing a
 * genuinely different advance derives a different identifier, so a later pass
 * reusing the same `passId` for new work is never falsely rejected.
 */
export const deriveDevSquadAdoWatcherOperationId = (
  input: DevSquadAdoWatcherOperationIdentity,
): string => {
  const identity =
    input.step === "checkpoint"
      ? {
          v: 2,
          passId: input.passId,
          workItemId: input.workItemId,
          step: input.step,
          ordinal: input.ordinal,
          generation: {
            fromWorkItemCommentId: input.generation.fromWorkItemCommentId,
            fromPullRequest: input.generation.fromPullRequest,
            toWorkItemCommentId: input.generation.toWorkItemCommentId,
            toPullRequest: input.generation.toPullRequest,
          },
        }
      : {
          v: 2,
          passId: input.passId,
          workItemId: input.workItemId,
          step: input.step,
          ordinal: input.ordinal,
          claimEpoch: input.claimEpoch,
        };
  const digest = sha256Hex(canonicalJson(identity));
  return `dsw2.${input.step}.${digest.slice(0, 32)}`;
};

/**
 * Mint the random identity of one claim acquisition attempt.
 *
 * This is an idempotency namespace, never a capability: it authorizes nothing,
 * and the claim token it accompanies stays independently random. It is
 * generated fresh per acquisition so that claim-lifecycle operation
 * identifiers can never collide with a previous attempt's receipts.
 */
export const mintDevSquadAdoWatcherClaimEpoch = (): string =>
  randomBytes(16).toString("base64url");

/** Deterministic backoff inputs for the transition from poll `n` to `n + 1`. */
export interface DevSquadAdoWatcherBackoffInput {
  /** One-based index of the poll that just completed. */
  readonly pollIndex: number;
  /** Resolved backoff base interval in milliseconds. */
  readonly baseIntervalMs: number;
  /** Resolved backoff multiplier. */
  readonly multiplier: number;
  /** Resolved backoff interval ceiling in milliseconds. */
  readonly maxIntervalMs: number;
  /** Optional injected jitter; the only source of randomness permitted. */
  readonly jitter?: (baseDelayMs: number, pollIndex: number) => number;
}

/**
 * Compute the deterministic delay requested after poll `pollIndex`.
 *
 * `raw = base * multiplier^(n-1)`, `capped = min(trunc(raw), max)`, and
 * `delayMs = jitter ? clamp(trunc(jitter(capped, n)), 0, max) : capped`.
 * There is no randomness unless an explicit jitter source is injected.
 */
export const computeDevSquadAdoWatcherBackoffDelayMs = (
  input: DevSquadAdoWatcherBackoffInput,
): number => {
  const raw =
    input.baseIntervalMs * Math.pow(input.multiplier, input.pollIndex - 1);
  const capped = Math.min(
    Number.isFinite(raw) ? Math.trunc(raw) : input.maxIntervalMs,
    input.maxIntervalMs,
  );
  if (input.jitter === undefined) return capped;
  const jittered = input.jitter(capped, input.pollIndex);
  if (typeof jittered !== "number" || !Number.isFinite(jittered)) return 0;
  return Math.min(Math.max(Math.trunc(jittered), 0), input.maxIntervalMs);
};

/** W041 / FR-037a: initialization identity excludes pass, traversal and capability. */
export const deriveDiscoveryInitializationId = (input: {
  readonly workItemId: string;
  readonly submissionId: string;
  readonly phase: string;
  readonly status: string;
}): string =>
  `dsw2.initialize.${sha256Hex(canonicalJson({ step: "initialize", workItemId: input.workItemId, submissionId: input.submissionId, phase: input.phase, status: input.status })).slice(0, 32)}`;
