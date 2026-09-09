# Review: DevSquad/ADO Workflow Watcher (slice 14)

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

## Re-review (2026-09-08, turn 2) — final pre-PR verdict

**Status**: PASSED — Critical 0, Major 0. Cleared for PR.

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
