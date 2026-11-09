# Cowork Factory — Implementation Tasks

Implementation follow-through and owned verification are documented in
[handoff.md](./handoff.md). The phase-scoped authority below remains historical;
fake-only checks do not discharge the external integration gates.

## Authority and Scope

Decomposition of the accepted [spec.md](./spec.md) and [plan.md](./plan.md).
This artifact records future implementation work only. Decompose ends after
saving this file: no remote tasks, provider writes, implementation, validation
execution, deployment, or app/agent sessions are authorized by this phase.
Routine autopilot decisions are already accepted; there is no new general
design-approval or LLMLab prerequisite. External proposal publication still
requires the exact host authorization specified in FR-03.

Ownership is limited to `src/CoworkFactory*.ts`,
`src/CoworkMeasuredLoops*.ts`, their associated tests, and feature documentation.
Core owns `MultiProject*.ts`, the actual shared SQLite journal, central exports,
entrypoint wiring, and integration. The peer owns `src/CoworkReviewContract.ts`.
Do not change those owners' files or duplicate their contracts.

## Reasoning Log

- **Inputs:** Accepted spec scenarios 1–5, FR-01–FR-16, C-01–C-11, and the
  plan's six owned modules and dependency checkpoint.
- **Architecture:** Consume one core-owned SQLite `MultiProjectJournal` through
  structural `read(key)` and atomic
  `compareAndSwap(key, expectedVersion, record, event)`. No Cowork ledger,
  filesystem fallback, second journal, or old POSIX ADR rewrite.
- **Safety:** Durable intent precedes a write; only the CAS winner dispatches.
  Uncertain writes remain unresolved without automatic redispatch. This is
  not a provider-side exactly-once guarantee.
- **Evidence:** Host-verified provenance and independent critic callbacks remain
  separate from candidate assertions and provider authorization. Missing,
  stale, mismatched, failed, or inconclusive evidence never becomes a win.
- **Organization:** Tasks are grouped by the five accepted user scenarios.
  The spec assigns no P1/P2/P3 priorities, so none are invented. A foundational
  preview tracer bullet comes first; later prerequisites are explicit.
- **Validation:** Every implementation task includes its own focused offline
  tests. No standalone test tasks, live-provider acceptance, or agent sessions.
- **Decisions:** Preserve accepted defaults of three attempts, two repeats, and
  a 5% minimum speed improvement. Host/evaluation owners supply policies and
  finite bounds; no project mapping, benchmark, production ring, or authority
  is inferred.
- **ADRs:** References below preserve the plan's boundaries. No missing ADR or
  contradiction was identified for this bounded slice; do not manufacture an
  ADR approval task. If implementation reveals a decision conflict, stop the
  affected task. If a behavior lacks a conformance criterion, request a spec
  amendment through `devsquad.refine` rather than extending scope.

## External Prerequisites

These are dependency gates, not assignments to modify central or peer modules.
Record missing inputs as named human actions. Block only dependent operations;
never compensate with fallback storage, weakened checks, or inferred authority.

| Gate | Owner and required evidence                                                                                                                                                                                                                                                           | Blocks                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| G-01 | Core: absent-record/version semantics, CAS conflict/error shape, record/event validation, atomic durable acknowledgment, recovery behavior, and injectable access to the same SQLite journal instance. Core supplies real atomicity/durability and same-instance integration results. | Journal-dependent completion of T-01, T-08, T-10, T-11, T-12, T-13, T-15 |
| G-02 | Peer: available structural `CoworkReviewContract.ts` types compatible with all six separately attributable independent critic stages.                                                                                                                                                 | T-03 and critic-dependent acceptance in T-08                             |
| G-03 | Host: independent evidence verification, exact authorization binding, scoped GitHub/ADO writer capability, sanitized failures, and reconciliation inputs. Verified mappings and consumer authorization are supplied separately for propagation.                                       | Authorized paths in T-09–T-13                                            |
| G-04 | Evaluation owner: freshness, protected checks/metrics, fixed benchmark/evaluator provenance, comparable timing/noise policy, loop deadline, and finite traversal depth/fanout limits.                                                                                                 | Applicable acceptance paths in T-02, T-04–T-08, T-12                     |
| G-05 | Production observation owner: injected read-only observers, first-ring identity, metric window/rule, and attributable recurrence semantics.                                                                                                                                           | Verified/resurfaced paths in T-14–T-15                                   |

