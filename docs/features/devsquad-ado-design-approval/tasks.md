# DevSquad/ADO Design Approval Tasks

## Status and authorization

- Date: 2026-09-11.
- Slice: 15.
- Status: Decomposition complete; implementation not started.
- Work source: Local `tasks.md` only.
- Planned work: 5 scenario parents and 18 tasks, W048 through W065.
- All task checkboxes remain unchecked.
- Worktree: `C:\repos\copilot-worktrees\sandcastle\agent-team-slice15-loop`.
- Branch: `users/davidsant/agent-team-slice15-loop`.
- Verified HEAD: `e7e46dc76597d2e16782c779e8a8eaa4dd5accca`.
- Predecessor: Slice 14, W039 through W047, finalized according to the conductor. The inspected predecessor task record marks W047 technically complete. Do not redo predecessor work.
- Turn-6 authorization explicitly approves local decomposition and recommended task/traceability creation after successful plan/ADR persistence. The conductor confirms that condition is satisfied. No further routine decomposition confirmation is required.
- This authorization does not start implementation, permit commits or publication, accept ADRs, or satisfy the product human approval gate.
- External issues, assignments, labels, links, comments, and other board actions are not authorized.

### Authoritative artifacts

- [Specification](spec.md).
- [Implementation plan](plan.md), including canonical tuples, normalized offline contracts, bounds, security controls, and static compatibility proof.
- [Proposed ADR-0027](../../adr/0027-devsquad-ado-design-approval-gate.md).
- [ADR-0021](../../adr/0021-ado-feedback-loop-control-plane-boundary.md).
- [ADR-0022](../../adr/0022-ado-agent-team-runner-boundary.md).
- [ADR-0024](../../adr/0024-devsquad-sandcastle-execution-adapter-boundary.md).
- [Proposed ADR-0025](../../adr/0025-devsquad-ado-workflow-ledger.md).
- [Proposed ADR-0026](../../adr/0026-devsquad-ado-workflow-watcher.md).
- [Predecessor tasks](../devsquad-ado-workflow-watcher/tasks.md).
- Root `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`, and `docs/agents/domain.md`.

The repository's authoritative ADR directory is `docs/adr/`. Do not introduce another ADR directory.

Preserve the saved spec, plan, and ADR byte-for-byte during decomposition. Their planning-era next-step text is historical phase provenance, not a request to repeat the approved checkpoint.

### Producer verification provenance

The conductor reports successful persistence and exact normalized producer-hash verification:

| Artifact                                             | Bytes | SHA256                                                             |
| ---------------------------------------------------- | ----: | ------------------------------------------------------------------ |
| `plan.md`                                            | 49117 | `20607E6019746127293746FB28B71A385D4E75C51ADF065D8433A98B95A5EFBB` |
| `docs/adr/0027-devsquad-ado-design-approval-gate.md` | 13315 | `3B13033900291A180CCEE80148F869FFB3DC1EAC754C1AD447AE88BBAD1F5C1D` |

These hashes are inherited verified evidence, not measurements repeated by the decomposition worker.

## Reasoning

### Decisions

| Decision                                              | Applied principle                        | Alternative considered                         | Justification                                                                                            | Confidence |
| ----------------------------------------------------- | ---------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------- |
| Preserve five scenario parents                        | Requirement traceability                 | Organize only by technical layer               | Every task has one primary scenario owner and explicit supporting mappings                               | High       |
| Recommend P1 for every scenario                       | Safety before availability               | Defer uncertainty or authority behavior        | All five scenarios contain mandatory safety requirements; none is optional release scope                 | High       |
| Start with a read-only recovery tracer bullet         | Small independently verifiable increment | Create contracts and harness as separate tasks | Exercises the public entry, injected ledger, bounded validation, and result without enabling publication | High       |
| Use one sequential implementation stream              | Minimize integration ambiguity           | Parallel edits to shared reducers and guards   | Tasks share protocol, history, acknowledgement, and resource-accounting code                             | High       |
| Keep Q1=A and Proposed ADR status                     | Explicit approved boundaries             | Retry policy Q1B or implicit ADR acceptance    | Publication loss is approved; architecture governance remains separate                                   | High       |
| Keep traceability and execution evidence in this file | Scoped local record                      | Additional board or evidence artifacts         | Local tasks are the selected work source; no external IDs are needed                                     | High       |

### Assumptions

- The configured host verifiers are trusted integration components.
- Coordinators use the same explicit canonical host ledger root and namespace.
- Supported ledger durability and trusted-owner filesystem assumptions remain required.
- Immutable host evidence may be unavailable; that condition blocks action rather than authorizing reconstruction or bypass.
- The implementation uses existing TypeScript, Vitest, Node crypto, and ledger contracts without new dependencies.
- Proposed ADRs are available design inputs, not missing ADRs. Implementation conformance and ADR acceptance remain distinct.

### Missing information and constraints

- No unresolved product decision currently requires a spec amendment.
- No additional missing ADR was identified.
- Production host evidence and live transport remain outside this slice.
- The referenced `tasks.instructions.md` was not present at the checked repository or installed-framework instruction path. The loaded decompose guidance supplies the applicable hierarchy, tracer-bullet, integrated-test, and missing-ADR requirements.
- A newly discovered behavior lacking a conformance basis must return through `devsquad.refine`; it must not silently amend the saved design.
- Estimates below are bounded planning estimates, not delivery commitments.

## Parent scenarios and complexity

The `US15-*` names below are local aliases for existing spec scenarios, not external work-item identifiers. P1 is a decomposition recommendation; the specification did not assign explicit priorities.

| Parent  | Existing scenario and acceptance                                                                             | Primary tasks                        | Priority | Risk   |
| ------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------ | -------- | ------ |
| US15-01 | Scenario 1: publish one immutable design and durably record an authorized human resolution without execution | W048 through W054; W062 through W065 | P1       | High   |
| US15-02 | Scenario 2: preserve the consumed attempt through uncertainty, restart, and evidence reconciliation          | W055 through W057                    | P1       | High   |
| US15-03 | Scenario 3: preserve changes requested and require a separately authorized occurrence for revised content    | W058                                 | P1       | Medium |
| US15-04 | Scenario 4: treat both watcher intake forms as provenance, requiring independent current authority           | W059                                 | P1       | Medium |
| US15-05 | Scenario 5: prevent design-approval transfer and block unverified target handoff                             | W060 and W061                        | P1       | High   |

### Known work and risks

| Parent  | Known work and evidence                                                                                                   | Unknown work or implementation risk                                                                      | Impact and control                                                                                  |
| ------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| US15-01 | Plan defines exact identities, rendering, seams, and schema-v1 operation budgets; ledger exposes typed checkpoint results | New original-submission guard; immutable prefix selection; concurrent publication/resolution composition | Supervise side-effect tasks and prove each increment through deterministic public behavior          |
| US15-02 | ADR-0027 fixes loss semantics; ledger test support supplies deterministic clocks and persistence faults                   | Late dependency settlement and aggregate budget accounting; durable write uncertainty                    | Exercise explicit schedules; never infer permission from recovery or timeout                        |
| US15-03 | Two exact commands and a combined durable decision slot are specified                                                     | Revised-design handling must not turn into an automatic replacement-occurrence policy                    | Test original and revised occurrences together; retain explicit host authorization                  |
| US15-04 | ADR-0026 and existing watcher types distinguish comment and discovery intake                                              | Historical provenance can be confused with current capability or revision                                | Use genuine signal shapes and independent current ledger authority; change no watcher contracts     |
| US15-05 | Plan defines target commitments, request challenge, and five-second proof age                                             | Host observation cannot lock a target; current ledger fields cannot prove historical state               | Return descriptive verification only; test stale/mismatched proof and retain host revalidation duty |

### Approaches considered

| Approach                               | Expected effect                                                             | Risk outcome                                                               | Recommendation |
| -------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------- |
| Sequential bounded vertical increments | Early public recovery and publication feedback; independently green commits | Findings remain localized before later effects are enabled                 | Selected       |
| Layer-first parallel implementation    | Potentially faster isolated coding                                          | Defers composition failures and creates shared-guard integration conflicts | Not selected   |

High-risk tasks are supervised implementation work, not autonomous Copilot delegation candidates. No delegation or external assignment is planned.

### Dependency ownership

| Dependency                              | Owner                         | Status                                                               | Delay or failure effect                     |
| --------------------------------------- | ----------------------------- | -------------------------------------------------------------------- | ------------------------------------------- |
| Predecessor completion                  | Conductor                     | Reported finalized; local HEAD and W047 closure inspected            | Do not reopen slice 14                      |
| Proposed architecture and approved spec | Project/conductor             | Available; no acceptance change authorized                           | Conflicts return through refinement         |
| Immutable normalized host witnesses     | Future host integration owner | Offline injected contract available; production integration unproved | Missing evidence blocks the affected action |
| Production Windows ledger support       | Separate platform work        | Existing unsupported-platform gap                                    | No production Windows durability claim      |
| Final implementation entry              | Parent/conductor              | Not granted by decomposition                                         | Stop before W048 execution                  |

## Organization and execution rules

### Ordering

Recommended execution is strictly sequential:

`W048, W049, W050, W051, W052, W053, W054, W055, W056, W057, W058, W059, W060, W061, W062, W063, W064, W065`.

Each task after W048 depends on the preceding task's accepted green increment. Additional semantic dependencies appear in task descriptions. No task is marked `[P]`.

There is no standalone setup, infrastructure, or test-harness task. W048 creates only the fixture support needed for its tracer bullet. No IaC, deployment, telemetry infrastructure, CI redesign, or missing-ADR task is justified by this offline feature.

### Planned file convention

New feature files use the existing flat `src/DevSquad...` convention:

- `src/DevSquadAdoDesignApproval.ts`: public feature contracts and entry points.
- `src/DevSquadAdoDesignApprovalValidation.ts`: bounded structural validation and canonical identity handling.
- `src/DevSquadAdoDesignApprovalHistory.ts`: complete gate-history reduction.
- `src/DevSquadAdoDesignApprovalLedger.ts`: original-submission snapshots and acknowledgement guards.
- `src/DevSquadAdoDesignApprovalPublication.ts`: rendering, reservation, and publication verification.
- `src/DevSquadAdoDesignApprovalDecision.ts`: exact commands, immutable ordered evidence, and resolution.
- `src/DevSquadAdoDesignApprovalTarget.ts`: independent target proof.
- `src/DevSquadAdoDesignApprovalLifecycle.ts`: budgets, deadlines, and continuation retirement.
- `src/DevSquadAdoDesignApprovalTestSupport.ts`: private deterministic test fixtures.

These are planned files, not files already created or guaranteed module boundaries. Merge modules when that produces a smaller coherent implementation without changing observable contracts. Update task path evidence if necessary.

Test files named below are also planned. Their selectors become usable only when those files exist. Existing `vitest.config.ts` includes `src/**/*.test.ts`; `npm test` runs `vitest run`.

Do not modify ledger schema, storage, platform, watcher behavior, execution adapters, or unrelated build scripts. Test fixtures may reuse existing `DevSquadAdoWorkflowLedgerTestSupport.ts` without changing production platform capabilities.

### Per-task TDD and commit discipline

Every implementation task inherits this completion procedure:

