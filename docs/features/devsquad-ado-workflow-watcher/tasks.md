# DevSquad/ADO Workflow Watcher Tasks

Decomposition of [spec.md](spec.md) and [plan.md](plan.md) under [ADR-0026](../../adr/0026-devsquad-ado-workflow-watcher.md), preserving ADR-0021, ADR-0022, ADR-0024, and ADR-0025.

## Scope and Conventions

- **Ordering is the plan's vertical sequence.** Phases 2–9 map one-to-one onto the plan's eight implementation slices. Do not reorder; each phase depends on the durable behavior of the previous one.
- **No separate test tasks.** Every task is TDD RED→GREEN: the named tests are written first and must pass as part of that task's acceptance.
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
  - Acceptance: type-level assertions confirm the reason-code union is exactly the plan's 18 members, the stop-reason union is exactly four members, and no declaration references `effect`.
  - Traceability: FR-001, FR-002, FR-005, FR-006; INV-009.
  - Verify: `npm run typecheck`

- [x] **W003** Implement option and seam structural validation in `src/DevSquadAdoWorkflowWatcherValidation.ts`
  - Export `validateDevSquadAdoWorkflowWatchPassOptions` returning a discriminated validation result; validation runs to completion before any seam call or ledger operation and reports the first failure with a stable field path.
  - Enforce every row of the plan's validation table: ledger method callability (`readRecord`, `acquireClaim`, `renewClaim`, `releaseClaim`, `checkpoint`); seam presence/callability; `passId` 1–120 UTF-8 bytes NFC control-character-free; `ownerId` 1–256 bytes; candidates nonempty, canonicalized, deduplicated, ≤ 1,000; intake phases/statuses nonempty distinct nonblank ≤ 256 bytes; `maxPolls` positive safe integer ≤ 10,000; positive `maxPollStartElapsedMs` and `observationTimeoutMs`; `leaseDurationMs` ≤ 86,400,000 default 60,000; `renewalThresholdMs` strictly below the lease, default `max(1, trunc(lease / 3))`; backoff defaults 1,000 / 2 / 30,000 with `maxIntervalMs >= baseIntervalMs`; callable `jitter`, `clock`, `delay`; `signal` an `AbortSignal` when present.
  - Emit `kind: "seam-contract"` with the offending method name and `"missing" | "not-a-function"`; emit `kind: "validation"` with `field` and `reason` for everything else.
  - Acceptance (RED→GREEN in `src/DevSquadAdoWorkflowWatcher.test.ts`): TEST-001 covering CC-015 (blank owner, duplicate candidates, `maxPolls = 0`, malformed intake rules → stable field paths, zero side effects) and TEST-002 covering CC-016 (seam without `observeWorkItemComments` → `seam-contract` error naming the method, zero ledger mutations).
  - Traceability: FR-003, FR-004, FR-009; CC-015, CC-016.
  - Verify: `npm test -- DevSquadAdoWorkflowWatcher`