Deterministic fakes permit owned behavior to be checked while dependencies are
pending; they do not prove actual SQLite durability, provider capability, or
live production outcomes. Do not mark a dependency-gated task complete from
fake-only evidence.

## Complexity and Scheduling

Sizes are relative implementation units: S = 1, M = 2, L = 3, not elapsed-time
promises. Every task is bounded to one checkable outcome. Split an oversized
task within its scenario before implementation rather than accepting an
unbounded task. `[P]` means parallelizable only after listed prerequisites;
tasks changing the same implementation/test file remain serial.

| Scenario                              | Risk / size                      | Main complexity                                                       | Independently checkable increment                                    |
| ------------------------------------- | -------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------- |
| US-01: Evaluate an engineering signal | Medium / M (2), plus shared T-01 | Stable identities, freshness, revision/provenance rejection           | Equivalent signal fixtures yield one identity; invalid signals block |
| US-02: Establish change evidence      | High / 13 units                  | Independent critics, three evidence gates, persisted execution limits | Offline candidate acceptance and bounded-loop outcomes               |
| US-03: Preview and publish safely     | High / 5 units                   | Frozen authorization, concurrency, interruption, uncertain writes     | Zero unauthorized writes; one fenced invocation with no retry        |
| US-04: Propagate changed contracts    | High / 8 units                   | Exact consumer scope, restart identity, traversal, supersession       | One affected authorized task request; frozen prior work unchanged    |
| US-05: Observe production outcome     | Medium / 4 units                 | Exact lineage and recurrence attribution                              | Read-only classifications and one deduplicated recurrence            |

## Phase 1 — Foundational Tracer Bullet

Shared foundation is traced to US-01 and US-03, not an orphan setup task. The
repository already supplies TypeScript/Vitest tooling; no project initialization,
infrastructure, pipeline, or deployment task is needed for this offline slice.

- [ ] T-01 (M, US-01/US-03) Establish the injected contract and a minimal signal-to-preview tracer bullet in `src/CoworkFactoryContract.ts`, `src/CoworkFactory.ts`, `src/CoworkFactoryContract.test.ts`, and `src/CoworkFactory.test.ts`.
  - **Prerequisites:** G-01 for journal semantics; preserve G-02 peer ownership
    without declaring substitute critic types.
  - **Acceptance:** Structural seams cover journal, clock, evidence verification,
    authorization, and scoped writers without discovering credentials or
    importing live transports. A valid supplied signal produces an attributable
    preview through these seams, not merely a contract compilation test.
    Preview invokes zero writes. No persistence implementation is introduced.
    Missing dependencies/configuration produce named human actions and
    credential/raw-payload-free diagnostics.
  - **Checks:** Minimal C-01/C-06 offline fixtures; record fake seam calls,
    deterministic supplied clock behavior, and zero writer/execution calls.
    Type-check structural compatibility with the supplied core contract.
    Fake CAS commits state/event together and reports conflict distinctly,
    without claiming that the fake verifies SQLite.
  - **Trace:** FR-01, FR-03–FR-04, FR-12, FR-16.

## Phase 2 — US-01: Evaluate an Engineering Signal