1. Record the selected task, baseline identity, relevant conformance IDs, and smallest intended selector.
2. Write behavior-focused RED cases before production changes. Prefer public feature entry points and real public ledger operations with deterministic injected seams.
3. Distinguish import/type/fixture failures from a meaningful behavioral RED.
4. Implement the smallest coherent increment. Never postpone a safety prerequisite of an effect being enabled.
5. Run the focused selector to GREEN, `npm run typecheck`, and affected predecessor/feature regressions.
6. Refactor only while green.
7. Record exact commands, exit codes, RED/GREEN counts, exclusions, platform skips, and limitations in this file.
8. After separate implementation authorization, commit the green task as one coherent Conventional Commit containing its implementation, tests, and evidence. Do not commit knowingly failing intermediate code.
9. Use the local W identifier in the commit subject or body. Do not invent external closing references.
10. Preserve normal hooks. Stage explicit reviewed files only; never use blanket staging of the untracked feature directory or `.memory/`.

The accepted predecessor trailer was inspected in commit `e7e46dc76597d2e16782c779e8a8eaa4dd5accca` and earlier task commits:

`Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>`

Use that exact trailer for future task commits. No commit is performed during decomposition.

W064 and W065 are requested validation/review gates, not separate test-authoring tasks. They consume implementation-attached tests. They must not fabricate a RED failure, an empty commit, or a PASS. Their evidence changes may receive a documentation commit after authorized completion.

### Global acceptance constraints

Every task inherits the saved spec and plan, including:

- Exactly one gate-mediated application-level publication attempt per occurrence.
- Only timely validated direct fresh reservation acceptance can create invocation-local permission; consume it before entering `publishOnce`.
- Zero automatic dependency/checkpoint/publication retries; zero permission from replay, history, restart, uncertainty, cancellation, or late acknowledgement.
- Current independent host authorization and ledger capability for each new mutation.
- Exact revision/state CAS and complete retained history; one combined approval/change-request slot.
- Only same-value phase/status checkpoint patches.
- No claim lifecycle, cursor/reference mutation, schema changes, sidecars, eviction, capacity changes, or lifecycle interpretation.
- Exact entire-comment two-command protocol and canonical occurrence/design operands.
- Independent immutable design/publication/decision evidence.
- No live clients, transport, credentials, agent execution, phase execution, git operations, merge authority, or external board effects inside the feature.
- No bodies, prose, tokens, credentials, session contents, or dependency-controlled errors in durable state or diagnostics.
- Every applicable bound and deadline from the plan, introduced with the corresponding processing/effect.
- Effect-free public declarations and JSDoc for public functions, interfaces, and properties.
- Offline portable fixtures are not production Windows durability evidence.
- An intermediate green task is not complete slice conformance or production certification.

## US15-01: Publish and resolve an immutable design

### W048: Read-only recovery tracer bullet

- [x] **W048** Implement the unreserved recovery tracer bullet in `src/DevSquadAdoDesignApproval.ts`, `src/DevSquadAdoDesignApprovalValidation.ts`, and `src/DevSquadAdoDesignApproval.test.ts`.
  - Parent: US15-01.
  - Dependency: Approved implementation entry and finalized predecessor.
  - Estimate: M, 0.5 to 1 engineer-day. Risk: Medium.
  - Exercise a public `recover` operation against a real seeded public ledger record with no gate reservation.
  - Validate request identity, callable dependencies, cancellation, and bounded record structure before returning truthful `unreserved` state.
  - Introduce deterministic clock/dependency fixtures in `src/DevSquadAdoDesignApprovalTestSupport.ts` only as needed. Reuse existing portable ledger test support.
  - Assert zero checkpoints, publisher calls, claim operations, execution, and tracker calls. Malformed/unreadable records must not become `unreserved`.
  - Do not implement a placeholder that claims reserved-history support. Subsequent history support belongs to W049.
  - RED/GREEN: Valid unreserved recovery, wrong work item, malformed record, pre-aborted invocation, bounded input rejection, dependency throw, and zero-effect spies.
  - Verify: `npm test -- DevSquadAdoDesignApproval.test`; `npm run typecheck`.
  - Traceability: FR-019, FR-021, FR-024, FR-026; CC-14; INV-005, INV-006; SC-006; SEC-006.
  - Suggested commit: `feat(design-gate): add read-only recovery tracer W048`.

### W049: Recover canonical gate history

- [x] **W049** Implement canonical commitment decoding and complete gate-history recovery in `src/DevSquadAdoDesignApprovalValidation.ts`, `src/DevSquadAdoDesignApprovalHistory.ts`, and `src/DevSquadAdoDesignApproval.history.test.ts`.
  - Parent: US15-01.
  - Dependency: W048.
  - Estimate: M, 1 to 1.5 engineer-days. Risk: High.
  - Implement the plan's canonical tuple and `B32` rules without truncating hashes, normalizing opaque strings, or including capability data in `J`.
  - Decode exact `dg15.r/p/a/c` grammars; prove 226/182/226/226 UTF-8 bytes and canonical decode/re-encode equality.
  - Recover reservation, publication, and one combined resolution from complete bounded public histories. Derive `D` from `W,P,A`.
  - Reject malformed reserved namespace entries, unsupported grammar, duplicate/conflicting stages, out-of-order evidence, changed checkpoint state, and mismatched identities.
  - Keep unrelated history unrelated. Current cursor, branch/worktree, and claim metadata must not become historical design evidence.
  - RED/GREEN: Exercise public recovery with exact legal histories and each invalid history family; include numeric/string work-item equivalence, distinct leading-zero identity, malformed Unicode/base64url, exact byte boundaries, and ordinary unrelated checkpoints.
  - Verify: `npm test -- DevSquadAdoDesignApproval.history`; `npm run typecheck`.
  - Traceability: FR-001, FR-002, FR-019 through FR-022, FR-024, FR-025; CC-09, CC-14; INV-003, INV-004, INV-006, INV-007; SC-004; SEC-001, SEC-002, SEC-006.
  - Suggested commit: `feat(design-gate): recover canonical gate history W049`.

### W050: Reserve and invoke publication once

- [x] **W050** Implement the fresh-only publication path in `src/DevSquadAdoDesignApprovalPublication.ts`, `src/DevSquadAdoDesignApprovalLedger.ts`, `src/DevSquadAdoDesignApprovalLifecycle.ts`, and `src/DevSquadAdoDesignApproval.publication.test.ts`.
  - Parent: US15-01; supports US15-02 and US15-04.
  - Dependency: W049.
  - Estimate: L, 1.5 to 2 engineer-days. Risk: High; supervised.
  - Add public `start` composition for one verified design and explicit occurrence. Implement exact manifest validation, immutable design binding, and deterministic rendered publication.
  - Freshly read and reduce complete history; require independent current capability and an exact host mutation grant.
  - Capture independent original request and pre-write record snapshots. Pass a separate copy to the checkpoint dependency.
  - Validate method, fresh replay flag, revision increment, operation identity and `J`, previous/resulting state, timestamps, full history preservation, unpatched fields, owner/fence, inclusive expiry, deadline, and cancellation against the originals.
  - Permit one publisher invocation only after the valid direct fresh acknowledgement; consume permission before entering the publisher.
  - Include the relevant input, record, call, and deadline bounds from first introduction. No later task may supply a missing safety guard for this enabled effect.
  - Missing publication evidence returns a truthful consumed/unverified result; it does not cause retry or imply confirmed publication.
  - RED/GREEN: Exact rendering and both command instructions; missing design witness; stale/expired authority; malformed/direct replay acknowledgements; cancellation before invocation; publisher throw/lost response; reentrant or repeated call; injected request/record mutation.
  - Verify: `npm test -- DevSquadAdoDesignApproval.publication`; `npm run typecheck`.
  - Traceability: FR-001 through FR-008, FR-011, FR-020, FR-023 through FR-026; CC-02, CC-03, CC-10, CC-11, CC-13, CC-14; INV-001, INV-005 through INV-007; SC-002, SC-005, SC-006; SEC-001 through SEC-003, SEC-006.
  - Suggested commit: `feat(design-gate): reserve one publication attempt W050`.

### W051: Confirm independently verified publication

- [x] **W051** Implement matching receipt confirmation and publication-only reconciliation in `src/DevSquadAdoDesignApprovalPublication.ts`, `src/DevSquadAdoDesignApproval.ts`, and `src/DevSquadAdoDesignApproval.receipt.test.ts`.
  - Parent: US15-01; supports US15-02.
  - Dependency: W050.
  - Estimate: M, 1 to 1.5 engineer-days. Risk: High.
  - Verify the exact rendered bytes and normalized publication witness, including target, proposal object/version, authoritative anchor, and attribution to the original reserved attempt.
  - Treat publisher output only as a bounded untrusted hint. Reject bare IDs, success flags, echo-only evidence, wrong bindings, transformed content, and ambiguous matching publications.
  - Persist publication confirmation using a new fresh read, exact host authorization, same-value patch, and original-submission guard.
  - Expose `reconcile` for an existing reservation with zero publisher calls. A certified empty decision remainder can produce publication-confirmed/decision-pending state.
  - RED/GREEN: Matching late receipt; wrong work item/design/target/version/body; ambiguous witness; publication checkpoint uncertainty; readback recovery; no human resolution before confirmed publication.
  - Verify: `npm test -- DevSquadAdoDesignApproval.receipt`; `npm run typecheck`.
  - Traceability: FR-009, FR-010, FR-019, FR-020, FR-024 through FR-026; CC-04, CC-05, CC-14; INV-001, INV-002, INV-007; SC-003, SC-004; SEC-001 through SEC-003, SEC-006.
  - Suggested commit: `feat(design-gate): reconcile verified publication W051`.

### W052: Resolve a complete single-page human decision

- [x] **W052** Implement exact commands, event-bound authorization, and durable resolution in `src/DevSquadAdoDesignApprovalDecision.ts`, `src/DevSquadAdoDesignApprovalLedger.ts`, and `src/DevSquadAdoDesignApproval.decision.test.ts`.
  - Parent: US15-01; supports US15-03.
  - Dependency: W051.
  - Estimate: L, 1.5 to 2 engineer-days. Risk: High; supervised.
  - Implement the exact whole-comment grammar for both supported commands, with canonical operands and exact 112/113-byte command lengths.
  - Establish a complete authoritative single-page prefix after the verified proposal anchor. Compare opaque identifiers only for equality.
  - Require explicit immutable event-specific human permission. Skip explicit denial; never skip an earlier unresolved eligible authorization.
  - Compute the selection commitment and one combined durable approval/change-request slot using fresh state and exact CAS.
  - Return effective approval only after confirmed durable resolution. Changes requested must never authorize implementation.
  - Accept both actions in this increment so selection cannot accidentally skip a valid earlier change request. Noncertifiable prefixes remain blocked, not partially accepted.
  - RED/GREEN: Happy approval; changes requested; denied and unresolved grants; wrong actor/event/action/binding; quoted/prose/malformed/aliased commands; development-only approval; resolution failure; later command cannot overwrite.
  - Verify: `npm test -- DevSquadAdoDesignApproval.decision`; `npm run typecheck`.
  - Traceability: FR-012 through FR-018, FR-020, FR-023 through FR-026; CC-01, CC-06, CC-07, CC-08, CC-12, CC-16; INV-002 through INV-005, INV-007; SC-001, SC-003, SC-006; SEC-003 through SEC-006.
  - Suggested commit: `feat(design-gate): persist authorized human decisions W052`.

