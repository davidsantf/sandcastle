# ADR-0026: DevSquad/ADO workflow watching is a bounded offline observation pass

## Status

Proposed

> **Approved discovery amendment (2026-09-10):** D1-B, D2/D2-A and D3-A are approved requirements for existing slice 14 / #21. This ADR now describes their target contract. The extension is unimplemented and not independently reviewed. The historical W038 technical PASS below covers only supplied-candidate behavior and checkpoint recovery; it is not discovery verification, ADR acceptance, merge readiness or permission to begin slice 15. ADR-0025 and its storage contract remain unchanged.

Recovery contract amended through DevSquad on 2026-09-10 for #21. **W038 is completed TECHNICAL only:** final fresh independent `devsquad.review` turn 4 PASSED with no blockers (0 Critical, 0 Major, 1 nonblocking Minor TB001). W029-W037 are complete; all five guardians completed and the separate security specialist found no vulnerabilities. RC14-008 is independently closed and all earlier findings are closed/preserved in the feature review log. TB001's older-test internal guard/object-identity coupling is acknowledged, with no required fix. The first failed review (2 Critical, 3 Major, 2 documentation findings), second/third failures and superseded PASS verdicts remain historical evidence. Fresh review execution is distinct from inherited ESM/DTS build evidence and the unchanged Windows postbuild failure; there is no fresh packaging-success claim. Technical conformance does not grant governance acceptance or merge readiness. ADR-0025 and ADR-0026 remain Proposed pending an authorized owner's separate acceptance; ADR-0025 is unchanged and no board item is linked. Parent publication is separate, #20 must merge before #21, and slice 15 remains blocked until the creator's explicit decision.

## Priorities

1. Preserve DevSquad ownership of lifecycle meaning, phase legality, scheduling, and external tracker authority.
2. Report comment activity and explicitly authorized first admission through distinct at-most-once intake signals, accepting possible loss after ambiguous acknowledgement or restart.
3. Prevent duplicate ledger-mediated intake and unauthorized or stale mutation of existing records; ledger coordination grants no downstream execution exclusivity.
4. Bound scheduling and retained observations, with honest cooperative cancellation and explicit dependency-liveness assumptions.
5. Keep Sandcastle core offline, tracker-neutral, and free of transport or credential coupling.
6. Keep every decision deterministic and reproducible from injected inputs alone.

## Context

ADR-0025 delivered the repository-local workflow ledger: durable records, fenced claims, leases, idempotency receipts, opaque observation cursors, and fail-closed recovery. The ledger deliberately observes nothing. It stores a work-item comment cursor and a pull-request thread/comment cursor but decides neither when a record should be revisited nor which external events are new.

ADR-0021 established the injected control-plane pattern for ADO: `AdoControlPlaneFactory` structurally validates an injected client and distinguishes `read-only` from `write` access. ADR-0024 fixed DevSquad as the owner of work-item lifecycle, phase transitions, scheduling, and pull-request authority; Sandcastle owns isolated execution only.

Between those two boundaries a host coordinator still has to hand-roll polling, deduplication, claim handling, and termination around the ledger. That is precisely where double-processing, unbounded loops, and stale-owner writes appear.

Three properties make this architecture-significant rather than a local implementation detail.

First, **non-duplicating intake is externally observable**: a duplicated intake signal makes DevSquad run work twice, and the only defence is that cursor advancement is durable before delivery is reported. The dual is not free — a cursor that advances durably while its signal is lost is a dropped delivery — so the guarantee is at-most-once, not exactly-once.

Second, **idempotent replay across restarts requires operation identifiers to be a documented function of caller-visible identity, scoped to what each step actually needs**. A host that retries an ambiguous checkpoint must reproduce the same identifier or the ledger cannot replay the original outcome. A host that retries a _claim_, however, must not reproduce the previous identifier: ADR-0025 folds the random capability token into the request digest, so a reused claim identifier with a fresh token is a permanent `idempotency-conflict` rather than a replay. One rule for both families would break one of them.

Third, **watching is where "read-only" is easiest to lose**. A seam that can update a work item, post a comment, or complete a pull request would silently move tracker authority into Sandcastle.

## Approved discovery decision