- [ ] T-02 (M, US-01) Complete deterministic normalization, identity, and evidence eligibility in `src/CoworkFactory.ts` and `src/CoworkFactory.test.ts`.
  - **Prerequisites:** T-01; G-04 for freshness policy.
  - **Acceptance:** Retain rule identifier/version, source, project, revision,
    observation time, and unit. Equivalent normalized inputs keep a stable
    identity across ordering, repeated evaluation, and restart; distinct
    projects/revisions/sources/rule versions remain distinct. Reject unknown,
    malformed, missing, stale, revision-mismatched, or unverified required
    evidence before dependent acceptance or automatic dispatch.
  - **Checks:** C-01 at T+30 and T+61 with a 60-second policy; permutations,
    duplicate replay/restart, identity separation, malformed/unknown values,
    revision mismatch, and zero dispatch for blocked evidence.
  - **Trace:** FR-01–FR-02, FR-16.

## Phase 3 — US-02: Establish Change Evidence

- [ ] [P] T-03 (M, US-02) Enforce independent, attributable critic assessments in `src/CoworkMeasuredLoops.ts` and `src/CoworkMeasuredLoops.test.ts`.
  - **Prerequisites:** T-01, G-02. Parallel with T-02, not other changes to this
    measured-gate module.
  - **Acceptance:** Consume peer-owned critic types through an injected
    independently supplied callback. Research, design, build, verification,
    review, and change-request-proposal each have separately attributable
    assessments. Validate independence and host-verified provenance; neither
    the candidate's success claim nor critic approval grants write authority.
    Missing, self-assessed, failed, or inconclusive required assessments block
    acceptance and identify the affected stages.
  - **Checks:** C-05 with all six stages, self-assessed review, missing
    verification, failed/inconclusive stages, invalid attribution, and callback
    failure. Scripted callbacks only; no agent sessions.
  - **Trace:** FR-06, FR-16.

- [ ] T-04 (M, US-02) Implement functional comparison acceptance in `src/CoworkMeasuredLoops.ts` and `src/CoworkMeasuredLoops.test.ts`.
  - **Prerequisites:** T-03; G-04 for behavior scope/protected checks.
  - **Acceptance:** For each required repeat, isolated baseline fails the
    declared changed behavior, candidate passes it, and protected regressions
    pass. Record both revisions, scope, environment, results, nonzero test
    count, and nonzero assertion count. Default to two repeats. Unrelated
    coverage, missing repeats, provenance/revision mismatch, and incomplete
    isolation evidence cannot pass.
  - **Checks:** C-02 with two repeats, 3 tests/5 assertions; reject zero tests,
    zero assertions, unrelated coverage, wrong revisions, protected failures,
    baseline success, candidate failure, and one incomplete repeat.
  - **Trace:** FR-07, FR-16.

- [ ] T-05 (M, US-02) Implement measured speed acceptance in `src/CoworkMeasuredLoops.ts` and `src/CoworkMeasuredLoops.test.ts`.
  - **Prerequisites:** T-04; G-04 for protected metrics/comparison/noise policy.
  - **Acceptance:** Compare equivalent workloads, timing conditions, and
    assertion parity across required repeats. Accept only improvement of at
    least 5%, all protected checks passing, and no protected-metric regression.
    Unsupported noise is `inconclusive`, never a win; missing, malformed, or
    incomparable evidence cannot pass.
  - **Checks:** C-03: 100 ms to 94 ms passes; 96 ms fails; exact 95 ms meets
    the boundary when the noise policy supports it. Reject assertion mismatch,
    differing conditions, protected regression, empty/invalid timings, and
    insufficient repeats; unresolved noise remains `inconclusive`.
  - **Trace:** FR-08, FR-16.

- [ ] T-06 (M, US-02) Implement fixed-benchmark document-quality acceptance in `src/CoworkMeasuredLoops.ts` and `src/CoworkMeasuredLoops.test.ts`.
  - **Prerequisites:** T-05; G-04 for benchmark/evaluator configuration.
  - **Acceptance:** Freeze benchmark membership, evaluator identity/version,
    scoring direction, and provenance before comparing revisions. Require
    wins greater than losses, no regression in the bottom `ceil(N × 0.1)`
    mean, and every hard check passing. Empty or missing evidence cannot pass.
  - **Checks:** C-04: 10 cases, 6 wins/3 losses/1 tie, unchanged bottom-one
    mean, all hard checks pass. Reject bottom-one regression, any failed hard
    check, wins equal to losses, changed benchmark/evaluator/provenance,
    missing cases, and empty evidence. Exercise non-multiple-of-ten N and
    scoring-direction handling.
  - **Trace:** FR-09, FR-16.