### W053: Complete immutable multi-page decision ordering

- [x] **W053** Implement complete-prefix pagination and event-version handling in `src/DevSquadAdoDesignApprovalDecision.ts` and `src/DevSquadAdoDesignApproval.ordering.test.ts`.
  - Parent: US15-01; supports US15-03.
  - Dependency: W052.
  - Estimate: M, 1 to 1.5 engineer-days. Risk: High.
  - Extend public decision processing across certified pages with fixed scope, anchor, stream, snapshot, end ordinal, and exact continuation binding.
  - Reject gaps, overlaps, duplicate events, cursor cycles, inconsistent snapshots, missing earlier versions, and false empty-terminal evidence.
  - Count unrelated, create, edit, and delete events. Evaluate commands introduced by edits at the edit position; retain earlier event-time evidence after deletion or later edits.
  - Permit selection when the complete prefix through the winner is established. Require completeness through snapshot end before reporting no eligible decision.
  - Keep semantic selection identity independent of page partitioning and transport metadata.
  - RED/GREEN: Equivalent differently paged streams; first command across pages; earlier denied versus unresolved candidate; edit/deletion histories; opaque IDs with misleading spelling; terminal and partial-prefix budget exhaustion.
  - Verify: `npm test -- DevSquadAdoDesignApproval.ordering`; `npm run typecheck`.
  - Traceability: FR-014 through FR-016, FR-024 through FR-026; CC-06, CC-07, CC-12, CC-14; INV-004, INV-007; SC-001, SC-003; SEC-003 through SEC-006.
  - Suggested commit: `feat(design-gate): verify complete decision prefixes W053`.

### W054: Preserve original submissions under races

- [x] **W054** Complete adversarial acknowledgement and CAS composition in `src/DevSquadAdoDesignApprovalLedger.ts`, `src/DevSquadAdoDesignApprovalHistory.ts`, and `src/DevSquadAdoDesignApproval.concurrency.test.ts`.
  - Parent: US15-01; supports US15-02 through US15-04.
  - Dependency: W053.
  - Estimate: M, 1 to 1.5 engineer-days. Risk: High.
  - Integrate real public-ledger concurrent reservation and approval/change-request schedules using independently retained original submissions.
  - Preserve exact caller semantics under dependency mutation, later-record responses, changed tokens, changed fences, changed preconditions, and matching-looking history.
  - Demonstrate that nonsecret `J` does not verify capability equality; unchanged operation ID with changed capability remains governed by the ledger's private request digest.
  - Reject mismatched method, accepted revision, timestamps, outcome/history, preserved histories, and unpatched fields.
  - Do not mint a new operation ID or refresh preconditions to evade conflict; do not introduce automatic retries.
  - RED/GREEN: Identical and different concurrent reservations; one shared resolution slot for opposing actions; delayed losing responses; mutable input/response objects; original capability loss; history cannot grant publication permission.
  - This is protocol integration/hardening with attached regressions, not a standalone concurrency-test task.
  - Verify: `npm test -- DevSquadAdoDesignApproval.concurrency`; affected ledger selectors; `npm run typecheck`.
  - Traceability: FR-005 through FR-008, FR-016, FR-018, FR-020, FR-021; CC-11 through CC-14; INV-001, INV-004, INV-006, INV-007; SC-002 through SC-004; SEC-002, SEC-003, SEC-006.
  - Suggested commit: `fix(design-gate): preserve original submission guards W054`.

## US15-02: Preserve consumed attempts through uncertainty

### W055: Recover uncertainty without replay permission

- [x] **W055** Complete interrupted-stage recovery and result classification in `src/DevSquadAdoDesignApproval.ts`, `src/DevSquadAdoDesignApprovalHistory.ts`, and `src/DevSquadAdoDesignApproval.recovery.test.ts`.
  - Parent: US15-02.
  - Dependency: W054; builds on W049 through W051.
  - Estimate: M, 1 to 1.5 engineer-days. Risk: High.
  - Exercise the public crash/reopen tracer: reservation durable, process-equivalent invocation abandoned before publication, fresh recovery sees the consumed attempt and invokes no publisher.
  - Implement the plan's orthogonal durable state, verification status, target handoff, stable reason, binding, and known-revision results.
  - Distinguish reservation uncertainty, consumed attempt, publication uncertainty, unverified evidence, pending decision, durable approval, durable changes requested, and unreadable state.
  - Preserve `start`/`reconcile`/`recover` effect ceilings. Recover is read-only; reconcile never publishes; new missing-stage reconciliation needs current authority.
  - RED/GREEN: Interrupt before/after reservation and publisher invocation; lost receipt; publication/resolution write followed by uncertain response; reopen/readback; original capability unavailable; historical approval with missing external witnesses.
  - Verify: `npm test -- DevSquadAdoDesignApproval.recovery`; `npm run typecheck`.
  - Traceability: FR-006 through FR-010, FR-018 through FR-022; CC-02 through CC-05, CC-09, CC-14; INV-001 through INV-003, INV-007; SC-002 through SC-004; SEC-001, SEC-002, SEC-006.
  - Suggested commit: `feat(design-gate): recover consumed attempt outcomes W055`.

### W056: Enforce aggregate budgets and retire late work

- [x] **W056** Complete cross-stage resource accounting and continuation retirement in `src/DevSquadAdoDesignApprovalLifecycle.ts`, `src/DevSquadAdoDesignApprovalValidation.ts`, and `src/DevSquadAdoDesignApproval.bounds.test.ts`.
  - Parent: US15-02; supports every scenario.
  - Dependency: W055.
  - Estimate: L, 1.5 to 2 engineer-days. Risk: High.
  - Unify previously introduced stage limits into the plan's invocation-wide counters, incremental byte accounting, and retained-payload limits.
  - Enforce all fixed feature ceilings, including records, history visits, simultaneous records, pages, events, witnesses, cursor bytes, and aggregate payload.
  - Prove the start ceiling of 150 dependency calls: 4 reads, 3 checkpoints, 3 mutation grants, 1 design verification, 1 publisher, 1 publication verification, 8 pages, 128 human grants, and 1 current-target verification.
  - Count failed calls; perform zero retries. Use the lesser of remaining invocation time and the per-call deadline.
  - Retire late fulfillment/rejection after timeout or cancellation, clean up owned listeners/timers, and prevent late publication, resolution, or continuation.
  - RED/GREEN: Every plan numeric ceiling at boundary and boundary-plus-one; incremental validation before proportional copy; multibyte/escaped JSON; abort at each awaited boundary; late acknowledgement/publisher/page/grant; whole-invocation expiry.
  - Keep the 180000 ms whole deadline and exact per-call deadlines. Do not claim hard termination of noncooperating dependencies or cancellation of an unsettled ledger write.
  - Verify: `npm test -- DevSquadAdoDesignApproval.bounds`; `npm run typecheck`.
  - Traceability: FR-005 through FR-008, FR-014, FR-019, FR-024 through FR-026; CC-02, CC-03, CC-06, CC-13, CC-14; INV-001, INV-007; SC-002, SC-003, SC-006; SEC-002, SEC-006.
  - Suggested commit: `feat(design-gate): enforce bounded dependency lifecycles W056`.

### W057: Fail closed on storage and evidence exhaustion

- [x] **W057** Integrate capacity, corruption, and privacy failure handling in `src/DevSquadAdoDesignApprovalHistory.ts`, `src/DevSquadAdoDesignApprovalLedger.ts`, and `src/DevSquadAdoDesignApproval.failure.test.ts`.
  - Parent: US15-02; supports every scenario.
  - Dependency: W056.
  - Estimate: M, 1 to 1.5 engineer-days. Risk: High.
  - Propagate stable supported categories for capacity, corrupt highest generation, unsupported schema/platform, malformed public record, and unavailable retained evidence.
  - Preserve the consumed attempt when publication or resolution capacity fails. Reserve no future capacity and perform no eviction, repair, fallback, or schema migration.
  - Verify no gate sidecars, cursor/reference patches, claim lifecycle calls, or private receipt inspection.
  - Scan public results, errors, diagnostics, submitted durable fields, and portable test-ledger artifacts for prohibited sentinels. Capability use in the private invocation-local ledger request is distinct from prohibited output/persistence.
  - RED/GREEN: Capacity before/after reservation; corrupt highest generation with older valid evidence; unsupported schema/platform; malformed and secret-bearing dependency errors; evidence loss after durable approval.
  - Retain existing ledger ceilings: 20000 receipts, 10000 checkpoints, and 16 MiB generation size.
  - Verify: `npm test -- DevSquadAdoDesignApproval.failure`; affected ledger recovery selectors; `npm run typecheck`.
  - Traceability: FR-019 through FR-026; CC-14; INV-002, INV-006, INV-007; SC-003, SC-004, SC-006; SEC-001, SEC-002, SEC-006.
  - Suggested commit: `fix(design-gate): fail closed on exhausted evidence W057`.

## US15-03: Preserve changes requested for revised designs

### W058: Require a new explicitly authorized review

- [x] **W058** Implement revised-design review isolation in `src/DevSquadAdoDesignApproval.ts`, `src/DevSquadAdoDesignApprovalDecision.ts`, and `src/DevSquadAdoDesignApproval.changes.test.ts`.
  - Parent: US15-03.
  - Dependency: W057; requires the shared two-action resolution from W052.
  - Estimate: M, 0.5 to 1 engineer-day. Risk: Medium.
  - Exercise a complete changes-requested tracer and subsequent separately authorized revised-design occurrence.
  - Preserve the original durable resolution under later comments, edits, deletes, replay, and recovery.
  - Reject content or artifact-version changes under the same occurrence. Never transfer an approval or mutation grant to a new design/occurrence.
  - Require explicit host authorization for any new occurrence; never generate one automatically to escape publication uncertainty.
  - RED/GREEN: Original change request remains nonapproving; revised design under old `G` rejected; independent new `G` gets fresh publication and human review; previous approval/grant is ineffective; unresolved original publication causes no automatic replacement.
  - Verify: `npm test -- DevSquadAdoDesignApproval.changes`; `npm run typecheck`.
  - Traceability: FR-001, FR-002, FR-008, FR-012, FR-016 through FR-018; CC-08, CC-09, CC-12, CC-16; INV-001, INV-003 through INV-005, INV-007; SC-002, SC-003; SEC-001 through SEC-005.
  - Suggested commit: `feat(design-gate): isolate revised design reviews W058`.

## US15-04: Require authority independent of intake

### W059: Compose both watcher signals without claim transfer

