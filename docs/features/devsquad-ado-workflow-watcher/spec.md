# DevSquad/ADO Workflow Watcher Specification

## Executive Summary

- **Objective:** Give a DevSquad host a deterministic, bounded watcher that observes injected ADO/GitHub work-item and pull-request signals, decides eligibility, and records durable coordination checkpoints in the workflow ledger without taking ownership of the DevSquad lifecycle.
- **Primary user:** A DevSquad host coordinator that must repeatedly discover which claimed work items have new external activity and hand them to DevSquad intake.
- **Value delivered:** One restart-safe, offline-testable watch pass that never double-processes an external event, never lets two coordinator loops act on the same work item, and always terminates within a caller-declared budget.
- **Scope:** Includes an injected read-oriented control-plane seam, deterministic eligibility evaluation, ledger claim/lease/fencing/idempotency use, cursor and comment-observation persistence, bounded polling with deterministic backoff and cancellation, and typed operations; excludes live network access, phase legality, agent execution, and pull-request authority.
- **Primary success criterion:** For any fixed set of injected observations, clock, and ledger state, repeated watch passes produce identical decisions, at most one active owner per work item, and exactly one intake handoff per external event.

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

### Scenario 5: Bounded, cancellable polling always terminates

**Given** a watch pass configured with a maximum poll count, a deterministic backoff schedule, and a cancellation signal,
**When** no candidate becomes eligible, or the signal is aborted mid-pass,
**Then** the pass terminates within the declared budget with a structured stop reason, having released every claim it acquired.

### Scenario 6: Phase rules gate intake, not lifecycle meaning

**Given** a record whose phase is `awaiting-approval` and caller intake rules that only admit `implement` and `review`,
**When** new external activity is observed,
**Then** the cursor is still advanced durably, the candidate is reported as intake-suppressed with a stable reason, and no intake signal is emitted; Sandcastle applies no phase ordering of its own.

## Functional Requirements

### Watch Pass and Typed Operations

- **FR-001:** The feature shall expose a typed operation that runs exactly one bounded watch pass and resolves with a structured result or a structured error, without throwing untyped errors for expected conditions.
- **FR-002:** A watch pass shall accept an opened workflow ledger, an injected observation seam, an owner identifier, a candidate set, intake rules, budget configuration, an injected UTC clock, an injected delay source, and an optional cancellation signal.
- **FR-003:** All watch inputs shall be validated before any observation, claim, or ledger mutation is attempted.
- **FR-004:** Validation shall reject a blank owner identifier, an empty or duplicate candidate set, invalid work-item identifiers, non-positive or non-finite budgets, invalid lease durations, invalid backoff parameters, and malformed intake rules.
- **FR-005:** The watch result shall report, per candidate, a stable outcome discriminator, a stable reason code, and the resulting durable revision when a mutation was accepted.
- **FR-006:** The watch result shall report pass-level counts (candidates examined, eligible, acted, skipped, suppressed, failed), the number of polls performed, and a stable stop reason.
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
- **FR-029:** The watcher shall release every claim it acquired before the pass reports completion, including on cancellation and on candidate failure.
- **FR-030:** A `claim-conflict`, `claim-expired`, `stale-fencing`, or `claim-authorization` result shall be surfaced as a distinct stable outcome and shall never be retried by silently re-acquiring within the same candidate step.
- **FR-031:** The watcher shall not delete, reset, or force-release a claim owned by another owner.

### Cursor and Observation Persistence

- **FR-032:** Newly observed work-item comment cursors and pull-request thread/comment cursors shall be persisted through ledger checkpoints that supply the expected revision, expected phase, and expected status.
- **FR-033:** The watcher shall persist only opaque identifiers and shall never persist comment bodies, review bodies, authors, prompts, credentials, or tokens.
- **FR-034:** A pull-request cursor shall be persisted only when both thread and comment identifiers are available.
- **FR-035:** The watcher shall select the next cursor from the injected observation ordering supplied by the seam and shall not infer ordering from identifier text.
- **FR-036:** Cursor advancement shall be acknowledged as durable before the corresponding intake signal is reported as delivered by the pass result.
- **FR-037:** Every watcher mutation shall supply a deterministic operation identifier derived from stable pass, candidate, and step identity so that retrying an ambiguous mutation replays the original outcome.
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