- [ ] T-07 (M, US-02) Implement bounded improvement decisions and human-action summaries in `src/CoworkMeasuredLoops.ts` and `src/CoworkMeasuredLoops.test.ts`.
  - **Prerequisites:** T-06; G-04 for the configured deadline.
  - **Acceptance:** Apply all applicable evidence gates and required critics;
    inapplicable gates are explicitly scoped, not silently assumed passing.
    Default to three attempts and two repeats. Exhaustion, deadline expiry,
    or unresolved evidence stops further attempts and returns evidence,
    proposals, and named human actions. Invalid/missing required bounds block
    the affected operation. No rollback decision or rollback call is produced.
  - **Checks:** C-08 decision fixtures for three failed attempts/two repeats,
    earlier deadline, accepted candidate, unresolved evidence, missing
    configuration, and exact limit boundaries. C-02–C-05 combined fixtures
    demonstrate that a passing gate cannot hide another required failure.
  - **Trace:** FR-06–FR-10, FR-16.

- [ ] T-08 (L, US-02) Coordinate isolated attempts through injected execution and independent critic callbacks in `src/CoworkMeasuredLoopsExecution.ts` and `src/CoworkMeasuredLoopsExecution.test.ts`.
  - **Prerequisites:** T-01, T-07, G-01–G-02; execution/provenance seams and
    G-04 deadline configuration supplied by the host/evaluation owner.
  - **Acceptance:** Host-approved callbacks supply separate baseline/candidate
    conditions and independently attributable criticism; Cowork does not own
    sessions, task selection, scheduling, shell commands, or sandbox lifecycle.
    Persist attempt/repeat consumption and deadline before execution
    boundaries using the same core journal. Only a successful durable CAS
    claimant consumes and invokes the corresponding execution step.
    Restart cannot reset budgets/deadline or re-execute an unresolved consumed
    step. Missing/inconclusive evidence stops with evidence/proposals/actions.
  - **Checks:** C-08 plus C-07 competing coordinators; scripted execution
    callbacks verify isolation/revision binding and consumption-before-call.
    Interrupt before/after execution and on acknowledgment loss, restart,
    exhaust attempts/repeats, and expire the deadline between steps. Assert
    no additional callback beyond the bound and zero rollback/session calls.
    Actual persistence verification requires G-01 core results.
  - **Trace:** FR-04, FR-06–FR-10, FR-16.

## Phase 4 — US-03: Preview and Publish a Proposal Safely

- [ ] [P] T-09 (M, US-03) Freeze proposal content and exact authorization binding in `src/CoworkFactory.ts` and `src/CoworkFactory.test.ts`.
  - **Prerequisites:** T-02; G-03 for authorized behavior. Parallel with
    measured-loop tasks in their separate modules.
  - **Acceptance:** Preview is the default. Match authorization to frozen
    content, revision, operation, provider/project, and applicable consumer
    scope. Snapshot mutable caller inputs so later mutation cannot alter the
    operation. Changed content cannot reuse older authorization; accepting
    evidence never grants publication authority.
  - **Checks:** C-06 zero-write previews; exact match and mismatches of every
    binding field, caller mutation after freezing, and stale/malformed evidence
    from C-01. All unauthorized cases invoke zero writers.
  - **Trace:** FR-01, FR-03, FR-05, FR-16.

