# DevSquad/ADO Workflow Watcher Tasks

**Historical third-review follow-up (2026-09-10; superseded by final turn 4):** Critical RC14-008 independently FAILED. Its history-acknowledgement remediation and 19 new bounded public-pass regressions were implemented; W038 was then unchecked and FAILED pending independent re-review. The failure and remediation history remain in `review-log.md`.

Decomposition of [spec.md](spec.md) and [plan.md](plan.md) under [ADR-0026](../../adr/0026-devsquad-ado-workflow-watcher.md), preserving ADR-0021, ADR-0022, ADR-0024, and ADR-0025.

**Current status (2026-09-10): W038 COMPLETED TECHNICAL ONLY; final fresh independent turn 4 PASSED, no blockers (0 Critical, 0 Major, 1 nonblocking Minor TB001).** W029-W037 prerequisites are complete. All five guardians completed, and the separate security specialist found no vulnerabilities. RC14-008 is independently closed; all earlier findings are closed/preserved in the final closure matrix in `review-log.md`. TB001's older-test internal guard/object-identity coupling is acknowledged, not a required fix. Earlier failed/pending states and superseded PASS verdicts remain historical. Technical conformance does not grant governance acceptance or merge readiness: ADR-0025/0026 remain Proposed; parent publication is separate, #20 must merge before #21, and slice 15 remains blocked until the creator explicitly decides.

## Scope and Conventions

- **Ordering is the plan's vertical sequence.** Phases 2–9 map one-to-one onto the plan's eight implementation slices. Do not reorder; each phase depends on the durable behavior of the previous one.
- **Tests travel with implementation.** Every implementation/remediation task is TDD RED→GREEN; W029 is approved artifact execution and W038 is the final independent verification gate, not substitutes for behavioral tests.
- **Tracer bullet.** W008 (Phase 5) is the first end-to-end vertical: one candidate travels read → observe → claim → checkpoint → intake signal → release. Phases 2–4 exist only because that vertical cannot compile or assert without contracts, identity derivation, and observation projection.
- **`[P]`** marks tasks that may run in parallel with their siblings inside the same phase.
- **Board scope.** This is a local stacked roadmap slice. No GitHub or Azure DevOps work items are created for these tasks.
- **Missing ADRs.** None. Every decision listed in the spec's "Technical Decisions Identified" table is resolved by ADR-0026 (seam shape, operation-identifier derivation, backoff/budget/cancellation contract, intake delivery model, lease defaults) or is explicitly owned outside Sandcastle (phase legality, ADR-0024; persistence protocol, ADR-0025).
- **Implementation gate.** ADR-0025 and ADR-0026 are both `Proposed`. Implementation proceeds against their stated boundaries and security controls; ADR acceptance remains a separate review action and is not a task here.

## Global Acceptance Constraints

Every task below inherits these; a task is not complete if any is violated.

- No public declaration imports `effect` or `@effect/*`.
- No module in the watcher graph imports ADO, GitHub, MCP, HTTP, CLI, git, agent, sandbox, shell, scheduler, team-runner, feedback-loop, or execution-adapter modules.
- No phase allowlist, phase order, transition table, or terminal state is introduced.
- No ledger artifact is created, repaired, reset, or rewritten except through the ledger's public typed operations.
- Claim tokens, external bodies, authors, URLs, and credentials never reach results, signals, errors, diagnostics, or durable state.
- Every public function, interface, and property carries JSDoc.
- Tests request zero wall-clock waits: clock, delay, and seam are always injected.

---

## Phase 1: Foundational Test Harness

Blocking prerequisite for every later phase. Nothing here is exported from the package.

- [x] **W001** Create the deterministic watcher test harness in `src/DevSquadAdoWorkflowWatcherTestSupport.ts`
  - Recording observation-seam fake: records call order, method name, `workItemId`, and `since` argument per call; carries write-shaped spies (`updateWorkItem`, `createComment`, `completePullRequest`) that must remain uninvoked.
  - Deterministic clock fake: returns a caller-scripted `Date` sequence and records every reading so "one reading per poll" is assertable.
  - Recording delay source: resolves immediately, records `(ms, pollIndex)` requests, and honours an injected `AbortSignal`.
  - Ledger fixture helpers: open an isolated temp-dir ledger via `openDevSquadAdoWorkflowLedger`, seed a record at a chosen revision/phase/status/cursor, and read raw durable artifacts for leak scanning.
  - Acceptance: harness compiles under `npm run typecheck`; a smoke test seeds record `137` at revision 4 with work-item comment cursor `480` and reads it back unchanged.
  - Traceability: enables TEST-001–TEST-025; SC-010.

---

## Phase 2: Public Contracts and Validation — plan slice 1

- [x] **W002** Add Effect-free public contracts and the observation seam interface in `src/DevSquadAdoWorkflowWatcher.ts`
  - Declare `DevSquadAdoWatchPassOutcome`, `DevSquadAdoWatchError`, `DevSquadAdoWatcherSeamMethodName`, the seam interfaces (`DevSquadAdoWatcherObservationSeam` and its four input/observation/entry types), pass options (`RunDevSquadAdoWorkflowWatchPassOptions`, intake rules, budgets, lease, backoff), and the result envelope (`DevSquadAdoWatchCandidateOutcomeKind`, `DevSquadAdoWatchReasonCode`, `DevSquadAdoWatchStopReason`, claim metadata, candidate outcome, intake signal, counts, pass result).
  - Declare the `runDevSquadAdoWorkflowWatchPass` signature returning `Promise<DevSquadAdoWatchPassOutcome>`; the implementation lands in later phases.
  - Reuse `DevSquadAdoWorkItemId` and `DevSquadAdoPullRequestCursor` from the ledger module; introduce no duplicate identifier or cursor type.
  - Acceptance target after recovery: the reason-code union is exactly the plan's 27 members (25 previously, plus `invalid-observation-window` and `claim-cleanup-unconfirmed`), the stop-reason union is exactly four members, every candidate has cleanup, cleanup counts are exported, and no declaration references `effect`. Pending W034/W037; the historical checkmark does not prove the new target.
  - Traceability: FR-001, FR-002, FR-005, FR-006; INV-009.
  - Verify: `npm run typecheck`