The following amendment extends the supplied-candidate baseline without changing its behavior. Concrete TypeScript contracts, limits, result unions and task/test traceability are defined in the feature implementation plan.

### Host boundary and modes

One bounded, explicitly host-invoked operation supports supplied-candidate and discovery modes.

Supplied mode observes only the supplied candidates. Missing records remain `skipped / record-not-found`; it never initializes and does not require discovery dependencies.

Discovery uses a host-injected, read-only page seam with stable scope/partition identity, invocation-stability evidence, policy version and finite bounds. The host supplies normalized facts and resolved teams. The watcher evaluates matching itself.

The host alone authorizes admission for each canonical item and supplies exact initial phase/status. Matching, external state, team membership and local claims are not admission or execution authority.

Neither mode constructs live queries/clients, manages credentials, writes trackers, schedules agents, defines lifecycle semantics or dispatches intake.

### Exact matching — D2

The library implements the complete configured policy:

- AND configured dimensions.
- OR allowed-state and allowed-team set members.
- Require all, any or none of configured tags, combining configured tag predicates with AND.
- Require nonempty configured state/team/tag sets.
- Compare normalized opaque values exactly and case-sensitively, without trimming, folding, inferred synonyms or substring matching.
- Match area/iteration as exact segment paths or explicit segment-aware subtrees, including the root but excluding textual-prefix siblings.
- Use host-resolved team membership, never `assignedTo` inference.
- Treat omitted dimensions as unrestricted.
- Distinguish known empty collections from missing required facts.
- Reject unsupported operators before effects.

Use bounded explicit filter discriminators and fixed-field projection. No precomputed eligibility boolean substitutes for implementation of these semantics.

Validate required sensitive facts and evaluate matching before privacy projection and item effects. Malformed or oversized required fact/page structures invalidate the whole page. Valid missing facts pause only their candidate.

Return only the exact public policy-version label and fixed predicate/reason categories. Never expose or persist raw policy operands, facts, tokens, capabilities, transport messages or guessable hashes of sensitive values.

### Eligibility pause — D2-A

Matching exclusion or missing required facts pauses observation: no comment/PR calls and no record/cursor mutation. Persist no pause marker.

Reentry resumes from existing durable anchors, not a new baseline or inferred latest event. Discovery observation explicitly distinguishes retention loss from ordinary empty no-new-event windows. Known loss produces `observation-anchor-missing`, including otherwise empty responses; advance nothing and require deliberate host reconciliation.

Supplied empty-window behavior remains unchanged.

Matching pause is distinct from phase/status intake suppression. Otherwise eligible existing records still checkpoint new cursors when intake rules suppress delivery.

### Authorized first admission — D1-B

Discovery may call existing claim-free `initializeRecord` only after full-page validation, matching, a method-valid missing-record read, explicit authorization for the canonical item, exact initial state and a fresh cancellation gate.

Submit only identity/idempotency fields and authorized phase/status. Seed no cursors, PR/execution references, histories or claims. No-comment items are admissible.

Bind initialization identity to the original authorized submission. Preserve its exact request and identifier across retries; never mint another identifier to evade a conflict. Do not include continuation tokens, traversal identity or claim capabilities.

Validate initialization with a dedicated method-specific guard against an independently retained request. Validate the complete public record, canonical identity, initialized discriminator, accepted revision one, timestamp, replay metadata and exact initial workflow state. A valid later record is not the original initialization snapshot and grants no acquisition authority.

Existing ledger publication/receipt behavior supplies the race guarantee: only the publishing winner is fresh; matching requests replay; other initialization loses with already-exists; conflicting identity reuse is terminal.

Return discovery-only intake only after validated **fresh** durable acceptance whose authorized initial phase/status satisfy intake rules. Replay, restart reads, existing records and ambiguous-acknowledgement reconciliation cannot reconstruct delivery.

Initialization ends the item’s processing path for that invocation. Genuine comment observation is deferred to a later invocation without synthetic cursors or delivery checkpoints.

Initialization cleanup is `not-required / no-claim-acquired`, even after uncertain acknowledgement. It proves absence of acquisition—not success or failure of initialization.

