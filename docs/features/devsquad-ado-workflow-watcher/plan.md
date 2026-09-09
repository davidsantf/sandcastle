# DevSquad/ADO Workflow Watcher Implementation Plan

## Summary

Implement one bounded, offline, deterministic watch pass that turns injected ADO/GitHub observations into durably checkpointed intake signals for a DevSquad host.

The watcher is a pure consumer of the slice-13 ledger (`openDevSquadAdoWorkflowLedger`). It reads records, evaluates eligibility, acquires a fenced claim only when it intends to mutate, advances opaque observation cursors through ledger checkpoints, and returns token-free per-candidate outcomes plus at most one intake signal per candidate.

The implementation follows [ADR-0026](../../adr/0026-devsquad-ado-workflow-watcher.md) and preserves ADRs 0021, 0022, 0024, and 0025. It introduces no persistence format, no schema change, and no network-capable dependency.

## Architectural Boundary

### DevSquad and host responsibilities

- Choose the candidate set for each pass; the watcher never discovers work items.
- Initialize ledger records before a candidate can be acted on.
- Define phase and status meaning and supply exact-match intake rules.
- Supply a stable pass identity so an ambiguous pass can be retried with replay parity.
- Implement the observation seam, including its ordering contract, credentials, and transport.
- Interpret intake signals, decide transition legality, and schedule execution.
- Perform every external tracker write and every pull-request action.

### Watcher responsibilities

- Structurally validate inputs and the injected seam before any observation or mutation.
- Read the durable record and evaluate eligibility as a pure function of injected inputs.
- Select new events relative to persisted cursors using the seam's authoritative ordering.
- Acquire, renew, and release ledger claims around its own mutations only.
- Persist opaque cursors through fenced, revision-checked, idempotent checkpoints.
- Emit intake signals only when caller intake rules match the record's exact phase and status.
- Terminate inside the caller-declared poll budget, or on cancellation. The poll-start elapsed budget gates when a new poll may begin, not total elapsed time; work already in flight always completes.
- Report stable outcome kinds, reason codes, counts, and stop reasons.

### Explicit non-responsibilities

The watcher will not import or invoke ADO, GitHub, MCP, HTTP, CLI, git, agent, sandbox, shell, scheduler, team-runner, feedback-loop, or execution-adapter implementations.

It will not define a phase allowlist, phase order, transition table, terminal state, or resumability policy. It will not initialize, repair, reset, or rewrite ledger artifacts. It will not write to the external tracker.

## Implementation Surfaces

### New source files

| File                                                  | Responsibility                                                                                                                           |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `src/DevSquadAdoWorkflowWatcher.ts`                   | Effect-free public contracts, seam types, `runDevSquadAdoWorkflowWatchPass`, and JSDoc.                                                  |
| `src/DevSquadAdoWorkflowWatcherValidation.ts`         | Input and seam structural validation, normalization, canonical candidate ordering, operation-identifier derivation, backoff computation. |
| `src/DevSquadAdoWorkflowWatcherObservation.ts`        | Seam invocation with per-observation timeout, response projection to opaque identifiers, cursor anchoring, new-event selection.          |
| `src/DevSquadAdoWorkflowWatcherPass.ts`               | Poll loop, per-candidate step machine, claim lifecycle, checkpointing, cancellation, stop reasons, counts.                               |
| `src/DevSquadAdoWorkflowWatcher.test.ts`              | Validation, seam contract, happy path, replay, determinism, intake rules, missing record, PR cursor completeness, public surface.        |
| `src/DevSquadAdoWorkflowWatcher.concurrency.test.ts`  | Claim conflict, fencing, renewal, release hygiene, idempotency, revision/state conflicts.                                                |
| `src/DevSquadAdoWorkflowWatcher.bounds.test.ts`       | Poll budget, poll-start elapsed budget, deterministic backoff, cancellation points, observation timeout.                                 |
| `src/DevSquadAdoWorkflowWatcher.recovery.test.ts`     | Corrupt and unsupported-schema isolation, candidate isolation, capacity categories, restart safety.                                      |
| `src/DevSquadAdoWorkflowWatcher.dependencies.test.ts` | Static offline dependency assertion and Effect-free public contract assertion.                                                           |
| `src/DevSquadAdoWorkflowWatcherTestSupport.ts`        | Recording seam fake, deterministic clock, recording delay source, ledger fixture and seeding helpers.                                    |

### Modified files