- [x] **W003** Implement option and seam structural validation in `src/DevSquadAdoWorkflowWatcherValidation.ts`
  - Export `validateDevSquadAdoWorkflowWatchPassOptions` returning a discriminated validation result; validation runs to completion before any seam call or ledger operation and reports the first failure with a stable field path.
  - Enforce every row of the plan's validation table: ledger/seam callability; pass/owner identifier bounds; candidates 1–1,000 inclusive with every duplicate canonical identity rejected; exact intake sets; safe integer `maxPolls` 1–10,000; positive safe duration budgets; lease ≤ 86,400,000 default 60,000; positive renewal threshold strictly below lease (default one-third); valid backoff defaults 1,000 / 2 / 30,000; callable jitter/clock/delay. Signal requires boolean `aborted` and callable add/remove event listeners before any injected side effects. Full regression matrix is pending W031/W036.
  - Emit `kind: "seam-contract"` with the offending method name and `"missing" | "not-a-function"`; emit `kind: "validation"` with `field` and `reason` for everything else.
  - Acceptance (RED→GREEN in `src/DevSquadAdoWorkflowWatcher.test.ts`): TEST-001 covering CC-015 (blank owner, duplicate candidates, `maxPolls = 0`, malformed intake rules → stable field paths, zero side effects) and TEST-002 covering CC-016 (seam without `observeWorkItemComments` → `seam-contract` error naming the method, zero ledger mutations).
  - Traceability: FR-003, FR-004, FR-009; CC-015, CC-016.
  - Verify: `npm test -- DevSquadAdoWorkflowWatcher`

- [x] **W004** Implement canonical candidate ordering in `src/DevSquadAdoWorkflowWatcherValidation.ts`
  - Canonicalize candidates through ledger rules, reject every duplicate canonical identifier, and sort valid candidates by UTF-8 byte comparison. Never sort observation IDs; their opaque order is supplied by the seam.
  - Acceptance: ordering unit assertions over shuffled, mixed `string | number`, and multi-byte identifier inputs produce one identical canonical sequence.
  - Traceability: FR-004, FR-016; INV-003. Feeds TEST-006.
  - Verify: `npm test -- DevSquadAdoWorkflowWatcher`

---

## Phase 3: Operation Identity and Backoff — plan slice 2

- [x] **W005** Implement `deriveDevSquadAdoWatcherOperationId` in `src/DevSquadAdoWorkflowWatcherValidation.ts`
  - `operationId = "dsw2." + step + "." + sha256hex(canonicalJson(identity)).slice(0, 32)`, where the checkpoint identity is `{ v: 2, passId, workItemId, step, ordinal, generation }` and the claim-lifecycle identity is `{ v: 2, passId, workItemId, step, ordinal, claimEpoch }`. Rescoped by W023; see that task for the rationale.
  - `step` ∈ `claim | renew | checkpoint | release`; `ordinal` is `0` for one-shot steps and the one-based renewal sequence for `renew`; `workItemId` is the canonical ledger identifier, never the caller's raw input.
  - Canonical serialization only (sorted keys, no ambient whitespace); never concatenate raw identifiers into the digest input.
  - Acceptance: identifiers are exactly 48 ASCII bytes; identical identity inputs reproduce identical identifiers across processes; a long `passId` with a short `workItemId` and the transposed pair produce different identifiers (delimiter-injection assertion).
  - Traceability: FR-037, FR-038; INV-008. Feeds TEST-012.
  - Verify: `npm test -- DevSquadAdoWorkflowWatcher`

- [x] **W006** [P] Implement deterministic backoff computation in `src/DevSquadAdoWorkflowWatcherValidation.ts`
  - `raw = baseIntervalMs * multiplier^(n-1)`; `capped = min(trunc(raw), maxIntervalMs)`; `delayMs = jitter ? clamp(trunc(jitter(capped, n)), 0, maxIntervalMs) : capped`. No randomness unless `jitter` is injected.
  - Acceptance: schedule assertions over defaults and over a custom multiplier confirm truncation, capping, jitter clamping, and that repeated computation is pure.
  - Traceability: FR-049, FR-050. Feeds TEST-016.
  - Verify: `npm test -- DevSquadAdoWorkflowWatcher`

---

## Phase 4: Observation and Cursor Selection — plan slice 3

- [x] **W007** Implement seam invocation, projection, and new-event selection in `src/DevSquadAdoWorkflowWatcherObservation.ts`
  - Invoke `observeWorkItemComments` with `sinceCommentId` from the record; invoke `observePullRequestActivity` only when `record.pullRequest.id !== null`, and report `pull-request-observation-unavailable` when the optional method is absent.
  - Fresh parent abort gate before each seam, including WI success that aborts before PR. Each observation gets a dedicated child AbortController passed to the seam and linked to the parent; timeout/abort cancels seam/timer, every terminal path removes listeners and quarantines late settlements. Liveness assumes valid settling delay; noncooperating dependencies cannot be forcibly stopped.
  - Project identifiers only. Each ID must be nonblank, control-character-free and ≤ 1,024 UTF-8 bytes. Before iteration/copy enforce ≤ 1,000 entries per window; before retaining each entry validate identity uniqueness and accumulate ≤ 1,048,576 aggregate identifier bytes (PR sums thread and nonnull comment). Malformed/duplicate/oversized windows fail the entire candidate as `invalid-observation-window`; individual invalid identifiers remain `invalid-observation-identifier`. No silent deduplication/truncation or oversized full projection.
  - Anchor rule: empty → no new events; null anchor → all; anchor at index `i` → suffix after `i`; persisted anchor absent in nonempty window → `failed` / `observation-anchor-missing`, no cursor advance. WI identity is exact comment ID; PR identity exact thread/comment pair after only null/undefined normalization. Opaque identifiers are never sorted or numerically compared.
  - Missing/undefined/null PR comment is incomplete; blank comment is invalid. Mixed new entries advance to the newest COMPLETE pair, marking PR skipped only if none is persistable. `cursorChanges` and `skippedCursorKinds` are disjoint.
  - Recovery verification of this corrected contract is pending W031–W033; this historical task does not claim those tests pass.
  - Acceptance (RED→GREEN): TEST-003 in `src/DevSquadAdoWorkflowWatcher.test.ts` (CC-003 — only observation methods invoked, at most once per candidate per poll per kind), TEST-018 in `src/DevSquadAdoWorkflowWatcher.bounds.test.ts` (CC-013 — non-settling seam with `observationTimeoutMs = 5000` yields `failed`/`observation-timeout` and the pass continues), TEST-022 in `src/DevSquadAdoWorkflowWatcher.test.ts` (CC-019 — incomplete thread/comment pair not persisted, stable reason).
  - Traceability: FR-009–FR-015, FR-020–FR-024, FR-052; INV-002, INV-010.
  - Verify: `npm test -- DevSquadAdoWorkflowWatcher`