- [ ] T-10 (L, US-03) Fence proposal dispatch and unresolved recovery through the shared journal in `src/CoworkFactory.ts` and `src/CoworkFactory.test.ts`.
  - **Prerequisites:** T-09, G-01, G-03.
  - **Acceptance:** Durably journal proposal identity, authorization reference,
    dispatch intent, and outcome with atomic state/event changes. Dispatch
    only after acknowledged intent durability and only for the CAS winner.
    Stale versions cannot overwrite accepted state. An interrupted/uncertain
    intent or write remains unresolved for host reconciliation, with no
    automatic redispatch; reconciliation itself is not new write authority.
  - **Checks:** C-06 timeout-after-intent and restart invoke once total; C-07
    same-key/same-version race commits exactly one state/event pair and invokes
    at most one writer. Cover failed durability acknowledgment, interruption
    before and after writer invocation, lost outcome acknowledgment, duplicate
    replay, stale versions, corrupt/unusable recovery evidence, and sanitized
    writer failures. No orphan event or overwritten winner in fake contract
    tests; actual SQLite proof remains the G-01 core obligation.
  - **Trace:** FR-03–FR-05, FR-12, FR-16.

## Phase 5 — US-04: Propagate a Changed Producer Contract

- [ ] T-11 (L, US-04) Filter verified impact and request one authorized compatibility task in `src/CoworkFactoryImpact.ts` and `src/CoworkFactoryImpact.test.ts`.
  - **Prerequisites:** T-10, G-01, G-03 verified mappings/consumer authorization.
  - **Acceptance:** Require a verified producer-consumer mapping, applicable
    changed hashes, an accepted upstream revision, and exact trusted consumer
    provider/project authorization. Reuse T-10 dispatch fencing for injected
    GitHub/ADO task requests. Preserve upstream task, change, revision, and
    affected contract links. Identity distinguishes upstream revision,
    contract, consumer, and destination scope across replay/restart.
    Uncertain requests stay unresolved without retry.
  - **Checks:** C-10 A→B, h0→h1, A-7/a1 gives one B request with all links;
    duplicate/restart/timeout replay adds none. Missing authorization,
    unverified mapping, unchanged hashes, unaffected consumers, or wrong
    scope/revision produces zero writes. Parameterize scoped writer fixtures
    for GitHub and ADO without assuming live provider capabilities.
  - **Trace:** FR-03–FR-05, FR-13–FR-14, FR-16.

- [ ] T-12 (L, US-04) Bound traversal with durable visited, depth, and fanout accounting in `src/CoworkFactoryImpact.ts` and `src/CoworkFactoryImpact.test.ts`.
  - **Prerequisites:** T-11; G-01 and G-04 finite propagation limits.
  - **Acceptance:** Detect cycles and track visited propagation identities.
    Persist consumed traversal budgets so restart cannot bypass depth or
    fanout. Reserve dispatch/budget through CAS before requesting work;
    concurrent callers cannot exceed the configured budget. Reaching a limit
    returns a named human action, not silent continuation or inferred scope.
  - **Checks:** C-11 A→B→A terminates; boundary depth/fanout, repeated edges,
    branching graphs, concurrent callers, restart at budget consumption, and
    missing/invalid limits. C-10 unaffected consumers still receive zero
    requests. No endless revisits or write beyond the reserved budget.
  - **Trace:** FR-04–FR-05, FR-13–FR-14, FR-16.

- [ ] T-13 (M, US-04) Record explicit revision supersession without editing frozen tasks in `src/CoworkFactoryImpact.ts` and `src/CoworkFactoryImpact.test.ts`.
  - **Prerequisites:** T-12; G-01, G-03 for any newly authorized request.
  - **Acceptance:** New upstream revisions have distinct propagation identity
    and explicit, separately journaled supersession linked to prior work.
    Preserve frozen running task content and its original revision binding.
    Apply unchanged authorization, dispatch, and traversal limits to any new
    compatibility request; supersession is not permission to rewrite work.
  - **Checks:** C-11 running B task frozen at a1, upstream a2; compare original
    content/revision before and after. Verify separate linked supersession,
    duplicate/restart replay, and zero frozen-task update calls. Uncertain
    prior writes remain unresolved; supersession does not retry them.
  - **Trace:** FR-04–FR-05, FR-14–FR-16.