Durable initialization without usable acknowledgement, or a crash before consumption, can permanently lose intake. This is intentional at-most-once reporting, not exactly-once execution or lossless delivery.

### Signal and recovery separation

Comment intake retains existing source revision, changed kinds, phase/status and token-free claim metadata. Its existing direct/replay/history checkpoint acknowledgement contract remains unchanged.

Discovery-only intake has a distinct discriminator and carries canonical identity, accepted initialization revision, exact authorized initial state and minimized policy-versioned evidence. It carries no changed-comment kinds, source revision, checkpoint or claim metadata.

At most one signal is returned per item per invocation across both types.

Checkpoint-history recovery must continue using the same acknowledgement validator against the original submitted request, not refreshed retry preconditions. This permission must not be generalized to discovery initialization replay.

`acted` counts either returned signal type. `suppressed` counts only acknowledged suppressed cursor advances. Pauses and initialization without intake are not cursor suppression. Final failures may overlap acknowledged actions; cleanup counts partition outcomes.

### Fresh bounded traversal — D3-A

Each invocation starts at the beginning of its stable host scope/partition. Continuations and request-correlation identities remain invocation-local.

Add no durable page continuation, pause/admission marker, sidecar, outbox, schema field or cursor repurposing. Durable progress remains existing per-item initialization/receipts and comment checkpoints.

Validate the whole page before item effects. Preserve host page traversal and canonical UTF-8 item order within each page. Do not claim global ordering independent of page partitions.

Only explicit terminal evidence establishes the end of traversal. Empty continued pages consume budget and continue.

Page budget `P` permits at most `P` initiated page calls, including empty and failed calls. Candidate retries never reset page/item budgets. Duplicate canonical items, repeated/malformed continuations, binding drift, overflow and invalid pages produce explicit incompletion while preserving earlier validated outcomes and accepted writes.

Require inclusive positive safe-integer limits for page calls, total items at most 1,000, entries per page, filter/fact collections, values and aggregate policy/page bytes including required facts and continuation. Check collection lengths before copying/iteration and UTF-8 bytes incrementally before retention. Never truncate or deduplicate into success.

Traversal completeness is separate from candidate success: a terminal traversal may contain failed/skipped dispositions. A processed prefix is not complete, and repeated prefix scans do not guarantee eventual tail progress.

The implementation plan defines conservative page-per-poll composition and exact numeric ceilings. Hosts must select stable partitions and budgets that fit.

### Cancellation, guards and security

Fresh cancellation gates precede seam calls and non-cleanup mutations. Page calls use dedicated controller/timer lifecycles; retired results cannot trigger later effects.

Await in-flight ledger operations, validate their acknowledgements, and preserve permitted accepted effects/signals after abort. Existing-record mutations retain validated claims, fencing, revision/state checks and exactly-once cleanup attempts. Initialization creates no cleanup authority.

All ledger responses, including initialization, retain bounded method-specific success/error validation and original-request separation. Unknown/malformed variants and thrown/rejected dependencies become `ledger-fault`, not dependency-controlled error text.

The architectural assessment is **APPROVED_WITH_CONTROLS**: bind authorization, validate immutable bounded pages and requests, implement exact matching/anchor behavior, minimize evidence, reject drift/overflow, and preserve cancellation/cleanup truth. These controls require implementation tests and independent review.

Injected adapters remain trusted in-process dependencies, not sandboxed or cryptographically verified sources. Liveness remains conditional on settling ledger/delay dependencies; abort is not a hard runtime guarantee.

## Retained supplied-candidate decision and shared invariants

The following decision records the supplied-candidate contract. Its no-discovery/no-initialization boundary, two-method seam, comment signal shape and supplied completion rules remain applicable to supplied mode. The approved discovery decision above defines the explicit exceptions and additional contracts. Shared existing-record observation, operation identity, fencing, staleness, checkpoint recovery and cleanup protections remain mandatory in discovery.

### Responsibility boundary

Sandcastle will expose one typed operation that runs a single bounded watch pass and returns a structured result.

The DevSquad host remains responsible for:

- choosing the candidate set; the watcher never discovers or queries work-item sets;
- initializing ledger records; the watcher never initializes a record on the host's behalf;
- defining phase and status meaning and supplying exact-match intake rules;
- interpreting an intake signal and deciding what runs next;
- every external tracker write, pull-request action, and agent execution.

