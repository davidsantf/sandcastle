# DevSquad/ADO Workflow Watcher Tasks

**Historical third-review follow-up (2026-09-10; superseded by final turn 4):** Critical RC14-008 independently FAILED. Its history-acknowledgement remediation and 19 new bounded public-pass regressions were implemented; W038 was then unchecked and FAILED pending independent re-review. The failure and remediation history remain in `review-log.md`.

Decomposition of [spec.md](spec.md) and [plan.md](plan.md) under [ADR-0026](../../adr/0026-devsquad-ado-workflow-watcher.md), preserving ADR-0021, ADR-0022, ADR-0024, and ADR-0025.

**Historical supplied-candidate recovery status (2026-09-10): W038 COMPLETED TECHNICAL ONLY; final independent turn 4 PASSED, no blockers (0 Critical, 0 Major, 1 nonblocking Minor TB001). Implementation publication COMPLETE at `d5aecf0ba1e276642ddfc683fc756320598642f6`.** W029-W037 prerequisites are complete. All five guardians completed, and the separate security specialist found no vulnerabilities. RC14-008 is independently closed; all earlier findings are closed/preserved in the final closure matrix in `review-log.md`. TB001's older-test internal guard/object-identity coupling is acknowledged, not a required fix. Earlier failed/pending states and superseded PASS verdicts remain historical. See the [authoritative final publication/evidence correction](review-log.md#final-2026-09-10-publication-and-evidence-correction) and [seven original worker reports](final-review-evidence.json) for exact event IDs, role verdicts, limits and code identity. This documentation-only correction does not rerun independent review. Technical conformance does not grant governance acceptance or merge readiness: ADR-0025/0026 remain Proposed; #20 must merge before #21, and slice 15 remains blocked until the creator explicitly decides.