- **FR-047:** A watch pass shall stop at the first of: all candidates resolved, maximum polls reached, maximum pass duration reached, or cancellation.
- **FR-048:** Maximum polls and maximum pass duration shall be caller-supplied, positive, finite, and enforced before each additional poll.
- **FR-049:** Delays between polls shall be produced by an injected delay source so tests are deterministic and require no wall-clock waiting.
- **FR-050:** Backoff shall follow a deterministic schedule derived from a base interval, multiplier, and maximum interval, with no randomness unless an explicit jitter source is injected.
- **FR-051:** Cancellation shall be observed before each seam call, before each ledger mutation, and between polls, and shall stop the pass promptly with a `cancelled` stop reason.
- **FR-052:** Cancellation shall still release acquired claims and shall report the durable outcomes already accepted before the abort.
- **FR-053:** The watcher shall never wait indefinitely on the seam; a caller-supplied per-observation timeout shall convert to a stable per-candidate timeout outcome.

### Recovery and Fail-Closed Behavior

- **FR-054:** Ledger recovery errors (`corrupt-artifact`, `unsupported-schema-version`, `path-boundary`, `unsupported-permissions`, `capacity-exceeded`, `scan-limit`) shall be surfaced with their stable ledger category and shall not be repaired, reset, or bypassed by the watcher.
- **FR-055:** A record blocked by a recovery error shall be reported as a failed candidate and shall not prevent other candidates from being processed.
- **FR-056:** The watcher shall not create, delete, or rewrite ledger artifacts other than through the ledger's public typed operations.
- **FR-057:** A pass that fails at pass level shall leave every previously acknowledged durable outcome intact and observable after restart.
- **FR-058:** Watcher errors and diagnostics shall use stable categories and shall never contain claim tokens, raw JSON, external bodies, or unredacted operating-system messages containing caller data.

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
| Budgets          | Maximum polls, maximum pass duration, per-observation timeout         |
| Lease config     | Claim lease duration and renewal threshold                            |
| Backoff config   | Base interval, multiplier, maximum interval, optional injected jitter |
| Clock and delay  | Injected UTC clock and injected delay source                          |
| Cancellation     | Optional cooperative abort signal                                     |

### Candidate Outcome

The stable per-work-item result of one watch pass.

| Attribute      | Description                                                          |
| -------------- | -------------------------------------------------------------------- |
| Work item ID   | Canonical identifier as recorded by the ledger                       |
| Outcome kind   | `acted`, `no-change`, `intake-suppressed`, `skipped`, or `failed`    |
| Reason code    | Stable machine-readable reason for the outcome                       |
| Revision       | Durable revision observed or accepted, when applicable               |
| Cursor changes | Which observation cursors advanced, without bodies                   |
| Claim metadata | Token-free owner, fencing value, and expiry under which the step ran |

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
- **INV-006 — Exactly-once intake:** Each externally observed event yields at most one intake signal across all passes, because cursor advancement is durable before delivery is reported.
- **INV-007 — Durable-before-report:** No candidate is reported as `acted` unless its checkpoint was acknowledged as durable.
- **INV-008 — Idempotent steps:** Replaying a watcher step's operation identifier cannot create a duplicate revision, checkpoint, or cursor advance.
- **INV-009 — Lifecycle separation:** The watcher records and reports phase and status but never determines their legality, ordering, or next value.
- **INV-010 — Data minimization:** No external body, credential, token, prompt, or session content enters durable state, results, logs, or errors.
- **INV-011 — Bounded termination:** Every watch pass terminates within the caller-declared poll and duration budget, or on cancellation.
- **INV-012 — Claim hygiene:** Every claim acquired by a pass is released or expires naturally; the watcher never force-releases another owner's claim.
- **INV-013 — Fail-closed recovery:** Corrupt, unsupported, or capacity-blocked records are reported and isolated, never repaired or reset by the watcher.
- **INV-014 — Candidate isolation:** One candidate's failure never corrupts, blocks, or alters another candidate's durable state.

## Conformance Criteria

