# Review and governance integration evidence

## Outcome

Additive implementation is ready for core integration, not whole-product approval.
No scheduler, ledger, CLI, manifest, public exports or shared registry was edited.
No PR, merge, deployment, remote work item, credential change or automation occurred.

## Owned files

| File                                        | Purpose                                                                       |
| ------------------------------------------- | ----------------------------------------------------------------------------- |
| `src/CoworkReviewContract.ts`               | Review and stage critic context/history/audit/host/result types               |
| `src/CoworkReview.ts`                       | Canonical routing, staged reviews and executed stage critics                  |
| `src/CoworkReview.test.ts`                  | Scripted fake-host examples, approval/diversity/revision/uncertainty controls |
| `src/CoworkGovernanceContract.ts`           | Instruction proposal and gate result types                                    |
| `src/CoworkGovernance.ts`                   | Version/scope/size/negative-control/entry/generated proposal checks           |
| `src/CoworkGovernance.test.ts`              | Valid and deliberately invalid instruction fixtures                           |
| `src/CoworkGovernanceDependencies.ts`       | Virtual TypeScript AST/import-resolution role gate                            |
| `src/CoworkGovernanceDependencies.test.ts`  | Real own-module graph, forbidden edges and legacy ratchet                     |
| `docs/features/cowork-review/spec.md`       | Thin spec and acceptance criteria, persisted before code                      |
| `docs/features/cowork-review/plan.md`       | Plan and decomposed local tasks                                               |
| `docs/features/cowork-review/handoff.md`    | This evidence and integration contract                                        |
| `docs/adr/0032-cowork-review-governance.md` | Proposed architecture decision                                                |
| `.changeset/cowork-review-governance.md`    | Minor feature changeset                                                       |

## Verified evidence

`npm run typecheck` passed with the repository's native TypeScript checker.

`npm test -- --reporter=dot src\CoworkReview.test.ts src\CoworkGovernance.test.ts src\CoworkGovernanceDependencies.test.ts`
passed: three test files, sixty tests.

The initial checker failed because dependencies were absent (`tsgo` not found).
`npm ci --ignore-scripts --no-audit --no-fund` restored the existing lockfile
dependencies. No Python/LLMLab or separate Polymer setup was needed.

Purposeful violations fail the production evaluators: implementation-to-implementation
imports/exports/dynamic imports/require/import types, alias-resolved edges, hidden
triple-slash edges, computed/unknown local dependencies, malformed TypeScript,
inline binary logic, duplicate instruction entries, empty scope, wrong version,
oversized instructions, manual generated edits, and a negative control that does
not actually fail. A test reads all five real governed implementation/contract
files and passes their graph without exceptions, then injects a forbidden real
import and confirms failure.

The fake worker test executes fast, spec-wiring, meaningful-tests, operations-docs,
changed-files and compatibility passes. It records frozen requests and durable
audit callback arguments. All four blocking categories stop; advisory findings
are retained without mandatory fix rounds. Critical changes need host human
verification; extra worker approval/risk fields are rejected. Identity attestation,
framework availability, exact revision binding, source drift during execution,
approval and audit, repeated findings, exhausted attempts and uncertain dispatch
are exercised. These are deterministic fake-host tests, **not live framework,
provider, deployment, human approval or storage durability evidence**.

## Core composition

`selectCoworkCritic({stage, author, models, framework, requiredDiversity, unavailable})`
selects only an available exact-framework capability and, when required, a different
canonical family. Registry entries include nonsecret `executor.capabilityId`,
`executor.framework` and `executor.available`. Hosts must attest real configured
phase-agent/conductor capability and actual executed model; differently named
aliases in one family do not satisfy diversity. No runtime subagent model is changed.

`runCoworkReview(context, policy, host, history, signal)` requires host authorization,
execution, provider identity attestation, revision resolution, critical human grant
verification and audit retention. Result states are `ready`, `blocked`, `needs-human`,
`stopped`, `stale` and `unknown`. `ready` is engineering evidence, not permission.
Uncertain invocation/audit remains `unknown`, never a known stop.

`runCoworkStageCritic(request, routing, host, signal)` provides the same configured
executed-identity and revision gate for research, design, build, verification,
review and change-request proposals. Host callbacks are authorize/execute/attest/
resolveRevision/audit. The factory lane can adapt its structural critic callback
through this host wrapper.

Core must retain review history and audit in its one fenced journal database, load
the complete intent history on restart, prevent concurrent history races, and
reverify revision/artifact/contract/risk/policy/human evidence before downstream
effects. `history` is trusted host state, not a worker-supplied allowlist or receipt.
Artifacts/contracts are SHA256; source revisions accept lowercase SHA40/SHA64.
Current/base source and prerequisite hashes still need core's independent validation.

Map only blocking findings into core's current string findings; retain advisory
findings and all structured receipts in host evidence. Treat `unknown` as unresolved
invocation, and other non-ready outcomes as explicit policy blockers. Do not add
approval/risk fields to strict worker receipts.

## Enforced versus advisory

Instruction proposals only evaluate; there is no write/apply operation. Passing
requires actual inventory scope, bounded bytes, incremented versions, one entry per
instruction file, and a control that fails the same checker. Root/component
`AGENTS.md` and `CLAUDE.md` are supported. The host must govern proposed text,
authority changes and generation provenance before any authorized write.
Generated files require regeneration operation plus a provenance digest; the pure
checker validates shape, not that a generator really ran. It never merges registries.

Dependency enforcement applies only to host-supplied classified source inventory.
Contracts depend on contracts; kits on contracts/kits; implementations on contracts/
kits; binaries import and invoke wiring and expose no reusable API or inline
function/control-flow logic. Imported implementation roles are forbidden even
within one component. Unknown local edges and computed imports fail closed.
Exact legacy violation identities may persist only when neither endpoint is
governed; new edges and every governed violation fail. This is a scoped static
ratchet, not a claim that all historical code or external packages conform.
External package topology, runtime reflection/eval, and semantic behavior hidden
behind imported calls are outside this static gate.

The dependency evaluator uses the existing `typescript` compiler API, currently a
development dependency. Before distributing/publicly exporting it, core must
explicitly bundle the compiler or declare its runtime dependency; this slice does
not edit central manifests or assume consumer installations contain dev dependencies.
Core also owns README/public API links and actual provider/framework dispatch:
the existing DevSquad execution adapter rejects reviewers and must not be bypassed.

All host callbacks are trusted in-process capabilities. Cancellation is cooperative;
an ignored signal cannot forcibly terminate a provider. Audit acknowledgement must
mean durable retention in the actual core adapter. No new database/storage scheme
or Windows ledger guarantee is claimed. Existing sandbox providers may carry
credentials/network access. Prompts generated here contain only bounded nonsecret
identifiers, digest references and file IDs; host adapters remain responsible for
credential-free prompt/source selection and for credentials, identity, policy,
approval, execution and audit ownership.