At the historical recovery publication checkpoint, local and published [PR #21](https://github.com/davidsantf/sandcastle/pull/21) implementation head are `d5aecf0`, normally fast-forwarded from `fb6a238`, without merge. Review ran on the uncommitted implementation over `fb6a238`, later committed as `d5aecf0`; no original pre-commit cryptographic snapshot is claimed. This documentation follow-up preserves its `src` tree `f8cc4221f4c2ebd787ad9740acc6bfb1bbd6bf06` and unchanged source/configuration/scripts comparison. Parent will record the resulting documentation-only commit SHA in the PR/handoff, not republish a pending implementation.

**Current discovery extension status (2026-09-10): W039–W046 LOCALLY TECHNICALLY COMPLETE; W046 technical PASS, publication PENDING.** Independent full integration-base re-review turn 3 closed W046-001 with all five guardians accounted for and the required security specialist reporting no vulnerabilities. D1-B, D2/D2-A and D3-A extend existing slice 14 / #21 under the plan's **Approved discovery extension**. W001–W038 remain completed historical supplied-candidate work. See [independent re-review](review-log.md#w046-independent-re-review--2026-09-10-turn-3) and [local evidence closure](review-log.md#w046-local-evidence-only-closure--2026-09-10). Technical PASS is not global-suite/packaging certification, publication, governance acceptance or merge approval. ADR-0025/0026 remain Proposed; #20 must precede #21. Parent owns publication and steps 15–19; this local closure does not execute or authorize later slices.

**Historical decomposition checkpoint:** Prepared against HEAD `aed6637` with the approved spec/plan/ADR amendments and the then-designated `expert-garbanzo` worktree; the historical PR #21/#20 branch references were informational, not live verification. **Historical W045 execution and stop restrictions (superseded by W046 review and local evidence closure):** only `C:\repos\copilot-worktrees\sandcastle\users-davidsant-bookish-doodle`, branch `users/davidsant/bookish-doodle`, starting clean at `8264a25b5962585c9c8d7814242317535e3a01e8`. Older unimplemented/pending summaries in spec/plan/ADR describe the approval checkpoint; those artifacts are outside W045 editing permission and remain unchanged. Local tasks are the work-item source. No board work, remote/PR queries or writes, publication, or slices 15–19 are authorized; commit W045 locally and stop before parent-owned W046.

## Scope and Conventions

- **Historical baseline versus approved extension.** W001–W038 describe supplied-candidate observation and checkpoint recovery. Their no-discovery/no-initialization statements remain applicable to supplied mode and historical scope. W039–W046 implement approved host-injected discovery, complete filtering, authorized first-seen initialization, and anchored pause/reentry. Neither mode owns lifecycle orchestration, live clients, or an outbox.
- **Ordering is the plan's vertical sequence.** Preserve the historical phase ordering. For the extension, execute W039 → W040 → W041 → W042 → W043 → W044 → W045 → W046. Each task depends on its predecessor's accepted increment; no extension task is marked `[P]`.
- **Tests travel with implementation.** Every implementation/remediation task is TDD RED→GREEN; W029 is approved artifact execution and W038 is the final independent verification gate, not substitutes for behavioral tests.
- **Tracer bullet.** W008 (Phase 5) is the first end-to-end vertical: one candidate travels read → observe → claim → checkpoint → intake signal → release. Phases 2–4 exist only because that vertical cannot compile or assert without contracts, identity derivation, and observation projection. For the approved discovery extension, W039 is the first end-to-end tracer bullet: public request → preflight → injected empty terminal page → validated complete result, including cancellation/timeout lifecycle.
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

Current status (2026-09-10): W029-W037 are complete and W038 is completed TECHNICAL only by the final independent turn-4 PASS, with no blockers and nonblocking TB001 acknowledged. The first failed review (2 Critical, 3 Major, 2 documentation findings), second failed review and third RC14-008 failure remain visibly historical in `review-log.md`; final closure does not erase those results or grant ADR acceptance. Implementation publication separately completed at `d5aecf0`. The [final dated authority](review-log.md#final-2026-09-10-publication-and-evidence-correction) and [original seven reports](final-review-evidence.json) distinguish historical implementation, independent review and subsequent publication; this correction reruns none of them.

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
  - Final independent `devsquad.review` turn 4 PASSED: 0 Critical, 0 Major, 1 nonblocking Minor TB001; all five guardians completed and the separate security specialist reported no vulnerabilities. Reviewed uncommitted implementation over baseline `fb6a238`, subsequently published as `d5aecf0`; parent approved recording the supplied evidence. [Portable exact reports](final-review-evidence.json) and the [final attribution table](review-log.md#portable-original-evidence-and-attribution) distinguish static spec/ADR/code guardians from the aggregate parent's runtime probes and the tests worker's execution. No review rerun in this documentary correction.
  - RC14-008 independently closed: original submitted snapshot retained; history validated before retry refresh; accepted = expected + 1 and operation/time/state consistency enforced, with authority/cursors checked at latest = accepted and valid older acknowledgement retained under newer records. All 36 independently authored in-memory public-pass probes passed (31 boundary + 5 receipt/renewal). The first harness exit 13 was a polling-delay/timer fixture error; corrected fixture passed, no product issue.
  - Historical failures preserved: the third review found Critical RC14-008; the second found SC-01, SC-02, SL14-001 and DOC14-001. Final closure covers original R14-001-007, RC14-001-008 and all cleanup/signal-preflight/bounds/metadata/reason/traceability extras; see the final review-log matrix and existing CC-001-030 / TEST-001-032 mappings.
  - Fresh independent commands: combined watcher/ledger selector 401 passed, 2 existing Windows skips, 11 files; targeted third-history selector 19 passed, 244 deselected; typecheck and public Effect-free declaration guard exit 0; 20-path Prettier passed with existing ignores; tracked/untracked whitespace checks had no diagnostics.
  - Build NOT rerun in this final review. Inherited latest implementer ESM 16.296s and DTS 24.107s passed, then unchanged Windows postbuild `rm` failed (exit 1); template copy not reached. Existing declarations reflect latest code, with no subsequent code changes; no fresh packaging-success claim.
  - TB001 remains acknowledged and nonblocking: older tests at remediation.test.ts lines 953, 1021, 1288 and 2423 use internal guards/object identity, causing refactor coupling. No fix required for this gate.
  - The original broader discovery/filtering capability is deferred, not fully delivered: supplied candidates and exact host phase/status rules do not discover/filter tracker candidates or orchestrate lifecycle. Preserve potentially lossy at-most-once delivery requiring host reconciliation, cooperative cancellation/nonsettling dependency limits and one cleanup attempt without guaranteed release, with inclusive expiry backstop. ADR-0025/0026 remain Proposed pending authorized acceptance; no governance acceptance or merge-ready claim. Implementation publication completed at `d5aecf0`; #20 precedes #21. Recommend updated #21 head `users/davidsant/symmetrical-train` as next-slice base only after the creator's explicit decision; slice 15 remains blocked and no archival is authorized.

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

---

## Approved Discovery Extension — Locally Implemented Through W045; W046 Pending

The approved plan's discovery extension and amended Proposed ADR-0026 govern this section. Historical supplied-candidate algorithms remain authoritative for shared observation, fencing, checkpoint acknowledgement/recovery and cleanup.

### Parent Scenarios, Complexity and Dependency Order

These are local task-to-scenario links, not new stories or board items. Scenario numbers refer to `spec.md`.

| Task | Primary parent scenario                            | Supporting coverage                                                 | Complexity / risk | Depends on                                   |
| ---- | -------------------------------------------------- | ------------------------------------------------------------------- | ----------------- | -------------------------------------------- |
| W039 | Scenario 9 — bounded discovery                     | Supplied compatibility; Scenario 5 cancellation                     | M / Medium        | Historical W038; approved plan/ADR alignment |
| W040 | Scenario 8 — eligibility exit/reentry              | Complete matching; Scenarios 1, 3, 4 and 6 existing-record controls | L / High          | W039                                         |
| W041 | Scenario 7 — authorized discovery without comments | Durable fresh-only admission and races                              | L / High          | W040                                         |
| W042 | Scenario 8 — eligibility exit/reentry              | Scenario 6 suppression contrast                                     | M / High          | W041                                         |
| W043 | Scenario 9 — bounded discovery and restart         | Stable traversal, retained state and resource limits                | L / High          | W042                                         |
| W044 | Scenario 9 — restart and retained outcomes         | Scenarios 5, 7 and 8; both intake types                             | L / High          | W043                                         |
| W045 | Scenario 9 — host integration contract             | Public documentation for Scenarios 7–9 and supplied compatibility   | M / Medium        | W044                                         |
| W046 | Scenario 9 — independent conformance gate          | Independent verification of Scenarios 1–9                           | L / High          | W045                                         |

Complexity reflects bounded public-contract and adversarial-case matrices, not a time guarantee. W040, W041, W043 and W044 each own one executable behavioral increment; their acceptance is not deferred to W046. W046 is an independent review gate, not a substitute for implementation tests.

**Exact execution order:** W039 → W040 → W041 → W042 → W043 → W044 → W045 → W046.

### Extension Acceptance Rules

Every extension task inherits the global acceptance constraints and the following:

- Use the plan's named module boundaries where needed; do not restructure unrelated code.
- Begin with failing public-behavior or public-type assertions for the task's acceptance, implement the behavior, and finish with a green focused suite and typecheck. Extend the existing injected harness within the task that needs it; create no separate test-harness or tail-test task.
- Reuse isolated real-ledger fixtures for durability, reopen and publication races. Use recording injected fakes for malformed dependencies, scheduling and cancellation. Keep all tests offline and without wall-clock waits.
- Preserve the 401-pass historical watcher/ledger baseline, two existing Windows skips, focused 19 history regressions, and original-submission contradiction coverage. These are inherited evidence, not fresh discovery results.
- Assert observable behavior through the public pass/validation surface. Do not extend TB001's private-guard/object-identity coupling.
- Supplied callers retain their existing overload, exported interfaces and runtime result shapes. A structurally valid supplied ledger fake implementing the five existing methods must not need `initializeRecord`.
- Discovery initialization uses only existing `initializeRecord`. No ledger schema/storage/capacity changes, receipt eviction, sidecar, outbox, durable page continuation, pause marker or cursor repurposing.
- Matching is not admission authorization. Admission is not execution authorization. Exact phase/status values and lifecycle meaning remain host-owned.
- Whole-page validation and required-fact matching precede item effects. Required raw facts and policy operands are transient; public evidence is allowlisted.
- Existing-record processing reuses the guarded claimed/fenced checkpoint step, including original-request history acknowledgement validation and exactly-once cleanup attempts.
- Initialization intake is fresh-only and potentially lossy. Do not generalize comment-history recovery into admission replay delivery.
- Apply SEC-A01–SEC-A07 in the task introducing each affected surface, not as deferred hardening.
- Do not mark the extension complete until W046 independently verifies it. Neither implementation nor technical review accepts ADR-0025/0026 or grants merge readiness.
- If implementation exposes a genuinely unspecified conformance decision, stop that dependent increment and return through `devsquad.refine`; do not invent a contract.

## Phase 13: Discovery Mode and Empty Terminal Tracer Bullet

- [x] **W039** Implement compatible discovery contracts, preflight and an empty terminal pass in `src/DevSquadAdoWorkflowWatcher.ts`, `src/DevSquadAdoWorkflowWatcherValidation.ts`, `src/DevSquadAdoWorkflowWatcherDiscoveryValidation.ts`, `src/DevSquadAdoWorkflowWatcherDiscovery.ts`, `src/DevSquadAdoWorkflowWatcherObservation.ts`, and `src/index.ts`
  - **Parent:** Scenario 9. **Dependency:** completed historical W038 and approved discovery plan/ADR alignment. **Complexity/risk:** M / Medium.
  - Capture the supplied baseline before implementation using the commands below. Record actual results separately from inherited evidence; do not rewrite historical totals as fresh results.
  - Retain the legacy supplied overload; add discovery-specific and request-union overloads for both public run and validation operations. Keep existing supplied result/intake/validated-pass types unchanged; discovery uses separate discriminated contracts and a `mode: "discovery"` result.
  - Add JSDoc and root exports for contracts introduced here. Keep the public surface Effect-free and orchestration plain `async`/`Promise`.
  - Validate exactly one request arm: omitted or `"supplied"` mode forbids discovery configuration; `"discovery"` requires its seam/configuration and forbids candidates. Reject unknown/mixed modes and malformed required dependencies before clock, delay, seam or ledger invocation.
  - Capture `initializeRecord` only for discovery. Prepare an owned immutable configuration snapshot, including binding, bounded filter configuration, limits and authorization declarations. Reject duplicate canonical authorization IDs, malformed authorized state, unsupported/duplicate predicate slots and invalid limits before effects.
  - Use every default, ceiling, fixed identifier bound and canonical recognized-field byte-accounting rule from the approved plan. Include authorization limits; do not silently truncate, deduplicate or encode an oversized full projection.
  - Wire the empty-terminal vertical: first request has a private traversal ID, ordinal `1`, null continuation and fixed binding; a valid terminal empty page yields zero candidates/signals and complete traversal.
  - Introduce the page call's dedicated child controller/timer lifecycle using existing observation lifecycle protections. Timeout, failure and cancellation yield honest incomplete results; retire listeners/timers and quarantine late settlement.
  - **RED→GREEN acceptance:** In `src/DevSquadAdoWorkflowWatcher.discovery.test.ts` and `src/DevSquadAdoWorkflowWatcher.discovery.bounds.test.ts`, prove supplied compile/runtime compatibility, supplied fake without initializer, zero-effect invalid inputs, valid zero-item discovery, exact/over-limit preflight boundaries, first-request identity, empty terminal completion, pre-abort, page timeout and late rejection cleanup. Confirm no ledger method or comment/PR observation is called for the empty pass.
  - **Traceability:** FR-001–004, FR-006, FR-008–013, FR-051–053, FR-061–064, FR-069; CC-015/016/025/027/034–037; TEST-001/002/025/027/032/036/038/039; SEC-A03/05/06/07.
  - **Verify:** watcher selector, `npm run typecheck`; retain combined watcher/ledger and focused history baseline evidence.

  - **Execution evidence (2026-09-10, W039 only):** Fresh pre-edit baseline: combined watcher/ledger **401 passed, 2 Windows skips**; `npm run typecheck` passed. Initial discovery RED: **20 failed / 13 passed** across 33 tests; failures demonstrated the absent discovery run/validation contracts and defaults, not missing packages. Public type RED showed the three missing discovery exports and absent supplied-mode overload. One legacy fixture was corrected before recording the definitive RED because supplied mode intentionally rejects an empty candidate list.
  - **GREEN:** **47 new discovery tests passed** (15 invocation/lifecycle, 32 configuration/bounds); complete watcher selector **384 passed**; combined watcher/ledger **448 passed, 2 Windows skips**; focused `third independent history` selector **19 passed / 244 unselected**. Typecheck passed. Fresh `npx tsup` generated ESM/DTS, followed by a passing Effect-free declaration guard. This is declaration-generation evidence, **not** Windows postbuild/packaging certification.
  - **Implementation boundary:** Empty-page discovery, separate public overloads/defaults/configuration validation, immutable host snapshots, bounded recognized-JSON accounting and shared child/timer retirement are implemented. The runtime dependency graph allowlist adds the two new modules; historical exact unions remain unchanged. W040 owns nonempty page/fact matching and existing-record forwarding; W041�W045 remain pending. W046 remains parent-owned independent review. No ledger schema/storage, live adapter, lifecycle or publication changes.
  - **Recovery evidence:** Two correction cycles, each using a source-only stash save-point before localization: (1) missed shared empty-candidate validation branch and TypeScript union/loop inference; (2) expected dependency graph/JSDoc checks and overloaded test listener typing. Both corrected; no stash remains. Learning-capture response received (2026-09-10): N, one-time issue; no harness learning captured and no learning file edited. Approved spec/plan/ADR edits are included unchanged in this task's commit; this completion does not accept the full discovery extension.

## Phase 14: Complete Matching and Existing-Record Forwarding

- [x] **W040** Implement whole-page matching and guarded existing-record discovery in `src/DevSquadAdoWorkflowWatcherDiscoveryValidation.ts`, `src/DevSquadAdoWorkflowWatcherDiscoveryMatching.ts`, `src/DevSquadAdoWorkflowWatcherDiscovery.ts`, and `src/DevSquadAdoWorkflowWatcherPass.ts`
  - **Parent:** Scenario 8; supports Scenarios 1, 3, 4 and 6. **Dependency:** W039. **Complexity/risk:** L / High.
  - Validate the complete page and all required fact structures before any item effect. A malformed final entry invalidates otherwise valid earlier entries. Enforce page identity/binding, canonical item uniqueness, count and byte limits.
  - Read fixed recognized fields only, using bounded indexed traversal. Validate lengths before traversal and detect changing/sparse collections; ignore custom iterators and unrelated properties. Do not read getters for unconfigured fact dimensions.
  - Implement all seven predicate slots: state/team `one-of`; tags `all`, `any`, `none`; area/iteration `exact` or segment-aware `subtree`. AND configured predicates, OR members of allowed state/team sets. Reject empty/duplicate configured sets and unsupported operators.
  - Compare host-normalized values exactly, including case, whitespace and Unicode distinctions. Do not infer teams from `assignedTo`, normalize matching strings, split path separators or trust an upstream `eligible` flag.
  - Cover root paths, exact segment counts, subtree root inclusion and textual-prefix sibling exclusion. Known empty collections remain valid facts; required missing facts pause only their candidate.
  - Produce only policy version and fixed predicate outcomes, in the plan's defined order. Missing facts take `matching-facts-missing`; otherwise exclusion takes `matching-paused`. Return no operands, raw facts, authorization IDs, hashes or continuation.
  - Excluded/fact-incomplete candidates perform zero ledger reads, observations or mutations and have no-claim cleanup. Matching occurs before authorization use.
  - Process matched existing records through the existing per-candidate step, preserving optional PR behavior, claim conflicts, staleness checks, fencing, original-submission history validation, suppression and cleanup. Do not fork a weaker discovery checkpoint implementation.
  - Keep supplied missing-record behavior unchanged. Establish stable unauthorized/unavailable-state discovery dispositions without initializing; W041 completes the explicitly authorized missing-record path.
  - **RED→GREEN acceptance:** In `src/DevSquadAdoWorkflowWatcher.discovery.matching.test.ts` and `src/DevSquadAdoWorkflowWatcher.discovery.test.ts`, cover every predicate and combination, empty-versus-missing facts, unrestricted policy, throwing unused getters, exact/+1 bounds and malformed final-entry atomicity. Public-pass assertions prove zero paused-item effects, redacted evidence, canonical page-local order, existing-record checkpoint/intake, foreign-claim skip, stale observation rejection and phase/status suppression with cursor advancement.
  - **Traceability:** FR-005–007, FR-012–024, FR-025–036a, FR-040–045, FR-054–060, FR-063–066, FR-069; CC-001/003–010/018/022/024/026/029/030/032/033/036/037; TEST-034/038/039 plus inherited checkpoint/claim suites; SEC-A03/04/05.
  - **Verify:** watcher selector, focused discovery matching selector, `npm run typecheck`, existing dependency tests.

- **W040 execution evidence (2026-09-10):** Public integrated RED **35 failed / 6 passed** demonstrated rejected nonempty pages and absent matching/forwarding. GREEN **45 matching tests passed**; complete watcher selector **429 passed**; typecheck passed. Includes seven predicates, exact opaque values/paths, missing/empty, ignored getters/iterators, whole-page malformed/duplicate/count/byte rejection, exact escaped/multibyte JSON, canonical ordering, real-ledger checkpoints/suppression, foreign claims and stale acquisition. Shared candidate state/step/finalizer reused; no ledger schema/storage change. Two implementation corrections (union narrowing and shared-export JSDoc); supplementary race fixture corrected twice to use the real ledger's exact expected/authority inputs and bounded token. Source savepoints restored before localization; final checks green. No new harness file captured. W041 onward remain pending; this is not W046 verification.

## Phase 15: Authorized No-Comment Admission

- [x] **W041** Implement fresh-only authorized initialization in `src/DevSquadAdoWorkflowWatcherAdmission.ts`, `src/DevSquadAdoWorkflowWatcherLedger.ts`, `src/DevSquadAdoWorkflowWatcherValidation.ts`, and `src/DevSquadAdoWorkflowWatcherDiscovery.ts`
  - **Parent:** Scenario 7. **Dependency:** W040. **Complexity/risk:** L / High.
  - Initialize only after whole-page matching, a method-valid `record-not-found`, exact canonical-item authorization with initial phase/status, and a fresh cancellation gate.
  - Submit only `{ workItemId, operationId, phase, status }`; leave cursors, PR/execution references, histories and claims absent. Missing authorization or explicit unavailable state performs zero initialization.
  - Derive initialization-specific `dsw2` identity from the approved canonical `{ step: "initialize", workItemId, submissionId, phase, status }` input. Preserve it across retries and pass IDs; exclude traversal/page/continuation/claim identities. Keep existing checkpoint and claim-lifecycle identity bytes unchanged.
  - Keep original submission, validation snapshot, adapter request copy and response projection separate. Reject relevant adapter request mutation. Use a dedicated initialization guard rather than weakening common checkpoint/claim/release acknowledgement rules.
  - Validate every known error variant and the complete bounded latest public record. Unknown/malformed variants, throws and rejections become only `ledger-fault`.
  - Require canonical item identity, initialized discriminator, accepted revision `1`, canonical acceptance time, boolean replay metadata and creation-time consistency. At latest revision one, require exact initial state and pristine null references/cursors, empty histories, no claim and fencing zero.
  - Permit a valid later latest record for fresh or replayed acknowledgement. Validate original state through the first retained checkpoint's `previous` state, or current state when no checkpoint exists, and validate the retained chain. Never confuse latest revision/state with original acceptance.
  - Bind against the retained request and existing trusted ledger semantics; do not fabricate an echoed operation ID, receipt digest or cryptographic proof.
  - Fresh valid acceptance increments admission accounting and returns exactly one `discovery-admission` signal only if intake rules match. Rules-unmatched fresh acceptance is not cursor suppression. Replay reports original acceptance without signal; already-exists infers no acceptance for this request; conflict is terminal without replacement identity.
  - Retain original requests for bounded contention/storage-indeterminate retry. A malformed acknowledgement suppresses unacknowledged effects even if storage committed. Once initialization processing starts, never switch that item to comment observation during the invocation.
  - Every initialization-only outcome has `not-required / no-claim-acquired` cleanup with null category/revision, including uncertainty.
  - **RED→GREEN acceptance:** In `src/DevSquadAdoWorkflowWatcher.discovery.admission.test.ts`, use item `999` with no comments to cover authorized/unauthorized/state-unavailable paths; fresh/rules-unmatched/replay/already-exists/conflict outcomes; same/different submission publication races; unchanged operation identity across pass IDs; every guard success/error variant; request mutation; valid later records and contradictory acknowledgements. Assert zero observation/acquire/checkpoint/renew/release calls, pristine initialization, separately typed signals and at most one admission signal across overlapping passes.
  - **Traceability:** FR-020/022/025, FR-036–039, FR-040–046, FR-051/052, FR-054–060, FR-067–069; CC-009/024/029/031/037; TEST-015/033/039; SC-011; SEC-A01/02/05/07.
  - **Verify:** admission selector, combined watcher/ledger selector, focused history selector, `npm run typecheck`.

- **W041 execution evidence (2026-09-10):** Integrated admission RED **32 failed / 23 passed**, then **61 admission tests passed** in the combined run. Combined watcher/ledger **554 passed / 2 existing Windows skips**; focused original-history selector **19 passed / 244 unselected**; typecheck passed. Fresh/rules-unmatched, authorization absence/state unavailable, same/different-submission races, stable cross-pass identity, bounded retained-request retries, all known error categories, malformed acknowledgements/request mutation and valid/contradictory later records exercised through the public pass. Initializer guard has a method-specific latest-record exception; checkpoint/claim/release rules remain unchanged. No observation or claim effects on initialization-only paths. This does not certify delivery after crash or accept W046.

## Phase 16: Explicit Retention Loss and Anchored Reentry

- [x] **W042** Implement discovery observation retention evidence in `src/DevSquadAdoWorkflowWatcher.ts`, `src/DevSquadAdoWorkflowWatcherObservation.ts`, `src/DevSquadAdoWorkflowWatcherPass.ts`, and `src/index.ts`
  - **Parent:** Scenario 8; supports Scenario 6. **Dependency:** W041. **Complexity/risk:** M / High.
  - Wire discovery-specific work-item and PR observation unions: bounded `window` or explicit `anchor-missing`. Retain existing durable `since` inputs and shared window validation.
  - Explicit retention loss with a supplied anchor yields `observation-anchor-missing`, including otherwise empty responses. Loss without a supplied anchor is invalid. Ordinary empty discovery windows mean known no-new-events; supplied empty behavior remains unchanged.
  - Loss in either observation kind prevents checkpointing the other kind. Preserve existing nonempty missing-anchor, duplicate-window, incomplete-PR and opaque-ID rules.
  - Reentry uses the persisted cursor without a pause marker, synthetic baseline, automatic reset or inferred latest event. Matching pause remains distinct from intake-rule suppression.
  - **RED→GREEN acceptance:** In `src/DevSquadAdoWorkflowWatcher.discovery.lifecycle.test.ts`, seed cursor `480`, exclude the item while `481` arrives, and assert unchanged revision/cursors and zero observation/mutation calls. Reenter and verify `since = 480`, durable advance to `481` and one comment signal. Cover explicit empty loss, nonempty absent anchor, PR loss blocking a valid WI advance, invalid loss without anchor, supplied empty-window control, optional PR method behavior, and suppression advancing cursors without intake.
  - **Traceability:** FR-014/015, FR-032–036a, FR-042, FR-051–053, FR-060, FR-066/069; CC-007/019/023/026/033/037; TEST-035/039; SC-012; SEC-A04/07.
  - **Verify:** lifecycle selector, watcher selector, `npm run typecheck`.

- **W042 execution evidence (2026-09-10):** Fresh baseline after restoring missing development dependencies with `npm ci`: `npm test -- DevSquadAdoWorkflowWatcher DevSquadAdoWorkflowLedger` **554 passed / 2 Windows skips**, `npm run typecheck` passed. Integrated lifecycle RED **6 failed / 13 passed** (after one fixture correction), then GREEN **19 passed**. Combined watcher/ledger GREEN **573 passed / 2 Windows skips**. Separate `devsquad.implement.verify` reran lifecycle **19 passed**, combined **573 passed / 2 Windows skips**, focused `third independent history` **19 passed / 244 unselected**, typecheck, touched-file Prettier and `git diff --check`: scoped PASS. Tests prove persisted-anchor reentry, both-kind retention blocking, invalid unanchored loss, supplied compatibility and cursor-advancing suppression. Shared checkpoint/claim guards remain unchanged. `devsquad.implement.validate` found no spec drift; `devsquad.implement.execute` supplied RED/GREEN implementation, and the conductor records closure after verification. Existing root exports required no edit.
- **W042 validation limitation:** An additional full `npm test` was interrupted after failures and has no final totals or comparable full-suite baseline. Missing `dist/main.js` and unavailable external `cp` were independently confirmed; AgentProvider session and other sandbox/worktree failures remain unclassified, not asserted preexisting or attributed to W042. Scoped verification passed; overall-suite success is not claimed. No packaging build or independent W046 review occurred. Dependency installation reported 49 audit findings; remediation is outside this task.

## Phase 17: Bounded Multi-Page Traversal

- [x] **W043** Implement invocation-local pagination and retained candidate scheduling in `src/DevSquadAdoWorkflowWatcherDiscovery.ts` and `src/DevSquadAdoWorkflowWatcherDiscoveryValidation.ts`
  - **Parent:** Scenario 9. **Dependency:** W042. **Complexity/risk:** L / High.
  - Keep one traversal across polls. Process prior pending candidates in stable first-discovery order, then initiate at most one new page per poll when scheduling permits. Process accepted page candidates sequentially in canonical UTF-8 order; never process a candidate twice in a poll.
  - Preserve the existing start-clock reading, one clock reading per poll, deterministic backoff and elapsed poll-start semantics. Candidate retries do not reset invocation counters.
  - Bind every request/page to the captured scope, partition, stability ID and policy version, plus traversal ID and page ordinal. Forward opaque continuation verbatim; compare only for repetition.
  - Count `pageCalls` immediately before actual invocation, including empty, failed and timed-out calls. Empty continued pages continue; only explicit terminal evidence ends enumeration. No hidden page retry loop.
  - Reject the whole current page for remaining-item overflow, within/across-page canonical duplicates, repeated continuation, malformed page/request identity or binding drift. Preserve earlier accepted outcomes and writes.
  - Bound retained candidate/continuation sets. At exactly the item limit, allow only further empty pages to establish terminal evidence; an additional item is overflow. A terminal final permitted page can complete, but a continued final call is incomplete.
  - Complete only with terminal evidence and finalized accepted-item dispositions, without unfinished retry work. After terminal evidence, ordinary no-new-event states finalize after their observation attempt; genuine pending mutation/recovery work may need more polls.
  - Every new invocation starts at ordinal `1` with null continuation. Persist no traversal metadata and promise no eventual tail progress for repeated bounded prefix rescans.
  - **RED→GREEN acceptance:** In `src/DevSquadAdoWorkflowWatcher.discovery.bounds.test.ts`, cover items `137`/`138` across pages, empty continued pages, page budget two, final-call terminal versus continuation, failed/timeout call counting, no early completion, one page per poll, retained retry order, exact item limit and 1,001 overflow, duplicate canonical IDs, continuation cycles, scope/policy/request drift and earlier intake preservation. Parameterize every plan numeric ceiling and exact/+1 boundary, including multibyte/escaped byte accounting, changing arrays and malformed last entries. Reopen a real ledger and prove a fresh traversal start without duplicate acknowledged comment intake or persisted page tokens.
  - **Traceability:** FR-006/007/012/014/017/018, FR-047–053, FR-057, FR-061–064/069; CC-010/011/027/034–037; TEST-036–039; SC-013/014; SEC-A03/05/06/07.
  - **Verify:** discovery bounds selector, combined watcher/ledger selector, `npm run typecheck`.

- **W043 execution evidence (2026-09-10):** Fresh baseline at `68a16b69fbd8fc30039ebda6c66c599304f674b3`: `npm test -- DevSquadAdoWorkflowWatcher DevSquadAdoWorkflowLedger` **573 passed / 2 existing Windows skips**; `npm run typecheck` passed. Initial integrated `npm test -- DevSquadAdoWorkflowWatcher.discovery.bounds` RED **6 failed / 32 passed** demonstrated discarded checkpoint retries/history, premature terminal completion, lost quiet-candidate scheduling and entry traversal before remaining-item rejection. First GREEN **38 passed**. Expanded boundary controls reached **79 passed** after one fixture correction cycle for Unicode transport and JSON escape-byte assumptions; an earlier fixture array typing issue was corrected once. No numeric contract was relaxed.
- **W043 regression recovery and final gates:** The first expanded combined gate was **619 passed / 1 failed / 2 existing Windows skips**: the retained W040 stale-acquisition case timed out because released stale observations were mistakenly retained after terminal evidence. A deterministic public-pass regression (after one exact-authority fixture correction) was RED **1 failed / 1 passed / 79 unselected**, proving an unwanted second poll. Terminal finalization now distinguishes no-pending-mutation states, including released stale observations, from genuine checkpoint/admission retries. Bounds plus matching GREEN **126 passed**. Final `npm test -- DevSquadAdoWorkflowWatcher.discovery.bounds` **81 passed**; final combined watcher/ledger **622 passed / 2 existing Windows skips** (including W041 admission **61 passed**, W042 lifecycle **19 passed**); `npm test -- DevSquadAdoWorkflowWatcher.remediation -t "third independent history"` **19 passed / 244 unselected**; `npm run typecheck`, touched-file Prettier and `git diff --check` passed.
- **W043 acceptance coverage:** Public-pass tests cover first-discovery retry order, one page and at most one item step per poll, retained checkpoint request/authority and original-submission history recovery, no early completion, start/poll clock readings, deterministic backoff and elapsed boundaries; items `137`/`138`, empty continued pages, page budget two and the 1,000-call ceiling, terminal versus continued final calls, failed/timeout counting; whole-page canonical duplicate/continuation cycle/binding/request drift/malformed/changing-array/overflow rejection with earlier intake preserved; exact 1,000-item and 1,001 overflow including empty terminal tails; every plan numeric ceiling and inclusive/+1 boundaries, required facts, multibyte/escaped and exact maximum aggregate JSON bytes. A real ledger reopen proves ordinal `1`/null continuation, fresh traversal identity, unchanged durable artifacts and no duplicate acknowledged comment intake or persisted page tokens. Shared step/finalizer and ledger guards are reused unchanged; no durable schema or traversal metadata was added. Covers FR-006/007/012/014/017/018, FR-047-053/057/061-064/069 and CC-010/011/027/034-037.
- **W043 scope/limitations:** Only W043 source/tests/evidence changed. IDE/LSP tools were unavailable; text navigation, typecheck and scoped tests were used. No new dependencies, install, remote operations, whole-repository `npm test`, packaging/deployment, independent W046 review, ADR/spec amendment, harness-learning write or later task occurred. The W042 overall-suite limitation above remains unchanged; scoped success is not overall-suite success or governance acceptance. ADR-0025/0026 remain Proposed; W044/W045/W046 and stale introductory/footer status are not completed by this evidence.

## Phase 18: Integrated Retry, Cancellation and Truthful Accounting

- [x] **W044** Implement cross-mode discovery finalization and acknowledgement-preserving cancellation in `src/DevSquadAdoWorkflowWatcherDiscovery.ts`, `src/DevSquadAdoWorkflowWatcherAdmission.ts`, `src/DevSquadAdoWorkflowWatcherPass.ts`, and `src/DevSquadAdoWorkflowWatcherObservation.ts`
  - **Parent:** Scenario 9; supports Scenarios 5, 7 and 8. **Dependency:** W043. **Complexity/risk:** L / High.
  - Complete the result assembler for observation, admission, matching and unprocessed outcomes, preserving first-discovery/page-local outcome order and acknowledgement-order signals.
  - Implement every approved traversal reason and stop-reason distinction. Expose terminal evidence separately: terminal page seen does not erase unfinished retries, budget exhaustion or cancellation.
  - Keep counts independent: page calls, pages validated, discovered, evaluated, admitted, paused, processed and initialization replayed; `acted` counts both signal types, `eligible` retains existing observation meaning, and `suppressed` counts only acknowledged suppressed cursor advances. Final failures may overlap acknowledged actions.
  - Give validated but unscheduled candidates explicit unprocessed dispositions; exclude rejected-page identities from accepted discovery/outcome counts. Cleanup counts partition all returned candidates.
  - Apply fresh abort gates before pages, candidate effects, each WI/PR observation and non-cleanup mutation; recheck after page settlement, awaited ledger operations, between candidates and before completion/budget exits.
  - Await in-flight initialization/checkpoint operations and validate acknowledgements. Preserve permitted fresh admission/comment signals when abort occurs during the write. Retire page/observation lifecycles and consume late rejections without late effects.
  - Preserve exactly one cleanup attempt for validated existing-record authority, including after abort. Never release for initialization-only or fabricate acknowledgement after uncertainty.
  - Complete retained-request retry and restart composition: stable initialization identity across pass IDs; no discovery delivery reconstruction after lost acknowledgement/reopen; no same-invocation comment fallback after replay/already-exists; genuine comments remain observable later.
  - Preserve the separate checkpoint direct/replay/history validator against original submitted metadata, including history-before-retry-refresh, renewal and later-record consistency. Do not apply fresh-only admission rules to comment recovery.
  - **RED→GREEN acceptance:** In `src/DevSquadAdoWorkflowWatcher.discovery.lifecycle.test.ts` and `src/DevSquadAdoWorkflowWatcher.discovery.admission.test.ts`, exercise mixed admission/observation/paused/failed/unprocessed pages, terminal pages with retries, later-page failure, exact accounting partitions and at most one signal per item. Cover every abort boundary, durable initialization followed by lost/malformed acknowledgement and reopen, abort during accepted initialization/checkpoint, cleanup failures retaining signals, noncooperating late seam settlement and no fabricated release. Scan results, errors, diagnostics, submitted ledger fields and durable artifacts for forbidden fact/policy/authorization/continuation/capability sentinels, allowing only expressly authorized initial workflow values and public identifiers.
  - **Traceability:** FR-005–007, FR-029, FR-036–039, FR-044–060, FR-062/063/067–069; CC-012/024/027–031/034/035/037; TEST-026/029–031/033/036/037/039; SC-004–011/013/014; SEC-A01–SEC-A07.
  - **Verify:** combined watcher/ledger selector, focused history selector, `npm run typecheck`; no inherited regression loss.

- **W044 execution evidence (2026-09-10):** Fresh baseline at `6f7432127b2921ca25855ef9374d162db8352372`: `npm test -- DevSquadAdoWorkflowWatcher DevSquadAdoWorkflowLedger` **622 passed / 2 existing Windows skips**, and `npm run typecheck` passed. The separately reported W043 verify-worker **622 passed / 2 skips**, history **19 passed / 244 unselected** remains inherited evidence, not a new claim about that worker's execution.
- **W044 public RED to GREEN:** Before any production change, `npm test -- DevSquadAdoWorkflowWatcher.discovery.lifecycle DevSquadAdoWorkflowWatcher.discovery.admission` was initially **2 failed / 91 passed**, then **2 failed / 103 passed**, then **2 failed / 109 passed** as controls expanded. Both failures were behavioral: matching-excluded/fact-incomplete accepted items lost their paused counts when unscheduled after initialization-triggered abort; a second retained checkpoint reported budget uncertainty instead of cancellation raised during the first cleanup. Two independent test typing issues (fixture literal/union inference, then optional observation signal) each needed one correction before typecheck passed; neither was counted as behavioral RED. Count pauses from completed page matching, and freshly read abort in the shared candidate finalizer without retracting acknowledged outcomes. First focused GREEN **111 passed**; final expanded focused GREEN **120 passed** (lifecycle **46**, admission **74**; **40 new tests**, no focused skips).
- **W044 accounting/traversal acceptance:** Public mixed-page tests prove page-local/first-discovery outcome order versus acknowledgement-order admission/comment signals, at most one signal per item, retained checkpoint identity/retry order, exact independent counts and all four cleanup partitions. A terminal page with unfinished checkpoints remains incomplete on budget/cancellation. Validated unscheduled items are explicit unprocessed outcomes while retaining matching evaluation/paused counts. Later failed/duplicate/unstable pages preserve earlier admission and exclude every rejected-page ID. Existing W043 bounds tests remain green for every approved traversal/stop reason, terminal versus continued limits, polling/backoff and original-submission history recovery. Covers FR-005-007/029/036-039/044-050/054-060/062/063/067-069 and CC-024/027-031/034/035/037.
- **W044 cancellation/recovery acceptance:** Tests cover pre-pass, poll clock, page settlement/validation, pending page/WI/PR calls, post-read, WI-to-PR, acquisition, renewal, checkpoint, recovery read, release, between candidates/cleanup attempts/polls, pre-initialization and between admission retries. Deferred real initialization/checkpoint writes remain awaited after abort; valid fresh initialization and fresh/replayed/history comment acceptance retain permitted signals even with failed cleanup. Lost/malformed acknowledgements infer no delivery; malformed/lost acquisition fabricates no release authority. Existing-record validated claims receive exactly one cleanup attempt, initialization receives none. Real ledger reopen after lost/malformed initialization neither reconstructs discovery delivery nor seeds cursors; genuine later comments still signal. Replay/already-recorded initialization never falls back to observation in that invocation, and retained submission identity remains stable across pass IDs. Noncooperating page/WI/PR lifecycles cover abort and timeout, late fulfillment/rejection, child/timer abortion and matching listener removal, with unchanged outcomes/artifacts after late settlement. Covers FR-036-039/046-053/059/068/069 and CC-012/024/029-031/035/037.
- **W044 privacy/final gates:** Sentinel scans cover public results (including errors), read/list/diagnostic projections, submitted mutation fields and every durable artifact; raw facts, policy values, authorization submission, continuation, dependency errors/bodies and actual generated capabilities are absent. Necessary capability-bearing authority fields are checked separately on mutation input only; explicitly authorized initial workflow values and public IDs remain permitted. No ledger schema, original-submission validator, initialization request/acknowledgement guard or seam lifecycle implementation was changed. Final combined watcher/ledger gate **662 passed / 2 existing Windows skips**; `npm test -- DevSquadAdoWorkflowWatcher.remediation -t "third independent history"` **19 passed / 244 unselected**; `npm run typecheck`, touched-file Prettier and `git diff --check` passed. Covers SEC-A01-SEC-A07, TEST-026/029-031/033/036/037/039 and SC-004-011/013/014 through new public controls and the retained combined suite.
- **W044 scope/limitations:** Only W044 production fixes, lifecycle/admission tests and this checkbox/evidence changed. Admission and observation modules were intentionally retained: new public integration controls pass their existing acknowledgement/lifecycle behavior. IDE/LSP tools were unavailable; text navigation, typecheck and scoped tests were used. No dependency install, live Azure SDK/transport, remote/PR/board operation, branch change, push, packaging/deployment, overall `npm test`, W046 review, spec/ADR amendment, harness-learning write or later task occurred. Overall-suite and Windows packaging limitations remain unresolved; scoped PASS is not overall-suite, packaging or governance acceptance. W045 retains exports/README/changeset alignment and stale introductory/footer status. ADR-0025/0026 remain Proposed; parent independent verification follows this commit. A Windows default-encoding failure while writing this evidence was corrected once using explicit UTF-8 from the unchanged HEAD artifact; no historical evidence was rewritten.

## Phase 19: Public Documentation and Release Alignment

- [x] **W045** Align public exports and host documentation in `src/DevSquadAdoWorkflowWatcher.ts`, `src/index.ts`, `README.md`, and `.changeset/devsquad-ado-workflow-watcher.md`
  - **Parent:** Scenario 9; supports Scenarios 7 and 8. **Dependency:** W044. **Complexity/risk:** M / Medium.
  - Audit and complete JSDoc/root exports for all new discovery contracts, defaults and overloads. Preserve legacy supplied inference and runtime shapes; consumers of supplied signals must not narrow a new admission union.
  - Document both modes, complete matching semantics, normalized facts/resolved teams, explicit item authorization/state, policy-version evidence, page/poll/byte bounds, anchored reentry, terminal/incomplete results and all host responsibilities.
  - Provide typed offline examples for empty discovery, authorized no-comment admission and existing-record reentry. Explain distinct discovery/comment intake, replay reconciliation without redelivery, no-claim cleanup, possible permanent signal loss, fresh-start prefix rescans and cooperative dependency limits.
  - Check all existing changesets before editing. Extend the existing minor watcher feature changeset for approved new behavior; preserve the separate historical patch recovery entry without duplicating a feature release.
  - Extend `src/DevSquadAdoWorkflowWatcher.dependencies.test.ts` to cover every new production module and forbidden dependency boundary. Keep unrelated ADO/execution modules, ledger schema/storage and tooling unchanged.
  - **Acceptance:** Public compile assertions and example fixtures under `src/DevSquadAdoWorkflowWatcher.discovery.test.ts` pass; documentation matches observed discriminators/limits; dependency tests pass; generated public declarations are Effect-free. Record build generation and postbuild/package outcomes separately. Update task evidence in this file without altering historical W038 evidence or marking ADRs Accepted.
  - **Traceability:** FR-008–011/040/044/045/058/061–069; CC-003/018/020/031–037; TEST-024/025/033–039; SC-007/009/010/014.
  - **Verify:** full watcher/ledger selector, typecheck, canonical build, public declaration check against freshly generated declarations, formatting and diff checks.

- **W045 execution and provenance (2026-09-10):** Worked only in the designated `users-davidsant-bookish-doodle` worktree/branch from clean `8264a25b5962585c9c8d7814242317535e3a01e8`. Read approved discovery requirements/ADR-0026 before retained baseline/ADR-0021/0022/0024/0025, project guidance, test discipline and git-commit skill. All `.changeset` entries were inspected first; package name is `@ai-hero/sandcastle`. Extended the existing minor watcher feature entry (pre-1.0); the separate `watcher-contract-recovery.md` historical patch is unchanged. Prior independent verify-worker results supplied by the parent are inherited, not this worker's reruns: W042 `68a16b6` **573 passed / 2 Windows skips**, W043 `6f74321` **622 passed / 2 skips**, W044 `8264a25` **662 passed / 2 skips**, each with focused history **19 passed / 244 unselected** and a separate scoped PASS. No independent reviewer was invoked by W045.
- **W045 fresh baseline and integrated RED:** `npm test -- DevSquadAdoWorkflowWatcher DevSquadAdoWorkflowLedger` **662 passed / 2 Windows skips** (16 files, exit 0); `npm run typecheck` passed (exit 0). Before documentation/guardian implementation, `npm test -- DevSquadAdoWorkflowWatcher.discovery.test DevSquadAdoWorkflowWatcher.dependencies` was **5 failed / 29 passed** (exit 1): side-effect import, literal dynamic import and CommonJS import syntax escaped dependency protection; discovery/runtime-union run overloads lacked their own JSDoc; README lacked the exact executable typed fixture. Runtime examples and public compile assertions already passed against established behavior; no artificial behavior failure was introduced. Test-first `npm run typecheck` passed. First focused GREEN was **34 passed** (exit 0); subsequent added active supplied-mode and external/direct-effect controls also passed without implementation correction.
- **W045 public contract/documentation acceptance:** Audited all root types/defaults and run/validation overloads. All required exports already existed; root annotation and JSDoc now distinguish supplied/discovery/runtime-union contracts without changing declarations' type shapes or runtime algorithms. Compile assertions retain exact supplied inference, discovery inference, runtime-union inference and discriminated signal fields; active supplied passes in both implicit/explicit modes prove no initializer inspection, unchanged signal shapes and unchanged missing-record behavior. The exact README fixture is compiled and executed against a real ledger for empty terminal discovery, authorized item 999 without comments/claims, paused item 137 and persisted-anchor reentry from 480 to 481, then repeat without redelivery. Documentation covers full matching semantics, normalized facts/resolved teams, explicit authorization/state, minimized policy evidence, every default/ceiling and recognized JSON byte accounting, loss anchors, page-per-poll scheduling, terminal-versus-pending retries, accounting, claim-free cleanup, permanent signal loss/replay reconciliation, fresh prefix rescans without eventual tail progress and cooperative settling dependencies. Dependency guardians inventory all nine production watcher modules, traverse the shared schema graph, guard type/runtime imports including side-effect/dynamic/CommonJS forms, reject unreviewed external dependencies/direct host-effect primitives and keep internal helpers private. They are static regression protection, not a sandbox for arbitrary code. Covers FR-008–011/040/044/045/058/061–069; CC-003/018/020/031–037; TEST-024/025/033–039; SC-007/009/010/014.
- **W045 final scoped GREEN:** `npm test -- DevSquadAdoWorkflowWatcher.discovery DevSquadAdoWorkflowWatcher.dependencies` **283 passed**, six files, no skips; exact `npm test -- DevSquadAdoWorkflowWatcher.discovery` **266 passed**, five files, no skips; final combined `npm test -- DevSquadAdoWorkflowWatcher DevSquadAdoWorkflowLedger` **676 passed / 2 Windows skips**, 16 files (14 new tests: five public-example/compatibility tests and nine guardians). `npm test -- DevSquadAdoWorkflowWatcher.remediation -t "third independent history"` **19 passed / 244 unselected**, one file. All exited 0. The two platform skips are the Linux-only production initialize/acquire/checkpoint/reopen/list/release test and the non-Windows 1,000-record production listing test; history's 244 are selector exclusions, not new platform skips. Final `npm run typecheck` passed (exit 0).
- **W045 canonical build/declaration evidence:** Required `npm run build` ran `tsup` 8.5.1 with clean output and freshly generated **ESM success (18,404 ms)** and **DTS success (27,492 ms)**. It emitted unused external-import warnings for `createRequire` and `Readable`. Overall command **exit 1**: Windows postbuild could not find `rm`; the chained `cp` and declaration guard did not execute in that command. No script workaround/fix was made and packaging success is not claimed. Then standalone `node scripts/check-public-types-effect-free.mjs` checked the freshly generated declarations and **passed (exit 0)**; this is not a stale-artifact claim. The approved expected postbuild limitation does not block this local W045 closure.
- **W045 hygiene and limits:** Touched-file `npx --no-install prettier --check src/DevSquadAdoWorkflowWatcher.ts src/index.ts README.md .changeset/devsquad-ado-workflow-watcher.md src/DevSquadAdoWorkflowWatcher.dependencies.test.ts src/DevSquadAdoWorkflowWatcher.discovery.test.ts docs/features/devsquad-ado-workflow-watcher/tasks.md`, an explicit changeset check with `--ignore-path .gitignore` (root Prettier normally ignores `.changeset`), and `git diff --check` passed before staging. LF/UTF-8, historical W038 evidence, historical patch changeset, spec/plan/ADRs, package/dependency files, tooling and runtime implementation are preserved. IDE/LSP tools were unavailable; `git grep`, scoped tests and typecheck were used without an IDE claim. No install, agents, live client/SDK/transport, remote/PR/board operation, branch change, push, full `npm test`, global formatting, harness-learning write, W046 review, deployment or later slice occurred. The earlier interrupted full-suite run remains unresolved with no comparable full baseline; platform/session/sandbox failures are unclassified, not proven preexisting. Scoped PASS and fresh declarations are not overall-suite or packaging PASS, extension approval, publication, ADR acceptance or merge readiness. W046 stays unchecked for the parent's independent full integration-base review.

## Phase 20: Independent Extension Verification

- [x] **W046** Independently verify discovery conformance against `docs/features/devsquad-ado-workflow-watcher/spec.md`, `plan.md`, `tasks.md`, and `docs/adr/0026-devsquad-ado-workflow-watcher.md`; record task status/evidence in `docs/features/devsquad-ado-workflow-watcher/tasks.md`
  - **Parent:** Scenario 9; verifies Scenarios 1–9. **Dependency:** W045. **Complexity/risk:** L / High; requires independent human/reviewer judgment.
  - Invoke fresh independent `devsquad.review` through the conductor's established review workflow. Review spec/ADR consistency, production code, tests, dependency boundaries and security controls; do not treat implementer self-checks or W038 as extension approval.
  - Verify CC-031–037 and TEST-033–039 end to end while retaining CC-001–030, TEST-001–032 and the focused historical checkpoint-history probes. Independently probe original-request initialization binding, fresh/replay/later-record acknowledgement distinctions, whole-page atomicity, exact matching, anchored retention loss, scheduling bounds, cancellation and count/cleanup truth.
  - Confirm no live clients/queries, external writes, execution/lifecycle authority, ledger schema/storage changes, durable continuation, outbox, fabricated cursors/claims or replay admission delivery.
  - Record exact reviewed code identity, commands, results, skips, findings and evidence provenance. Distinguish newly executed evidence from inherited reports and declaration/build artifacts.
  - **Acceptance:** Independent review has no unresolved blocking findings; all guardians/security obligations are accounted for; new conformance is supported by executed assertions. A failed review leaves W046 unchecked until remediation and independent re-review. Do not reopen completed W001–W038 or erase their historical evidence.
  - A technical PASS does not accept Proposed ADR-0025/0026, grant publication/merge authority, create board work or authorize slice 15. Preserve #20-before-#21 ordering and leave publication to the parent.
  - **Traceability:** FR-001–069 including FR-035a/035b/036a/037a; CC-001–037; TEST-001–039; SC-001–014; SEC-A01–SEC-A07.
  - **Verify:** all commands below, with exact scope/results and the known packaging limitation reported honestly.

### Discovery Traceability

| Approved obligation                                             | Owning tasks                | Requirements                                   | Conformance / tests                                               | Scenario / success criteria         |
| --------------------------------------------------------------- | --------------------------- | ---------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------- |
| Compatible explicit discovery mode and zero-effect preflight    | W039, W045                  | FR-001–004/008/061/064                         | CC-015/016/025/036/037; TEST-001/002/025/027/032/038/039          | Scenario 9; SC-010/014              |
| D2 complete exact matching and minimized evidence               | W040                        | FR-064–066/069                                 | CC-032/036/037; TEST-034/038/039                                  | Scenario 8; SC-012/014              |
| Existing-record forwarding without weaker checkpoint safeguards | W040, W042, W044            | FR-014–019/021/025–036a/040–046/059/060        | CC-001–008/019/021–030/033/037; inherited tests plus TEST-035/039 | Scenarios 1–6 and 8; SC-001–010/012 |
| D1-B explicit no-comment authorization and fresh-only admission | W041, W044                  | FR-020/022/025/037–039/044–046/059/060/067–069 | CC-009/024/029/031/037; TEST-015/033/039                          | Scenario 7; SC-004/006/011/014      |
| D2-A pause, preserved anchors and explicit retention loss       | W040, W042                  | FR-035a/042/066                                | CC-023/032/033; TEST-034/035                                      | Scenarios 6 and 8; SC-012           |
| D3-A fresh-start multi-page traversal and bounded state         | W039, W043, W044            | FR-018/047–050/057/061–064                     | CC-034–036; TEST-036–038                                          | Scenario 9; SC-005/008/013/014      |
| Whole-page atomicity and inclusive collection/UTF-8 limits      | W039, W040, W043            | FR-003/004/035b/063/064                        | CC-026/035/036; TEST-028/038                                      | Scenario 9; SC-014                  |
| Cancellation, acknowledgement preservation and truthful counts  | W039–W044                   | FR-005–007/029/051–053/059/060/069             | CC-012/024/025/027–029/037; TEST-027/029/030/033/039              | Scenarios 5, 7–9; SC-005–009/014    |
| Public compatibility, privacy and host documentation            | W045; controls in W039–W044 | FR-008–011/040/044/045/058/061–069             | CC-003/018/020/031–037; TEST-024/025/033–039                      | Scenarios 7–9; SC-007/009/010/014   |
| Independent extension gate, preserving historical evidence      | W046                        | All approved requirements                      | CC-001–037; TEST-001–039                                          | Scenarios 1–9; SC-001–014           |

All new requirements FR-061–069 and conformance criteria CC-031–037 have implementation owners. Each new task has a parent scenario and explicit prerequisite. No separate behavioral test task or missing-ADR task is introduced.

### Validation Commands and Evidence Rules

Historical W045 validation was scoped and ran only from the designated worktree (historical W038 commands/evidence above remain unchanged):

```powershell
Set-Location "C:\repos\copilot-worktrees\sandcastle\users-davidsant-bookish-doodle"

npm test -- DevSquadAdoWorkflowWatcher
npm test -- DevSquadAdoWorkflowWatcher DevSquadAdoWorkflowLedger
npm test -- DevSquadAdoWorkflowWatcher.remediation -t "third independent history"
npm run typecheck
```

Implemented focused extension selectors:

```powershell
npm test -- DevSquadAdoWorkflowWatcher.discovery
npm test -- DevSquadAdoWorkflowWatcher.discovery.matching
npm test -- DevSquadAdoWorkflowWatcher.discovery.admission
npm test -- DevSquadAdoWorkflowWatcher.discovery.bounds
npm test -- DevSquadAdoWorkflowWatcher.discovery.lifecycle
```

W045 build and touched-file verification (not a full-suite or global-format gate):

```powershell
npm run build
node scripts/check-public-types-effect-free.mjs
npx --no-install prettier --check src/DevSquadAdoWorkflowWatcher.ts src/index.ts README.md .changeset/devsquad-ado-workflow-watcher.md src/DevSquadAdoWorkflowWatcher.dependencies.test.ts src/DevSquadAdoWorkflowWatcher.discovery.test.ts docs/features/devsquad-ado-workflow-watcher/tasks.md
npx --no-install prettier --ignore-path .gitignore --check .changeset/devsquad-ado-workflow-watcher.md
git diff --check
```

The earlier draft's full `npm test` / global `npm run format:check` commands are not W045 authorization. Full-suite validation remains unresolved and parent-owned; do not classify unexplained earlier platform failures as preexisting. W046 was subsequently completed by independent full integration-base re-review turn 3; the evidence-only closure does not rerun these commands.

- Historical implementation baseline `d5aecf0`: combined watcher/ledger selector **401 passed, two existing Windows skips**; focused third-history selector **19 passed**. These totals are inherited, not newly executed by decomposition.
- Record actual new counts, skip reasons and command exit codes. Full-project failures, if any, require attributable evidence rather than silently redefining success.
- The canonical build has a preexisting Windows postbuild `rm` failure after ESM/DTS generation passes. Preserve and report that limitation; do not fix unrelated tooling or claim packaging success. Record whether fresh ESM and DTS generation actually completed.
- The declaration guard consumes generated `dist` output. A standalone successful guard against stale declarations is not fresh public-surface evidence.
- Formatting failures from untouched files must be reported separately from touched-file verification; do not reformat the repository as collateral work.
- At the historical decomposition checkpoint no validation commands were executed. W039–W045 execution evidence above now records actual local commands/results, separately from inherited reports; it is not W046 review.

### Historical W045 Local Implementation Handoff (Superseded by W046 Closure)

- **Scope:** Existing slice 14 / PR #21 only; local tasks, no board items or delegation assignments.
- **Task state:** W001–W038 preserved completed; W039–W045 locally implemented; W046 PENDING independent full integration-base review, parent-owned.
- **Next:** Commit W045 locally and stop. Only the parent owns subsequent W046 review; no overall extension approval is recorded.
- **Authoritative inputs:** `spec.md`; the plan's **Approved discovery extension**; Proposed `docs/adr/0026-devsquad-ado-workflow-watcher.md`.
- **Preserved boundaries:** Proposed ADR-0025; ADR-0021, ADR-0022 and ADR-0024; existing ledger canonicalization/storage and supplied checkpoint recovery.
- **Supporting evidence:** `review-log.md` and `final-review-evidence.json` remain historical supplied-candidate evidence, not discovery review.
- **Assumptions:** Host-normalized facts/resolved teams, stable bounded invocation scope, explicit item authorization/state, trusted ledger publication semantics, and settling ledger/delay dependencies. Admission can permanently lose intake; prefix rescans have no eventual tail-progress guarantee.
- **Governance:** ADR-0025/0026 remain Proposed; #20 precedes #21. This closure authorizes only the local W045 commit. No new PR/remote/board action, push, publication, merge, ADR acceptance or slices 15–19; W046 and publication decisions remain parent-owned.

### Historical W046-001 Remediation Handoff — 2026-09-10, Turn 2 (Superseded by Independent Turn 3)

- W046 remains **unchecked**, with historical independent FAIL preserved. W046-001 has an implementation correction awaiting independent re-review, not an independent closure.
- Both admission paths now consume the captured validated intake phase/status arrays. Twenty public integrated regression cases cover ordinary controls, overridden/throwing caller methods and page/retry-time mutations across both dimensions, without changing initialization authority.
- Execute-worker baseline: 74 admission tests passed. Public test-first RED: 16 failed / 78 passed with production unchanged. GREEN and fresh verify: 94 passed. Fresh scoped watcher/ledger: 696 passed / 2 platform skips; historical checkpoint-history selector: 19 passed / 244 exclusions. Typecheck and touched-source formatting/whitespace checks passed.
- Fresh canonical build generated ESM and DTS successfully, then exited 1 at the known Windows postbuild rm failure. The separately executed Effect-free guard passed against the fresh declarations. Packaging and global-suite success are NOT certified; the execute worker's interrupted full-suite attempt and transient concurrent timeouts are disclosed in the review log.
- Full provenance, commands, limitations and decision summary: review-log.md, section **W046-001 implementation remediation — 2026-09-10, turn 2**. The conductor handoff supplies the final commit HEAD/tree.
- Scope remains local slice 14 only. No board/live/publication actions or slices 15–19; ADR-0025/0026 remain Proposed. Next: conductor-owned independent re-review, not W046 completion by the implementer.

### Current W046 Local Technical Closure and Parent Handoff — 2026-09-10

- **Task state:** W039–W046 locally technically complete; W046 **PASS**, checkbox completed from the existing independent full-slice review, not implementer self-review. W001–W038 history is preserved. W046-001 is independently closed; retained baseline TB046-001–003 remain Major and TB001 remains nonblocking Minor.
- **Traceability / identity:** W046 acceptance covers FR-001–069 including suffixes, CC-001–037, TEST-001–039, SC-001–014 and SEC-A01–A07. Independent turn 3 reviewed the full delta `9ff6e8e9f74792e131e927bd9bf41358e36cea95` → `9854e9ea5f739ee5ba8a605a97a7fd3569a9cce3`, reviewed tree `7519db940767937691d2ffc41d2bf3a2921711e7`, `src` subtree `6e7c6d3ffb2bdc082b371be38efd773fbfa14a38`. All five guardians and required security specialist are accounted for; no remaining slice blockers.
- **Previously executed evidence, NOT rerun by this closure:** Combined watcher/ledger 696 passed / 2 Windows skips; focused history 19 passed / 244 selector exclusions (subset); 32 independent public probes; typecheck, scoped formatting, diff and declaration guard PASS. Review guard execution used inherited fresh remediation-generated declarations. Remediation ESM and DTS generation succeeded, then canonical `npm run build` failed at Windows postbuild `rm`. Packaging and global-suite certification remain excluded; eight baseline failures and interrupted global-attempt limitations remain in the log.
- **Local action only:** Commit `tasks.md` and `review-log.md` on `users/davidsant/bookish-doodle`, with scoped documentation formatting/diff and the existing hook. No new independent review, source/test/configuration changes, board transitions or remote writes. See [local closure evidence](review-log.md#w046-local-evidence-only-closure--2026-09-10) for preservation measurements and parent-supplied CI/publication evidence.
- **Parent handoff:** Publication remains pending. Parent owns steps 15–19, including subsequent publication/status assessment; this worker does not run them. Existing PR #21 still has parent-reported remote head `aed663765a3a8bcc5864af34a000089961e4eaba` on `users/davidsant/symmetrical-train`, base `users/davidsant/ubiquitous-train`. Current unpublished head statuses have not yet been assessed. API permissions `pull=true`, `push=false` may block publication. The parent established the absence of required repository CI checks from branch/rule evidence, not empty statuses alone.
- **Boundaries:** ADR-0025/0026 remain Proposed; no governance or merge approval. Preserve #20-before-#21 ordering and all host authority, at-most-once delivery, trusted-adapter and settling-dependency assumptions. Historical W045 stop restrictions and turn-2 pending verdicts above remain provenance, not the current W046 task state. Spec/plan/ADR checkpoint summaries and `final-review-evidence.json` remain untouched historical artifacts.