The watcher:

- observes through an injected read-oriented seam;
- evaluates eligibility as a pure function;
- acquires a ledger claim only when it intends to mutate;
- persists newly observed opaque cursors through ledger checkpoints;
- reports token-free per-candidate outcomes and intake signals.

The watcher defines no phase allowlist, no phase ordering, no terminal state, and no resumability policy. Unknown phases admitted by caller intake rules are accepted without objection.

### A watcher-specific read seam, not the existing control plane

The watcher will define its own seam rather than reuse `AdoReadOnlyControlPlane`.

`AdoReadOnlyControlPlane` exposes `fetchWorkItem`, `getPullRequestCiStatus`, and `getPullRequestReviewFeedback`. It has no notion of a durable per-work-item cursor, it returns comment bodies and authors that the watcher must never accept, and its shape is co-owned by the feedback loop and team runner. Reusing it would couple two independent evolution paths and would import body-bearing types into a data-minimizing component.

The watcher seam therefore exposes exactly two methods:

- `observeWorkItemComments` — required.
- `observePullRequestActivity` — optional; required only for candidates whose record carries a pull-request identifier.

The seam is structurally validated before any observation or mutation, following the ADR-0021 precedent, and a missing or non-callable required method produces a stable configuration error naming the method. The seam is never invoked to write. Only identifier-bearing fields are read from seam responses; every other field on a returned entry is discarded before the value can reach durable state, results, errors, or diagnostics.

Before any injected side effects, validate the optional parent signal's boolean `aborted` and callable `addEventListener` AND `removeEventListener`. Recheck parent abort immediately before each seam invocation, including when a valid work-item response aborts the parent before the PR call.

Identifiers returned by the seam are opaque. The watcher never parses, orders, or arithmetically compares identifier text. Ordering is the seam's contract: entries are returned in the tracker's authoritative order, oldest first, and the window is anchor-inclusive — whenever a `since` cursor is supplied and the window is non-empty, that cursor appears in it. New-event selection anchors on that cursor and takes everything after it.

A non-empty window that omits the supplied anchor is **undecidable** and is therefore fail-closed. Because no identifier is parsed or ordered, that shape is indistinguishable from a window in which every entry is new; treating it as such silently re-delivers the whole window, which is exactly the duplication this ADR exists to prevent. The watcher reports `observation-anchor-missing` for that candidate and advances nothing. Re-anchoring a record whose tracker really did drop an anchored entry is a deliberate host action, not an inference the watcher is entitled to make.

Every duplicate canonical observation identity is rejected, not deduplicated. Work-item identity is exact comment ID; PR identity is the exact thread/comment pair after only null/undefined normalization. Missing/null comments are incomplete; blank comments are invalid identifiers. For mixed new PR entries, persist the newest complete pair in seam order and mark PR skipped only if no new pair is persistable. Changes and skipped kinds are disjoint.

Each WI or PR window is bounded inclusively to 1,000 entries and 1,048,576 aggregate UTF-8 identifier bytes (PR sums thread ID plus nonnull comment ID); each identifier remains at most 1,024 bytes. Check count before iteration/copy and accumulate bytes/uniqueness before retaining each entry. Never create an oversized full projection, silently truncate, or sort opaque IDs. Malformed/duplicate/oversized windows invalidate the entire candidate as `invalid-observation-window`, even if the other kind is valid; individual identifier violations remain `invalid-observation-identifier`. The host SHOULD also bound upstream payloads, but the watcher MUST independently enforce its bounds.

### Deterministic operation identifiers

Every watcher ledger mutation derives its operation identifier from canonically serialized identity:

```text
operationId = "dsw2." + step + "." + sha256hex(canonicalJson(identity)).slice(0, 32)
```

Canonical serialization removes delimiter-injection ambiguity between a long work-item identifier and a long pass identifier, and keeps the identifier inside the ledger's 256-byte bound. `passId` is **caller-supplied and required**; the watcher generates no pass identity, because a random default would make idempotent replay after a crash impossible.

The identity is scoped differently for the two families of step, because they need opposite properties.

