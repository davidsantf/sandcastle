# Journal integration evidence

The historical foundation evidence below is now complemented by completed
factory/policy integration. Final composed evidence, including both provider
directions, SQLite process-exit recovery and immutable supersession, is in
`../cowork-integration/review.md`.

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

## Explicit framework route integration

`createDevsquadOrchestrationWorker` now selects installed named agents through
the actual Copilot CLI `--agent` flag, using existing bounded `run` execution.
The host must resolve the exact available framework/stage/provider/definition
digest/model-family binding, authorize that immutable capability and independently
attest the actual execution. Missing/denied capabilities do not invoke an agent;
unattested outcomes remain unknown. The host factory accepts this explicit
executor instead of silently constructing a generic worker. Generic prompts no
longer claim to be DevSquad.

Integration tests initially failed for independent `contracts: {}` and qualified
`api:one:api` contract keys. Review and stage critics now accept both, while
requiring valid hashes, nonempty review artifacts and complete changed-file
coverage. Core prerequisite contract checks remain unchanged.

Actual final checks: **32 Copilot factory tests** and **146 combined
core/journal/worker/review/governance tests passed**. Typecheck, ESM/declaration
build, public declaration checker and whitespace checks passed. Removing only
the print command's `--agent` interpolation made the targeted named-agent test
fail; restoring it returned the final checks to green.

Compiled public-export fixture exercised six named phase commands and six
attestations; an unavailable capability dispatched nothing. Its retained script
is the session artifact `files/framework-route-smoke.mjs`, not a production
attestor. The compiled CLI demo completed three independent/integrated fake-hub
tasks with 18 dispatches, 9 checks and 42 events. Restart dispatched zero and
kept 42 events. These are injected fixtures, not a live DevSquad installation run.

The complete `AgentProvider.test.ts` run also exposed five Windows
`sessionStorage` failures outside the changed Copilot provider path (Pi/Codex
session discovery, a POSIX path expectation, and Claude subagent file copies).
Those unrelated areas were not changed. The targeted Copilot suite passes;
this is not a claim that the full provider suite passes on Windows.

## Final integration boundary

Generic journal records are host-owned JSON, not authorization. A concrete
factory adapter validates completed publication receipts, independently
verified upstream revision/contract evidence, configured rules, lineage,
budgets, approved destinations and exact downstream acceptance before append.
Issue-backed registration, fenced critics/governance,
measured quality loops and release observation are integrated in the public
composed host. Exact configured native transport and telemetry mappings,
installed framework identity and independent attestations remain site-owned.
No live hub write, coding/framework run, merge or deployment was performed.