| ID     | Scenario                             | Input                                                                                                           | Expected Output                                                                                                                               | Traces                          |
| ------ | ------------------------------------ | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| CC-001 | Happy-path intake                    | Record `137` at revision `4`, cursor `480`, injected comments `[480, 481]`, intake rules admit its phase/status | One intake signal for `137` citing revision `4` and `work-item-comment`; cursor advances to `481` at revision `5` before delivery is reported | FR-022, FR-032, FR-036, INV-007 |
| CC-002 | Idempotent replay across passes      | Rerun CC-001 inputs with unchanged durable state                                                                | Outcome `no-change`, no intake signal, no checkpoint, revision remains `5`                                                                    | FR-024, FR-046, INV-006         |
| CC-003 | Negative: no external writes         | Seam fake records every invocation during a full pass                                                           | Only observation methods are invoked; zero update, comment, or pull-request mutation calls                                                    | FR-010, INV-002                 |
| CC-004 | Concurrent watchers                  | Owners `watch-a` and `watch-b` run overlapping passes over `137` with a 60s lease                               | One acts; the other reports `skipped` with reason `claim-conflict` and continues its remaining candidates                                     | FR-021, FR-007, INV-004         |
| CC-005 | Negative: stale owner must not write | `watch-a` lease expires, `watch-b` takes over, then `watch-a` checkpoints a cursor                              | Mutation rejected as `stale-fencing`; cursor, revision, and `watch-b` claim unchanged                                                         | FR-027, FR-030, INV-005         |
| CC-006 | Revision conflict                    | Record advanced to revision `9` by another writer while the watcher expected `8`                                | Candidate ends with stable `revision-conflict` outcome; durable state unchanged; pass continues                                               | FR-039, INV-014                 |
| CC-007 | Intake suppressed by phase rules     | Record phase `awaiting-approval`; intake rules admit only `implement` and `review`; new comment `482` observed  | Cursor advances durably; outcome `intake-suppressed`; no intake signal; no Sandcastle-defined phase ordering applied                          | FR-041, FR-042, INV-009         |
| CC-008 | Unknown phase is not rejected        | Record phase `custom-security-gate` included in caller intake rules                                             | Intake signal emitted; no allowlist error                                                                                                     | FR-043, INV-009                 |
| CC-009 | Missing record                       | Candidate `999` has no initialized ledger record                                                                | Outcome `skipped` with reason `record-not-found`; watcher does not initialize the record                                                      | FR-020                          |
| CC-010 | Deterministic ordering               | Same candidate set supplied in three different input orders                                                     | Identical decision sequence, identical reason codes, identical seam call order                                                                | FR-018, INV-003                 |
| CC-011 | Bounded polling                      | No candidate ever becomes eligible; `maxPolls = 3`                                                              | Exactly 3 polls; stop reason `poll-budget-exhausted`; two deterministic backoff delays requested from the injected delay source               | FR-047, FR-048, FR-050, INV-011 |
| CC-012 | Cancellation mid-pass                | Abort signal fires after the first candidate's checkpoint is acknowledged                                       | Stop reason `cancelled`; the acknowledged outcome is reported; every acquired claim is released                                               | FR-051, FR-052, INV-012         |
| CC-013 | Observation timeout                  | Seam observation never settles; per-observation timeout `5000ms` on the injected clock/delay                    | Candidate outcome `failed` with reason `observation-timeout`; pass continues with remaining candidates                                        | FR-053, FR-007                  |
| CC-014 | Lease renewal                        | Pass spans multiple polls while holding a claim near expiry                                                     | Claim renewed before inclusive expiry; fencing value unchanged; no takeover occurs                                                            | FR-028, INV-004                 |
| CC-015 | Invalid configuration                | Blank owner ID, duplicate candidates, `maxPolls = 0`, malformed intake rules                                    | Structured validation errors naming stable field paths; no seam call and no ledger mutation occur                                             | FR-003, FR-004                  |
| CC-016 | Seam contract violation              | Injected client missing the work-item observation method                                                        | Stable configuration error naming the missing method; pass performs no mutation                                                               | FR-011                          |
| CC-017 | Corrupt record isolation             | One of three candidates has a corrupt durable artifact                                                          | That candidate reports `failed` with ledger category `corrupt-artifact`; the other two complete normally; artifact is not rewritten           | FR-054, FR-055, INV-013         |
| CC-018 | Negative: no secrets or bodies leak  | Seam returns comments with bodies, authors, and a credential-bearing URL                                        | Durable state, results, errors, and diagnostics contain only opaque identifiers; no body, author, credential, or claim token appears          | FR-033, FR-045, FR-058, INV-010 |
| CC-019 | PR cursor completeness               | Observation supplies a thread identifier with no comment identifier                                             | No pull-request cursor is persisted; candidate reports a stable incomplete-cursor reason                                                      | FR-034                          |
| CC-020 | Offline determinism                  | Full pass executed with network access unavailable                                                              | Pass completes using injected observations and repository-local ledger state only                                                             | FR-009, INV-001                 |

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
- **TEST-009 — Claim authority:** Post-takeover checkpoint by a former owner is rejected and mutates nothing; an expired lease and an unusable claim capability are each surfaced as their own distinct outcome rather than collapsed into `claim-conflict`. Covers CC-005, FR-030.
- **TEST-010 — Lease renewal:** Multi-poll pass renews before inclusive expiry without changing fencing. Covers CC-014.
- **TEST-011 — Claim release:** Claims released on success, on candidate failure, on cancellation, and when an injected clock or delay fails. Covers CC-012, FR-029.
- **TEST-012 — Idempotency:** Deterministic operation identifiers replay the original outcome; reuse with different data yields `idempotency-conflict`. Covers FR-037, FR-038.
- **TEST-013 — Optimistic conflicts:** `revision-conflict` and `state-conflict` end the candidate step without mutation. Covers CC-006.
- **TEST-014 — Intake rules:** Suppressed intake still advances cursors; unknown-but-admitted phases are accepted. Covers CC-007, CC-008.
- **TEST-015 — Missing record:** `record-not-found` skip without initialization. Covers CC-009.
- **TEST-016 — Bounded polling and backoff:** Poll count, duration budget, and deterministic delay schedule are enforced. Covers CC-011.
- **TEST-017 — Cancellation:** Abort before seam call, before mutation, and between polls each stop promptly with released claims. Covers CC-012.
- **TEST-018 — Observation timeout:** Non-settling observation converts to a per-candidate timeout outcome. Covers CC-013.
- **TEST-019 — Candidate isolation:** Seam rejection and ledger failure for one candidate leave others unaffected. Covers CC-017, INV-014.
- **TEST-020 — Recovery isolation:** Corrupt and unsupported-schema records report stable ledger categories without repair. Covers CC-017.
- **TEST-021 — Data minimization:** Snapshot assertions over durable artifacts, results, errors, and diagnostics find no bodies, authors, credentials, or claim tokens. Covers CC-018.
- **TEST-022 — PR cursor completeness:** Incomplete thread/comment pairs are not persisted. Covers CC-019.
- **TEST-023 — Restart safety:** Reopening the ledger after an interrupted pass shows only acknowledged outcomes, never partial ones. Covers FR-057, INV-007.
- **TEST-024 — Offline guarantee:** Full pass executes with no network-capable dependency in the module graph under test. Covers CC-020.
- **TEST-025 — Public surface:** Exported operations and types are reachable from the package entry point with token-free result projections. Covers FR-008, FR-026.

