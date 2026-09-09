# ADR-0026: DevSquad/ADO workflow watching is a bounded offline observation pass

## Status

Proposed

## Priorities

1. Preserve DevSquad ownership of lifecycle meaning, phase legality, scheduling, and external tracker authority.
2. Deliver each externally observed event to DevSquad intake at most once, across restarts.
3. Prevent concurrent or stale coordinators from acting on the same work item.
4. Guarantee termination through bounds the implementation can actually enforce, with cooperative cancellation.
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

## Decision

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

Identifiers returned by the seam are opaque. The watcher never parses, orders, or arithmetically compares identifier text. Ordering is the seam's contract: entries are returned in the tracker's authoritative order, oldest first, and the window is anchor-inclusive — whenever a `since` cursor is supplied and the window is non-empty, that cursor appears in it. New-event selection anchors on that cursor and takes everything after it.

A non-empty window that omits the supplied anchor is **undecidable** and is therefore fail-closed. Because no identifier is parsed or ordered, that shape is indistinguishable from a window in which every entry is new; treating it as such silently re-delivers the whole window, which is exactly the duplication this ADR exists to prevent. The watcher reports `observation-anchor-missing` for that candidate and advances nothing. Re-anchoring a record whose tracker really did drop an anchored entry is a deliberate host action, not an inference the watcher is entitled to make.

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

A claim is acquired only when the watcher intends to mutate, and it is released as soon as the candidate resolves. The watcher never force-releases, deletes, or resets a claim owned by another owner; an unexpired foreign claim is a `claim-conflict` skip, not a fault.

Default lease duration is 60 seconds; the caller may raise it up to the ADR-0025 ceiling of 24 hours. Default renewal threshold is one third of the lease. Before any mutation under a held claim, the watcher renews when `now + renewalThreshold >= expiresAt`, preserving the fencing value.

One case holds a claim across polls: a checkpoint whose outcome is ambiguous (`contention`, or `storage` with an `indeterminate` outcome) leaves the candidate pending under its existing claim and retries on a later poll with the **same** operation identifier, so an already-durable mutation replays instead of duplicating. Renewal exists for exactly this window. If the pass budget ends first, the candidate is reported as failed and its claim is released.

Fencing protects ledger mutations only. It makes no external side effect exactly-once.

### Observation staleness is checked at acquisition

Acquiring a claim does not retroactively validate an earlier observation. A record is read before its observation, the acquisition returns the record as it stands once the claim is held, and the watcher compares the two before writing anything.

This matters because those two reads straddle a window in which another owner can acquire, advance a cursor, and release. The later acquisition then succeeds legitimately — no fence is violated — but the selection in hand was computed from anchors that are no longer durable, and checkpointing it would move the cursor **backwards**, re-delivering every event between the two positions. Fencing alone does not close that hole, because nothing about it is stale in the fencing sense.

When the observation anchors or the pull-request identity moved, the watcher releases the claim without writing and reports `no-change` / `stale-observation`; a later poll re-observes from the advanced anchor. Phase and status are deliberately excluded from that comparison: they are read fresh from the claimed record and carried into the checkpoint precondition, so a foreign change to them still conflicts on its own terms.

### Intake signals are returned, never dispatched

Intake signals are returned in the pass result. The watcher exposes no callback, queue, retry, or transport.

A callback would allow host code to run inside the pass while a claim is held, which reintroduces re-entrancy, partial-failure ambiguity, and a second definition of "delivered". A returned array makes the non-duplication argument mechanical: a candidate's cursor checkpoint is acknowledged as durable before its signal enters the result, so a crash before return loses only signals whose cursors never advanced.

Delivery is therefore **at-most-once**. The ordering guarantees no duplicate, not no loss: a checkpoint that becomes durable while its acknowledgement is lost — process death, or an `indeterminate` storage outcome the budget does not outlive — advances the cursor without ever returning its signal, and a later pass correctly sees nothing new for that window. Hosts that cannot tolerate a dropped signal must reconcile from the durable record rather than from the signal stream. Claiming exactly-once here would be a promise the ledger cannot keep.

At most one intake signal is emitted per candidate per pass. A signal carries the work-item identifier, the source revision it was derived from, the changed observation kinds, the exact caller-defined phase and status, and token-free claim metadata. It carries no external body, author, credential, claim token, or agent-session content.

Cursors advance even when intake rules do not admit the record. Suppression is an intake decision, not an observation decision; discarding the observation would strand the record until an unrelated event arrived.

### Determinism, ordering, and bounded termination

Candidates are evaluated sequentially in a canonical order derived from the UTF-8 byte ordering of canonical work-item identifiers, independent of input order. The watcher performs no concurrent candidate processing in this decision: parallelism would make seam call order, ledger contention, and reason-code sequences observationally nondeterministic, and the pass is I/O-bound on an injected seam that the host already controls.

The clock is read once per poll and that single reading drives every eligibility, lease, and timestamp decision in the poll. Delays come from an injected delay source. Backoff is `min(base * multiplier^(n-1), max)` truncated to an integer, with no randomness unless an explicit jitter source is injected.

A pass stops at the first of: all candidates resolved, poll budget reached, poll-start elapsed budget reached, or cancellation. Cancellation is observed before each seam call, before each ledger mutation, and between polls; it still releases every acquired claim and still reports every durable outcome already acknowledged.

