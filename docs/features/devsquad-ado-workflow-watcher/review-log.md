# Review: DevSquad/ADO Workflow Watcher (slice 14)

**Authoritative final status:** [2026-09-10 publication and evidence correction](#final-2026-09-10-publication-and-evidence-correction) at the end of this log; [portable original worker evidence](final-review-evidence.json). Implementation publication is complete at `d5aecf0`; the documentation correction does not rerun review.

## Current recovery status — 2026-09-10

### Final fresh independent review - turn 4 (W038 completed TECHNICAL only)

**PASSED: no blockers; 0 Critical, 0 Major, 1 nonblocking Minor (TB001).** All five guardians completed, and the separate security specialist reported no vulnerability findings. W029-W037 prerequisites are complete. The parent approved persistence of this independent `devsquad.review` turn-4 evidence for the reviewed worktree over baseline `fb6a238`; this documentation application did not rerun that review. Technical conformance is accepted for W038 only, not governance acceptance or a merge-ready determination.

This final review supersedes the earlier failed gates and pending-review status below. Those failures, implementation runs, and older superseded PASS verdicts remain historical evidence; they are not erased or retroactively changed into passes.

#### Independent RC14-008 closure

`src/DevSquadAdoWorkflowWatcherPass.ts:623` captures the original submitted snapshot. History is validated at lines 698-710 before retry preconditions refresh at line 713. The shared guard in `src/DevSquadAdoWorkflowWatcherLedger.ts:504-555` requires accepted revision = submitted expected revision + 1 and matching operation, timestamp and state. When latest = accepted it also requires matching authority and patched cursors; an older acknowledgement with a newer valid record remains allowed.

All **36 independently authored in-memory public-pass probes passed**: 31 boundary probes plus five receipt/renewal probes. The two original contradictions (accepted5/latest5/cursor480 and accepted6/latest6/cursor480) now fail as `ledger-unavailable` / `ledger-fault`, with no checkpoint revision, cursor change or signal, and exactly one cleanup attempt. Contradictory phase, owner, fence, missing authority, timestamp, PR cursor, duplicate history and required-field getter cases fail closed. Valid same/latest and newer renewal, takeover or release retain the original acknowledgement and signal; cleanup is separate evidence.

Retry without renewal preserves the same operation ID, patch, authority and expected revision. Renewal before submission or retry is validated against the correct submitted revision. A receipt appearing after the read permits unchanged-request replay; renewal that changes the digest instead produces terminal `idempotency-conflict` with the same ID, without fabrication. Request mutation/getter, final-abort and cleanup-fault protections remain intact. The first independent probe harness exited 13 because its fixture confused polling delay with the observation timer; the corrected fixture passed. This was a harness issue, not a product defect.

#### Final closure matrix

| Finding / obligation                                                     | Final independent disposition                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R14-001                                                                  | Closed: method-specific ledger validation, sanitized faults, validated authority and acknowledgement; legitimate historical replay preserved (W030).                                                                                            |
| R14-002                                                                  | Closed: complete signal preflight and fresh abort gate before every seam invocation (W031).                                                                                                                                                     |
| R14-003                                                                  | Closed: exact duplicate rejection, newest complete PR pair and disjoint changes/skips (W032).                                                                                                                                                   |
| R14-004                                                                  | Closed: linked child cancellation, listener/timer retirement and late-settlement quarantine, with honest cooperation limits (W033).                                                                                                             |
| R14-005                                                                  | Closed: inclusive count/identifier/aggregate-byte bounds before retention, fail-closed candidate windows (W032).                                                                                                                                |
| R14-006                                                                  | Closed: distinct source4/acquire5/checkpoint6/release7 and original accepted versus latest revision (W035).                                                                                                                                     |
| R14-007                                                                  | Closed: authoritative absent-anchor and post-cursor contract corrections, preserved in behavior (W029/W032).                                                                                                                                    |
| Extra B3/B4: signal preflight, cleanup, reason contract and traceability | Closed/preserved: complete preflight, one truthful cleanup attempt, acknowledged signal preservation, independent counts, 27 reasons and CC-001-030 / TEST-001-032 mapping. Descriptive extra labels only, not invented original R14 numbering. |
| Bounds, PR/intake metadata, takeover and idempotency extras              | Closed/preserved through W035/W036 and the independent boundary/receipt probes.                                                                                                                                                                 |
| RC14-001 / RC14-002                                                      | Closed/preserved: request isolation and consistent direct/replay acknowledgements.                                                                                                                                                              |
| RC14-003 / RC14-004 / RC14-005                                           | Closed/preserved: required-field fault isolation, final cancellation priority and correct malformed-window category.                                                                                                                            |
| RC14-006 / RC14-007                                                      | Closed/preserved: truthful README guarantees and authoritative current-status/history separation.                                                                                                                                               |
| RC14-008                                                                 | Independently closed by submitted-request/history validation and the 36 public-pass probes above.                                                                                                                                               |
| SC-01 / SC-02                                                            | Closed/preserved: mutation-aware indexed array bounds and guarded signal/configuration access.                                                                                                                                                  |
| SL14-001 / DOC14-001                                                     | Closed/preserved: public-field-only response snapshots and accurate final-cancellation pseudocode.                                                                                                                                              |

**Acknowledged residual TB001 (Minor, nonblocking):** older tests at `src/DevSquadAdoWorkflowWatcher.remediation.test.ts:953,1021,1288,2423` use internal guards/object identity and are coupled to refactoring. This test-style observation requires no fix for W038 and does not weaken the independently authored public-pass evidence.

#### Fresh review execution versus inherited build evidence

The following commands/results were freshly executed by the independent reviewer, not by this documentation-only application:

| Exact command / check                                                               | Fresh independent result                                                             |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `npm test -- DevSquadAdoWorkflowWatcher DevSquadAdoWorkflowLedger`                  | PASS, exit 0: 401 passed, 2 existing Windows skips, 11 files.                        |
| `npm test -- DevSquadAdoWorkflowWatcher.remediation -t "third independent history"` | PASS, exit 0: 19 passed, 244 deselected.                                             |
| `npm run typecheck`                                                                 | PASS, exit 0.                                                                        |
| `node scripts\check-public-types-effect-free.mjs`                                   | PASS, exit 0, against existing generated declarations.                               |
| Changed-path Prettier check                                                         | PASS across the 20 supplied changed paths, respecting the existing changeset ignore. |
| `git diff --check` and untracked no-index whitespace checks                         | No diagnostics.                                                                      |

**Build was NOT rerun in the final read-only review.** Inherited latest implementer evidence is ESM PASS (16.296s) and DTS PASS (24.107s), followed by canonical lifecycle exit 1 at the unchanged Windows postbuild error `'rm' is not recognized`; template copy was not reached. Dist was generated from the latest code, and no code changed after that build. This is not fresh build or packaging-success evidence.

#### Scope, residual limits and authority

The original broader discovery/filtering requirement is a **deferred capability, not fully delivered**. The current API consumes host-supplied candidates and exact host-owned phase/status rules; it does not discover or filter tracker candidates or orchestrate lifecycle. No live seam implementation, factory or outbox is included. At-most-once delivery is potentially lossy; the host must reconcile durable cursors with intake processing. Cooperative abort cannot force-stop noncooperators; ledger/delay settlement and a valid timeout delay remain assumptions. Exactly one cleanup attempt does not guarantee release when state is unknown; inclusive lease expiry is the backstop.

ADR-0025 and ADR-0026 remain **Proposed**, with authorized acceptance pending. This local slice has no linked board item. Implementation publication is complete: local and published PR #21 head are `d5aecf0ba1e276642ddfc683fc756320598642f6`, normally fast-forwarded from `fb6a238`; no merge occurred. #20 must merge before #21. The recommended next-slice base is the updated #21 head, `users/davidsant/symmetrical-train`, but slice 15 remains blocked until the creator's explicit decision. This documentation-only follow-up preserves the implementation source tree; the parent will record its resulting documentation commit SHA in the PR/handoff. **W038 is completed TECHNICAL only, PASSED with no blockers and TB001 acknowledged; publication does not grant governance acceptance or merge readiness.**

## Historical recovery reviews and implementation evidence (superseded by final turn 4)

Every failed/pending/approval statement below records its then-current state, not the final W038 status above.

### Third independent review - 2026-09-10 (historical W038 FAILED)

**FAILED: one Critical blocker, RC14-008.** The conductor reports all five workers and 28 other independent boundary probes passed, with the prior combined baseline at **382 passed, 2 existing Windows skips, 11 files**, typecheck and ESM/DTS passing, and only the unchanged Windows `rm` postbuild failure. Those results did not establish conformance.

Independent public in-memory proof: read revision 4/cursor `480`, acquire authority at revision 5, then submit checkpoint expected revision 5/cursor `481` and receive storage/indeterminate. On poll 2, matching operation history (A) revision 5/latest 5/cursor `480`, or (B) revision 6/latest 6/cursor `480`, incorrectly returned `acted`, one signal at revision 5/6, and one release. Control revision 6/latest 6/cursor `481` was correctly accepted. This is an observable contradiction under FR-036/059 and INV-007, not a demand to verify an injected ledger's filesystem.

### Third-review implementation remediation - 2026-09-10 (not W038 approval)

`PendingCheckpoint.submittedRequest` retains a separate copy of the actual last submission after any own renewal. Reads and retry-precondition updates cannot retroactively redefine its expected revision, patch or authority. `resumeCheckpoint` validates matching history with `isDevSquadAdoWatcherCheckpointHistoryValid`, which reuses the complete existing checkpoint replay validator rather than a weaker phase/status-only check. No checkpoint effects are completed until that validation succeeds.

The shared guard requires accepted = submitted expected + 1, matching operation/time/previous/resulting state and complete valid history. At latest = accepted, it also checks timestamp, current state, owner/fence and each patched WI/PR cursor. At latest > accepted, it preserves legitimate historical acknowledgement without comparing the old patch/authority to a later mutation or owner. Contradictions resolve failed/ledger-unavailable/ledger-fault, with null checkpoint revision, empty cursor changes, no signal, and one cleanup attempt using the previously validated authority.

Ledger trace: `DevSquadAdoWorkflowLedgerStorage.ts` checkpoint hashes the normalized request (including expected revision), looks up an idempotency receipt before authority/precondition checks, and creates acceptance at current revision + 1. `DevSquadAdoCheckpointEntry` contains operation ID, revision, accepted time and previous/resulting states, not cursor or claim capabilities. Recovery uses those existing fields plus the validated latest record; no ledger implementation, receipt, schema or contract changes are made. A later takeover can still reject the single old-authority cleanup attempt while the already acknowledged historical signal remains preserved.

**19 new public-pass regression cases** in `third independent history regressions [RC14-008][TEST-026][TEST-031]`: 12 contradictory cases (A, B, invalid original revision with newer latest, phase/status, previous phase/status, owner, fence, missing authority, timestamp and PR cursor); four valid controls (same revision, newer mutation, newer renewal, newer takeover); and three unchanged ambiguous retry/recovery flows (no renewal, renewal before first submission, renewal before retry). They assert bounded poll/read/checkpoint/renew/release counts, zero unacknowledged effects, original source/accepted revision distinction, preserved operation/patch/authority on retry, and claim-token privacy.

Focused command `npm test -- DevSquadAdoWorkflowWatcher.remediation -t "third independent history"`: **19 passed, 244 deselected, 1 file** (263 remediation tests total).

| Exact command                                                      | Actual result                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test -- DevSquadAdoWorkflowWatcher DevSquadAdoWorkflowLedger` | **PASS**, exit 0: **401 passed, 2 existing Windows skips, 11 files**. All previous 382 passing cases remain passing, plus 19 new RC14-008 cases.                                                                                                                                  |
| `npm run typecheck`                                                | **PASS**, exit 0.                                                                                                                                                                                                                                                                 |
| `npm run build`                                                    | ESM **PASS** (16.296s), DTS **PASS** (24.107s). Canonical lifecycle **exit 1** only at unchanged Windows postbuild: `'rm' is not recognized as an internal or external command, operable program or batch file.` Template-copy postbuild did not run; no packaging-success claim. |

Final declaration command `node scripts\check-public-types-effect-free.mjs`: **PASS**, exit 0, no Effect references in public declarations. Changed-file Prettier check: **PASS**, all 20 dirty/untracked paths supplied using the PowerShell `$paths` setup recorded below, with existing ignore rules respected. `git diff --check`: **PASS**, exit 0. Only the nine files touched by this follow-up were supplied to formatting; no repository-wide format or unrelated edits.

All 20 pre-existing dirty/untracked paths are preserved. Only the existing patch changeset is extended; no package/lock, ledger implementation/schema, commit, push, PR, merge, other checkout, slice 15, factory or governance acceptance changes. **W038 remains FAILED / pending parent-owned independent re-review; publication remains the parent's responsibility.**

### Second independent review — 2026-09-10 (W038 remains FAILED)

**FAILED: 3 Major boundary blockers and 1 Minor documentation mismatch.** The parent's second independent review reproduced these defects after the prior **348 passed, 2 existing skips, 11 files** baseline. That baseline and all earlier PASS/zero-blocker verdicts do not establish conformance. W038 remains open for parent-owned independent re-review; the implementation follow-up below is not approval.

| Finding         | Independently reproduced evidence                                                                                                                                                                                                           | Implementation follow-up                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SC-01 Major     | Arrays initially at 1,000 entries grew through getters or yielded 1,001 entries through custom iterators. WI/PR windows could checkpoint overflow at revision 6 and release at 7; candidate normalization also accepted accessor expansion. | Candidate and observation traversal captures initial length, uses bounded indices rather than overridable iterators, checks live length before/after required getter reads (including the final entry), and enforces count before retention. Observed growth/shrinkage fails closed; unreadable entries are sanitized. Custom iterators are ignored, not silently truncated.                                                         |
| SC-02 Major     | Throwing `aborted`, `addEventListener`, or `removeEventListener` getters escaped the public validator/pass with `SYNTHETIC_PRIVATE_MARKER` despite zero side effects.                                                                       | Narrow required-field inspection produces a sanitized validation error at `signal`. Private required-configuration snapshots prevent getter re-reads during execution. Listener methods are captured with their original receiver; abort state stays live without mutating the caller's signal. Post-preflight unreadable/nonboolean abort state fails closed as cancellation, retaining mandatory cleanup and acknowledged effects. |
| SL14-001 Major  | Whole-response `structuredClone` accessed unrelated getters: valid reads failed, durable acquire5 lost authority with no release, and durable checkpoint6 lost its signal despite release7.                                                 | Explicit method/discriminator-specific projection reads only known public fields into fresh nested objects before full existing validation. Record arrays use indexed, mutation-checked projection under inherited history/checkpoint ceilings. Unknown getters are untouched; known-field faults become `ledger-fault`. Original request snapshot and separate adapter copy remain intact.                                          |
| DOC14-001 Minor | Plan poll pseudocode put resolved/budget exits before cancellation and omitted the after-cleanup gate.                                                                                                                                      | Corrected cancellation priority immediately after candidates and after final cleanup; runtime RC14-004 behavior is preserved, not changed to match stale pseudocode.                                                                                                                                                                                                                                                                 |

Regression evidence is in `second independent boundary regressions` in `src/DevSquadAdoWorkflowWatcher.remediation.test.ts`. It covers both public validation boundaries, 1,000-entry indexed semantics, initial/final/nested getter mutation, unused iterator overflow, all five method acknowledgements with unknown throwing getters throughout nested payloads, required-field candidate isolation, snapshot independence, and 10,000-entry ledger collection bounds. Existing complete error-variant, request-isolation, contradictory replay, historical replay, cancellation, cleanup and revision tests remain in place.

The initial RED command `npm test -- DevSquadAdoWorkflowWatcher.remediation -t "second independent boundary"` reported **16 failed, 2 passed, 210 deselected**. Follow-up runs corrected test-fixture issues: reset a mutated candidate array before separately exercising the public pass; detach poisoned acknowledgement objects from fake-ledger storage; avoid a matcher deep-inspecting the intentionally one-read getter; and remove an incorrectly embedded authority token from four token-free latest-record replay fixtures. These are fixture corrections, not relaxed acknowledgement or replay assertions.

No package/lock, ledger implementation/schema, branch, commit, push, PR, merge, other checkout, slice 15, factory, or ADR acceptance changes. All 20 pre-existing dirty/untracked paths are preserved. Only the existing patch changeset is extended.

### Second-review implementation validation — 2026-09-10 (not W038 approval)

**34 added regression cases; final combined result: 382 passed, 2 existing skips, 11 files.** The second-review block has 34 cases, with additional mutation/collection variants exercised inside the parameterized cases; the remediation file now has 244 tests. The prior 348 passing cases are preserved.

| Exact command                                                      | Actual result                                                                                                                                                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test -- DevSquadAdoWorkflowWatcher DevSquadAdoWorkflowLedger` | **PASS**, exit 0: **382 passed, 2 skipped, 11 files**.                                                                                                                          |
| `npm run typecheck`                                                | **PASS**, exit 0.                                                                                                                                                               |
| `npm run build`                                                    | ESM **PASS** (16.148s), DTS **PASS** (23.317s); canonical command **exit 1** at the unchanged Windows postbuild: `'rm' is not recognized`. Package/lifecycle scripts unchanged. |
| `node scripts\check-public-types-effect-free.mjs`                  | **PASS**, exit 0: no Effect references in public declarations.                                                                                                                  |
| `npx prettier --check $paths`                                      | **PASS**, exit 0; all 20 existing dirty/untracked paths supplied, with repository ignore rules respected.                                                                       |
| `git diff --check`                                                 | **PASS**, exit 0.                                                                                                                                                               |

The exact PowerShell path setup for the formatting command was:

```powershell
$paths = @(git diff --name-only) + @(git ls-files --others --exclude-standard)
$paths = $paths | ForEach-Object { $_ -replace '/', '\' }
npx prettier --check $paths
```

Only the 11 files touched by this follow-up were supplied to `npx prettier --write`: the four watcher runtime helpers/pass, remediation tests, README, plan/spec/tasks/review-log, and the existing patch changeset. No whole-repository formatting occurred. A final `git status --short` retained the same 20 dirty/untracked paths as intake.

**W038 remains FAILED / awaiting independent parent re-review.** These are implementer results, not an independent PASS. Remaining limitations are unchanged: canonical Windows postbuild is blocked by its existing POSIX command; noncooperating dependencies cannot be forcibly terminated; ambiguous durable writes can still require lease expiry and host reconciliation. No ledger acknowledgement is inferred from a failed response, and ADR-0025/0026 remain Proposed.

### First fresh independent review — 2026-09-10 (historical W038 evidence)

**FAILED: 2 Critical, 3 Major, and 2 documentation findings.** This independent result supersedes implementation closure claims, not the historical evidence retained below. W030–W037 implementation was delivered; W038 has not passed and remains open for the parent's independent re-review after remediation.

| Finding                | Independently reproduced defect                                                                                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RC14-001 Critical      | Mutable ledger requests invalidate response comparison: acquire can substitute the token as owner; checkpoint can mutate the pending cursor from `481` to `480` and still emit a signal. |
| RC14-002 Critical      | `replayed:true` bypasses same-revision outcome/record consistency and the checkpoint expected-to-accepted revision relationship.                                                         |
| RC14-003 Major         | Spreading unused ledger adapter properties and unguarded observation projection allow throwing accessors to escape the public pass with raw markers.                                     |
| RC14-004 Major         | Abort after the last candidate's checkpoint acknowledgement returns `candidates-resolved` instead of `cancelled`, including failed cleanup.                                              |
| RC14-005 Major         | Malformed observation collections return `invalid-observation-identifier` instead of the approved `invalid-observation-window`.                                                          |
| RC14-006 Documentation | README still promises unconditional termination and release/stale outcomes.                                                                                                              |
| RC14-007 Documentation | Authoritative spec/plan/review/ADR status incorrectly says all W030–W038 implementation remains pending.                                                                                 |

Conductor-supplied pre-remediation evidence: combined watcher/ledger selector **312 passed, 2 skipped, 11 files**; typecheck, ESM/DTS and direct public-type guard passed. Canonical Windows postbuild failed on the pre-existing POSIX `rm` command. These results did not establish conformance: the independent probes above reproduced despite that baseline. Remediation and its new evidence are recorded separately; no independent PASS is inferred from green tests.

### Implementation follow-up — 2026-09-10 (not independent W038 approval)

All RC14 findings are remediated in the authorized worktree and ready for parent-owned independent re-review. Existing dirty remediation was preserved. No ledger implementation/schema, package/lock, branch, commit, push, PR, merge, other checkout, slice 15, or factory changes were made.

| Finding  | Implementation closure and regression evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RC14-001 | `DevSquadAdoWorkflowWatcherLedger.ts` snapshots the original request before invocation, hands the dependency a separate deep copy, rejects in-place request changes, and validates a response snapshot against the original request. No pending cursor/authority references are shared. Acquire owner/token, nested WI/PR checkpoint cursor, and renew/release token-mutation tests verify no fabricated authority, no unacknowledged cursor/signal, no returned raw token, and zero/one cleanup as appropriate. Actual unacknowledged durable mutations remain possible; lease expiry and host reconciliation remain backstops.                                                                                                                                 |
| RC14-002 | The guard enforces checkpoint `acceptedRevision = expected.revision + 1` even for replay. The ledger digest includes the normalized expected revision (`LedgerStorage.ts` checkpoint / `LedgerSchema.ts` requestDigest), so submitting a different expected revision cannot legitimately replay the same receipt. All mutation outcomes must match the complete record when latest = accepted, including timestamp and claim/fence/cursor consistency. Four contradictory same-revision replays and the accepted=expected checkpoint are rejected. Four valid same-revision replays and a historical checkpoint after a later cursor advance are newly covered; existing four older acknowledgements after takeover remain passing. No ledger semantics changed. |
| RC14-003 | The guard exposes only the five watcher-used methods, without spreading the adapter, and keeps the original receiver. Observation projection narrowly sanitizes unreadable identifier-bearing fields; unrelated payload getters are not accessed. Required method accessors are checked at preflight and PR method lookup is guarded at invocation; PR cursor input is copied. Public-pass tests cover two-candidate isolation, nested PR getters, a property-specific Proxy, receiver binding, ignored unrelated getters, and sanitized method-preflight failure.                                                                                                                                                                                               |
| RC14-004 | `DevSquadAdoWorkflowWatcherPass.ts` reads live cancellation immediately after each candidate and after finalizer cleanup, before a resolved/budget exit can hide abort. Six last-candidate cases (abort at checkpoint or release, each with success/rejection/throw cleanup) retain checkpoint 6, cursor `481`, one signal and truthful overlapping counts. Three pending-checkpoint budget-finalizer cases report cancelled without inventing an acknowledgement. Exactly one release remains mandatory for validated authority.                                                                                                                                                                                                                                |
| RC14-005 | `DevSquadAdoWorkflowWatcherObservation.ts` classifies malformed envelopes/collections and unreadable window fields as `invalid-observation-window`; individual identifier violations stay distinct. Null WI and PR collections invalidate the whole candidate before acquire, with no partial signal or cursor advance.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| RC14-006 | README's authoritative introduction now qualifies termination on dependency settlement and cooperative cancellation. Its stale-observation passage now conditions the no-change/re-poll outcome on acknowledged cleanup and explicitly describes unconfirmed cleanup failure.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| RC14-007 | Authoritative status in spec, plan, tasks, this review log, and Proposed ADR-0026 distinguishes completed W030–W037 implementation from FAILED W038/pending independent re-review. Old review evidence is retained and explicitly historical. The existing patch changeset is updated, not duplicated.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Regression evidence lives in the `fresh independent RC14 regressions` describe block in `src/DevSquadAdoWorkflowWatcher.remediation.test.ts`: **36 added tests** over the 312-pass baseline. The first focused RED run reported 25 failures: 24 reproduced defect assertions and one overly broad Proxy fixture that threw during Promise assimilation rather than window projection. The Proxy was corrected to throw only for `commentIds`; the final property-specific regression passes. Eleven additional cases cover positive replay compatibility, accessor boundaries and budget-finalizer cancellation. The existing four takeover replay regressions remain intact.

| Command                                                                                                                      | Actual result                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx vitest run src\DevSquadAdoWorkflowWatcher.remediation.test.ts -t "fresh independent RC14" --reporter=dot` (initial RED) | 25 failed, 174 deselected; see fixture distinction above.                                                                                                         |
| `npx vitest run src\DevSquadAdoWorkflowWatcher src\DevSquadAdoWorkflowLedger --reporter=dot`                                 | **348 passed, 2 skipped, 11 files**; 36 new cases, existing skips unchanged.                                                                                      |
| `npm run typecheck`                                                                                                          | **PASS**, exit 0 after correcting one test-only union-parameter type error.                                                                                       |
| `npm run build`                                                                                                              | ESM and DTS **PASS**; canonical command **exit 1** in unchanged Windows postbuild because `rm` is not recognized. No lifecycle-script workaround or package edit. |
| `node scripts\check-public-types-effect-free.mjs`                                                                            | **PASS**, exit 0: no Effect references in public declarations. Run directly because postbuild stopped before this script.                                         |

Formatting/scope evidence: `npx prettier --check <all 20 tracked-dirty and untracked changed files>` **PASS**, exit 0; `git diff --check` **PASS**, exit 0. Only the four flagged, task-touched files were formatted (`review-log.md`, watcher observation, remediation tests, and watcher ledger guard). No whole-repository formatting or package/lock/ledger implementation edits were made.

Independent W038 remains **FAILED / awaiting fresh re-review**, not passed by this implementer. ADR-0025 and ADR-0026 remain Proposed. Publication and independent closure are the parent's responsibility.

**IMPLEMENTATION REMEDIATED; INDEPENDENT RE-REVIEW PENDING — ALL PRIOR PASS / ZERO-BLOCKER / CLEARED-FOR-PR VERDICTS BELOW ARE SUPERSEDED.** W030–W037 implementation is complete, including RC14-001–007 follow-up. W038 remains FAILED pending the parent's fresh independent re-review. Historical entries are retained as dated evidence only, including their then-current test counts, branch facts and claims. None is current approval or proof of the amended contract. This applies specifically to the 2026-09-09 final recovery verdict and earlier assertions of no functional defect.

The conductor recovered the original seven PR21 findings and approved specification/planning remediation, plus release acknowledgement, signal preflight, metadata/bounds and traceability review. DevSquad owns this lifecycle amendment; Sandcastle's offline execution/coordination boundary, ledger fencing/privacy and Effect-free public contracts remain unchanged. No factory, discovery/filtering orchestration, live clients or outbox. ADR-0025 is unchanged; ADR-0026 remains **Proposed** awaiting authorized acceptance. This local stacked slice has no linked board item.

### Original W029 recovery mapping (historical intake, not current open status)

This table preserves the original remediation assignments and their then-pending status. W030–W037 have since been implemented. The fresh RC14 findings and follow-up evidence above/below supersede the original implementation status; only the parent can close independent W038.

| Finding                | Recovered defect / approved contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Pending implementation owner                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| R14-001                | `callLedger` accepts unchecked `ok:true` (read `{}` can throw; malformed authority/checkpoint can fabricate acknowledgement) and arbitrary `error.kind`. Validate each method's full relevant success, complete latest record and known error required fields with request/identity/owner/token/fence/revision consistency; sanitize faults. Original accepted replay revision can be below latest. No fabricated acquire authority/release or unacknowledged effects; malformed durable checkpoint acknowledgement can lose its signal. | W030; TEST-026; CC-024/029                                                    |
| R14-002                | Fresh parent abort gate before every seam, including valid WI response that aborts before PR. Validate boolean aborted and callable add/remove listeners before all injected side effects.                                                                                                                                                                                                                                                                                                                                               | W031; TEST-027; CC-025                                                        |
| R14-003                | Reject every duplicate exact WI ID or normalized exact PR pair; no dedup/truncation, sorting, or numeric ordering. Mixed new PR entries advance newest complete pair; skips only if none persistable, disjoint from changes.                                                                                                                                                                                                                                                                                                             | W032; TEST-028; CC-019/026                                                    |
| R14-004                | Dedicated child observation controller propagated to seam and linked to parent; timeout/abort cancels seam/timer; clean every terminal path and quarantine late settlements. Cooperation cannot forcibly stop dependencies; ledger/delay settling and valid timeout delay are assumptions, not unconditional runtime/physical bounds.                                                                                                                                                                                                    | W033; TEST-029; CC-027                                                        |
| R14-005                | Each WI/PR window has inclusive 1,000 entries and 1,048,576 aggregate UTF-8 identifier bytes; existing per-ID 1,024 bytes. Check count before copy/iteration, incremental bytes/uniqueness before retention; entire candidate fails invalid-observation-window if malformed/duplicate/oversized. Host SHOULD bound upstream; watcher MUST validate.                                                                                                                                                                                      | W032; TEST-028; CC-026                                                        |
| R14-006                | Correct read4 → acquire5 → checkpoint6 → release7 and unchanged replay at then-current revision. Preserve original accepted revision vs latest record and pre-acquire signal source. Do not change ledger semantics.                                                                                                                                                                                                                                                                                                                     | W035; TEST-031; CC-001/002                                                    |
| R14-007                | W007's absent-anchor→all and skipped-latest-incomplete text contradicted FR-035a/W027. Replace authoritative text and post-cursor-only plan contract, not append competing alternatives.                                                                                                                                                                                                                                                                                                                                                 | W029 artifact correction complete; W032 behavior verification pending; CC-023 |
| Cleanup review         | Mandatory cleanup on every candidate, exactly one release for validated authority and zero otherwise. Failed/indeterminate cleanup promotes nonfailed outcome while preserving acknowledged checkpoint, cursor changes AND returned signal; independent overlapping effect/failure counts, partitioning cleanup counts.                                                                                                                                                                                                                  | W034; TEST-030; CC-028                                                        |
| Bounds/metadata review | Input boundary matrix; PR ID/cursor staleness after acquire; opaque ordering; watcher idempotency conflict; complete intake owner/fence/expiry/source metadata; takeover revisions and maximum cooperative active-operation evidence.                                                                                                                                                                                                                                                                                                    | W032/033/035/036; TEST-028/029/031/032; CC-026/027/030                        |
| Traceability review    | W002 had 18 reason codes in prose vs 25 in baseline; final approved union is 27 with invalid-observation-window and claim-cleanup-unconfirmed. Pending tasks/conformance replace blanket test claims and stale approval.                                                                                                                                                                                                                                                                                                                 | W037 public alignment; W038 independent verification                          |

### Settled cleanup decision

Every outcome has `{status, reason, ledgerErrorKind, acceptedRevision}` with status `released|failed|indeterminate|not-required`; reason `release-acknowledged|release-rejected|release-indeterminate|authority-unvalidated|no-claim-acquired`; known ledger category/`ledger-fault`/null and positive accepted revision/null. Validated acknowledgement alone means released. Known rejection (including storage/unchanged) is failed; storage/indeterminate or contention is indeterminate; throw/reject/malformed release is indeterminate/ledger-fault. Faulting/ambiguous acquire without validated authority is indeterminate/authority-unvalidated with zero release; no claim or uncertainty is not-required.

Retain local authority evidence until the single release response is validated; never guess, reacquire, retry release or fabricate acknowledgement. Release replay acknowledges its original operation, not absence of a later owner. Inclusive expiry is a backstop. Unconfirmed cleanup promotes nonfailed outcomes to ledger-unavailable for ledger-fault, otherwise claim-cleanup-unconfirmed; retain an existing primary failure. Preserve acknowledged checkpoint revision/cursorChanges and signals. Acted counts returned signals, suppressed counts acknowledged suppressed advances, failed counts final failures (may overlap); cleanup counts partition candidates.

### W029 artifact-only execution evidence (historical)

W029 updates only existing spec/plan/tasks/review-log and ADR-0026 in the authorized worktree. Grounding included local CLAUDE/CONTEXT/domain guidance, ADR-0024/0025, watcher source and ledger public types; recovered findings were supplied by the conductor. No production/test changes, new planning artifacts, commits or pushes in this amendment.

Artifact-only validation: inspected the diff; `git diff --check` passed. Read-only consistency assertions confirmed exactly five existing documentation paths changed, 27 planned reason codes, CC-001–030 and TEST-001–032 entries, W030–W038 unchecked, all seven R14 findings mapped, and ADR-0026 still Proposed. No behavioral tests/build were run for this documentation-only amendment. Aggregate byte-boundary tests use PR windows because valid WI windows max out at 1,024,000 bytes under the independent count/per-ID bounds.

At W029, W030–W038 were **pending**, including RED→GREEN remediation, README/existing-changeset alignment, public type checks and independent final review. CC-025–030 and TEST-026–032 were requirements, not then-existing test evidence. That artifact-only status is superseded by the implementation and fresh failed independent review recorded here. The older historical review record begins below.

---

**Date**: 2026-09-08
**Validated artifacts**: `docs/features/devsquad-ado-workflow-watcher/{spec,plan,tasks}.md`, `docs/adr/0026-devsquad-ado-workflow-watcher.md`, ADRs 0021–0025, `AGENTS.md` / `CLAUDE.md` / `CONTEXT.md`
**Reviewed code**: `src/DevSquadAdoWorkflowWatcher.ts`, `src/DevSquadAdoWorkflowWatcherPass.ts`, `src/DevSquadAdoWorkflowWatcherObservation.ts`, `src/DevSquadAdoWorkflowWatcherValidation.ts`, `src/DevSquadAdoWorkflowWatcherTestSupport.ts`, 5 watcher test suites, `src/index.ts`, `README.md`, `.changeset/devsquad-ado-workflow-watcher.md`
**Sub-Guardians run**: spec/conformance, ADR/boundary, code correctness, test quality (security folded into ADR/boundary — no security trigger fired beyond the token/secret rules already covered)

## Result

**Status**: PASSED_WITH_FINDINGS

- Critical: 0
- Major: 2
- Minor: 4
- Suggestion: 3

No functional defect was found in the implementation. Both Major findings are
**verification-strength gaps**, not code defects.

## Stacked-base delta verification

| Check                                            | Result                                                                |
| ------------------------------------------------ | --------------------------------------------------------------------- |
| `git rev-parse HEAD`                             | `9ff6e8e9f74792e131e927bd9bf41358e36cea95`                            |
| `git rev-parse users/davidsant/ubiquitous-train` | `9ff6e8e9f74792e131e927bd9bf41358e36cea95`                            |
| `git merge-base HEAD <base>`                     | identical                                                             |
| `git diff --stat <base>...HEAD`                  | empty                                                                 |
| Working tree                                     | 2 modified (`README.md`, `src/index.ts`), 13 untracked slice-14 paths |

Slice 14 is entirely uncommitted working-tree content on an exactly-aligned base.
**Zero base-branch commits or files are duplicated.** Clean.

## Build & Tests

| Command                                         | Result                                |
| ----------------------------------------------- | ------------------------------------- |
| `npx vitest run src/DevSquadAdoWorkflowWatcher` | PASS — 59 passed / 5 files, 0 skipped |
| `npx tsc --noEmit -p tsconfig.json`             | PASS — exit 0                         |
| `npx prettier --check <slice-14 files>`         | PASS — all files use Prettier style   |
| `.only` / `.skip` / `.todo` in watcher tests    | 0                                     |
| `tasks.md` checkboxes                           | 22/22 checked, 0 unchecked            |

## Checklist

### Spec compliance

All 20 conformance criteria (CC-001…CC-020) map to a tagged test; all 25 TEST-xxx
ids and all 6 spec scenarios are realized. High-risk FRs verified individually:
FR-014, FR-017, FR-018, FR-022, FR-028, FR-029, FR-034, FR-036, FR-037,
FR-038/039, FR-041/042/043, FR-046, FR-053, FR-005/006 — all PASS with
file-level evidence.

### ADR compliance

ADR-0026 normative constraints all PASS, including the operation-id formula
`"dsw1." + step + "." + sha256hex({v:1,passId,workItemId,step,ordinal}).slice(0,32)`
(`DevSquadAdoWorkflowWatcherValidation.ts:400-414`), lease defaults, backoff
formula, stop-reason set, and cursor-advance-under-suppression rule.
Boundary rules PASS: no transport/credential/URL construction (enforced by
`DevSquadAdoWorkflowWatcher.dependencies.test.ts` module-graph whitelist),
ledger touched only via public typed operations, no invented phase/status,
token-free projections, read-oriented seam.

### Codebase consistency

| Aspect              | Status | Observation                                                      |
| ------------------- | ------ | ---------------------------------------------------------------- |
| Public entry point  | PASS   | `src/index.ts:302-350` mirrors ledger/adapter export style       |
| TestSupport privacy | PASS   | Not exported, matching `DevSquadAdoWorkflowLedgerTestSupport.ts` |
| Changeset           | PASS   | `@ai-hero/sandcastle` `minor` — correct per `CLAUDE.md`          |
| README              | PASS   | New section follows surrounding structure                        |

### Lease-boundary semantics (independently verified — no off-by-one)

| Site                             | Rule                                 | Matching ledger rule                                |
| -------------------------------- | ------------------------------------ | --------------------------------------------------- |
| `Pass.ts:549` foreign-claim skip | `now < expiresAt` → `claim-conflict` | `LedgerStorage.ts:1267` `acceptedAt < expiresAt`    |
| `Pass.ts:399` renewal trigger    | `now + threshold >= expiresAt`       | `LedgerStorage.ts:831` `now >= expiresAt` → expired |

Since `renewalThresholdMs` is validated strictly positive, renewal always fires
strictly before ledger expiry. Consistent.

## Findings

### Critical

None.

### Major

- **W-M1 — `claim-expired` and `claim-authorization` have zero behavioral test coverage.**
  - Expected: FR-030 requires `claim-conflict`, `claim-expired`, `stale-fencing`, and
    `claim-authorization` each be "surfaced as a distinct stable outcome".
  - Found: both are live, reachable branches — `DevSquadAdoWorkflowWatcherPass.ts:196-215`
    (`mapAcquireError`), `:270-286` (`mapClaimedMutationError`), plus the
    claim-null guards at `:388` and `:494` — but across all five suites they occur
    **only inside literal enumeration arrays**
    (`DevSquadAdoWorkflowWatcher.test.ts:59-60`, `DevSquadAdoWorkflowWatcher.dependencies.test.ts:59-60`).
    No assertion of the form `reason: "claim-expired"` / `"claim-authorization"` exists.
  - Impact: a mutation collapsing either reason into `claim-conflict` — or remapping
    `claim-not-held` away from `claim-expired` (`Pass.ts:280-282`) — survives the
    entire 59-test suite. `claim-conflict` and `stale-fencing` are well covered;
    these two are not.
  - Suggested fix: add two cases driving a real expired lease and a real
    authorization mismatch through the ledger, asserting `kind`/`reason` and that
    no cursor advanced.

- **W-M2 — SC-002's "at least 1,000 overlapping two-owner trials" is never exercised.**
  - Expected: `spec.md:316` — "Across at least 1,000 overlapping two-owner trials on
    one work item, exactly one owner acts in every trial."
  - Found: `DevSquadAdoWorkflowWatcher.concurrency.test.ts:60`
    `const TWO_OWNER_TRIALS = FULL_SWEEP ? 1_000 : 150;` gated on
    `:59 process.env.SANDCASTLE_WATCHER_SWEEP === "full"`. No workflow under
    `.github/workflows/` (7 files) references `SANDCASTLE_WATCHER_SWEEP`, so the
    default 150 trials — 15% of the declared bar — is all that ever runs.
  - Note: this is _specific to SC-002_. SC-001's 1,000 **is** always run
    (`DevSquadAdoWorkflowWatcher.test.ts:39 REPEATED_PASS_TRIALS = 1_000`), and
    SC-003/SC-004 state no numeric bar, so their reduced sweeps
    (`:61 STALE_FENCING_TRIALS`, `test.ts:40 EXACTLY_ONCE_EVENTS`) are fine.
  - Suggested fix: either add a CI job that sets `SANDCASTLE_WATCHER_SWEEP=full`,
    or amend SC-002 to the scale actually committed to. This is a documented-vs-
    delivered mismatch, not a correctness defect.

### Minor

- **W-m1 — Injected `clock`/`delay` can escape as an untyped throw and strand a held claim.**
  - `DevSquadAdoWorkflowWatcherPass.ts` contains only two `try`/`catch` blocks:
    around `releaseClaim` (`:128-144`) and around the backoff `delay` (`:761-772`).
  - `options.clock()` at `:662` and `:717` is unguarded. A synchronous throw from
    `request.delay(...)` at `DevSquadAdoWorkflowWatcherObservation.ts:104` sits in a
    `try { … } finally { … }` with **no** `catch`.
  - Because the seam _is_ hardened against a sync throw
    (`Observation.ts:75-78` wraps `invoke()`), the hardening is inconsistent.
  - Impact: on the `checkpoint-indeterminate` carry-over path a claim is held
    across polls; an escaping throw bypasses the finalize release loop
    (`Pass.ts:783-791`), violating FR-001 and FR-029.
  - Real-ledger risk is low — `DevSquadAdoWorkflowLedgerStorage.ts` (16 catches)
    and `…Platform.ts` convert platform throws into Result errors, and
    `DevSquadAdoWorkflowLedger.ts` has none. Defense-in-depth only.

- **W-m2 — `lease.leaseDurationMs: 1` reports a validation error on a field the caller never supplied.**
  - `DevSquadAdoWorkflowWatcherValidation.ts:271` computes
    `Math.max(1, Math.trunc(1 / 3)) === 1`; `:280` then rejects with
    `field: "lease.renewalThresholdMs"`. Degenerate input, misleading field path.

- **W-m3 — Anchor deletion in the tracker re-emits already-processed events.**
  - `selectNewEntries` (`DevSquadAdoWorkflowWatcherObservation.ts:186-198`) returns
    **all** entries when the persisted anchor is absent from the seam response.
  - That is correct under the documented seam contract
    (`DevSquadAdoWorkflowWatcher.ts` seam JSDoc: "either includes the supplied
    `since` cursor as the first entry or returns only entries strictly after it"),
    but if the tracker deletes the anchored comment the seam cannot include it,
    and the watcher emits a duplicate intake burst — contradicting SC-004's
    "duplicate delivery rate is 0%".
  - The obligation genuinely belongs to the seam, but neither `spec.md`
    §Assumptions nor ADR-0026 names it. Suggest recording it as an assumption.

- **W-m4 — Assertions execute inside injected ledger wrappers.**
  - `DevSquadAdoWorkflowWatcher.concurrency.test.ts:196` and `:304` call `expect(...)`
    from inside a wrapped ledger method, i.e. within the watcher's own call stack.
    A failure there could be reshaped into a candidate outcome rather than failing
    cleanly. Outer assertions still fail the test, so impact is low.

### Suggestion

- **W-s1** — `src/DevSquadAdoWorkflowWatcherTestSupport.ts:12-13`: two `import`
  statements pull from the same module; merge them.
- **W-s2** — `passId` reuse across _different_ owners collides on derived operation
  ids, because `ownerId` is deliberately excluded from the digest
  (ADR-0026:76). It fails closed: the receipt digest differs, so
  `DevSquadAdoWorkflowLedgerStorage.ts:652` raises `idempotency-conflict`, which
  the watcher maps to `failed` (`Pass.ts:216-221`). No token leak and no
  cross-owner authority — verified. But `README.md:279-296` never states that
  `passId` must be unique per coordinator identity. One sentence would close it.
- **W-s3** — The duration budget is enforced only between polls
  (`Pass.ts:723-728`), so one poll over up to 1,000 candidates × 2 observations ×
  `observationTimeoutMs` can exceed `maxPassDurationMs` in wall-clock time. This
  matches FR-048's letter ("enforced before each additional poll") but not the
  plain reading of Scenario 5.

## Learning Insights

- **A reason code that only ever appears in an enumeration is not covered.**
  W-M1 is the canonical shape of a coverage illusion: `claim-expired` and
  `claim-authorization` are _named_ in the test files, so grep-based or
  eyeball-based coverage review reports them as handled, and line coverage may
  even mark the mapping branch as executed via a neighbouring case. The
  discriminating question is not "does the identifier appear in a test?" but
  "does an assertion fail if this branch returns the wrong value?" In production
  these two codes are exactly the ones that fire during lease expiry under load
  and after a takeover — the moments when an operator most needs the outcome to
  be distinguishable from an ordinary `claim-conflict`.
  - Found in: `DevSquadAdoWorkflowWatcher.test.ts:59-60`
  - Reference: spec FR-030

- **Guard every injected callable, not just the untrusted-looking one.**
  W-m1 shows selective hardening: the seam is treated as hostile
  (`Observation.ts:75-78` catches a synchronous throw) while `clock` and `delay`
  — equally caller-supplied, equally unvalidated beyond `isCallable` — are not.
  The asymmetry is invisible until a claim is held across polls, at which point
  an escaping throw skips the release loop and the work item stays locked until
  the lease expires. When a component's contract promises "releases every claim
  on every exit path", every `await` between acquisition and release is an exit
  path, including the ones that throw rather than return.
  - Found in: `DevSquadAdoWorkflowWatcherPass.ts:662`, `:717`; `DevSquadAdoWorkflowWatcherObservation.ts:104`
  - Reference: spec FR-001, FR-029

- **Numeric success criteria need an execution path, or they are aspirations.**
  W-M2 is a spec/CI contract break rather than a bug: SC-002 commits to 1,000
  trials, the suite defaults to 150, and no pipeline sets the escape hatch. The
  reduced default is a defensible latency tradeoff — the defect is that nothing
  reconciles it with the written bar, so the project believes it verifies
  something it never runs. Either the bar moves or a scheduled job runs it;
  leaving both in place lets confidence drift away from evidence.
  - Found in: `DevSquadAdoWorkflowWatcher.concurrency.test.ts:59-60` vs `spec.md:316`
  - Reference: spec SC-002

## Next Steps

Two Major findings to resolve before PR (both test/verification work, no
production-code behavior change required):

1. W-M1 — add behavioral coverage for `claim-expired` and `claim-authorization`.
2. W-M2 — reconcile SC-002 with what CI actually executes.

Minor findings W-m1…W-m4 and suggestions W-s1…W-s3 are non-blocking; W-m1 is the
one most worth folding into the same pass since it touches FR-029.

## Remediation (2026-09-08, same slice, pre-PR)

**Status after remediation**: all blocking findings closed. Suite 59 → 66 tests.

| Finding | Status   | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W-M1    | Closed   | Three behavioral tests in `DevSquadAdoWorkflowWatcher.concurrency.test.ts` (`claim authority outcomes`). Two drive the real ledger — a lease that reaches inclusive expiry between acquisition and checkpoint, and an acquisition whose capability no longer matches the persisted verifier — and one table-drives every claim-authority failure across both `mapAcquireError` and `mapClaimedMutationError`, including `claim-not-held → claim-expired`. Mutation-verified: collapsing either reason into `claim-conflict` fails all three (acquire path fails on `acquire-expired`, mutation path on `mutate-expired`).                                                                 |
| W-M2    | Closed   | `TWO_OWNER_TRIALS` is now an ungated `1_000`, so the committed default and CI (`npm test`) satisfy SC-002's stated bar. Trials are disjoint work items, so they run in bounded concurrent batches (`TWO_OWNER_BATCH = 25`): the sweep went from 128s sequential at 1,000 trials to ~22–28s, and the whole watcher suite moved 28.7s → 33.1s while running 6.7× the trials. Every per-trial assertion is unchanged and is now evaluated outside the injected ledger wrappers. `SANDCASTLE_WATCHER_SWEEP` still gates SC-003/SC-004, which state no numeric bar.                                                                                                                            |
| W-m1    | Closed   | `readClock` in `DevSquadAdoWorkflowWatcherPass.ts` treats a throwing clock exactly like an unusable reading: a validation error at pass start, and a `duration-budget-exhausted` stop mid-pass, so the finalize loop still releases held claims. `armTimeout` in `DevSquadAdoWorkflowWatcherObservation.ts` treats a synchronously throwing delay exactly like the already-handled rejected delay, so the observation can never run unbounded. No broad catch and no success-shaped fallback was added. Three tests in `bounds.test.ts` (`injected callable failures`) prove typed outcomes and claim cleanup; all three fail with an escaping untyped error when the guards are removed. |
| W-m2    | Closed   | `DevSquadAdoWorkflowWatcherValidation.ts` attributes the failure to `lease.leaseDurationMs` when the threshold was derived rather than supplied. Table row added to TEST-001.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| W-m3    | Closed   | Recorded as an **Anchor retention** assumption in `spec.md`, restated on the seam JSDoc in `DevSquadAdoWorkflowWatcher.ts`, and pinned by a focused `selectDevSquadAdoWatcherNewEntries` test that shows an absent anchor is indistinguishable from a post-cursor window.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| W-m4    | Closed   | The three cited sites plus one more of the same shape (`TEST-010` lost-acknowledgement) now record an outcome inside the wrapper and assert it after the pass returns.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| W-s1    | Closed   | Duplicate `DevSquadAdoWorkflowLedgerTestSupport` imports merged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| W-s2    | Deferred | README wording about per-owner `passId` uniqueness; documentation-only, no behavior change, deliberately out of this remediation scope.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| W-s3    | Deferred | Intra-poll duration overrun matches FR-048 as written; changing it is a spec decision, not a fix.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

Spec, plan, and tasks were updated only where an assumption or a verification
method changed: the anchor-retention assumption, TEST-009 broadened to the
claim-authority family, TEST-011 broadened to injected-callable failure,
SC-002's batched execution, and the lease field-attribution rule.

## Re-review (2026-09-08, turn 2) — historical pre-PR verdict (SUPERSEDED)

**Historical status (SUPERSEDED 2026-09-10)**: PASSED — Critical 0, Major 0. Cleared for PR at that time only; not current approval.

Remediation was re-verified independently rather than accepted from the fix
report. Every closed finding was re-derived from the code and from a rerun of
the smallest sufficient evidence.

### Blocker closure verified

| Finding | Verified how                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Verdict  |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| W-M1    | Three tests read in full. `concurrency.test.ts:338` drives the **real** ledger and advances its clock inside `checkpoint` so the lease crosses inclusive expiry between acquisition and mutation; `:398` wraps only `acquireClaim` to return a capability that no longer matches the persisted verifier. Both assert `reason` plus unchanged cursor (`"480"`), unchanged `checkpoints`, and retained `activeClaim`. `:480-576` table-drives all four acquire reasons and all three mutation reasons through the full public `runDevSquadAdoWorkflowWatchPass`, not through the mapper directly, so the assertions are behavioral rather than tautological. Collapsing either reason into `claim-conflict` would fail the `toMatchObject` assertions. | Closed   |
| W-M2    | `concurrency.test.ts:68` is now `const TWO_OWNER_TRIALS = 1_000;` with no `FULL_SWEEP` gate; `FULL_SWEEP` survives only for SC-003 (`:70`), which states no numeric bar. Observed live: SC-002 ran **39.2s** on the isolated suite and 34.9s on the ADO suite — consistent with 1,000 real trials, not 150. Batching (`:1254`, size 25) spans **disjoint** work items (`sweep-N`) on one shared ledger, so each trial still interleaves its own two owners deterministically via the `checkpoint` wrapper. Per-trial verdicts assert `passes === 2`, `acted === 1`, `conflicted === 1`, `cursor === "c1"`, `!claimHeld`. SC-002's spec text needed no amendment: the delivered bar now matches the written one.                                      | Closed   |
| W-m1    | `Pass.ts:95-105` `readClock` returns `null` on throw, converging with the pre-existing unusable-reading path. At `:682` a start-of-pass failure is a typed `validation` error on field `clock`; at `:734` a mid-pass failure sets `duration-budget-exhausted` and `break`s into the finalize loop (`:793-800`), which releases every held claim. `Observation.ts:106-118` `armTimeout` converts a synchronous `delay` throw into the same `{kind:"timeout"}` the rejected-delay path already produced. No broad catch and no success-shaped fallback was introduced. Backed by three tests (`bounds.test.ts:369`, `:461`, `:527`).                                                                                                                   | Closed   |
| W-m2    | `Validation.ts:271-293` now branches on `suppliedThreshold`: a supplied threshold is still blamed on `lease.renewalThresholdMs`, while a purely derived one blames `lease.leaseDurationMs`. The caller is never told about a field it did not provide.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Closed   |
| W-m3    | Recorded in `spec.md` §Assumptions as **Anchor retention** with an explicit **Owner: Host seam implementer**, and pinned by `DevSquadAdoWorkflowWatcher.test.ts:371-393`, whose comment states plainly that an absent anchor is indistinguishable from a post-cursor window. `selectDevSquadAdoWatcherNewEntries` is imported from the internal module and is **not** re-exported through `src/index.ts`, so no public surface grew.                                                                                                                                                                                                                                                                                                                 | Closed   |
| W-m4    | The two-owner sweep now returns a `TwoOwnerVerdict` from inside the wrapper and asserts on the collected array after the pass returns (`:1265-1285`). No `expect` runs inside the watcher call stack on that path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Closed   |
| W-s1    | Duplicate `DevSquadAdoWorkflowLedgerTestSupport` imports merged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Closed   |
| W-s2/s3 | Deferred, documentation/spec-decision only. Both remain non-blocking and are accurately labelled as deferred rather than fixed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Accepted |

### Evidence rerun

| Command                                         | Result                                     |
| ----------------------------------------------- | ------------------------------------------ |
| `npx vitest run src/DevSquadAdoWorkflowWatcher` | **66 passed / 5 files, 0 skipped** (61.2s) |
| `npx vitest run src/DevSquadAdo`                | **130 passed / 2 skipped / 10 files**      |
| `npx tsc --noEmit -p tsconfig.json`             | exit 0                                     |
| `npx prettier --check` (all slice-14 paths)     | all files use Prettier style               |
| `.only` / `.skip` / `.todo` in watcher tests    | 0                                          |
| `tasks.md` checkboxes                           | 22/22 checked                              |

The fix report's "149 passed / 2 skipped" for the broader suite did not
reproduce as stated — the `src/DevSquadAdo` selector yields **130 passed / 2
skipped across 10 files**. The difference is selector scope, not a failure: zero
tests fail in that scope either way. Recorded for accuracy only.

### Full-suite result — investigated, not a slice-14 regression

`npm test` (full `vitest run`, which is exactly what `ci.yml:18` executes) fails
locally: 24 files, ~222–225 tests. This was investigated rather than waved off,
because CI runs the same command.

Attribution — environmental, on this Windows host:

- `podman` is **MISSING** on PATH → `src/sandboxes/podman.test.ts` alone accounts for 26 failures.
- `src/startSandbox.test.ts` / `src/syncIn.test.ts` fail on `git clone "/tmp/sandcastle-*/repo.bundle"` — Linux container paths resolved against a Windows host.
- `src/CopyToWorktree.test.ts` fails on `spawn cp ENOENT`; `createSandbox-windowsMounts`, `interactive-windowsMounts`, `resolveCwd`, `cli` (docker image build) are the same class of host-capability gap.
- **No failing test file references `DevSquadAdoWorkflowWatcher` or any slice-14 symbol** (verified by search across all 12 principal failing files).
- Failure counts drifted between two identical back-to-back runs (225 → 222), which is the signature of environment nondeterminism, not deterministic breakage.
- Mechanically, slice 14 cannot reach these tests: `README.md` and `src/index.ts` are **additive only** (`git diff --numstat` = `176 0` and `35 0`, zero deleted lines), and every other slice-14 path is a new file.

These failures are pre-existing on the base branch for this workstation and are
expected to pass on the Linux CI runner where Docker and POSIX tooling exist.
**Not a blocker for this slice**, and deliberately not counted as a finding
against it.

### Stacked-base delta — still clean

`git rev-parse HEAD` and `git rev-parse users/davidsant/ubiquitous-train` are
both `9ff6e8e9f74792e131e927bd9bf41358e36cea95`; `merge-base` is identical and
`git diff --stat <base>...HEAD` is empty. Slice 14 remains entirely uncommitted
working-tree content — 2 additive-only modified files and 13 untracked paths —
on an exactly-aligned base. Zero base commits or files are duplicated.

### Verdict

**PASS.** No Critical and no Major findings remain. The two Major findings were
verification-strength gaps and both are now backed by executing assertions, not
by enumeration. No new blocker was introduced by the remediation: the changes
are narrow, fail-closed, and add no broad exception handling, no public API
surface, and no success-shaped fallback. Conformance documentation is truthful —
SC-002's written bar is now the bar that actually runs, and the anchor-retention
obligation is stated as an assumption with a named owner rather than left
implicit. Cleared for PR; approval remains the human reviewer's act.

---

## Deep review (three-perspective) — 2026-09-08

**Reviewers**: adversarial advocate / skeptic / architect, run independently over
the three committed slice-14 commits (`5755b77`, `98722a5`, `b0520fc`).
**Outcome**: the perspectives disagreed. The earlier DevSquad review had passed,
but evidence-backed blockers from the skeptic and the architect were accepted and
fixed; the advocate's position that the slice was release-ready was not.

### Status

**Status**: BLOCKERS REMEDIATED — 4 blockers, 5 coupled medium findings, all fixed.

### B1 — Claim-lifecycle replay contradiction (correctness, accepted)

`Pass.ts` derived a stable claim `operationId` from `passId` while supplying a
freshly random `claimToken`. The slice-13 request digest includes the token
(`NormalizedAcquireInput.claimToken` feeds `requestDigest("acquire-claim", ...)`),
so retrying the same `passId` after a durable acquire produced a permanent
`idempotency-conflict` for that candidate — with no cursor ever advanced and no
retry able to clear it. ADR-0026 promised the same `passId` would be replayable
and that a conflict is never resolved by changing identifier; the README told
hosts to rotate `passId`. Both could not be true.

**Resolution**: claim-lifecycle identifiers (`claim`, `renew`, `release`) are now
scoped to a random per-acquisition `claimEpoch`; checkpoint identifiers are scoped
to the observation generation they publish. Tokens stay cryptographically random.
Prefix `dsw1.` → `dsw2.`, identity `v: 1` → `v: 2`, and
`DevSquadAdoWatcherOperationIdentity` is now a discriminated union so the exported
derivation API states which scope applies to which step. Renew and release digests
are covered, not only acquire. See W023.

### B2 — Stale observation cursor regression (correctness, accepted)

The order was read → observe → claim, with the checkpoint written against the
post-claim revision but the pre-claim anchors. A second watcher could advance the
cursor and release inside that window; the first watcher then acquired
legitimately and would have overwritten the cursor **backwards**, re-delivering
every event between the two positions. No fence was violated, so fencing did not
close it.

**Resolution**: anchors and pull-request identity from the pre-claim read are
compared against the record returned by the acquisition. On mismatch the claim is
released, nothing is written, and the candidate reports `no-change` /
`stale-observation`, re-observing on a later poll. See W024.

### B3 — Untyped ledger escapes and stranded claims (correctness, accepted)

Injected ledger methods were awaited unguarded, so a throw or rejection escaped
the pass as a raw `Error` — carrying its message and stack out through a public
API documented as returning typed, redacted results — and abandoned any claim the
candidate was holding, because the release path lives on candidate resolution.

**Resolution**: all five ledger calls route through one classifier that maps a
throw, a rejection, or a non-typed result to `failed` / `ledger-unavailable` with
`ledgerErrorKind: "ledger-fault"`. Typed ledger errors keep their existing mapped
paths, so this is not a blanket catch. See W025.

### B4 — Misnamed duration guarantee (honesty, accepted)

`maxPassDurationMs` was only checked between polls while candidate work and
ledger calls ran unbounded inside a poll, so the name promised a bound the
implementation never enforced.

**Resolution**: the honest contract was chosen over the nominal one. The option is
now `maxPollStartElapsedMs` and the stop reason `poll-start-budget-exhausted`,
documented as bounding poll starts rather than pass duration. A strict bound was
rejected on the record: enforcing it means abandoning in-flight ledger mutations,
which trades a soft guarantee for stranded claims and indeterminate writes.
Termination remains guaranteed by `maxPolls`, `observationTimeoutMs`, and the
caller's abort signal. INV-011, SC-005, FR-047, FR-048, the ADR and the README are
amended. See W026.

### Coupled medium findings (all fixed, W027)

| Finding                                                               | Resolution                                                                                |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Missing anchor in a non-empty window silently re-delivered the window | Seam contract narrowed to anchor-inclusive; fail closed with `observation-anchor-missing` |
| `changedKinds` and `skippedCursorKinds` could name the same kind      | A kind is skipped only when no persistable cursor exists for it                           |
| SC-004 / ADR claimed lossless exactly-once delivery                   | Restated as at-most-once and never duplicating, with the loss case named                  |
| W015 / TEST-023 traceability and stale pass-identity spec wording     | FR-057 row split out; "or the watcher derives" removed                                    |
| Mid-observation cancellation diagnosed as `observation-failed`        | Reported as `cancelled` when the signal is already aborted                                |

### Verification after remediation

| Command                                                  | Result                                |
| -------------------------------------------------------- | ------------------------------------- |
| `npx vitest run src/DevSquadAdoWorkflowWatcher*.test.ts` | PASS — 73 passed / 5 files            |
| `npx vitest run src/DevSquadAdoWorkflowLedger*.test.ts`  | PASS — 64 passed, 2 skipped / 5 files |
| `npm run typecheck`                                      | PASS — exit 0                         |
| `node scripts/check-public-types-effect-free.mjs`        | PASS — public declaration Effect-free |
| `npx prettier --check <touched files>`                   | PASS                                  |
| `git diff --check`                                       | PASS — no whitespace errors           |

Seven new tests were added: two for B1 (retry after an unlanded checkpoint;
claim-lifecycle identifier disjointness), two for B2 (two-owner interleaving
10 → 15 with no 15 → 12 regression and no duplicate signal; `stale-observation`
reason and claim release), and three for B3 (all four mutating methods across
throw / reject / untyped-result shapes; checkpoint rejection after acquire;
release rejection preserving an acknowledged outcome), plus one for the anchor-loss
contract. No secret, claim token, message, or stack appears in any result
projection.

The 24 unrelated pre-existing Windows failures (Docker/Podman/POSIX-path suites)
are unchanged; none of those files reference any module touched here.

---

## Independent remediation verification — 2026-09-08

**Reviewer**: `devsquad.review`, clean context, read-only. Verified the uncommitted
slice-14 remediation against `HEAD` (`b0520fc`) by inspecting source, tests, docs,
and the ledger digest/replay path, and by re-running the suites.

**Status**: PASSED_WITH_FINDINGS — B1–B4 confirmed fixed; 3 Major, 2 Minor open.

### Blocker verification

| ID  | Verdict   | Independent evidence                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | CONFIRMED | `Validation.ts:401-424` splits the identity union; `claimEpoch` minted per acquisition at `Pass.ts:754` and reused by renew (`:515`) and release (`:210`). `Storage.ts:1247` folds `NormalizedAcquireInput` (token included) into the digest, so `findReceipt` (`:639-654`) can no longer collide. `concurrency.test.ts:962` drives a real ledger through acquire → unlanded checkpoint → same-`passId` retry and asserts the retry `acted`. |
| B2  | CONFIRMED | `observationAnchorsMatch` (`Pass.ts:396-406`) compares both cursor anchors and `pullRequest.id` from the pre-claim read against `acquireClaim`'s returned record; mismatch releases without writing (`Pass.ts:803-810`). `concurrency.test.ts:173` asserts `checkpointPatches === ["15"]`, i.e. `12` is never written over `15`, and no duplicate signal.                                                                                    |
| B3  | CONFIRMED | All five ledger calls route through `callLedger` (`Pass.ts:207, 511, 552, 619, 666, 755`); no unguarded `context.ledger.*` remains. Clock via `readClock`, backoff delay in try/catch (`Pass.ts:947`), seam delay in `armTimeout`. `recovery.test.ts:309` covers 4 methods × 4 fault shapes and asserts the secret, `Error:`, and `"stack"` are absent from the serialized result.                                                           |
| B4  | CONFIRMED | Rename complete in code and on the public surface; corrected repo-wide search finds no `maxPassDurationMs`, `duration-budget-exhausted`, or `dsw1` outside historical records. Gate is poll-start only (`Pass.ts:908-914`), first poll always starts. Stop reason exercised at `bounds.test.ts:190, 510, 815, 830`.                                                                                                                          |

### Reproduced validation

| Command                                                  | Result                                |
| -------------------------------------------------------- | ------------------------------------- |
| `npx vitest run src/DevSquadAdoWorkflowWatcher*.test.ts` | PASS — 73 passed / 5 files            |
| `npx vitest run src/DevSquadAdoWorkflowLedger*.test.ts`  | PASS — 64 passed, 2 skipped / 5 files |
| `npm run typecheck`                                      | PASS — exit 0                         |
| `node scripts/check-public-types-effect-free.mjs`        | PASS                                  |
| `git diff --check`                                       | PASS                                  |

`prettier --check .` flags 9 files, none of them touched by this change set
(pre-existing on the base commit).

### Open findings

- **R1 (Major)** `plan.md:31` still states the watcher will "Terminate inside the
  caller-declared poll **and duration budget**" — the exact promise B4 removed
  from INV-011, SC-005, ADR-0026, and the README. The plan's Responsibilities
  section is normative and was in scope for W026.
- **R2 (Major)** `plan.md:667` still states "**Exactly-once** applies to
  ledger-mediated intake delivery only". Contradicts INV-006 (renamed
  "Non-duplicating intake"), SC-004, ADR-0026:117, and the README. The plan's
  "Architectural assumptions" section was never edited by the remediation;
  `tasks.md:267` enumerates SC-004, INV-006, the ADR, and the README, and omits
  `plan.md` — the traceable root cause.
- **R3 (Major)** FR-034's new disjointness clause (`spec.md:154`) and the TEST-022
  claim (`spec.md:318`) that "`cursorChanges` and `skippedCursorKinds` never name
  the same kind" have no covering test. The only incomplete-entry fixture in the
  suite (`DevSquadAdoWorkflowWatcher.test.ts:761`) is the _all_-incomplete case.
  The mixed case that the new backward scan implements
  (`Observation.ts:313-324` — advance to the newest complete entry and do _not_
  report the kind as skipped) is unexercised. Behaviour is correct by inspection.
- **R4 (Minor)** CC-021–CC-024 carry no `[CC-0xx]` tag in any test title, breaking
  the convention held by CC-001–CC-020. `tasks.md:243, 249, 255, 265` do map them,
  which limits the impact to test-title traceability.
- **R5 (Minor)** Residual "duration budget" phrasing at `spec.md:312` (TEST-016)
  and `plan.md:52`; same root cause as R1.

No correctness, security, or regression finding. Approval remains the human
reviewer's act.

---

## Historical recovery review — 2026-09-09 (SUPERSEDED; pre-PR, branch `users/davidsant/symmetrical-train`)

**Context**: slice 14 was recovered onto a continuation branch after the previous
working tree was lost. The four preserved commits (`5755b77`, `98722a5`,
`b0520fc`, `f337506`) were verified intact and re-validated from a clean
`npm ci`. This turn closes the findings the previous section left open.

### Correction to the previous section's premise

The "Independent remediation verification" section above describes slice 14 as
"entirely uncommitted working-tree content". That was accurate when written; it
is **no longer true**. Slice 14 is now four commits on
`users/davidsant/symmetrical-train`, whose merge-base with
`users/davidsant/ubiquitous-train` is `9ff6e8e` — the exact tip of the base
branch. The earlier text is retained as a historical record, not as a current
claim.

### Open findings from the previous turn — resolved

| ID  | Severity | Status | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | -------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Major    | Fixed  | `plan.md` §Watcher responsibilities no longer promises termination "inside the caller-declared poll **and duration budget**". It now states the poll-budget guarantee and records that the poll-start elapsed budget gates when a poll may begin, not total elapsed time — matching INV-011, SC-005, FR-047/FR-048, ADR-0026, and the README.                                                                                                                                                                                                                                                        |
| R2  | Major    | Fixed  | `plan.md` §Architectural assumptions no longer claims "Exactly-once applies to ledger-mediated intake delivery only". Restated as at-most-once and never duplicating, naming the loss case (durable checkpoint whose acknowledgement is never observed) and directing hosts to reconcile from the durable record. Now consistent with INV-006, SC-004, and ADR-0026:117.                                                                                                                                                                                                                             |
| R3  | Major    | Fixed  | New test `[TEST-022][CC-019] advances to the newest complete pull-request entry without also reporting the kind as skipped` (`DevSquadAdoWorkflowWatcher.test.ts`). Table-drives both mixed shapes — newest entry incomplete with an older complete entry, and an incomplete entry followed by a newer complete one — asserting the durable cursor lands on the newest **complete** entry, `skippedCursorKinds` is empty, and `cursorChanges ∩ skippedCursorKinds = ∅`. **Mutation-verified**: restricting the backward scan in `Observation.ts:312-324` to the last entry only makes the test fail. |
| R4  | Minor    | Fixed  | `[CC-021]`…`[CC-024]` tags added to the five owning test titles, restoring the convention held by CC-001–CC-020: CC-021 → replayable pass identity; CC-022 → both stale-observation tests; CC-023 → anchor lost from a non-empty window; CC-024 → faulting injected ledger method.                                                                                                                                                                                                                                                                                                                   |
| R5  | Minor    | Fixed  | Residual "duration budget" phrasing removed from `spec.md` TEST-016 and `plan.md` §New source files. A repo-wide search now finds `duration budget` / `maxPassDurationMs` / `duration-budget-exhausted` only inside this log's historical records.                                                                                                                                                                                                                                                                                                                                                   |

W-s2 and W-s3 remain **deferred** and are unchanged: both are documentation or
spec-decision items, non-blocking, and accurately labelled as deferred rather
than fixed.

### Final validation evidence (this branch, clean `npm ci`)

| Command                                           | Result                                                      |
| ------------------------------------------------- | ----------------------------------------------------------- |
| `npx vitest run src/DevSquadAdoWorkflowWatcher`   | **PASS — 74 passed / 5 files, 0 skipped** (25.9s)           |
| `npx vitest run src/DevSquadAdoWorkflowLedger`    | **PASS — 64 passed, 2 skipped / 5 files** (slice 13 intact) |
| `npm run typecheck` (`tsgo --noEmit`)             | **PASS — exit 0**                                           |
| `npx tsup` (ESM + DTS)                            | **PASS — ESM and DTS build success**                        |
| `node scripts/check-public-types-effect-free.mjs` | **PASS — no Effect references in public `.d.ts`**           |
| `npx prettier --check <slice-14 files>`           | **PASS — all matched files use Prettier code style**        |
| `git diff --check` (base…HEAD)                    | **PASS — no whitespace errors**                             |
| `.only` / `.skip` / `.todo` in watcher tests      | 0                                                           |
| `tasks.md` checkboxes                             | 28/28 checked, 0 unchecked                                  |

Test count moved 73 → 74; the single new test is R3's.

### Stacked-base delta

`git merge-base users/davidsant/symmetrical-train origin/users/davidsant/ubiquitous-train`
= `9ff6e8e`, identical to the base tip. `git diff --stat <base>...HEAD` is
**additive only across 18 paths** — 13 new slice-14 files plus `README.md`,
`src/index.ts`, the changeset, the ADR, and the feature docs. No base-branch
commit or file is duplicated, and no file outside the ADO watcher slice is
touched.

### Pre-existing environmental failures (unchanged, not a slice-14 defect)

`npm test` (full suite) still fails on this Windows host for the reasons already
documented above: `podman` absent from PATH, POSIX-only paths and `cp` in the
sandbox/worktree suites, and Docker image builds. No failing file references any
slice-14 symbol, and every slice-14 change is additive, so the slice cannot
reach them. Expected to pass on the Linux CI runner.

### Verdict

**Historical PASSED — Critical 0, Major 0, Minor 0 open (SUPERSEDED by R14-001–007 and additional cleanup/preflight/traceability review on 2026-09-10).** All five findings left open by
the previous turn are closed: three were documentation-truthfulness defects
(R1, R2, R5) where the plan still promised guarantees the implementation had
deliberately withdrawn, one was a genuine coverage gap on FR-034's disjointness
clause (R3), and one was traceability hygiene (R4). No production source file
changed in this turn — the only `src/` edits are test additions and test-title
tags — so the validated behaviour of the preserved commits is unaltered.
The then-current clearance for PR is superseded. Current status at that historical review was REMEDIATION REQUIRED; approval remains the authorized reviewer's act.

## Historical 2026-09-10: W030-W037 implementation evidence (312-test implementation turn, superseded)

At that historical implementation turn, the approved recovery was implemented
in this worktree and W038 remained pending for the parent coordinator's
independent review and publication decision. This entry is not the final
401-test independent review or current publication status; it does not
reinstate any historical PASS verdict or accept either Proposed ADR.

### Finding coverage

| Finding / task                                | Implementation and regression evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R14-001 / W030 / TEST-026                     | New watcher-local ledger guard snapshots responses before validation and checks all five methods' complete public records, original success metadata, request identity/owner/token/fence/checkpoint consistency, and required fields of every known error variant. Unknown/malformed payloads, throws, and accessors are quarantined as `ledger-fault`. The remediation suite exercises each method, field omissions, mismatches, unknown/malformed errors, replay against newer records, and durable mutation followed by malformed acknowledgement. No fabricated acquire authority or release. Ledger implementation/schema are unchanged. |
| R14-002 / W031 / TEST-027                     | Signal preflight requires boolean `aborted` and callable add/remove listeners with zero injected calls for invalid inputs. A work-item response that aborts the parent cannot invoke the PR seam or acquire a claim.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| R14-003/005/007 / W032 / TEST-028             | Both windows check the 1,000-entry bound before iteration, incrementally validate 1,024-byte identifiers, exact uniqueness, and the 1,048,576-byte aggregate limit before retention. Tests cover duplicate anchors/nonanchors, missing/null PR equivalence, blank rejection, oversized first-element getters, multibyte maximum WI windows, PR aggregate exact/one-over bounds, missing anchors, authoritative opaque order, and newest complete mixed PR cursors with disjoint skips.                                                                                                                                                        |
| R14-004 / W033 / TEST-029                     | Every seam gets a dedicated parent-linked child signal. Every terminal path retires child/timer/listener state. Tests assert balanced parent listeners, maximum cooperative seam/timer concurrency of one, timeout/abort cancellation, and late fulfillment/rejection quarantine, including a timeout-winner continuation race. Noncooperating work can remain physically active and is documented as such.                                                                                                                                                                                                                                   |
| Cleanup extras / W034 / TEST-030              | Mandatory cleanup includes explicit status/reason/category/original release revision. Exactly one release uses previously validated authority; ambiguous acquire has zero release attempts. Rejected/ambiguous/malformed cleanup is surfaced without retracting acknowledged cursors or signals. Matrix tests cover admitted/suppressed/primary-failed outcomes, abort, budgets, stale observations, clock/delay faults, and cleanup count partitioning.                                                                                                                                                                                      |
| R14-006 and metadata extras / W035 / TEST-031 | Tests prove source 4, acquire 5, checkpoint 6, cleanup 7, unchanged repeat 7; full intake metadata; original replay acknowledgements with latest foreign ownership; PR identity/cursor staleness; terminal idempotency conflict without replacement operation IDs. The real-ledger takeover test now explicitly asserts revision/fence increments and stale-fence cleanup rejection.                                                                                                                                                                                                                                                          |
| W036 / TEST-032                               | Boundary regressions cover candidate 1/1,000/1,001 and canonical duplicates; poll 1/10,000/10,001 and unsafe values; positive safe durations; lease/renewal bounds; backoff bounds; and zero clock/delay/seam/ledger calls on invalid configuration.                                                                                                                                                                                                                                                                                                                                                                                          |
| W037 / TEST-025                               | Package exports require cleanup, the exact known ledger-category union, all four cleanup counts, 27 reason codes, and four stop codes. The runtime dependency graph includes only the new local validator in addition to prior allowed modules. README guarantees are corrected. Existing changesets were inspected; one patch bugfix changeset was added and the existing minor feature's inaccurate guarantee text corrected.                                                                                                                                                                                                               |

The new `src/DevSquadAdoWorkflowWatcher.remediation.test.ts` has **174 passing
tests**, including table-driven cases and internal required-field matrices.
Existing watcher regressions were updated only where they asserted superseded
behavior (silent cleanup success, unvalidated capability use, or incomplete
public counts). The state-conflict fixture now exercises the ledger's actual
typed rejection instead of returning a malformed successful record.

During implementation, targeted regression assertions exposed two additional
validator defects: a relative worktree path was incorrectly accepted, and
semantically equal checkpoint objects with different property order were
incorrectly rejected. Both were reproduced as failing tests and corrected.
This is implementation evidence, not a claim that every new matrix was first
run against the unmodified baseline.

### Historical local implementation validation (312 tests, not the final review)

| Command                                                                 | Actual result                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm test -- DevSquadAdoWorkflowWatcher DevSquadAdoWorkflowLedger`      | **312 passed, 2 pre-existing skipped, 11 files passed** (314 total; 2026-09-10 10:20 local run). No new skip/only/todo tests.                                                                                                                                                                                                  |
| `npm run typecheck`                                                     | **Passed**, `tsgo --noEmit`.                                                                                                                                                                                                                                                                                                   |
| `npm run build`                                                         | **ESM and DTS builds passed**. The npm lifecycle still fails in the pre-existing Windows postbuild command: `'rm' is not recognized as an internal or external command, operable program or batch file.` Its `rm -rf ... && cp -r ...` template-copy step did not run. No build-script remediation or packaging-success claim. |
| `node scripts\check-public-types-effect-free.mjs`                       | **Passed** against the freshly built declarations: `No Effect references in public .d.ts files`.                                                                                                                                                                                                                               |
| `npx prettier --check --ignore-path .gitignore <changed .ts/.md files>` | **Passed** for all changed files, including both changesets and the pre-existing amended feature documents. No whole-repository formatting.                                                                                                                                                                                    |
| `git diff --check`                                                      | **Passed**, no whitespace errors. Explicit diff checks also confirmed ledger implementation/schema, ADR-0025, `package.json`, and `package-lock.json` were unchanged.                                                                                                                                                          |

### Boundaries at that historical implementation turn

- At that historical implementation turn, W038 independent review and publication
  remained the parent's responsibility; both technical review and implementation
  publication subsequently completed as recorded below.
- At that historical implementation turn, no commit, push, PR update, merge,
  board change, factory, slice-15 work, or ADR acceptance was performed.
  ADR-0025, ledger code/schema, and dependency manifests remained unchanged.
- Scheduling/window bounds and cooperative cancellation are not a hard runtime
  guarantee for nonsettling dependencies.
- Durable-but-unacknowledged writes and host crashes can lose at-most-once intake
  signals; the host reconciles durable cursors against intake processing.

## FINAL 2026-09-10 publication and evidence correction

**Authoritative current disposition: W029-W037 complete; W038 completed TECHNICAL only. Final independent turn 4 PASSED: 0 Critical, 0 Major, 1 nonblocking Minor TB001. Implementation publication is complete, not pending.** This dated entry corrects documentary ambiguity only; no independent review, tests, probes or build were rerun for this correction. Earlier 312-test implementation evidence and pending/no-publication statements are explicitly historical, not the final gate.

### Portable original evidence and attribution

[final-review-evidence.json](final-review-evidence.json) preserves the exact user-visible content of seven `assistant.message` records from authorized local session `9cfd7f94-8a2a-415f-afc6-c21a45276485`. Each record contains only event ID, timestamp, supplied worker/agent attribution, parent tool-call ID and original content. The export includes the final aggregate report verbatim, not invented reports or probe source. Raw logs, prompts, tool arguments, reasoning and encrypted fields are not exported. Original report-time pending-publication/HEAD statements remain verbatim historical evidence; this entry records the subsequent publication.

| Worker / role                                                 | Exact event ID (2026-09-10 UTC)                        | Verdict and limits                                                                                                                                                           |
| ------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gate-spec` / `devsquad:devsquad.review.spec`                 | `77864725-73d1-42e8-9fef-b8282ef970f7` (18:34:49.259Z) | Bounded static conformance PASS; mappings inspected, no runtime probes or W038 approval.                                                                                     |
| `gate-adr` / `devsquad:devsquad.review.adr`                   | `ef24b250-1a2a-4c89-ac3c-f2350583b507` (18:34:21.236Z) | Scoped static architecture PASS; no runtime certification or ADR acceptance.                                                                                                 |
| `gate-code` / `devsquad:devsquad.review.code`                 | `a82f29e2-8757-4b89-b600-6c4be02f3562` (18:34:08.271Z) | No new blocker in bounded static source inspection; no tests/probes or exhaustive repository audit.                                                                          |
| `gate-security` / `devsquad:devsquad.review.security`         | `6d15c272-4b5c-4df1-92a6-4d122830b206` (18:34:14.540Z) | Triggers detected, no static finding; explicitly not a completed specialist gate and no exploit probes. Separate specialist below completed that gate.                       |
| `gate-tests` / `devsquad:devsquad.review.tests`               | `4839c254-aefd-455a-accf-ea8cf6009bb5` (18:35:21.957Z) | Independently executed 401/19 selectors and checks below; TB-001 Minor; no build/full-suite rerun or real-ledger enforcement certification from the fakes.                   |
| `gate-security-specialist` / `security-review`                | `3ed80047-0faa-4fd6-8f5f-f002914d6b90` (18:37:07.681Z) | “No security vulnerabilities found in the reviewed changes.” No additional execution detail is asserted by this short report.                                                |
| `slice14-final-independent-gate` / `devsquad:devsquad.review` | `e5c8f458-36c9-48fb-b5f3-d978a165a05d` (18:41:14.783Z) | Aggregate PASS, 0 Critical/0 Major/1 nonblocking Minor; parent independently authored/executed 36 public-pass probes and traced receipt behavior. Not governance acceptance. |

The static spec, ADR and code guardians did **not** execute the aggregate parent's runtime probes. Five guardians plus the separate security specialist supplied the final aggregate review; technical completion was subsequently recorded by the parent.

### Final independent evidence versus inherited implementation evidence

- Combined watcher/ledger selector: **401 passed, 2 existing Windows skips, 11 files**, exit 0.
- Third-history selector: **19 passed, 244 deselected**, exit 0.
- Aggregate parent's independently authored in-memory public-pass probes: **36 passed = 31 boundary + 5 receipt/renewal**. The initial 31-probe harness exited 13 because polling delay and observation timer fixtures were confused; the corrected fixture passed, with no product defect inferred.
- `npm run typecheck`: exit 0. Public Effect-free type guard: exit 0 against existing generated declarations, not fresh declaration generation.
- Changed-path Prettier: 20 paths supplied, existing changeset ignore respected. Tracked/untracked whitespace checks: no diagnostics.
- **No final-review build rerun.** Latest implementation build evidence: ESM PASS in 16.296s and DTS PASS in 24.107s, followed by canonical lifecycle exit 1 at unchanged Windows postbuild `'rm' is not recognized`; template copy was **not reached**. No fresh packaging, full-suite, live-system or deployment success is claimed.

All R14-001–007, RC14-001–008, SC-01/02, SL14-001 and DOC14-001 findings are closed/preserved within the reviewed slice, including the cleanup, preflight, bounds, metadata and traceability extras in the final closure matrix above. **TB001 (original worker spelling TB-001)** remains a nonblocking Minor: older internal-guard/object-identity test coupling at remediation test report-time lines 953, 1021, 1288 and 2423. No implementation change is required for this gate.

### Publication and code identity

Local and published implementation commit: **`d5aecf0ba1e276642ddfc683fc756320598642f6`**, a normal fast-forward from `fb6a2389dbbbd504c220653c6258d850e466225c`. [PR #21](https://github.com/davidsantf/sandcastle/pull/21) head is `users/davidsant/symmetrical-train`; base is `users/davidsant/ubiquitous-train` at `9ff6e8e9f74792e131e927bd9bf41358e36cea95`. No merge occurred.

The independent reviewer ran on the **uncommitted implementation tree over `fb6a238`**, subsequently committed as `d5aecf0`. The commit attribution below is documentary metadata added now; there is no claim that the original reviewer recorded a pre-commit cryptographic snapshot. The unchanged source comparison proves this documentation-only correction preserves the published implementation, while the original reports establish review provenance.

| Published implementation object | Git object ID                              |
| ------------------------------- | ------------------------------------------ |
| `src` tree                      | `f8cc4221f4c2ebd787ad9740acc6bfb1bbd6bf06` |
| `package.json` blob             | `d61b96a3bd64d8465e2f430f217800d31983650a` |
| `package-lock.json` blob        | `e27a973b594ed8a5438e2e3e2962697b53958819` |
| `tsconfig.json` blob            | `200835416a6ed7e7a2a400f66efd5d0b28344ff4` |
| `tsup.config.ts` blob           | `aab0be72f61782bba2d124de02a07a2e778fcbb7` |
| `vitest.config.ts` blob         | `8730a5bbf61f37f4f6a3dc35c816de6f2387af78` |

Documentation-only validation is restricted to the two Markdown files and JSON export: targeted Prettier, JSON parsing with all seven contents compared exactly against the original selected messages, `git diff --check`, and `git diff --exit-code d5aecf0ba1e276642ddfc683fc756320598642f6 -- src package.json package-lock.json tsconfig.json tsup.config.ts vitest.config.ts scripts`. The parent will record the resulting documentation-only commit SHA in the PR/handoff; that follow-up SHA is not yet known here and does not make implementation publication pending.

### Explicit deferred capability and remaining authority

The **original broader discovery/filtering requirement is deferred and not fully delivered**: the current API consumes host-supplied candidates and exact host-owned phase/status rules. It does not discover or filter tracker candidates or orchestrate lifecycle. No factory, live client or outbox is supplied.

At-most-once signals can be lost and require host reconciliation. Cancellation is cooperative; nonsettling dependencies cannot be forcibly terminated and valid delay/settlement assumptions remain. One cleanup attempt does not guarantee release when state is unknown; inclusive lease expiry is the backstop.

ADR-0025/0026 remain **Proposed**, pending authorized acceptance. W038 technical completion and implementation publication are not governance acceptance or merge readiness. **PR #20 must precede #21. Slice 15 remains blocked pending the creator's explicit decision; no slice-15 work or archival is authorized by this entry.**

---

## W046 independent full integration review — 2026-09-10, turn 1

### Result and scope

**Verdict: FAIL / FAILED. W046 remains open.** One deduplicated **Major integration blocker**, W046-001, was independently identified by the spec, ADR and code guardians and reproduced by the coordinating reviewer. No Critical finding was established. Three additional Major baseline/environment verification findings are retained below; they are not attributed to the integration delta and do not independently require watcher remediation. Historical Minor TB001 remains acknowledged, unchanged and nonblocking; it is not a new finding.

This review covers the **entire PR21 integration-base delta**, including supplied-candidate implementation, recovery and W039–W045 discovery, not merely W042–W045 or the stale published head. Existing W038 PASS and earlier review sections remain historical supplied-candidate evidence, not discovery acceptance. No tasks, source, tests, specs, ADRs, package files, branches, PRs or board items were modified. The only persistent review edit is this append to `review-log.md`. A separate new evidence file was not created because this review's write surface is the append-only review log.

| Provenance                        | Verified value                                                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Workspace                         | `C:\repos\copilot-worktrees\sandcastle\users-davidsant-bookish-doodle` only                                                                |
| Branch                            | `users/davidsant/bookish-doodle`                                                                                                           |
| Reviewed HEAD                     | `3c2254884b800a3401594067a13ddd578aedcf20`                                                                                                 |
| Reviewed committed tree           | `d8d49275dfd6c873b07e3836710d162e60905d67`                                                                                                 |
| Actual integration merge-base     | `9ff6e8e9f74792e131e927bd9bf41358e36cea95`                                                                                                 |
| Base refs inspected               | `refs/heads/users/davidsant/ubiquitous-train` and `refs/remotes/origin/users/davidsant/ubiquitous-train`, both at that merge-base          |
| Diff                              | `git diff 9ff6e8e9f74792e131e927bd9bf41358e36cea95 HEAD`: 32 files, 23,818 additions, no deletions                                         |
| Initial/final pre-evidence status | Clean; HEAD/tree rechecked unchanged after workers and probes                                                                              |
| Remote status                     | No fetch, live PR query or remote write. Published `aed6637` is inherited context, not reviewed code identity                              |
| Existing log preserved            | First 128,823 bytes, 899 physical lines; SHA-256 `8211e975730800dbee1ae3845566b1b0a76f5f62d30b174e73225e620330d25d`                        |
| Prior final technical baseline    | W038 reviewed uncommitted implementation later committed as `d5aecf0ba1e276642ddfc683fc756320598642f6`; original attribution remains above |

The parent established provenance using `git status --short`, `git branch --show-current`, `git rev-parse HEAD 'HEAD^{tree}'`, `git for-each-ref`, `git merge-base`, and full base-to-HEAD name/stat/diff checks. An initial unquoted PowerShell tree expression was rejected by Git; the quoted command above corrected it and supplied the actual tree. Source reviewers had view-only tools and explicitly attributed commit identities to the parent; the test worker independently verified the same identities and full diff. No worker's static report is mislabeled as command execution.

### Reference artifacts and checklist

Read `CLAUDE.md`, feature `spec.md`, `plan.md`, `tasks.md`, and `docs/adr/0026-devsquad-ado-workflow-watcher.md`, with approved discovery requirements before retained supplied baseline. Read recovery context at `C:\Users\davidsant\.copilot\session-state\9273d263-84d5-453b-9dce-8ad5480316fd\files\agent-team-recovery.md`; its old workspace/task status was treated as historical, not permission to use another checkout. ADR guardian inspected ADR-0021/0022/0024/0025/0026, README, changesets and dependency boundary. Local tasks, not a board, supplied acceptance criteria.

Checklist presented before validation: FR-001–069 including suffix requirements; CC-001–037; TEST-001–039; public compatibility; exact matching; original-request acknowledgement guards; retained checkpoint-history recovery; anchored reentry; bounded traversal; cancellation/counts/cleanup; SEC-A01–A07; fresh scoped verification and narrowly classified platform failures. Sub-agent execution was preapproved; no interactive confirmation was required.

IDE `changes`, usages and problems/LSP tools were unavailable. Git diff and text navigation were used instead; no IDE diagnostic or exhaustive LSP-reference claim is made. No separate coding-guidelines artifact was supplied; project guidance was `CLAUDE.md` (`AGENTS.md` points to it). The test worker could not locate the requested test-discipline skill and disclosed that limitation. No harness learning was recorded, including in response to the code worker's learning prompt.

### Complete changed-file inventory

```text
.changeset/devsquad-ado-workflow-watcher.md
.changeset/watcher-contract-recovery.md
README.md
docs/adr/0026-devsquad-ado-workflow-watcher.md
docs/features/devsquad-ado-workflow-watcher/final-review-evidence.json
docs/features/devsquad-ado-workflow-watcher/plan.md
docs/features/devsquad-ado-workflow-watcher/review-log.md
docs/features/devsquad-ado-workflow-watcher/spec.md
docs/features/devsquad-ado-workflow-watcher/tasks.md
src/DevSquadAdoWorkflowWatcher.bounds.test.ts
src/DevSquadAdoWorkflowWatcher.concurrency.test.ts
src/DevSquadAdoWorkflowWatcher.dependencies.test.ts
src/DevSquadAdoWorkflowWatcher.discovery.admission.test.ts
src/DevSquadAdoWorkflowWatcher.discovery.bounds.test.ts
src/DevSquadAdoWorkflowWatcher.discovery.lifecycle.test.ts
src/DevSquadAdoWorkflowWatcher.discovery.matching.test.ts
src/DevSquadAdoWorkflowWatcher.discovery.test.ts
src/DevSquadAdoWorkflowWatcher.recovery.test.ts
src/DevSquadAdoWorkflowWatcher.remediation.test.ts
src/DevSquadAdoWorkflowWatcher.test.ts
src/DevSquadAdoWorkflowWatcher.ts
src/DevSquadAdoWorkflowWatcherAdmission.ts
src/DevSquadAdoWorkflowWatcherDiscovery.ts
src/DevSquadAdoWorkflowWatcherDiscoveryMatching.ts
src/DevSquadAdoWorkflowWatcherDiscoveryTestSupport.ts
src/DevSquadAdoWorkflowWatcherDiscoveryValidation.ts
src/DevSquadAdoWorkflowWatcherLedger.ts
src/DevSquadAdoWorkflowWatcherObservation.ts
src/DevSquadAdoWorkflowWatcherPass.ts
src/DevSquadAdoWorkflowWatcherTestSupport.ts
src/DevSquadAdoWorkflowWatcherValidation.ts
src/index.ts
```

Parent also executed `git diff --exit-code <base> HEAD -- 'src/DevSquadAdoWorkflowLedger*' package.json package-lock.json scripts tsup.config.ts vitest.config.ts`: exit 0, unchanged. The prior-review comparison against `d5aecf0` showed discovery additions and the shared-module edits; the old remediation test file was unchanged. No dismissed historical issue is re-raised solely because this review uses a fresh context.

### Independent worker coverage

All five guardians were invoked in parallel through `functions.task`. They returned final reports synchronously; no background agent IDs were supplied.

| Guardian / invocation name                                | Coverage and result                                                                                                                 | Provenance/limits                                                                                                                                                                   |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `devsquad.review.spec` / `w046-spec`                      | All nine production modules, every watcher test family, both supports, public exports/docs, FR/CC mapping; **FAIL**, SC46-001 Major | Static review; targeted ranges for large tests/docs, not exhaustive line-by-line proof; no command tool                                                                             |
| `devsquad.review.adr` / `w046-adr`                        | ADR boundaries, public contracts, README/changesets, dependency graph; W046-ADR-01 Major                                            | Static; independently found same intake snapshot defect; no Git/test execution                                                                                                      |
| `devsquad.review.code` / `w046-code`                      | All nine production modules, exports/supports, selected tests and historical closure; Major intake snapshot defect                  | Static; code worker ended with a learning prompt, which was not actioned; no writes                                                                                                 |
| `devsquad.review.security` / `w046-security`              | Detected auth, sensitive data, external input, persistence and integration triggers                                                 | Could not invoke specialist from its limited tool surface; correctly did not substitute a manual security verdict                                                                   |
| `devsquad.review.tests` / `w046-tests`                    | Scoped tests, typecheck, formatting, declaration check, baseline-failure investigation                                              | Fresh commands below; scoped PASS, not global/build certification; three Major baseline findings and retained Minor TB001                                                           |
| Required security specialist / `w046-security-specialist` | Parent invoked `security-review` directly to resolve guardian delegation gap                                                        | Returned exactly: “No security vulnerabilities found in the reviewed changes.” No detailed control matrix, scan transcript or specialist test count was returned; do not infer them |

SC46-001, W046-ADR-01 and the code guardian's finding are one defect, deduplicated as **W046-001** with original **Major** severity retained. No guardian finding was downgraded. Test-worker baseline Majors retain their severity and are distinguished by provenance rather than relabeled as watcher regressions.

### Major integration finding

#### W046-001 — Admission bypasses captured intake sets and can reject after acknowledgement (Major; blocking)

- **Expected:** FR-003 preflight validation; FR-041/043 exact phase/status membership; FR-068 matching intake rules for fresh admission; FR-001 / INV-016 structured operation results. The common validator projects independent intake arrays for use throughout the invocation.
- **Found:** `src/DevSquadAdoWorkflowWatcherAdmission.ts:118–120` calls `.includes()` on caller-owned arrays. Both initial and retained retry call sites pass `options.intakeRules`: `src/DevSquadAdoWorkflowWatcherDiscovery.ts:127–132,169–174` (arguments at lines 130 and 172). The prepared options retain original arrays at `src/DevSquadAdoWorkflowWatcherValidation.ts:503–509`, despite validated copies being built at lines 163–194 and 458–463. The comment path uses captured `context.validated.intakePhases/intakeStatuses` at `src/DevSquadAdoWorkflowWatcherPass.ts:506–509` instead.
- **Impact:** Array mutation during an awaited page/initialization callback changes the discovery decision after validation. A caller-defined `includes` changes exact-match semantics. A throwing method escapes after a valid initialization acknowledgement, losing the structured pass result and any accumulated outcome reporting. This does **not** bypass explicit item authorization for initialization or grant downstream execution authority; arbitrary adapters remain trusted in-process code.
- **Reproduction:** Parent command `@' ... '@ | node --import tsx --input-type=module -` imported `runDevSquadAdoWorkflowWatchPass` and `DEFAULT_DEVSQUAD_ADO_DISCOVERY_LIMITS` from `./src/index.ts`, used a complete in-memory fake ledger with method-valid revision-one initialization acknowledgements and an authorized item 999 at `ready/open`, and performed six independent public-entry cases. No private guard was invoked and no probe/source file or real ledger was written.
- **Correction direction:** At **both** admission call sites, consume independently validated phase/status arrays, not caller-owned rules/methods. Add public-pass regressions for original-array method overrides, mutation after preflight, retained retry mutation, and a throwing original method. Preserve matching/nonmatching controls and unchanged supplied behavior. Parent owns implementation and subsequent independent re-review.

Fresh probe results (command exit 0 means the assertions confirmed these observations, **not** that product conformance passed):

| Case                                                                                                   | Expected contract                            | Observed                                                                     |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------- | ---------------------------------------------------------------------------- |
| Ordinary `["blocked"]` / `["open"]`                                                                    | Initialize without intake                    | `initialized=1`, `admitted=1`, `acted=0`, `admission-intake-rules-unmatched` |
| Ordinary `["ready"]` / `["open"]`                                                                      | Fresh admission intake                       | `initialized=1`, `admitted=1`, `acted=1`, `admission-accepted`               |
| `Object.defineProperty(phases, "includes", { value: () => true })` on `["blocked"]`                    | Remain nonmatching                           | **`acted=1`, `admission-accepted`**                                          |
| Page callback changes `phases[0]` from `blocked` to `ready`                                            | Use captured nonmatching set                 | **`acted=1`, `admission-accepted`**                                          |
| First initialization returns valid contention and changes `phases[0]`; second returns fresh acceptance | Retained retry uses captured nonmatching set | **Two initialize calls, one read, `acted=1`**                                |
| Original `includes` throws `Error("caller-includes-fault")`                                            | Original custom method must not execute      | **Pass rejects with that error after one accepted fake initialization**      |

All six probes had `unexpected=0` for observation/acquire/renew/checkpoint/release calls. The fake ledger verifies acknowledgement consumption, not physical persistence; the durable consequences follow the production call order and fresh real-ledger tests separately. Test families already cover ordinary intake mismatch and authorization/request mutation, but did not catch this caller-owned rule-consumption boundary.

### Spec and conformance checklist

Static conformance below is supported by freshly executed existing suites where mapped; it is not proof of every input combination. Spec IDs are `FR`, not `RF`.

| Requirement group                          | Assessment                                                  | Evidence                                                                                                                                                                              |
| ------------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-001/003/041/043/068; INV-003/016        | **FAIL / qualified**                                        | W046-001. Validated admission authorization remains intact, but intake-rule consumption and structured completion are defective                                                       |
| FR-002/004/008–011/020/061                 | Supported                                                   | `Watcher.ts:527–559`; `WatcherValidation.ts:197–461`; `WatcherDiscoveryValidation.ts:318–414`; `index.ts:265–350`; explicit mode and supplied-missing-record controls                 |
| FR-012–019/021–024/064–066                 | Supported except admission rule exception                   | Matching implementation `WatcherDiscoveryMatching.ts:8–66`; bounded policy/facts `WatcherDiscoveryValidation.ts:195–260,446–612`; observation `WatcherObservation.ts:178–307,331–445` |
| FR-025–039 including suffixes / FR-059–060 | Supported in inspected ledger and shared candidate paths    | `WatcherLedger.ts:411–679`; `WatcherPass.ts:215–301,565–724,834–935`; original-request history-before-refresh preserved                                                               |
| FR-005–007/040/042/044–058/062–063/067/069 | Supported normal paths; W046-001 can escape result assembly | `WatcherAdmission.ts:21–60,68–112,121–146`; `WatcherDiscovery.ts:124–385`; `WatcherPass.ts:500–539,980–1170`                                                                          |

In the following table, filenames abbreviate the prefix `src/DevSquadAdoWorkflowWatcher`: T=`.test.ts`, C=`.concurrency.test.ts`, B=`.bounds.test.ts`, R=`.recovery.test.ts`, M=`.remediation.test.ts`, Deps=`.dependencies.test.ts`, D=`.discovery.test.ts`, DA=`.discovery.admission.test.ts`, DM=`.discovery.matching.test.ts`, DB=`.discovery.bounds.test.ts`, DL=`.discovery.lifecycle.test.ts`. Mappings come from the spec guardian; all named suites were included in the fresh combined run.

| CC      | Scenario / mapped test evidence                                                                                       | Status                                                                 |
| ------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 001–003 | Durable happy path T:422–532; repeat T:588–641; observation-only T:535–585 and Deps:211–300                           | Mapped/executed                                                        |
| 004–006 | Overlap C:77–179; stale fence C:343–430; conflicts C:433–519                                                          | Mapped/executed                                                        |
| 007–009 | Suppression T:643–688; unknown admitted phase T:690–721; supplied missing T:723–752 / DA:130–161                      | Mapped/executed                                                        |
| 010–013 | Ordering T:944 and DB:475–558; budgets B:105–197; abort DL:439–510 and M matrix; timeout B:290 onward                 | Mapped/executed                                                        |
| 014–017 | Renewal C:1135–1237; validation T:119–274 / M:2727 onward; seam T:276 / D:118–145; isolation R:59–121,170–248,493–530 | Mapped/executed                                                        |
| 018–020 | Privacy T:1020–1092 / DL:1045 onward; PR completeness T:755–890 / M:1990–2020; offline Deps:211–300                   | Mapped/executed                                                        |
| 021–024 | Reacquire C:985–1061; stale observation C:181–341; anchor R:251 / DL:226–247; typed faults M:1630–1788 / DA:281–479   | Mapped/executed                                                        |
| 025–027 | Signal preflight M:2754–2801; windows M:1789–2020; retirement M:2025–2182 / D:174–263 / DL:927–1041                   | Mapped/executed                                                        |
| 028–030 | Cleanup M:2522–2690 / DL:439–657; original-request history M:200–488 / DA:393–589; metadata M:2691 onward             | Mapped/executed                                                        |
| 031     | Authorized no-comment admission DA:56–278                                                                             | Existing cases pass; **W046-001 uncovered gate regression**            |
| 032–033 | Matching DM:18–212; pause/reentry/retention DL:97–305                                                                 | Mapped/executed                                                        |
| 034–036 | Traversal/restart DB:475–661,773–842; page faults DB:727–771,845–1090; bytes/counts DB:24–410,1126 onward             | Mapped/executed                                                        |
| 037     | Admission guards DA:607 onward, lifecycle/privacy DL:439 onward, D lifecycle                                          | Existing cases pass; **W046-001 structured-result escape not covered** |

TEST-001–039 all have identifiable cases. Additional focused traceability: TEST-007 clock/lease assertions B:199–286; TEST-023 reopen R:534–615; TEST-025 public inference/examples D:450 onward. No whole CC is unmapped, but mapped tests did not imply exhaustive compliance: the independent probes found W046-001.

### ADR, codebase and security obligations

| Constraint                            | Evidence and outcome                                                                                                                                                                                                                |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-0021/0022/0024 host boundaries    | Static PASS: no network client/query construction, external write or execution dispatch in inspected watcher graph; `WatcherDiscovery.ts:1–32,72–86`; `WatcherObservation.ts:316–395`; `WatcherPass.ts:497–538`; Deps:35–58,211–289 |
| ADR-0025 storage contract             | Parent base comparison proves ledger sources/schema, scripts and dependency manifests unchanged; watcher calls typed ledger operations only                                                                                         |
| ADR-0026 technical discovery contract | Supplied unions remain separate, never initialize; fresh-only typed admission and invocation-local traversal implemented. W046-001 prevents full technical conformance                                                              |
| Naming/structure/error handling       | Nine plain async modules reuse shared guards and candidate processing; one concrete caller-owned-rule consumption inconsistency, no separate speculative smell list                                                                 |
| Public docs/release                   | README:485–697 documents modes, matching, host auth, explicit loss, cancellation and incomplete traversal; minor watcher changeset plus retained historical patch are nonduplicate. Public examples and dependency guards executed  |
| SEC-A01                               | Explicit canonical-item auth/exact state in `WatcherAdmission.ts:21–60` and `WatcherDiscovery.ts:161–176`; no item-authorization bypass established                                                                                 |
| SEC-A02                               | Initializer guard `WatcherLedger.ts:444–477,633–679`; independent original submission, fresh/replay distinction. W046-001 is an intake gate/structured-result defect                                                                |
| SEC-A03                               | Whole-page bounded projection `WatcherDiscoveryValidation.ts:446–612`; malformed last-entry and mutation/bounds tests executed                                                                                                      |
| SEC-A04                               | Exact matching `WatcherDiscoveryMatching.ts:8–66`, retention `WatcherObservation.ts:184–209,350–445`; missing facts fail closed                                                                                                     |
| SEC-A05                               | Minimized predicate evidence `WatcherDiscoveryMatching.ts:57–66`; privacy sentinels DL:1045 onward executed; no raw policy/facts/continuations required in outputs                                                                  |
| SEC-A06                               | Stable invocation-local traversal `WatcherDiscovery.ts:83–94,186–334`; bounds/restart suites executed, no durable continuation/tail guarantee                                                                                       |
| SEC-A07                               | Admission awaited guard `WatcherAdmission.ts:68–112`, page retirement and shared cleanup; lifecycle/history tests executed; W046-001 qualifies truthful structured completion after acknowledgement                                 |

SEC rows combine non-security guardians' technical evidence and executed tests; they are **not represented as a detailed specialist report**. Security triggers were assessed and the required specialist returned no vulnerabilities. Its compact result contains no scan output, vulnerability count taxonomy or exhaustive threat-model proof. No network audit was run. The inherited 49 dependency audit notices remain unassessed. Trusted in-process dependencies are not sandboxed, at-most-once signal loss is an accepted product constraint, and neither is treated as a newly discovered vulnerability.

### Fresh verification commands and exact results

Executed by `w046-tests` at the reviewed HEAD; parent independently executed provenance/diff checks and six public probes. No result below is borrowed from W045 except where explicitly marked inherited.

| Command                                                                                                                                                        | Result / scope                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `npm test -- DevSquadAdoWorkflowWatcher DevSquadAdoWorkflowLedger`                                                                                             | Exit 0; **676 passed / 2 platform skips**, 16 files                                                                               |
| `npm test -- DevSquadAdoWorkflowWatcher.discovery DevSquadAdoWorkflowWatcher.dependencies`                                                                     | Exit 0; **283 passed**, 6 files, no skips                                                                                         |
| `npm test -- DevSquadAdoWorkflowWatcher.remediation -t "third independent history"`                                                                            | Exit 0; **19 passed / 244 selector exclusions**, one file                                                                         |
| `npm run typecheck`                                                                                                                                            | Exit 0, `tsgo --noEmit`                                                                                                           |
| `$files = @(git diff --name-only <base> HEAD -- src README.md); npx --no-install prettier --check @files`                                                      | Exit 0; 24 changed source/test/support/index/README paths                                                                         |
| `npx --no-install prettier --ignore-path .gitignore --check .changeset/devsquad-ado-workflow-watcher.md .changeset/watcher-contract-recovery.md`               | Exit 0; both changesets                                                                                                           |
| `git diff --check <base> HEAD`                                                                                                                                 | Exit 0, worker and parent                                                                                                         |
| `node scripts/check-public-types-effect-free.mjs`                                                                                                              | Exit 0; fresh guard execution on **inherited W045-generated declarations**                                                        |
| Diskless public API probes via `node --import tsx --input-type=module -`                                                                                       | Exit 0; six cases confirmed controls plus W046-001, not a product PASS                                                            |
| `npm test -- AgentProvider.test -t sessionStorage`                                                                                                             | Exit 1; **4 passed / 5 failed / 207 selector exclusions**                                                                         |
| `npm test -- CopyToWorktree.test -t "succeeds when first cp fails but fallback cp -R succeeds"`                                                                | Exit 1; **1 failed / 7 selector exclusions**                                                                                      |
| `npm test -- createWorktree.test createSandbox.test -t "creates a worktree with 'branch' strategy\|creates a sandbox with branch and worktreePath properties"` | Exit 1; **2 failed / 79 selector exclusions**, two files; regex used ordinary `                                                   | `, escaped here for Markdown |
| `npm test -- cli.test -t "^sandcastle CLI shows help with --help flag$"`                                                                                       | Exit 0; **1 passed / 24 selector exclusions**, uses inherited `dist/main.js`                                                      |
| `npm run build`                                                                                                                                                | **Not run in W046**: review write restrictions prohibit cleaning/regenerating `dist`; no fresh W046 generation or packaging claim |

Discovery breakdown observed in fresh selectors: public/examples **20**, matching **45**, admission **74**, bounds **81**, lifecycle **46** = **266**; dependency guardians **17**, combined **283**. These are overlapping selectors, not additive totals across all rows. Two platform skips are the Linux-only production ledger initialize/acquire/checkpoint/reopen/list/release test and non-Windows 1,000-record production listing test. Selector exclusions are not platform skips.

### Major baseline/environment findings and interrupted-suite investigation

These findings retain the test guardian's severity. They explain **eight specifically reproduced failures**, not every failure from W042's interrupted full-suite run. No checkout/branch switch or full-suite run at the merge-base occurred; baseline attribution is supported by identical source/test/dependency blobs and direct platform failure evidence.

- **TB046-001 (Major; baseline/environment):** `npm test -- AgentProvider.test -t sessionStorage` reproduced five failures. Pi capture `session ... not found` at `src/SessionStore.ts:384` through `src/AgentProvider.ts:513` (test `src/AgentProvider.test.ts:2192`); path-separator mismatch at test line 2285; Codex missing session at `SessionStore.ts:271` through `AgentProvider.ts:466` (test line 2336); Claude subagent/partial-copy `ENOENT` at test lines 2461 and 2568. `AgentProvider.test.ts`, `AgentProvider.ts`, `SessionStore.ts`, `SandboxProvider.ts` have identical base/HEAD blobs. Unchanged enumeration uses POSIX `find ... -type f -name ...`; available executable is Windows `find.exe`; the path assertion also assumes `/` rather than `\`.
- **TB046-002 (Major; environment):** Copy fallback test fails with `CopyToWorktreeError: Failed to copy file.txt to worktree: spawn cp ENOENT`, `src/CopyToWorktree.ts:49:21`. Source/test/error definitions are base-identical, and `git show` confirms the same `execFile("cp", ...)` fallback. No external `cp` executable is available.
- **TB046-003 (Major; baseline test portability):** `src/createWorktree.test.ts:64` and `src/createSandbox.test.ts:265` expect substring `.sandcastle/worktrees`; actual Windows suffix is `\.sandcastle\worktrees\test-branch`. Both reached those assertions. Tests, implementations, `WorktreeManager.ts`, and local sandbox helper are base-identical.
- **TB001 / worker alias TB046-004 (Minor; historical, nonblocking):** Direct internal guard/object-identity tests at `src/DevSquadAdoWorkflowWatcher.remediation.test.ts:953,1021,1288,2423` remain unchanged from the prior technical review. Preserved, not re-raised as a new defect or remediation demand.

Current `dist/main.js` exists and the narrow help command passed. This removes that one current missing-artifact prerequisite; it does not establish that earlier CLI failures were fixed or that packaging is complete. Unidentified W042 session/sandbox/worktree/full-suite failures remain **unclassified**. No global PASS is claimed.

### Build, governance and remaining limitations

- W045's artifact records **fresh ESM/DTS generation** followed by canonical `npm run build` **exit 1** because external `rm` was unavailable; the chained copy/guard did not run in that command. W045 subsequently ran its standalone declaration guard successfully. This is **inherited generation/build-failure evidence**, not fresh W046 build output. The test worker and parent still found no external `rm`/`cp`. No packaging certification or tooling fix occurred.
- Scoped tests are green but an independently reproduced functional blocker remains. Full repository tests, global formatting, dependency audit, production Windows ledger permissions and deployment are not certified.
- ADR-0025 and ADR-0026 remain **Proposed**. Their status is neither a technical blocker nor accepted by this review. W038 remains historical technical PASS only. No governance, publication, merge-ready or later-slice approval follows from any static PASS row.
- No PR review was posted: current published head is stale relative to reviewed local code, and the parent owns publication. No push, new PR, base change, amend, rebase, merge, board update or live ADO operation occurred. Preserve #20-before-#21 ordering; slices 15–19 remain outside this review.

### W042–W046 requirement closure and handoff

| Task | Independent disposition                                                                                                                                                                                                                              |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W042 | **Supported within scoped review:** public lifecycle assertions and static trace confirm cursor 480 retained during exclusion, reentry from 480, explicit WI/PR retention loss, supplied empty-window compatibility and cursor-advancing suppression |
| W043 | **Supported within scoped review:** 81 bounds tests plus shared suites cover retained scheduling, one page per poll, terminal versus budgets, duplicates/cycles/drift, inclusive bytes/counts and fresh reopen; no durable cursor/schema change      |
| W044 | **Qualified / remediation required:** existing cancellation, retry, acknowledgement, privacy and count/cleanup assertions pass, but W046-001 can alter admission on retries or escape structured completion after acceptance                         |
| W045 | **Public-contract scope supported:** exports/inference, executable README examples, changesets and dependency guardians pass. Fresh W046 build not run; inherited Windows postbuild failure remains, packaging not certified                         |
| W046 | **FAIL; leave unchecked:** resolve W046-001, add regression coverage, independently re-review the resulting exact HEAD/tree and record closure through the parent                                                                                    |

W039/W040 implementation is included in this full delta and statically supported; W041 admission has the W046-001 intake-rule defect. None of these assessments edits authoritative task checkboxes or reopens W001–W038.

**Handoff envelope:** Destination is parent-owned `devsquad.implement` remediation, followed by a fresh independent review. Required fix ID **W046-001 (Major)**; primary location `src/DevSquadAdoWorkflowWatcherAdmission.ts:118–120`, both call sites `src/DevSquadAdoWorkflowWatcherDiscovery.ts:130,172`. Evidence is this appended W046 session and the six executed public-entry probes. Assumptions to preserve: host item authorization/exact state, at-most-once possibly lost admission delivery, unchanged supplied types and no initialization, original-submission checkpoint history validation, no durable traversal state, no live adapter. Baseline TB046-001–003 are verification limitations, not permission for unrelated source/tooling changes. No new product/scope/auth decision was made.

**Decision rationale:** Independent workers converged on one concrete captured-input defect; public-API execution confirmed it on initial and retry paths. Existing test success therefore cannot close W046. Baseline failures were separated by exact unchanged-file evidence, while the unidentified remainder was left open. Historical evidence and severity were preserved. The parent must remediate and obtain independent re-review before recording W046 closure or publication.

---

## W046-001 implementation remediation — 2026-09-10, turn 2

**Status: remediation implemented and scoped verification green; independent re-review REQUIRED. W046 remains unchecked.** This entry does not supersede the preceding independent FAIL or independently close its Major finding. No finalization/publication worker or acceptance review ran in this remediation turn; the conductor owns the next independent review.

### Provenance and scope

- Workspace: `C:\repos\copilot-worktrees\sandcastle\users-davidsant-bookish-doodle`; branch: `users/davidsant/bookish-doodle`.
- Starting HEAD: `3c2254884b800a3401594067a13ddd578aedcf20`; starting committed tree: `d8d49275dfd6c873b07e3836710d162e60905d67`. The final commit HEAD/tree are returned in the conductor handoff, not guessed inside this pre-commit entry.
- The only pre-existing dirty file was this review log. Its complete pre-remediation content was 157,902 bytes, SHA-256 `b08f9312c18c72660e60dd1d4fe2851988e80ab8832b3c6750a0f753c2d3fa21`. Historical findings and FAIL are retained; required Markdown formatting normalizes the independent append's tables/spacing without changing findings.
- Read repository guidance and approved discovery spec/plan/tasks/ADR-0026. The validation worker classified the correction as Medium impact with no spec drift. Existing routine continuation approval covers it. Work-source detection confirmed local tasks only, no linked board item; #20/#21 are PR provenance, not board assignments.
- Production changes are restricted to `DevSquadAdoWorkflowWatcherAdmission.ts` and `DevSquadAdoWorkflowWatcherDiscovery.ts`: admission accepts explicit validated phase/status snapshots, supplied from `validated.intakePhases` and `validated.intakeStatuses` at BOTH initial and retained-retry call sites.
- Added 20 public `runDevSquadAdoWorkflowWatchPass` real-ledger integration cases to `DevSquadAdoWorkflowWatcher.discovery.admission.test.ts`: four ordinary controls and sixteen defect cases across phases/statuses, overridden/throwing original `includes`, page-time mutation and retained-initialization-retry mutation, with both incorrect enabling and suppression covered.
- Tests assert structured completion, exact outcomes/signals/counts, fresh durable initialization, unchanged request across retries, no caller-method invocation, zero observation/acquire/renew/checkpoint/release effects and no fabricated cursors. Item-specific initialization authorization, original-request acknowledgement guards, fresh/replay gating, supplied behavior and storage are unchanged.
- Traceability: FR-001/003/041–043/068; primary CC-031/TEST-033 and CC-037/TEST-039; retained authorization, counts and acknowledgement controls FR-006/044/046/059/067/069.

### Executed RED/GREEN and verification evidence

Evidence below was executed by the named implementation workers during this remediation turn and returned to the coordinator. It is not an independent acceptance verdict. Test/build commands ran in this workspace.

| Worker / stage                     | Exact command                                                                                                                                                                        | Result                                                                                                                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Execute / baseline                 | `npm test -- src/DevSquadAdoWorkflowWatcher.discovery.admission.test.ts`                                                                                                             | 74 passed; exit 0                                                                                                                                                                                                   |
| Execute / RED                      | Same admission command, after tests but BEFORE production changes                                                                                                                    | 16 failed / 78 passed; exit 1. Four controls passed; twelve defect cases failed incorrect acted/noChange counts, four throwing-method cases rejected with caller-includes-fault at original Admission lines 119–120 |
| Execute / RED source control       | `git --no-pager diff --exit-code -- src/DevSquadAdoWorkflowWatcherAdmission.ts src/DevSquadAdoWorkflowWatcherDiscovery.ts`                                                           | Exit 0; production unchanged for RED                                                                                                                                                                                |
| Execute / GREEN                    | `npm test -- src/DevSquadAdoWorkflowWatcher.discovery.admission.test.ts`                                                                                                             | 94 passed; exit 0                                                                                                                                                                                                   |
| Verify / fresh admission           | `npm test -- src/DevSquadAdoWorkflowWatcher.discovery.admission.test.ts`                                                                                                             | 94 passed; 0 failed/skipped; exit 0                                                                                                                                                                                 |
| Verify / fresh watcher and ledger  | `npm test -- src/DevSquadAdoWorkflowWatcher src/DevSquadAdoWorkflowLedger`                                                                                                           | 696 passed / 2 platform skips; 16 files passed; exit 0                                                                                                                                                              |
| Verify / fresh checkpoint history  | `npm test -- DevSquadAdoWorkflowWatcher.remediation -t "third independent history"`                                                                                                  | 19 passed; 244 selector exclusions, not broad-suite skips; exit 0                                                                                                                                                   |
| Verify / fresh typecheck           | `npm run typecheck`                                                                                                                                                                  | Exit 0                                                                                                                                                                                                              |
| Verify / fresh canonical build     | `npm run build`                                                                                                                                                                      | Fresh ESM success (7,946 ms), fresh DTS success (13,916 ms); canonical command exit 1 at known Windows postbuild: 'rm' is not recognized                                                                            |
| Verify / guard after fresh ESM+DTS | `node scripts/check-public-types-effect-free.mjs`                                                                                                                                    | Exit 0; public declarations contain no Effect references                                                                                                                                                            |
| Verify / touched source formatting | `npx --no-install prettier --check src/DevSquadAdoWorkflowWatcherDiscovery.ts src/DevSquadAdoWorkflowWatcherAdmission.ts src/DevSquadAdoWorkflowWatcher.discovery.admission.test.ts` | Exit 0                                                                                                                                                                                                              |
| Verify / whitespace                | `git diff --check`                                                                                                                                                                   | Exit 0                                                                                                                                                                                                              |

The two broad-suite skips are Linux production-platform operations and the supported-production-filesystem listing benchmark. No numerical coverage-percentage claim is made. Build emitted unused createRequire/Readable import warnings. **Packaging did not pass**: chained template copying/postbuild guard did not run after rm failed; the explicitly invoked guard ran separately against freshly generated declarations.

The execute worker additionally reported a concurrent watcher/ledger attempt with 692 passed / 4 lifecycle timeouts / 2 skips while an unnecessary full `npm test` was running. Its isolated rerun passed 696 / 2 without source or timeout changes; the verify worker independently repeated that isolated success. The full-suite attempt was stopped incomplete after platform-dependent failures. It supplies no complete global count and is not a global baseline or certification. The known eight baseline storage/cp/Windows-path failures were not repaired. This deviation is retained rather than omitted.

### Decisions, limitations and handoff

| Decision                                                                     | Principle / alternative                                                                                                 | Basis and confidence                                                                       |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Reuse preflight snapshots throughout initial admission and retries           | Validate once, consume the validated snapshot; do not revalidate mutable caller rules or catch custom-method exceptions | Existing exact intake contract and reproduced RED failures; High; continuation preapproved |
| Use public integrated real-ledger regression tests                           | Assert observable behavior and authority boundaries rather than internal array identity                                 | Independent W046-001 evidence and TEST-033/039; High; continuation preapproved             |
| Preserve review FAIL and distinguish scoped checks from acceptance/packaging | Separate remediation evidence from independent approval                                                                 | W046 acceptance and known environment limitations; High; parent review pending             |

IDE/LSP problems tools were unavailable; text navigation, typecheck and executable tests were used. No standalone lint script exists. No dependency installs, dependency changes, build-script fixes, duplicate changeset, spec/plan/ADR edits, harness learning, live tracker calls, board actions, remote operations, push, PR, merge, force, amend or rebase occurred. Existing W045 minor changeset covers this extension; public docs/API contract are unchanged. ADR-0025/0026 remain Proposed; #20 must precede #21; slices 15–19 remain unauthorized.

**Handoff:** Commit this bounded remediation and preserved review evidence using the git-commit skill and required Copilot App trailer, return exact final HEAD/tree, and request conductor-owned fresh independent re-review. W046 must remain unchecked until that review has no unresolved blockers. No W046 PASS, governance acceptance, publication or merge-readiness claim follows from this entry.

---

## W046 independent re-review — 2026-09-10, turn 3

### Result: PASSED — full slice 14 technical integration disposition

**W046-001 CLOSED (original severity Major). W046 technical gate PASSED.** This disposition encompasses the entire integration-base delta: supplied-candidate watcher, checkpoint recovery and discovery W039–W045, including W042–W046 acceptance. It is not a repair-only verdict. No unresolved Critical or Major **slice implementation** finding remains. The earlier W046 FAIL and turn-2 remediation evidence remain intact as historical evidence; this independent re-review supersedes their pending acceptance status, not their contents.

- New Critical: **0**; new Major: **0**; new Minor: **0**; needs-clarification: **0**.
- Previously blocking slice finding: **W046-001, Major, independently closed**.
- Retained baseline/environment findings: **3 Major IDs / 8 previously reproduced failures**, unchanged and not downgraded. They remain outside slice remediation and prevent a global-suite PASS claim.
- Historical **TB001, Minor**, remains acknowledged and nonblocking, not re-raised as a new finding.
- Aggregate maximum severity among retained unresolved baseline findings remains **Major**. The bounded slice PASS does not erase those findings or certify the repository globally.

**Remaining local slice work is evidence-only closure:** the parent may separately record the W046 checkbox and commit review/task evidence after checking code-tree identity. This reviewer did not edit tasks, source, tests, specs, ADRs, or any other artifact. Publication and governance remain separate, not implicitly authorized.

### Exact provenance and history preservation

| Property                        | Verified value                                                                                                    |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Workspace                       | `C:\repos\copilot-worktrees\sandcastle\users-davidsant-bookish-doodle` only                                       |
| Branch                          | `users/davidsant/bookish-doodle`                                                                                  |
| Reviewed code HEAD              | `9854e9ea5f739ee5ba8a605a97a7fd3569a9cce3`                                                                        |
| Reviewed committed tree         | `7519db940767937691d2ffc41d2bf3a2921711e7`                                                                        |
| Reviewed `src` subtree          | `6e7c6d3ffb2bdc082b371be38efd773fbfa14a38`                                                                        |
| Verified integration merge-base | `9ff6e8e9f74792e131e927bd9bf41358e36cea95`                                                                        |
| Full integration diff           | 32 files; 24,273 additions; no deletions                                                                          |
| Previous independent HEAD       | `3c2254884b800a3401594067a13ddd578aedcf20`                                                                        |
| Repair comparison               | Two production modules, admission regression file, review log and tasks only                                      |
| Initial / pre-append status     | Clean; parent and test guardian verified unchanged HEAD/tree                                                      |
| Preserved history               | First **180,862 bytes / 1,170 lines**, SHA-256 `0081cd63dd9209c970471ee2bbc0e04826c67cdccd7cdc170446d3ff6b616597` |
| Evidence write                  | This section appended only; historical prefix checked before append and verified afterward                        |

Parent freshly executed status, branch, quoted tree identity, merge-base, base-to-HEAD inventory/stat, repair diff, unchanged-ledger/tooling comparison and whitespace checks. An initial unquoted PowerShell tree expression failed; a separately quoted `HEAD^{tree}` invocation supplied the correct tree. Missing conventional `docs/architecture/decisions` was resolved to the actual `docs/adr` directory; two incorrect root-level artifact lookups were corrected to feature paths and supplied no evidence. The test guardian independently verified exact HEAD/tree/base and cleanliness. Static guardians explicitly relied on parent identity rather than claiming Git execution.

The full 32-path inventory retained in the preceding independent report remains the review scope. Production code inspected in full by static guardians:

- `src/DevSquadAdoWorkflowWatcher.ts`
- `src/DevSquadAdoWorkflowWatcherValidation.ts`
- `src/DevSquadAdoWorkflowWatcherDiscoveryValidation.ts`
- `src/DevSquadAdoWorkflowWatcherDiscoveryMatching.ts`
- `src/DevSquadAdoWorkflowWatcherDiscovery.ts`
- `src/DevSquadAdoWorkflowWatcherAdmission.ts`
- `src/DevSquadAdoWorkflowWatcherLedger.ts`
- `src/DevSquadAdoWorkflowWatcherObservation.ts`
- `src/DevSquadAdoWorkflowWatcherPass.ts`
- Watcher root exports in `src/index.ts`; both watcher test-support modules; all eleven watcher test families and dependency tests; README and both watcher changesets.

Large tests were reviewed in substantial targeted ranges, not exhaustively line by line. Fresh combined execution includes ledger regression tests as well. Parent and test guardian base comparisons confirm `src/DevSquadAdoWorkflowLedger*`, manifests, scripts, `tsup.config.ts` and `vitest.config.ts` unchanged. No missing dependency required installation.

### Reference artifacts, checklist and navigation limits

Read approved discovery requirements FIRST: `spec.md` FR-061–069 and shared requirements/invariants/CCs; `plan.md` approved extension through line 615; `tasks.md` extension/W046 acceptance and handoff through line 680; approved amendment in Proposed `docs/adr/0026-devsquad-ado-workflow-watcher.md`. Read retained supplied-candidate/recovery contract SECOND, including original-submission history validation, fencing/staleness, opaque cursors, cancellation and cleanup. Read the complete prior W046 report around lines 904–1120 and remediation from 1122–1170. ADR guardian additionally read ADR-0021/0022/0024/0025, public docs and changesets. Local task artifacts supplied scope; no live board was queried.

Checklist presented before validation: full FR-001–069 including suffixes, CC-001–037, TEST-001–039; both intake snapshot paths; supplied API compatibility; exact matching and pause/reentry; original-request initialization and checkpoint acceptance; bounded traversal; cancellation, independent counts and truthful cleanup; SEC-A01–A07; evidence provenance and platform limitations. Routine sub-agent continuation was preapproved; no interactive confirmation requested.

IDE `changes`, usages and problems/LSP tools were unavailable. Git diff, text navigation, typecheck and executable tests were used; no exhaustive LSP usage or IDE-diagnostic claim is made. `.memory/lsp-status.md` was absent. `AGENTS.md` points to `CLAUDE.md`; no separate coding-guidelines artifact was supplied. Requested documentation-style/reasoning/test-discipline skill files were not available in the inspected workspace skill directory; this entry contains explicit decision rationale and handoff instead. No harness learning was recorded.

### Guardian provenance and aggregation

All five independent guardians ran in parallel through `functions.task`; reports returned synchronously, with no background IDs. None implemented the repair. No worker wrote evidence; the parent owns this append.

| Guardian / invocation                                                 | Fresh work and result                                                                                                              | Execution limits                                                                                                     |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `devsquad.review.spec` / `w046-r3-spec`                               | Full supplied/recovery/discovery source review and FR/CC/TEST mapping; static PASS; W046-001 closed; no new findings               | View-only; tests mapped, not executed by this worker                                                                 |
| `devsquad.review.adr` / `w046-r3-adr`                                 | ADR-0021/22/24 boundaries, approved 0025/26 feature contract, exports/docs/changesets; static PASS; W046-001 closed                | No Git/tests; official Microsoft authentication documentation checked as host-boundary context, no migration finding |
| `devsquad.review.code` / `w046-r3-code`                               | All nine production modules, supports/exports and every test family; static PASS; W046-001 closed; no new consistency findings     | No tests/Git; large tests sampled by targeted ranges                                                                 |
| `devsquad.review.security` / `w046-r3-security`                       | Fresh trigger assessment: auth, sensitive data, external input, persistence and integration; requested fresh specialist for repair | Limited tools prevented specialist delegation; did not substitute manual security audit                              |
| `devsquad.review.tests` / `w046-r3-tests`                             | Fresh sequential scoped tests, typecheck, formatting, identity/diff and declaration guard; scoped PASS                             | No build regeneration/global suite; inherited baseline Majors retained                                               |
| Required specialist `security-review` / `w046-r3-security-specialist` | Parent invoked directly after trigger guardian; returned **No security vulnerabilities found in the reviewed changes.**            | Compact result only; no detailed control matrix, scan transcript or test count supplied                              |

The inherited specialist result at the previous independent HEAD remains historical full-integration evidence. The current specialist invocation supplied full integration context and explicitly requested fresh repair/snapshot/initializer/auth/retry/privacy scrutiny, expanding if necessary. Only its returned no-vulnerability result is claimed; no exhaustive fresh full-slice scan or undocumented control proof is inferred. This accounts for the trigger-based specialist obligation without representing non-security guardians as security auditors.

No guardian severity was downgraded. W046-001 closures from spec/ADR/code/tests are one finding disposition, not four independent bugs. Retained TB046-001–003 remain Major; TB001 remains Minor.

### W046-001 remediation disposition

**Expected:** FR-001/003/041/043/068 and INV-003/016 require structured completion and exact membership in validated intake sets throughout initial and retained retry admission. Explicit item authorization and initial state are separate from intake gating.

**Verified implementation:** `src/DevSquadAdoWorkflowWatcherValidation.ts:163–194,458–463` creates indexed, independent phase/status arrays without caller-owned methods. `src/DevSquadAdoWorkflowWatcherDiscovery.ts:127–135,170–178` passes those validated arrays at BOTH retained-retry and initial admission call sites. `src/DevSquadAdoWorkflowWatcherAdmission.ts:62–68,118–122` consumes them explicitly. This matches comment intake at `src/DevSquadAdoWorkflowWatcherPass.ts:506–509`.

**Executed regression evidence:** All 94 admission tests passed in the fresh combined gate. The 20 new public real-ledger cases at `src/DevSquadAdoWorkflowWatcher.discovery.admission.test.ts:281–452` cover phases/statuses, matching/nonmatching controls, overridden/throwing caller `includes`, page-time mutation and retained-retry mutation. They assert exact counts/signals/outcomes, structured completion, zero caller-method invocation, stable retry submission, pristine initialization and zero observation/acquire/renew/checkpoint/release effects. No private-array identity or internal guard assertion was added.

**Independent parent probes:** Fresh command `node --import tsx --input-type=module -`, supplied an inline PowerShell here-string through stdin, imported only public run/defaults from `src/index.ts`. **32 assertions-based cases passed**, exit 0: two dimensions × original matching/nonmatching × eight scenarios (ordinary, overridden method, throwing method, page mutation, retry mutation, mutation during initialization acknowledgement, mutation plus abort during acknowledgement, replay plus mutation). No probe file was written.

Every probe returned structured results using the original intake decision; caller methods and observation/claim effects were never invoked. Retried requests were identical with one read/page and two initializer calls. Fresh acceptance after abort preserved permitted intake with cancelled stop; replay never signalled regardless of mutated rules. Initialization-only cleanup remained no-claim. These probes used complete in-memory method-valid acknowledgements: they prove public-boundary consumption, **not physical durability**. Physical persistence/reopen/concurrency evidence comes from the independently executed real-ledger suites. Historical test-first RED 16 failed / 78 passed is inherited remediation evidence, not rerun or represented as fresh here.

**Disposition: CLOSED, original severity Major.** No authorization, fresh/replay, operation identity, supplied behavior, schema or public API change was needed beyond the bounded fix.

### Spec compliance and conformance mapping

For compact evidence below, paths abbreviate `src/DevSquadAdoWorkflowWatcher`: `V` = `Validation.ts`, `DV` = `DiscoveryValidation.ts`, `DM` = `DiscoveryMatching.ts`, `D` = `Discovery.ts`, `A` = `Admission.ts`, `L` = `Ledger.ts`, `O` = `Observation.ts`, `P` = `Pass.ts`. Test suffixes: `T` = `.test.ts`, `C` = `.concurrency.test.ts`, `B` = `.bounds.test.ts`, `R` = `.recovery.test.ts`, `M` = `.remediation.test.ts`, `Deps` = `.dependencies.test.ts`, `DT` = `.discovery.test.ts`, `DA` = `.discovery.admission.test.ts`, `DMT` = `.discovery.matching.test.ts`, `DB` = `.discovery.bounds.test.ts`, `DL` = `.discovery.lifecycle.test.ts`.

| Requirement group                   | Assessment                                                                                            | Implementation evidence                                             |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| FR-001–004/008–011/020/061          | PASS: typed exclusive modes, captured validation, compatibility, injected boundaries                  | Watcher.ts:527–559; V:163–194,264–477; DV:318–414; index.ts:265–350 |
| FR-005–007/044–046/069              | PASS: distinct signals, stable outcomes, independent accounting and no-claim admission                | D:124–184,310–387; A:39–149; P:498–539                              |
| FR-012–019/021–024/065              | PASS: opaque observations, optional PR, exact matching, stable ordering/poll decisions                | O:211–307,325–445; DM:8–66; DV:502–612; D:186–268                   |
| FR-025–031/036a                     | PASS: fenced existing-record mutations, renewal, acquisition staleness and cleanup                    | P:215–301,555–606,835–905; V:662–666                                |
| FR-032–039 including 035a/035b/037a | PASS: bounded unique anchors, cursor-only patches, original-submission acknowledgement and identity   | O:211–307,409–469; P:618–724,907–935; L:534–608                     |
| FR-040–043/067–068                  | PASS: host state/auth, captured intake, fresh-only admission and stable retry submission              | A:20–149; D:127–178; L:444–479,633–679; V:458–463                   |
| FR-047–053/062–064                  | PASS: bounded invocation-local traversal, explicit incompletion, fresh abort and retired seams        | D:83–94,186–302; DV:74–309,446–612; O:80–150                        |
| FR-054–060                          | PASS: guarded error categories, recovery isolation, acknowledgement preservation and truthful cleanup | L:111–218,286–400,411–679; P:215–445,674–724,1147–1170              |

All CCs and TEST obligations have identifiable mapped assertions. Every named suite below was freshly executed by the test guardian; static mapping is not a claim of exhaustive input-space proof.

| CC      | Scenario / test mapping                                                                                                              | Status                                               |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| 001–003 | Durable intake, repeat and observation-only calls: T:422–641; Deps:211–310                                                           | Mapped / executed                                    |
| 004–006 | Overlap, stale fencing and revision/state conflict: C:77–179,344–519                                                                 | Mapped / executed                                    |
| 007–009 | Cursor-advancing suppression, custom phase, missing records by mode: T:643–752; DA:130–161                                           | Mapped / executed                                    |
| 010–011 | Ordering, poll budgets/backoff and clocks: T:946–1018; B:102–286; DB:475–558                                                         | Mapped / executed                                    |
| 012–014 | Abort/acknowledgement, timeout and renewal: M:1545–1606; DL:439–510; B:290–339; C:1135–1237                                          | Mapped / executed                                    |
| 015–017 | Zero-effect invalid input, seam contract and recovery isolation: T:119–310; M:2727–2820; DB:24–210; R:59–248,493–530                 | Mapped / executed                                    |
| 018–020 | Privacy, PR completeness, offline/public boundary: T:755–850,1020–1093; M:1990–2024; DL:1045–1170; Deps:211–310                      | Mapped / executed                                    |
| 021–023 | Reacquisition, stale observation and absent anchor: C:179–341,985–1061; P:890–905; M:1837–1880; DL:226–247                           | Mapped / executed                                    |
| 024–027 | Typed faults, fresh abort, bounded windows, retired lifecycles: M:1610–1745,1789–2182,2754–2801; DA:481–655; DT:174–265; DL:927–1041 | Mapped / executed                                    |
| 028–030 | Cleanup/counts, original request/replay/history and metadata: M:200–488,2522–2820; DL:439–657; DA:607–776,882–980                    | Mapped / executed                                    |
| 031     | Authorized no-comment admission/races/retry/restart and repaired intake: DA:56–278,281–452,655–776,882–980                           | Mapped / executed; W046-001 closed                   |
| 032     | Exact seven-slot matching, missing/empty and unsupported operators: DMT:18–255; DB:140–238                                           | Mapped / executed                                    |
| 033     | Pause at 480, reentry to 481, loss and supplied empty control: DL:97–305                                                             | Mapped / executed                                    |
| 034     | Complete traversal, retained retry order and fresh reopen: DB:475–661,775–843                                                        | Mapped / executed                                    |
| 035     | Budgets, failed pages, duplicate/cycle/drift and preserved earlier actions: DB:727–773,845–1010                                      | Mapped / executed                                    |
| 036     | Inclusive count/value/collection/recognized-JSON UTF-8 limits: DB:24–410,1126–1350                                                   | Mapped / executed                                    |
| 037     | Initialization guards, mutation/abort/replay and privacy: DA:281–452,481–744,779–980; DL:439–657,927–1170; DT:148–265                | Mapped / executed; structured-result repair verified |

TEST-001–032 remain supported by supplied/shared suites; TEST-033–039 map to CC-031–037 respectively. Focused original-history probes preserve original submission before refreshed retry preconditions; admission replay is not generalized into delivery reconstruction. SC-001–014 receive technical conformance support, with environment/build limitations below explicitly excluded from any global-success interpretation.

### ADR, consistency and security-control disposition

| Boundary / obligation | Assessment and evidence                                                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-0021/0022/0024    | Technical PASS: injected observations only, no live transport/query/external write or execution dispatch; host controls phase/state/authorization. O:316–395; D:1–32,214–233; P:498–539,908–935; Deps:35–58,203–310 |
| Proposed ADR-0025     | Storage contract preserved; exact base comparison proves ledger/manifests/tooling unchanged; initialization uses only existing four-field typed operation (L:638–657)                                               |
| Proposed ADR-0026     | Approved discovery contract technically supported alongside supplied behavior; no ADR acceptance inferred                                                                                                           |
| Code consistency      | Plain Promise modules; shared candidate/guard/observation reuse; exact captured rules in both intake paths; no new actionable duplication/naming/error-handling finding                                             |
| Public docs/release   | README:425–697 accurately separates modes and limitations; index.ts:265–350 additive exports; minor watcher and historical recovery patch changesets nonduplicate; examples/dependency tests executed               |
| SEC-A01/A02           | Canonical-item explicit authorization, original initialization request, fresh-only reporting and no fabricated authority retained (A:20–149; L:444–479,633–679)                                                     |
| SEC-A03/A04           | Bounded whole-page validation and exact matching before item effects; preserved anchors/explicit loss (DV:446–612; DM:8–66; O:184–209,350–445)                                                                      |
| SEC-A05/A06           | Allowlisted evidence and local bounded traversal; no raw facts/policy/continuation persistence (DM:57–66; D:83–94,186–387; DL:1045–1170)                                                                            |
| SEC-A07               | Awaited acknowledgements, fresh abort gates and truthful no-claim/exactly-once cleanup; admission result no longer invokes caller methods (A:69–149; O:80–150; P:215–301,1147–1170)                                 |

SEC rows are architectural/code/test traceability, not a substituted specialist vulnerability report. Fresh specialist result is recorded separately above. Trusted adapters are not sandboxed; accepted at-most-once signal loss and settling-dependency liveness assumptions remain explicit. No dependency/network audit was run; inherited dependency audit notices are unassessed.

### Fresh execution versus inherited evidence

Test guardian ran these gates sequentially, without concurrent test commands:

| Command                                                                                                                                          | Fresh result                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `npm test -- DevSquadAdoWorkflowWatcher DevSquadAdoWorkflowLedger`                                                                               | Exit 0; **696 passed / 2 Windows skips**, 16 files; 36.11 seconds                 |
| `npm test -- DevSquadAdoWorkflowWatcher.remediation -t "third independent history"`                                                              | Exit 0; **19 passed / 244 selector exclusions**; overlaps combined total          |
| `npm run typecheck`                                                                                                                              | Exit 0; `tsgo --noEmit`                                                           |
| `npx --no-install prettier --check` on base-to-HEAD changed `src` and `README.md` paths                                                          | Exit 0; **24 paths**, source/tests/supports/index/README                          |
| `npx --no-install prettier --ignore-path .gitignore --check .changeset/devsquad-ado-workflow-watcher.md .changeset/watcher-contract-recovery.md` | Exit 0; both changesets                                                           |
| `git --no-pager diff --check <integration-base> HEAD`                                                                                            | Exit 0; guardian and parent                                                       |
| `node scripts/check-public-types-effect-free.mjs`                                                                                                | Exit 0; **fresh guard execution on inherited remediation-generated declarations** |
| Parent inline `node --import tsx --input-type=module -` public probes                                                                            | Exit 0; **32 passed**, in-memory fake ledger, no durable/probe-file write         |
| `npm run build` / `tsup`                                                                                                                         | **Not run**: read-only review does not regenerate/clean `dist`                    |

Combined breakdown: supplied/shared watcher **329**, dependency guardians **17**, discovery public/examples **20**, matching **45**, admission **94**, bounds **81**, lifecycle **46**, ledger suites **64** = **696**. These are fresh counts; the 19 history cases and 20 repair tests are subsets, not additive totals. No percentage-coverage claim is made.

The two existing platform skips are the Linux-only production ledger initialize/acquire/checkpoint/reopen/list/release test and the non-Windows production-filesystem 1,000-record listing benchmark. The 244 history exclusions are selector exclusions, not platform skips. Portable real-ledger fixtures do not certify production Windows ledger permissions.

Inherited, NOT freshly executed here: remediation test-first RED 16 failed / 78 passed; remediation fresh ESM/DTS generation; canonical build exit 1 at unavailable Windows `rm`; separate guard on those fresh declarations; prior eight baseline/environment failures. The turn-2 isolated scoped green checks are superseded by current fresh scoped execution, not reused as its proof. Current guard does not turn inherited generation into a fresh build. Packaging remains failed/unverified; no build-script repair occurred.

No whole-project `npm test`, global format gate, dependency installation, external audit, deployment or live tracker command was executed. Earlier interrupted global attempts have no complete totals. The narrowed eight unchanged-baseline failures do not classify every unidentified failure from those interrupted attempts.

### Retained findings, severity and limitations

| ID        | Severity retained | Current disposition / evidence                                                                                                                                                              |
| --------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W046-001  | Major             | **Closed independently** at both admission call sites; fresh real-ledger regressions and parent public probes above                                                                         |
| TB046-001 | Major             | Five inherited session-storage/Windows failures, not rerun; prior identical-source evidence at review-log:1087–1090, SessionStore.ts:384 and AgentProvider.test.ts:2192,2285,2336,2461,2568 |
| TB046-002 | Major             | Inherited missing external `cp`, not rerun; CopyToWorktree.ts:49; prior base-identical failure evidence at review-log:1091                                                                  |
| TB046-003 | Major             | Two inherited path-separator assertions, not rerun; createWorktree.test.ts:64, createSandbox.test.ts:265; prior evidence at review-log:1092                                                 |
| TB001     | Minor             | Historical private-guard/object-identity coupling unchanged and nonblocking; remediation.test.ts:953,1021,1288,2423; not a new finding or required fix                                      |

No source correction outside W046-001 is authorized or necessary for the bounded slice PASS. Global tests, canonical package build, production Windows ledger support, audit and deployment remain uncertified. ADR-0025/0026 remain **Proposed**, not governance-accepted and not made technical blockers merely by that status. Stale historical artifact status paragraphs remain historical; this append supplies current review evidence without rewriting spec/plan/ADR history.

### W042–W046 closure

| Task | Independent full-slice disposition                                                                                                                                                                        |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W042 | **PASS:** anchored pause/reentry, explicit WI/PR retention loss, supplied empty control and suppression distinction supported by lifecycle tests and shared observation path                              |
| W043 | **PASS:** bounded multi-page traversal, retained candidates, one page/item step per poll, whole-page rejection, byte/count ceilings, explicit terminal/incomplete and restart proven within scoped suites |
| W044 | **PASS:** mixed outcomes, original-request retry/recovery, acknowledgement-preserving abort and truthful count/cleanup; prior W046-001 qualification removed by independent closure                       |
| W045 | **PASS within public-contract scope:** exports/inference, executable examples, host documentation, release alignment and dependency boundaries; no fresh packaging certification                          |
| W046 | **PASSED, technical only:** all five guardians accounted for, trigger-required specialist completed, zero remaining slice blockers; parent owns separate checkbox/evidence commit                         |

W039/W040/W041 are included and supported, with the W041 intake gate now independently closed. W001–W038 historical completion and all earlier findings remain preserved, not reopened.

### Reasoning log and handoff envelope

- **Decision:** Close W046-001 and issue full integration-slice technical PASS. **Why:** Three independent static guardians traced owned snapshots through both call sites; fresh real-ledger public regressions and 32 parent public probes establish original-rule decisions through callbacks/retries/abort/replay. Full supplied/recovery/discovery suites remain green. Confidence is high for the demonstrated defect and scoped contract, not exhaustive correctness.
- **Decision:** Retain baseline Major severity and decline global/package certification. **Why:** Their original evidence and platform attribution are unchanged; no fresh full-suite or build was executed. Separating review scope is not downgrading findings.
- **Decision:** Append only; leave task/governance/publication to parent. **Why:** Technical evidence is distinct from approval and evidence commits change the repository tree even when code is identical.

**Handoff:** Destination: conductor/parent evidence-only closure. Required evidence: this appended session; current `tasks.md:673–680` remediation handoff; regression source `src/DevSquadAdoWorkflowWatcher.discovery.admission.test.ts:281–452`. Blocking slice finding IDs: **none**. Closed ID: **W046-001 (Major)**. Retained non-slice IDs: TB046-001–003 (Major), TB001 (Minor).

Parent may mark W046 and commit only evidence separately after verifying unchanged reviewed code against HEAD `9854e9ea5f739ee5ba8a605a97a7fd3569a9cce3`, committed tree `7519db940767937691d2ffc41d2bf3a2921711e7`, and `src` subtree `6e7c6d3ffb2bdc082b371be38efd773fbfa14a38`. A later evidence-only commit will have a different overall tree; compare code blobs/subtree, not assert that the entire tree is unchanged.

Preserve assumptions: explicit host item authorization/exact state; matching is not execution authority; at-most-once potentially lost admission; supplied no-initialization compatibility; original-submission checkpoint history; no durable continuation; trusted adapters and settling dependencies. No new product/auth decision was needed. Preserve **#20 before #21**; ADR-0025/0026 remain Proposed. No live ADO/board/PR write, push, merge, force, amend, rebase, branch change, harness learning or slices 15+ occurred or is authorized by this verdict.

---

## W046 local evidence-only closure — 2026-09-10

### Technical completion, authority and provenance

**W046 technical PASS recorded; W039–W046 locally technically complete; publication PENDING.** This implementation worker closes only the local checkbox/evidence task from the existing independent turn-3 verdict above. No independent review, code implementation or board workflow transition was performed here. Historical FAIL/PASS verdicts, finding severities and provenance remain intact. W046-001 is independently closed; TB046-001–003 remain retained baseline Majors and TB001 remains nonblocking Minor.

The accepted independent review covers the entire integration delta `9ff6e8e9f74792e131e927bd9bf41358e36cea95` → `9854e9ea5f739ee5ba8a605a97a7fd3569a9cce3`, not just remediation. Reviewed committed tree: `7519db940767937691d2ffc41d2bf3a2921711e7`; reviewed `src` subtree: `6e7c6d3ffb2bdc082b371be38efd773fbfa14a38`. All five guardians are accounted for and the required security specialist reported no vulnerabilities. Traceability remains W046 / FR-001–069 including suffixes / CC-001–037 / TEST-001–039 / SC-001–014 / SEC-A01–A07.

**Inherited by this closure, not rerun:** The independent review's fresh 696 passes / 2 Windows skips, focused history 19 passes / 244 selector exclusions (overlapping total), 32 independent public probes, typecheck, scoped formatting/diff and declaration-guard PASS. That review's guard ran on inherited fresh remediation-generated declarations. Remediation freshly generated ESM and DTS, then canonical `npm run build` failed at the known Windows postbuild `rm`; packaging and global-suite success remain uncertified. The eight baseline failures, interrupted global-suite attempts and platform limitations above are retained. Only documentation formatting, preservation/diff checks and the commit hook belong to this local closure's fresh validation.

### Parent-supplied CI policy and publication evidence (not queried by this worker)

The following is supplied parent evidence, not fresh worker API execution or a remote write:

| Parent evidence                                                                                                                                                | Bounded conclusion                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Base branch at `9ff6e8e9f74792e131e927bd9bf41358e36cea95`: `protected=false`, `protection.enabled=false`, required checks `[]`, contexts `[]`, enforcement off | Parent policy assessment established no required repository CI checks                                                                      |
| Applicable `rules/branches` target `[]`; `rulesets?includes_parents=true` returned `[]`                                                                        | Independent rule evidence supports absence of required checks; empty commit statuses alone do not establish policy                         |
| Protection endpoint returned 404                                                                                                                               | Not standalone proof that protection or required checks are absent                                                                         |
| `.github/workflows/ci.yml` triggers on push to `main` only                                                                                                     | Does not establish a required check for this unpublished feature head                                                                      |
| API permissions `pull=true`, `push=false`                                                                                                                      | May block publication; parent must resolve publication authority separately                                                                |
| Existing PR #21: remote head `aed663765a3a8bcc5864af34a000089961e4eaba`, branch `users/davidsant/symmetrical-train`, base `users/davidsant/ubiquitous-train`   | Existing remote publication is distinct from this worktree's unpublished reviewed head; current unpublished head statuses not yet assessed |

### Preservation and local validation scope

Before edits, only `review-log.md` was dirty: the reviewer had appended 205 lines / 27,189 bytes. Committed HEAD log size was 180,862 bytes; worktree size was 208,051 bytes. Both the original W038 128,823-byte prefix and the full 180,862-byte HEAD prefix matched HEAD exactly before closure.

The original W038 prefix SHA-256 is `8211e975730800dbee1ae3845566b1b0a76f5f62d30b174e73225e620330d25d`. The reviewer's historical 180,862-byte prefix SHA-256 is `0081cd63dd9209c970471ee2bbc0e04826c67cdccd7cdc170446d3ff6b616597`. Its append-time equality statement above remains a historical measurement, not an assertion that the subsequently formatted reviewer addition is byte-identical. A scoped Prettier preview preserved both prefixes and first changed byte offset 180,863 (zero-based), normalizing recent review whitespace/tables only; the 208,051-byte pre-closure log would normalize to 215,772 bytes before this closure append. Post-format and post-commit measurements are returned with the final commit identity; no historical verdict is rewritten.

Only `tasks.md` and `review-log.md` are included in this logical Conventional Commit unit, with the required Copilot App trailer and no hook bypass. Current task intro/footer now distinguish local completion from publication; earlier W045 stop restrictions and turn-2 pending handoff are explicitly historical. Existing project guidance and the installed git-commit skill were read; `.memory/harness-learnings.md` was absent. No source symbols changed; no IDE/LSP diagnostic or fresh code-validation claim is made.

Fresh pre-commit documentation validation passed: scoped `npx --no-install prettier --check` on these two files, `git diff --check`, W039–W046 checked-task assertions, task-to-review-log anchor checks, exact two-file scope, and unchanged non-doc comparison against reviewed HEAD. After scoped formatting, both the 128,823-byte W038 prefix and the 180,862-byte historical HEAD prefix still matched HEAD byte-for-byte with the hashes above. Hook execution and final post-commit identity/cleanliness are reported in the worker return, not preclaimed here.

### Decision and parent handoff

- **Decision:** Record W046 completed technically. **Basis:** Existing independent full-delta PASS, all five guardians plus specialist, and W046-001 closure satisfy the task gate; no new review is needed for evidence-only edits. Confidence: high within the accepted scope.
- **Decision:** Keep publication, governance and packaging separate. **Basis:** Policy evidence is parent-supplied, write permissions may block publication, and known global/build limitations persist. ADR-0025/0026 remain **Proposed**; no governance/merge approval follows.
- **Handoff:** Parent owns steps 15–19 and publication/status assessment. Preserve #20 before #21; this worker does not execute later steps or authorize later slices. No push, PR update, board creation/transition, merge, branch change, source/test/configuration/package/script edit or remote write occurs in this closure. Final HEAD/tree will change for evidence only; compare non-doc content and `src` identity to reviewed HEAD, not the entire tree.

## W046 bounded local remediation 2026-09-10

### Current disposition and authority

**W046 REOPENED / PENDING independent new-source review.** This is execute-worker implementation evidence, not an independent review, technical PASS, governance acceptance, publication or merge authorization. W001–W045 historical completions and every prior FAIL/PASS verdict remain intact. W046-001's historical independent closure is not reopened as a new finding; the four bounded findings below concern new review observations against the inherited source. No later slice, nested agent, board workflow or remote operation was executed.

The conductor supplied explicit approval of scope, plan and understanding. Validation classified overall impact **HIGH** because ARC14-001 restores a public validator contract; SKEP1–3 implementation impact was **Medium**. These implementation-risk labels are distinct from the original finding severities below. Validation reported no blockers/spec drift and confirmed the approved discovery amendment of Proposed ADR-0026 suffices. The execute worker read AGENTS/CLAUDE, approved discovery spec/plan/tasks/ADR sections, retained review evidence, installed git-commit/test-discipline guidance and the existing test patterns. `.memory/harness-learnings.md` was absent. No IDE/LSP tools were available; local text search was used without claiming compiler-backed navigation. No dependencies were installed and no live Microsoft/Azure SDK or transport was introduced.

Workspace and branch remained `C:\repos\copilot-worktrees\sandcastle\users-davidsant-bookish-doodle`, `users/davidsant/bookish-doodle`. Starting clean HEAD was `5973fc159aa4cf59f6ec289f719eb28d2f9a2ec8`, starting `src` subtree `6e7c6d3ffb2bdc082b371be38efd773fbfa14a38`. Historical independent PASS reviewed source commit `9854e9ea5f739ee5ba8a605a97a7fd3569a9cce3`, tree `7519db940767937691d2ffc41d2bf3a2921711e7`; the later `5973fc` closure was evidence-only. None of those verdicts applies automatically to the remediated source.

### Perspectives, provenance and bounded dispositions

| Finding / perspective                        | Original evidence and severity                                                                                                                                                                                                                                                                                                                                                        | Implemented response / remaining gate                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SKEP1 — skeptical correctness/authority      | **High**, originally user-supplied static review: Discovery inferred admission from any `record-not-found` reason. An existing acquired-record checkpoint rejection could become admission, erase failed/indeterminate cleanup, skip as unauthorized or initialize when authorized.                                                                                                   | Independently reproduced here through public `src/index.ts` calls before the fix. Explicit guarded initial-read-missing provenance now controls admission; existing mutation failures and cleanup remain observation outcomes. Implemented, independent closure pending.                                                                                                                                                                                                     |
| SKEP2 — skeptical error containment/liveness | **High**, originally static: captured listener methods still execute caller code. Registration outside containment and throwing removal could reject the pass, hide prior acknowledged signals and bypass discovery retained-claim finalization after an indeterminate checkpoint. Getter/captured-reread/unreadable-abort tests did not cover executable throws.                     | Four integrated public regressions reproduced raw rejection for add/remove in both modes. Registration/removal now share the contained lifecycle; failures use existing sanitized observation/page categories. Prior acknowledged effects/signals survive and retained claims finalize. One removal attempt is made even after partial registration. No guarantee that a throwing arbitrary adapter actually removed its listener. Implemented, independent closure pending. |
| SKEP3 — skeptical temporal bounds            | **Medium**, originally static: supplied pass retained mutable caller Dates, unlike discovery. A shared Date sequence t0, t0, t0+6000 could move the start baseline despite a 5000ms elapsed limit. Existing cloning fixtures masked it.                                                                                                                                               | Public tests reproduced excess polling and rewritten metadata, including seam-time mutation. Supplied mode now owns a Date copied from the native timestamp, preserving the original read count. Finite poll-count bounds already existed; no infinite-loop claim is made. Implemented, independent closure pending.                                                                                                                                                         |
| ARC14-001 — architecture/privacy contract    | **Medium contractual privacy finding**, inherited executed parent-specialist public probe: `ok=true`, `returnsPolicyOperand=true`, `returnsSubmissionId=true`, `configurationIsCopy=true`, `dependencyCalls=0`. Parent specialist assessed the returned data as the same caller's own data, **not an exploitable vulnerability** (9/10 assessment); no exfiltration/credential claim. | Fresh independent public regression here reproduced the returned operands/submission ID. Public validation now returns only normalized common settings, mode and binding; private prepared configuration remains available only to the running implementation. Public type-level absence assertion and pass matching/admission controls added. Supplied types/unions and discovery request shape remain unchanged. Implemented, independent closure pending.                 |
| ADV-01 — artifact chronology                 | Conductor-authorized parallel refinement of historical approval headers only; spec/plan/ADR wording was an approval-checkpoint statement, not a new runtime blocker.                                                                                                                                                                                                                  | **Authorized amendment, result pending** separate worker/parent handoff. This worker did not edit/stage/commit the three artifacts. No new spec/ADR contract was invented.                                                                                                                                                                                                                                                                                                   |
| Inherited guardians/security                 | Historical turn-3 review accounted for all five guardians and required security specialist on the old source. TB046-001–003 remain retained baseline Majors; TB001 remains nonblocking Minor.                                                                                                                                                                                         | Preserved historical evidence, not fresh guardian/security results. Parent owns new-source independent review after verification.                                                                                                                                                                                                                                                                                                                                            |

Requirement mappings remain the supplied IDs, without amendments: SKEP1 FR-020/059–060/067–069 and CC-009/024/028–029/031/037; SKEP2 FR-001/005–007/051–053/057–060/069 and CC-012/025/027–028/037; SKEP3 FR-016–017/047–048 and CC-011/030; ARC14-001 FR-003/008/064/069 and CC-032/036–037 / SEC-A05. ARC restoration follows the plan's private transient configuration and SEC-A05 obligations, ADR-0026 privacy projection and README public behavior.

### Fresh baseline and RED/GREEN execution

All new tests reside in `src/DevSquadAdoWorkflowWatcher.w046.test.ts` and enter through **public `src/index.ts` exports**, with real watcher orchestration and method-valid recording in-memory ledger fakes. The fixture structurally follows the retained remediation exemplar. These new cases prove public boundary behavior, **not physical durability**; the scoped suite separately reruns the existing real-ledger durability/reopen/concurrency coverage. Selective exclusions below are not platform skips or additive test totals.

| Command / stage                                                                                            | Exact result                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before implementation: `npm test -- DevSquadAdoWorkflowWatcher DevSquadAdoWorkflowLedger`                  | Exit 0, **696 passed / 2 Windows skips**, 16 files.                                                                                                                                                                                                                                                        |
| Before implementation: `npm test -- DevSquadAdoWorkflowWatcher.remediation -t "third independent history"` | Exit 0, **19 passed / 244 selector exclusions**, subset of baseline.                                                                                                                                                                                                                                       |
| Before implementation: `npm run typecheck`                                                                 | Exit 0, `tsgo --noEmit`.                                                                                                                                                                                                                                                                                   |
| SKEP1 RED: `npm test -- DevSquadAdoWorkflowWatcher.w046 -t SKEP1`                                          | Exit 1, **4 failed / 2 passed**. Authorized cases invoked initialization; unauthorized cases lost failed/indeterminate cleanup and became admission skips. Same counts in the initial run, strengthened malformed-read control rerun and corrected-fixture RED rerun, all before the final production fix. |
| SKEP1 GREEN: same command                                                                                  | Exit 0, **6 passed**. Both authorization states × failed/indeterminate release, plus valid missing and malformed-read controls.                                                                                                                                                                            |
| SKEP2 RED: `npm test -- DevSquadAdoWorkflowWatcher.w046 -t SKEP2`                                          | Exit 1, **4 failed / 6 selector exclusions**, all on executable `private-listener-error` rejection.                                                                                                                                                                                                        |
| SKEP2 GREEN: same command                                                                                  | Exit 0, **4 passed / 6 selector exclusions**. Both add/remove and supplied/discovery; prior item acknowledged, discovery second item retained an indeterminate checkpoint through next-page failure.                                                                                                       |
| SKEP3 RED: `npm test -- DevSquadAdoWorkflowWatcher.w046 -t SKEP3`                                          | Exit 1, **2 failed / 10 selector exclusions**. Shared clock ran 3 polls instead of 1 and moved `startedAt`; seam mutation moved start/completion metadata.                                                                                                                                                 |
| SKEP3 GREEN: same command                                                                                  | Exit 0, **2 passed / 10 selector exclusions**; exactly 3 readings for the exhausted second-poll gate and 2 for the single-poll metadata control.                                                                                                                                                           |
| ARC14-001 RED: `npm test -- DevSquadAdoWorkflowWatcher.w046 -t ARC14-001`                                  | Exit 1, **1 failed / 2 passed / 12 selector exclusions**. Public validator returned operands/submission ID while dependency spies remained untouched; existing pass privacy controls passed.                                                                                                               |
| ARC14-001 GREEN: same command                                                                              | Exit 0, **3 passed / 12 selector exclusions**, repeated after the type correction described below.                                                                                                                                                                                                         |
| Per-fix `npm run typecheck`                                                                                | Final exit 0 for each of the four logical fixes; intermediate failures disclosed below, not concealed by later commands.                                                                                                                                                                                   |
| Per-fix `npm test -- DevSquadAdoWorkflowWatcher DevSquadAdoWorkflowLedger`                                 | Exit 0 after SKEP1: **702 passed / 2 skips**; SKEP2: **706 / 2**; SKEP3: **708 / 2**; ARC14-001: **711 / 2**, 17 files. ARC scope ran twice with 711 / 2, including after restoring the request type.                                                                                                      |

No full global suite was run: known platform failures and historical interrupted attempts remain retained above. No new-source build/ESM/DTS or declaration-guard evidence is claimed by this execute worker. The parent verify worker owns fresh canonical `npm run build`, separate reporting of known Windows postbuild `rm` failure, fresh public declaration guard, final scoped suite/typecheck/format/diff gates. No independent review/finalize agent was invoked here.

### Error-scenario coverage and implementation corrections

- **SKEP1:** Four public regressions assert no initialization, original observation failure/source revision, truthful failed or indeterminate release cleanup/counts, and exactly one checkpoint/release call. Valid initial missing still reaches admission; malformed read never does. Existing missing-read/admission guards and historical history recovery remain covered by the full scoped run.
- **SKEP2:** Public cases preserve item 137's acknowledged cursor and signal before item 138 or the next page fails. Discovery cases retain item 138's authority and identical checkpoint retries after indeterminate acknowledgements, then assert exactly one release and `checkpoint-indeterminate` with incomplete `page-failed` traversal. Registration failure does not initiate that page (1 page call), removal failure follows invocation (2 page calls). Add/remove attempt counts are exact. A deliberately throwing remove leaves one adapter-owned listener in the fixture: this is reported honestly, not asserted away. Serialized results contain no exception sentinel, continuation sentinel or capability field. Existing timeout, abort/getter and retired-child/timer tests also pass.
- **SKEP3:** Public assertions isolate elapsed scheduling and immutable metadata, with unchanged read counts. This does not claim a hard duration bound or trustworthy behavior from a lying clock.
- **ARC14-001:** Exact public keys, binding and absence of policy/submission sentinels are asserted alongside zero calls to delay, clock, seam and every ledger method. A compile-time assertion prevents reintroducing the public `discovery` field. Two pass controls prove private policy still controls matching and explicit authorization still permits claim-free initialization, without leaking either payload.
- **Fixture correction:** The first SKEP1 GREEN attempt had **2 failed / 4 passed** because the new fake used invalid storage outcome `not-committed` instead of the existing contract's `unchanged`; the guard correctly classified it as a ledger fault. Typecheck also caught a widened `window` literal. Production edits were restored to the passing initial save-point before correcting the fake, then the same four material RED failures were reconfirmed before reapplying the production fix. One corrective cycle resolved both fixture defects; they were not product regressions.
- **Type-edit correction:** The first ARC runtime GREEN passed (3 focused, 711 scoped), but `npm run typecheck` failed because a textual edit removed the identically documented configuration field from both result and request types. `Watcher.ts` was restored, and the edit narrowed to `DevSquadAdoDiscoveryValidatedPass` only. Final typecheck and both focused/scoped suites passed; no request-type change remains. One corrective cycle; no contract drift.
- **Whitespace correction:** Initial SKEP1 diff checking exposed CRLF churn in the changeset written by Python. The following logical commit restored LF with explicit formatting through `--ignore-path .gitignore`; final range diff/format checks are tracked separately. No historical log bytes were normalized by these source commits.

### Logical commits and release documentation

| Commit                                     | Scope                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `ac34e5ac5d5549fdcfa50bdc4fee61bdc9249283` | SKEP1 provenance, public regression fixture/cases, README and existing watcher changeset.         |
| `9f4492a3e984071d0a18c815269c25ede9c5a4d8` | SKEP2 contained listener lifecycle, integrated cases, README and changeset.                       |
| `65b788cc1da15303e93c863806850b8f4a19f120` | SKEP3 owned native clock timestamps, public cases, README and changeset.                          |
| `f862a2cc273f2fec1d65fe2b1085aaa472a22c53` | ARC14-001 minimized summary/private preparation, public privacy/type cases, README and changeset. |

Resulting source subtree: `3d6ff0e8a00861c271ca6349852580b7b6b5ed12`. Each logical fix was committed after passing scoped tests and typecheck, with actual diff inspection, explicit owned paths, normal hooks and the required `Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>` trailer. All `.changeset` entries were read first; the existing unreleased `@ai-hero/sandcastle` watcher feature **minor** entry was extended with bounded bugfix notes, rather than adding a duplicate feature or lowering its already-required minor release. The separate historical patch entry remains untouched. README directly documents each public behavior.

### Publication, CI, preservation and parent handoff

Inherited parent evidence only, not fresh remote execution: the normal fast-forward push of `5973fc` was denied **403** for `davidsant_microsoft`, with API `pull=true`, `push=false`. No authentication retry was attempted. Existing PR #21 remains at parent-reported remote head `aed663765a3a8bcc5864af34a000089961e4eaba`, branch `users/davidsant/symmetrical-train`, base `users/davidsant/ubiquitous-train`. The inherited branch/rule policy was `protected=false`, enforcement off, checks/contexts `[]`, applicable rules `[]`, inherited rulesets `[]`; CI triggers only push to `main`. This establishes no required repository CI in that evidence, **not** new-source CI success. New source is unpublished and has no new CI certification.

Before this append, the retained 223,509-byte log exactly matched initial HEAD. The original W038 128,823-byte prefix retained SHA-256 `8211e975730800dbee1ae3845566b1b0a76f5f62d30b174e73225e620330d25d`. This entry is append-only; no earlier verdict was rewritten. Tasks now reopen only W046, retain W001–W045, mark the prior local closure historical and point to this pending new-source gate. Spec/plan/ADR belong exclusively to the parallel authorized ADV-01 amendment; ledger/schema, dependencies/tooling, legacy result types, `final-review-evidence.json`, dist and later slices are intentionally untouched by this worker.

**Next:** stop after local implementation/bookkeeping commits. Parent verify and independent review must assess the new source before any new W046 PASS; build limitations, publication denial, ADR acceptance and #20-before-#21 remain distinct. No harness learning has been captured. No spec drift was found.

Fresh bookkeeping checks passed: full 223,509-byte starting log preserved as an exact prefix; W038 prefix hash unchanged; only W046 checkbox reopened; scoped touched-file Prettier checks and `git diff --check 5973fc159aa4cf59f6ec289f719eb28d2f9a2ec8` passed. A Python default-encoding issue in newly added task punctuation was detected by diff inspection and replaced with ASCII before committing; historical bytes remained unchanged. Final post-hook preservation and commit identity are reported in the worker handoff.

## W046 committed remediation verification and amendment blocker - 2026-09-10

### Worker provenance and disposition

The implementation orchestrator invoked `devsquad.implement.validate`, `devsquad.implement.execute`, and `devsquad.implement.verify` in sequence. Validation classified the combined work High because ARC14-001 restores a public discovery-validator shape; SKEP1-3 are bounded Medium implementation corrections. Existing explicit approval and ADR-0026 cover these decisions; no normative spec drift or new product decision was identified. Local `tasks.md` is the work source, not a live linked work item. No board operation was performed.

The verify worker assessed committed HEAD `077ccd28540b970f3669d62d2302536b2b50b0e8`, tree `8eb683961be46ec85143a4472027d26165b7e972`, source tree `3d6ff0e8a00861c271ca6349852580b7b6b5ed12`, with a clean worktree. Its verdict is **PASS for scoped implementation self-verification only**, not independent review, complete packaging certification, global-suite certification or W046 closure. The following commands were freshly executed by that worker sequentially, not rerun by this evidence append.

| Command                                                                                                                                | Fresh verify-worker result                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `npm test -- DevSquadAdoWorkflowWatcher DevSquadAdoWorkflowLedger`                                                                     | Exit 0; 17 files, **711 passed / 2 existing Windows skips**, 30.24 seconds                                                        |
| `npm test -- DevSquadAdoWorkflowWatcher.remediation -t "third independent history"`                                                    | Exit 0; **19 passed / 244 selector exclusions**, 1.08 seconds; subset of combined total                                           |
| `npm run typecheck`                                                                                                                    | Exit 0; `tsgo --noEmit`                                                                                                           |
| `npm run build`                                                                                                                        | Exit 1; clean output, **fresh ESM success 8,277 ms and DTS success 13,627 ms**, then unchanged Windows postbuild `rm` unavailable |
| `node scripts/check-public-types-effect-free.mjs`                                                                                      | Exit 0, after fresh DTS generation; no Effect references in public declarations                                                   |
| `$files = @(git --no-pager diff --name-only 5973fc159aa4cf59f6ec289f719eb28d2f9a2ec8..HEAD); npx --no-install prettier --check @files` | Exit 0; all 11 changed paths                                                                                                      |
| `npx --no-install prettier --ignore-path .gitignore --check .changeset/devsquad-ado-workflow-watcher.md`                               | Exit 0; explicit changeset check                                                                                                  |
| `git --no-pager diff --check`                                                                                                          | Exit 0                                                                                                                            |
| `git --no-pager diff --check 5973fc159aa4cf59f6ec289f719eb28d2f9a2ec8..HEAD`                                                           | Exit 0                                                                                                                            |

The baseline remains the execute worker's freshly recorded **696 passed / 2 skips**, plus overlapping focused history **19 passed / 244 exclusions**. All 15 new public-entry cases passed in verification; no new scoped failures occurred. Public RED-before-fix counts and exact commands remain in the preceding execution record and final handoff. Verification did not recreate historical RED runs. Build emitted existing unused external-import warnings for `createRequire` and `Readable`. Canonical template copying and its chained declaration guard were not reached; the separately executed fresh guard does not turn the failed packaging command into a pass. No unrelated build-script fix or global test run occurred. The known packaging limitation is retained, not a newly discovered regression or independent severity reassessment.

### Coverage, error paths and retained limits

- **SKEP1:** Six public cases cover authorization present/absent with failed/indeterminate cleanup after an existing-record checkpoint reports `record-not-found`, plus valid initial absence and malformed-read controls. Actual failure/revision/counts survive, initialization stays forbidden for checkpoint rejection, and release occurs exactly once. Maps FR-020/059-060/067-069 and CC-009/024/028-029/031/037.
- **SKEP2:** Four public cases cover executable add/remove failures in supplied and discovery modes. Earlier acknowledged signals survive; the retained discovery checkpoint keeps original retry identity and receives one final release after page failure. Errors remain sanitized. A throwing removal method can leave an adapter-owned listener: one removal attempt is verified, not arbitrary adapter cooperation. Maps FR-001/005-007/051-053/057-060/069 and CC-012/025/027-028/037.
- **SKEP3:** Two public cases cover shared-Date `t0,t0,t0+6000` against a 5,000 ms budget and seam mutation of caller time. Poll two is prevented, timestamps remain stable, and existing clock-read counts are retained. Maps FR-016-017/047-048 and CC-011/030.
- **ARC14-001:** Three public cases cover exact minimized validation keys, absent policy operands/submission IDs, zero injected effects and compile-time absence, plus private matching and authorized-admission controls. Fresh declarations retain request configuration and overloads but exclude prepared configuration from validation results. Maps FR-003/008/064/069, CC-032/036-037 and SEC-A05. The inherited specialist probe established contractual privacy nonconformance, not exploitable disclosure to another party; no new security-review claim is made.

The verification worker found no missing tests for the mapped bounded corrections. These 15 cases use public `src/index.ts` with in-memory fake ledgers, not physical-durability proofs. Separately rerun existing real-ledger tests cover persistence/reopen/concurrency. No coverage instrumentation or percentage claim is made. The two platform skips remain Linux-only production ledger lifecycle and the non-Windows production-filesystem 1,000-record listing benchmark. IDE/LSP tools were unavailable; text navigation, typecheck, tests and build were used without an IDE claim.

### ADV-01 amendment attempt - BLOCKED and still open

The orchestrator invoked `devsquad.refine` with `[AMEND]` for the explicitly approved historical-header wording/current-status links only. The refine worker returned **blocked without edits**: its amendment mode permits one spec section or one ADR per invocation, excludes `plan.md`, and requires traceability logging conflicting with the narrowly assigned three-file edit scope; it also reported no direct editing capability while nested agents were prohibited. This is a framework/tooling execution blocker, not missing user authorization, product-contract silence or a requirement to regenerate unchanged feature tasks.

No spec, plan or ADR change occurred. ADV-01 remains **OPEN**; any earlier statement that the parallel amendment was pending describes its then-current execution status, not a completed amendment. The required next action is an appropriately capable, narrowly scoped refinement path for those historical labels and links, preserving all decisions and Proposed ADR status. The orchestrator did not bypass the amendment boundary by editing these artifacts directly.

### Preservation, reasoning and parent handoff

Verification confirmed exactly 11 changed files, no out-of-scope edits, unchanged spec/plan/ADR-0026 and `final-review-evidence.json`, and only W046's checkbox reopened. The starting 223,509-byte log is an exact prefix of the verified 247,431-byte log; original W038 prefix SHA-256 remains `8211e975730800dbee1ae3845566b1b0a76f5f62d30b174e73225e620330d25d`. This verification record is appended without rewriting those bytes. The resulting documentation-only evidence commit changes overall HEAD/tree but preserves source tree `3d6ff0e8a00861c271ca6349852580b7b6b5ed12`.

- **Decision:** Preserve acknowledgements/provenance and own bounded snapshots rather than invent new admission, scheduling or delivery contracts. Confidence high within executed scenarios; understanding/scope explicitly approved by the caller.
- **Decision:** Stop with ADV-01 explicitly open rather than bypass refinement constraints. Confidence high in the returned blocker; no governance acceptance inferred.
- **Decision:** Keep scoped verification separate from independent review, packaging, global tests and publication. Confidence high in recorded command results, not exhaustive behavior. No further ADR decision or harness-learning capture is needed or authorized in this bounded continuation.

**W046 remains PENDING independent new-source review and parent deep re-review.** SKEP1-3 and ARC14-001 are locally remediated/tested, not independently closed. Historical technical PASS at source commit `9854e9ea5f739ee5ba8a605a97a7fd3569a9cce3` and evidence closure `5973fc159aa4cf59f6ec289f719eb28d2f9a2ec8` are retained, not reused as approval of current source. TB046-001-003 baseline Majors and TB001 Minor remain retained; canonical Windows packaging/global-suite limitations persist. Existing parent-reported PR21 head `aed663765a3a8bcc5864af34a000089961e4eaba` and normal fast-forward push denial 403 are unchanged inherited evidence. No remote/API/authentication attempt or new-source CI occurred. ADR-0025/0026 remain Proposed; preserve #20 before #21. No independent review, finalize, publication, deployment, merge, branch change or later slice was performed.