---

## Phase 5: Single-Candidate Happy Path (tracer bullet) — plan slice 4

- [x] **W008** Implement the per-candidate step machine in `src/DevSquadAdoWorkflowWatcherPass.ts` and wire `runDevSquadAdoWorkflowWatchPass` in `src/DevSquadAdoWorkflowWatcher.ts`
  - Implement steps 2, 4–7, 9, 11–13 of the plan's candidate step algorithm for one candidate in one poll: `readRecord` → observe → project/select → acquire claim (fresh 32-byte `node:crypto` `randomBytes` base64url token, derived `claim` operation ID, configured lease) → `checkpoint` with `expected = { revision, phase, status }` and a patch carrying only advanced cursors → intake decision → release with the derived `release` operation ID.
  - `record-not-found` → `skipped`/`record-not-found`; the watcher never initializes a record.
  - Intake decision is exact-match on both sets: phase ∈ `intakeRules.phases` **and** status ∈ `intakeRules.statuses` → append one signal citing `sourceRevision` and resolve `acted`; otherwise resolve `intake-suppressed`/`intake-rules-unmatched` with the cursor left advanced.
  - Append at most one signal per candidate only after a fully validated checkpoint acknowledgement. Cleanup failure promotes nonfailed outcomes per FR-060 but preserves acknowledged revision/cursors and returned signal; no rollback or retraction.
  - Acceptance target (W034/W035 verify recovery): TEST-004/CC-001 starts rev 4 cursor `480`, observes `[480, 481]`, acquires rev 5, checkpoints cursor `481` at rev 6, releases rev 7; signal sourceRevision 4, outcome revision 6, cleanup acceptedRevision 7. TEST-005/CC-002 rerun leaves then-current rev 7 unchanged with no acquire/checkpoint/release and cleanup not-required. Retain TEST-014 exact phase/status admission/suppression and TEST-015 missing-record coverage.
  - Traceability: FR-018, FR-019, FR-025–FR-028, FR-032–FR-036, FR-040–FR-046; INV-006, INV-007, INV-009.
  - Verify: `npm test -- DevSquadAdoWorkflowWatcher`

---

## Phase 6: Poll Loop, Budgets, and Cancellation — plan slice 5

- [x] **W009** Implement the bounded poll loop in `src/DevSquadAdoWorkflowWatcherPass.ts`
  - Implement the plan's loop verbatim: single `startedAt` reading as the pass-start basis; one clock reading per poll driving every eligibility, lease, and timestamp decision in that poll; pending/resolved candidate state; sequential evaluation in canonical order with no concurrency.
  - Stop at the first of `candidates-resolved`, `poll-budget-exhausted`, `poll-start-budget-exhausted`, `cancelled`; the elapsed check applies from the second poll onward and gates poll starts only. Between polls, request `backoffFor(polls)` from the injected delay source.
  - Eligibility step 8: no new events in any kind leaves the candidate **pending** with `no-new-observations` (or `incomplete-pull-request-cursor` when the only observed activity was unpersistable), re-examined next poll.
  - Finalizer: report unresolved claimed checkpoints as `failed`/`checkpoint-indeterminate`, then run exactly-once cleanup for validated authority and attach cleanup to every candidate. `acted` counts returned signals, `suppressed` acknowledged suppressed cursor advances, `failed` final failures (may overlap); cleanupReleased/Failed/Indeterminate/NotRequired partition all candidates. Preserve timestamps, poll count and stop reason.
  - Acceptance (RED→GREEN): TEST-006/CC-010 in `src/DevSquadAdoWorkflowWatcher.test.ts` (three shuffled input orders → identical outcomes, reason codes, and recorded seam call order); TEST-007 (clock fake asserts exactly one reading per poll drives eligibility, lease, and timestamps); TEST-016/CC-011 in `src/DevSquadAdoWorkflowWatcher.bounds.test.ts` (`maxPolls = 3` with no eligible candidate → exactly 3 polls, exactly 2 recorded delays, `poll-budget-exhausted`, plus a duration-budget case).
  - Traceability: FR-006, FR-016, FR-017, FR-047–FR-050; INV-003, INV-011.
  - Verify: `npm test -- DevSquadAdoWorkflowWatcher`

- [x] **W010** Implement cooperative cancellation gates in `src/DevSquadAdoWorkflowWatcherPass.ts`
  - Fresh cancellation gates before each seam and non-cleanup mutation, plus between polls. Child observation signals receive parent abort; mandatory release for validated authority still runs once after abort.
  - On abort preserve acknowledged outcomes/signals, attach truthful cleanup and final failure promotion, and return `ok: true` / `stopReason: "cancelled"`. Never claim abort forcibly terminates a noncooperating seam, ledger, or delay.
  - Acceptance (RED→GREEN in `src/DevSquadAdoWorkflowWatcher.bounds.test.ts`): TEST-017/CC-012 — cancellation under cooperating dependencies preserves acknowledged outcomes and attempts cleanup once for validated authority; a released result requires a validated release acknowledgement. Expanded failures are pending W034.
  - Traceability: FR-051, FR-053; INV-012.
  - Verify: `npm test -- DevSquadAdoWorkflowWatcher`

---

## Phase 7: Claim Lifecycle Under Contention — plan slice 6

- [x] **W011** Implement the foreign-claim gate and claim-acquisition outcome mapping in `src/DevSquadAdoWorkflowWatcherPass.ts`
  - Step 3: an `activeClaim` owned by another `ownerId` with `now < expiresAt` resolves `skipped`/`claim-conflict` with no seam call and no mutation.
  - Map acquisition failures: `claim-conflict` → `skipped`/`claim-conflict`; `claim-expired`, `claim-authorization`, `stale-fencing` → `skipped` with the matching reason. Never force-release, delete, or reset another owner's claim.
  - Acceptance (RED→GREEN in `src/DevSquadAdoWorkflowWatcher.concurrency.test.ts`): TEST-008/CC-004 — interleaved `watch-a` and `watch-b` passes over `137` with a 60s lease produce exactly one actor and one `claim-conflict` skip, with the skipping pass continuing its remaining candidates.
  - Traceability: FR-025, FR-030, FR-031; INV-004.
  - Verify: `npm test -- DevSquadAdoWorkflowWatcher`

