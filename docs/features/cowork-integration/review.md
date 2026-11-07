# Composed Cowork orchestration: integration evidence

## Outcome

The public orchestration host composes the core scheduler, DevSquad executor
route, Cowork critics/governance and signal/impact/measured/release engines.
All task, factory and policy projections and append-only events share the
fenced SQLite journal. The existing production POSIX ADO ledger is unchanged.

The specification and amendable plans/tasks live in
`../multi-project-orchestration/`, `../downstream-compatibility/`,
`../cowork-review/` and `../cowork-factory/`.
Usage and site-specific capability requirements are in
`../../agents/cowork-orchestration.md`.

## Article coverage

| Mechanism                              | Implemented integration and boundary                                                                                                                                                                                                                                 |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spec first; amendments                 | Persisted core and additive specs/plans/tasks; downstream supersession amends trusted rules without rewriting prior worker intent.                                                                                                                                   |
| Narrow isolated workers; routing       | Existing execution/sandbox seam, literal scopes, conflicts and bounded concurrency; actual named DevSquad `--agent` capability route. Isolation guarantees depend on the chosen backend.                                                                             |
| Host authority                         | Independent execution/publication/registration/critical approval and receipt attestation; worker receipts grant no authority or hub access.                                                                                                                          |
| Fast and specialized review            | Fenced complete review history, canonical different-family critics, blocking/advisory taxonomy and critical human gates.                                                                                                                                             |
| Non-vacuous and failing gates          | Required current-revision checks, explicit evaluated scope, invalid instruction/import fixtures, baseline-fails/candidate-passes execution.                                                                                                                          |
| Governed learnings and component rules | Host-collected instruction versions/budgets/negative controls, registry/generated provenance checks and AST contract/kit/implementation/binary dependency gate. These cover supplied classified inventory, not every historical source or semantic runtime behavior. |
| Bounded improvement loops              | Durable attempt/repeated-signature/deadline guards, independent acceptance, protected metrics, >=5% speed with assertion/behavior parity, fixed-document wins/tail/hard checks. Conservative default CI repair limit is three.                                       |
| Signal-to-ticket factory               | Versioned deterministic intake, approved GitHub/ADO publication, cause-bound task append and narrow agent scheduling; reserved/unknown effects cannot automatically retry.                                                                                           |
| Different-family stage critics         | Executed and attested six-stage critic pipeline; aliases cannot supply model-family diversity.                                                                                                                                                                       |
| Release and first-ring observation     | Read-only exact SHA/build/artifact/first production ring/protected metric observation and deduplicated recurrence intake. No merge/deploy operation.                                                                                                                 |

The Rust migration is a case study, not a rewrite requirement.

## Behavioral verification

Final combined command:

```powershell
npm test -- --reporter=dot --maxWorkers=2 --testTimeout=30000 Cowork MultiProject
npm run typecheck
git --no-pager diff --check
```

**18 test files / 338 tests passed**, typecheck passed, whitespace check passed.
This is the relevant suite, not a claim that all unrelated Windows provider tests
pass. Earlier full provider testing exposed five existing session-storage/path
failures outside the changed Copilot route.

The composed factory tests exercise GitHub producer -> ADO consumer and ADO
producer -> GitHub consumer, fan-out with divided global budget, unaffected and
unknown impact, source-item publication -> catalog generation -> agent -> separate
PR registration, exact acceptance, denied authority, cycles, duplicate routes and
stale-fence/event-forgery rejection. A later upstream revision with explicitly
amended mapping/supersession creates a distinct downstream task and PR while the
original catalog intent and PR remain unchanged.

Close/reopen tests retain generated tasks and prevent duplicate publication or
dispatch. A real Node subprocess exits during an uncommitted SQLite record write;
reopen proves transaction rollback, no orphan event and no replay effect.
Generation failure injection also proves atomic task/event/catalog rollback.
Unknown PR publication retains its reservation across restart. Root intake
failure retains fenced evidence/events while independent tasks finish.

Policy integration tests cover history CAS, stale fences, current source and
prerequisite drift, exact executor/critic identity, blocked versus advisory
findings, critical approval, repeated failures and unknown dispatch/audit.
Pure rule tests additionally cover exhausted propagation budgets, lineage loops,
measurement identity/noise/protected metrics, document hard checks and recurrence.

Negative controls include deliberately invalid gates and publication-intent
tampering. Earlier fail-before-fix checks removed only the catalog transaction or
named-agent interpolation: their focused tests failed, then passed after restoring
the behavior. No destructive Git operation was used.

## Distribution and public entrypoint

```powershell
npx tsup
New-Item -ItemType Directory -Force .\dist\templates | Out-Null
Copy-Item -Path .\src\templates\* -Destination .\dist\templates -Recurse -Force
node .\scripts\check-public-types-effect-free.mjs
node .\dist\main.js orchestrate --cowork-demo .\.sandcastle\cowork-demo
node .\dist\main.js orchestrate --cowork-demo .\.sandcastle\cowork-demo
```

ESM/DTS build, public Effect-free declaration check, compiled CLI and a separate
all-source declaration emit passed. The dependency gate uses the compiler API;
TypeScript is now explicitly a runtime dependency. Bundling its CJS initialization
was rejected after the built ESM failed on `__filename`; the external runtime
dependency resolves that distribution failure. The existing lockfile was updated
offline without installing/downloading packages or running install scripts.
The first CLI probe used nonexistent `dist/cli.js`; the actual package executable
is `dist/main.js`, and both corrected invocations passed.

Fresh compiled fixture: **3 completed tasks**, 1 synthetic item, 1 synthetic PR,
15 stage critics, 18 review passes, 12 isolated measurements, 6 quality comparisons,
12 release reads, 54 evaluated checks, 56 core events and 256 host events.
Restart: no new item/PR/critic/review/measurement/comparison; 12 refreshed read-only
release reads, 3 evaluated checks, unchanged 56 core events and 262 host events.

Real configuration invocation:

```powershell
sandcastle orchestrate --config .\.sandcastle\orchestration.mjs
```

That trusted module exports `{catalog, journalPath, host}` and composes the public
executor, policy and factory adapters as documented in the agent guide.
Unavailable framework capabilities fail closed, without a generic DevSquad label.

## Material limitations and authority

The public demo uses real SQLite and production policy engines but **scripted
workers, synthetic hub responses, configured framework identities, fixture
attestations and synthetic timing/document/telemetry data**. It is not a live
DevSquad run or evidence of real performance/release improvement.

Native GitHub issue/ADO work-item JSON mapping is implemented through an injected
transport. Actual credentials, provider mappings, PR publication/attestation and
telemetry translation are site-owned trusted capabilities, not inferred defaults.
No live ticket/PR, push, merge, deployment, cloud provisioning, credential change
or recurring automation was performed or authorized by this implementation.

Host policies are not universal OS/network/credential isolation. Cancellation is
cooperative at custom host seams; existing bounded execution remains responsible
for its worker backend. Unknown external outcomes require independent
receipt-bound reconciliation, not a success-shaped retry.