## Phase 6 — US-05: Observe the Production Outcome

- [ ] [P] T-14 (M, US-05) Classify exact production lineage through read-only observers in `src/CoworkFactoryRelease.ts` and `src/CoworkFactoryRelease.test.ts`.
  - **Prerequisites:** T-01, G-05. Parallel with factory/impact and measured
    modules; no dependency on implementing a deployment or publisher.
  - **Acceptance:** Follow exact merged SHA → build artifact → first configured
    production ring → relevant metric window. Missing deployment/metric
    evidence is `awaiting`; complete passing evidence is `verified`;
    contradictory or unusable evidence is `inconclusive`. Build success alone,
    another SHA, or another ring cannot verify the requested revision.
    Only injected read-only CLI/API-shaped callbacks are exposed; no credential
    discovery, direct live calls, merge, deployment, or rollback authority.
  - **Checks:** C-09 a1/build-7/first-ring/passing-window fixture; wrong SHA,
    wrong/only later ring, missing deployment/metric, invalid window, and
    contradictory lineage. Sanitize observer errors/raw sensitive payloads.
    Recording fakes assert read-only access and zero mutation/execution calls.
  - **Trace:** FR-11–FR-12, FR-16.

- [ ] T-15 (M, US-05) Persist attributable recurrence deduplication in `src/CoworkFactoryRelease.ts` and `src/CoworkFactoryRelease.test.ts`.
  - **Prerequisites:** T-14, G-01, G-05 recurrence semantics.
  - **Acceptance:** Attributable recurrence after exact-lineage verification
    becomes `resurfaced`. Preserve historical verification and deduplicate the
    same recurrence across repeated observations, concurrency, and restart in
    the same journal. Unattributable or contradictory evidence cannot become
    verified/resurfaced. Observation never triggers a production mutation.
  - **Checks:** C-09 verified a1 followed by e1 twice yields one recurrence;
    restart and competing observations add none. Test recurrence before valid
    verification, another revision, missing attribution, unusable evidence,
    CAS conflict, and journal failure. State/event remain paired; actual
    durability needs G-01 proof. Fixture results are labeled offline.
  - **Trace:** FR-04, FR-11–FR-12, FR-16.

## Phase 7 — Documentation and Handoff

- [ ] T-16 (S, US-01–US-05) Document owned API safety and acceptance evidence in `src/CoworkFactoryContract.ts`, `src/CoworkMeasuredLoopsExecution.ts`, `src/CoworkFactoryRelease.ts`, and `docs/features/cowork-factory/tasks.md`.
  - **Prerequisites:** T-02–T-15 and their applicable owner gates.
  - **Acceptance:** Document injected dependencies, exact authorization,
    unresolved-write reconciliation, independent critic ownership, default
    bounds, missing-configuration actions, and the distinction between offline
    fixture classification and live production verification. Record completed
    task checks and outstanding owner evidence here without rewriting the
    accepted spec/plan. Keep central exports/wiring, README/changeset follow-up,
    and real SQLite same-instance integration with the authorized core owner.
  - **Checks:** Review documentation against FR-01–FR-16 and the matrix below;
    no unsupported success claim, extra authority, fallback journal, duplicate
    critic type, or unowned file change. Run formatting/type/public-declaration
    checks during implementation as applicable, not during Decompose.
  - **Trace:** FR-04–FR-06, FR-10–FR-12, FR-16; spec success criteria 1–7.

## Prerequisite Ordering

```text
G-01 → T-01 → T-02 → T-09 → T-10 → T-11 → T-12 → T-13
          ├→ T-03 → T-04 → T-05 → T-06 → T-07 → T-08
          └→ T-14 → T-15
T-02–T-15 + applicable owner gates → T-16
```

The task-level lists also apply: T-03 needs G-02; T-08 needs the same durable
journal and peer contract; publishing/propagation needs G-03; evaluation and
traversal need G-04; release observation needs G-05. No task changing the same
file pair may run concurrently merely because its scenario differs.