- [x] **W059** Implement provenance-only watcher intake composition in `src/DevSquadAdoDesignApproval.ts`, `src/DevSquadAdoDesignApprovalValidation.ts`, and `src/DevSquadAdoDesignApproval.authority.test.ts`.
  - Parent: US15-04.
  - Dependency: W058; uses W050 and W054 authority guards.
  - Estimate: M, 0.5 to 1 engineer-day. Risk: Medium.
  - Exercise a public start tracer with existing comment and discovery signal shapes while obtaining authority independently from the host.
  - Accept historical provenance without requiring its revision to equal the fresh current revision. Keep source, checkpoint, cleanup, and current revisions distinct.
  - Reject owner/fence metadata, development approval, and cleanup uncertainty as substitute capabilities.
  - Perform no claim acquire/renew/release/transfer and fabricate no discovery comment.
  - RED/GREEN: Both intake forms with/without current authority; watcher cleanup advanced revision; stale fence; wrong token; inclusive expiry; host authorization binding drift; ordinary cursor checkpoint/renewal does not change design identity.
  - Use existing watcher fixtures/types without changing predecessor semantics or importing the watcher execution graph into production gate code.
  - Verify: `npm test -- DevSquadAdoDesignApproval.authority`; affected watcher/ledger selectors; `npm run typecheck`.
  - Traceability: FR-003 through FR-005, FR-020 through FR-023; CC-10, CC-13, CC-16; INV-005, INV-006; SC-003, SC-006; SEC-002, SEC-003, SEC-006.
  - Suggested commit: `feat(design-gate): separate intake from authority W059`.

## US15-05: Verify immutable design and current target separately

### W060: Return independently verified target metadata

- [x] **W060** Implement initial and current target proof in `src/DevSquadAdoDesignApprovalTarget.ts`, `src/DevSquadAdoDesignApproval.ts`, and `src/DevSquadAdoDesignApproval.target.test.ts`.
  - Parent: US15-05.
  - Dependency: W059.
  - Estimate: M, 1 to 1.5 engineer-days. Risk: High.
  - Exercise a complete bound-target tracer from immutable descriptor verification through durable approval and independent current proof.
  - Recompute the exact target commitment from the original witness and require request/challenge-bound independent observation.
  - Compare repository scope/identity, immutable source/version/content, branch, absolute worktree path/identity, and bound agent/session identity.
  - Return only descriptive target verification metadata. Explicit no-target binding yields `not-bound`; current fields cannot create a missing historical target.
  - RED/GREEN: Valid exact target; missing original/current witness; wrong challenge; each descriptor mismatch; no-target; current ledger fields mimicking historical evidence; historical approval preserved while target handoff is blocked.
  - Verify: `npm test -- DevSquadAdoDesignApproval.target`; `npm run typecheck`.
  - Traceability: FR-001, FR-002, FR-018, FR-019, FR-022 through FR-026; CC-09, CC-15; INV-003, INV-005, INV-007; SC-003, SC-005, SC-006; SEC-001, SEC-003, SEC-006, SEC-007.
  - Suggested commit: `feat(design-gate): verify current target evidence W060`.

### W061: Preserve target freshness at return

- [x] **W061** Complete stale-target and approval-handoff race handling in `src/DevSquadAdoDesignApprovalTarget.ts`, `src/DevSquadAdoDesignApprovalLifecycle.ts`, and `src/DevSquadAdoDesignApproval.target-race.test.ts`.
  - Parent: US15-05.
  - Dependency: W060.
  - Estimate: M, 0.5 to 1 engineer-day. Risk: High.
  - Enforce proof age at most five seconds at return, with the plan's request challenge and current observation binding.
  - Preserve historical durable approval separately from supplied revised content, unavailable evidence, or a changed target.
  - Prevent late proof settlement or cancellation from upgrading handoff after invocation retirement.
  - Return no executable resume instruction, lock, present-day reauthorization, or exactly-once downstream delivery guarantee.
  - RED/GREEN: Exactly five seconds versus over five seconds; mutation between approval and return; delayed proof; changed source/worktree/session; cursor/renewal-only control; no execution spy invoked.
  - Verify: `npm test -- DevSquadAdoDesignApproval.target-race`; `npm run typecheck`.
  - Traceability: FR-018, FR-019, FR-022 through FR-026; CC-09, CC-15; INV-003, INV-005, INV-007; SC-003, SC-005, SC-006; SEC-006, SEC-007.
  - Suggested commit: `fix(design-gate): preserve target proof freshness W061`.

## Shared completion gates owned by US15-01

### W062: Complete the public offline API boundary

- [x] **W062** Align public exports and dependency boundaries in `src/DevSquadAdoDesignApproval.ts`, `src/index.ts`, and `src/DevSquadAdoDesignApproval.dependencies.test.ts`.
  - Parent: US15-01; supports every scenario.
  - Dependency: W061.
  - Estimate: M, 0.5 to 1 engineer-day. Risk: Medium.
  - Complete JSDoc, discriminated result contracts, and intended root exports for start/reconcile/recover.
  - Keep helpers private to their intended module boundary; export no test runtime, private capability snapshot, or reusable publication ticket.
  - Guard all new production modules and their runtime/type import graph, including side-effect, dynamic, and CommonJS import forms.
  - Reject live transport, execution, direct filesystem persistence, and Effect leakage at the feature/public boundary.
  - RED/GREEN: Compile public consumer examples; verify entry-point effect ceilings; seed forbidden-import controls in the guardian; retain existing watcher/ledger public compatibility.
  - Verify: `npm test -- DevSquadAdoDesignApproval.dependencies`; `npm run typecheck`. Run the declaration guard only against freshly generated declarations.
  - Traceability: FR-003, FR-021, FR-023 through FR-026; CC-01, CC-10, CC-15, CC-16; INV-005, INV-006; SC-006; SEC-003, SEC-005, SEC-006.
  - Suggested commit: `feat(design-gate): expose the offline gate API W062`.

### W063: Document the host contract and operational limits

- [x] **W063** Document offline usage and the uncertainty runbook in `README.md`, add the appropriate feature changeset under `.changeset/`, and verify examples in `src/DevSquadAdoDesignApproval.examples.test.ts`.
  - Parent: US15-01; supports every scenario.
  - Dependency: W062.
  - Estimate: M, 0.5 to 1 engineer-day. Risk: Medium.
  - Inspect every existing changeset before adding or extending one. Use package name `@ai-hero/sandcastle` and a minor release entry for this new pre-1.0 feature; do not duplicate predecessor feature entries.
  - Recommended new path, only after duplicate inspection: `.changeset/devsquad-ado-design-approval.md`.
  - Document exact command binding, separate host/verifier/capability authority, start/reconcile/recover effects, permanent publication loss, immutable prefix requirements, budgets, and descriptive target proof.
  - Include an operational runbook for consumed attempts, lost evidence, capacity exhaustion, unsupported platform, and target mismatch. Offer no retry, replacement-occurrence, or approval bypass.
  - Distinguish unsupported production Windows ledger durability from Windows `rm`/`cp` packaging failure.
  - Explain slices 16 through 19 and the absence of a daemon or operational end-to-end host integration.
  - RED/GREEN: Write typed executable offline examples before documentation alignment; verify documented output and command bytes against real feature behavior. Record a truthful documentation check if no behavioral failure is warranted.
  - Verify: `npm test -- DevSquadAdoDesignApproval.examples`; `npm run typecheck`; changed-file formatting.
  - Traceability: FR-008, FR-011, FR-012, FR-017 through FR-019, FR-022 through FR-026; CC-02 through CC-04, CC-07 through CC-09, CC-15, CC-16; SC-005, SC-006; SEC-005 through SEC-007.
  - Suggested commit: `docs(design-gate): explain host review and loss limits W063`.

### W064: Validate the integrated slice

- [ ] **W064** Validate the complete implementation and record exact evidence in `docs/features/devsquad-ado-design-approval/tasks.md`.
  - Parent: US15-01; supports every scenario.
  - Dependency: W063.
  - Estimate: M, 0.5 to 1 engineer-day excluding newly discovered remediation.
  - Run existing implementation-attached tests; do not replace them with a separate conformance test project.
  - Start with focused failures, then run `npm test -- DevSquadAdoDesignApproval DevSquadAdoWorkflowWatcher DevSquadAdoWorkflowLedger`.
  - Retain the predecessor focused history selector: `npm test -- DevSquadAdoWorkflowWatcher.remediation -t "third independent history"`.
  - Run `npm run typecheck`.
  - Run canonical `npm run build`; record fresh ESM and DTS generation separately from postbuild/package outcome. Do not repair unrelated Windows packaging scripts.
  - Run `node scripts/check-public-types-effect-free.mjs` separately against fresh declarations if canonical postbuild did not reach it.
  - Run changed-file Prettier checks and `git diff --check`; record source identity, baseline comparison, test exclusions, and platform limitations.
  - Reconcile every traceability row below with actual tests and evidence. Planned coverage alone is not PASS.
  - No installs unless a separately justified manifest change or missing dependency requires them.
  - Record any global-suite execution separately; scoped success does not establish global-suite, coverage, packaging, remote CI, or production Windows success.
  - Acceptance: Exact attributable evidence exists, no unexplained slice regression remains, and limitations retain their actual severity.
  - Traceability: All FR, CC, INV, SC, and SEC IDs below.
  - Suggested evidence commit: `docs(design-gate): record integrated validation W064`.

### W065: Obtain independent full-slice review

- [ ] **W065** Obtain independent full-slice review and record the implementation checkpoint in `docs/features/devsquad-ado-design-approval/tasks.md`.
  - Parent: US15-01; supports every scenario.
  - Dependency: W064.
  - Estimate: M, 1 to 2 engineer-days for one review round; remediation is not hidden in this estimate.
  - Request independent `devsquad.review` against exact predecessor `e7e46dc76597d2e16782c779e8a8eaa4dd5accca` and the exact implementation head/tree.
  - Cover specification, ADR, code, tests, and security dimensions. Distinguish reviewer execution from static review and inherited implementer results.
  - Include final Advocate, Skeptic, and Architect deep-review perspectives before publication readiness.
  - Preserve each finding's original severity and reviewed identity. Fix findings only through concretely scoped, sized, red-first remediation, then independently re-review changed source.
  - A finding requiring new behavior or an architectural exception returns through `devsquad.refine`. This task does not authorize an unbounded repair.
  - Record existing CI policy and current-head check evidence separately when supplied by the authorized parent. Local absence of checks is not policy proof or CI success.
  - Acceptance: All required reviews have attributable verdicts, no unresolved blocking slice finding remains, and the parent receives a bounded finalization checkpoint. Do not mark complete from implementer self-review.
  - No external board action, PR invocation, push, merge, auth change, ADR acceptance, or later-slice execution belongs to this task.
  - Traceability: All FR, CC, INV, SC, and SEC IDs below.
  - Suggested evidence commit: `docs(design-gate): record independent slice review W065`.

## Exhaustive conformance traceability

Every row is planned coverage, not an executed PASS. W064 validates the complete mapping; W065 independently reviews it.

### Functional requirements

| ID     | Primary implementation tasks                           |
| ------ | ------------------------------------------------------ |
| FR-001 | W049, W050, W058, W060                                 |
| FR-002 | W049, W050, W058, W060                                 |
| FR-003 | W050, W059, W062                                       |
| FR-004 | W050, W059                                             |
| FR-005 | W050, W054, W056, W059                                 |
| FR-006 | W050, W055                                             |
| FR-007 | W050, W054, W055, W056                                 |
| FR-008 | W050, W055, W058, W063                                 |
| FR-009 | W051                                                   |
| FR-010 | W051, W055                                             |
| FR-011 | W050, W063                                             |
| FR-012 | W052, W058, W063                                       |
| FR-013 | W052                                                   |
| FR-014 | W052, W053, W056                                       |
| FR-015 | W052, W053                                             |
| FR-016 | W052, W053, W054, W058                                 |
| FR-017 | W052, W058, W063                                       |
| FR-018 | W052, W054, W055, W060, W061                           |
| FR-019 | W048, W049, W051, W055, W057, W060, W061               |
| FR-020 | W049, W050, W051, W052, W054, W055, W059               |
| FR-021 | W048, W049, W054, W057, W059, W062                     |
| FR-022 | W049, W055, W059, W060, W061                           |
| FR-023 | W050, W052, W059, W060, W061, W062                     |
| FR-024 | W048 through W053, W056, W057, W060, W061              |
| FR-025 | W049 through W053, W056, W057, W062                    |
| FR-026 | W048, W050 through W053, W056, W057, W060 through W063 |