A **checkpoint** identity is `{ passId, workItemId, step, ordinal, generation }`, where the generation names both ends of the advance being published: the persisted anchors it derives from and the cursors it makes durable. Retrying the same advance reproduces the identifier, so an already-durable mutation replays instead of duplicating. Publishing a different advance derives a different identifier, so a later pass that legitimately reuses a `passId` for new work is not rejected as a conflict.

A **claim-lifecycle** identity (`claim`, `renew`, `release`) is `{ passId, workItemId, step, ordinal, claimEpoch }`, where `claimEpoch` is random and minted per acquisition, then reused by that claim's renewals and its release. This is forced by ADR-0025: the acquire digest includes the capability token, and tokens are freshly random every acquisition. An epoch-free claim identifier would make the second acquisition under a given `passId` a permanent `idempotency-conflict` — poisoning that pass identity for that candidate forever, with no cursor ever advanced and no retry able to clear it. The alternative, deriving the token from the pass identity, was rejected outright: capability tokens must stay unpredictable.

The epoch is an idempotency namespace, not a capability. It authorizes nothing, and it is not a claim token.

An `idempotency-conflict` remains a terminal outcome for that candidate step. The watcher never resolves one by re-deriving an identifier after the fact.

### Claim lifetime, leases, and renewal

A claim is acquired only when the watcher intends to mutate. On candidate completion/error/cancellation, invoke release exactly once for previously validated authority, retaining local evidence until the response is validated. Without validated authority invoke no release; never guess authority, reacquire, retry release, or force-release another owner. An unexpired foreign claim is a `claim-conflict` skip.

Default lease duration is 60 seconds; the caller may raise it up to the ADR-0025 ceiling of 24 hours. Default renewal threshold is one third of the lease. Before any mutation under a held claim, the watcher renews when `now + renewalThreshold >= expiresAt`, preserving the fencing value.

One case holds a claim across polls: a checkpoint whose outcome is ambiguous (`contention`, or `storage` with an `indeterminate` outcome) leaves the candidate pending under its existing validated authority and retries on a later poll with the **same** operation identifier. Renewal exists for this window. If the budget ends first, report failure and attempt cleanup once; do not equate an attempted release with confirmed release.

Every candidate outcome has mandatory `cleanup: { status, reason, ledgerErrorKind, acceptedRevision }`:

| Evidence                                               | Status / reason                           | Category / revision                                             |
| ------------------------------------------------------ | ----------------------------------------- | --------------------------------------------------------------- |
| Valid release acknowledgement, including exact replay  | `released` / `release-acknowledged`       | null / original accepted release revision                       |
| Known rejection (including storage/unchanged)          | `failed` / `release-rejected`             | known category / null                                           |
| Storage/indeterminate or contention                    | `indeterminate` / `release-indeterminate` | known category / null                                           |
| Throw/reject/malformed release                         | `indeterminate` / `release-indeterminate` | `ledger-fault` / null                                           |
| Faulting/ambiguous acquire without validated authority | `indeterminate` / `authority-unvalidated` | `ledger-fault` or known ambiguous category / null; zero release |
| No claim and no uncertainty                            | `not-required` / `no-claim-acquired`      | null / null; zero release                                       |

Categories are validated `DevSquadAdoLedgerError["kind"]` values or `ledger-fault`; no arbitrary strings. Accepted revision is a positive safe integer only after acknowledgement, otherwise null. Inclusive lease expiry is the backstop, not evidence of release. An exact replay acknowledges the original release even if its valid latest record now has a later owner.

Failed/indeterminate cleanup promotes an otherwise nonfailed candidate to failed: `ledger-unavailable` for `ledger-fault`, otherwise `claim-cleanup-unconfirmed`. Preserve any existing primary failure reason. Preserve acknowledged checkpoint revision, cursor changes AND the returned intake signal; no rollback/retraction. `counts.acted` counts returned signals, `counts.suppressed` acknowledged suppressed advances, `counts.failed` final failures; these may overlap. `cleanupReleased`, `cleanupFailed`, `cleanupIndeterminate`, and `cleanupNotRequired` partition all candidate outcomes.

