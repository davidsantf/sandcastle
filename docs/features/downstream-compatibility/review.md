# Journal integration evidence

This is a verified foundation, not completion of automatic propagation.

## Implemented

The core journal migrates schema 1 to schema 2 transactionally. It retains
original task evidence and adds global namespaced versioned host records,
append-only host events, and append-only hash-chained catalog deltas.

Host CAS requires a live exclusive fence and initialized run. Each transaction
writes record projection and evidence together. Catalog append binds an exact
retained host-record key/version/digest and atomically writes validated tasks,
initial state/events and generation. Original configuration remains immutable;
restart resolves generated tasks without requiring edited configuration.

Separate follow-ups preserve existing reserved intents and scopes.
Existing structural catalog validation still rejects duplicate identities,
unsafe scopes, ambiguous branches/PRs and invalid/cyclic dependencies.

## Actual checks

`npm test -- --reporter=verbose --maxWorkers=2 --testTimeout=30000
src\MultiProjectJournalHost.test.ts src\MultiProject.test.ts`: **58 passed**,
including **15 journal/generation tests**. `npm run typecheck`: passed.
After restoring the negative control, the same 58 tests, typecheck, `npx tsup`
ESM/declaration build, public declaration checker and `git diff --check` passed.

The verbose run confirms every generation case was registered and executed.
An initial fixture accidentally registered nested tests during execution;
test-count inspection exposed it and the fixture was corrected before this
passing result. A new test also used the wrong result property (`states`
instead of `tasks`); typecheck caught it and it was corrected.

Negative controls intentionally fail record-projection and generated-task
insertion. Both retain the previous version/generation and append no orphan
event. Other cases exercise stale fencing, corrupted/missing projections,
append-only mutation rejection, invalid catalogs, changed replay, restart,
retained older evidence, reserved intent preservation and scheduler dispatch
from the original configuration followed by zero replay dispatch.

Temporarily removing only the generation transaction made the focused negative
control fail: it observed one orphan generation instead of zero after failed
task insertion. The transaction was immediately restored before the final
passing checks.

## Remaining boundary

Generic journal records are host-owned JSON, not authorization. A concrete
factory adapter must validate completed publication receipts, independently
verified upstream revision/contract evidence, configured rules, lineage,
budgets, approved destinations and exact downstream acceptance before append.
Issue-backed registration, real configured DevSquad routes, critics/governance,
measured quality loops and release observation are still being integrated.
No live hub write, coding/framework run, merge or deployment was performed.