### Conformance criteria

| ID    | Observable evidence owner                                                                                               |
| ----- | ----------------------------------------------------------------------------------------------------------------------- |
| CC-01 | W052: fresh reservation, verified publication, explicit grant, durable approval, zero execution                         |
| CC-02 | W050, W055, W056: crash before publication; restart and late acceptance never create permission                         |
| CC-03 | W050, W055, W056: lost publisher response never causes another invocation                                               |
| CC-04 | W051, W055: verified late receipt reconciles only the original attempt                                                  |
| CC-05 | W051, W055: wrong receipt binding/content/version remains blocked                                                       |
| CC-06 | W052, W053: denied or unresolved authorization produces no unauthorized resolution                                      |
| CC-07 | W052, W053: exact parser and authoritative evidence reject unsupported/ambiguous commands                               |
| CC-08 | W052, W058: durable changes requested never grants implementation authority                                             |
| CC-09 | W049, W058, W060, W061: changed design or target cannot inherit approval                                                |
| CC-10 | W050, W059: neither watcher intake form supplies mutation capability                                                    |
| CC-11 | W050, W054: concurrent/replayed reservations permit at most one publisher invocation                                    |
| CC-12 | W052, W053, W054, W058: first authorized ordered decision occupies one combined durable slot                            |
| CC-13 | W050, W054, W056, W059: inclusive expiry, stale fence, wrong token, and retired permission fail closed                  |
| CC-14 | W048, W049, W051, W053 through W057: missing evidence, malformed acknowledgements, corruption, and capacity fail closed |
| CC-15 | W060, W061: absent/mismatched/stale target proof yields no executable handoff                                           |
| CC-16 | W052, W058, W059: development approval never satisfies the product gate                                                 |

### Invariants

| ID      | Evidence tasks                           |
| ------- | ---------------------------------------- |
| INV-001 | W050, W051, W054 through W056, W058      |
| INV-002 | W051, W052, W055, W057                   |
| INV-003 | W049, W052, W055, W058, W060, W061       |
| INV-004 | W049, W052 through W054, W058            |
| INV-005 | W048, W050, W052, W058 through W062      |
| INV-006 | W048, W049, W050, W054, W057, W059, W062 |
| INV-007 | W049 through W061                        |

### Success criteria

| ID     | Evidence tasks                                                                                |
| ------ | --------------------------------------------------------------------------------------------- |
| SC-001 | All behavioral tasks W048 through W063; integrated verification W064; independent review W065 |
| SC-002 | W050, W054 through W056, W058                                                                 |
| SC-003 | W051 through W061                                                                             |
| SC-004 | W049, W051, W054, W055, W057                                                                  |
| SC-005 | W050, W055, W060, W061, W063                                                                  |
| SC-006 | W048, W050, W052, W056, W057, W059 through W064                                               |

### Architectural security controls

| ID      | Evidence tasks                             |
| ------- | ------------------------------------------ |
| SEC-001 | W049 through W051, W055, W057, W058, W060  |
| SEC-002 | W049 through W051, W054 through W059       |
| SEC-003 | W050 through W054, W058 through W060, W062 |
| SEC-004 | W052, W053, W058                           |
| SEC-005 | W052, W053, W058, W062, W063               |
| SEC-006 | W048 through W057, W059 through W064       |
| SEC-007 | W060, W061, W063                           |

Coverage totals: 26 functional requirements, 16 conformance criteria, 7 invariants, 6 success criteria, and 7 architectural security controls. No uncovered identifier was found in the decomposition mapping.

## Verification commands and evidence discipline

All later commands must explicitly target:

`C:\repos\copilot-worktrees\sandcastle\agent-team-slice15-loop`

Use that directory explicitly in each fresh terminal process. Never rely on the unrelated default worktree.

Examples for later authorized implementation:

    Set-Location -LiteralPath 'C:\repos\copilot-worktrees\sandcastle\agent-team-slice15-loop'
    npm test -- DevSquadAdoDesignApproval.test

    Set-Location -LiteralPath 'C:\repos\copilot-worktrees\sandcastle\agent-team-slice15-loop'
    npm run typecheck

No tests, builds, formatting checks, or implementation commands were run during decomposition.

### Per-task evidence template

Append evidence beneath the completed task:

- Baseline HEAD:
- Implemented files:
- Conformance IDs:
- RED command, exit code, and behavioral failures:
- GREEN command, exit code, and counts:
- Regression commands and outcomes:
- Typecheck:
- Formatting/diff checks:
- Build/declaration evidence, if applicable:
- Platform skips and selector exclusions:
- Remaining limitations:
- Commit SHA and exact coauthor trailer:
- Independent review status, if applicable:

Do not relabel failed historical evidence or count overlapping test selectors as additional unique tests.

## Scope and publication limits

- Plan compatibility is a static proof, not executed conformance.
- Architectural APPROVED_WITH_CONTROLS is not implementation/security certification.
- ADR-0025, ADR-0026, and ADR-0027 remain Proposed.
- Production Windows ledger support and canonical Windows packaging remain distinct existing gaps.
- No portable fixture or successful ESM/DTS generation closes either gap.
- Slice 16 owns the plugin phase runner and Sandcastle delegation.
- Slice 17 owns broader feedback routing.
- Slice 18 owns human-confirmed merge/finalization and pause/resume/cancel/status/audit.
- Slice 19 owns actual host-side ADO MCP transport.
- No daemon or operational end-to-end workflow is delivered by slice 15 alone.
- A later slice cannot start until its predecessor is finalized and published.
- No harness-learning files are authorized.
- `.memory/board-config.md` is untracked and not ignored; never blanket-stage it.
- Final publication, CI-policy inspection involving external systems, PR operations, and merge remain separately authorized parent responsibilities.

## Decomposition verification

Performed:

- Read the saved authoritative spec and complete plan.
- Read ADR-0027 and relevant predecessor architecture.
- Read root/domain guidance, local board configuration, installed decomposition/work-item/reasoning/testing/commit guidance, and predecessor tasks.
- Inspected actual source/test layout, public checkpoint types, ledger test support, dependency guardian precedent, package scripts, Vitest configuration, changeset directory, and declaration-guard path.
- Confirmed W047 as the predecessor's final local task identifier.
- Inspected local task-board git status, HEAD, branch, and predecessor commit messages.
- Confirmed the accepted Copilot App trailer from actual predecessor commits.
- Manually checked all five parent mappings, 18 task IDs, sequential dependencies, and complete conformance coverage.

Observed local git status before artifact delivery:

- Branch `users/davidsant/agent-team-slice15-loop`.
- HEAD `e7e46dc76597d2e16782c779e8a8eaa4dd5accca`.
- Untracked `.memory/`.
- Untracked `docs/adr/0027-devsquad-ado-design-approval-gate.md`.
- Untracked `docs/features/devsquad-ado-design-approval/`.
- No tracked modification reported.

Not performed:

- Independent recomputation of the conductor-supplied plan/ADR hashes.
- Implementation, tests, typecheck, build, formatting execution, or security certification.
- Commits, staging, external board queries/writes, live tracker calls, PR actions, auth changes, publication, merge, or later-phase execution.

## Handoff context

### Relevant artifacts

- This `tasks.md`.
- Saved `spec.md` and `plan.md`.
- Proposed ADR-0027.
- ADR-0021, ADR-0022, ADR-0024, Proposed ADR-0025, and Proposed ADR-0026.
- Root `CLAUDE.md`, `CONTEXT.md`, and `docs/agents/domain.md`.
- Existing public ledger contracts and `src/DevSquadAdoWorkflowLedgerTestSupport.ts`.

### Inherited assumptions

- Q1=A is settled independently of the predecessor watcher-intake loss tradeoff.
- Only direct timely fresh reservation acknowledgement can permit publication.
- Host evidence, capability, lifecycle authorization, and human product approval are separate.
- Immutable ordered prefix evidence and independent current-target proof are required.
- All new tasks are local-only and sequential.
- The saved authoritative artifacts are preserved.

### Pending checkpoints

1. Persist this exact task artifact if delivered through an inline CREATE action, then verify only the intended file was added and the saved spec/plan/ADR remain unchanged.
2. Parent obtains the discrete implementation-entry decision.
3. After implementation entry, execute W048 only as the smallest first increment; establish its RED/GREEN evidence, typecheck, and task commit.
4. Stop at the resulting task checkpoint rather than automatically executing all tasks.
5. W064 and W065 remain mandatory before any separately authorized publication/finalization.

### Discarded information

- Old halted drafts and their claimed watcher-intake authority.
- Five-command protocol.
- Nonmutating publication preparation as a single-attempt guarantee.
- Q1B publication retries.
- Token-derived public `J`.
- Current ledger fields as historical target proof.
- Fictional live ADO/MCP evidence schemas.
- Platform or packaging workarounds within slice 15.

No unresolved material product ambiguity blocks W048 after the parent grants implementation entry.

## Turn-7 implementation authorization and preflight evidence

This section is appended by the implementation orchestrator on 2026-09-11. It does not rewrite the preceding decomposition history.

### Authorization provenance and current state

- The current conductor request explicitly reports turn-7 user approval for actual sequential W048 through W065 implementation, local task/code/evidence writes, and per-task Conventional Commits. Routine implementation-entry and next-task approvals are settled. This supersedes the historical W048-only stopping checkpoint; decomposition itself did not grant implementation authority.
- This orchestrator is assigned W048 through W064. W065 remains reserved for the parent's independent full-slice review. No independent implementation review was performed here.
- No live product approval, ADR acceptance, external board operations, later-slice work, push, PR, merge, auth changes, learning files, or publication is authorized by this record.
- Actual worktree: C:\repos\copilot-worktrees\sandcastle\agent-team-slice15-loop.
- Actual branch: users/davidsant/agent-team-slice15-loop.
- Baseline and current HEAD: e7e46dc76597d2e16782c779e8a8eaa4dd5accca.
- All W048-W065 checkboxes remain unchecked. No feature production/test file was created or modified. No task commit, staging, or Git history write occurred.
- Initial status matched the conductor: only untracked .memory/, ADR-0027, and this feature directory. The only authored change in this invocation is this task-evidence appendix; installed dependencies are ignored generated state.

### Work source and validation