Source revision, checkpoint accepted revision and cleanup accepted revision remain separate. A record read at 4 acquires at 5, checkpoints at 6, releases at 7: signal source 4, outcome revision 6, cleanup revision 7. An unchanged subsequent pass leaves then-current revision 7 unchanged. This follows ADR-0025; no ledger semantics are changed to fit the former incorrect example.

Fencing protects ledger mutations only. It makes no external side effect exactly-once.

### Observation staleness is checked at acquisition

Acquiring a claim does not retroactively validate an earlier observation. A record is read before its observation, the acquisition returns the record as it stands once the claim is held, and the watcher compares the two before writing anything.

This matters because those two reads straddle a window in which another owner can acquire, advance a cursor, and release. The later acquisition then succeeds legitimately — no fence is violated — but the selection in hand was computed from anchors that are no longer durable, and checkpointing it would move the cursor **backwards**, re-delivering every event between the two positions. Fencing alone does not close that hole, because nothing about it is stale in the fencing sense.

When observation anchors or PR identity moved, the watcher attempts cleanup without checkpointing and reports `no-change` / `stale-observation` only when cleanup is acknowledged; a later poll can re-observe. Unconfirmed cleanup instead finalizes a failed candidate. Phase/status are taken fresh from the claimed record and carried into checkpoint preconditions, without changing the pre-acquire source revision.

### Intake signals are returned, never dispatched

Intake signals are returned in the pass result. The watcher exposes no callback, queue, retry, or transport.

A callback would allow host code to run inside the pass while a claim is held, which reintroduces re-entrancy, partial-failure ambiguity, and a second definition of "delivered". A returned array requires a validated durable checkpoint acknowledgement before its signal enters the result. A host crash before return or consumption can lose that signal even though its cursor advanced durably.

Delivery is **at-most-once and batched**, not lossless: a durable checkpoint whose acknowledgement is lost or malformed can advance the cursor without returning a signal, and a host crash can lose an acknowledged signal before intake processing. Later passes see no new activity for that window. Hosts reconcile durable cursors against intake processing; no outbox, dispatch factory, or live client is added. Fencing protects ledger mutations, not downstream execution.

At most one intake signal is emitted per candidate per pass. A signal carries the work-item identifier, the source revision it was derived from, the changed observation kinds, the exact caller-defined phase and status, and token-free claim metadata. It carries no external body, author, credential, claim token, or agent-session content.

Cursors advance even when intake rules do not admit the record. Suppression is an intake decision, not an observation decision; discarding the observation would strand the record until an unrelated event arrived.

### Determinism, ordering, and bounded termination

Candidates are evaluated sequentially in a canonical order derived from the UTF-8 byte ordering of canonical work-item identifiers, independent of input order. The watcher performs no concurrent candidate processing in this decision: parallelism would make seam call order, ledger contention, and reason-code sequences observationally nondeterministic, and the pass is I/O-bound on an injected seam that the host already controls.

The clock is read once per poll and that single reading drives every eligibility, lease, and timestamp decision in the poll. Delays come from an injected delay source. Backoff is `min(base * multiplier^(n-1), max)` truncated to an integer, with no randomness unless an explicit jitter source is injected.

A pass stops at the first of: all candidates resolved, poll budget reached, poll-start elapsed budget reached, or cancellation. Fresh cancellation gates precede each seam and non-cleanup mutation and run between polls; mandatory cleanup remains attempted once after abort and preserves acknowledgements.

`maxPollStartElapsedMs` gates new poll scheduling, not runtime. Candidate count is 1–1,000; safe-integer maxPolls is 1–10,000; duration/threshold rules and the inclusive 24-hour lease ceiling are validated. Ledger calls and delays must settle for termination; observation timeout assumes a valid delay. Poll bounds and abort do not imply an unconditional runtime or physical-request ceiling.

Each observation owns a dedicated AbortController, linked from its parent and passed into its seam call. Timeout/abort cancels the seam and timer; every terminal path removes parent links/listeners and consumes/quarantines late settlements. Success/rejection also retires the timer. Cooperative fakes must demonstrate at most one active seam operation per pass and one observation timer; noncooperating work may remain physically in flight and cannot be forcibly terminated. Abort is not a hard wall-clock ceiling. Ledger mutations remain awaited to avoid silently abandoning durability/authority evidence.