| File                                          | Change                                                                                                |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/index.ts`                                | Export the watch-pass operation, validation helper, and Effect-free public watcher contracts.         |
| `README.md`                                   | Document the watch pass, seam contract, pass identity, intake rules, budgets, and lifecycle boundary. |
| `.changeset/devsquad-ado-workflow-watcher.md` | One nonduplicate minor changeset for the new public feature.                                          |

No new subpath export is required. Public imports continue through `@ai-hero/sandcastle`.

### Runtime style

Plain `async`/`Promise` TypeScript, matching `AdoFeedbackLoop.ts` and `DevSquadSandcastleExecutionAdapter.ts`. Effect is not introduced: the watcher owns no filesystem, no process, and no resource scope; it orchestrates injected promise-returning seams and the ledger's promise API. This keeps the public declaration Effect-free by construction.

## Public API

All public functions, interfaces, and properties receive JSDoc. No public declaration may import `effect` or `@effect/*`.

### Result and error envelope

```ts
export type DevSquadAdoWatchPassOutcome =
  | { readonly ok: true; readonly value: DevSquadAdoWatchPassResult }
  | { readonly ok: false; readonly error: DevSquadAdoWatchError };

export type DevSquadAdoWatchError =
  | {
      readonly kind: "validation";
      readonly field: string;
      readonly reason: string;
    }
  | {
      readonly kind: "seam-contract";
      readonly method: DevSquadAdoWatcherSeamMethodName;
      readonly reason: "missing" | "not-a-function";
    };

export type DevSquadAdoWatcherSeamMethodName =
  | "observeWorkItemComments"
  | "observePullRequestActivity";
```

`ok: false` is reserved for failures detected before any observation or mutation. Cancellation, budget exhaustion, and every per-candidate failure resolve as `ok: true` with a stop reason and complete outcomes.

### Observation seam

```ts
export interface DevSquadAdoWatcherObservationSeam {
  readonly observeWorkItemComments: (
    input: DevSquadAdoWatcherWorkItemObservationInput,
  ) => Promise<DevSquadAdoWatcherWorkItemObservation>;
  readonly observePullRequestActivity?: (
    input: DevSquadAdoWatcherPullRequestObservationInput,
  ) => Promise<DevSquadAdoWatcherPullRequestObservation>;
}

export interface DevSquadAdoWatcherWorkItemObservationInput {
  readonly workItemId: string;
  readonly sinceCommentId: string | null;
  readonly signal?: AbortSignal;
}

export interface DevSquadAdoWatcherWorkItemObservation {
  readonly commentIds: readonly string[];
}

export interface DevSquadAdoWatcherPullRequestObservationInput {
  readonly workItemId: string;
  readonly pullRequestId: string;
  readonly sinceCursor: DevSquadAdoPullRequestCursor | null;
  readonly signal?: AbortSignal;
}

export interface DevSquadAdoWatcherPullRequestObservationEntry {
  readonly threadId: string;
  readonly commentId?: string | null;
}

export interface DevSquadAdoWatcherPullRequestObservation {
  readonly entries: readonly DevSquadAdoWatcherPullRequestObservationEntry[];
}
```

**Seam contract.** Entries are returned in the tracker's authoritative order, oldest first. The seam either includes the supplied `since` cursor as the first entry or returns only entries strictly after it. The watcher reads only the identifier fields shown above and discards every other property of a returned entry.

### Pass options

```ts
export type DevSquadAdoWatchObservationKind =
  | "work-item-comment"
  | "pull-request-thread";

export interface DevSquadAdoWatchIntakeRules {
  readonly phases: readonly string[];
  readonly statuses: readonly string[];
}

export interface DevSquadAdoWatchBudgets {
  readonly maxPolls: number;
  readonly maxPollStartElapsedMs: number;
  readonly observationTimeoutMs: number;
}

export interface DevSquadAdoWatchLeaseConfig {
  readonly leaseDurationMs?: number;
  readonly renewalThresholdMs?: number;
}

export interface DevSquadAdoWatchBackoffConfig {
  readonly baseIntervalMs?: number;
  readonly multiplier?: number;
  readonly maxIntervalMs?: number;
  readonly jitter?: (baseDelayMs: number, pollIndex: number) => number;
}

export interface RunDevSquadAdoWorkflowWatchPassOptions {
  readonly ledger: DevSquadAdoWorkflowLedger;
  readonly seam: DevSquadAdoWatcherObservationSeam;
  readonly passId: string;
  readonly ownerId: string;
  readonly candidates: readonly DevSquadAdoWorkItemId[];
  readonly intakeRules: DevSquadAdoWatchIntakeRules;
  readonly budgets: DevSquadAdoWatchBudgets;
  readonly lease?: DevSquadAdoWatchLeaseConfig;
  readonly backoff?: DevSquadAdoWatchBackoffConfig;
  readonly clock: () => Date;
  readonly delay: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly signal?: AbortSignal;
}
```

### Pass result

```ts
export type DevSquadAdoWatchCandidateOutcomeKind =
  | "acted"
  | "no-change"
  | "intake-suppressed"
  | "skipped"
  | "failed";

export type DevSquadAdoWatchReasonCode =
  | "new-work-item-comment"
  | "new-pull-request-activity"
  | "new-observations"
  | "no-new-observations"
  | "intake-rules-unmatched"
  | "incomplete-pull-request-cursor"
  | "record-not-found"
  | "claim-conflict"
  | "claim-expired"
  | "claim-authorization"
  | "stale-fencing"
  | "stale-observation"
  | "revision-conflict"
  | "state-conflict"
  | "idempotency-conflict"
  | "checkpoint-indeterminate"
  | "observation-failed"
  | "observation-timeout"
  | "observation-anchor-missing"
  | "pull-request-observation-unavailable"
  | "invalid-observation-identifier"
  | "ledger-recovery"
  | "ledger-capacity"
  | "ledger-unavailable"
  | "cancelled";

export type DevSquadAdoWatchStopReason =
  | "candidates-resolved"
  | "poll-budget-exhausted"
  | "poll-start-budget-exhausted"
  | "cancelled";

export interface DevSquadAdoWatchClaimMetadata {
  readonly ownerId: string;
  readonly fencingValue: number;
  readonly expiresAt: string;
}

export interface DevSquadAdoWatchCandidateOutcome {
  readonly workItemId: string;
  readonly kind: DevSquadAdoWatchCandidateOutcomeKind;
  readonly reason: DevSquadAdoWatchReasonCode;
  readonly revision: number | null;
  readonly sourceRevision: number | null;
  readonly cursorChanges: readonly DevSquadAdoWatchObservationKind[];
  readonly skippedCursorKinds: readonly DevSquadAdoWatchObservationKind[];
  readonly claim: DevSquadAdoWatchClaimMetadata | null;
  readonly ledgerErrorKind: string | null;
}

export interface DevSquadAdoWatchIntakeSignal {
  readonly workItemId: string;
  readonly sourceRevision: number;
  readonly changedKinds: readonly DevSquadAdoWatchObservationKind[];
  readonly phase: string;
  readonly status: string;
  readonly claim: DevSquadAdoWatchClaimMetadata;
}

export interface DevSquadAdoWatchPassCounts {
  readonly examined: number;
  readonly eligible: number;
  readonly acted: number;
  readonly noChange: number;
  readonly suppressed: number;
  readonly skipped: number;
  readonly failed: number;
}

export interface DevSquadAdoWatchPassResult {
  readonly passId: string;
  readonly ownerId: string;
  readonly stopReason: DevSquadAdoWatchStopReason;
  readonly polls: number;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly counts: DevSquadAdoWatchPassCounts;
  readonly outcomes: readonly DevSquadAdoWatchCandidateOutcome[];
  readonly signals: readonly DevSquadAdoWatchIntakeSignal[];
}
```

`sourceRevision` is the revision the decision was derived from; `revision` is the accepted revision when a mutation was durable. In the happy path they differ by one, which is what CC-001 asserts.

### Exported operations

```ts
export const runDevSquadAdoWorkflowWatchPass: (
  options: RunDevSquadAdoWorkflowWatchPassOptions,
) => Promise<DevSquadAdoWatchPassOutcome>;

export const validateDevSquadAdoWorkflowWatchPassOptions: (
  options: RunDevSquadAdoWorkflowWatchPassOptions,
) => DevSquadAdoWatchValidationResult;

export const deriveDevSquadAdoWatcherOperationId: (
  input: DevSquadAdoWatcherOperationIdentity,
) => string;
```

`deriveDevSquadAdoWatcherOperationId` is public so a host can reason about, log, or reconcile the exact operation identifiers a pass uses. Its input is a discriminated union: the `checkpoint` arm carries the observation generation, and the claim-lifecycle arms carry the claim epoch. A host that wants to predict a retry's checkpoint identifier supplies the same generation; the claim identifiers are deliberately not predictable, because they must not be reused.

## Validation Rules

Validation runs to completion before any seam call or ledger operation and returns the first failure with a stable field path.

| Field                           | Rule                                                                                                                                                                                                                          |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ledger`                        | Object exposing callable `readRecord`, `acquireClaim`, `renewClaim`, `releaseClaim`, `checkpoint`.                                                                                                                            |
| `seam`                          | Object; `observeWorkItemComments` present and callable; `observePullRequestActivity` callable when present.                                                                                                                   |
| `passId`                        | Nonblank NFC string, no control characters, 1–120 UTF-8 bytes.                                                                                                                                                                |
| `ownerId`                       | Nonblank NFC string, no control characters, 1–256 UTF-8 bytes.                                                                                                                                                                |
| `candidates`                    | Nonempty array; each canonicalizes through the ledger's work-item rules; no duplicate canonical identifier; at most 1,000 entries.                                                                                            |
| `intakeRules.phases`            | Nonempty array of distinct nonblank strings ≤ 256 UTF-8 bytes.                                                                                                                                                                |
| `intakeRules.statuses`          | Nonempty array of distinct nonblank strings ≤ 256 UTF-8 bytes.                                                                                                                                                                |
| `budgets.maxPolls`              | Positive safe integer ≤ 10,000.                                                                                                                                                                                               |
| `budgets.maxPollStartElapsedMs` | Positive safe integer.                                                                                                                                                                                                        |
| `budgets.observationTimeoutMs`  | Positive safe integer.                                                                                                                                                                                                        |
| `lease.leaseDurationMs`         | Positive safe integer ≤ 86,400,000; default 60,000.                                                                                                                                                                           |
| `lease.renewalThresholdMs`      | Positive safe integer strictly less than the lease duration; default `max(1, trunc(lease / 3))`. When the default cannot satisfy that rule the offending field is `lease.leaseDurationMs`, because no threshold was supplied. |
| `backoff.baseIntervalMs`        | Nonnegative safe integer; default 1,000.                                                                                                                                                                                      |
| `backoff.multiplier`            | Finite number ≥ 1; default 2.                                                                                                                                                                                                 |
| `backoff.maxIntervalMs`         | Nonnegative safe integer ≥ `baseIntervalMs`; default 30,000.                                                                                                                                                                  |
| `backoff.jitter`                | Callable when present; its return is coerced with `trunc` and clamped to `[0, maxIntervalMs]`.                                                                                                                                |
| `clock`                         | Callable returning a valid `Date`.                                                                                                                                                                                            |
| `delay`                         | Callable.                                                                                                                                                                                                                     |
| `signal`                        | `AbortSignal` when present.                                                                                                                                                                                                   |

Intake rules are exact-match sets with no wildcard. Admitting every status requires listing every status, which keeps lifecycle policy in the host.

## Deterministic Operation Identifiers

```text
checkpoint identity     = { v: 2, passId, workItemId, step: "checkpoint", ordinal, generation }
claim-lifecycle identity = { v: 2, passId, workItemId, step, ordinal, claimEpoch }
operationId              = `dsw2.${step}.${sha256hex(canonicalJson(identity)).slice(0, 32)}`
```

- `step` ∈ `claim` | `renew` | `checkpoint` | `release`.
- `ordinal` is `0` for `claim`, `checkpoint`, and `release`; the one-based renewal sequence for `renew`.
- `workItemId` is the canonical ledger identifier, not the caller's raw input.
- `generation` names both ends of the advance: `fromWorkItemCommentId`, `fromPullRequest`, `toWorkItemCommentId`, `toPullRequest`.
- `claimEpoch` is 16 random bytes, base64url, minted immediately before `acquireClaim` and reused by that claim's renewals and release.
- Length is 48 ASCII bytes, well inside the ledger's 256-byte identifier bound.

Canonical serialization of the identity object removes delimiter ambiguity between long pass and work-item identifiers.

The two scopes are not interchangeable. A **checkpoint** identifier must reproduce on retry so an already-durable advance replays instead of duplicating, and must differ for a different advance so a `passId` reused for later work is not falsely rejected. A **claim-lifecycle** identifier must _not_ reproduce across acquisitions: ADR-0025 hashes the capability token into the acquire digest, and tokens are freshly random, so a reused claim identifier can only produce a permanent `idempotency-conflict`. The epoch is an idempotency namespace, never a capability, and never a claim token.

## Candidate Ordering

Candidates are canonicalized, deduplicated, and sorted by UTF-8 byte comparison of the canonical identifier. Ordering is total, locale-independent, and independent of input order. All processing is sequential; the watcher runs no candidates concurrently.

## Poll Loop Algorithm

```text
startedAt := clock()          # single reading, also the pass-start basis
pending   := ordered candidates
polls     := 0

loop:
  if signal.aborted            -> stop("cancelled")
  if polls >= maxPolls         -> stop("poll-budget-exhausted")
  now := clock()               # ONE reading for this entire poll
  if polls > 0 and now - startedAt >= maxPollStartElapsedMs
                               -> stop("poll-start-budget-exhausted")
  polls := polls + 1

  for candidate in pending (canonical order):
    runCandidateStep(candidate, now)

  if pending is empty          -> stop("candidates-resolved")
  if polls >= maxPolls         -> stop("poll-budget-exhausted")
  if signal.aborted            -> stop("cancelled")
  delayMs := backoffFor(polls)
  await delay(delayMs, signal)

finalize:
  release every still-held claim
  every still-pending candidate is reported:
     holding a claim -> failed / "checkpoint-indeterminate"
     otherwise       -> no-change / <last pending reason>
```

Backoff for the transition from poll `n` to poll `n + 1`:

```text
raw     := baseIntervalMs * multiplier ^ (n - 1)
capped  := min(trunc(raw), maxIntervalMs)
delayMs := jitter ? clamp(trunc(jitter(capped, n)), 0, maxIntervalMs) : capped
```

`maxPolls = 3` with no eligible candidate therefore performs exactly three polls and requests exactly two delays.

## Candidate Step Algorithm

Gates run in this fixed order. Every check uses the single poll clock reading.

1. **Cancellation gate.** Aborted → resolve `failed` / `cancelled` if a claim is held, otherwise stop the pass.
2. **Read.** `ledger.readRecord(candidate)`.
   - `record-not-found` → resolve `skipped` / `record-not-found`. The watcher never initializes.
   - Recovery categories (`corrupt-artifact`, `unsupported-schema-version`, `path-boundary`, `unsupported-permissions`, `scan-limit`) → resolve `failed` / `ledger-recovery` with `ledgerErrorKind` set.
   - `capacity-exceeded` → resolve `failed` / `ledger-capacity`.
   - `storage` → resolve `failed` / `ledger-recovery` with `ledgerErrorKind: "storage"`.
3. **Foreign-claim gate.** `record.activeClaim` exists, is owned by another `ownerId`, and `now < expiresAt` → resolve `skipped` / `claim-conflict`. No seam call is made.
4. **Observe work-item comments.** Cancellation checked first. Call the seam with `sinceCommentId` from the record, raced against `delay(observationTimeoutMs, signal)`.
   - Timeout → resolve `failed` / `observation-timeout`.
   - Rejection → resolve `failed` / `observation-failed`, with no transport message retained.
5. **Observe pull-request activity.** Only when `record.pullRequest.id !== null`.
   - Method absent → resolve `failed` / `pull-request-observation-unavailable`.
   - Same timeout and rejection handling as step 4.
6. **Project and validate.** Take only `commentIds` / `{ threadId, commentId }` from responses. Each identifier must be a nonblank string ≤ 1,024 UTF-8 bytes without control characters; otherwise resolve `failed` / `invalid-observation-identifier`. Every other property of a seam entry is discarded here.
7. **Select new events.** Apply the anchor rule per kind (below). A pull-request entry lacking a usable `commentId` is never persisted; its kind is recorded in `skippedCursorKinds`.
8. **Eligibility.** No new events in any kind → leave the candidate **pending** with reason `no-new-observations` (or `incomplete-pull-request-cursor` when the only observed activity was unpersistable). Pending candidates are re-examined on the next poll.
9. **Acquire claim.** Fresh 32-byte `crypto.randomBytes` base64url token, derived `claim` operation ID, configured lease.
   - `claim-conflict` → resolve `skipped` / `claim-conflict`.
   - `claim-expired` | `claim-authorization` | `stale-fencing` → resolve `skipped` with the matching reason.
10. **Renewal guard.** If `now + renewalThresholdMs >= Date.parse(expiresAt)`, renew with the next `renew` ordinal before mutating. Fencing is preserved.
11. **Checkpoint.** `expected` = `{ revision, phase, status }` from step 2; `patch.observations` carries only the advanced cursors.
    - Success → record `revision` and `cursorChanges`.
    - `revision-conflict` | `state-conflict` | `idempotency-conflict` → resolve `failed` with the matching reason; durable state unchanged.
    - `stale-fencing` | `claim-expired` | `claim-authorization` → resolve `failed` with the matching reason; nothing is advanced.
    - `contention`, or `storage` with `outcome: "indeterminate"` → leave the candidate **pending while holding the claim** and retry on a later poll with the **same** checkpoint operation ID.
    - `storage` with `outcome: "unchanged"` → resolve `failed` / `ledger-recovery`; durable state is known unchanged, so no retry is attempted.
12. **Intake decision.** Record phase ∈ `intakeRules.phases` **and** status ∈ `intakeRules.statuses` → append one intake signal citing `sourceRevision` from step 2 and resolve `acted`. Otherwise resolve `intake-suppressed` / `intake-rules-unmatched`; the cursor stays advanced.
13. **Release.** Release the claim with the derived `release` operation ID. Release failure never changes the reported outcome; the lease expiry is the backstop.

The signal is appended only after the checkpoint response is accepted, so no signal can exist for a cursor that is not durable.

## Cursor Anchoring and New-Event Selection

For each observation kind, given the persisted cursor `anchor` and the seam's ordered list `entries`:

```text
if entries is empty            -> no new events
if anchor is null              -> new := entries
else if anchor appears at i    -> new := entries[i+1 ..]
else                           -> FAIL CLOSED: observation-anchor-missing
next cursor := last persistable entry of new
```

Equality is exact string comparison for work-item comments and exact pair comparison of `threadId` and `commentId` for pull requests. No identifier is parsed, ordered, or compared arithmetically.

The final branch is the fail-closed one. The seam window is anchor-inclusive, so a non-empty window that does not contain a supplied anchor is undecidable: it is indistinguishable from a window in which every entry is new, and treating it that way silently re-delivers the whole window. The candidate reports `failed` / `observation-anchor-missing` and advances nothing.

A pull-request entry with a missing, null, or blank `commentId` is not persistable; the newest persistable entry among the new entries becomes the next cursor. `pull-request-thread` is recorded in `skippedCursorKinds` **only when no persistable entry exists at all**, so `cursorChanges` and `skippedCursorKinds` never name the same kind in one outcome.

## Observation Staleness Gate

The record is read before observation and returned again by the acquisition. Between those two reads another owner can acquire, advance a cursor, and release, so the acquisition can succeed while the selection in hand is already stale.

```text
observed := readRecord(candidate)          # anchors used for selection
claimed  := acquireClaim(...).record       # record as it stands under the claim

if observed.observations.workItemCommentId != claimed.observations.workItemCommentId
   or observed.observations.pullRequest    != claimed.observations.pullRequest
   or observed.pullRequest.id              != claimed.pullRequest.id
                               -> releaseClaim(); report no-change / stale-observation
                                  (candidate stays pending and re-observes next poll)
```

Phase and status are excluded on purpose: they are taken fresh from `claimed` and carried into the checkpoint precondition, so a foreign change to them conflicts on its own terms rather than being reclassified as staleness.

## Cancellation Points

Cancellation is observed at exactly three classes of point, per FR-051:

- before each seam call (steps 4 and 5), and propagated to the seam through `signal`;
- before each ledger mutation (steps 9, 10, 11, and 13, except that a release already in flight completes);
- between polls, both before the delay and via the delay's own `signal`.

On abort the pass releases every held claim, reports every already-acknowledged outcome, and returns `stopReason: "cancelled"`.

## Security Controls

- Claim tokens come from `node:crypto` `randomBytes(32)` encoded as unpadded base64url, are held only in local step state, and never enter results, signals, errors, logs, or durable state.
- Only identifier fields are read from seam responses; bodies, authors, URLs, and unknown properties are discarded at projection and never referenced afterwards.
- Seam rejections are converted to a reason code with no message, no stack, and no URL.
- Ledger error payloads are reduced to a stable `ledgerErrorKind` string; no raw JSON, artifact contents, or operating-system message is surfaced.
- The watcher never force-releases, deletes, or resets another owner's claim, and never rewrites a ledger artifact.
- No module in the watcher graph imports a network, CLI, git, sandbox, agent, or control-plane module; this is asserted statically.

## Requirement Traceability

| Requirements  | Implementation                                                                                              | Tests                                  |
| ------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| FR-001–FR-008 | `runDevSquadAdoWorkflowWatchPass`, result envelope, validation module, per-candidate isolation, root export | TEST-001, TEST-004, TEST-019, TEST-025 |
| FR-009–FR-015 | Watcher-specific read seam, structural validation, projection, per-candidate observation calls              | TEST-002, TEST-003, TEST-018, TEST-024 |
| FR-016–FR-024 | Pure eligibility over record + observations + single poll clock reading, canonical ordering                 | TEST-005, TEST-006, TEST-007, TEST-015 |
| FR-025–FR-031 | Acquire-on-intent, random tokens, fencing carried per step, renewal guard, unconditional release            | TEST-008, TEST-009, TEST-010, TEST-011 |
| FR-032–FR-039 | Cursor-only checkpoint patch with expected revision/phase/status, derived operation IDs                     | TEST-004, TEST-012, TEST-013, TEST-022 |
| FR-040–FR-046 | Exact-match intake rules, suppression that still advances cursors, one signal per candidate                 | TEST-014, TEST-004, TEST-021           |
| FR-047–FR-053 | Poll loop, budgets, injected delay, deterministic backoff, cancellation gates, observation timeout          | TEST-016, TEST-017, TEST-018           |
| FR-054–FR-058 | Ledger category passthrough, candidate isolation, no artifact writes, redacted diagnostics                  | TEST-019, TEST-020, TEST-021, TEST-023 |

## Invariant Traceability

| Invariant | Enforcement                                                                             | Test                         |
| --------- | --------------------------------------------------------------------------------------- | ---------------------------- |
| INV-001   | Static dependency assertion plus seam-only observation                                  | TEST-024                     |
| INV-002   | Seam exposes observation methods only; recording fake asserts call set                  | TEST-003                     |
| INV-003   | Single poll clock reading, canonical ordering, pure eligibility                         | TEST-006, TEST-007           |
| INV-004   | Foreign-claim gate plus acquire-on-intent                                               | TEST-008                     |
| INV-005   | Fencing value carried on every mutation; ledger rejects superseded fences               | TEST-009                     |
| INV-006   | Signal appended only after checkpoint acceptance                                        | TEST-004, TEST-005, TEST-019 |
| INV-007   | `acted` set only from an accepted checkpoint response                                   | TEST-004, TEST-023           |
| INV-008   | Checkpoint IDs reused verbatim on retry; claim IDs scoped per acquisition               | TEST-012, TEST-023           |
| INV-009   | No phase table; intake rules are caller-supplied exact-match sets                       | TEST-014                     |
| INV-010   | Projection to identifiers, token isolation, redacted errors                             | TEST-021                     |
| INV-011   | Poll budget checked before each additional poll; elapsed budget bounds poll starts only | TEST-016                     |
| INV-012   | Finalizer releases every held claim on every exit path                                  | TEST-011, TEST-017           |
| INV-013   | Ledger recovery categories surfaced unchanged, never repaired                           | TEST-020                     |
| INV-014   | Per-candidate step isolation with independent outcomes                                  | TEST-019                     |
| INV-015   | Anchors compared between the pre-claim read and the acquired record                     | TEST-009                     |
| INV-016   | Every injected ledger call classified into a typed outcome or `ledger-fault`            | TEST-019, TEST-011           |

## Conformance Test Matrix

| Case   | Test                                                                                                                  |
| ------ | --------------------------------------------------------------------------------------------------------------------- |
| CC-001 | Seed record `137` rev 4 cursor `480`; observe `[480, 481]`; assert one signal citing rev 4 and cursor `481` at rev 5. |
| CC-002 | Rerun CC-001 inputs unchanged; assert `no-change`, zero signals, zero checkpoints, revision still 5.                  |
| CC-003 | Recording seam fake exposes write-shaped spies; assert only observation methods were invoked.                         |
| CC-004 | Interleave `watch-a` and `watch-b` passes over `137` with a 60s lease; assert one actor and one `claim-conflict`.     |
| CC-005 | Expire `watch-a`, take over with `watch-b`, replay `watch-a` checkpoint; assert `stale-fencing` and no mutation.      |
| CC-006 | Advance the record to rev 9 between read and checkpoint; assert `revision-conflict` and pass continuation.            |
| CC-007 | Phase `awaiting-approval` with rules `[implement, review]`; assert cursor advanced and `intake-suppressed`.           |
| CC-008 | Phase `custom-security-gate` listed in intake rules; assert a signal is emitted with no allowlist error.              |
| CC-009 | Candidate `999` uninitialized; assert `skipped` / `record-not-found` and no record created on disk.                   |
| CC-010 | Three shuffled input orders; assert identical outcomes, reason codes, and recorded seam call order.                   |
| CC-011 | No eligible candidate with `maxPolls = 3`; assert 3 polls, 2 recorded delays, `poll-budget-exhausted`.                |
| CC-012 | Abort after the first checkpoint acknowledgement; assert `cancelled`, acknowledged outcome present, claims released.  |
| CC-013 | Non-settling seam with `observationTimeoutMs = 5000`; assert `failed` / `observation-timeout` and continuation.       |
| CC-014 | Indeterminate checkpoint forces a multi-poll hold; assert renewal before inclusive expiry with unchanged fencing.     |
| CC-015 | Blank owner, duplicate candidates, `maxPolls = 0`, malformed intake rules; assert field paths and zero side effects.  |
| CC-016 | Seam without `observeWorkItemComments`; assert `seam-contract` error naming the method and zero mutations.            |
| CC-017 | Three candidates, one corrupt artifact; assert isolated `ledger-recovery` failure and two normal completions.         |
| CC-018 | Seam returns bodies, authors, and a credential-bearing URL; snapshot durable state, result, and errors for leaks.     |
| CC-019 | Pull-request entry with a thread but no comment identifier; assert no PR cursor persisted and stable reason.          |
| CC-020 | Full pass under the static dependency assertion with no network-capable module in the graph.                          |

## Success Verification

| Criterion | Verification                                                                                                                                                                        |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SC-001    | 1,000 repeated passes over frozen state compared by deep equality of outcomes, reason codes, and counts.                                                                            |
| SC-002    | 1,000 interleaved two-owner trials asserting exactly one actor each time, run in bounded concurrent batches over disjoint work items so the committed default meets the stated bar. |
| SC-003    | Stale-fencing trials assert zero cursor advances and zero revision changes.                                                                                                         |
| SC-004    | Cursor-advance-then-replay trials assert exactly one signal per observed event across passes.                                                                                       |
| SC-005    | Budget matrix over poll count, duration, and abort asserting termination and a stable stop reason.                                                                                  |
| SC-006    | Claim-lifecycle assertions on every exit path plus a negative force-release assertion.                                                                                              |
| SC-007    | Automated string scan of durable artifacts, results, signals, and errors for bodies, URLs, and tokens.                                                                              |
| SC-008    | Candidate-isolation trials comparing untouched candidates' revisions before and after a failure.                                                                                    |
| SC-009    | Assertion that every candidate outcome carries a nonempty stable reason code and outcome kind.                                                                                      |
| SC-010    | Static dependency test plus a suite that requests zero wall-clock waits from the injected delay source.                                                                             |

## Vertical Implementation Sequence

1. **Public contracts and validation**
   - Add Effect-free public types, result envelope, and the seam interface.
   - Add option validation, canonical candidate ordering, and seam structural validation.
   - RED→GREEN TEST-001, TEST-002.

2. **Operation identity and backoff**
   - Add `deriveDevSquadAdoWatcherOperationId` and the deterministic backoff computation.
   - RED→GREEN identifier stability and backoff schedule assertions feeding TEST-012, TEST-016.

3. **Observation and cursor selection**
   - Add seam invocation with timeout, projection to opaque identifiers, and the anchor rule.
   - RED→GREEN TEST-003, TEST-018, TEST-022.

4. **Single-candidate happy path**
   - Add read, eligibility, claim acquisition, checkpoint, release, and intake decision.
   - RED→GREEN TEST-004, TEST-005, TEST-014, TEST-015.

5. **Poll loop, budgets, and cancellation**
   - Add pending/resolved state, per-poll clock reading, budgets, delays, and cancellation gates.
   - RED→GREEN TEST-006, TEST-007, TEST-016, TEST-017.

6. **Claim lifecycle under contention**
   - Add the foreign-claim gate, renewal guard, indeterminate-checkpoint hold, and the release finalizer.
   - RED→GREEN TEST-008, TEST-009, TEST-010, TEST-011, TEST-013.

7. **Failure isolation and recovery**
   - Add ledger category mapping, per-candidate isolation, and restart assertions.
   - RED→GREEN TEST-019, TEST-020, TEST-023.

8. **Data minimization and package integration**
   - Add projection assertions, export through `src/index.ts`, README section, changeset, and the static dependency test.
   - RED→GREEN TEST-021, TEST-024, TEST-025.

Every step ends with passing tests before refactoring or proceeding.

## Engineering Practices

| Practice      | Decision                                                                                      | Reference                   |
| ------------- | --------------------------------------------------------------------------------------------- | --------------------------- |
| Public API    | Promise-based, discriminated results, JSDoc on every public member, no Effect leakage         | Repository coding standards |
| Runtime style | Plain async orchestration; Effect reserved for resource-owning modules such as ledger storage | ADR-0026                    |
| Testing       | Colocated Vitest suites through the public watcher API with injected clock, delay, and seam   | Repository coding standards |
| Determinism   | Single clock reading per poll, canonical ordering, injected delays, no wall-clock waiting     | ADR-0026                    |
| Security      | Random claim tokens, identifier-only projection, redacted diagnostics, fail-closed recovery   | ADR-0025, ADR-0026          |
| Release       | Minor changeset and README review for the new public behavior                                 | `CLAUDE.md`                 |

## Commands

Executable validation commands:

### Focused tests

```text
npm test -- DevSquadAdoWorkflowWatcher
```

### Full tests

```text
npm test
```

### Type checking

```text
npm run typecheck
```

### Build and public declaration validation

```text
npm run build
```

### Lint and formatting

```text
npm run format:check
```

### Diff validation

```text
git diff --check
```

### Local execution

This feature is a package API with no standalone process. Exercise it through the focused Vitest suite:

```text
npm test -- DevSquadAdoWorkflowWatcher
```

## Implementation Handoff

### Required artifacts

- `docs/features/devsquad-ado-workflow-watcher/spec.md`
- `docs/features/devsquad-ado-workflow-watcher/plan.md`
- `docs/adr/0026-devsquad-ado-workflow-watcher.md`
- `docs/adr/0025-devsquad-ado-workflow-ledger.md`

### Architectural assumptions

- The host supplies the candidate set, a stable `passId`, and already-initialized ledger records.
- The injected seam returns identifiers in the tracker's authoritative order and honours the `since` contract.
- The watcher's injected clock and the ledger's clock are the same time basis in tests.
- Claims are short-lived; a host reacting to a signal reacquires if it intends to mutate.
- Intake delivery is at-most-once and never duplicating, and applies to ledger-mediated delivery only, never to external side effects. A checkpoint that becomes durable without its acknowledgement being observed advances the cursor while its signal is never returned, so hosts reconcile completeness from the durable record rather than from the signal stream.
- A pass examines at most 1,000 candidates, inside ledger schema-v1 capacity bounds.

### Discarded alternatives

- Reusing `AdoReadOnlyControlPlane` as the observation seam.
- Watcher-generated or random pass identity.
- Callback or event-emitter intake delivery.
- A long-lived watcher daemon.
- Concurrent candidate processing.
- Suppressing cursor advancement when intake rules reject a record.
- Watcher-initialized ledger records.

### Implementation gate

ADR-0026 is Proposed and ADR-0025 remains Proposed. Implementation may proceed against both only while preserving their boundaries and security controls; acceptance remains a separate review action.
