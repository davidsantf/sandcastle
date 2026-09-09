# ADR-0026: DevSquad/ADO workflow watching is a bounded offline observation pass

## Status

Proposed

## Priorities

1. Preserve DevSquad ownership of lifecycle meaning, phase legality, scheduling, and external tracker authority.
2. Deliver each externally observed event to DevSquad intake at most once, across restarts.
3. Prevent concurrent or stale coordinators from acting on the same work item.
4. Guarantee termination inside a caller-declared budget, with cooperative cancellation.
5. Keep Sandcastle core offline, tracker-neutral, and free of transport or credential coupling.
6. Keep every decision deterministic and reproducible from injected inputs alone.

## Context

ADR-0025 delivered the repository-local workflow ledger: durable records, fenced claims, leases, idempotency receipts, opaque observation cursors, and fail-closed recovery. The ledger deliberately observes nothing. It stores a work-item comment cursor and a pull-request thread/comment cursor but decides neither when a record should be revisited nor which external events are new.

ADR-0021 established the injected control-plane pattern for ADO: `AdoControlPlaneFactory` structurally validates an injected client and distinguishes `read-only` from `write` access. ADR-0024 fixed DevSquad as the owner of work-item lifecycle, phase transitions, scheduling, and pull-request authority; Sandcastle owns isolated execution only.

Between those two boundaries a host coordinator still has to hand-roll polling, deduplication, claim handling, and termination around the ledger. That is precisely where double-processing, unbounded loops, and stale-owner writes appear.

Three properties make this architecture-significant rather than a local implementation detail.

First, **exactly-once intake is externally observable**: a duplicated intake signal makes DevSquad run work twice, and the only defence is that cursor advancement is durable before delivery is reported.

Second, **idempotent replay across restarts requires operation identifiers to be a stable, documented function of caller-visible identity**, not an internal counter. A host that retries an ambiguous pass must reproduce the same identifiers or the ledger cannot replay the original outcome.

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

Identifiers returned by the seam are opaque. The watcher never parses, orders, or arithmetically compares identifier text. Ordering is the seam's contract: entries are returned in the tracker's authoritative order, oldest first, and the seam either includes the supplied `since` cursor as the first entry or returns only entries strictly after it. New-event selection anchors on that cursor; when the anchor is absent from the returned list, every returned entry is treated as new.

### Deterministic operation identifiers

Every watcher ledger mutation derives its operation identifier deterministically:

```text
operationId = "dsw1." + step + "." + sha256hex({ v: 1, passId, workItemId, step, ordinal }).slice(0, 32)
```

`step` is `claim`, `renew`, `checkpoint`, or `release`. `ordinal` is `0` for one-shot steps and the one-based renewal sequence for `renew`. The digest input is canonically serialized, which removes delimiter-injection ambiguity between a long work-item identifier and a long pass identifier, and keeps the identifier inside the ledger's 256-byte bound.

`passId` is **caller-supplied and required**. The watcher will not generate a random pass identity, because a random default would make idempotent replay after a crash impossible: the host retrying an ambiguous pass would produce different identifiers and the ledger could not replay the original outcome. Requiring the identifier makes retry parity an explicit, testable contract instead of an accident.

An `idempotency-conflict` is a terminal outcome for that candidate step. The watcher never resolves it by generating a different identifier.

### Claim lifetime, leases, and renewal

A claim is acquired only when the watcher intends to mutate, and it is released as soon as the candidate resolves. The watcher never force-releases, deletes, or resets a claim owned by another owner; an unexpired foreign claim is a `claim-conflict` skip, not a fault.

Default lease duration is 60 seconds; the caller may raise it up to the ADR-0025 ceiling of 24 hours. Default renewal threshold is one third of the lease. Before any mutation under a held claim, the watcher renews when `now + renewalThreshold >= expiresAt`, preserving the fencing value.

One case holds a claim across polls: a checkpoint whose outcome is ambiguous (`contention`, or `storage` with an `indeterminate` outcome) leaves the candidate pending under its existing claim and retries on a later poll with the **same** operation identifier, so an already-durable mutation replays instead of duplicating. Renewal exists for exactly this window. If the pass budget ends first, the candidate is reported as failed and its claim is released.