- Loaded installed work-item-workflow and board-config skills. The configured board is local and the work source is local W tasks, not external issue IDs. Applied the tasks.md-only path; no external assignment/state transition or ADO dependency applies.
- Loaded root AGENTS.md/CLAUDE.md, CONTEXT.md and docs/agents/domain.md; installed git-branch/git-commit and reasoning skills. Existing authorized feature branch retained. No remote branch synchronization or .memory write was performed.
- The devsquad.implement.validate worker read the complete tasks/spec/plan, ADR-0027 and relevant predecessor ADRs. It returned High impact, FR-001–FR-026 and CC-01–CC-16 mappings with all INV/SC/SEC supporting controls, and no confirmed spec drift or missing design decision. ADR-0025/0026/0027 remain Proposed.
- Preserved authoritative artifact hashes measured before any authored write: spec.md A20B6AF76DDFE691905D2F53D63CDE5F2107D7CE1290E69CAA016715BFEC2D50; plan.md 20607E6019746127293746FB28B71A385D4E75C51ADF065D8433A98B95A5EFBB; ADR-0027 3B13033900291A180CCEE80148F869FFB3DC1EAC754C1AD447AE88BBAD1F5C1D.

### Executed commands and results

Every CLI command in the orchestrator and workers explicitly selected the authorized worktree with Set-Location before execution. Commands below are the invoked programs after that prefix.

| Command                                                                                    | Exit | Actual result                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------ | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm test (initial attempt)                                                                 | 1    | Runner startup failure: vitest not recognized. No tests executed; no counts available.                                                                                                                                                                            |
| npm ci --no-audit --no-fund                                                                | 0    | Missing-dependency justification verified: node_modules and its vitest shim absent, lockfile present, vitest declared. Installed 507 packages; normal Husky prepare hook ran. No manifest/lock changes.                                                           |
| npm test (after installation)                                                              | 1    | Full baseline executed; output was truncated by the tool. Visible AgentProvider result: 216 tests, 5 failed. This attempt's overall counts are not claimed.                                                                                                       |
| npm test -- --reporter=json                                                                | 1    | Fresh full pre-edit rerun captured in memory through Node spawnSync, no report-file redirection. 2256 tests: 2077 passed, 171 failed, 8 pending/skipped. JSON reports 351 suites: 295 passed, 56 failed, 0 pending; these are suite counts, not test-file counts. |
| npm test -- DevSquadAdoDesignApproval DevSquadAdoWorkflowWatcher DevSquadAdoWorkflowLedger | 0    | 18 test files passed: 13 watcher and 5 ledger files. 732 tests passed, 2 ledger platform skips, 734 total. No design-gate file exists or was selected.                                                                                                            |
| npm test -- DevSquadAdoWorkflowWatcher.remediation -t "third independent history"          | 0    | 1 file passed; 19 tests passed, 244 name-selector exclusions, 263 total. Overlaps the broad targeted run; not additive coverage.                                                                                                                                  |
| npm run typecheck                                                                          | 0    | tsgo --noEmit passed on the predecessor source, before feature implementation.                                                                                                                                                                                    |
| git diff --exit-code -- package.json package-lock.json                                     | 0    | Installation left both files unchanged.                                                                                                                                                                                                                           |

The full JSON baseline reported failed assertions in these 23 files (counts sum to 171): AgentProvider.test.ts 5; cli.test.ts 23; CopyToWorktree.test.ts 3; createSandbox-windowsMounts.test.ts 1; createSandbox.test.ts 15; createWorktree.test.ts 6; interactive-windowsMounts.test.ts 1; interactive.test.ts 4; mountUtils.test.ts 1; Orchestrator.test.ts 10; PromptPreprocessor.test.ts 1; resolveCwd.test.ts 1; run.test.ts 2; SandboxFactory.test.ts 15; SandboxLifecycle.test.ts 10; SessionStore.test.ts 1; startSandbox.test.ts 4; syncIn.test.ts 6; syncOut.test.ts 18; WorktreeManager.test.ts 15; sandboxes/podman.test.ts 26; sandboxes/test-bind-mount.test.ts 1; sandboxes/test-isolated.test.ts 2. Paths are relative to src/.

Representative attributable failures:

- cli.test.ts, “sandcastle CLI shows help with --help flag”: Cannot find module at this worktree's dist/main.js. This is missing generated build output, not evidence of a design-gate regression.
- CopyToWorktree.test.ts, “succeeds when first cp fails but fallback cp -R succeeds”: spawn cp ENOENT, CopyToWorktree.ts:49.
- AgentProvider.test.ts, “pi hostSessionFilePath returns the host-cwd-encoded directory”: Windows backslash path differs from expected POSIX path, AgentProvider.test.ts:2285.
- AgentProvider.test.ts, pi/codex captureToHost cases: session not found at SessionStore.ts:384 and :271. Other session-copy cases fail with ENOENT.
- createSandbox-windowsMounts.test.ts:116: expected Windows path to contain POSIX .sandcastle/worktrees.

Not all 171 failures have been diagnosed as platform-specific. The existing predecessor record explicitly excludes global-suite certification and retains baseline/environment findings. A passing affected selector does not resolve the newly observed full-baseline failures or authorize their repair.

### Decision and blocking handoff

| Decision                                                           | Principle                 | Alternative                               | Evidence and rationale                                                                                                                                  | Confidence |
| ------------------------------------------------------------------ | ------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Install locked missing dependencies only                           | Reproducible verification | Treat missing vitest as a code defect     | Manifest/lock present and node_modules absent; npm ci restored the runner without tracked dependency edits                                              | High       |
| Keep scoped success separate from global baseline failure          | Attributable evidence     | Label all failures known Windows issues   | Scoped 732 passes do not explain every full-suite failure; no feature code exists yet                                                                   | High       |
| Pause before production edits for the failing-baseline disposition | Regression accountability | Silently proceed or repair unrelated code | Full existing suite fails before implementation; parent must explicitly select continuation with recorded preexisting failures or baseline repair first | High       |

Pending decision for the conductor: [C] Continue W048-W064 against the recorded failing global baseline, requiring green affected regressions and preserving exclusions; or [A] abort this implementation attempt and arrange separately scoped baseline repair first. This is a baseline-failure disposition, not another routine task/plan approval. Existing turn-7 sequence authorization and design decisions are preserved.

No behavioral RED/GREEN feature evidence, fresh ESM/DTS generation, canonical build, fresh public declaration guard, coverage measurement, or W064 integrated gate was executed. The documented Windows POSIX postbuild failure was not rerun here; production Windows ledger permissions/directory-sync support remains a separate unchanged gap. No packaging, global-suite, CI, independent review, or production certification is claimed.

No task is completed or committed; therefore no new commit SHA/coauthor exists. Future green task commits retain the required trailer: Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>. W065 remains pending independent parent review after implementation and W064.

### Evidence-file checks

- `npx --no-install prettier --check docs/features/devsquad-ado-design-approval/tasks.md`: exit 1. The preserved decomposition prefix independently fails `prettier.check`; this is not claimed as a new feature-code failure. Only the appended evidence section was formatted using the installed Prettier API; the historical prefix remains unchanged.
- `git diff --check`: exit 0, but applies to tracked differences only and does not inspect this still-untracked task artifact. The index remains empty.
- Final branch and HEAD remained `users/davidsant/agent-team-slice15-loop` / `e7e46dc76597d2e16782c779e8a8eaa4dd5accca`; spec/plan/ADR-0027 hashes were remeasured unchanged after the appendix write.

## Turn-8 execution authorization and baseline disposition

The execution worker received the actual Turn-8 user disposition on 2026-09-11: "Baseline disposition [C] Continue, as recommended and authorized by user's recommended-action autoapproval." This supersedes the historical pending baseline question and W048-only stop text. Execute W048 through W064 sequentially; W065 belongs to the parent's independent review. Development authorization does not accept ADR-0027 or supply product human approval.

Baseline remains e7e46dc76597d2e16782c779e8a8eaa4dd5accca: global JSON run exit 1, 2256 tests, 2077 passed, 171 failed, 8 skipped; 351 suites, 295 passed and 56 failed. The 23-file failing inventory above is retained; not all failures are classified. Accepted affected predecessor baseline: 732 passed, 2 platform skips across 18 files. No new-feature coverage existed. Typecheck passed. Do not rerun the global baseline or repair unrelated failures. Require green affected regressions and per-task typecheck; fresh build/declarations and integrated validation remain W064 obligations.

All execution CLI calls explicitly select the authorized worktree. No LSP tools are exposed; source inspection and compiler diagnostics are the available substitutes. No harness-learning file existed. No manifests, lockfiles, auth, external boards, or .memory files are changed.

### W048 executed evidence

- Baseline: e7e46dc76597d2e16782c779e8a8eaa4dd5accca; Turn-8 continuation disposition above applies.
- Added public read-only recover entry, fixed-field bounded record validation, isolated portable public-ledger fixture, and 13 behavior tests. Structural exemplar: existing watcher public-record guard; no watcher runtime import. FR-019/021/024/026, CC-14, INV-005/006, SC-006, SEC-006.
- RED: npm test -- DevSquadAdoDesignApproval.test, exit 1: 3 assertion failures and 10 passes. A fail-closed interface skeleton returned unreadable instead of unreserved and lacked cancellation/configuration classification; no import/setup failure.
- GREEN: same selector, exit 0: 13 passed, no exclusions/skips.
- npm run typecheck: exit 0.
- Affected regression: npm test -- DevSquadAdoDesignApproval DevSquadAdoWorkflowWatcher DevSquadAdoWorkflowLedger, exit 0: 19 files, 745 passed, 2 existing ledger platform skips. This is 13 new tests plus the accepted 732 predecessor passes, not global-suite certification.
- Changed TypeScript files formatted with local Prettier; git diff --check exit 0. Authoritative spec/plan/ADR hashes remeasured unchanged.
- Reserved namespace histories fail closed until W049; no reserved-history support or publication is claimed. Portable test platform does not establish production Windows durability. Fresh build/declaration validation remains pending W064.
- Commit scope: this evidence and four new W048 TypeScript files; Conventional subject feat(design-gate): add read-only recovery tracer W048. Commit identity is recorded in the next task evidence to avoid self-referential hashes.
- Exact trailer: Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>

### W049 executed evidence

- Passing predecessor task commit W048: 3778a8d22a5f3dfbaf469c5061032789da9b1cb6 (required Copilot App trailer present).
- Complete retained-history reducer, canonical full SHA-256 design derivation and exact dg15 grammar now recover all four stages without recreating publication permission. Gate state and unavailable external witness verification remain separate. FR-001/002/019-022/024/025, CC-09/14, INV-003/004/006/007, SC-004, SEC-001/002/006.
- Setup evidence excluded from RED: first file-generation command had a quoting syntax error and no test file; the next runner found 25 fixture failures because full acquisition metadata was passed to the strict three-field checkpoint authority input. One fixture correction projected ownerId/claimToken/fencingValue, leaving production unchanged.
- Genuine RED: npm test -- DevSquadAdoDesignApproval.history --reporter=dot, exit 1: 9 behavioral assertion failures, 16 passes. Valid durable histories remained unreadable under W048; no setup failure in this run.
- GREEN: npm test -- DevSquadAdoDesignApproval --reporter=dot, exit 0: 38 passed across 2 files (25 W049 plus 13 W048). No exclusions/skips.
- Regression: npm test -- DevSquadAdoDesignApproval DevSquadAdoWorkflowLedger --reporter=dot, exit 0: 7 files, 102 passed, 2 existing platform skips (104 total). Overlapping selectors are not additive.
- npm run typecheck exit 0; changed source/test Prettier write exit 0; git diff --check exit 0.
- Real public ledger checkpoint fixtures prove exact 226/182/226/226 bytes and same-state checkpoints. Malformed grammar, noncanonical encodings, mismatches, duplicate/conflicting stages, missing predecessors, state-changing entries, other occurrences, canonical work-item distinction, and irrelevant current references covered.
- Limits: external witnesses are not reconstructed; history does not prove original capability equality; no publication or new mutation entry is enabled yet. No production platform or global-suite claim.
- Commit scope: API, new history reducer, attached history tests, this evidence. Subject feat(design-gate): recover canonical gate history W049. Exact trailer: Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>.

