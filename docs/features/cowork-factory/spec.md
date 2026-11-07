# Cowork Factory Acceptance Specification

## Executive Summary

- **Objective:** Convert attributable engineering signals into bounded, evidence-backed improvement proposals and authorized downstream compatibility tasks.
- **Primary user:** The developer operating Sandcastle through trusted host configuration.
- **Value:** Reproducible change evidence, restart-safe proposal handling, and traceable compatibility and production outcomes without unsupported success claims.
- **Scope:** Signal normalization, independent criticism, measured improvement loops, proposal safety, shared journal integration, downstream propagation, and read-only production outcome observation. Execution, deployment, and live-provider activity are outside this specification phase.
- **Primary success criterion:** Every accepted improvement satisfies its declared evidence gates; every external mutation is authorized and restart-safe; missing or uncertain evidence never becomes a verified outcome.

## Context and Integration Boundaries

Repository terminology follows `CONTEXT.md`: host, agent, sandbox, task, and issue tracker.

Relevant existing boundaries:

- ADR-0021 preserves host control-plane ownership and prohibits feedback helpers from approving or merging pull requests.
- ADR-0024 preserves the one-selected-task execution adapter boundary.
- ADR-0031 and `src/AdoMcpControlPlaneAdapter.ts` establish injected, scoped host transport, distinct read-only/write surfaces, and no retry of uncertain writes.
- `src/AdoMcpControlPlaneAdapter.test.ts` demonstrates deterministic transport fakes. Existing workflow-ledger recovery tests provide adjacent interruption and sanitized-diagnostic coverage.
- ADR-0025 and the existing `DevSquadAdoWorkflowLedger*` filesystem implementation remain unchanged. Their storage mechanism is not the Cowork journal contract.

No `Cowork*` or `MultiProject*` files were found during inspection. Core owns `MultiProject*.ts`, the shared SQLite `MultiProjectJournal`, central exports, entrypoint wiring, and integration. Cowork ownership covers `src/CoworkFactory*.ts`, `src/CoworkMeasuredLoops*.ts`, associated tests, and feature documentation. These are integration boundaries, not evidence that the dependencies already exist.

## Scope

Included:

- Deterministic signal evaluation and deduplication.
- Bounded improvement attempts with independent critic stages.
- Functional, speed, and document-quality evidence gates.
- Preview-default GitHub/ADO proposals and authorized downstream task creation.
- Shared atomic journal persistence and restart recovery.
- Exact revision-to-production evidence correlation through injected read-only seams.

Excluded:

- A separate Cowork persistence ledger or changes to the old POSIX ADR.
- Provider discovery, credential discovery, sandbox-controlled provider authority, or inferred cross-project authorization.
- Automatic merge, deployment, production mutation, or rollback.
- LLMLab dependency or a new general design-approval prerequisite.
- Creating tasks for unaffected consumers or mutating frozen running tasks.
- Live tasks, pull requests, deployments, or agent sessions during acceptance validation.

Approval for an external proposal remains required; it is distinct from a general design-approval or LLMLab gate. Trusted configured host authorization may preauthorize the downstream compatibility operation defined below.

## User Scenarios and Acceptance

### 1. Evaluate an engineering signal

**Given** a signal, rule version, evaluation time, and required configuration,
**when** Cowork evaluates the signal,
**then** it produces the same normalized decision and stable identity for equivalent inputs. Stale, unknown, malformed, or revision-mismatched evidence blocks dependent acceptance and automatic dispatch.

### 2. Establish change evidence

**Given** a baseline revision, candidate revision, declared behavior scope, and protected regression set,
**when** isolated controlled comparisons and independent criticism complete,
**then** Cowork accepts the candidate only when the applicable evidence gates pass. Failure or inconclusive evidence cannot be reported as a win.

### 3. Preview and publish a proposal safely

**Given** a deduplicated proposal,
**when** no matching authorization exists,
**then** Cowork returns a preview without a provider write.