## Success Criteria

- **SC-001:** Across 1,000 repeated passes with identical inputs and durable state, 100% produce byte-identical decision sets, reason codes, and counts.
- **SC-002:** Across at least 1,000 overlapping two-owner trials on one work item, exactly one owner acts in every trial.
- **SC-003:** In stale-owner testing, 0% of superseded-fencing mutations advance a cursor or change a revision.
- **SC-004:** For any observed external event, exactly one intake signal is delivered across all passes; duplicate delivery rate is 0%.
- **SC-005:** 100% of watch passes terminate within the declared poll and duration budget, or report `cancelled`.
- **SC-006:** 100% of acquired claims are released or expire; zero claims are force-released from another owner.
- **SC-007:** Automated scanning of durable artifacts, results, errors, and diagnostics finds zero external bodies, credentials, or claim tokens.
- **SC-008:** In candidate-isolation testing, a single failing candidate never changes another candidate's durable revision, in 100% of trials.
- **SC-009:** An operator can determine from one pass result why every candidate was acted on, skipped, suppressed, or failed, without reading agent-session contents or external bodies.
- **SC-010:** The full watcher test suite completes without live ADO, GitHub, MCP, network, Azure CLI, Azure DevOps CLI, sandbox, agent-provider, or git dependencies, and without wall-clock waiting.