Termination is guaranteed by the **poll count**, not by elapsed time. `maxPollStartElapsedMs` is checked once per poll, before that poll begins, and it bounds how long the pass keeps scheduling new work — not how long the pass runs. Work already in flight always runs to completion.

This is deliberate, and the budget is named for what it does. A strict wall-clock ceiling would have to abandon in-flight ledger mutations, which is precisely what must never happen: a mutation abandoned mid-flight is an indeterminate write and, worse, a stranded claim. A bound the implementation cannot enforce without breaking a stronger invariant should not be advertised as if it could. Callers who need a hard ceiling on the call itself impose it with their own abort signal, which the pass honours at every checkpoint. Per-observation overrun is separately bounded by `observationTimeoutMs`, which is enforceable because abandoning a read is safe.

### Fail-closed partial failure

A candidate failure never aborts the remaining candidates. Only invalid input and seam-contract violations fail the pass before work begins; cancellation and budget exhaustion end the pass while still returning acknowledged outcomes.

Ledger recovery categories (`corrupt-artifact`, `unsupported-schema-version`, `path-boundary`, `unsupported-permissions`, `capacity-exceeded`, `scan-limit`) are surfaced with their stable ledger category and are never repaired, reset, or bypassed. The watcher creates, deletes, or rewrites no ledger artifact except through the ledger's public typed operations.

Seam rejections are converted into a stable per-candidate observation error carrying no transport message, no URL, and no external body. The injected **ledger** is treated with the same suspicion as the seam: a ledger method that throws, rejects, or returns something that is not a typed result resolves as `failed` / `ledger-unavailable` with the stable category `ledger-fault`. Letting such a failure escape would carry a raw `Error`, its message and stack, out through the public result — and would abandon whatever claim the candidate was holding, since the release path lives on the candidate's own resolution. Each injected call is classified individually rather than wrapped in one blanket handler, so a genuine typed ledger error still travels its own mapped path and keeps its own category.

## Alternatives Considered

### Reuse `AdoReadOnlyControlPlane` as the observation seam

Rejected. It carries comment bodies and authors into a data-minimizing component, lacks cursor semantics, and is co-owned by the feedback loop and team runner, so watcher evolution would drag two unrelated components.

### Random or watcher-generated pass identity

Rejected. Idempotent replay after an ambiguous checkpoint requires the retry to reproduce the original checkpoint identifier. A generated pass identity makes that impossible and silently converts a retry into a duplicate.

### One identity rule for every step, or a pass-derived claim token

Rejected in both directions. Deriving the capability token from the pass identity would make tokens predictable and destroy the point of holding a capability at all. Deriving the _claim_ operation identifier from pass identity alone — leaving the token random — poisons that pass identity permanently for the candidate, because ADR-0025 hashes the token into the acquire digest, so the second acquisition can only ever be an `idempotency-conflict`. A per-acquisition claim epoch resolves the tension by scoping the identifier only, leaving the token untouched and the pass retryable.

### A strict wall-clock bound on pass duration

Rejected, and the option renamed rather than left ambiguous. Enforcing a hard ceiling means abandoning whatever is in flight when it expires, and the things in flight are ledger mutations; abandoning one produces an indeterminate write and a stranded claim, trading a soft guarantee for a hard corruption risk. The budget is therefore named `maxPollStartElapsedMs` and documented as bounding scheduling, with `maxPolls`, `observationTimeoutMs`, and the caller's abort signal carrying the actual termination guarantee.

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

### Watcher-initialized ledger records

Rejected. Initialization encodes lifecycle intent, which ADR-0024 assigns to DevSquad. A missing record is a stable skip.

## Consequences

- A host coordinator gets restart-safe watching without hand-rolled polling, deduplication, or claim handling.
- Non-duplicating intake holds only for ledger-mediated delivery, and it is at-most-once: a durable-but-unacknowledged checkpoint advances a cursor without delivering its signal. Hosts needing completeness reconcile from the record.
- Hosts must supply a stable pass identity and must implement the anchor-inclusive seam contract; a window that drops its anchor stalls that candidate with `observation-anchor-missing` rather than silently re-delivering.
- Retrying a pass under the same `passId` is safe by construction, including after a durable acquire whose checkpoint never landed.
- `maxPollStartElapsedMs` bounds scheduling, not duration. A pass can exceed it; hosts wanting a hard ceiling supply an abort signal.
- Intake rules must be enumerated explicitly, which is more verbose than a wildcard but keeps lifecycle policy outside Sandcastle.
- Claims are short-lived, so a long host-side reaction to a signal runs without watcher-held exclusivity; the host must reacquire if it intends to mutate.
- A candidate can end a pass having done nothing but acquire and release a claim (`stale-observation`) when another owner won the race; this consumes two revisions and is expected under contention.
- The watcher adds a second injected ADO-facing seam shape; the two must be kept intentionally separate rather than merged later without a new decision.

## References

- ADR-0021: ADO feedback-loop control-plane boundary
- ADR-0022: ADO agent-team runner boundary
- ADR-0024: DevSquad Sandcastle execution adapter boundary
- ADR-0025: DevSquad/ADO workflow ledger
- `docs/features/devsquad-ado-workflow-watcher/spec.md`
- `docs/features/devsquad-ado-workflow-watcher/plan.md`