**Given** matching authorization and a durable dispatch record,
**when** a write has an uncertain outcome or execution is interrupted,
**then** recovery does not redispatch that operation and reports the unresolved state for reconciliation.

### 4. Propagate a changed producer contract

**Given** a declared verified producer-consumer mapping from project A to project B, changed contract hashes, and trusted authorization for B,
**when** the upstream revision is accepted for propagation,
**then** Cowork automatically requests one deduplicated compatibility task in B’s configured GitHub/ADO scope, linked to the upstream task, change, and revision.

Unchanged or unaffected consumers receive no task. A new upstream revision uses explicit supersession without rewriting a frozen running task.

### 5. Observe the production outcome

**Given** the exact merged SHA and configured read-only observers,
**when** evidence links that SHA to a build artifact, the first configured production ring, and the relevant metric window,
**then** Cowork reports `awaiting`, `verified`, `resurfaced`, or `inconclusive` according to the evidence. A successful build alone is not a verified production outcome.

## Functional Requirements

| ID    | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-01 | Normalized signals retain rule identifier/version, source, project, revision, observation time, and unit. Freshness is evaluated against the supplied clock and configured policy. Missing or unknown required values block dependent acceptance and automatic dispatch.                                                                                                                                                   |
| FR-02 | Equivalent normalized inputs produce stable deduplication identities across order changes, repeat evaluation, and restart. Distinct projects, revisions, sources, and rule versions cannot be silently conflated.                                                                                                                                                                                                          |
| FR-03 | Proposals default to preview. Dispatch requires authorization matching the frozen proposal content, target provider/project, revision, and operation. Changed content cannot reuse authorization for an older proposal.                                                                                                                                                                                                    |
| FR-04 | Cowork uses the same core-owned SQLite `MultiProjectJournal` through structural `read(key)` and atomic `compareAndSwap(key, expectedVersion, record, event)`. Record and event commit together or neither commits; stale versions cannot overwrite accepted state. No separate Cowork ledger is permitted.                                                                                                                 |
| FR-05 | Proposal identity, authorization reference, dispatch intent, and dispatch outcome are durable journal evidence. Dispatch occurs only after its intent is acknowledged as durable. Concurrent callers cannot both dispatch the same operation. Uncertain or interrupted writes remain unresolved across restart and are never automatically redispatched.                                                                   |
| FR-06 | Research, design, build, verification, review, and change-request-proposal each receive a separately attributable independent critic assessment. Missing, failed, or inconclusive required assessments prevent acceptance; the candidate’s own assertion of success is insufficient.                                                                                                                                       |
| FR-07 | Functional change evidence compares isolated baseline and candidate conditions: the declared behavior fails without the change and passes with it. Evidence records revision, scope, environment, test count, assertion count, and results. Tests and assertions must both exceed zero, cover the changed behavior, and preserve protected regressions. Default repeat count is two.                                       |
| FR-08 | Speed evidence uses comparable baseline/candidate workloads, timing conditions, and assertion parity. Acceptance requires improvement of at least 5%, all protected checks passing, and no protected-metric regression. Noise that prevents a supported comparison produces `inconclusive`, not a win.                                                                                                                     |
| FR-09 | Document-quality evaluation fixes benchmark membership, evaluator identity/version, scoring direction, and provenance before comparing baseline and candidate. For N evaluated cases, wins must exceed losses, the mean score of the bottom `ceil(N × 0.1)` cases must not regress, and every hard check must pass. Empty or missing evidence cannot pass.                                                                 |
| FR-10 | Improvement attempts are bounded, defaulting to three attempts and two repeats. A configured deadline also bounds the loop. Exhaustion, deadline expiry, or unresolved evidence stops further attempts and returns evidence plus a human action list and proposals; it never invokes rollback. Restart cannot reset consumed limits.                                                                                       |
| FR-11 | Outcome evidence links the exact merged SHA to its build artifact, the first configured production ring, and metric outcome. Missing deployment/metric evidence is `awaiting`; complete evidence meeting the declared rule is `verified`; attributable recurrence after verification is `resurfaced`; contradictory or unusable evidence is `inconclusive`. Repeated observations of the same recurrence are deduplicated. |
| FR-12 | Production observers use injected read-only CLI/API seams. Cowork does not discover credentials, call live systems directly, deploy, or claim live production verification from fixtures. Diagnostic outputs exclude credentials and raw sensitive provider payloads.                                                                                                                                                      |
| FR-13 | Automatic downstream compatibility task creation requires a declared verified mapping, applicable changed contract hashes, and trusted configured host authorization for the exact consumer/provider scope. Every task preserves upstream task/change/revision links and affected contract identity. Unaffected consumers receive zero tasks.                                                                              |
| FR-14 | Propagation deduplication distinguishes upstream revision, affected contract, consumer, and destination scope. It survives restart and uncertain writes. Visited tracking, cycle detection, configured depth, and fanout budget bound traversal; reaching a limit returns a human action item rather than silently bypassing the limit.                                                                                    |
| FR-15 | New upstream revisions explicitly supersede prior compatibility work. Frozen running task content and its revision binding remain unchanged; supersession is separately recorded and linked.                                                                                                                                                                                                                               |
| FR-16 | Acceptance uses injected deterministic observers, writers, critics, clocks, and evaluation evidence. It exercises no live GitHub/ADO, production, agent session, or deployment.                                                                                                                                                                                                                                            |