### Fail-closed partial failure

A candidate failure never aborts the remaining candidates. Only invalid input and seam-contract violations fail the pass before work begins; cancellation and budget exhaustion end the pass while still returning acknowledged outcomes.

Ledger recovery categories (`corrupt-artifact`, `unsupported-schema-version`, `path-boundary`, `unsupported-permissions`, `capacity-exceeded`, `scan-limit`) are surfaced with their stable ledger category and are never repaired, reset, or bypassed. The watcher creates, deletes, or rewrites no ledger artifact except through the ledger's public typed operations.

Seam failures expose no transport message, URL or external body. Every ledger method (`readRecord`, acquire, renew, checkpoint, release) is guarded with method-specific runtime validation, not a shallow `ok: true` cast. Validate the complete latest public record, canonical requested identity, original accepted revision/time/replay, method outcome, and applicable request owner/token/fencing/checkpoint consistency. A replay's original accepted revision may be below its valid latest record revision; never conflate historical acknowledgement with current ownership. Every known error variant's required fields are checked; unknown/malformed categories and throws/rejections become only `ledger-fault`.

Non-cleanup faults report `failed` / `ledger-unavailable`; cleanup faults follow the mandatory matrix. A malformed acquire establishes no authority and cannot fabricate release. A malformed post-mutation acknowledgement suppresses unacknowledged effects despite possible durable mutation, accepting potential signal loss rather than inventing acknowledgement. Runtime validation checks a dependency's contract, not its underlying storage honesty.

## Alternatives Considered

### Reuse `AdoReadOnlyControlPlane` as the observation seam

Rejected. It carries comment bodies and authors into a data-minimizing component, lacks cursor semantics, and is co-owned by the feedback loop and team runner, so watcher evolution would drag two unrelated components.

### Random or watcher-generated pass identity

Rejected. Idempotent replay after an ambiguous checkpoint requires the retry to reproduce the original checkpoint identifier. A generated pass identity makes that impossible and silently converts a retry into a duplicate.

### One identity rule for every step, or a pass-derived claim token

Rejected in both directions. Deriving the capability token from the pass identity would make tokens predictable and destroy the point of holding a capability at all. Deriving the _claim_ operation identifier from pass identity alone — leaving the token random — poisons that pass identity permanently for the candidate, because ADR-0025 hashes the token into the acquire digest, so the second acquisition can only ever be an `idempotency-conflict`. A per-acquisition claim epoch resolves the tension by scoping the identifier only, leaving the token untouched and the pass retryable.

### A strict wall-clock bound on pass duration

Rejected. A hard ceiling would abandon in-flight ledger mutations and their authority/durability evidence. `maxPollStartElapsedMs` therefore bounds scheduling, with poll/window limits and cooperative cancellation; termination still assumes settling ledger methods and delays. An abort signal is not a substitute hard ceiling.

### Treating an anchor-less window as an all-new window

Rejected. It is the silent-duplication path: an anchored entry that ages out of the tracker's window makes every subsequent poll re-deliver the entire window, and nothing in the result would say so. Failing the candidate closed with `observation-anchor-missing` surfaces a seam-contract breach as an operational signal instead of as mysterious duplicate work.

### Callback or event-emitter intake delivery

Rejected. Host code executing inside a claimed step reintroduces re-entrancy and makes "delivered" ambiguous with respect to durability.

### Long-lived watcher daemon

Rejected for this slice. A daemon adds supervision, restart policy, and liveness concerns that belong to the host. A bounded pass composes into any host loop and is trivially testable.

### Concurrent candidate processing

Rejected. Determinism of decisions, ordering, reason codes, and seam call order is a stated invariant, and the workload is bounded at 1,000 candidates per pass.

### Suppressing cursor advancement when intake rules reject the record

Rejected. It would strand records behind an unrelated future event and would make cursor state depend on lifecycle policy that Sandcastle does not own.

### Supplied-only prohibition versus explicitly authorized discovery admission

The initialization prohibition remains mandatory for supplied mode. Its former application to all watcher modes is superseded by approved D1-B.

