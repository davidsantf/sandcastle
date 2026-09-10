# DevSquad/ADO Workflow Watcher Specification

**Historical third-review follow-up (2026-09-10; superseded by final turn 4):** The third independent review FAILED on Critical RC14-008: ambiguous checkpoint history bypassed original-request acceptance checks (FR-036/059, INV-007). Implementation shared direct/replay validation with history recovery and retained each submitted request separately from retry preconditions. W038 remained FAILED at that stage; remediation alone was not independent approval.

**Current recovery status (2026-09-10): W038 completed TECHNICAL only.** Final fresh independent `devsquad.review` turn 4 PASSED with no blockers: 0 Critical, 0 Major, 1 nonblocking Minor TB001 (older tests' internal guard/object-identity coupling; acknowledged, no required fix). W029-W037 are complete; all five guardians completed and the separate security specialist found no vulnerabilities. RC14-008 is independently closed by original-submission/history consistency and 36 independent public-pass probes; original R14-001-007, RC14-001-008, SC-01/02, SL14-001, DOC14-001 and additional obligations are closed/preserved in `review-log.md`. The second review's three Major/one Minor failures and all other earlier verdicts remain historical. Fresh tests/typecheck/declaration evidence is distinct from the inherited ESM/DTS build and unchanged Windows postbuild failure; no fresh packaging success is claimed. Technical conformance grants neither ADR acceptance nor merge readiness. ADR-0025/0026 remain Proposed pending authorized acceptance; no board item is linked. Parent publication remains separate, #20 must merge before #21, and slice 15 remains blocked until the creator's explicit decision.

## Executive Summary

- **Objective:** Give a DevSquad host a deterministic, bounded watcher that observes injected ADO/GitHub work-item and pull-request signals, decides eligibility, and records durable coordination checkpoints in the workflow ledger without taking ownership of the DevSquad lifecycle.
- **Primary user:** A DevSquad host coordinator that supplies candidates and exact phase/status intake rules and consumes activity signals.
- **Value delivered:** One offline-testable watch pass with fenced ledger mutations, at-most-once batched intake, bounded scheduling, and honest cooperative cancellation; no discovery or filtering orchestration.
- **Scope:** Includes an injected read-oriented control-plane seam, deterministic eligibility evaluation, ledger claim/lease/fencing/idempotency use, cursor and comment-observation persistence, bounded polling with deterministic backoff and cancellation, and typed operations; excludes live network access, phase legality, agent execution, and pull-request authority.
- **Primary success criterion:** For fixed injected observations, clock, and ledger state, repeated passes produce deterministic decisions and at most one batched intake signal per candidate per pass after a validated durable checkpoint acknowledgement. Signals can be lost after a durable-unacknowledged checkpoint or host crash; the host reconciles durable cursors with intake processing.

## Objective

Add a host-side workflow watcher that turns injected external observations into deterministic, durably checkpointed intake signals for DevSquad.

The watcher runs one bounded watch pass over a caller-supplied set of candidate work items. For each candidate it reads the durable ledger record, evaluates eligibility as a pure decision, acquires an exclusive local claim when it intends to act, records newly observed cursors, and emits an intake signal describing what DevSquad should consider next.

The watcher is an observation and coordination component. It is not a scheduler of agents, not an owner of DevSquad phase semantics, and not a client of any live tracker service.

## Context

Slice 13 delivered the persistent DevSquad/ADO workflow ledger (`openDevSquadAdoWorkflowLedger`) and ADR-0025, which established the ledger as an offline, fenced, repository-local coordination checkpoint with claims, leases, fencing values, idempotency receipts, and strict fail-closed recovery.

The ledger deliberately does not observe anything. It stores opaque work-item comment cursors and pull-request thread/comment cursors, but nothing in Sandcastle currently decides _when_ a record should be revisited, _which_ external events are new, or _how_ to bound that work.

Existing ADO components already establish the injected control-plane pattern: `AdoControlPlaneFactory` distinguishes `read-only` from `write` access and validates injected client methods, and `runAdoFeedbackLoop` accepts a structurally validated control-plane-like object with bounded observation counts. Those components observe a single already-published pull request; they do not maintain durable per-work-item cursors, claims, or restart-safe intake decisions.

Without this slice, a host coordinator must hand-roll polling, deduplication, claim handling, and termination logic around the ledger, which is exactly where double-processing, unbounded loops, and stale-owner writes appear.

## Scope

### Included

- One bounded watch pass over a caller-supplied candidate set.
- An injected, read-oriented ADO/GitHub observation seam with no live transport.
- Deterministic eligibility evaluation with stable reason codes and stable ordering.
- Ledger claim acquisition, renewal (heartbeat), and release around watcher actions.
- Fencing-protected, revision-checked, idempotent ledger checkpoints written by the watcher.
- Durable persistence of last-seen work-item comment and pull-request thread/comment cursors.
- New-event selection relative to persisted cursors, without retaining external bodies.
- DevSquad intake signals emitted only when caller-supplied phase/status intake rules match.
- Deterministic bounded polling, deterministic backoff, and cooperative cancellation.
- Typed operations, structured errors, and a token-free public result projection.
- Deterministic tests using injected observations, injected clock, injected timers, and isolated ledger fixtures.

### Excluded

- Live ADO, GitHub, MCP, REST, Azure CLI, Azure DevOps CLI, or other network calls.
- Owning, defining, or validating the DevSquad phase state machine or transition legality.
- Deciding whether a work item should be worked on as a product/priority matter.
- Selecting, assigning, or claiming work items in the external tracker.
- Creating, updating, approving, completing, or merging pull requests.
- Posting external comments or work-item updates.
- Running agents, creating sandboxes, creating worktrees, or executing git operations.
- Storing comment bodies, review bodies, prompts, credentials, tokens, or agent-session contents.
- Long-lived daemon/service hosting, process supervision, or cross-machine scheduling.
- Modifying ledger schema v1, its durability protocol, or its capacity ceilings.
- Modernizing existing ADO control-plane, feedback-loop, team-runner, or execution-adapter APIs.

## Actors

- **DevSquad host coordinator:** Invokes a watch pass, supplies candidates, intake rules, budgets, and owner identity, and consumes intake signals.
- **DevSquad lifecycle owner:** Decides what an intake signal means, whether a phase may change, and what runs next.
- **Injected observation seam:** Supplies work-item and pull-request observations from a host-owned client or a test fake.
- **Workflow ledger:** Owns durability, claims, fencing, idempotency, and recovery semantics from slice 13.
- **Operator:** Diagnoses why a work item was skipped, deferred, conflicted, or reported as recovery-blocked.

## User Scenarios and Tests

### Scenario 1: New work-item comment becomes one intake signal

**Given** a ledger record for work item `137` whose last-seen work-item comment cursor is `480`, and injected observations containing comments `480` and `481`,
**When** a watch pass runs and the record's phase/status match the caller's intake rules,
**Then** exactly one intake signal is emitted describing new work-item activity, and the record's cursor is durably advanced to `481` before the pass reports success.

### Scenario 2: Already-observed events do not repeat

**Given** the ledger record from Scenario 1 after the cursor advanced to `481`,
**When** a second watch pass runs against the identical injected observations,
**Then** no intake signal is emitted, no checkpoint is written, and the record revision is unchanged.

### Scenario 3: Concurrent watchers cannot both act

**Given** two watch passes with different owner identities target the same work item while no claim has expired,
**When** their claim acquisitions overlap,
**Then** exactly one pass acts and the other reports a `claim-conflict` skip for that candidate without mutating the record and without aborting its remaining candidates.

### Scenario 4: Stale watcher cannot write after takeover

**Given** a watcher's claim lease expires and another owner takes over with a higher fencing value,
**When** the former watcher attempts to checkpoint an observed cursor,
**Then** the ledger rejects the mutation as stale, the watcher surfaces a stale-ownership outcome, and no cursor is advanced.

### Scenario 5: Bounded scheduling and cooperative cancellation

**Given** a watch pass configured with a maximum poll count, a deterministic backoff schedule, and a cancellation signal,
**When** no candidate becomes eligible, or the signal is aborted mid-pass,
**Then** no further poll is scheduled beyond the budget, each observation receives cancellation, and every candidate reports cleanup evidence. Termination assumes ledger operations and delays settle; noncooperating dependencies cannot be forcibly terminated.

### Scenario 6: Phase rules gate intake, not lifecycle meaning

**Given** a record whose phase is `awaiting-approval` and caller intake rules that only admit `implement` and `review`,
**When** new external activity is observed,
**Then** the cursor is still advanced durably, the candidate is reported as intake-suppressed with a stable reason, and no intake signal is emitted; Sandcastle applies no phase ordering of its own.

## Functional Requirements

### Watch Pass and Typed Operations

- **FR-001:** The feature shall expose a typed operation that runs exactly one bounded watch pass and resolves with a structured result or a structured error, without throwing untyped errors for expected conditions.
- **FR-002:** A watch pass shall accept an opened workflow ledger, an injected observation seam, an owner identifier, a candidate set, intake rules, budget configuration, an injected UTC clock, an injected delay source, and an optional cancellation signal.
- **FR-003:** All watch inputs shall be validated before any injected side effects, including clock, delay, seam, or ledger invocation. An optional signal must expose boolean `aborted` and callable `addEventListener` and `removeEventListener`.
- **FR-004:** Validation shall reject a blank owner identifier, an empty or duplicate canonical candidate set, invalid work-item identifiers, invalid budgets, lease durations, backoff parameters, and intake rules. Candidates number 1–1,000 inclusive; `maxPolls` is a safe integer 1–10,000 inclusive; durations are positive safe integers, lease is at most 86,400,000ms, and the positive renewal threshold is strictly below the lease. No duplicate candidate is silently deduplicated.
- **FR-005:** The watch result shall report, per candidate, a stable outcome discriminator, a stable reason code, and the resulting durable revision when a mutation was accepted.
- **FR-006:** The watch result shall report pass-level counts, polls, and a stable stop reason. `acted` counts returned intake signals; `suppressed` counts acknowledged suppressed cursor advances; `failed` counts final failed candidates and may overlap acted/suppressed. `cleanupReleased`, `cleanupFailed`, `cleanupIndeterminate`, and `cleanupNotRequired` partition all candidate outcomes.
- **FR-007:** A failure affecting one candidate shall not abort the remaining candidates unless the failure is a pass-level fault (invalid input, cancellation, ledger-open failure, or budget exhaustion).
- **FR-008:** Public watcher operations and types shall be exported through the package's established public entry point.

### Injected Observation Seam

- **FR-009:** The watcher shall obtain every external observation through an injected seam and shall never construct a transport, client, credential, or URL of its own.
- **FR-010:** The seam shall be read-oriented: it shall expose only observation methods and shall never be invoked to update work items, post comments, or mutate pull requests.
- **FR-011:** The watcher shall structurally validate the seam before use and shall return a stable configuration error naming the missing method when a required method is absent.
- **FR-012:** The watcher shall treat every identifier returned by the seam as opaque and shall not parse, order, or arithmetically compare identifier text.
- **FR-013:** Seam rejections shall be converted into stable per-candidate observation errors that do not include raw transport messages, URLs with credentials, or external bodies.
- **FR-014:** The watcher shall call the seam at most once per candidate per poll for each observation kind it needs.
- **FR-015:** The watcher shall not require pull-request observations for a candidate that has no persisted pull-request identifier.

### Deterministic Eligibility

- **FR-016:** Eligibility shall be a deterministic function of the candidate identifier, the durable ledger record, the injected observations, the caller configuration, and the single clock reading for that poll.
- **FR-017:** The watcher shall read the injected clock once per poll and shall use that value for every eligibility, lease, and timestamp decision in the poll.
- **FR-018:** Candidates shall be evaluated in a stable deterministic order derived from canonical work-item identity, independent of input ordering.
- **FR-019:** Every eligibility decision shall carry a stable reason code, including for ineligibility.
- **FR-020:** A candidate shall be ineligible when the ledger record does not exist, and the watcher shall not initialize records on the host's behalf.
- **FR-021:** A candidate shall be ineligible when an unexpired claim is held by another owner, reported as a claim conflict rather than a fault.
- **FR-022:** A candidate shall be eligible for action only when at least one observed external event is newer than the persisted cursor for that event kind.
- **FR-023:** Eligibility shall not be inferred from phase or status names beyond the caller-supplied intake rules.
- **FR-024:** Repeating a watch pass with identical inputs and unchanged durable state shall produce an identical decision set.

### Claims, Leases, and Fencing

- **FR-025:** Before mutating a record, the watcher shall acquire a ledger claim using the owner identifier, a freshly generated capability token, and the caller-supplied lease duration.
- **FR-026:** The watcher shall generate claim tokens from a cryptographically random source and shall never log, return, persist, or embed a token in results, errors, or diagnostics.
- **FR-027:** The watcher shall carry the acquired fencing value on every subsequent mutation for that candidate within the pass.
- **FR-028:** When a pass spans more than one poll while holding a claim, the watcher shall renew the claim before the lease reaches its inclusive expiry.
- **FR-029:** At candidate completion, cancellation, or error the watcher shall invoke release exactly once for previously validated authority, retaining local authority evidence until the response is validated. It shall never retry release, guess authority, reacquire for cleanup, or report release without a validated acknowledgement. Without validated authority there shall be zero release calls. Every candidate shall carry the mandatory cleanup object defined below; inclusive lease expiry remains the backstop, not proof of release.
- **FR-030:** A `claim-conflict`, `claim-expired`, `stale-fencing`, or `claim-authorization` result shall be surfaced as a distinct stable outcome and shall never be retried by silently re-acquiring within the same candidate step.
- **FR-031:** The watcher shall not delete, reset, or force-release a claim owned by another owner.

### Cursor and Observation Persistence

- **FR-032:** Newly observed work-item comment cursors and pull-request thread/comment cursors shall be persisted through ledger checkpoints that supply the expected revision, expected phase, and expected status.
- **FR-033:** The watcher shall persist only opaque identifiers and shall never persist comment bodies, review bodies, authors, prompts, credentials, or tokens.
- **FR-034:** A pull-request cursor shall be persisted only when both thread and comment identifiers are available; a kind reported in `skippedCursorKinds` shall never also appear in `cursorChanges` for the same outcome.
- **FR-035:** The watcher shall select the next cursor from seam ordering only, never sort or numerically order observation identifiers. Work-item identity is exact `commentId`; PR identity is exact `(threadId, commentId)` after only missing/undefined/null comment normalization to null. Reject every duplicate identity. Blank comments are invalid identifiers, not missing comments. Mixed new PR entries advance to the newest complete pair; mark PR skipped only when none of the new entries is persistable.
- **FR-035b:** Each work-item or PR window has inclusive limits of 1,000 entries and 1,048,576 aggregate UTF-8 identifier bytes; PR bytes sum `threadId` and nonnull `commentId`. Each identifier remains limited to 1,024 UTF-8 bytes. Check count before iteration/copy and accumulate bytes and uniqueness before retaining each entry, with no oversized full projection or truncation. Malformed windows, duplicates, or aggregate/count excess fail the entire candidate observation as `failed` / `invalid-observation-window`, even when the other kind is valid. Individual identifier violations remain `invalid-observation-identifier`. The host SHOULD bound upstream responses; the watcher MUST validate independently. The WI aggregate limit is redundant with 1,000 × 1,024 = 1,024,000 bytes; use PR windows for independently reachable aggregate-boundary tests, without relaxing either WI bound.
- **FR-035a:** When a persisted cursor anchor is absent from a non-empty seam window, the watcher shall fail that candidate closed with a stable anchor-loss outcome and shall advance no cursor.
- **FR-036:** Cursor advancement shall be acknowledged as durable before the corresponding intake signal is reported as delivered by the pass result.
- **FR-036a:** Before checkpointing, the watcher shall verify that the observation anchors and pull-request identity read before the claim are unchanged in the record returned by the acquisition; if they moved, it shall release the claim, advance no cursor, and report a stable stale-observation outcome.
- **FR-037:** Every watcher mutation shall supply an operation identifier derived from canonically serialized identity: a checkpoint identifier scoped to the exact cursor advance it publishes, so retrying an ambiguous mutation replays the original outcome; and a claim-lifecycle identifier scoped to a random per-acquisition claim epoch, so a retry under the same pass identity can always acquire again.
- **FR-037a:** The claim epoch shall be an idempotency namespace only; it shall never be a capability, and capability tokens shall remain independently random.
- **FR-038:** An `idempotency-conflict` result shall be surfaced as a distinct stable outcome and shall not be resolved by generating a different operation identifier within the same step.
- **FR-039:** A `revision-conflict` or `state-conflict` result shall end that candidate's step with a stable conflict outcome, leaving durable state unchanged.

### DevSquad Intake Boundary

- **FR-040:** The watcher shall emit intake signals only; it shall never invoke DevSquad, transition a phase, or write phase/status values not supplied by the caller.
- **FR-041:** An intake signal shall be emitted only when the record's current phase and status satisfy the caller-supplied intake rules.
- **FR-042:** When intake rules do not admit the record, the watcher shall report a stable intake-suppressed outcome while still persisting observed cursors.
- **FR-043:** Intake rules shall be exact-match sets supplied by the caller; Sandcastle shall define no default phase list, ordering, or terminal state.
- **FR-044:** An intake signal shall identify the work item, the durable revision it was derived from, the observation kinds that changed, and the token-free claim metadata under which it was produced.
- **FR-045:** Intake signals shall contain no external bodies, no claim tokens, and no agent-session contents.
- **FR-046:** The watcher shall emit at most one intake signal per candidate per pass.

### Bounded Polling, Backoff, and Cancellation

- **FR-047:** A watch pass shall stop at the first of: all candidates resolved, maximum polls reached, the poll-start elapsed budget reached, or cancellation.
- **FR-048:** Maximum polls and the poll-start elapsed budget shall be validated and enforced before each additional poll. The elapsed budget bounds poll scheduling, not runtime or physical requests. Ledger operations are awaited rather than abandoned; liveness requires them and injected delays to settle.
- **FR-049:** Delays between polls shall be produced by an injected delay source so tests are deterministic and require no wall-clock waiting.
- **FR-050:** Backoff shall follow a deterministic schedule derived from a base interval, multiplier, and maximum interval, with no randomness unless an explicit jitter source is injected.
- **FR-051:** Cancellation shall be freshly checked immediately before each seam call, before each non-cleanup ledger mutation, and between polls. A work-item seam that returns valid data while aborting the parent must prevent PR invocation. Mandatory cleanup is not skipped because the parent is aborted.
- **FR-052:** Cancellation shall still attempt cleanup for validated authority and report acknowledged checkpoint outcomes and signals; release cannot retract or roll back them.
- **FR-053:** Each observation shall have a dedicated AbortController passed into the seam and linked to its parent. Timeout or abort cancels the seam and timer; every terminal path removes links/listeners and consumes or quarantines late settlements so they cannot change outcomes or create unhandled rejections. Timeout presumes a valid settling delay. Cancellation is cooperative, not forcible termination or an unconditional runtime/physical-request bound.

### Recovery and Fail-Closed Behavior

- **FR-054:** Ledger recovery errors (`corrupt-artifact`, `unsupported-schema-version`, `path-boundary`, `unsupported-permissions`, `capacity-exceeded`, `scan-limit`) shall be surfaced with their stable ledger category and shall not be repaired, reset, or bypassed by the watcher.
- **FR-055:** A record blocked by a recovery error shall be reported as a failed candidate and shall not prevent other candidates from being processed.
- **FR-056:** The watcher shall not create, delete, or rewrite ledger artifacts other than through the ledger's public typed operations.
- **FR-057:** A pass that fails at pass level shall leave every previously acknowledged durable outcome intact and observable after restart.
- **FR-058:** Watcher errors and diagnostics shall use stable categories and shall never contain claim tokens, raw JSON, external bodies, or unredacted operating-system messages containing caller data.
- **FR-059:** Every `readRecord`, `acquireClaim`, `renewClaim`, `checkpoint`, and `releaseClaim` response shall undergo method-specific runtime validation, not an `ok: true` cast. Validate the complete latest public record projection, canonical work-item identity, known outcome discriminator, accepted timestamp/revision/replay metadata, and owner/token/fencing/request consistency where applicable. Validate every known ledger error variant and its required fields; unknown categories, malformed variants, throws, and rejections become only `ledger-fault`, never arbitrary `error.kind` text. A non-cleanup fault produces `failed` / `ledger-unavailable`; cleanup follows FR-060. A replay's original accepted revision may be lower than its valid latest record revision. A malformed acquire establishes no authority and cannot fabricate a release; a malformed checkpoint acknowledgement suppresses all unacknowledged effects even if storage mutated durably, potentially losing its signal.
- **FR-060:** Every candidate shall report cleanup status/reason/category/revision independently of its primary outcome. Failed or indeterminate cleanup promotes an otherwise nonfailed candidate to `failed` / `ledger-unavailable` for `ledger-fault`, otherwise `failed` / `claim-cleanup-unconfirmed`. Preserve an existing primary failed reason. Preserve acknowledged checkpoint revision, cursor changes, and returned intake signal; no rollback or retraction.

### Mandatory Cleanup Contract

Every candidate outcome contains `cleanup: { status, reason, ledgerErrorKind, acceptedRevision }`. Status is `released | failed | indeterminate | not-required`; reason is `release-acknowledged | release-rejected | release-indeterminate | authority-unvalidated | no-claim-acquired`. `ledgerErrorKind` is a validated `DevSquadAdoLedgerError["kind"]`, `ledger-fault`, or null; `acceptedRevision` is a positive safe integer or null.

| Evidence                                                   | Status / reason                           | Category / accepted revision                                        |
| ---------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------- |
| Validated release acknowledgement (including exact replay) | `released` / `release-acknowledged`       | null / original accepted release revision                           |
| Known release rejection, including `storage` / `unchanged` | `failed` / `release-rejected`             | validated category / null                                           |
| Release `storage` / `indeterminate` or `contention`        | `indeterminate` / `release-indeterminate` | validated category / null                                           |
| Release throws, rejects, or is malformed                   | `indeterminate` / `release-indeterminate` | `ledger-fault` / null                                               |
| Faulting or ambiguous acquire with no validated authority  | `indeterminate` / `authority-unvalidated` | `ledger-fault` or validated ambiguous category / null; zero release |
| No acquired claim and no acquisition uncertainty           | `not-required` / `no-claim-acquired`      | null / null; zero release                                           |

A replay acknowledges the original release, not absence of a later owner. Validate the original operation metadata and the complete latest record without requiring that latest record to have no active claim. `sourceRevision` is pre-acquire, outcome `revision` records the acknowledged checkpoint revision when present, and cleanup `acceptedRevision` is the original release revision; never replace one with another.

## Key Entities

### Watch Pass Request

The complete, validated description of one bounded observation pass.

| Attribute        | Description                                                           |
| ---------------- | --------------------------------------------------------------------- |
| Ledger           | Opened workflow ledger instance from slice 13                         |
| Observation seam | Injected read-oriented client used for every external observation     |
| Owner ID         | Diagnostic coordinator identity used for ledger claims                |
| Candidates       | Caller-supplied work-item identifiers to examine                      |
| Intake rules     | Exact-match phase and status sets that admit intake signals           |
| Budgets          | Maximum polls, poll-start elapsed budget, per-observation timeout     |
| Lease config     | Claim lease duration and renewal threshold                            |
| Backoff config   | Base interval, multiplier, maximum interval, optional injected jitter |
| Clock and delay  | Injected UTC clock and injected delay source                          |
| Cancellation     | Optional cooperative abort signal                                     |

### Candidate Outcome

The stable per-work-item result of one watch pass.

| Attribute      | Description                                                                  |
| -------------- | ---------------------------------------------------------------------------- |
| Work item ID   | Canonical identifier as recorded by the ledger                               |
| Outcome kind   | `acted`, `no-change`, `intake-suppressed`, `skipped`, or `failed`            |
| Reason code    | Stable machine-readable reason for the outcome                               |
| Revision       | Durable revision observed or accepted, when applicable                       |
| Cursor changes | Which observation cursors advanced, without bodies                           |
| Claim metadata | Token-free owner, fencing value, and expiry under which the step ran         |
| Cleanup        | Mandatory cleanup object, including unconfirmed release or acquire authority |

### Intake Signal

A token-free proposal handed to the DevSquad host for lifecycle interpretation.

| Attribute       | Description                                         |
| --------------- | --------------------------------------------------- |
| Work item ID    | Canonical identifier                                |
| Source revision | Durable revision the signal was derived from        |
| Changed kinds   | `work-item-comment`, `pull-request-thread`, or both |
| Phase/status    | Exact caller-defined values read from the record    |
| Claim metadata  | Token-free claim owner, fencing value, and expiry   |

### Observation Snapshot

The injected, in-memory view of one candidate's external activity for one poll: ordered opaque work-item comment identifiers and ordered opaque pull-request thread/comment cursors. Snapshots are never persisted.

### Eligibility Decision

The pure result of evaluating one candidate: eligible or ineligible, plus a stable reason code and the observation kinds considered new relative to persisted cursors.

## Invariants

- **INV-001 — Injected boundary:** Every external observation passes through the injected seam; the watcher performs no network, MCP, CLI, git, sandbox, or agent operation.
- **INV-002 — Read-only externally:** A watch pass never mutates external tracker state.
- **INV-003 — Deterministic decisions:** Identical inputs, clock readings, and durable state always yield identical decisions, ordering, and reason codes.
- **INV-004 — Single active owner:** A watcher never mutates a record it does not currently own under an unexpired claim.
- **INV-005 — Fenced writes:** A superseded fencing value can never advance a cursor or write a checkpoint.
- **INV-006 — Non-duplicating intake:** Each externally observed event yields at most one intake signal across all passes, because cursor advancement is durable before delivery is reported. Delivery is at-most-once, not lossless: a durable-but-unacknowledged advance can move a cursor without its signal ever being returned.
- **INV-007 — Durable-before-report:** No candidate is reported as `acted` unless its checkpoint was acknowledged as durable.
- **INV-008 — Idempotent steps:** Replaying a watcher step's operation identifier cannot create a duplicate revision, checkpoint, or cursor advance; and no operation identifier is ever reused for a mutation the ledger would have to reject as an idempotency conflict.
- **INV-009 — Lifecycle separation:** The watcher records and reports phase and status but never determines their legality, ordering, or next value.
- **INV-010 — Data minimization:** No external body, credential, token, prompt, or session content enters durable state, results, logs, or errors.
- **INV-011 — Bounded scheduling:** Poll/count/window bounds limit watcher work; liveness assumes settling ledger operations and delays, and observation timeout assumes a valid timer. Noncooperating seams cannot be forcibly terminated; no unconditional runtime or physical-request bound is claimed.
- **INV-012 — Claim hygiene:** Exactly one release invocation follows previously validated authority on candidate exit; no validated authority means zero release. Cleanup evidence is mandatory and truthful; inclusive expiry is the backstop and another owner's claim is never force-released.
- **INV-013 — Fail-closed recovery:** Corrupt, unsupported, or capacity-blocked records are reported and isolated, never repaired or reset by the watcher.
- **INV-014 — Candidate isolation:** One candidate's failure never corrupts, blocks, or alters another candidate's durable state.
- **INV-015 — No cursor regression:** A checkpoint never moves an observation cursor to a position derived from anchors that are no longer durable; an observation invalidated between its read and its claim is abandoned, not written.
- **INV-016 — Typed injected boundaries:** No injected dependency — seam, ledger, clock, or delay — can escape the pass as an untyped throw, and none of their raw values reach results, errors, or diagnostics.

## Conformance Criteria

| ID     | Scenario                                | Input                                                                                                                                                                  | Expected Output                                                                                                                                                                                           | Traces                                  |
| ------ | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| CC-001 | Happy-path intake                       | Record `137` at revision `4`, cursor `480`, injected comments `[480, 481]`, intake rules admit its phase/status                                                        | Acquire revision `5`; checkpoint cursor `481` at accepted revision `6`; release revision `7`. One signal cites source revision `4`; outcome revision `6`, cleanup accepted revision `7`                   | FR-022, FR-029, FR-032, FR-036, INV-007 |
| CC-002 | Idempotent replay across passes         | Rerun CC-001 inputs with unchanged durable state                                                                                                                       | `no-change`, no signal, no acquire/checkpoint/release; then-current revision `7` unchanged and cleanup `not-required`                                                                                     | FR-024, FR-046, INV-006                 |
| CC-003 | Negative: no external writes            | Seam fake records every invocation during a full pass                                                                                                                  | Only observation methods are invoked; zero update, comment, or pull-request mutation calls                                                                                                                | FR-010, INV-002                         |
| CC-004 | Concurrent watchers                     | Owners `watch-a` and `watch-b` run overlapping passes over `137` with a 60s lease                                                                                      | One acts; the other reports `skipped` with reason `claim-conflict` and continues its remaining candidates                                                                                                 | FR-021, FR-007, INV-004                 |
| CC-005 | Negative: stale owner must not write    | `watch-a` lease expires, `watch-b` takes over, then `watch-a` checkpoints a cursor                                                                                     | Mutation rejected as `stale-fencing`; cursor, revision, and `watch-b` claim unchanged                                                                                                                     | FR-027, FR-030, INV-005                 |
| CC-006 | Revision conflict                       | Record advanced to revision `9` by another writer while the watcher expected `8`                                                                                       | Candidate ends with stable `revision-conflict` outcome; durable state unchanged; pass continues                                                                                                           | FR-039, INV-014                         |
| CC-007 | Intake suppressed by phase rules        | Record phase `awaiting-approval`; intake rules admit only `implement` and `review`; new comment `482` observed                                                         | Cursor advances durably; outcome `intake-suppressed`; no intake signal; no Sandcastle-defined phase ordering applied                                                                                      | FR-041, FR-042, INV-009                 |
| CC-008 | Unknown phase is not rejected           | Record phase `custom-security-gate` included in caller intake rules                                                                                                    | Intake signal emitted; no allowlist error                                                                                                                                                                 | FR-043, INV-009                         |
| CC-009 | Missing record                          | Candidate `999` has no initialized ledger record                                                                                                                       | Outcome `skipped` with reason `record-not-found`; watcher does not initialize the record                                                                                                                  | FR-020                                  |
| CC-010 | Deterministic ordering                  | Same candidate set supplied in three different input orders                                                                                                            | Identical decision sequence, identical reason codes, identical seam call order                                                                                                                            | FR-018, INV-003                         |
| CC-011 | Bounded polling                         | No candidate ever becomes eligible; `maxPolls = 3`                                                                                                                     | Exactly 3 polls; stop reason `poll-budget-exhausted`; two deterministic backoff delays requested from the injected delay source                                                                           | FR-047, FR-048, FR-050, INV-011         |
| CC-012 | Cancellation mid-pass                   | Abort after first checkpoint acknowledgement; cooperating seam/delay and valid release acknowledgement                                                                 | Stop `cancelled`; acknowledged outcome/signal retained; release once for validated authority, cleanup released; failure variants in CC-028                                                                | FR-051, FR-052, INV-012                 |
| CC-013 | Observation timeout                     | Seam observation never settles; per-observation timeout `5000ms` on the injected clock/delay                                                                           | Candidate outcome `failed` with reason `observation-timeout`; pass continues with remaining candidates                                                                                                    | FR-053, FR-007                          |
| CC-014 | Lease renewal                           | Pass spans multiple polls while holding a claim near expiry                                                                                                            | Claim renewed before inclusive expiry; fencing value unchanged; no takeover occurs                                                                                                                        | FR-028, INV-004                         |
| CC-015 | Invalid configuration                   | Blank owner ID, duplicate candidates, `maxPolls = 0`, malformed intake rules                                                                                           | Structured validation errors naming stable field paths; no seam call and no ledger mutation occur                                                                                                         | FR-003, FR-004                          |
| CC-016 | Seam contract violation                 | Injected client missing the work-item observation method                                                                                                               | Stable configuration error naming the missing method; pass performs no mutation                                                                                                                           | FR-011                                  |
| CC-017 | Corrupt record isolation                | One of three candidates has a corrupt durable artifact                                                                                                                 | That candidate reports `failed` with ledger category `corrupt-artifact`; the other two complete normally; artifact is not rewritten                                                                       | FR-054, FR-055, INV-013                 |
| CC-018 | Negative: no secrets or bodies leak     | Seam returns comments with bodies, authors, and a credential-bearing URL                                                                                               | Durable state, results, errors, and diagnostics contain only opaque identifiers; no body, author, credential, or claim token appears                                                                      | FR-033, FR-045, FR-058, INV-010         |
| CC-019 | PR cursor completeness                  | Observation supplies a thread identifier with no comment identifier                                                                                                    | No pull-request cursor is persisted; candidate reports a stable incomplete-cursor reason                                                                                                                  | FR-034                                  |
| CC-020 | Offline determinism                     | Full pass executed with network access unavailable                                                                                                                     | Pass completes using injected observations and repository-local ledger state only                                                                                                                         | FR-009, INV-001                         |
| CC-021 | Retry after an unlanded checkpoint      | A pass acquires a claim durably, its checkpoint never lands, the claim is released; the same `passId` runs again                                                       | The retry acquires again and completes normally; no `idempotency-conflict`; each acquisition carries its own operation identifier                                                                         | FR-037, FR-037a, INV-008                |
| CC-022 | Stale observation at acquisition        | Owner `watch-b` advances `137` from cursor `10` to `15` and releases between `watch-a`'s read and its acquisition                                                      | `watch-a` writes nothing, releases its claim, reports `no-change` / `stale-observation`; durable cursor stays `15` and is never set to `12`                                                               | FR-036a, INV-015                        |
| CC-023 | Anchor lost from a non-empty window     | Record cursor `480`; seam returns `[481, 482]` without the anchor                                                                                                      | Candidate reports `failed` / `observation-anchor-missing`; no cursor advances; other candidates complete normally                                                                                         | FR-035a, INV-006                        |
| CC-024 | Injected ledger method faults           | All five methods throw/reject or return malformed successes/errors, including `readRecord` with `{}` and attacker-controlled error kind                                | Fail closed with only `ledger-fault`; method-specific validation, no fabricated authority or acknowledgement; cleanup per FR-060, no leaked payload                                                       | FR-059, FR-060, INV-016                 |
| CC-025 | Fresh abort and signal preflight        | Missing/noncallable add/remove listener, nonboolean aborted; valid WI response aborts parent                                                                           | Invalid signal rejected before all injected side effects; parent abort prevents PR call                                                                                                                   | FR-003, FR-051                          |
| CC-026 | Bounded unique windows                  | Count 1,000/1,001; aggregate bytes 1,048,576/1,048,577; 1,024-byte identifiers; duplicate WI and PR pairs including null/undefined equivalents                         | Exact inclusive limits; overflow/duplicate invalidates entire candidate before acquire; no dedup/truncation/oversized copy                                                                                | FR-035, FR-035b                         |
| CC-027 | Cooperative cancellation lifecycle      | Success/rejection/timeout/abort and late settlement; multiple candidates                                                                                               | Dedicated seam signal; timer and links cleaned; no later mutation/signal; record maximum concurrent cooperative seam/timer operations; explicitly demonstrate noncooperating seam limitation              | FR-051–FR-053, INV-011                  |
| CC-028 | Cleanup evidence and counts             | Every cleanup matrix row after success/suppression/primary failure/abort; release replay after later takeover                                                          | Exactly one release per validated authority, zero otherwise; preserve checkpoint and signals; final failure promotion and overlapping acted/suppressed/failed counts; cleanup counts partition candidates | FR-029, FR-060, FR-006                  |
| CC-029 | Replay and authority validation         | Original accepted revision below latest record; wrong work item/owner/token/fence/outcome/request; durable mutation followed by malformed acknowledgement              | Valid exact replay accepted without conflating original and latest revisions; inconsistent payload fails closed; unacknowledged effects suppressed; no guessed release                                    | FR-059, INV-005–INV-008                 |
| CC-030 | Identity, metadata and input boundaries | PR identity/cursor changes after acquire; opaque identifiers such as `9`, `10`, `02`; watcher idempotency conflict; candidate/poll/duration/lease thresholds; takeover | Abandon stale observations; never sort observation IDs; terminal conflict; complete intake owner/fence/expiry/source metadata; unchanged ledger revision/fence semantics and validated bounds             | FR-004, FR-012, FR-036a, FR-038, FR-044 |

## Required Tests

Every test below is deterministic and uses injected observations, an injected clock, an injected delay source, and an isolated ledger fixture. No test may perform network, MCP, CLI, git, sandbox, or agent-provider work.

- **TEST-001 — Validation:** Rejects blank owner, empty/duplicate candidates, invalid identifiers, non-positive budgets, invalid lease duration, invalid backoff parameters, malformed intake rules. Covers CC-015.
- **TEST-002 — Seam contract:** Missing required observation methods produce stable configuration errors before any mutation. Covers CC-016.
- **TEST-003 — Read-only seam usage:** Recording fake asserts only observation methods are invoked and at most once per candidate per poll per kind. Covers CC-003, FR-014.
- **TEST-004 — Happy-path intake:** Cursor advance, revision increment, single intake signal, durable-before-report ordering. Covers CC-001.
- **TEST-005 — Replay stability:** Repeated passes over unchanged state produce `no-change` with zero mutations. Covers CC-002.
- **TEST-006 — Determinism:** Shuffled candidate input yields identical decisions, ordering, and reason codes. Covers CC-010.
- **TEST-007 — Single clock reading:** Clock fake asserts one reading per poll drives eligibility, lease, and timestamps. Covers FR-017.
- **TEST-008 — Claim conflict:** Overlapping owners produce exactly one actor and one `claim-conflict` skip. Covers CC-004.
- **TEST-009 — Claim authority:** Post-takeover checkpoint by a former owner is rejected and mutates nothing; an expired lease and an unusable claim capability are each surfaced as their own distinct outcome rather than collapsed into `claim-conflict`; and an observation invalidated between its read and its claim is abandoned rather than written. Covers CC-005, CC-022, FR-030, FR-036a.
- **TEST-010 — Lease renewal:** Multi-poll pass renews before inclusive expiry without changing fencing. Covers CC-014.
- **TEST-011 — Claim release:** Release attempted once for validated authority on success/failure/cancellation/clock or delay failure; assert released only with validated acknowledgement. Cleanup failure matrix is TEST-030. Covers CC-012, FR-029.
- **TEST-012 — Idempotency:** Checkpoint identifiers replay the original outcome and reject reuse with different data; claim-lifecycle identifiers are unique per acquisition, so the same `passId` retries cleanly after a durable acquire whose checkpoint never landed. Covers FR-037, FR-037a, FR-038, CC-021.
- **TEST-013 — Optimistic conflicts:** `revision-conflict` and `state-conflict` end the candidate step without mutation. Covers CC-006.
- **TEST-014 — Intake rules:** Suppressed intake still advances cursors; unknown-but-admitted phases are accepted. Covers CC-007, CC-008.
- **TEST-015 — Missing record:** `record-not-found` skip without initialization. Covers CC-009.
- **TEST-016 — Bounded polling and backoff:** Poll count, poll-start elapsed budget, and deterministic delay schedule are enforced. Covers CC-011.
- **TEST-017 — Cancellation:** Abort before seam call, before non-cleanup mutation and between polls stops scheduling under cooperating dependencies, preserves acknowledgements and attempts cleanup once. Covers CC-012.
- **TEST-018 — Observation timeout:** Non-settling observation converts to a per-candidate timeout outcome. Covers CC-013.
- **TEST-019 — Candidate isolation:** Seam rejection, ledger failure, a faulting injected ledger method, and a lost observation anchor each leave the other candidates unaffected. Covers CC-017, CC-023, CC-024, INV-014, INV-016.
- **TEST-020 — Recovery isolation:** Corrupt and unsupported-schema records report stable ledger categories without repair. Covers CC-017.
- **TEST-021 — Data minimization:** Snapshot assertions over durable artifacts, results, errors, and diagnostics find no bodies, authors, credentials, or claim tokens. Covers CC-018.
- **TEST-022 — PR cursor completeness:** Incomplete thread/comment pairs are not persisted, and `cursorChanges` and `skippedCursorKinds` never name the same kind. Covers CC-019, FR-034.
- **TEST-023 — Restart safety:** Reopening preserves acknowledged outcomes and may also show durable-but-unacknowledged checkpoints. No partial aggregate is exposed; replay does not duplicate, and lost signals require host reconciliation. Covers FR-057, INV-007, INV-008.
- **TEST-024 — Offline guarantee:** Full pass executes with no network-capable dependency in the module graph under test. Covers CC-020.
- **TEST-025 — Public surface:** Exported operations and types are reachable from the package entry point with token-free result projections. Covers FR-008, FR-026.
- **TEST-026 — Runtime ledger contract (implemented W030; W038 re-review pending):** Full method-specific success and known-error validation, all malformed shapes and request mismatches, independent request snapshots, same-revision replay consistency, old accepted revision with valid latest record, durable-mutation/malformed-ack loss and privacy. Covers CC-024, CC-029.
- **TEST-027 — Fresh abort/preflight (implemented W031; W038 re-review pending):** Zero injected effects for invalid signals and unreadable adapter methods; WI seam aborts parent before valid settlement and PR is never invoked. Covers CC-025.
- **TEST-028 — Unique bounded windows (implemented W032; W038 re-review pending):** Exact inclusive count/UTF-8 boundaries, per-ID bound, duplicate anchors/nonanchors, canonical PR null normalization, mixed complete/incomplete entries, opaque ordering, cross-kind invalidation, malformed/unreadable windows, no oversized copy. Covers CC-019, CC-023, CC-026.
- **TEST-029 — Observation lifecycle (implemented W033; W038 re-review pending):** Every terminal path cancels/cleans controllers, timers and listeners; quarantine late settlements; maximum cooperative concurrency evidence and noncooperating limitation. Covers CC-027.
- **TEST-030 — Cleanup matrix (implemented W034; W038 re-review pending):** Every status/reason mapping, release exactly once or zero, replay after takeover, retention until validation, failure promotion, acknowledged signal/cursor retention including last-candidate abort and cleanup-time abort, and all counts. Covers CC-012, CC-028.
- **TEST-031 — Revision/traceability (implemented W035; W038 re-review pending):** Correct CC-001/002 revision sequence, pre-acquire source metadata, takeover revisions/fencing, PR identity/cursor staleness, terminal watcher idempotency conflict. Covers CC-001, CC-002, CC-030.
- **TEST-032 — Input boundary matrix (implemented W036; W038 re-review pending):** Candidate 1/1,000/1,001 and canonical duplicates; maxPolls 1/10,000/10,001, unsafe integers; valid/invalid duration, threshold, 24-hour lease bounds; zero injected effects on invalid input. Covers CC-015, CC-030.

## Success Criteria

- **SC-001:** Across 1,000 repeated passes with identical inputs and durable state, 100% produce byte-identical decision sets, reason codes, and counts.
- **SC-002:** Across at least 1,000 overlapping two-owner trials on one work item, exactly one owner acts in every trial.
- **SC-003:** In stale-owner testing, 0% of superseded-fencing mutations advance a cursor or change a revision.
- **SC-004:** For any observed external event, **at most one** intake signal is delivered across all passes; duplicate delivery rate is 0%. Delivery is not lossless: a checkpoint that becomes durable without being acknowledged advances the cursor while its signal is never returned, so completeness must be reconciled from the durable record, not from the signal stream.
- **SC-005:** All tested passes enforce scheduling/window bounds and cooperative cancellation under settling ledger/delay dependencies. No unconditional runtime/physical-request guarantee is inferred from these tests.
- **SC-006:** Every candidate reports cleanup; exactly one release is attempted for validated authority and none for unvalidated authority. Cleanup counts partition outcomes; no foreign force-release.
- **SC-007:** Automated scanning of durable artifacts, results, errors, and diagnostics finds zero external bodies, credentials, or claim tokens.
- **SC-008:** In candidate-isolation testing, a single failing candidate never changes another candidate's durable revision, in 100% of trials.
- **SC-009:** An operator can determine from one pass result why every candidate was acted on, skipped, suppressed, or failed, without reading agent-session contents or external bodies.
- **SC-010:** The full watcher test suite completes without live ADO, GitHub, MCP, network, Azure CLI, Azure DevOps CLI, sandbox, agent-provider, or git dependencies, and without wall-clock waiting.

## Assumptions

- **Candidate supply:** The DevSquad host decides which work items are candidates; the watcher does not discover or query for work-item sets. **Owner:** DevSquad host integration.
- **Record initialization:** Records are initialized by the host before a candidate can be acted on. **Owner:** DevSquad host integration.
- **Observation ordering:** The injected seam returns observations in the tracker's authoritative order, and the watcher trusts that order rather than parsing identifiers. **Owner:** Host seam implementer.
- **Anchor retention:** The seam window is anchor-inclusive: whenever a `since` anchor is supplied and the window is non-empty, the anchor appears in it. The tracker therefore keeps an anchored comment or thread entry retrievable for as long as it is a persisted cursor. Anchors are compared by equality only, so a non-empty window that omits the anchor is undecidable; the watcher fails that candidate closed with `observation-anchor-missing` rather than re-delivering the window, and re-anchoring the record is a deliberate host action. **Owner:** Host seam implementer.
- **Pass identity:** The host supplies a stable pass identity; the watcher never generates one. Checkpoint identifiers are reproduced by a retry, while claim-lifecycle identifiers are freshly scoped per acquisition, so the same `passId` is always safe to retry. **Owner:** DevSquad host integration.
- **Time basis:** Timestamps are UTC and supplied by the injected clock; tests control time deterministically. **Owner:** Sandcastle planning.
- **Workload scale:** A single pass examines no more than 1,000 candidates, within ledger schema-v1 capacity bounds. **Owner:** Product maintainer.
- **Delivery semantics:** Intake signals are consumed in-process by the caller of the pass; the watcher provides no queue, retry, or transport. **Owner:** DevSquad host integration.
- **Liveness:** Ledger methods and delays settle; observation timers behave as valid delays. Abort requests cooperation, not forcible termination, and late noncooperating operations may remain physically in flight. **Owner:** Host dependency implementer.
- **Reconciliation:** At-most-once batched intake can lose signals after durable-unacknowledged writes or host crashes; reconcile durable cursors against intake processing without adding an outbox to this slice. **Owner:** DevSquad host integration.
- **Single-machine coordination:** Concurrent watchers share the same repository filesystem, per ADR-0025. **Owner:** Deployment owner.

## Dependencies and ADR Alignment

- **ADR-0025 — DevSquad/ADO workflow ledger:** The watcher is a pure consumer of the ledger's public typed operations, claim/lease/fencing/idempotency rules, and fail-closed recovery behavior. It introduces no new persistence format and no schema change.
- **ADR-0024 — DevSquad Sandcastle execution adapter boundary:** DevSquad retains work-item lifecycle, phase legality, scheduling, and pull-request authority; the watcher only proposes intake.
- **ADR-0021 — ADO feedback-loop control-plane boundary:** All external observation stays behind an injected, structurally validated seam with no credentials, transport, or network coupling in Sandcastle core.
- **ADR-0022 — ADO agent-team runner boundary:** The watcher does not schedule or execute agents; it may inform a host runner.
- **ADR-0012 — Agent-provider-owned session storage:** Only session identifiers already present in the ledger are surfaced; the watcher never reads session contents.
- **ADR-0007 — Worktree locking:** Precedent for host-side ownership; watcher exclusivity is provided by ledger claims, not worktree locks.

## Technical Decisions Identified

| Decision                                          | Status                                                      | Impact                                                                                                                         |
| ------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Watcher observation seam shape and access level   | Decided in Proposed ADR-0026                                | Watcher-specific read seam, anchor-inclusive unique bounded windows; W031–W033 verify recovery.                                |
| Deterministic operation-identifier derivation     | Decided in Proposed ADR-0026                                | `dsw2` generation-scoped checkpoints and independently random per-acquisition claim epochs.                                    |
| Backoff, budget, and cancellation contract        | Amended in Proposed ADR-0026                                | Deterministic injected backoff; scheduling/window bounds and cooperative cancellation under settling dependencies.             |
| Intake delivery and cleanup                       | Amended in Proposed ADR-0026                                | At-most-once batched return, possible loss/host reconciliation; mandatory cleanup evidence never retracts acknowledged signal. |
| Claim lease sizing and renewal threshold defaults | Decided in Proposed ADR-0026, bounded by unchanged ADR-0025 | Default 60s, threshold one-third, positive threshold below lease, 24-hour ceiling and inclusive expiry.                        |
| Phase legality                                    | Defined outside Sandcastle by ADR-0024                      | No Sandcastle phase table may be introduced; intake rules stay caller-supplied.                                                |
| Ledger persistence protocol                       | Defined by ADR-0025                                         | The watcher must not add artifacts, formats, or recovery behavior of its own.                                                  |