Fencing protects ledger mutations only. It makes no external side effect exactly-once.

### Intake signals are returned, never dispatched

Intake signals are returned in the pass result. The watcher exposes no callback, queue, retry, or transport.

A callback would allow host code to run inside the pass while a claim is held, which reintroduces re-entrancy, partial-failure ambiguity, and a second definition of "delivered". A returned array makes the exactly-once argument mechanical: a candidate's cursor checkpoint is acknowledged as durable before its signal enters the result, so a crash before return loses only signals whose cursors never advanced.

At most one intake signal is emitted per candidate per pass. A signal carries the work-item identifier, the source revision it was derived from, the changed observation kinds, the exact caller-defined phase and status, and token-free claim metadata. It carries no external body, author, credential, claim token, or agent-session content.

Cursors advance even when intake rules do not admit the record. Suppression is an intake decision, not an observation decision; discarding the observation would strand the record until an unrelated event arrived.

### Determinism, ordering, and bounded termination

Candidates are evaluated sequentially in a canonical order derived from the UTF-8 byte ordering of canonical work-item identifiers, independent of input order. The watcher performs no concurrent candidate processing in this decision: parallelism would make seam call order, ledger contention, and reason-code sequences observationally nondeterministic, and the pass is I/O-bound on an injected seam that the host already controls.

The clock is read once per poll and that single reading drives every eligibility, lease, and timestamp decision in the poll. Delays come from an injected delay source. Backoff is `min(base * multiplier^(n-1), max)` truncated to an integer, with no randomness unless an explicit jitter source is injected.

A pass stops at the first of: all candidates resolved, poll budget reached, duration budget reached, or cancellation. Cancellation is observed before each seam call, before each ledger mutation, and between polls; it still releases every acquired claim and still reports every durable outcome already acknowledged.

### Fail-closed partial failure

A candidate failure never aborts the remaining candidates. Only invalid input and seam-contract violations fail the pass before work begins; cancellation and budget exhaustion end the pass while still returning acknowledged outcomes.

Ledger recovery categories (`corrupt-artifact`, `unsupported-schema-version`, `path-boundary`, `unsupported-permissions`, `capacity-exceeded`, `scan-limit`) are surfaced with their stable ledger category and are never repaired, reset, or bypassed. The watcher creates, deletes, or rewrites no ledger artifact except through the ledger's public typed operations.

Seam rejections are converted into a stable per-candidate observation error carrying no transport message, no URL, and no external body.

## Alternatives Considered

### Reuse `AdoReadOnlyControlPlane` as the observation seam

Rejected. It carries comment bodies and authors into a data-minimizing component, lacks cursor semantics, and is co-owned by the feedback loop and team runner, so watcher evolution would drag two unrelated components.

### Random or watcher-generated pass identity

Rejected. Idempotent replay after an ambiguous mutation requires the retry to reproduce the original operation identifiers. A generated identity makes that impossible and silently converts a retry into a duplicate.

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
- Exactly-once intake holds only for ledger-mediated delivery; it makes no claim about external side effects.
- Hosts must supply a stable pass identity and must implement the seam ordering contract; incorrect ordering can re-deliver events.
- Intake rules must be enumerated explicitly, which is more verbose than a wildcard but keeps lifecycle policy outside Sandcastle.
- Claims are short-lived, so a long host-side reaction to a signal runs without watcher-held exclusivity; the host must reacquire if it intends to mutate.
- The watcher adds a second injected ADO-facing seam shape; the two must be kept intentionally separate rather than merged later without a new decision.

## References

- ADR-0021: ADO feedback-loop control-plane boundary
- ADR-0022: ADO agent-team runner boundary
- ADR-0024: DevSquad Sandcastle execution adapter boundary
- ADR-0025: DevSquad/ADO workflow ledger
- `docs/features/devsquad-ado-workflow-watcher/spec.md`
- `docs/features/devsquad-ado-workflow-watcher/plan.md`