## Conformance Criteria

| ID   | Scenario                    | Input                                                                                                                                                          | Expected Output                                                                                                                                                |
| ---- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-01 | Normalization and freshness | Duplicate signal for project A, revision `a1`, rule `r/v1`, source `s1`, unit `ms`, timestamp T; configured freshness 60 seconds; evaluation at T+30 then T+61 | Equivalent fresh inputs have one stable identity; the stale observation blocks dependent acceptance and dispatch.                                              |
| C-02 | Functional evidence         | Two controlled repeats; baseline fails the changed-behavior assertion; candidate passes; 3 tests and 5 assertions; protected suite passes                      | Evidence gate passes with both revisions and scope recorded. Zero assertions, unrelated coverage, or a protected failure must NOT pass.                        |
| C-03 | Speed gate                  | Comparable repeats: baseline 100 ms, candidate 94 ms; assertion parity; no protected regression; comparison supported by noise policy                          | 6% improvement passes. Candidate 96 ms fails the 5% threshold; unresolved noise is `inconclusive`.                                                             |
| C-04 | Document-quality gate       | Fixed 10-case benchmark and evaluator; 6 wins, 3 losses, 1 tie; bottom-one mean unchanged; all hard checks pass                                                | Quality gate passes. Lower bottom-one score or one failed hard check rejects acceptance despite more wins.                                                     |
| C-05 | Critic independence         | All six stages supplied, but review is self-assessed or verification assessment is missing                                                                     | Acceptance blocked; stages and missing/invalid evidence are identified.                                                                                        |
| C-06 | Preview and uncertain write | Unapproved proposal; then authorized proposal whose injected writer times out after durable intent; restart                                                    | Preview invokes zero writes. Authorized operation invokes once; restart retains unresolved outcome and invokes no second write.                                |
| C-07 | Atomic concurrency          | Two callers use the same key and expected version                                                                                                              | Exactly one state/event pair commits; loser receives conflict. No orphan event, overwritten winner, or duplicate dispatch occurs.                              |
| C-08 | Loop bounds                 | Three failed attempts, two repeats each; separate fixture reaches configured deadline earlier                                                                  | Further attempts stop at the applicable bound; output includes evidence, human actions, and proposals; zero rollback calls.                                    |
| C-09 | Exact production lineage    | SHA `a1` → artifact `build-7` → configured first ring → passing metric window; then attributable recurrence `e1` twice                                         | `verified`, then one `resurfaced` recurrence. Artifact for another SHA or only another ring must NOT verify `a1`.                                              |
| C-10 | Downstream propagation      | Verified A→B mapping, changed contract `h0→h1`, authorized B scope, upstream task `A-7` and revision `a1`; duplicate replay and restart                        | One B compatibility task request with upstream task/change/revision links. Missing authorization, unchanged hash, or unaffected consumer produces zero writes. |
| C-11 | Cycles and supersession     | A→B→A cycle; configured depth/budget; running B task frozen at `a1`; upstream changes to `a2`                                                                  | Traversal remains bounded and does not revisit endlessly; limits are reported; `a2` has explicit supersession evidence without changing the frozen `a1` task.  |