Keeping initialization entirely outside the watcher minimizes its API but cannot satisfy authorized no-comment discovery intake. Inferring admission or lifecycle state from matching reduces host input but transfers authority into Sandcastle and remains excluded. Explicit item-specific authorization preserves host ownership at the cost of request/acknowledgement validation and fresh-only reporting.

### Replayable admission delivery, synthetic checkpoints or an outbox

Excluded by D1-B/D3-A. Replay delivery can duplicate first admission; synthetic checkpoints fabricate observation progress; an outbox adds a new delivery/storage protocol. Fresh-only acceptance reuses existing ledger race guarantees but intentionally permits permanent signal loss.

### Upstream-only filtering or inferred matching semantics

Excluded by D2. Upstream eligibility alone does not implement the library’s policy contract. Implicit case folding, textual path prefixes and assignedTo-derived teams change membership meaning. Exact library matching is reproducible but requires bounded transient handling of sensitive facts before projection.

### Observing excluded items or rebaselining on reentry

Excluded by D2-A. Observing excluded items advances anchors through a pause; rebaselining can discard unseen activity. Preserved anchors avoid both but introduce retention dependence and explicit host reconciliation after anchor loss.

### Durable continuation versus fresh bounded traversal

Durable continuation adds persistence/lifecycle beyond the existing ledger contract and is excluded by D3-A. Fresh traversal avoids schema and sidecar changes at the cost of repeated reads and no tail-progress guarantee for oversized partitions. Incompletion remains explicit.

### Global discovery sorting versus page-local canonical ordering

Global sorting requires collecting the traversal before processing. Page-local canonical ordering preserves bounded processing and earlier accepted effects, but determinism is relative to identical page partitions.

## Consequences

- A host coordinator gets restart-safe watching without hand-rolled polling, deduplication, or claim handling.
- Non-duplicating intake holds only for ledger-mediated delivery, and it is at-most-once: a durable-but-unacknowledged checkpoint advances a cursor without delivering its signal. Hosts needing completeness reconcile from the record.
- Hosts must supply a stable pass identity and must implement the anchor-inclusive seam contract; a window that drops its anchor stalls that candidate with `observation-anchor-missing` rather than silently re-delivering.
- Retrying a pass under the same `passId` is safe by construction, including after a durable acquire whose checkpoint never landed.
- `maxPollStartElapsedMs` bounds scheduling, not duration. Abort is cooperative and cannot force noncooperating dependencies to stop.
- Every candidate carries truthful cleanup evidence and counts distinguish acknowledged signals from final cleanup failures; no release acknowledgement is fabricated.
- Intake rules must be enumerated explicitly, which is more verbose than a wildcard but keeps lifecycle policy outside Sandcastle.
- Claims are short-lived, so a long host-side reaction to a signal runs without watcher-held exclusivity; the host must reacquire if it intends to mutate.
- A candidate can end a pass having done nothing but acquire and release a claim (`stale-observation`) when another owner won the race; this consumes two revisions and is expected under contention.
- The watcher adds a second injected ADO-facing seam shape; the two must be kept intentionally separate rather than merged later without a new decision.

- Supplied-candidate behavior remains unchanged.
- Discovery adds bounded policy, admission, stability and retention contracts without live tracker access or ADR-0025 storage changes.
- Initialization is claim-free and has fresh-only, potentially lossy intake. Its cleanup reports absence of acquisition, not durability.
- Matching facts remain transient; only minimized policy-versioned evidence leaves that boundary.
- Paused records preserve anchors and fail closed on known retention loss.
- Every discovery invocation rescans its bounded partition from the beginning; only explicit terminal traversal with item dispositions establishes completeness.
- Historical W038 evidence remains scoped to the supplied-candidate baseline. Discovery requires new implementation and independent review evidence.

## References

- ADR-0021: ADO feedback-loop control-plane boundary
- ADR-0022: ADO agent-team runner boundary
- ADR-0024: DevSquad Sandcastle execution adapter boundary
- ADR-0025: DevSquad/ADO workflow ledger
- `docs/features/devsquad-ado-workflow-watcher/spec.md`
- `docs/features/devsquad-ado-workflow-watcher/plan.md`
