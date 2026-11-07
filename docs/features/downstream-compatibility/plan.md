# Downstream compatibility plan

## Ownership and integration

The existing core host owns protocol/journal/catalog generations, scheduling,
worker/hub composition, CLI and central exports. The additive signal-quality
slice owns deterministic impact-to-candidate/work-item rules and transports.
The additive review/governance slice owns attested model/framework routing and
critics. Integrate their ready revisions rather than creating competing loops.

## Durable boundaries

Add a trusted-host fenced versioned record store to the existing journal.
A compare-and-swap transaction writes the current record and append-only event
atomically in the same database. Host-owned factory/review adapters validate
their concrete record types; workers receive neither store access nor leases.

Keep the configured base catalog immutable. Atomic append-only generations
contain validated new tasks and causal provenance. Replaying the same causal
operation is idempotent; different content under that identity conflicts.
Scheduling resolves the active generation while still verifying base config
and every retained generation. New task initial projections/events commit in
the same transaction as the generation.

## Propagation and routes

The factory independently verifies upstream source/contract evidence, evaluates
declared consumer rules, applies lineage/depth/budget guards, and reserves hub
creation under the exact approved destination/intent. Completed host receipts
feed generated tasks into the core. Unknown external outcome retains reservation.

Generated tasks have immutable origin, evidence and acceptance references.
New source versions use separate stable follow-up identities; a running task
retains its old version and exclusion until completion/reconciliation.

Issue-backed tasks route through a host-owned registration store. Implement
locally under an authorized route; only independently authorized publication
and a revision-bound change-request registration can establish CI readiness.
Do not treat a ticket ID as a PR or bypass unresolved checks.

Wire actual configured DevSquad phase agents/conductor via a testable host
execution seam, with explicit capability availability and no silent fallback.
Reuse review/governance routing and retain independent critical authorization.

## Verification

Use targeted pure rule, journal, scheduler, provider/route and end-to-end fake
tests. Include negative controls for exact source evidence, duplicate hub
creation, generation transaction rollback, changed replay, stale host fencing,
acceptance contract mismatch and unavailable framework capabilities. Exercise
both directions across providers without live remote writes.

## Implemented integration

`MultiProjectCoworkFactory.ts` adapts factory records and publication receipts
to fenced journal CAS and atomic catalog generations. `MultiProjectCoworkPolicy.ts`
retains contiguous critic/review history and authorization evidence in that same
database. `MultiProjectCoworkDemo.ts` composes these adapters through the public
CLI and executes measured evidence, quality comparison and release observation.

For a later upstream revision, supply an amended trusted mapping with the
previous required digest as `consumedDigest` and the prior full candidate key as
`supersedes`. Reconstruct the configured host rather than mutate snapshotted
routes. The new generation creates a separate task; the prior intent/PR stays
unchanged. Revalidate the retained source and destination before every effect.
Root signal-preparation failures also retain fenced outcome/events while
independent tasks can complete. See `../cowork-integration/review.md`.
