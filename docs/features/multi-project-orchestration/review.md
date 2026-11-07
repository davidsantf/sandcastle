# Core orchestration review and verification

## Status

The original catalog-host slice is implemented and locally verified.
The subsequently requested full Cowork behavior is **not yet complete**:
additive review/governance and factory/measured-loop slices await integration
and whole-product verification.

This is execution evidence, not an independent security review or permission
to publish, merge, deploy, or change remote projects.

## Delivered surfaces

| Surface                                                                                     | Files                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Strict catalog, task DAG, literal scopes, authority-free receipts and evidence              | `src/MultiProjectProtocol.ts`                                                                                                                                                                                       |
| Transactional SQLite state, append-only history, leases/fencing and explicit reconciliation | `src/MultiProjectJournal.ts`                                                                                                                                                                                        |
| Conflict-free scheduling, bounded DevSquad lifecycle/repairs and host acceptance            | `src/MultiProjectOrchestrator.ts`                                                                                                                                                                                   |
| Native read-only GitHub/ADO transports, exact source/policy evidence and diagnostics        | `src/MultiProjectHubs.ts`                                                                                                                                                                                           |
| Existing Sandcastle execution, immutable requests, Git branch/scope/baseline verification   | `src/MultiProjectWorker.ts`, `src/MultiProjectHostFactory.ts`                                                                                                                                                       |
| Runnable demonstration, trusted-module entrypoint, CLI and public exports                   | `src/MultiProjectDemo.ts`, `src/MultiProjectEntrypoint.ts`, `src/cli.ts`, `src/index.ts`                                                                                                                            |
| Feature specification, plan/tasks, ADR, usage, discoverable agent and minor changeset       | This directory, `docs/adr/0032-multi-project-orchestration-host.md`, `docs/agents/multi-project-orchestration.md`, `.github/agents/orchestration.agent.md`, `.changeset/durable-multi-project-host.md`, `README.md` |

The worker reuses `run`, structured `Output.object` and named branch strategies:
the same primitives used by the existing DevSquad execution adapter.
The catalog host follows DevSquad's amendable lifecycle; it does not directly
invoke the single-task ADO phase/watcher/ledger or claim that the installed
DevSquad conductor generated these documents.

Piped JSON initially contained the existing terminal cleanup's cursor escape.
`src/terminalCleanup.ts` now emits cursor restoration only to terminal stdout
while still restoring raw stdin. CLI and terminal tests cover this behavior.

## Actual verification

| Check                                                                                                       | Result                                                                                          |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Eight targeted test files, including core, execution-adapter, watcher, ledger, CLI and terminal regressions | **161 passed, 2 skipped**                                                                       |
| Three new core test files                                                                                   | 78 behavior tests, included above                                                               |
| `npm run typecheck`                                                                                         | Passed                                                                                          |
| `npx tsup` ESM and declaration compilation                                                                  | Passed                                                                                          |
| `node scripts\check-public-types-effect-free.mjs`                                                           | Passed; no Effect references in public declarations                                             |
| Compiled public runtime exports and CLI help/options                                                        | Passed                                                                                          |
| Compiled CLI denied-authorization outcome                                                                   | Exit 2, parseable durable `needs-input`, zero dispatch                                          |
| Persistent compiled demonstration, first pass                                                               | Completed three projects, 18 lifecycle reservations, 9 evaluated checks, 42 events              |
| Same demonstration, restart                                                                                 | Completed, zero dispatch, zero reevaluated checks, unchanged 42 events                          |
| Negative-control mutation                                                                                   | Removing the zero-scope guard made its focused test fail; guard restored and final suite passed |

The two skips are pre-existing platform-specific POSIX ledger cases on Windows.
No runtime/dependency manifests changed. Declared dependencies were restored
with `npm ci` after typecheck reported missing `tsgo`; no Python installation
or Polymer build was performed.

The busy shared host caused two default five-second test timeouts during a
parallel rerun. Limiting Vitest workers to two and allowing 30 seconds for the
outer test runner produced the final passing run. Product invocation deadlines,
lease bounds, scope checks and acceptance assertions were not weakened.

The Windows build fixture also initially copied a nested `templates` directory.
That generated duplicate was removed and template contents copied correctly;
the unrelated CLI scaffolding regression then passed.

### Reproduction

```powershell
npx tsup
New-Item -ItemType Directory -Force .\dist\templates | Out-Null
Copy-Item -Path .\src\templates\* -Destination .\dist\templates -Recurse -Force
node .\scripts\check-public-types-effect-free.mjs
npm test -- --reporter=dot --maxWorkers=2 --testTimeout=30000 src\MultiProject.test.ts src\MultiProjectHubs.test.ts src\MultiProjectWorker.test.ts src\DevSquadSandcastleExecutionAdapter.test.ts src\DevSquadAdoWorkflowWatcher.test.ts src\DevSquadAdoWorkflowLedger.test.ts src\cli.test.ts src\terminalCleanup.test.ts
npm run typecheck
node .\dist\main.js orchestrate --demo .\.sandcastle\orchestration-demo
node .\dist\main.js orchestrate --demo .\.sandcastle\orchestration-demo
node .\dist\main.js orchestrate --config .\.sandcastle\orchestration.mjs
```