- [x] **W004** Implement canonical candidate ordering in `src/DevSquadAdoWorkflowWatcherValidation.ts`
  - Canonicalize each candidate through the ledger's work-item rules, deduplicate on the canonical identifier, and sort by UTF-8 byte comparison; ordering is total, locale-independent, and independent of input order.
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
  - Race each observation against `delay(observationTimeoutMs, signal)` → `observation-timeout`; convert seam rejections into `observation-failed` retaining no message, stack, or URL.
  - Project responses to identifiers only (`commentIds`, `{ threadId, commentId }`); discard every other property at projection. Each identifier must be a nonblank string ≤ 1,024 UTF-8 bytes without control characters, else `invalid-observation-identifier`.
  - Apply the anchor rule per kind: empty entries → no new events; null anchor → all entries; anchor equals last entry → no new events; anchor at index `i` → `entries[i+1..]`; anchor absent → all entries. Next cursor is the last new entry. Equality is exact string comparison (work-item comments) or exact `threadId`/`commentId` pair comparison (pull requests). No identifier is parsed, ordered, or arithmetically compared.
  - A pull-request entry with a missing, null, or blank `commentId` is never persisted; when it is the last entry the last persistable entry becomes the next cursor and `pull-request-thread` is recorded in `skippedCursorKinds`.
  - Acceptance (RED→GREEN): TEST-003 in `src/DevSquadAdoWorkflowWatcher.test.ts` (CC-003 — only observation methods invoked, at most once per candidate per poll per kind), TEST-018 in `src/DevSquadAdoWorkflowWatcher.bounds.test.ts` (CC-013 — non-settling seam with `observationTimeoutMs = 5000` yields `failed`/`observation-timeout` and the pass continues), TEST-022 in `src/DevSquadAdoWorkflowWatcher.test.ts` (CC-019 — incomplete thread/comment pair not persisted, stable reason).
  - Traceability: FR-009–FR-015, FR-020–FR-024, FR-052; INV-002, INV-010.
  - Verify: `npm test -- DevSquadAdoWorkflowWatcher`

---

## Phase 5: Single-Candidate Happy Path (tracer bullet) — plan slice 4

- [x] **W008** Implement the per-candidate step machine in `src/DevSquadAdoWorkflowWatcherPass.ts` and wire `runDevSquadAdoWorkflowWatchPass` in `src/DevSquadAdoWorkflowWatcher.ts`
  - Implement steps 2, 4–7, 9, 11–13 of the plan's candidate step algorithm for one candidate in one poll: `readRecord` → observe → project/select → acquire claim (fresh 32-byte `node:crypto` `randomBytes` base64url token, derived `claim` operation ID, configured lease) → `checkpoint` with `expected = { revision, phase, status }` and a patch carrying only advanced cursors → intake decision → release with the derived `release` operation ID.
  - `record-not-found` → `skipped`/`record-not-found`; the watcher never initializes a record.
  - Intake decision is exact-match on both sets: phase ∈ `intakeRules.phases` **and** status ∈ `intakeRules.statuses` → append one signal citing `sourceRevision` and resolve `acted`; otherwise resolve `intake-suppressed`/`intake-rules-unmatched` with the cursor left advanced.
  - The signal is appended only after the checkpoint response is accepted; at most one signal per candidate per pass. Release failure never changes the reported outcome.
  - Acceptance (RED→GREEN in `src/DevSquadAdoWorkflowWatcher.test.ts`): TEST-004/CC-001 (record `137` rev 4 cursor `480`, observations `[480, 481]` → one signal citing rev 4, cursor `481` durable at rev 5 before the pass reports); TEST-005/CC-002 (rerun unchanged → `no-change`, zero signals, zero checkpoints, revision still 5); TEST-014/CC-007 and CC-008 (`awaiting-approval` with rules `[implement, review]` → cursor advanced and `intake-suppressed`; `custom-security-gate` listed in rules → signal emitted, no allowlist error); TEST-015/CC-009 (candidate `999` uninitialized → `skipped`/`record-not-found`, no record created on disk).
  - Traceability: FR-018, FR-019, FR-025–FR-028, FR-032–FR-036, FR-040–FR-046; INV-006, INV-007, INV-009.
  - Verify: `npm test -- DevSquadAdoWorkflowWatcher`

---

## Phase 6: Poll Loop, Budgets, and Cancellation — plan slice 5