### W050 executed evidence

- W049 commit: 8fb4348b67de8fddfce3a515101e9a268c684e5f, required Copilot App trailer present.
- Enabled fresh-only start with immutable proposal/manifest validation, exact rendering, independently bound design and mutation grants, host capability, complete-history eligibility and exact CAS. Private original request/pre-write snapshots are separated from adapter inputs. Timely method-specific acknowledgement alone reaches the single publisher call site; repeated/reentrant/concurrent/recovered/late paths do not recreate permission.
- Introduced fixed call ceilings, 180000 ms invocation deadline, 5000 ms ledger/design deadlines, 1000 ms mutation grant deadline, 10000 ms publisher deadline, cooperative cancellation and late-result retirement with the effects. Initial target support is explicit no-target only; bound-target support remains W060. No publication confirmation or human resolution is claimed before W051/W052.
- RED: npm test -- DevSquadAdoDesignApproval.publication --reporter=dot, exit 1: 11 behavioral failures, 9 passes. Start's read-only skeleton neither reserved nor published; fixture setup succeeded.
- Initial GREEN: npm test -- DevSquadAdoDesignApproval --reporter=dot, exit 0: 58 passed across 3 files. Typecheck then found two test-double contextual return discriminator errors; one localized correction parameterized vi.fn with the public dependency signatures. No production correction or test rollback was needed; npm run typecheck then passed.
- Added attached schedules while green: real CAS contenders, reentrant publisher, late durable acknowledgement, adapter mutation of proposal/read record, and exact 32768/32769 UTF-8 byte boundaries. npm test -- DevSquadAdoDesignApproval.publication --reporter=dot: exit 0, 26 passed; npm run typecheck exit 0.
- Final affected regression: npm test -- DevSquadAdoDesignApproval DevSquadAdoWorkflowLedger --reporter=dot, exit 0: 8 files, 128 passed, 2 existing platform skips (130 total; 64 new feature tests plus 64 existing ledger passes). No global rerun or global PASS.
- Changed-file Prettier check and git diff --check: exit 0. No manifest/lock changes, live transport, execution, claim lifecycle, cursor/reference patch or private receipt inspection.
- Conformance: FR-001-008/011/020/023-026; CC-02/03/10/11/13; SEC-001/002/003/005/006. Complete slice validation remains W064 and independent review W065.
- Commit subject: feat(design-gate): reserve one publication attempt W050. Exact trailer: Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>.

### W051 executed evidence

- W050 commit: a694b7e40b7a708b80ac1949f48e1c0783aea3dd, required Copilot App trailer present.
- Added normalized independently verified publication witness, bounded untrusted locator hint, publication commitment, fresh public read/CAS/no-op confirmation checkpoint and reconcile entry with zero publication invocations. Wrong work-item/design/target/envelope/scope, missing immutable version, bare IDs, echo-only flags and ambiguous evidence block confirmation.
- RED: npm test -- DevSquadAdoDesignApproval.receipt --reporter=dot, exit 1: 3 behavioral failures and 10 passes. Valid receipts did not advance start/reconcile and lost write-response recovery was unsupported.
- Initial GREEN: npm test -- DevSquadAdoDesignApproval --reporter=dot, exit 0: 77 passed across 4 files; npm run typecheck exit 0.
- Additional result-integrity RED before task completion: strengthened two existing receipt assertions to require decision-prefix-incomplete before any certified human prefix exists. Receipt selector exit 1: 2 assertion failures, 11 passes. Corrected the premature no-eligible-decision reason in one production edit; the feature makes no empty-prefix claim. Human-page processing remains W052/W053.
- Final GREEN/regression: npm test -- DevSquadAdoDesignApproval DevSquadAdoWorkflowLedger --reporter=dot, exit 0: 9 files, 141 passed, 2 existing platform skips (143 total; 77 feature tests and 64 existing ledger passes). npm run typecheck exit 0; changed TypeScript Prettier write and git diff --check exit 0.
- Real ledger test proves durable publication checkpoint can be recovered after its response throws, with no republish and no leaked dependency sentinel. No human resolution is enabled by this task.
- FR-009/010/019/020/024-026; CC-04/05/14; INV-001/002/007; SC-003/004; SEC-001/002/003/006. Source graph remains offline. Global baseline and platform limitations remain unchanged.
- Commit subject: feat(design-gate): reconcile verified publication W051. Exact trailer: Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>.

### W052 executed evidence

- Baseline c670259; prior W048–W051 preserved. FR-012–018/020/023–026, CC-01/06/07/08/12/16 and mapped INV/SC/SEC controls exercised through public start/reconcile and portable public ledger.
- RED: npm test -- DevSquadAdoDesignApproval.decision --reporter=dot exit 1, 17 behavioral failures (publication stayed pending instead of resolving/classifying decisions); no setup errors.
- GREEN affected regression: npm test -- DevSquadAdoDesignApproval DevSquadAdoWorkflowLedger --reporter=dot exit 0, 158 passed / 2 existing platform skips, 10 files. New decision tests: 17; prior feature 77 and ledger 64 passes preserved.
- npm run typecheck initially reported an overly narrowed action cast; one localized type correction, final exit 0. Changed TS Prettier write and git diff --check exit 0. No runtime test correction required.
- Exact commands, explicit event-bound immutable grants, single complete prefix, combined approval/change slot and durable-only results implemented. Multi-page extension remains W053. No execution or live transport.
- Scope: API, publication continuation, decision reducer, portable fixture and attached tests plus this evidence. Learning disposition N already supplied; no learning files/prompts. No global/build/production durability claim.
- Commit: feat(design-gate): persist authorized human decisions W052. Trailer: Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>.

### W053 executed evidence

- Baseline W052 c97c28c. FR-014–016/024–026, CC-06/07/12/14; immutable prefix controls SEC-003–006.
- RED: npm test -- DevSquadAdoDesignApproval.ordering --reporter=dot exit 1: 6 behavioral failures / 8 passes. Single-page implementation blocked valid multi-page decisions.
- GREEN: npm test -- DevSquadAdoDesignApproval DevSquadAdoWorkflowLedger --reporter=dot exit 0: 172 passed / 2 existing platform skips, 11 files. New ordering file 14 tests; no exclusions. npm run typecheck exit 0.
- Fixed snapshot/cursor/anchor binding, contiguous ordinals, duplicate/cycle/gap/overlap rejection, event-version chains, denied versus unresolved authorization and page-independent semantic commitment integrated. Selection can stop at certified winner; empty/no-command result requires terminal completeness.
- Changed TS Prettier write and git diff --check pass. No global suite or production platform claim. Scope: decision reducer, ordering tests, task evidence.
- Commit: feat(design-gate): verify complete decision prefixes W053. Trailer: Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>.

### W054 executed evidence

- Baseline W053 7f2db82. FR-005–008/016/018/020/021, CC-11–14, original-submission and replay controls.
- RED: npm test -- DevSquadAdoDesignApproval.concurrency --reporter=dot exit 1, 1 behavioral failure / 13 passes: real ledger revision conflict was incorrectly collapsed into unknown reservation outcome.
- GREEN affected selector npm test -- DevSquadAdoDesignApproval DevSquadAdoWorkflowLedger --reporter=dot exit 0, 186 passed / 2 existing skips across 12 files. W054 adds 14 tests. Typecheck exit 0; changed TS formatting and diff check pass.
- Real identical/different reservation races, opposing resolution CAS, nine acknowledgement mutation families, and same-J/changed-token private ledger digest rejection covered. No retries, rebase, new IDs, or permission from history. Stable exact CAS failure categories retained without exposing errors.
- Scope: original-submission ledger guard, API reason types, publication/decision call sites, concurrency tests, evidence. No ledger schema/storage changes. Portable tests do not certify production Windows durability.
- Commit: fix(design-gate): preserve original submission guards W054. Trailer: Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>.

### W055 executed evidence

- Baseline W054 45a7097. FR-006–010/018–022, CC-02–05/09/14 and mapped recovery invariants.
- RED: npm test -- DevSquadAdoDesignApproval.recovery --reporter=dot exit 1, 5 behavioral failures: missing known accepted checkpoint revision evidence.
- GREEN affected selector npm test -- DevSquadAdoDesignApproval DevSquadAdoWorkflowLedger --reporter=dot exit 0: 191 passed / 2 existing platform skips, 13 files. New recovery file 5 tests. Typecheck first caught one untyped test callback; explicit public input annotation corrected it; final exit 0.
- Public crash/reopen schedules cover durable reservation/publication/resolution with lost acknowledgements, missing original capability/witnesses, and original receipt reconciliation after publisher response loss. Recover reports retained stage revisions separately from latest record revision and never creates permission. Start/reconcile preserve observed historical resolution under intervening reads.
- Prettier and diff checks pass. Scope: API, history projection, stage result composition, attached tests, evidence. No global, packaging or production platform claim.
- Commit: feat(design-gate): recover consumed attempt outcomes W055. Trailer: Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>.

### W056 executed evidence

- Baseline W055 82e5d20. FR-005–008/014/019/024–026 and SEC-002/006 liveness/bounds controls.
- RED: npm test -- DevSquadAdoDesignApproval.bounds --reporter=dot exit 1: 2 failures / 14 passes. Late monotonic response was accepted before timer dispatch, and malformed scalar invoked dependency toJSON before rejection. Both are now guarded at root cause.
- GREEN affected selector npm test -- DevSquadAdoDesignApproval DevSquadAdoWorkflowLedger --reporter=dot exit 0: 219 passed / 2 existing skips, 14 files. Bounds file expanded to 28 tests. Final feature-only regression after in-place acknowledgement comparison: 155 passed in 9 files; npm run typecheck exit 0.
- Call ceilings sum exactly 150 (4+3+3+1+1+1+8+128+1); every failed call consumes budget. Integrated 8-page/128-human path passes; ninth-page path stops with dependency-limit and no resolution. Whole/per-call monotonic deadlines, timer expiry, cancellation across six seams, late page/human/publisher settlement and predecessor late reservation acknowledgement are exercised.
- Incremental fixed-field projection now rejects nonprimitive scalars before serialization; aggregate record/byte/history-pass counters enforce 7 / 112 MiB / 210000 visits. Acknowledgement compares originals in place rather than constructing a third full record. Recovery shares the bounded lifecycle.
- Boundary coverage includes reviewed multibyte bytes (prior tests), body 4096/4097, artifacts 64/65, identifier 256/257, cursor 1024/1025, events 16/17, checkpoints 10000/10001, oversized agent/session histories. Fixed schema/resource ceilings that cannot be reached by a supported entry path remain defensive limits, not claims of heap isolation.
- Prettier/diff checks pass. No hard termination of noncooperating adapters, cancellation of unsettled ledger writes, global suite, or production platform success claimed.
- Commit: feat(design-gate): enforce bounded dependency lifecycles W056. Trailer: Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>.

