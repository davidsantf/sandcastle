# Cowork Factory — Implementation Plan

Basis: [spec.md](./spec.md). Planning only; this document does not authorize implementation, provider writes, or app/agent sessions.

## Scope and Ownership

| Owned file under `src/`            | Responsibility                                                                                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CoworkFactoryContract.ts`         | Structural injected boundaries for journal access, authorization, evidence, writers, and clocks. Consume peer-owned critic types; do not duplicate them.  |
| `CoworkFactory.ts`                 | Stable signal identities, freshness, frozen previews, authorization matching, durable dispatch intent, CAS fencing, and unresolved-outcome recovery.      |
| `CoworkFactoryImpact.ts`           | Verified consumer mappings, changed-contract filtering, bounded deduplicated propagation, and explicit supersession.                                      |
| `CoworkMeasuredLoops.ts`           | Pure evidence gates, required independent critics, bounded-loop decisions, and human-action summaries.                                                    |
| `CoworkMeasuredLoopsExecution.ts`  | Future coordination through injected host-approved execution seams with persisted attempt/repeat/deadline accounting; no session or scheduling ownership. |
| `CoworkFactoryRelease.ts`          | Read-only production lineage, outcome classification, and attributable recurrence deduplication.                                                          |
| `CoworkMeasuredLoopsComparison.ts` | Persisted speed/document decisions dependent on retained executed negative controls and independent host provenance.                                      |
| `CoworkFactoryExample.ts`          | Local fake-hub/fixture-worker composed demonstration, explicitly not live integration.                                                                    |

Associated tests are owned with these modules. Core owns `MultiProject*`, the shared SQLite journal, central exports, entrypoint wiring, and integration. The peer owns imminent `CoworkReviewContract.ts` structural critic types. No code or central-document changes belong to this planning phase.

## Architectural Boundaries

- Use the **same core-owned SQLite `MultiProjectJournal`**, injected through structural `read(key)` and atomic `compareAndSwap(key, expectedVersion, record, event)`. State and event commit together. No Cowork ledger, fallback persistence, or second source of truth.
- The host independently verifies evidence provenance and authorization. Candidate assertions and critic approval cannot self-certify evidence or confer write authority.
- Preview is default. Authorization binds exact frozen content, revision, operation, provider/project, and affected consumer scope.
- Persist acknowledged durable intent before dispatch. Only the CAS winner may dispatch. Interrupted or uncertain external writes remain unresolved across restart, without automatic redispatch; this is not a provider-side exactly-once guarantee.
- Compatibility propagation requests authorized work; it does not select tasks, merge, deploy, roll back, mutate frozen running tasks, or take over host control-plane authority.

Existing decision references, located in `docs/adr/`:

- **ADR-0021 — ADO feedback loops summarize status but do not finalize pull requests:** preserve host authority; evidence acceptance is not final merge readiness.
- **ADR-0024 — DevSquad Sandcastle execution adapter runs one selected task:** preserve caller-selected execution through injected seams.
- **ADR-0025 — Offline fenced workflow checkpoint (Proposed):** contextual only; its filesystem ledger remains unchanged and is not Cowork storage.
- **ADR-0031 — ADO MCP transport is an injected host boundary (Proposed):** contextual transport guidance, not an Accepted dependency or an assumed provider capability.

No new ADR is required for this bounded slice. No blocking spec/ADR contradiction was identified.

## Dependency Checkpoint

Before dependent implementation, align with core on absent-record/version semantics, CAS conflict/error results, atomic durability acknowledgment, record/event validation, and restart recovery. Core supplies actual SQLite atomicity/durability tests and same-instance integration.

Consume the peer review contract when available; do not invent parallel critic types. Host owners supply exact authorization, independently verified evidence/mappings, scoped writers, reconciliation inputs, and read-only production observers. Evaluation configuration supplies freshness, protected checks, benchmark/evaluator provenance, comparison/noise policy, finite traversal limits, deadline, production ring/window, and recurrence attribution.

Missing contracts or configuration block the affected operation with a named human action. They do not justify fallback storage, inferred authority, weaker evidence, or retries.

## Implementation and Test Order

1. **Align structural seams.** Establish compatibility with core journal and peer critic contracts; use deterministic injected fakes. Test missing configuration, sanitized failures, and zero live-system access.
2. **Signals and dispatch safety.** Test restart-stable identities, stale/malformed/mismatched evidence, frozen authorization mismatch, and preview with zero writes. Cover CAS races, failed durability acknowledgment, interruption before/after dispatch, lost outcome acknowledgment, and restart without duplicate dispatch.
3. **Measured gates.** Require independent, attributable criticism for research, design, build, verification, review, and change-request-proposal; missing/self-assessed/inconclusive criticism blocks acceptance.
   - Functional: controlled baseline failure and candidate success, relevant nonzero tests **and assertions**, protected regressions passing, default two repeats.
   - Speed: comparable workloads and assertion parity, at least 5% improvement, no protected regression; unsupported noise is inconclusive.
   - Documents: fixed benchmark/evaluator/provenance, wins greater than losses, bottom `ceil(N × 0.1)` mean does not regress, all hard checks pass.
   - Test threshold boundaries, empty evidence, provenance/revision mismatch, and critic failures.
4. **Bounded loop coordination.** Persist consumption before execution boundaries; default three attempts, repeat accounting, and configured deadline survive restart. Test competing coordinators, exhausted budgets, and deadline stops returning evidence/proposals/human actions; no rollback or sessions.
5. **Compatibility propagation.** Reuse dispatch fencing. Test changed applicable hashes and verified mappings, exact consumer authorization, revision/contract/consumer/destination deduplication, restart replay, uncertain writes, cycles/depth/fanout, and supersession preserving frozen tasks.
6. **Read-only release outcomes.** Test exact merged SHA → artifact → first configured production ring → metric window; return `awaiting`, `verified`, `resurfaced`, or `inconclusive`. Cover missing/wrong/contradictory lineage and recurrence deduplication.

Compose deterministic offline acceptance coverage for spec C-01–C-11. Fixture success establishes behavior, never live production verification.

## Security Controls

Architectural review: **APPROVED_WITH_CONTROLS**, with no planning blockers. Required implementation controls are exact host authorization and independent evidence verification, atomic durable CAS fencing, restart-safe budgets/deduplication, read-only observation, and diagnostics excluding credentials/raw sensitive provider payloads. No credential discovery, automatic uncertain-write retry, or inferred cross-project permission.

## Engineering Practices

Use existing Vitest, TypeScript checking, Prettier, and Effect-free public declaration validation. Keep each implementation slice passing targeted tests before proceeding. Central exports/wiring and any public-change documentation/changeset follow-up remain with an authorized integration owner.

## Commands

Run from the repository root during implementation validation; none were executed in this planning phase.

- Build: `npm run build`
- Tests: `npm test`
- Targeted test example: `npm test -- src/CoworkFactory.test.ts`
- Type checking: `npm run typecheck`
- Formatting: `npm run format:check`
- Plan formatting: `npx prettier --check docs/features/cowork-factory/plan.md`
- Local execution: intentionally not applicable to this offline slice; do not start app sessions.

Build post-processing uses POSIX commands; validate on the existing Ubuntu/Node 22 CI environment or confirm Windows compatibility during implementation.

## Handoff and Stop

Next authorized phase can implement the ordered slices after dependency alignment, within the six-file/test ownership boundary. Preserve the spec, existing ADR references, independent-host-verification assumption, and rejection of separate persistence, self-certification, automatic redispatch, and host-authority expansion. This phase ends after saving this plan; no implementation or work-item creation is performed.