- [x] **W012** Implement fencing propagation and checkpoint conflict mapping in `src/DevSquadAdoWorkflowWatcherPass.ts`
  - Carry the fencing value on every mutation under a held claim. Map `stale-fencing`, `claim-expired`, `claim-authorization` on checkpoint → `failed` with the matching reason and nothing advanced; `revision-conflict`, `state-conflict`, `idempotency-conflict` → `failed` with the matching reason and durable state unchanged; `storage` with `outcome: "unchanged"` → `failed`/`ledger-recovery` with no retry.
  - An `idempotency-conflict` is terminal for that candidate step; never retry it under a different operation identifier.
  - Acceptance (RED→GREEN in `src/DevSquadAdoWorkflowWatcher.concurrency.test.ts`): TEST-009/CC-005 (expire `watch-a`, take over with `watch-b`, replay `watch-a`'s checkpoint → `stale-fencing`, zero cursor advance, zero revision change); TEST-013/CC-006 (advance the record to rev 9 between read and checkpoint → `revision-conflict` and pass continuation, plus a `state-conflict` case); TEST-012 (derived identifiers replay the original outcome; reuse with different data yields `idempotency-conflict`).
  - Traceability: FR-029, FR-036–FR-039; INV-005, INV-008.
  - Verify: `npm test -- DevSquadAdoWorkflowWatcher`

- [x] **W013** Implement the renewal guard, indeterminate-checkpoint hold, and release finalizer in `src/DevSquadAdoWorkflowWatcherPass.ts`
  - Step 10: before any mutation under a held claim, renew when `now + renewalThresholdMs >= Date.parse(expiresAt)`, using the next one-based `renew` ordinal and preserving the fencing value.
  - Step 11 ambiguity: `contention`, or `storage` with `outcome: "indeterminate"`, leaves the candidate **pending while holding its claim** and retries on a later poll with the **same** checkpoint operation identifier. If the pass budget ends first, report `failed`/`checkpoint-indeterminate` and release the claim.
  - Attempt release exactly once per previously validated authority on success, candidate failure, cancellation and budget exhaustion; retain evidence until response validation and report FR-060 cleanup. Zero release without validated authority, no retry/reacquire/guess. Verification of ambiguous/rejected/malformed cleanup is pending W034.
  - Acceptance (RED→GREEN in `src/DevSquadAdoWorkflowWatcher.concurrency.test.ts`): TEST-010/CC-014 (indeterminate checkpoint forces a multi-poll hold; renewal occurs before inclusive expiry with unchanged fencing and the checkpoint operation ID reused verbatim); TEST-011 (claims released on success, on candidate failure, and on cancellation, plus a negative assertion that no force-release path exists).
  - Traceability: FR-027–FR-029, FR-035; INV-012.
  - Verify: `npm test -- DevSquadAdoWorkflowWatcher`

---

## Phase 8: Failure Isolation and Recovery — plan slice 7

- [x] **W014** Implement ledger recovery-category mapping and per-candidate isolation in `src/DevSquadAdoWorkflowWatcherPass.ts`
  - Map `corrupt-artifact`, `unsupported-schema-version`, `path-boundary`, `unsupported-permissions`, `scan-limit` → `failed`/`ledger-recovery` with the stable category in `ledgerErrorKind`; `capacity-exceeded` → `failed`/`ledger-capacity`; `storage` → `failed`/`ledger-recovery` with `ledgerErrorKind: "storage"`. Never repair, reset, or bypass a recovery category.
  - Reduce ledger error payloads to the stable `ledgerErrorKind` string: no raw JSON, artifact contents, or operating-system message is surfaced.
  - A candidate failure never aborts remaining candidates; only invalid input and seam-contract violations fail the pass before work begins.
  - Acceptance (RED→GREEN in `src/DevSquadAdoWorkflowWatcher.recovery.test.ts`): TEST-019/CC-017 (three candidates, one corrupt artifact → isolated `ledger-recovery` failure and two normal completions; a seam rejection for one candidate likewise leaves others unaffected); TEST-020 (corrupt and unsupported-schema records report stable categories with no repair and no artifact rewrite).
  - Traceability: FR-007, FR-054–FR-058; INV-013, INV-014.
  - Verify: `npm test -- DevSquadAdoWorkflowWatcher`

- [x] **W015** Add restart-safety assertions for interrupted passes in `src/DevSquadAdoWorkflowWatcher.recovery.test.ts`
  - Interrupt after checkpoint acknowledgement and after an unacknowledged mutation attempt; reopening must preserve acknowledged outcomes and may also reveal a complete durable-but-unacknowledged checkpoint. Never expose a partial aggregate. An exact retry replays without duplication; host reconciliation handles any lost intake signal.
  - Acceptance: TEST-023 green; durable revision and cursor after replay equal the single-pass result.
  - Traceability: FR-057; INV-007, INV-008. TEST-023 is the sole owner of FR-057 and shares INV-007 with TEST-004 and INV-008 with TEST-012; the FR-054–FR-058 coverage row names it for FR-057 only.
  - Verify: `npm test -- DevSquadAdoWorkflowWatcher`

---

## Phase 9: Data Minimization and Package Integration — plan slice 8

- [x] **W016** Add data-minimization and leak assertions in `src/DevSquadAdoWorkflowWatcher.test.ts`
  - TEST-021/CC-018: a seam returning bodies, authors, and a credential-bearing URL is exercised through a full pass; snapshot durable artifacts, the result, signals, errors, and diagnostics and scan for bodies, authors, URLs, credentials, and claim tokens.
  - Assert claim tokens exist only in local step state and appear in no result, signal, error, or durable artifact.
  - Traceability: FR-026, FR-055, FR-056; INV-010; SC-007.
  - Verify: `npm test -- DevSquadAdoWorkflowWatcher`

- [x] **W017** [P] Add the static offline dependency assertion in `src/DevSquadAdoWorkflowWatcher.dependencies.test.ts`
  - TEST-024/CC-020: walk the watcher module graph statically and assert no network-capable, CLI, git, sandbox, agent, or control-plane module is reachable; run a full pass under that assertion.
  - Assert the public watcher declaration is Effect-free (no `effect` or `@effect/*` import in any public-facing module).
  - Traceability: INV-001; SC-010.
  - Verify: `npm test -- DevSquadAdoWorkflowWatcher`

- [x] **W018** Export the public watcher surface from `src/index.ts`
  - Export `runDevSquadAdoWorkflowWatchPass`, `validateDevSquadAdoWorkflowWatchPassOptions`, and `deriveDevSquadAdoWatcherOperationId`, plus the Effect-free public types (outcome/error envelope, seam interfaces and inputs, options, intake rules, budgets, lease and backoff config, candidate outcome, intake signal, counts, pass result, reason/stop/outcome-kind unions, `DevSquadAdoWatcherOperationIdentity`).
  - Follow the existing ledger export style: value export line plus a grouped `export type { ... } from "./DevSquadAdoWorkflowWatcher.js"` block. No new subpath export; public imports continue through `@ai-hero/sandcastle`.
  - Acceptance (RED→GREEN): TEST-025 asserts every exported operation and type is reachable from the package entry point and that result projections are token-free.
  - Traceability: FR-008, FR-026.
  - Verify: `npm test -- DevSquadAdoWorkflowWatcher`; `npm run build`

- [x] **W019** [P] Document the watch pass in `README.md`
  - Cover: the bounded single-pass model; the two-method observation seam and its ordering/`since` contract; required caller-supplied `passId` and why replay parity depends on it; exact-match intake rules with no wildcard; budgets, lease defaults (60,000 ms lease, one-third renewal threshold), and deterministic backoff; the returned-signal delivery model; and the DevSquad lifecycle boundary (host owns candidates, record initialization, phase meaning, and every tracker write).
  - State at-most-once batched intake, never exactly-once downstream execution. Durable-but-unacknowledged checkpoints or host crashes may lose signals; the host reconciles durable cursors against intake processing. Document mandatory cleanup and cooperative liveness assumptions.
  - Acceptance: `npm run format:check` passes; no code sample imports `effect` or a transport client.

- [x] **W020** [P] Add one minor changeset at `.changeset/devsquad-ado-workflow-watcher.md`
  - Single nonduplicate minor entry for the new public feature, matching the existing changeset style in `.changeset/offline-fenced-workflow-ledger.md`.
  - Acceptance: no other changeset in `.changeset/` already describes this feature.

---

## Phase 10: Success Verification and Polish

- [x] **W021** Add the success-criteria verification sweeps across the watcher suites
  - SC-001: 1,000 repeated passes over frozen state compared by deep equality of outcomes, reason codes, and counts.
  - SC-002: 1,000 interleaved two-owner trials asserting exactly one actor each time, run in bounded concurrent batches over disjoint work items so the committed default meets the stated bar.
  - SC-003: stale-fencing trials asserting zero cursor advances and zero revision changes.
  - SC-004: cursor-advance-then-replay trials asserting exactly one signal per observed event across passes.
  - SC-005: budget matrix over poll count, duration, and abort asserting termination and a stable stop reason.
  - SC-006: claim-lifecycle assertions on every exit path plus the negative force-release assertion.
  - SC-008: candidate-isolation trials comparing untouched candidates' revisions before and after a failure.
  - SC-009: assertion that every candidate outcome carries a nonempty stable reason code and outcome kind.
  - Acceptance: all sweeps complete with zero wall-clock waits requested from the injected delay source.
  - Traceability: SC-001–SC-009.

- [x] **W022** Run the full repository validation gate
  - `npm test`
  - `npm run typecheck`
  - `npm run build`
  - `npm run format:check`
  - `git diff --check`
  - Acceptance: all five commands pass on the branch stacked on `users/davidsant/ubiquitous-train`; the build emits an Effect-free public declaration for the watcher.

---

## Phase 11: Deep-Review Remediation

Blockers raised by the three-perspective deep review of this slice. Each is a correctness fix to already-implemented behavior, not new scope.

- [x] **W023** Rescope watcher operation identity in `src/DevSquadAdoWorkflowWatcherValidation.ts` and `src/DevSquadAdoWorkflowWatcherPass.ts`
  - Claim-lifecycle identifiers (`claim`, `renew`, `release`) derive from a random per-acquisition `claimEpoch`; checkpoint identifiers derive from the observation generation (from-anchors and to-cursors) rather than the pass alone. Prefix bumped to `dsw2.`, identity version to `v: 2`.
  - Rationale: the slice-13 request digest includes the capability token, so a pass-stable claim identifier made a second acquisition under one `passId` a permanent `idempotency-conflict`; a pass-stable checkpoint identifier falsely rejected a later legitimate advance under the same `passId`.
  - Capability tokens stay cryptographically random. The epoch is an idempotency namespace only.
  - `DevSquadAdoWatcherOperationIdentity` becomes a discriminated union; `DevSquadAdoWatcherClaimStep` and `DevSquadAdoWatcherObservationGeneration` are exported.
  - Acceptance (RED→GREEN in `src/DevSquadAdoWorkflowWatcher.concurrency.test.ts`): TEST-012/CC-021 — a pass whose acquire is durable and whose checkpoint never lands is retried under the same `passId` and completes; claim, renew, and release identifiers are disjoint across two acquisitions.
  - Traceability: FR-037, FR-037a; INV-008.

- [x] **W024** Add the observation-staleness gate in `src/DevSquadAdoWorkflowWatcherPass.ts`
  - Compare the observation anchors and pull-request identity of the pre-claim read against the record returned by the acquisition; on mismatch release the claim, write nothing, and report `no-change` / `stale-observation` so the candidate re-observes on a later poll.
  - Rationale: a second watcher can advance the cursor and release between the read and the claim, after which the first watcher's acquisition legitimately succeeds and its pre-claim selection would move the cursor backwards and re-deliver events.
  - Acceptance (RED→GREEN in `src/DevSquadAdoWorkflowWatcher.concurrency.test.ts`): TEST-009/CC-022 — deterministic two-owner interleaving advances 10 → 15, the stale owner never writes 12, no duplicate signal is produced, and the reason is `stale-observation` when the budget stops there.
  - Traceability: FR-036a; INV-015.

- [x] **W025** Guard every injected ledger call in `src/DevSquadAdoWorkflowWatcherPass.ts`
  - Route all five ledger methods through guarded method-specific runtime validation of complete relevant successes and known error variants; unknown/malformed results become `ledger-fault`, never arbitrary category text. Non-cleanup faults are `ledger-unavailable`; release faults follow FR-060 cleanup. The prior shallow classifier is insufficient; W030 owns the pending correction.
  - A fault while a claim is held still resolves the candidate, so the release path still runs.
  - Acceptance (RED→GREEN in `src/DevSquadAdoWorkflowWatcher.recovery.test.ts`): TEST-019/CC-024 across all four mutating methods and both fault shapes; TEST-011 for checkpoint-rejection-after-acquire (claim released, cursor unchanged) and for release-rejection (acknowledged outcome preserved). No raw message or stack appears in the serialized result.
  - Traceability: FR-059; INV-016.

- [x] **W026** Make the duration contract honest across code and docs
  - Rename `budgets.maxPassDurationMs` → `budgets.maxPollStartElapsedMs` and stop reason `duration-budget-exhausted` → `poll-start-budget-exhausted`. The bound gates scheduling, not duration; ledger operations/delays must settle and observation timeout assumes valid delay. Abort requests cooperation, not an unconditional runtime or physical-request ceiling.
  - Rationale: the value was only ever checked between polls, so advertising it as a pass duration was a promise the implementation never made. A strict bound would require abandoning in-flight ledger mutations, which trades a soft guarantee for stranded claims and indeterminate writes.
  - Amend INV-011, SC-005, FR-047, FR-048, the ADR priority list and termination section, and the README.
  - Traceability: FR-047, FR-048; INV-011; SC-005.

- [x] **W027** Fold in the directly coupled medium findings
  - Fail closed with `observation-anchor-missing` when a persisted anchor is absent from a non-empty seam window, and narrow the seam contract to anchor-inclusive windows (FR-035a; CC-023).
  - Keep `changedKinds` and `skippedCursorKinds` disjoint: a kind is skipped only when no persistable cursor exists for it (FR-034).
  - Restate SC-004, INV-006, the ADR, and the README as at-most-once rather than lossless exactly-once.
  - Correct the W015/TEST-023 traceability row and drop the stale "or the watcher derives" pass-identity assumption.
  - Report a seam failure caused by an aborted signal as `cancelled` rather than `observation-failed`.

- [x] **W028** Re-run the validation gate after remediation
  - `npx vitest run src/DevSquadAdoWorkflowWatcher*.test.ts`, `npx vitest run src/DevSquadAdoWorkflowLedger*.test.ts`, `npm run typecheck`, `node scripts/check-public-types-effect-free.mjs` (via `npm run build`), `npx prettier --check` on touched files, `git diff --check`.
  - Acceptance: watcher and ledger suites green; no claim token or secret in any result projection.

---

## Traceability Coverage

| Requirement group | Tasks                              | Tests                                  |
| ----------------- | ---------------------------------- | -------------------------------------- |
| FR-001–FR-008     | W002, W003, W014, W018             | TEST-001, TEST-004, TEST-019, TEST-025 |
| FR-009–FR-015     | W003, W007                         | TEST-002, TEST-003, TEST-018, TEST-024 |
| FR-016–FR-024     | W004, W007, W008, W009             | TEST-005, TEST-006, TEST-007, TEST-015 |
| FR-025–FR-031     | W008, W011, W012, W013             | TEST-008, TEST-009, TEST-010, TEST-011 |
| FR-032–FR-039     | W005, W008, W012, W013, W023, W024 | TEST-004, TEST-012, TEST-013, TEST-022 |
| FR-040–FR-046     | W008                               | TEST-004, TEST-014, TEST-021           |
| FR-047–FR-053     | W006, W009, W010, W007, W026       | TEST-016, TEST-017, TEST-018           |
| FR-054–FR-056     | W014, W016                         | TEST-019, TEST-020, TEST-021           |
| FR-057            | W015                               | TEST-023                               |
| FR-058–FR-059     | W014, W016, W025                   | TEST-019, TEST-021                     |
| INV-001–INV-016   | W007–W017, W023–W026               | TEST-003–TEST-024                      |
| CC-001–CC-024     | W003, W007–W017, W023–W026         | TEST-001–TEST-025                      |

The preceding table records baseline traceability, not fresh proof. The recovery mapping below supplies missing conformance and explicit owners; tests must assert behavior, not merely enumerate reason codes.

---

## Phase 12: Approved PR21 Recovery

Current status (2026-09-10): W029-W037 are complete and W038 is completed TECHNICAL only by the final fresh independent turn-4 PASS, with no blockers and nonblocking TB001 acknowledged. The first failed review (2 Critical, 3 Major, 2 documentation findings), second failed review and third RC14-008 failure remain visibly historical in `review-log.md`; final closure does not erase those results or authorize publication/ADR acceptance.

Execute in order. No production or test edits are part of W029. DevSquad retains lifecycle/specification/planning ownership; Sandcastle remains the offline execution/coordination boundary. No factory, live client, discovery/filtering orchestration, outbox, or ADR-0025 change.

- [x] **W029** Apply approved specification/planning recovery amendments to existing artifacts
  - Amend spec/plan/tasks/review-log and Proposed ADR-0026 only; replace contradictory W007, post-cursor windows, revision examples, release-success promises, unconditional termination and reason-union count.
  - Mark every old approval superseded, preserving historical evidence. Add pending conformance and explicit traceability without claiming newly passing tests.
  - Acceptance: inspect the complete artifact diff; no production/test/ADR-0025 changes, no new planning file, no commits/pushes; `git diff --check`.
  - Traceability: R14-006/007 plus approved lifecycle/traceability corrections.

- [x] **W030** Validate every ledger response at runtime
  - RC14-001/002/003 follow-up: independent pre-invocation snapshots and adapter copies, no shared pending patch/authority, reject in-place request mutation, enforce checkpoint accepted = expected + 1 even on replay and outcome/record consistency when latest = accepted. Preserve valid older replay, wrap only watcher-used methods, and sanitize unreadable method accessors.
  - Implement method-specific read/acquire/renew/checkpoint/release validation of full latest public record and original success metadata, request work-item/owner/token/fencing/outcome/checkpoint consistency, and every known error variant's required fields.
  - RED→GREEN TEST-026/CC-024/029: `{ok:true,value:{}}`, malformed/missing nested payloads, wrong identity/owner/token/fence/outcome/revision, arbitrary error kind and malformed known errors; throws/rejections; exact replay acceptedRevision below latest record; durable mutation followed by malformed acknowledgement.
  - Assert no untyped escape or secret leak, malformed acquire creates no authority/release, malformed acknowledgement emits no unacknowledged cursor changes/signal. Do not alter ledger semantics or reject legitimate replay just because latest state advanced.
  - Traceability: R14-001; FR-059; INV-016. Verify focused recovery tests and `npm run typecheck`.

- [x] **W031** Enforce fresh parent abort and complete signal preflight
  - Validate boolean aborted and both listener methods before any injected side effects.
  - RED→GREEN TEST-027/CC-025: missing/noncallable listener methods, nonboolean aborted, pre-aborted signal, and WI seam returning valid data while aborting parent before PR invocation; assert zero forbidden calls and correct cancelled stop.
  - Traceability: R14-002; FR-003/051. Verify focused validation/bounds tests.

- [x] **W032** Reject duplicate and oversized observation windows
  - RC14-003/005 follow-up: narrowly guard identifier projection; malformed envelopes/collections and accessor failures are `invalid-observation-window`, individual invalid identifiers retain their distinct reason. Two-candidate isolation and unused-payload getter regressions cover the public pass.
  - Check inclusive 1,000-entry length before copy/iteration, accumulate inclusive 1,048,576 UTF-8 identifier bytes and uniqueness before entry retention, preserve 1,024-byte per-ID limit.
  - RED→GREEN TEST-028/CC-019/023/026: WI exact identities, PR exact pairs with null/undefined equivalence only, blank invalid ID, duplicate anchors and nonanchors, duplicate incomplete PR pairs, multi-byte limits, oversized/invalid one-kind invalidating whole candidate, no dedup/truncation/full oversized copy.
  - Exercise aggregate 1,048,576/1,048,577-byte boundaries with PR windows: WI's 1,000 × 1,024-byte maximum is only 1,024,000, so its aggregate ceiling is redundant, not a reason to relax count or per-ID limits.
  - Assert absent persisted anchor fails closed; newest complete new PR pair wins mixed windows with disjoint changes/skips; opaque IDs never sorted/numerically ordered.
  - Traceability: R14-003/005/007; FR-012/034/035/035a/035b. Verify focused observation tests.

- [x] **W033** Cancel observation work and retire every listener/timer
  - One dedicated seam AbortController per observation linked from parent, fresh abort gate before invocation, timeout/abort cancels seam and timer; cleanup success/rejection/throw/timeout/abort paths and quarantine late settlements.
  - RED→GREEN TEST-029/CC-027: capture child signal distinct from parent, parent-forwarding and timeout cancellation, balanced listeners/timers, no unhandled late rejection or late effects; maximum concurrent cooperative seam operations remains one per pass and at most one active observation timer. Demonstrate noncooperating seam may outlive cancellation; do not claim physical termination.
  - Traceability: R14-004; FR-048/051–053; INV-011. Verify focused bounds tests.

- [x] **W034** Surface mandatory truthful claim cleanup and independent counts
  - RC14-004 follow-up: live cancellation gates after the last candidate and during budget-finalizer cleanup, with success/rejection/throw regression cases retaining acknowledged signals, cursor changes, revisions and truthful cleanup counts.
  - Add cleanup to every candidate: `{status: released|failed|indeterminate|not-required, reason: release-acknowledged|release-rejected|release-indeterminate|authority-unvalidated|no-claim-acquired, ledgerErrorKind: known category|"ledger-fault"|null, acceptedRevision: number|null}`.
  - Exactly one release per previously validated authority on completion/error/cancellation; retain local evidence through result validation. Zero release without validated authority; never guess/reacquire/retry. A release replay acknowledges original release, not absence of a later owner.
  - Known rejection (including storage/unchanged) → failed/release-rejected; storage/indeterminate or contention → indeterminate/release-indeterminate; throw/reject/malformed → indeterminate/ledger-fault. Faulting/ambiguous acquire → indeterminate/authority-unvalidated; no claim or uncertainty → not-required.
  - Failed/indeterminate cleanup promotes nonfailed outcomes to ledger-unavailable for ledger-fault, otherwise claim-cleanup-unconfirmed; retain existing primary failed reason. Preserve acknowledged checkpoint revision/cursorChanges AND returned signal without rollback/retraction. Inclusive expiry is the backstop.
  - RED→GREEN TEST-030/CC-028 exercises every matrix row under success/suppression/primary failure/abort/budget/stale-observation/clock or delay fault, malformed acquire zero release, release replay after takeover, and counts. Acted counts returned signals; suppressed acknowledged suppressed advances; failed final failures and may overlap. Four cleanup counts partition every candidate.
  - Traceability: cleanup review extras; FR-006/029/060. Verify focused watcher tests and `npm run typecheck`.

- [x] **W035** Prove revision, authority, metadata and replay semantics
  - RC14-008 follow-up: retain original submitted checkpoint metadata apart from retry revision; reuse the direct acknowledgement guard for history. Cover accepted5/latest5 and accepted6/latest6/cursor480 contradictions, same-revision state/authority/timestamp/PR-cursor contradictions, valid accepted6/cursor481, newer mutation/renewal/takeover history and unchanged retry with pre-submit/pre-retry renewal. Failed history reports no checkpoint revision/cursorChanges/signals and attempts cleanup once with validated authority.
  - RED→GREEN TEST-031/CC-001/002/021/022/030: read4 → acquire5 → checkpoint6 → release7; sourceRevision4, checkpoint revision6, cleanup revision7; unchanged repeat stays at then-current7.
  - Assert takeover revision/fence increments and old fence rejection; PR identity and PR cursor changes between read/acquire abandon stale selection; full intake owner/fencing/expiry/source/phase/status metadata; watcher-level idempotency conflict is terminal without a new ID.
  - Preserve accepted original revision on replay and latest valid record semantics; do not modify ADR-0025 or ledger implementation to fit mistaken examples.
  - Traceability: R14-006, PR/intake/idempotency extras; FR-036a/038/044. Verify focused watcher/ledger regression selectors.

- [x] **W036** Complete configuration boundary conformance
  - RED→GREEN TEST-032/CC-015/030: candidate counts 1/1,000 accepted and 0/1,001 rejected, canonical duplicates rejected, maxPolls 1/10,000 accepted and 0/10,001/unsafe rejected; positive safe durations and backoff bounds; renewal threshold below lease; 24-hour lease inclusive and above rejected; invalid defaults blamed on supplied field.
  - Assert no clock/delay/seam/ledger side effects on invalid input, not just zero mutations.
  - Traceability: preflight/bounds extras; FR-003/004. Verify focused validation tests.

- [x] **W037** Align public types, README and changesets with recovery
  - RC14-006/007 follow-up: replace contradictory README termination/stale-release promises and authoritative pending-implementation status; preserve historical reviews and record the fresh FAILED W038 verdict without granting independent closure.
  - Verify exactly 27 reason codes, four stop reasons, mandatory cleanup exports, known ledger category union and independent counts; Effect-free public declarations and privacy remain mandatory.
  - Update README for bounded unique anchor-inclusive windows, cooperative limits, cleanup evidence, revision distinctions, at-most-once batching and possible signal loss/host reconciliation. All existing changesets were checked: preserve the minor feature changeset with corrected guarantees and add one patch remediation changeset, following the user's explicit bugfix-versioning instruction rather than duplicating a feature release.
  - Acceptance: TEST-025/public-surface assertions, `npm run typecheck`, existing build/public declaration validation; no live clients or lifecycle ownership creep.

- [x] **W038** Independently verify recovery and replace superseded approval only with evidence — **completed TECHNICAL only**
  - Final fresh independent `devsquad.review` turn 4 PASSED: 0 Critical, 0 Major, 1 nonblocking Minor TB001; all five guardians completed and the separate security specialist reported no vulnerabilities. Reviewed worktree over baseline `fb6a238`; parent approved recording the supplied evidence.
  - RC14-008 independently closed: original submitted snapshot retained; history validated before retry refresh; accepted = expected + 1 and operation/time/state consistency enforced, with authority/cursors checked at latest = accepted and valid older acknowledgement retained under newer records. All 36 independently authored in-memory public-pass probes passed (31 boundary + 5 receipt/renewal). The first harness exit 13 was a polling-delay/timer fixture error; corrected fixture passed, no product issue.
  - Historical failures preserved: the third review found Critical RC14-008; the second found SC-01, SC-02, SL14-001 and DOC14-001. Final closure covers original R14-001-007, RC14-001-008 and all cleanup/signal-preflight/bounds/metadata/reason/traceability extras; see the final review-log matrix and existing CC-001-030 / TEST-001-032 mappings.
  - Fresh independent commands: combined watcher/ledger selector 401 passed, 2 existing Windows skips, 11 files; targeted third-history selector 19 passed, 244 deselected; typecheck and public Effect-free declaration guard exit 0; 20-path Prettier passed with existing ignores; tracked/untracked whitespace checks had no diagnostics.
  - Build NOT rerun in this final review. Inherited latest implementer ESM 16.296s and DTS 24.107s passed, then unchanged Windows postbuild `rm` failed (exit 1); template copy not reached. Existing declarations reflect latest code, with no subsequent code changes; no fresh packaging-success claim.
  - TB001 remains acknowledged and nonblocking: older tests at remediation.test.ts lines 953, 1021, 1288 and 2423 use internal guards/object identity, causing refactor coupling. No fix required for this gate.
  - Preserve supplied-candidate/exact host phase/status scope, potentially lossy at-most-once delivery requiring host reconciliation, cooperative cancellation/settling assumptions and one cleanup attempt with inclusive expiry backstop. ADR-0025/0026 remain Proposed; no governance acceptance or merge-ready claim. Parent publication is separate; #20 precedes #21. After publication only, recommend updated #21 head `users/davidsant/symmetrical-train` as next-slice base; slice 15 remains blocked pending the creator's explicit decision.

### Recovery Traceability

| Finding / obligation                              | Owner                        | Requirements              | Conformance / tests          |
| ------------------------------------------------- | ---------------------------- | ------------------------- | ---------------------------- |
| R14-001                                           | W030                         | FR-059                    | CC-024/029; TEST-026         |
| RC14-008 history acknowledgement consistency      | W030/W035                    | FR-036/059; INV-007       | CC-024/029; TEST-026/031     |
| R14-002                                           | W031                         | FR-003/051                | CC-025; TEST-027             |
| R14-003                                           | W032                         | FR-012/034/035            | CC-019/026; TEST-028         |
| R14-004                                           | W033                         | FR-048/051/052/053        | CC-027; TEST-029             |
| R14-005                                           | W032                         | FR-035b                   | CC-026; TEST-028             |
| R14-006                                           | W035                         | FR-005/044                | CC-001/002; TEST-031         |
| R14-007                                           | W029 (text), W032 (behavior) | FR-035a                   | CC-023; TEST-028             |
| Cleanup, signal preservation, counts              | W034                         | FR-006/029/060            | CC-028; TEST-030             |
| PR staleness, intake metadata, takeover, conflict | W035                         | FR-036a/038/044           | CC-021/022/030; TEST-012/031 |
| Full configuration bounds                         | W036                         | FR-003/004                | CC-015/030; TEST-032         |
| SC-01 live indexed array bounds                   | W032/W036                    | FR-004/035b               | CC-015/026/030; TEST-028/032 |
| SC-02 guarded signal/configuration access         | W031/W036                    | FR-003/051                | CC-015/025; TEST-027/032     |
| SL14-001 public-field-only response snapshots     | W030                         | FR-059                    | CC-024/029; TEST-026         |
| DOC14-001 final cancellation priority pseudocode  | W037                         | FR-051/053                | RC14-004 preserved tests     |
| Reason union and public contract                  | W037                         | FR-008/060                | TEST-025                     |
| Verified closure / historical correction          | W038                         | All recovery requirements | CC-001–030; TEST-001–032     |