### W057 executed evidence

- Baseline W056 85779d0. FR-019–026, CC-14, privacy/storage fail-closed controls.
- Initial test run exposed fixture assumption: ordinary ledger cleanup retained only highest generation. This was not corruption RED. The test now explicitly restores its saved older valid fixture generation before corrupting highest.
- Genuine RED: npm test -- DevSquadAdoDesignApproval.failure --reporter=dot exit 1: 8 behavioral failures / 1 pass, all stable category mismatches with no setup error.
- GREEN affected selector npm test -- DevSquadAdoDesignApproval DevSquadAdoWorkflowLedger --reporter=dot exit 0: 228 passed / 2 existing platform skips, 15 files. Failure file adds 9 tests. Typecheck exit 0, formatting/diff pass.
- Injected public capacity failures at each stage preserve durable history and invocation limits; actual portable highest-generation corruption refuses older fallback. Unsupported schema/platform and secret-bearing adapter errors become fixed categories. Successful durable artifacts and results scanned for proposal, command, human witness and raw capability sentinels: none retained.
- No sidecars, cursor/reference patches, claim lifecycle, private receipt inspection, eviction, repair, migration or capacity change in production feature. Existing ledger recovery/capacity tests included in affected regression.
- Commit: fix(design-gate): fail closed on exhausted evidence W057. Trailer: Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>.

### W058 executed evidence

- Baseline W057 5f6d679. FR-001/002/008/012/016–018, CC-08/09/12/16; immutable review isolation.
- RED: npm test -- DevSquadAdoDesignApproval.changes --reporter=dot exit 1: 2 behavioral failures / 3 passes. Supplied revised material was not classified as conflicting evidence separately from historical approval.
- GREEN affected selector npm test -- DevSquadAdoDesignApproval DevSquadAdoWorkflowLedger --reporter=dot exit 0: 233 passed / 2 existing skips, 16 files. New changes file 5 tests. Typecheck exit 0; Prettier/diff pass.
- Complete change-request to separately authorized revised occurrence tracer passes with two publications and fresh human review. Old occurrence/grant and changed content/artifact cannot transfer verification. Original change request survives later reconciliation; uncertainty creates no new occurrence.
- Scope: result verification discriminator, design conflict projection, attached tests/evidence. No approval-to-execution conversion or automatic occurrence policy.
- Commit: feat(design-gate): isolate revised design reviews W058. Trailer: Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>.

### W059 executed evidence

- Baseline W058 0d71c60. FR-003–005/020–023, CC-10/13/16; watcher notification and capability separation.
- RED: npm test -- DevSquadAdoDesignApproval.authority --reporter=dot exit 1: 2 behavioral failures / 7 passes. Foreign-item provenance was silently ignored before publication.
- GREEN complete affected selector npm test -- DevSquadAdoDesignApproval DevSquadAdoWorkflowWatcher DevSquadAdoWorkflowLedger --reporter=dot exit 0: 910 passed / 2 existing platform skips, 30 files (178 feature + 732 predecessor passes). Typecheck exit 0; Prettier/diff pass.
- Typed real watcher signal shapes compose through minimized structural provenance. Historical revisions/states need not match current CAS; claim/cleanup metadata is not read or retained. Both intake kinds with missing independent capability remain blocked. Stale fence, wrong token, inclusive expiry and zero claim-operation spies covered.
- No watcher production/type contract changes or runtime graph import. No fabricated discovery comments, execution authority, development approval bypass or live adapter.
- Commit: feat(design-gate): separate intake from authority W059. Trailer: Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>.

### W060 executed evidence

- Baseline W059 26ab825. FR-001/002/018/019/022–026, CC-09/15; SEC-001/003/006/007.
- RED: npm test -- DevSquadAdoDesignApproval.target.test --reporter=dot exit 1: 15 behavioral failures. Bound targets and independent handoff were unsupported before this task.
- First implementation verification found a missing wrapper opening call (syntax, not behavioral RED); one localized correction restored compilation. Final npm run typecheck exit 0. GREEN affected selector npm test -- DevSquadAdoDesignApproval DevSquadAdoWorkflowLedger --reporter=dot exit 0: 257 passed / 2 existing skips, 18 files (193 feature + 64 ledger passes).
- Exact target tuple is independently verified before reservation, committed in T, and compared with original/request-challenge-bound current proof. Every repository/source/branch/worktree/agent/session descriptor field mismatch blocks descriptive handoff without rewriting durable approval. Read-only recover also supports independent current observation. No-target is explicitly not-bound.
- Fixed descriptor/path/evidence bounds, UTC observation age <=5000ms, no current ledger reference inference, no executable instruction or lock. Target proof final-return hardening remains W061.
- Changed TS formatting and diff checks pass. Scope: target module, API/composition, target tests/evidence. No filesystem/network/execution in target implementation.
- Commit: feat(design-gate): verify current target evidence W060. Trailer: Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>.

### W061 executed evidence

- Baseline W060 641ecd3. FR-018/019/022–026, CC-09/15, SEC-006/007.
- RED: npm test -- DevSquadAdoDesignApproval.target-race --reporter=dot exit 1: 2 failures / 4 passes. Cancellation/whole-deadline retirement inside final UTC-clock observation still returned verified-current.
- Initial affected verification: npm test -- DevSquadAdoDesignApproval DevSquadAdoWorkflowLedger --reporter=dot exit 1: 262 passed / 1 failed / 2 existing skips, 19 files. The exact-5000ms fixture mixed fixed UTC with real monotonic validation time. Typecheck passed. The command sequence incorrectly continued to commit da23426 with an invalid GREEN statement; this correction explicitly supersedes that statement, not the original observed failure.
- Final handoff checks retirement after all host code and adds local monotonic validation time to reported observation age. Exactly 5000 ms accepted, 5001 blocked; late proof cannot change result. Independent current proof remains valid through ordinary host cursor advancement after durable approval. No execution instruction, lock or reauthorization promised.
- Scope: target final-return guard, attached race tests, evidence. Historical approval and missing/changed target remain orthogonal.
- Commit: fix(design-gate): preserve target proof freshness W061. Trailer: Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>.

### W061 correction and verified completion

- Commit da23426 was prematurely created after the above failed boundary assertion. No W062 work started on that state; no amend/reset/rebase was used.
- Corrected exact-boundary fixture to use both deterministic UTC and monotonic clocks, consistent with the task's explicit schedule. Real elapsed validation time is still charged by production; the final cancellation/retirement guards are unchanged. One correction attempt, no learning file under the standing N disposition.
- Actual GREEN rerun: npm test -- DevSquadAdoDesignApproval DevSquadAdoWorkflowLedger --reporter=dot exit 0, 263 passed / 2 existing skips across 19 files. npm run typecheck exit 0. Prettier/diff pass. W061 checkbox now reflects this verified completion.
- Corrective commit scope: target-race fixture and truthful task evidence only. Subject test(design-gate): fix deterministic freshness boundary W061. Trailer: Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>.

### W062 executed evidence

- Baseline W061 corrected completion ae929bd (da23426 failure record explicitly corrected above). FR-003/021/023–026, offline/public boundary controls.
- RED: npm test -- DevSquadAdoDesignApproval.dependencies --reporter=dot exit 1: 2 behavioral failures / 6 passes. Root operations absent; reconcile incorrectly required unused publication/design-verifier dependencies.
- GREEN npm test -- DevSquadAdoDesignApproval DevSquadAdoWorkflowWatcher.dependencies DevSquadAdoWorkflowLedger --reporter=dot exit 0: 290 passed / 2 existing skips, 21 files. Guardian expanded to 10 tests including forbidden-import controls and typed public consumer. Typecheck exit 0; Prettier/diff pass.
- Root exports only intended operations/contracts. Reconcile dependency subset requires no publisher or initial design verifier. Runtime/type guardian covers every feature production module, imports/reexports/side-effects/dynamic/CommonJS forms, forbidden nonliteral calls, and fixture/execution/transport/Effect dependencies. Existing watcher public guardian still passes.
- Fresh npx --no-install tsup exit 0: ESM success 8663ms, DTS success 14689ms. node scripts/check-public-types-effect-free.mjs exit 0 against those freshly generated declarations. Existing unused createRequire/Readable bundle warnings retained. This direct compilation does not run canonical postbuild or establish packaging success; W064 will run canonical npm build.
- Commit: feat(design-gate): expose the offline gate API W062. Trailer: Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>.

### W063 executed evidence

- Baseline W062 65ceb0e. FR-008/011/012/017–019/022–026, CC-02–04/07–09/15/16, operational honesty/privacy controls.
- Inspected all seven existing changeset markdown files (including changeset README); none duplicates design approval. Package name confirmed @ai-hero/sandcastle. Added one minor feature changeset; existing entries/manifests unchanged.
- Documentation RED: npm test -- DevSquadAdoDesignApproval.examples --reporter=dot exit 1: one missing README protocol/runbook assertion and two passing executable behavior examples. This is documentation alignment RED, not a new production behavior defect.
- GREEN examples + dependencies: 13 passed / 2 files. Full feature regression npm test -- DevSquadAdoDesignApproval --reporter=dot exit 0: 212 passed / 16 files. Typecheck exit 0.
- README diff is 143 added lines only: exact commands, host authorities, entry effect ceilings, immutable prefix, permanent loss runbook, bounded liveness, target revalidation and slices 16–19. Distinct production Windows ledger and POSIX packaging limitations retained.
- README/example Prettier check passes. Changeset is ignored by CLI formatting; explicit Prettier API check initially false, formatted once and rechecked true. git diff --check passes.
- Original spec/plan/ADR remain untracked and byte-preserved: normal precommit formatting would rewrite them if staged, so this worker intentionally does not include them in a formatting-hook commit. Parent retains these authoritative local inputs.
- Commit: docs(design-gate): explain host review and loss limits W063. Trailer: Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>.

### W064-discovered W049/W056 validation follow-up

- Baseline W063 479daa9. Traceability inspection found three bounded-validation defects: tuple/scope traversal used adapter-provided array methods; public chronology did not compare checkpoint timestamps with record bounds; combined selection package could exceed 16 KiB despite individually bounded fields. This is implementation correction within FR-021/024 and SEC-001/006, not spec drift.
- RED npm test -- DevSquadAdoDesignApproval.bounds -t follow-up --reporter=dot: exit 1, five behavioral failures / 28 selector exclusions. Additional RED -t "combined minimized": exit 1, one behavioral failure / 33 exclusions; oversized canonical selection package incorrectly approved.
- Replaced custom array-method traversal with bounded indexed copies, enforced coherent public checkpoint chronology, and checked combined minimized event/grant/prefix bytes before resolution. Added six implementation-attached regressions, not a separate conformance project.
- Typecheck caught one cast-precedence error; one localized correction, final exit 0. GREEN npm test -- DevSquadAdoDesignApproval DevSquadAdoWorkflowLedger --reporter=dot exit 0: 282 passed / 2 existing skips in 21 files (218 feature + 64 ledger). Formatting/diff pass.
- Scoped follow-up commit: fix(design-gate): close bounded validation gaps W056. Trailer: Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>. W064 final integrated validation remains pending below.