- [x] **W009** Implement the bounded poll loop in `src/DevSquadAdoWorkflowWatcherPass.ts`
  - Implement the plan's loop verbatim: single `startedAt` reading as the pass-start basis; one clock reading per poll driving every eligibility, lease, and timestamp decision in that poll; pending/resolved candidate state; sequential evaluation in canonical order with no concurrency.
  - Stop at the first of `candidates-resolved`, `poll-budget-exhausted`, `poll-start-budget-exhausted`, `cancelled`; the elapsed check applies from the second poll onward and gates poll starts only. Between polls, request `backoffFor(polls)` from the injected delay source.
  - Eligibility step 8: no new events in any kind leaves the candidate **pending** with `no-new-observations` (or `incomplete-pull-request-cursor` when the only observed activity was unpersistable), re-examined next poll.
  - Finalizer: release every still-held claim; report still-pending candidates as `failed`/`checkpoint-indeterminate` when holding a claim, otherwise `no-change` with the last pending reason. Report pass-level counts (examined, eligible, acted, noChange, suppressed, skipped, failed), poll count, `startedAt`/`completedAt`, and the stop reason.
  - Acceptance (RED→GREEN): TEST-006/CC-010 in `src/DevSquadAdoWorkflowWatcher.test.ts` (three shuffled input orders → identical outcomes, reason codes, and recorded seam call order); TEST-007 (clock fake asserts exactly one reading per poll drives eligibility, lease, and timestamps); TEST-016/CC-011 in `src/DevSquadAdoWorkflowWatcher.bounds.test.ts` (`maxPolls = 3` with no eligible candidate → exactly 3 polls, exactly 2 recorded delays, `poll-budget-exhausted`, plus a duration-budget case).
  - Traceability: FR-006, FR-016, FR-017, FR-047–FR-050; INV-003, INV-011.
  - Verify: `npm test -- DevSquadAdoWorkflowWatcher`

- [x] **W010** Implement cooperative cancellation gates in `src/DevSquadAdoWorkflowWatcherPass.ts`
  - Observe cancellation at exactly three classes of point: before each seam call (propagating `signal` to the seam), before each ledger mutation (acquire, renew, checkpoint, release — except a release already in flight, which completes), and between polls both before the delay and through the delay's own `signal`.
  - On abort, resolve a claim-holding candidate as `failed`/`cancelled`, release every held claim, report every already-acknowledged outcome, and return `ok: true` with `stopReason: "cancelled"`.
  - Acceptance (RED→GREEN in `src/DevSquadAdoWorkflowWatcher.bounds.test.ts`): TEST-017/CC-012 — abort before a seam call, before a mutation, and between polls each stop promptly with released claims and acknowledged outcomes preserved.
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
  - Release on every exit path: success, candidate failure, cancellation, and budget exhaustion.
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
  - Interrupt a pass after a checkpoint acknowledgement and after an unacknowledged mutation attempt; reopen the ledger and assert only acknowledged outcomes are durable, never partial ones, and that a retried pass with the same `passId` replays its checkpoint rather than duplicating it.
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
  - State explicitly that exactly-once applies to ledger-mediated intake delivery only, never to external side effects.
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
  - Route `readRecord`, `acquireClaim`, `renewClaim`, `checkpoint`, and `releaseClaim` through one classifier that converts a synchronous throw, a rejection, or a non-typed result into `failed` / `ledger-unavailable` with `ledgerErrorKind: "ledger-fault"`. Typed ledger errors keep their existing mapped paths; there is no blanket handler.
  - A fault while a claim is held still resolves the candidate, so the release path still runs.
  - Acceptance (RED→GREEN in `src/DevSquadAdoWorkflowWatcher.recovery.test.ts`): TEST-019/CC-024 across all four mutating methods and both fault shapes; TEST-011 for checkpoint-rejection-after-acquire (claim released, cursor unchanged) and for release-rejection (acknowledged outcome preserved). No raw message or stack appears in the serialized result.
  - Traceability: FR-059; INV-016.

- [x] **W026** Make the duration contract honest across code and docs
  - Rename `budgets.maxPassDurationMs` → `budgets.maxPollStartElapsedMs` and stop reason `duration-budget-exhausted` → `poll-start-budget-exhausted`; document that the bound gates poll starts, that in-flight work always completes, and that termination is guaranteed by `maxPolls`, `observationTimeoutMs`, and the caller's abort signal.
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

Every conformance case CC-001–CC-024 and every required test TEST-001–TEST-025 is claimed by exactly one owning task; no task is complete until its named tests pass.