## Assumptions

- **Candidate supply:** The DevSquad host decides which work items are candidates; the watcher does not discover or query for work-item sets. **Owner:** DevSquad host integration.
- **Record initialization:** Records are initialized by the host before a candidate can be acted on. **Owner:** DevSquad host integration.
- **Observation ordering:** The injected seam returns observations in the tracker's authoritative order, and the watcher trusts that order rather than parsing identifiers. **Owner:** Host seam implementer.
- **Anchor retention:** The tracker keeps an anchored comment or thread entry retrievable for as long as it is a persisted cursor. Anchors are compared by equality only, so a response that can no longer contain the anchor is indistinguishable from a post-cursor window and is re-emitted in full; deleting an anchored entry therefore breaks SC-004 at the seam, not in the watcher. **Owner:** Host seam implementer.
- **Pass identity:** The host supplies or the watcher derives a stable pass identity so that retrying an ambiguous pass reuses the same operation identifiers. **Owner:** Sandcastle planning.
- **Time basis:** Timestamps are UTC and supplied by the injected clock; tests control time deterministically. **Owner:** Sandcastle planning.
- **Workload scale:** A single pass examines no more than 1,000 candidates, within ledger schema-v1 capacity bounds. **Owner:** Product maintainer.
- **Delivery semantics:** Intake signals are consumed in-process by the caller of the pass; the watcher provides no queue, retry, or transport. **Owner:** DevSquad host integration.
- **Single-machine coordination:** Concurrent watchers share the same repository filesystem, per ADR-0025. **Owner:** Deployment owner.

## Dependencies and ADR Alignment

- **ADR-0025 — DevSquad/ADO workflow ledger:** The watcher is a pure consumer of the ledger's public typed operations, claim/lease/fencing/idempotency rules, and fail-closed recovery behavior. It introduces no new persistence format and no schema change.
- **ADR-0024 — DevSquad Sandcastle execution adapter boundary:** DevSquad retains work-item lifecycle, phase legality, scheduling, and pull-request authority; the watcher only proposes intake.
- **ADR-0021 — ADO feedback-loop control-plane boundary:** All external observation stays behind an injected, structurally validated seam with no credentials, transport, or network coupling in Sandcastle core.
- **ADR-0022 — ADO agent-team runner boundary:** The watcher does not schedule or execute agents; it may inform a host runner.
- **ADR-0012 — Agent-provider-owned session storage:** Only session identifiers already present in the ledger are surfaced; the watcher never reads session contents.
- **ADR-0007 — Worktree locking:** Precedent for host-side ownership; watcher exclusivity is provided by ledger claims, not worktree locks.

## Technical Decisions Identified

| Decision                                                     | Status                                           | Impact                                                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Watcher observation seam shape and access level              | Precedent in ADR-0021 / `AdoControlPlaneFactory` | Planning must decide whether to reuse `AdoReadOnlyControlPlane` or define a watcher-specific read seam. |
| Deterministic operation-identifier derivation                | Not defined                                      | Required for FR-037; likely an ADR because idempotent replay across restarts is externally observable.  |
| Backoff, budget, and cancellation contract                   | Not defined                                      | Requires planning to fix a deterministic, injectable schedule and stop-reason taxonomy.                 |
| Intake signal delivery model (in-process return vs callback) | Not defined                                      | Affects public API shape and exactly-once reasoning; must be settled before implementation.             |
| Claim lease sizing and renewal threshold defaults            | Bounded by ADR-0025 (24-hour maximum)            | Planning must define safe defaults without weakening fencing guarantees.                                |
| Phase legality                                               | Defined outside Sandcastle by ADR-0024           | No Sandcastle phase table may be introduced; intake rules stay caller-supplied.                         |
| Ledger persistence protocol                                  | Defined by ADR-0025                              | The watcher must not add artifacts, formats, or recovery behavior of its own.                           |