## Conformance Coverage

| Criterion                                     | Tasks with embedded acceptance checks                |
| --------------------------------------------- | ---------------------------------------------------- |
| C-01: Normalization and freshness             | T-01, T-02, T-09                                     |
| C-02: Functional evidence                     | T-04, T-07, T-08                                     |
| C-03: Speed gate                              | T-05, T-07, T-08                                     |
| C-04: Document-quality gate                   | T-06, T-07, T-08                                     |
| C-05: Critic independence                     | T-03, T-07, T-08                                     |
| C-06: Preview and uncertain write             | T-01, T-09, T-10                                     |
| C-07: Atomic concurrency                      | T-08, T-10; core G-01 proves actual SQLite semantics |
| C-08: Loop bounds                             | T-07, T-08                                           |
| C-09: Exact production lineage and recurrence | T-14, T-15                                           |
| C-10: Downstream propagation                  | T-11, T-12                                           |
| C-11: Cycles and supersession                 | T-12, T-13                                           |

Cross-cutting FR-16 applies to every task. All observer, writer, critic,
execution, clock, and evidence fixtures are deterministic injections.
Diagnostics must exclude credentials and raw sensitive provider payloads.
No acceptance check discovers credentials or contacts GitHub/ADO, production,
an agent, or a deployment.

## Implementation Validation Commands — Not Executed

Each implementation slice must pass its focused tests before proceeding.
Use the applicable owned test paths, for example:

```text
npm test -- src/CoworkFactory.test.ts
npm test -- src/CoworkMeasuredLoops.test.ts
npm test -- src/CoworkMeasuredLoopsExecution.test.ts
npm test -- src/CoworkFactoryImpact.test.ts
npm test -- src/CoworkFactoryRelease.test.ts
npm test -- src/CoworkFactoryContract.test.ts
npm run typecheck
npx prettier --check "src/CoworkFactory*.ts" "src/CoworkMeasuredLoops*.ts" docs/features/cowork-factory/tasks.md
```

Before implementation handoff, also run `npm test`, `npm run format:check`,
and `npm run build` in the supported environment. Build post-processing includes
`scripts/check-public-types-effect-free.mjs` and POSIX commands; use the
existing Ubuntu/Node 22 CI environment or confirmed Windows compatibility.
Do not start Sandcastle, app sessions, live providers, or deployments.

## Handoff Envelope and Stop

- **Artifact:** `docs/features/cowork-factory/tasks.md`.
- **Accepted basis:** `docs/features/cowork-factory/spec.md` and
  `docs/features/cowork-factory/plan.md`, unchanged.
- **Referenced ADRs:** `docs/adr/0021-ado-feedback-loop-control-plane-boundary.md`,
  `docs/adr/0024-devsquad-sandcastle-execution-adapter-boundary.md`,
  `docs/adr/0025-devsquad-ado-workflow-ledger.md`, and
  `docs/adr/0031-injected-ado-mcp-control-plane-adapter.md`.
  ADR-0025/0031 are Proposed contextual references, not newly accepted
  dependencies or assumed provider capabilities.
- **Assumptions:** One shared core SQLite journal; independently host-verified
  evidence/authorization; peer-owned critic types; host-supplied finite policies,
  execution callbacks, scoped writers, and read-only observers.
- **Outstanding dependencies:** G-01–G-05 require owner-supplied evidence during
  implementation; no dependency is declared satisfied by this decomposition.
- **Coverage:** Five scenarios, sixteen tasks, C-01–C-11 mapped, no standalone
  test tasks, no missing-ADR tasks, and no unowned implementation assignments.
- **Remote state:** No tasks created, linked, assigned, closed, or modified.
- **Next phase:** This artifact is ready for a separately authorized Implement
  phase, starting with T-01 after its dependency alignment. Do not advance
  phases or execute the listed commands as part of this request.

Decompose stops here.