Use a fresh demo directory for a first-pass reservation count. Reusing a
completed directory deliberately dispatches nothing. The config command needs
a trusted host module, an actual authorized model/provider, registered task PRs
and application-specific host authorization/acceptance controls as described
in the [usage guide](../../agents/multi-project-orchestration.md).

The deliberate negative control was:

```powershell
npm test -- --reporter=dot src\MultiProject.test.ts -t "stops invalid host evidence: zero-scope"
```

With only `evidence.evaluatedScope <= 0` removed, the assertion reported
`expected 'completed' to be 'needs-input'`, exit 1. The condition was restored
immediately before compilation and final verification. No destructive Git
operations or remote writes were used.

## Cowork coverage boundary

Compared with [the article](https://commandline.microsoft.com/how-we-built-copilot-cowork-python-to-rust-migration/):

| Mechanism                                                                                 | Core status and evidence                                                                                                                                  |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spec first: behavior, acceptance, what must not break; amendable artifacts                | Implemented: `spec.md`, protocol receipts and orchestrator lifecycle/history                                                                              |
| Narrow isolated workers; conflict-free task DAG                                           | Implemented: worker `run` wiring, named branches, scope reservations; isolation remains provider-dependent                                                |
| Host-owned identity/policy/authorization/tools/audit                                      | Implemented host seams and exact immutable intent; not an enforced credential-free/network-isolated Cowork container                                      |
| Per-task model routing and different-family critics                                       | Not in core; expanded additive review slice                                                                                                               |
| Fast plus specialized review; blocking/advisory classification                            | One fresh-context review stage only; all core findings block; expanded slice supplies the additional policy                                               |
| Critical human review                                                                     | Required by documented host authorization policy, not a shipped risk classifier/approval-store implementation                                             |
| Non-vacuous checks and known failing fixture                                              | Implemented and mutation-proved for core acceptance; not mandatory per-task fix-removal evidence                                                          |
| Governed repo learning; conflict-resistant registry/generated-file rules                  | Docs/agent/ADR conventions only; expanded governance slice                                                                                                |
| Contract/kit/implementation/binary dependency enforcement and ratchet                     | Task/contract DAG is not an import-layer gate; expanded governance slice                                                                                  |
| Bounded target/non-regression loops                                                       | Core requires nonzero scope and zero regressions; three distinct repairs and repeated-signature stop are intentionally more conservative than the article |
| Deterministic production signal to ticket/candidate                                       | Not in core; expanded factory slice                                                                                                                       |
| Fail-before-fix and revert-fix proof for every change                                     | Not in core; expanded factory slice                                                                                                                       |
| Test-speed target of at least 5% with assertion parity                                    | Not a core acceptance target; expanded measured-loop slice                                                                                                |
| Fixed document tasks: wins over losses, lowest-decile non-regression, no new hard failure | Not a core acceptance target; expanded measured-loop slice                                                                                                |
| Merged commit to release/first-ring signal observation                                    | Not in core; expanded read-only observation slice                                                                                                         |
| Rewrite this runtime in Rust                                                              | Not applicable; the article's migration is a case study                                                                                                   |

This table records the original slice's actual boundary, not a claim that the
newly requested gaps are permanently out of scope.

## Material limits

Live GitHub/ADO credential-dependent API verification and actual coding-agent
execution were **not performed**. Tests exercise injected native API request
contracts/decoders, actual worker wiring through a mock, real temporary Git
repositories, the scheduler/journal, and the compiled fake-only CLI.

Unsupported/missing/truncated policy evidence stays unknown. GitHub code-owner,
last-push and unsupported rules need a trusted adapter; unsupported ADO reviewer
policies and builds that cannot prove exact source SHA do not pass.

Real authorization and measured baseline/contract validation are mandatory
host capabilities. Contract readiness does not deliver producer code or
silently merge a branch; approved dependency delivery and publication remain
external processes.

SQLite assumes trusted owner-controlled local storage and one shared journal
for all coordinated scopes. It does not promise hostile same-user protection,
ACL privacy, reparse-safe opens, network filesystem support or cross-journal
scope exclusion. The existing private POSIX ADO ledger remains unchanged.
Unknown external outcomes retain reservations until host reconciliation.

No PR, push, merge, deployment, remote ticket, cloud provisioning, recurring
automation or new app session was created by this core implementation.