## Invariants

- Unknown evidence is never treated as passing evidence.
- Authorization and evidence remain bound to the exact revision and frozen operation.
- Journal state and its event history cannot diverge after an acknowledged atomic mutation.
- Durable dispatch intent permits at most one dispatch; uncertainty is not permission to retry.
- Duplicate signal, proposal, recurrence, and propagation processing cannot create duplicate external effects.
- Attempt, repeat, deadline, depth, visited, and fanout limits remain effective across restart.
- Observation grants no merge, deployment, rollback, or cross-project write authority.
- Supersession preserves historical evidence and frozen running-task content.

## Success Criteria

1. Every conformance case passes without live-system access.
2. Functional acceptance has nonzero relevant tests and assertions, controlled fail-without/pass-with evidence, and passing protected regressions in every required repeat.
3. Every accepted speed improvement is at least 5%; unsupported timing comparisons are inconclusive.
4. Every accepted document improvement has wins greater than losses, no bottom-decile mean regression, and zero failed hard checks.
5. Concurrency, timeout, duplicate processing, and restart fixtures produce zero duplicate provider writes and zero unauthorized writes.
6. Unaffected consumers receive zero compatibility tasks; affected authorized consumers receive one deduplicated request per propagation identity.
7. Production verification requires the complete exact-SHA lineage; fixture results are never described as live production verification.

## Key Entities

- **Engineering signal:** Attributable observation and deterministic normalized identity.
- **Improvement evidence:** Frozen baseline/candidate comparison, critics, evaluation provenance, and protected outcomes.
- **Proposal:** Frozen authorized-or-preview change request with durable dispatch state.
- **Journal aggregate:** Versioned record and atomically associated event in the shared MultiProject journal.
- **Compatibility propagation:** Verified mapping, contract hashes, upstream links, consumer scope, traversal bounds, and supersession.
- **Production outcome:** Exact merged revision, artifact, first-ring observation, metric window, status, and recurrence identity.

## Configuration and Deferred Decisions

No project-specific mappings, production rings, protected metrics, benchmark, or authorization policy are assumed to exist.

- **Core owner:** Supplies and verifies the shared SQLite journal contract and central integration.
- **Host owner:** Supplies trusted mappings and provider authorization, freshness policy, deadline, and finite propagation limits.
- **Evaluation owner:** Supplies fixed benchmarks/evaluators, protected checks/metrics, comparable timing conditions, and noise policy.
- **Production observation owner:** Supplies first-ring identity, metric acceptance windows, and recurrence semantics.

Missing required configuration blocks only the affected operation and produces a named human action.

[DEFERRED: Exact schemas, canonicalization algorithms, SQLite transaction mechanics, provider reconciliation queries, critic independence enforcement, and public entrypoint shape require planning against the core integration contract.]

## Handoff Boundaries

Referenced ADRs: `0021`, `0024`, `0025`, and `0031`.

Architecture-impacting requirements: shared structural SQLite journal; durable at-most-once dispatch with unresolved outcomes; independent critics; bounded measured loops; authorized cross-project propagation; exact read-only production lineage.

Technical decisions needing explicit treatment: coexistence with ADR-0025 without changing it, atomic journal integration, provider-specific task creation/reconciliation capabilities, propagation identity/supersession, and evidence/noise policies.

Discarded scope: separate Cowork ledger, old POSIX ADR rewrite, new general approval/LLMLab gates, automatic rollback, live production claims from fixtures, and mutation of frozen running tasks.
