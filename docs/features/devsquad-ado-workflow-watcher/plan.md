# DevSquad/ADO Workflow Watcher Implementation Plan

**Historical third-review follow-up (2026-09-10; superseded by final turn 4):** Critical RC14-008 caused a third independent FAILED verdict. History acknowledgement was remediated to use the same validator as direct checkpoint replay, against separately retained submitted-request metadata. W038 remained FAILED at that stage; remediation alone was not independent approval.

**Current recovery status (2026-09-10): W038 completed TECHNICAL only.** Final fresh independent `devsquad.review` turn 4 PASSED with no blockers (0 Critical, 0 Major, 1 nonblocking Minor TB001). W029-W037 are complete; all five guardians completed and the separate security specialist found no vulnerabilities. Original R14-001-007, RC14-001-008, SC-01/02, SL14-001, DOC14-001 and extras are closed/preserved; RC14-008 closure includes 36 independent public-pass probes. TB001's older-test internal guard/object-identity coupling is acknowledged, not a required fix. The second review's three Major/one Minor failures and all earlier review states remain historical in `review-log.md`. Fresh review commands are recorded separately from inherited ESM/DTS build evidence and the unchanged Windows postbuild failure; no fresh packaging success is claimed. ADR-0025/0026 remain Proposed pending authorized acceptance, with no linked board item or merge-ready claim. Publication is the parent's responsibility: #20 must merge before #21. After parent publication only, recommend updated #21 head `users/davidsant/symmetrical-train` as the next-slice base; slice 15 remains blocked until the creator explicitly decides.

### Approved discovery extension — slice 14 / #21

> For current implementation and review status, see [tasks](tasks.md) and [review evidence](review-log.md).

**Historical approval-checkpoint status:** Approved planning target; unimplemented and not independently reviewed at that checkpoint. D1-B, D2/D2-A and D3-A are approved requirements. The historical W038 technical PASS covers the supplied-candidate implementation and checkpoint-recovery contract only.

This extension follows [ADR-0026](../../adr/0026-devsquad-ado-workflow-watcher.md), as amended for discovery, and preserves [ADR-0025](../../adr/0025-devsquad-ado-workflow-ledger.md), [ADR-0024](../../adr/0024-devsquad-sandcastle-execution-adapter-boundary.md), and the existing ADR-0021/0022 integration boundaries. ADR filenames already referenced elsewhere in this plan remain authoritative; verify relative links against the existing directory when persisting.

ADR-0025 and ADR-0026 remain **Proposed**. No new ADR, persistence entity, ledger schema change, receipt eviction, storage-capacity change, sidecar, outbox, durable continuation, or pause marker is required.

#### Scope and authority

| Mode      | Responsibility                                                                                                                                                                                                          |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supplied  | Existing caller-supplied candidates and result shapes remain supported. Missing records remain `skipped / record-not-found`. Never initialize.                                                                          |
| Discovery | Traverse bounded host-injected pages, implement the complete configured matching semantics, and initialize eligible missing records only with explicit item-specific host authorization and exact initial phase/status. |
| Both      | Reuse existing claimed, fenced, revision/state-checked comment checkpointing and original-submission acknowledgement validation. Return intake; never dispatch execution.                                               |

The host owns live queries, transport, credentials, normalized facts, resolved team membership, scope stability, admission authorization, lifecycle meaning, and all tracker/PR/execution actions. Matching is not admission authorization; neither admission nor a ledger claim authorizes implementation.

No daemon, live network client, query builder, phase machine, external write, or execution-adapter behavior is added.

#### Public compatibility and implementation surfaces

Keep the existing supplied-mode exported interfaces and runtime result shapes:

- `RunDevSquadAdoWorkflowWatchPassOptions`
- `DevSquadAdoWatchIntakeSignal`
- `DevSquadAdoWatchPassResult`
- `DevSquadAdoWatchPassOutcome`
- `DevSquadAdoWatchValidatedPass`
- Existing supplied observation inputs/windows.

Add discovery-specific types and overload the existing `runDevSquadAdoWorkflowWatchPass` and `validateDevSquadAdoWorkflowWatchPassOptions`.

The request union is:

| Arm       | Required fields                                                                         | Forbidden fields |
| --------- | --------------------------------------------------------------------------------------- | ---------------- |
| Supplied  | Existing options; optional `mode: "supplied"`                                           | `discovery`      |
| Discovery | `mode: "discovery"`; existing common options; discovery seam; `discovery` configuration | `candidates`     |

Retain the legacy supplied overload, add a discovery overload returning `DevSquadAdoDiscoveryPassOutcome`, and add a union overload for callers holding the request union. Existing callers must not have to narrow newly introduced discovery signals.

Runtime preflight rejects unknown modes, mixed modes, missing discovery configuration, malformed required methods, and invalid configuration before clock, delay, seam, or ledger calls.

Discovery requires `initializeRecord`; supplied mode must not acquire this new preflight dependency. Existing structurally valid supplied fakes implementing the five currently used ledger methods continue working.

All new contracts receive JSDoc and root exports through `src/index.ts`. Keep the public API Effect-free and the orchestration plain `async`/`Promise`. These are in-process TypeScript contracts; no OpenAPI, AsyncAPI, or separate contract files are needed.

| Surface                                                 | Planned work                                                                                        |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/DevSquadAdoWorkflowWatcher.ts`                     | Compatible overloads; discovery configuration, seam, evidence, result and signal types.             |
| `src/DevSquadAdoWorkflowWatcherValidation.ts`           | Mode dispatch, captured dependencies, existing validation reuse, initialization operation identity. |
| `src/DevSquadAdoWorkflowWatcherDiscoveryValidation.ts`  | Bounded configuration/authorization/page preparation and fixed-field projection.                    |
| `src/DevSquadAdoWorkflowWatcherDiscoveryMatching.ts`    | Complete pure filter semantics and minimized evidence.                                              |
| `src/DevSquadAdoWorkflowWatcherDiscovery.ts`            | Invocation-local traversal, budgets, discovery scheduling and result assembly.                      |
| `src/DevSquadAdoWorkflowWatcherAdmission.ts`            | Authorized initialization state and fresh-only reporting.                                           |
| `src/DevSquadAdoWorkflowWatcherLedger.ts`               | Initialization-specific typed guard; preserve existing method guards.                               |
| `src/DevSquadAdoWorkflowWatcherObservation.ts`          | Discovery retention-loss handling; reuse controller/timer lifecycle.                                |
| `src/DevSquadAdoWorkflowWatcherPass.ts`                 | Reuse the existing-record step rather than fork weaker checkpoint/cleanup logic.                    |
| `src/index.ts`, `README.md`, existing watcher changeset | Public exports, mode/host contracts, examples and nonduplicate release documentation.               |

New filenames above are planned module boundaries, not an instruction to restructure unrelated implementation. Preserve existing operation identity bytes and supplied runtime behavior.

#### Transient data model

No new durable model is introduced.

| Model                            | Lifetime and contents                                                                                             |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Prepared discovery configuration | Private invocation snapshot of scope, policy, limits and bounded authorization declarations.                      |
| Discovery binding                | Scope ID, partition ID, stability ID and policy version.                                                          |
| Page request identity            | Private traversal ID, logical page ordinal and continuation.                                                      |
| Validated page                   | One bounded page of canonical identities and minimized matching decisions. Raw facts are released after matching. |
| Candidate state                  | First-discovery order, matching evidence, existing observation state or original pending initialization request.  |
| Initialization acceptance        | Validated fresh/replayed acceptance or explicit unconfirmed/none status.                                          |
| Workflow record and receipts     | Existing ADR-0025 structures, unchanged.                                                                          |
| Traversal summary                | Counts, terminal evidence and complete/incomplete reason; never a continuation.                                   |

Bound candidate and continuation sets. Do not retain pages of raw facts or claim secure memory erasure.

#### Discovery configuration and page seam

`DevSquadAdoWatchDiscoveryConfiguration` contains:

- `scope: { scopeId, partitionId, stabilityId, stableForInvocation: true }`
- `policy: DevSquadAdoDiscoveryMatchingPolicy`
- `limits: DevSquadAdoDiscoveryLimits`
- Optional bounded `authorizations`.

All binding labels are bounded, nonsecret host correlation identifiers. A policy version is evidence of the host-declared policy identity, not proof of integrity.

Prepare one immutable policy/configuration snapshot. Bind every page to the same scope, partition, stability ID and policy version. Never reread mutable caller policy between pages. The host must change its version when policy meaning changes and must supply a stable enumeration/fact view for the invocation. The library detects inconsistent declarations, not dishonesty by an arbitrary in-process adapter.

`DevSquadAdoWatcherDiscoverySeam` exposes:

- Required `discoverWorkItemsPage`.
- Required discovery-form `observeWorkItemComments`.
- Optional discovery-form `observePullRequestActivity`, required at candidate processing only when the durable record has a PR ID.

`discoverWorkItemsPage` receives:

```text
{
  binding: { scopeId, partitionId, stabilityId, policyVersion },
  traversalId,
  pageOrdinal,
  continuation: string | null,
  signal
}
```

It returns:

```text
{
  binding,
  traversalId,
  pageOrdinal,
  items: [{ workItemId, facts }],
  next:
    { kind: "terminal" }
    | { kind: "continue", continuation: string }
}
```

Generate a private invocation-local traversal ID, separate from pass identity, admission identity and claim capabilities. It is correlation—not authority. The first request always uses ordinal `1` and continuation `null`.

Continuations are nonempty bounded opaque strings, passed back verbatim and compared only for repetition. Never parse, sort, expose, persist, or incorporate them into mutation identifiers.

Validate the complete page—including identity, required facts, binding, request identity, continuation, global duplicates and every bound—before any item effect. A malformed last entry invalidates the whole page, including otherwise valid earlier entries.

An empty continued page consumes a page call and continues. Only explicit terminal evidence ends enumeration.

#### Complete matching contract

Use a bounded discriminated filter list so unsupported operators can be rejected through fixed-field inspection without enumerating arbitrary policy objects.

`DevSquadAdoDiscoveryMatchingPolicy` is:

```text
{
  version: string,
  filters: readonly DevSquadAdoDiscoveryFilter[]
}
```

Supported filter arms:

| Dimension   | Operator             | Operand                                  |
| ----------- | -------------------- | ---------------------------------------- |
| `state`     | `one-of`             | Nonempty `values`                        |
| `team`      | `one-of`             | Nonempty `values`                        |
| `tags`      | `all`                | Nonempty `values`; represents `tagsAll`  |
| `tags`      | `any`                | Nonempty `values`; represents `tagsAny`  |
| `tags`      | `none`               | Nonempty `values`; represents `tagsNone` |
| `area`      | `exact` or `subtree` | `segments`                               |
| `iteration` | `exact` or `subtree` | `segments`                               |

Allow at most one state, team, area and iteration predicate, and at most one of each tag operator: **seven predicates maximum**. An empty filter list is unrestricted. Unknown dimensions/operators and duplicate predicate slots are configuration errors before injected effects.

Facts have fixed optional fields `state`, `teams`, `tags`, `area`, and `iteration`. A required fact is either `{ kind: "known", value }` or `{ kind: "missing" }`; omission also means missing. State values are strings; the remaining values are bounded string arrays, with area/iteration representing normalized segments.

Semantics:

1. AND all configured dimensions and tag predicates.
2. State matches any allowed state.
3. Host-resolved team membership matches any allowed team.
4. Tags require all, any, or none of their configured values as selected.
5. Exact paths require identical segment counts and values.
6. Subtrees require the filter’s complete segment prefix, including the root itself—not a textual-prefix sibling.
7. A zero-segment path represents the root; root subtree matches every known path.
8. Compare values exactly and case-sensitively. Do not trim, fold case, normalize Unicode, infer synonyms, split separators, or infer teams from `assignedTo`.
9. Work-item IDs alone retain existing ledger canonicalization.
10. Configured sets must be nonempty. Reject duplicate set members rather than silently deduplicating.
11. Known empty collections are valid facts, not missing facts. Empty tags satisfy `none` but fail nonempty `all`/`any`; empty teams fail a configured team predicate.
12. Do not access fact getters for unconfigured dimensions.
13. Unknown unrelated response properties are not read.

Use fixed-field access and bounded indexed traversal, not object spreads, whole-response serialization, or custom iterators. Validate array lengths before traversal and detect changes during indexed reads. Reject malformed required fact structures at page level; valid missing facts pause only their candidate.

Evaluate required facts before privacy projection and before ledger reads, authorization use, observation or mutation for the page. An upstream `eligible` boolean or query filter is never a substitute for library matching.

Evidence contains:

```text
{
  policyVersion,
  decision: "matched" | "excluded" | "facts-missing",
  predicates: [
    {
      predicate:
        "state" | "team" | "tags-all" | "tags-any" |
        "tags-none" | "area" | "iteration",
      outcome: "matched" | "unmatched" | "missing"
    }
  ]
}
```

Evaluate evidence in the order shown. Missing required facts take reason `matching-facts-missing`; otherwise an unmatched predicate takes `matching-paused`. Evidence contains no raw operands/facts, expected/actual values, authorization IDs, capabilities, policy hashes or continuation tokens.

#### Explicit bounds

Require a complete limits declaration. Export documented default values; hosts may override within these ceilings.

| Limit                   |   Default |   Ceiling |
| ----------------------- | --------: | --------: |
| `maxPageCalls`          |        32 |     1,000 |
| `maxItems`              |     1,000 |     1,000 |
| `maxEntriesPerPage`     |       128 |     1,000 |
| `maxCollectionValues`   |       128 |     1,024 |
| `maxPathSegments`       |        32 |       128 |
| `maxOpaqueValueBytes`   |     1,024 |     4,096 |
| `maxContinuationBytes`  |     4,096 |    16,384 |
| `maxPolicyBytes`        |    65,536 |   262,144 |
| `maxPageBytes`          | 1,048,576 | 4,194,304 |
| `maxAuthorizationBytes` |   262,144 | 1,048,576 |

Additional fixed bounds:

- Seven policy predicates.
- 1,000 authorization declarations.
- 256 UTF-8 bytes per scope/partition/stability/policy-version/submission identifier.
- Existing 120-byte canonical work-item IDs and 256-byte phase/status limits.
- Existing observation-window and ledger limits remain unchanged.

All limits are positive safe integers. Actual collections may be empty where semantics permit.

Individual string sizes use actual UTF-8 bytes. Aggregate limits count a documented canonical JSON encoding of recognized fields, including keys, punctuation, discriminators, escaping and request/binding metadata. Page bytes include required fact representations and continuation; unconfigured fact values and unrelated properties are neither read nor counted.

Count incrementally without constructing an oversized serialized projection. Reject ill-formed Unicode in new discovery strings; preserve existing canonicalization rules for legacy IDs. Check inexpensive string-length bounds before encoding and collection lengths before copying/iteration.

Exact limits are inclusive. Test `N`/`B` and `N+1`/`B+1`, including multibyte and escaped strings. Limits apply conjunctively. No truncation, deduplication or partial-page acceptance creates apparent success.

These are library processing/retention bounds—not guarantees about allocations already performed by an injected host.

#### Authorized initialization and idempotency — D1-B

Authorization declarations are a bounded per-item union:

```text
{
  workItemId,
  kind: "authorized",
  submissionId,
  initial: { phase, status }
}
|
{
  workItemId,
  kind: "unavailable",
  reason: "not-authorized" | "initial-state-missing"
}
```

Canonicalize IDs and reject duplicate declarations during preflight. Missing declarations mean unauthorized. Malformed authorized declarations fail preflight; explicit unavailable declarations yield stable candidate dispositions. Neither initializes.

Initialize only after:

1. Whole-page validation and matching.
2. A guarded read returns a method-valid `record-not-found`.
3. An explicit declaration authorizes that canonical item with exact initial phase/status.
4. A fresh cancellation gate permits the mutation.

Submit only:

```text
{ workItemId, operationId, phase, status }
```

Leave all optional cursor, PR, execution, history and claim fields absent.

Derive initialization identity from canonical serialization of:

```text
{ step: "initialize", workItemId, submissionId, phase, status }
```

Use the existing bounded `dsw2.<step>.<hash>` convention with an initialization-specific step. Keep checkpoint and claim-lifecycle identity arms and generated bytes unchanged. Provide a discovery-specific identity extension/helper rather than forcing existing supplied identity consumers to handle new arms unnecessarily.

Initialization identity does not depend on page token, traversal ID, capability, claim epoch or `passId`. The same authorized submission must reproduce its identity across invocations. Preserve the original request across retries; never refresh it from later facts or mint another identity to evade conflict.

Extend `DevSquadAdoWorkflowWatcherLedger.ts` with an actual initialization-specific guard:

- Capture the method only for discovery preparation.
- Keep original submission, validation snapshot, adapter request copy and projected response separate.
- Reject relevant adapter request mutation.
- Validate every known error variant; malformed variants, unknown categories, throws and rejections become only `ledger-fault`.
- Validate the complete bounded latest public record.
- Require canonical item identity, initialized discriminator, accepted revision `1`, canonical accepted timestamp and boolean replay metadata.
- Require creation time to match initialization acceptance.
- At latest revision one, require exact initial phase/status and the pristine initialization shape: null optional references/cursors, empty histories, no active claim and fencing counter zero.
- For a valid later record, do not require current revision/state/references/claims to equal the revision-one snapshot. Validate initial workflow state through the first retained checkpoint’s `previous` state, or current state when no checkpoint exists, while validating the retained checkpoint chain.
- Do not interpret initialization success as claim acquisition.

The current common nonreplayed-acknowledgement restriction must not accidentally prevent an initialization acknowledgement from carrying a valid later record. Add a method-specific branch; do not weaken existing checkpoint/claim/release checks.

The initialized public outcome does not echo an operation ID or receipt digest. Binding relies on the independently retained request and the trusted ledger’s existing receipt/publication semantics, not fabricated response fields or a claim of cryptographic proof.

Existing ledger behavior already supplies the required race guarantees: one publishing winner is fresh; matching retries replay; different initialization loses with already-exists; conflicting receipt identity is terminal. **No storage change is required.**

| Outcome                                            | Accounting/reporting                                                                      |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Fresh valid acceptance; initial intake rules match | Acknowledge admission and return one discovery signal.                                    |
| Fresh valid acceptance; rules do not match         | Acknowledge admission without signal; not a suppressed cursor advance.                    |
| Valid replay                                       | Report original acceptance for reconciliation; no discovery signal.                       |
| Already exists                                     | Stable already-recorded disposition; infer no accepted revision for this request.         |
| Idempotency conflict                               | Terminal failure; no replacement identity.                                                |
| Contention/storage-indeterminate                   | Retain original request for bounded retry; infer no acceptance.                           |
| Definite rejection                                 | Stable failed disposition.                                                                |
| Throw/rejection/malformed acknowledgement          | `failed / ledger-unavailable`, category `ledger-fault`; no inferred acceptance or signal. |

A retry may signal only if it genuinely receives a valid fresh acceptance as the first publisher—not by reconstructing an earlier ambiguous acceptance. Replay, restart reads and existing records cannot reconstruct discovery delivery.

Once an item enters initialization processing, it never switches to comment observation during that invocation, including after replay/already-exists. Genuine comment observation occurs on a later invocation.

Initialization cleanup is always `not-required / no-claim-acquired`, with null cleanup category/revision, including uncertain acknowledgement. This proves absence of acquisition, not initialization success or failure.

Durable initialization without a usable acknowledgement, or a crash before consumption, can permanently lose intake. This is deliberate at-most-once delivery, not lossless delivery, exactly-once execution or downstream exclusivity.

#### Pause and anchored reentry — D2-A

Excluded or fact-incomplete candidates receive skipped/paused dispositions and zero comment/PR calls or ledger mutations. No pause marker is persisted.

A later eligible invocation resumes from the existing durable anchors. Add discovery-specific observation return unions:

```text
Work item:
  { kind: "window", commentIds }
  | { kind: "anchor-missing" }

Pull request:
  { kind: "window", entries }
  | { kind: "anchor-missing" }
```

Inputs retain the existing durable `since` anchors. `window` retains existing bounded, unique, anchor-inclusive semantics.

Known retention loss must use `anchor-missing`, including otherwise empty responses. It yields `observation-anchor-missing` and no cursor advancement. A loss response when no anchor was supplied is invalid. Loss in either observation kind prevents checkpointing the other kind.

Ordinary discovery empty windows mean known no-new-events. Supplied-mode empty windows remain unchanged.

Matching pause differs from phase/status suppression: otherwise eligible existing records still checkpoint new cursors when intake rules suppress their signal.

#### Traversal, polling and cancellation — D3-A

Use one invocation-local traversal, not a restarted traversal on every poll:

1. Validate and snapshot configuration before effects.
2. Preserve the existing start-clock read and one clock reading per poll.
3. Process prior pending candidates in stable first-discovery order.
4. Initiate at most one new page call per poll while traversal and scheduling permit.
5. Validate the whole page, then process its candidates sequentially in canonical UTF-8 work-item order.
6. Never process the same candidate twice in one poll.
7. Resolved items on a nonterminal page do not complete traversal.
8. After terminal evidence, ordinary no-new-event states can finalize after their observation attempt; only genuine pending mutation/recovery work requires additional polls.
9. Complete only after explicit terminal evidence and dispositions for all accepted items, with no unfinished retry work.

Hosts must provision both poll and page budgets for this scheduling policy. Page failures/timeouts end traversal explicitly; no hidden page retry loop is introduced. Candidate retries retain the same invocation counters.

Increment `pageCalls` immediately before actual invocation. Empty, failed and timed-out calls count. A terminal page on the last permitted call may complete; a continuation on that call is incomplete.

If a page exceeds the remaining item budget, contains any canonical duplicate across the traversal, repeats a continuation, or changes binding/request evidence, reject that whole page before its item effects. Preserve earlier outcomes and accepted writes.

At exactly the item limit, only additional empty pages can establish terminal completion without overflow. Do not infer terminality from a full budget.

Every invocation starts with null continuation. Bounded prefix rescans provide no eventual tail-progress guarantee; hosts must choose a partition that fits their bounds.

Fresh cancellation checks precede page calls, candidate effects, comment/PR calls and every non-cleanup mutation. Recheck after page settlement before effects, between candidates, after awaited ledger operations, and before completion/budget exits.

Reuse dedicated child controllers, timers and listener retirement for page calls. Quarantine late settlements and consume late rejections. Await in-flight ledger operations, validate acknowledgements, and preserve their permitted signals even when abort occurs during the write.

Existing claims retain exactly-once cleanup attempts for validated authority after abort. Initialization never creates a release obligation.

Poll/time limits bound scheduling. Cancellation remains cooperative; settling ledger/delay dependencies remain a liveness prerequisite.

#### Results and accounting

Keep supplied results unchanged. Discovery returns its own `ok` envelope and result with `mode: "discovery"`.

Discovery signal union:

| Discriminator         | Fields                                                                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `comment-observation` | Existing comment signal fields plus this discriminator.                                                                                              |
| `discovery-admission` | Canonical item ID, `acceptedInitializationRevision: 1`, exact initial phase/status, minimized matching evidence, `authorization: "host-authorized"`. |

Discovery-admission signals contain no `changedKinds`, source revision, comment checkpoint or claim metadata.

Discovery candidate outcome union:

- `category: "observation"` — existing candidate outcome plus matching evidence.
- `category: "admission"` — identity, stable kind/reason, evidence, acceptance and no-claim cleanup.
- `category: "matching"` — skipped/paused reason, evidence and no-claim cleanup.
- `category: "unprocessed"` — validated discovered identity, explicit scheduling-stop reason and no-claim cleanup.

Admission acceptance is:

```text
{ kind: "fresh" | "replayed", acceptedRevision: 1, acceptedAt }
| { kind: "unconfirmed" }
| { kind: "none" }
```

Stable admission/matching reasons include:

- `admission-accepted`
- `admission-intake-rules-unmatched`
- `admission-replayed`
- `admission-already-recorded`
- `admission-not-authorized`
- `admission-initial-state-missing`
- `initialization-indeterminate`
- `matching-paused`
- `matching-facts-missing`
- `discovery-not-processed`

Reuse existing validated ledger failure reasons/categories where applicable rather than returning arbitrary dependency text.

Traversal status is either:

- `complete / terminal-page`
- `incomplete` with one of `page-budget-exhausted`, `item-budget-exhausted`, `poll-budget-exhausted`, `poll-start-budget-exhausted`, `page-failed`, `page-timeout`, `invalid-page`, `duplicate-item`, `repeated-continuation`, `unstable-scope`, or `cancelled`.

Expose `terminalPageSeen` separately. Terminal evidence does not erase unfinished retry work or cancellation. Discovery stop reasons retain existing cancellation/poll-budget reasons and add `discovery-incomplete` for traversal-specific failures; `completed` requires complete traversal and finalized dispositions.

| Count                    | Meaning                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------ |
| `pageCalls`              | Every initiated page call.                                                           |
| `pagesValidated`         | Whole pages accepted.                                                                |
| `discovered`             | Distinct canonical IDs accepted from validated pages.                                |
| `evaluated`              | IDs whose library matching evaluation completed.                                     |
| `admitted`               | Fresh validated initialization acceptances, with or without intake.                  |
| `paused`                 | Matching-excluded/fact-incomplete IDs.                                               |
| `processed`              | IDs receiving a processed disposition, excluding synthetic unprocessed finalization. |
| `initializationReplayed` | Validated replay acknowledgements, not new admissions.                               |
| `acted`                  | Returned signals of either type.                                                     |
| `eligible`               | Existing new-observation eligibility meaning; do not redefine as policy matching.    |
| `suppressed`             | Acknowledged suppressed cursor advances only.                                        |
| `failed`                 | Final failed candidates; may overlap acknowledged actions.                           |

Cleanup counts partition all returned candidate outcomes. Rejected-page IDs do not become apparently processed/discovered outcomes. Earlier validated outcomes remain visible. Complete traversal may contain failed or skipped candidates.

Outcome order follows page order and page-local canonical order. Signal order follows acknowledgement order. No global sorting guarantee is made across different page partitions.

#### Historical recovery invariants

Discovery existing-record processing must preserve:

- Exact cursor-generation checkpoint identity.
- Independent random capability and acquisition epoch.
- Original submitted checkpoint request separate from refreshed retry revision.
- History inspection before retry-precondition refresh.
- One acknowledgement validator for direct/replay/history acceptance.
- Original accepted checkpoint revision equal to original expected revision plus one.
- Valid later-record handling without confusing current state with historical acceptance.
- Terminal idempotency conflicts.
- Staleness checks after acquisition.
- Exactly-once cleanup attempts and retention of acknowledged effects.

Do not generalize checkpoint-history recovery into admission replay delivery. Do not weaken comment recovery to admission’s fresh-only rule.

#### Architectural security controls

Architectural assessment: **APPROVED_WITH_CONTROLS**, no substantiated design blocker. This is not implementation approval.

| Control | Implementation obligation                                                                                                                |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-A01 | Bind canonical-item admission to explicit immutable host authorization and exact state; supplied never initializes.                      |
| SEC-A02 | Initialization-specific original-request/acknowledgement guards; fresh-only delivery; no fabricated authority.                           |
| SEC-A03 | Bounded owned page snapshots and whole-page validation before effects.                                                                   |
| SEC-A04 | Complete exact matching, no inferred teams, preserved anchors and explicit retention loss.                                               |
| SEC-A05 | Allowlisted evidence; no raw facts, policy contents, continuations, capabilities or transport error text in results/storage/diagnostics. |
| SEC-A06 | Stable binding, bounded calls/items/bytes, duplicate/cycle rejection and honest incompletion.                                            |
| SEC-A07 | Fresh cancellation gates, retired seam lifecycles, awaited ledger operations and truthful cleanup.                                       |

Injected adapters are not sandboxed. Validation cannot prove that an arbitrary adapter truthfully represents tracker state or persisted data. Existing host/ledger trust and filesystem protections remain prerequisites.

#### Ordered implementation tasks for decompose

These are future vertical tasks. Decompose assigns final task IDs and updates `tasks.md`; do not relabel historical W001–W038 or claim these are complete.

Every task includes public-behavior tests before implementation and a green-test checkpoint. Do not postpone its guards, privacy or cleanup obligations to a final hardening task.

| Order | Vertical task                                                                                                                                               | Acceptance                                                                                                                                                                         |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Compatible discovery mode and empty terminal pass: overloads, exports, mode preflight, bounded configuration, page lifecycle and complete zero-item result. | Supplied compile/runtime compatibility; zero-effect failures; empty terminal success; cancellation/timeout cleanup.                                                                |
| 2     | One-page discovery of existing records with complete matching and minimized evidence. Reuse the existing-record step.                                       | Full predicate matrix, missing-versus-empty facts, paused zero effects, unknown operators, full-page validation and existing checkpoint controls.                                  |
| 3     | Authorized no-comment first admission end to end, including initialization guard and operation identity.                                                    | Fresh/replay/already-exists/conflict, rules-unmatched acceptance, concurrency, original-request mutation, malformed durable acknowledgement, no-claim cleanup.                     |
| 4     | Discovery retention evidence and anchored pause/reentry.                                                                                                    | Cursor `480` preserved while `481` arrives; reentry from `480`; empty/nonempty anchor loss; unchanged supplied empty behavior.                                                     |
| 5     | Multi-page traversal with retained candidate state and all scheduling/resource budgets.                                                                     | Empty continued pages, page-local ordering, cross-page duplicates, token cycles, binding drift, exact item limit, incomplete prefix with prior effects retained.                   |
| 6     | Integrated restart/retry/cancellation conformance and truthful result accounting across both action types.                                                  | Lost acknowledgement/reopen, same submission across pass IDs, cancellation during initialization/checkpoint, later-page failure, count partitions and at most one signal per item. |
| 7     | Public documentation/release alignment and independent extension verification.                                                                              | README/JSDoc/examples, existing changeset deduplication, full regression/dependency/declaration checks, fresh review evidence separate from historical W038 evidence.              |

Suggested new public-entry-point suites: discovery, matching, admission, bounds, and lifecycle test files under the established watcher filename prefix. Reuse isolated real-ledger fixtures for durability/races and recording injected fakes for boundary failures. Do not extend historical TB001 private-guard/object-identity coupling.

#### Targeted acceptance matrix

| Spec tests | Required cases                                                                                                                                                                                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TEST-033   | Authorized item `999` with no comments; missing authorization/state; initialization-only zero observation/claim/checkpoint/release; same/different submission races; replay with later record; request mutation; lost/malformed acknowledgement; restart; stable identity; terminal conflict; no same-pass comment processing. |
| TEST-034   | Dimension AND; state/team OR; all/any/none tags; invalid empty/duplicate configurations; exact case/whitespace/Unicode distinctions; segment paths/root/prefix sibling; no `assignedTo` inference; missing versus empty; unconfigured throwing getters untouched; redacted evidence.                                           |
| TEST-035   | Pause at `480`, event `481`, reentry from `480`; explicit empty retention loss; nonempty missing anchor; PR loss blocks partial checkpoint; supplied empty control; phase/status suppression advances while matching pause does not.                                                                                           |
| TEST-036   | Items `137`/`138` across pages; empty continuation; terminal-only completion; canonical page ordering; no early completion; one traversal across polls; reopen starts with null continuation; no persisted traversal metadata.                                                                                                 |
| TEST-037   | Page budget two; failed/empty calls count; terminal on final call versus continuation; 1,000/1,001 items; within/across-page canonical duplicates; token cycles; scope/policy/request drift; retained earlier intake; complete traversal with failed/paused candidates.                                                        |
| TEST-038   | Every numeric ceiling and exact/+1 boundary; multibyte/escaped aggregate bytes; count-before-copy; changing/sparse collections; malformed last entry blocks whole-page effects; oversized preflight has zero calls; inherited ID/window/ledger limits unchanged.                                                               |
| TEST-039   | Abort at each scheduling/effect boundary; page/observation late settlement and listener/timer retirement; abort during initialization preserves acknowledged acceptance; all initialization guard variants; supplied fake without initializer; secret sentinels absent from outputs/submissions; no fabricated releases.       |

Preserve existing focused suites:

```text
DevSquadAdoWorkflowWatcher.test.ts
DevSquadAdoWorkflowWatcher.concurrency.test.ts
DevSquadAdoWorkflowWatcher.bounds.test.ts
DevSquadAdoWorkflowWatcher.recovery.test.ts
DevSquadAdoWorkflowWatcher.remediation.test.ts
DevSquadAdoWorkflowWatcher.dependencies.test.ts
DevSquadAdoWorkflowLedger.test.ts
DevSquadAdoWorkflowLedger.concurrency.test.ts
```

Retain the 19 focused historical history regressions and original-request contradiction probes. Historical test totals are not new verification evidence.

#### Requirement traceability

| Requirements          | Task(s)  | Verification                                                                                                                                    |
| --------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-001–004, 008       | 1        | Legacy overloads, mode preflight, exports, zero-effect validation; inherited TEST-001/025/027/032 plus TEST-038/039.                            |
| FR-005–007            | 1–6      | Discriminated outcomes, independent counts and isolation; TEST-033/037/039.                                                                     |
| FR-009–015            | 1–2, 4–5 | Read-only seams, opaque identities, per-poll limits, optional PR; inherited seam/dependency tests plus TEST-035/036/039.                        |
| FR-016–019, 023–024   | 2, 5     | Pure matching, canonical page ordering and clock/backoff behavior; TEST-034/036.                                                                |
| FR-020–022            | 2–3      | Supplied missing-record control, foreign-claim gate, distinct comment/admission eligibility; TEST-033 plus inherited TEST-008/015.              |
| FR-025–031            | 2–3, 6   | Claim-free creation exception; unchanged existing-record fencing/renewal/cleanup; TEST-033/039 plus inherited claim suites.                     |
| FR-032–035, 035a/035b | 2, 4–5   | Cursor-only patches, PR completeness, uniqueness/bounds and anchor loss; TEST-035/038 plus inherited TEST-022/028.                              |
| FR-036/036a           | 2–3, 6   | Durable-before-signal and acquisition staleness; TEST-033/039 plus inherited TEST-009/031.                                                      |
| FR-037/037a–039       | 3, 6     | Initialization submission identity; unchanged checkpoint/epoch identities and terminal conflicts; TEST-033/039 plus history/replay regressions. |
| FR-040–043            | 2–4      | Host lifecycle authority; exact intake rules; suppression versus pause; TEST-033/034/035.                                                       |
| FR-044–046            | 3, 6     | Compatible comment signal, distinct admission signal, one signal/item and initialization ends step; TEST-033/039.                               |
| FR-047–050            | 5–6      | Terminal traversal, budgets, clock and backoff; TEST-036/037 plus existing bounds suite.                                                        |
| FR-051–053            | 1–6      | Cancellation, awaited acknowledgements and isolated seam lifecycle; TEST-039 plus inherited lifecycle regressions.                              |
| FR-054–058            | 2–3, 5–6 | Ledger error isolation, public operations only, durable prior effects and redaction; TEST-033/037/039 plus recovery suite.                      |
| FR-059–060            | 3, 6     | Full initialization guards and truthful no-claim cleanup; retained guards/history tests plus TEST-033/039.                                      |
| FR-061–062            | 1, 5     | Host binding, explicit mode, fresh start and no durable traversal state; TEST-036/039.                                                          |
| FR-063–064            | 1–2, 5   | Whole-page validation and inclusive call/item/collection/UTF-8 bounds; TEST-037/038.                                                            |
| FR-065                | 2        | Complete library matching; TEST-034.                                                                                                            |
| FR-066                | 2, 4     | Sensitive preprojection, pause and anchored reentry; TEST-034/035/039.                                                                          |
| FR-067–068            | 3, 6     | Explicit authorized state and fresh-only lossy admission; TEST-033/039.                                                                         |
| FR-069                | 1–6      | Evidence, cancellation, acknowledgement validation and cleanup; TEST-033/034/037/039.                                                           |

Extend conformance verification through CC-031–037 and success criteria SC-011–014. Preserve inherited CC-001–030 and SC-001–010. The retained baseline below supplies the detailed shared algorithms and original conformance cases.

#### Commands

Run from:

```powershell
Set-Location "C:\repos\copilot-worktrees\sandcastle\users-davidsant-expert-garbanzo"
```

Build:

```powershell
npm run build
```

Tests:

```powershell
npm test -- DevSquadAdoWorkflowWatcher
npm test -- DevSquadAdoWorkflowWatcher DevSquadAdoWorkflowLedger
npm test -- DevSquadAdoWorkflowWatcher.remediation -t "third independent history"
npm test
```

Type checking and public declarations:

```powershell
npm run typecheck
node scripts/check-public-types-effect-free.mjs
```

The declaration check consumes generated `dist` output; it is not evidence of freshly generated declarations when run alone.

Formatting and diff validation:

```powershell
npm run format:check
git diff --check
```

Local execution: this feature is an injected package API, not a daemon. Exercise it through:

```powershell
npm test -- DevSquadAdoWorkflowWatcher.discovery
```

These commands are for later implementation verification and were not run during planning. Preserve the historical Windows postbuild limitation: ESM/DTS generation is not packaging success when the unchanged shell-based postbuild fails. Production Windows ledger permission support remains governed by ADR-0025; tests may use the existing trusted portable test platform, not a production bypass.

#### Reasoning and handoff

- **Chosen:** Compatible overloads; bounded discriminated filter list; item-specific authorization declarations; existing initialization receipts; fresh-only discovery intake; explicit retention-loss responses; fresh traversal with local continuation.
- **Why:** Satisfies approved D1-B/D2/D2-A/D3-A without transferring host authority, weakening guards, or changing durable storage.
- **Rejected:** Boolean-only upstream eligibility; inferred team/state authorization; synthetic cursors; replay delivery reconstruction; durable page continuation/outbox; global page-independent sorting; live clients/daemons.
- **Accepted costs:** Sensitive facts require bounded transient processing; first-admission delivery can be permanently lost; insufficient partitions repeatedly rescan a prefix; dependency cancellation remains cooperative.
- **Security obligations:** SEC-A01–SEC-A07 are requirements of the vertical tasks.
- **Next phase:** Decompose the ordered tasks after these plan/ADR edits are persisted. Do not begin implementation in the planning phase.

Keep `spec.md` as the approved source of truth and historical review evidence unchanged. No standalone research/model/tracking files are necessary; this plan contains the decisions, transient model, contracts and traceability.

## Retained supplied-candidate baseline

The remaining sections preserve the supplied-candidate design and historical implementation handoff. Their supplied-only candidate, initialization, seam, signal and completion statements apply to supplied mode—not to discovery. Shared observation, fencing, checkpoint-recovery and cleanup invariants remain mandatory for discovery existing-record processing. The approved extension above defines the discovery-specific contracts and current decomposition work.

### Summary

Implement one bounded, offline, deterministic watch pass that turns injected ADO/GitHub observations into durably checkpointed intake signals for a DevSquad host.

The watcher is a pure consumer of the slice-13 ledger (`openDevSquadAdoWorkflowLedger`). It reads records, evaluates eligibility, acquires a fenced claim only when it intends to mutate, advances opaque observation cursors through ledger checkpoints, and returns token-free per-candidate outcomes plus at most one intake signal per candidate.

The implementation follows [ADR-0026](../../adr/0026-devsquad-ado-workflow-watcher.md) and preserves ADRs 0021, 0022, 0024, and 0025. It introduces no persistence format, no schema change, and no network-capable dependency.

### Architectural Boundary

#### DevSquad and host responsibilities

- Choose the candidate set for each pass; the watcher never discovers work items.
- Initialize ledger records before a candidate can be acted on.
- Define phase and status meaning and supply exact-match intake rules.
- Supply a stable pass identity so an ambiguous pass can be retried with replay parity.
- Implement the observation seam, including its ordering contract, credentials, and transport.
- Interpret intake signals, decide transition legality, and schedule execution.
- Perform every external tracker write and every pull-request action.

#### Watcher responsibilities

- Structurally validate inputs and the injected seam before any observation or mutation.
- Read the durable record and evaluate eligibility as a pure function of injected inputs.
- Select new events relative to persisted cursors using the seam's authoritative ordering.
- Acquire, renew, and release ledger claims around its own mutations only.
- Persist opaque cursors through fenced, revision-checked, idempotent checkpoints.
- Emit intake signals only when caller intake rules match the record's exact phase and status.
- Bound poll scheduling and observation windows and request cooperative cancellation. Ledger calls and delays must settle; observation timeout assumes a valid delay. Neither poll limits nor abort impose an unconditional runtime or physical-request bound.
- Report stable outcome kinds, reason codes, counts, and stop reasons.

#### Explicit non-responsibilities

The watcher will not import or invoke ADO, GitHub, MCP, HTTP, CLI, git, agent, sandbox, shell, scheduler, team-runner, feedback-loop, or execution-adapter implementations.

It will not define a phase allowlist, phase order, transition table, terminal state, or resumability policy. It will not initialize, repair, reset, or rewrite ledger artifacts. It will not write to the external tracker.

### Implementation Surfaces

#### New source files

| File                                                  | Responsibility                                                                                                                           |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `src/DevSquadAdoWorkflowWatcher.ts`                   | Effect-free public contracts, seam types, `runDevSquadAdoWorkflowWatchPass`, and JSDoc.                                                  |
| `src/DevSquadAdoWorkflowWatcherValidation.ts`         | Input and seam structural validation, normalization, canonical candidate ordering, operation-identifier derivation, backoff computation. |
| `src/DevSquadAdoWorkflowWatcherObservation.ts`        | Seam invocation with per-observation timeout, response projection to opaque identifiers, cursor anchoring, new-event selection.          |
| `src/DevSquadAdoWorkflowWatcherPass.ts`               | Poll loop, per-candidate step machine, claim lifecycle, checkpointing, cancellation, stop reasons, counts.                               |
| `src/DevSquadAdoWorkflowWatcher.test.ts`              | Validation, seam contract, happy path, replay, determinism, intake rules, missing record, PR cursor completeness, public surface.        |
| `src/DevSquadAdoWorkflowWatcher.concurrency.test.ts`  | Claim conflict, fencing, renewal, release hygiene, idempotency, revision/state conflicts.                                                |
| `src/DevSquadAdoWorkflowWatcher.bounds.test.ts`       | Poll budget, poll-start elapsed budget, deterministic backoff, cancellation points, observation timeout.                                 |
| `src/DevSquadAdoWorkflowWatcher.recovery.test.ts`     | Corrupt and unsupported-schema isolation, candidate isolation, capacity categories, restart safety.                                      |
| `src/DevSquadAdoWorkflowWatcher.dependencies.test.ts` | Static offline dependency assertion and Effect-free public contract assertion.                                                           |
| `src/DevSquadAdoWorkflowWatcherTestSupport.ts`        | Recording seam fake, deterministic clock, recording delay source, ledger fixture and seeding helpers.                                    |

#### Modified files

| File                                          | Change                                                                                                |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/index.ts`                                | Export the watch-pass operation, validation helper, and Effect-free public watcher contracts.         |
| `README.md`                                   | Document the watch pass, seam contract, pass identity, intake rules, budgets, and lifecycle boundary. |
| `.changeset/devsquad-ado-workflow-watcher.md` | One nonduplicate minor changeset for the new public feature.                                          |

No new subpath export is required. Public imports continue through `@ai-hero/sandcastle`.

#### Runtime style

Plain `async`/`Promise` TypeScript, matching `AdoFeedbackLoop.ts` and `DevSquadSandcastleExecutionAdapter.ts`. Effect is not introduced: the watcher owns no filesystem, no process, and no resource scope; it orchestrates injected promise-returning seams and the ledger's promise API. This keeps the public declaration Effect-free by construction.

### Public API

All public functions, interfaces, and properties receive JSDoc. No public declaration may import `effect` or `@effect/*`.

#### Result and error envelope

```ts
export type DevSquadAdoWatchPassOutcome =
  | { readonly ok: true; readonly value: DevSquadAdoWatchPassResult }
  | { readonly ok: false; readonly error: DevSquadAdoWatchError };

export type DevSquadAdoWatchError =
  | {
      readonly kind: "validation";
      readonly field: string;
      readonly reason: string;
    }
  | {
      readonly kind: "seam-contract";
      readonly method: DevSquadAdoWatcherSeamMethodName;
      readonly reason: "missing" | "not-a-function";
    };

export type DevSquadAdoWatcherSeamMethodName =
  | "observeWorkItemComments"
  | "observePullRequestActivity";
```

`ok: false` is reserved for failures detected before any observation or mutation. Cancellation, budget exhaustion, and every per-candidate failure resolve as `ok: true` with a stop reason and complete outcomes.

#### Observation seam

```ts
export interface DevSquadAdoWatcherObservationSeam {
  readonly observeWorkItemComments: (
    input: DevSquadAdoWatcherWorkItemObservationInput,
  ) => Promise<DevSquadAdoWatcherWorkItemObservation>;
  readonly observePullRequestActivity?: (
    input: DevSquadAdoWatcherPullRequestObservationInput,
  ) => Promise<DevSquadAdoWatcherPullRequestObservation>;
}

export interface DevSquadAdoWatcherWorkItemObservationInput {
  readonly workItemId: string;
  readonly sinceCommentId: string | null;
  readonly signal?: AbortSignal;
}

export interface DevSquadAdoWatcherWorkItemObservation {
  readonly commentIds: readonly string[];
}

export interface DevSquadAdoWatcherPullRequestObservationInput {
  readonly workItemId: string;
  readonly pullRequestId: string;
  readonly sinceCursor: DevSquadAdoPullRequestCursor | null;
  readonly signal?: AbortSignal;
}

export interface DevSquadAdoWatcherPullRequestObservationEntry {
  readonly threadId: string;
  readonly commentId?: string | null;
}

export interface DevSquadAdoWatcherPullRequestObservation {
  readonly entries: readonly DevSquadAdoWatcherPullRequestObservationEntry[];
}
```

**Seam contract.** Entries are returned in authoritative oldest-first order. A nonempty window with a supplied `since` cursor MUST include that anchor; post-cursor-only windows are invalid. Work-item identities are exact comment IDs; PR identities are exact thread/comment pairs after only null/undefined normalization. Reject duplicate identities, never deduplicate, truncate, or sort opaque IDs. Missing/null PR comments are incomplete; blank strings are invalid identifiers. Each window has inclusive limits of 1,000 entries and 1,048,576 aggregate UTF-8 identifier bytes (PR sums thread and nonnull comment bytes); each identifier is at most 1,024 bytes. Check length before iteration/copy, then accumulate bytes and uniqueness before retaining each projected entry. Malformed/duplicate/oversized windows invalidate the whole candidate with `invalid-observation-window`, even if the other kind is valid; identifier violations retain `invalid-observation-identifier`. Host upstream bounds are recommended, never a substitute for watcher validation.

#### Pass options

```ts
export type DevSquadAdoWatchObservationKind =
  | "work-item-comment"
  | "pull-request-thread";

export interface DevSquadAdoWatchIntakeRules {
  readonly phases: readonly string[];
  readonly statuses: readonly string[];
}

export interface DevSquadAdoWatchBudgets {
  readonly maxPolls: number;
  readonly maxPollStartElapsedMs: number;
  readonly observationTimeoutMs: number;
}

export interface DevSquadAdoWatchLeaseConfig {
  readonly leaseDurationMs?: number;
  readonly renewalThresholdMs?: number;
}

export interface DevSquadAdoWatchBackoffConfig {
  readonly baseIntervalMs?: number;
  readonly multiplier?: number;
  readonly maxIntervalMs?: number;
  readonly jitter?: (baseDelayMs: number, pollIndex: number) => number;
}

export interface RunDevSquadAdoWorkflowWatchPassOptions {
  readonly ledger: DevSquadAdoWorkflowLedger;
  readonly seam: DevSquadAdoWatcherObservationSeam;
  readonly passId: string;
  readonly ownerId: string;
  readonly candidates: readonly DevSquadAdoWorkItemId[];
  readonly intakeRules: DevSquadAdoWatchIntakeRules;
  readonly budgets: DevSquadAdoWatchBudgets;
  readonly lease?: DevSquadAdoWatchLeaseConfig;
  readonly backoff?: DevSquadAdoWatchBackoffConfig;
  readonly clock: () => Date;
  readonly delay: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly signal?: AbortSignal;
}
```

#### Pass result

```ts
export type DevSquadAdoWatchCandidateOutcomeKind =
  | "acted"
  | "no-change"
  | "intake-suppressed"
  | "skipped"
  | "failed";

export type DevSquadAdoWatchReasonCode =
  | "new-work-item-comment"
  | "new-pull-request-activity"
  | "new-observations"
  | "no-new-observations"
  | "intake-rules-unmatched"
  | "incomplete-pull-request-cursor"
  | "record-not-found"
  | "claim-conflict"
  | "claim-expired"
  | "claim-authorization"
  | "stale-fencing"
  | "stale-observation"
  | "revision-conflict"
  | "state-conflict"
  | "idempotency-conflict"
  | "checkpoint-indeterminate"
  | "observation-failed"
  | "observation-timeout"
  | "observation-anchor-missing"
  | "pull-request-observation-unavailable"
  | "invalid-observation-identifier"
  | "invalid-observation-window"
  | "ledger-recovery"
  | "ledger-capacity"
  | "ledger-unavailable"
  | "claim-cleanup-unconfirmed"
  | "cancelled";

export type DevSquadAdoWatchStopReason =
  | "candidates-resolved"
  | "poll-budget-exhausted"
  | "poll-start-budget-exhausted"
  | "cancelled";

export interface DevSquadAdoWatchClaimMetadata {
  readonly ownerId: string;
  readonly fencingValue: number;
  readonly expiresAt: string;
}

export interface DevSquadAdoWatchCleanup {
  readonly status: "released" | "failed" | "indeterminate" | "not-required";
  readonly reason:
    | "release-acknowledged"
    | "release-rejected"
    | "release-indeterminate"
    | "authority-unvalidated"
    | "no-claim-acquired";
  readonly ledgerErrorKind:
    | DevSquadAdoLedgerError["kind"]
    | "ledger-fault"
    | null;
  readonly acceptedRevision: number | null;
}

export interface DevSquadAdoWatchCandidateOutcome {
  readonly workItemId: string;
  readonly kind: DevSquadAdoWatchCandidateOutcomeKind;
  readonly reason: DevSquadAdoWatchReasonCode;
  readonly revision: number | null;
  readonly sourceRevision: number | null;
  readonly cursorChanges: readonly DevSquadAdoWatchObservationKind[];
  readonly skippedCursorKinds: readonly DevSquadAdoWatchObservationKind[];
  readonly claim: DevSquadAdoWatchClaimMetadata | null;
  readonly ledgerErrorKind:
    | DevSquadAdoLedgerError["kind"]
    | "ledger-fault"
    | null;
  readonly cleanup: DevSquadAdoWatchCleanup;
}

export interface DevSquadAdoWatchIntakeSignal {
  readonly workItemId: string;
  readonly sourceRevision: number;
  readonly changedKinds: readonly DevSquadAdoWatchObservationKind[];
  readonly phase: string;
  readonly status: string;
  readonly claim: DevSquadAdoWatchClaimMetadata;
}

export interface DevSquadAdoWatchPassCounts {
  readonly examined: number;
  readonly eligible: number;
  readonly acted: number;
  readonly noChange: number;
  readonly suppressed: number;
  readonly skipped: number;
  readonly failed: number;
  readonly cleanupReleased: number;
  readonly cleanupFailed: number;
  readonly cleanupIndeterminate: number;
  readonly cleanupNotRequired: number;
}

export interface DevSquadAdoWatchPassResult {
  readonly passId: string;
  readonly ownerId: string;
  readonly stopReason: DevSquadAdoWatchStopReason;
  readonly polls: number;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly counts: DevSquadAdoWatchPassCounts;
  readonly outcomes: readonly DevSquadAdoWatchCandidateOutcome[];
  readonly signals: readonly DevSquadAdoWatchIntakeSignal[];
}
```

The reason union has exactly 27 members (the prior implementation had 25, not 18). `sourceRevision` is pre-acquire; outcome `revision` retains the acknowledged checkpoint revision when present; `cleanup.acceptedRevision` is the original accepted release revision. CC-001 is read 4 → acquire 5 → checkpoint 6 → release 7, with signal source 4, outcome revision 6, cleanup revision 7. CC-002 leaves the then-current revision 7 unchanged. Replays acknowledge their original accepted revision, possibly below the returned latest record revision; these are never conflated.

`counts.acted` equals returned signal count; `counts.suppressed` counts acknowledged suppressed cursor advances; `counts.failed` counts final failures, including cleanup failures. These counts may overlap. The four cleanup counts partition every candidate outcome.

#### Exported operations

```ts
export const runDevSquadAdoWorkflowWatchPass: (
  options: RunDevSquadAdoWorkflowWatchPassOptions,
) => Promise<DevSquadAdoWatchPassOutcome>;

export const validateDevSquadAdoWorkflowWatchPassOptions: (
  options: RunDevSquadAdoWorkflowWatchPassOptions,
) => DevSquadAdoWatchValidationResult;

export const deriveDevSquadAdoWatcherOperationId: (
  input: DevSquadAdoWatcherOperationIdentity,
) => string;
```

`deriveDevSquadAdoWatcherOperationId` is public so a host can reason about, log, or reconcile the exact operation identifiers a pass uses. Its input is a discriminated union: the `checkpoint` arm carries the observation generation, and the claim-lifecycle arms carry the claim epoch. A host that wants to predict a retry's checkpoint identifier supplies the same generation; the claim identifiers are deliberately not predictable, because they must not be reused.

### Validation Rules

Validation runs to completion before any seam call or ledger operation and returns the first failure with a stable field path.

| Field                           | Rule                                                                                                                                                                                                                          |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ledger`                        | Object exposing callable `readRecord`, `acquireClaim`, `renewClaim`, `releaseClaim`, `checkpoint`.                                                                                                                            |
| `seam`                          | Object; `observeWorkItemComments` present and callable; `observePullRequestActivity` callable when present.                                                                                                                   |
| `passId`                        | Nonblank NFC string, no control characters, 1–120 UTF-8 bytes.                                                                                                                                                                |
| `ownerId`                       | Nonblank NFC string, no control characters, 1–256 UTF-8 bytes.                                                                                                                                                                |
| `candidates`                    | Nonempty array; each canonicalizes through the ledger's work-item rules; no duplicate canonical identifier; at most 1,000 entries.                                                                                            |
| `intakeRules.phases`            | Nonempty array of distinct nonblank strings ≤ 256 UTF-8 bytes.                                                                                                                                                                |
| `intakeRules.statuses`          | Nonempty array of distinct nonblank strings ≤ 256 UTF-8 bytes.                                                                                                                                                                |
| `budgets.maxPolls`              | Positive safe integer ≤ 10,000.                                                                                                                                                                                               |
| `budgets.maxPollStartElapsedMs` | Positive safe integer.                                                                                                                                                                                                        |
| `budgets.observationTimeoutMs`  | Positive safe integer.                                                                                                                                                                                                        |
| `lease.leaseDurationMs`         | Positive safe integer ≤ 86,400,000; default 60,000.                                                                                                                                                                           |
| `lease.renewalThresholdMs`      | Positive safe integer strictly less than the lease duration; default `max(1, trunc(lease / 3))`. When the default cannot satisfy that rule the offending field is `lease.leaseDurationMs`, because no threshold was supplied. |
| `backoff.baseIntervalMs`        | Nonnegative safe integer; default 1,000.                                                                                                                                                                                      |
| `backoff.multiplier`            | Finite number ≥ 1; default 2.                                                                                                                                                                                                 |
| `backoff.maxIntervalMs`         | Nonnegative safe integer ≥ `baseIntervalMs`; default 30,000.                                                                                                                                                                  |
| `backoff.jitter`                | Callable when present; its return is coerced with `trunc` and clamped to `[0, maxIntervalMs]`.                                                                                                                                |
| `clock`                         | Callable returning a valid `Date`.                                                                                                                                                                                            |
| `delay`                         | Callable.                                                                                                                                                                                                                     |
| `signal`                        | When present, boolean `aborted` plus callable `addEventListener` AND `removeEventListener`; reject before any injected clock, delay, seam, or ledger side effect.                                                             |

Intake rules are exact-match sets with no wildcard. Admitting every status requires listing every status, which keeps lifecycle policy in the host.

### Deterministic Operation Identifiers

```text
checkpoint identity     = { v: 2, passId, workItemId, step: "checkpoint", ordinal, generation }
claim-lifecycle identity = { v: 2, passId, workItemId, step, ordinal, claimEpoch }
operationId              = `dsw2.${step}.${sha256hex(canonicalJson(identity)).slice(0, 32)}`
```

- `step` ∈ `claim` | `renew` | `checkpoint` | `release`.
- `ordinal` is `0` for `claim`, `checkpoint`, and `release`; the one-based renewal sequence for `renew`.
- `workItemId` is the canonical ledger identifier, not the caller's raw input.
- `generation` names both ends of the advance: `fromWorkItemCommentId`, `fromPullRequest`, `toWorkItemCommentId`, `toPullRequest`.
- `claimEpoch` is 16 random bytes, base64url, minted immediately before `acquireClaim` and reused by that claim's renewals and release.
- Length is 48 ASCII bytes, well inside the ledger's 256-byte identifier bound.

Canonical serialization of the identity object removes delimiter ambiguity between long pass and work-item identifiers.

The two scopes are not interchangeable. A **checkpoint** identifier must reproduce on retry so an already-durable advance replays instead of duplicating, and must differ for a different advance so a `passId` reused for later work is not falsely rejected. A **claim-lifecycle** identifier must _not_ reproduce across acquisitions: ADR-0025 hashes the capability token into the acquire digest, and tokens are freshly random, so a reused claim identifier can only produce a permanent `idempotency-conflict`. The epoch is an idempotency namespace, never a capability, and never a claim token.

### Candidate Ordering

Candidates are canonicalized, every duplicate canonical identity is rejected, and valid candidates are sorted by UTF-8 byte comparison. This candidate ordering never applies to observation identifiers, whose sequence is authoritative. All processing is sequential; noncooperating abandoned observations may nevertheless remain physically in flight.

### Runtime Ledger Response Validation

`callLedger` must accept a method-specific validator and request context, not blindly return `ok: true` values or arbitrary `error.kind` strings. Guard invocation and response inspection. Validate:

- `readRecord`: the complete token-free public record, including schema, requested work-item identity, revision/timestamps, phase/status, branch/worktree, agent/session histories, PR reference, both observation cursors, checkpoint history, active claim and fencing counter. Use ledger-compatible structural rules without lifecycle policy or schema changes.
- Every mutation: positive safe accepted revision, valid accepted timestamp, boolean replay flag, correct method outcome, and a complete valid latest record for the requested work item. Original accepted revision cannot exceed latest record revision; exact replay may be older and must not require original metadata to describe a later owner's state.
- Acquire: original authority owner and token match the request, valid fencing and lease metadata, consistent outcome/record; establish current local authority only from validated evidence, never reconstruct it from a malformed payload.
- Renew: returned claim owner/fence/lease and acceptance metadata match the held authority and renewal request, without converting an old replay into new authority.
- Checkpoint: original checkpoint metadata (operation identity, accepted revision/time, state, owner/fence and requested patch where represented) matches the request; latest record remains valid even when its revision is newer. A malformed acknowledgement authorizes no new cursor changes or signals, even if a durable mutation happened.
- Release: original released owner/fence/time and accepted revision match the request. A valid replay proves the original release, not that a later owner is absent.
- Errors: require boolean false and a known `DevSquadAdoLedgerError` variant with its required fields validated (claim metadata, expiry, fencing, revision pair, current state, artifact/schema, resource/limit, attempts, storage outcome, or validation field/reason as appropriate). Project only the known category. Unknown or malformed variants, throws and rejections become `ledger-fault`; never return their strings/messages/stacks.

This boundary validates injected claims of durability; it does not independently verify a dishonest dependency's filesystem. A faulting or ambiguous acquire yields no usable authority and zero release. A malformed post-write acknowledgement can lose the corresponding intake signal; host reconciliation remains necessary.

Snapshot only method/discriminator-specific public fields into fresh nested objects before validation. Never clone or enumerate a dependency's whole response: unknown getters must remain untouched. Snapshot record collections with indexed traversal bounded by the inherited ledger ceilings; reject observed length changes, including during the last entry getter. Keep the original request snapshot separate from both the adapter's request copy and the response projection.

History recovery must run the shared checkpoint acknowledgement validator against the last submitted request snapshot before reporting durability. Require accepted revision = submitted expected revision + 1; if latest equals accepted, require matching timestamp, state, authority and patched cursors. A newer valid latest record may reflect later mutations, renewal or takeover and must not be mistaken for the original acceptance. Refresh retry preconditions only after finding no matching history; retain the prior submission unchanged until a new request is issued (including any own renewal). The history entry carries no cursor or authority of its own, so do not invent missing receipt fields or alter the ledger schema.

### Poll Loop Algorithm

```text
startedAt := clock()          # single reading, also the pass-start basis
pending   := ordered candidates
polls     := 0

loop:
  if signal.aborted            -> stop("cancelled")
  if polls >= maxPolls         -> stop("poll-budget-exhausted")
  now := clock()               # ONE reading for this entire poll
  if polls > 0 and now - startedAt >= maxPollStartElapsedMs
                               -> stop("poll-start-budget-exhausted")
  polls := polls + 1

  for candidate in pending (canonical order):
    runCandidateStep(candidate, now)
    if signal.aborted          -> stop("cancelled")

  if signal.aborted            -> stop("cancelled")
  if pending is empty          -> stop("candidates-resolved")
  if polls >= maxPolls         -> stop("poll-budget-exhausted")
  delayMs := backoffFor(polls)
  await delay(delayMs, signal)

finalize:
  every still-pending candidate is reported:
     holding a claim -> failed / "checkpoint-indeterminate"
     otherwise       -> no-change / <last pending reason>
  run mandatory cleanup once per previously validated authority
  attach cleanup and apply failure promotion without retracting acknowledgements
  if signal.aborted            -> override stop reason with "cancelled"
  compute counts from returned signals, acknowledged suppression, final failures and cleanup
```

Backoff for the transition from poll `n` to poll `n + 1`:

```text
raw     := baseIntervalMs * multiplier ^ (n - 1)
capped  := min(trunc(raw), maxIntervalMs)
delayMs := jitter ? clamp(trunc(jitter(capped, n)), 0, maxIntervalMs) : capped
```

`maxPolls = 3` with no eligible candidate therefore performs exactly three polls and requests exactly two delays.

### Candidate Step Algorithm

Gates run in this fixed order. Every check uses the single poll clock reading.

1. **Cancellation gate.** Aborted → resolve `failed` / `cancelled` if a claim is held, otherwise stop the pass.
2. **Read.** `ledger.readRecord(candidate)`.
   - `record-not-found` → resolve `skipped` / `record-not-found`. The watcher never initializes.
   - Recovery categories (`corrupt-artifact`, `unsupported-schema-version`, `path-boundary`, `unsupported-permissions`, `scan-limit`) → resolve `failed` / `ledger-recovery` with `ledgerErrorKind` set.
   - `capacity-exceeded` → resolve `failed` / `ledger-capacity`.
   - `storage` → resolve `failed` / `ledger-recovery` with `ledgerErrorKind: "storage"`.
3. **Foreign-claim gate.** `record.activeClaim` exists, is owned by another `ownerId`, and `now < expiresAt` → resolve `skipped` / `claim-conflict`. No seam call is made.
4. **Observe work-item comments.** Fresh cancellation gate immediately before invocation. Pass a dedicated child controller's signal linked to parent; race a valid injected timeout, retiring both timer and links on every terminal path.
   - Timeout → resolve `failed` / `observation-timeout`.
   - Rejection → resolve `failed` / `observation-failed`, with no transport message retained.
5. **Observe pull-request activity.** Only when `record.pullRequest.id !== null`, with a fresh parent abort check even if the work-item call returned valid data while aborting the parent.
   - Method absent → resolve `failed` / `pull-request-observation-unavailable`.
   - Same timeout and rejection handling as step 4.
6. **Project and validate.** Enforce the complete seam contract above: count before copy/iteration, incremental UTF-8 bytes and identity uniqueness before retention, per-ID validity. Reject the entire candidate if either kind fails. Retain only identifiers.
7. **Select new events.** Apply anchor-inclusive rules below. Select the newest complete new PR pair; only mark PR skipped when no new complete pair exists. No kind can occur in both cursor-change and skipped sets.
8. **Eligibility.** No new events in any kind → leave the candidate **pending** with reason `no-new-observations` (or `incomplete-pull-request-cursor` when the only observed activity was unpersistable). Pending candidates are re-examined on the next poll.
9. **Acquire claim.** Fresh 32-byte `crypto.randomBytes` base64url token, derived `claim` operation ID, configured lease.
   - `claim-conflict` → resolve `skipped` / `claim-conflict`.
   - `claim-expired` | `claim-authorization` | `stale-fencing` → resolve `skipped` with the matching reason.
   - Validate the response before establishing authority. Fault/ambiguity without validated authority means cleanup `indeterminate` / `authority-unvalidated`, no release.
   - Recheck pre-acquire PR identity and both observation anchors against the valid claimed record. On change, write nothing and clean up, reporting stale observation; only acknowledged cleanup permits continued observation on a later poll.
10. **Renewal guard.** If `now + renewalThresholdMs >= Date.parse(expiresAt)`, renew with the next `renew` ordinal before mutating. Fencing is preserved.
11. **Checkpoint.** `expected` uses the validated claimed record's revision/phase/status, refreshing expected revision after own renewal; `sourceRevision` remains the pre-acquire read. `patch.observations` carries only advanced cursors.
    - Validated success → record original accepted checkpoint `revision` and `cursorChanges`; malformed success → `ledger-unavailable`, suppress all unacknowledged effects and run cleanup.
    - `revision-conflict` | `state-conflict` | `idempotency-conflict` → resolve `failed` with the matching reason; durable state unchanged.
    - `stale-fencing` | `claim-expired` | `claim-authorization` → resolve `failed` with the matching reason; nothing is advanced.
    - `contention`, or `storage` with `outcome: "indeterminate"` → leave the candidate **pending while holding the claim** and retry on a later poll with the **same** checkpoint operation ID.
    - `storage` with `outcome: "unchanged"` → resolve `failed` / `ledger-recovery`; durable state is known unchanged, so no retry is attempted.
12. **Intake decision.** Record phase ∈ `intakeRules.phases` **and** status ∈ `intakeRules.statuses` → append one intake signal citing `sourceRevision` from step 2 and resolve `acted`. Otherwise resolve `intake-suppressed` / `intake-rules-unmatched`; the cursor stays advanced.
13. **Cleanup.** Invoke release exactly once for previously validated authority using its derived release ID, retaining evidence until validation. Apply the cleanup contract below, preserving acknowledged checkpoint revision, cursor changes, and signals. Inclusive lease expiry is the backstop.

The signal is appended only after the checkpoint response is accepted, so no signal can exist for a cursor that is not durable.

### Cursor Anchoring and New-Event Selection

For each observation kind, given the persisted cursor `anchor` and the seam's ordered list `entries`:

```text
if entries is empty            -> no new events
if anchor is null              -> new := entries
else if anchor appears at i    -> new := entries[i+1 ..]
else                           -> FAIL CLOSED: observation-anchor-missing
next cursor := last persistable entry of new
```

Equality is exact string comparison for work-item comments and exact pair comparison of `threadId` and `commentId` for pull requests. No identifier is parsed, ordered, or compared arithmetically.

The final branch is the fail-closed one. The seam window is anchor-inclusive, so a non-empty window that does not contain a supplied anchor is undecidable: it is indistinguishable from a window in which every entry is new, and treating it that way silently re-delivers the whole window. The candidate reports `failed` / `observation-anchor-missing` and advances nothing.

A pull-request entry with missing/undefined/null `commentId` is not persistable; a blank comment is invalid, not normalized. The newest complete pair among new entries becomes the next cursor. `pull-request-thread` is recorded in `skippedCursorKinds` **only when no new persistable entry exists**, so `cursorChanges` and `skippedCursorKinds` are disjoint.

### Observation Staleness Gate

The record is read before observation and returned again by the acquisition. Between those two reads another owner can acquire, advance a cursor, and release, so the acquisition can succeed while the selection in hand is already stale.

```text
observed := readRecord(candidate)          # anchors used for selection
claimed  := acquireClaim(...).record       # record as it stands under the claim

if observed.observations.workItemCommentId != claimed.observations.workItemCommentId
   or observed.observations.pullRequest    != claimed.observations.pullRequest
   or observed.pullRequest.id              != claimed.pullRequest.id
                               -> mandatory cleanup; report no-change / stale-observation
                                  (re-observe later only after acknowledged cleanup;
                                   unconfirmed cleanup finalizes failed instead)
```

Phase and status are excluded on purpose: they are taken fresh from `claimed` and carried into the checkpoint precondition, so a foreign change to them conflicts on its own terms rather than being reclassified as staleness.

### Cancellation Points

Cancellation is observed at these points, per FR-051:

- freshly before each seam call (steps 4 and 5), including WI-success/parent-abort before PR;
- before each non-cleanup ledger mutation (steps 9, 10, 11); mandatory release is still attempted once after abort;
- between polls, both before the delay and via the delay's own `signal`.
- immediately after each candidate, before resolved/budget exits, and after final cleanup; cancellation takes priority without retracting acknowledged effects.

Signal property inspection is a narrow preflight boundary: unreadable required fields report validation at `signal` before injected side effects. Capture listener methods once with their original receiver, but keep `aborted` live. If it becomes unreadable or nonboolean after successful preflight, stop as cancelled and retain mandatory cleanup. Required configuration fields are read once into a private pass snapshot; the caller's signal is never modified.

Each observation owns a dedicated AbortController propagated into its seam call and linked from the parent. Abort/timeout cancels seam and timer; success/rejection also retire timers and every parent link/listener. Consume/quarantine late settlements so they cannot produce later effects or unhandled rejections. Tests measure maximum cooperative active operations; sequential invocation is not a physical-concurrency guarantee for noncooperating dependencies.

On abort the pass runs mandatory cleanup, preserves acknowledged outcomes/signals, and returns `stopReason: "cancelled"`. Ledger calls and delays must settle; abort cannot impose a hard wall-clock ceiling.

### Mandatory Cleanup and Result Accounting

Attach `DevSquadAdoWatchCleanup` to every outcome, even missing/skipped/unexamined candidates. Exactly one release invocation is made on candidate exit for validated authority, including cancellation/error, and zero without it. Retain local evidence until the response is validated; never fabricate authority, guess/reacquire, or retry cleanup.

| Evidence                                               | Cleanup status / reason                   | Category; accepted revision                                    |
| ------------------------------------------------------ | ----------------------------------------- | -------------------------------------------------------------- |
| Valid release acknowledgement or exact replay          | `released` / `release-acknowledged`       | null; original accepted release revision                       |
| Known rejection, including storage/unchanged           | `failed` / `release-rejected`             | known ledger category; null                                    |
| Storage/indeterminate or contention                    | `indeterminate` / `release-indeterminate` | known ledger category; null                                    |
| Throw/reject/malformed release                         | `indeterminate` / `release-indeterminate` | `ledger-fault`; null                                           |
| Faulting/ambiguous acquire without validated authority | `indeterminate` / `authority-unvalidated` | `ledger-fault` or known ambiguous category; null; zero release |
| No claim and no acquisition uncertainty                | `not-required` / `no-claim-acquired`      | null; null; zero release                                       |

Only validated acknowledgements mean released; replay may include a later owner's active claim in the latest valid record. On failed/indeterminate cleanup, promote an otherwise nonfailed outcome to failed: `ledger-unavailable` for `ledger-fault`, else `claim-cleanup-unconfirmed`. Retain an existing primary failure reason. Preserve every acknowledged checkpoint revision/cursor change and returned signal; never roll back or retract. Derive acted/suppressed independently from final kind, and partition all candidates by cleanup counts.

### Security Controls

- Claim tokens come from `node:crypto` `randomBytes(32)` encoded as unpadded base64url, are held only in local step state, and never enter results, signals, errors, logs, or durable state.
- Only identifier fields are read from seam responses; bodies, authors, URLs, and unknown properties are discarded at projection and never referenced afterwards.
- Seam rejections are converted to a reason code with no message, no stack, and no URL.
- Ledger error payloads are reduced to a stable `ledgerErrorKind` string; no raw JSON, artifact contents, or operating-system message is surfaced.
- The watcher never force-releases, deletes, or resets another owner's claim, and never rewrites a ledger artifact.
- No module in the watcher graph imports a network, CLI, git, sandbox, agent, or control-plane module; this is asserted statically.

### Requirement Traceability

| Requirements  | Implementation                                                                                                             | Tests                                            |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| FR-001–FR-008 | `runDevSquadAdoWorkflowWatchPass`, result envelope, validation module, per-candidate isolation, root export                | TEST-001, TEST-004, TEST-019, TEST-025           |
| FR-009–FR-015 | Watcher-specific read seam, structural validation, projection, per-candidate observation calls                             | TEST-002, TEST-003, TEST-018, TEST-024           |
| FR-016–FR-024 | Pure eligibility over record + observations + single poll clock reading, canonical ordering                                | TEST-005, TEST-006, TEST-007, TEST-015           |
| FR-025–FR-031 | Validated acquire authority, random tokens, fencing, renewal guard, exactly one cleanup invocation per validated authority | TEST-008, TEST-009, TEST-010, TEST-011, TEST-030 |
| FR-032–FR-039 | Cursor-only checkpoint patch with expected revision/phase/status, derived operation IDs                                    | TEST-004, TEST-012, TEST-013, TEST-022           |
| FR-040–FR-046 | Exact-match intake rules, suppression that still advances cursors, one signal per candidate                                | TEST-014, TEST-004, TEST-021                     |
| FR-047–FR-053 | Poll loop, budgets, injected delay, deterministic backoff, cancellation gates, observation timeout                         | TEST-016, TEST-017, TEST-018                     |
| FR-054–FR-058 | Ledger category passthrough, candidate isolation, no artifact writes, redacted diagnostics                                 | TEST-019, TEST-020, TEST-021, TEST-023           |

### Invariant Traceability

| Invariant | Enforcement                                                                                                               | Test                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| INV-001   | Static dependency assertion plus seam-only observation                                                                    | TEST-024                     |
| INV-002   | Seam exposes observation methods only; recording fake asserts call set                                                    | TEST-003                     |
| INV-003   | Single poll clock reading, canonical ordering, pure eligibility                                                           | TEST-006, TEST-007           |
| INV-004   | Foreign-claim gate plus acquire-on-intent                                                                                 | TEST-008                     |
| INV-005   | Fencing value carried on every mutation; ledger rejects superseded fences                                                 | TEST-009                     |
| INV-006   | Signal appended only after checkpoint acceptance                                                                          | TEST-004, TEST-005, TEST-019 |
| INV-007   | `acted` set only from an accepted checkpoint response                                                                     | TEST-004, TEST-023           |
| INV-008   | Checkpoint IDs reused verbatim on retry; claim IDs scoped per acquisition                                                 | TEST-012, TEST-023           |
| INV-009   | No phase table; intake rules are caller-supplied exact-match sets                                                         | TEST-014                     |
| INV-010   | Projection to identifiers, token isolation, redacted errors                                                               | TEST-021                     |
| INV-011   | Poll budget checked before each additional poll; elapsed budget bounds poll starts only                                   | TEST-016                     |
| INV-012   | Finalizer attempts cleanup once for validated authority, zero otherwise; reports validated acknowledgement or uncertainty | TEST-011, TEST-017, TEST-030 |
| INV-013   | Ledger recovery categories surfaced unchanged, never repaired                                                             | TEST-020                     |
| INV-014   | Per-candidate step isolation with independent outcomes                                                                    | TEST-019                     |
| INV-015   | Anchors compared between the pre-claim read and the acquired record                                                       | TEST-009                     |
| INV-016   | Every injected ledger call classified into a typed outcome or `ledger-fault`                                              | TEST-019, TEST-011           |

### Conformance Test Matrix

| Case   | Test                                                                                                                                                                 |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CC-001 | Seed rev 4 cursor `480`; observe `[480, 481]`; acquire 5 → checkpoint 6 → release 7; signal source 4, outcome revision 6, cleanup revision 7.                        |
| CC-002 | Rerun unchanged; no signal/acquire/checkpoint/release, cleanup not-required, then-current revision 7 unchanged.                                                      |
| CC-003 | Recording seam fake exposes write-shaped spies; assert only observation methods were invoked.                                                                        |
| CC-004 | Interleave `watch-a` and `watch-b` passes over `137` with a 60s lease; assert one actor and one `claim-conflict`.                                                    |
| CC-005 | Expire `watch-a`, take over with `watch-b`, replay `watch-a` checkpoint; assert `stale-fencing` and no mutation.                                                     |
| CC-006 | Advance the record to rev 9 between read and checkpoint; assert `revision-conflict` and pass continuation.                                                           |
| CC-007 | Phase `awaiting-approval` with rules `[implement, review]`; assert cursor advanced and `intake-suppressed`.                                                          |
| CC-008 | Phase `custom-security-gate` listed in intake rules; assert a signal is emitted with no allowlist error.                                                             |
| CC-009 | Candidate `999` uninitialized; assert `skipped` / `record-not-found` and no record created on disk.                                                                  |
| CC-010 | Three shuffled input orders; assert identical outcomes, reason codes, and recorded seam call order.                                                                  |
| CC-011 | No eligible candidate with `maxPolls = 3`; assert 3 polls, 2 recorded delays, `poll-budget-exhausted`.                                                               |
| CC-012 | Abort after acknowledged checkpoint under cooperating dependencies; retain outcome/signal and attempt cleanup once; assert released only from valid acknowledgement. |
| CC-013 | Non-settling seam with `observationTimeoutMs = 5000`; assert `failed` / `observation-timeout` and continuation.                                                      |
| CC-014 | Indeterminate checkpoint forces a multi-poll hold; assert renewal before inclusive expiry with unchanged fencing.                                                    |
| CC-015 | Blank owner, duplicate candidates, `maxPolls = 0`, malformed intake rules; assert field paths and zero side effects.                                                 |
| CC-016 | Seam without `observeWorkItemComments`; assert `seam-contract` error naming the method and zero mutations.                                                           |
| CC-017 | Three candidates, one corrupt artifact; assert isolated `ledger-recovery` failure and two normal completions.                                                        |
| CC-018 | Seam returns bodies, authors, and a credential-bearing URL; snapshot durable state, result, and errors for leaks.                                                    |
| CC-019 | Pull-request entry with a thread but no comment identifier; assert no PR cursor persisted and stable reason.                                                         |
| CC-020 | Full pass under the static dependency assertion with no network-capable module in the graph.                                                                         |

### Success Verification

| Criterion | Verification                                                                                                                                                                        |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SC-001    | 1,000 repeated passes over frozen state compared by deep equality of outcomes, reason codes, and counts.                                                                            |
| SC-002    | 1,000 interleaved two-owner trials asserting exactly one actor each time, run in bounded concurrent batches over disjoint work items so the committed default meets the stated bar. |
| SC-003    | Stale-fencing trials assert zero cursor advances and zero revision changes.                                                                                                         |
| SC-004    | At-most-once batched signal trials, including durable-unacknowledged and host-crash loss; host reconciliation remains required.                                                     |
| SC-005    | Scheduling/window/abort matrix under settling dependencies, maximum cooperative active-operation counters and explicit noncooperation limitation.                                   |
| SC-006    | Claim-lifecycle assertions on every exit path plus a negative force-release assertion.                                                                                              |
| SC-007    | Automated string scan of durable artifacts, results, signals, and errors for bodies, URLs, and tokens.                                                                              |
| SC-008    | Candidate-isolation trials comparing untouched candidates' revisions before and after a failure.                                                                                    |
| SC-009    | Assertion that every candidate outcome carries a nonempty stable reason code and outcome kind.                                                                                      |
| SC-010    | Static dependency test plus a suite that requests zero wall-clock waits from the injected delay source.                                                                             |

### Vertical Implementation Sequence

1. **Public contracts and validation**
   - Add Effect-free public types, result envelope, and the seam interface.
   - Add option validation, canonical candidate ordering, and seam structural validation.
   - RED→GREEN TEST-001, TEST-002.

2. **Operation identity and backoff**
   - Add `deriveDevSquadAdoWatcherOperationId` and the deterministic backoff computation.
   - RED→GREEN identifier stability and backoff schedule assertions feeding TEST-012, TEST-016.

3. **Observation and cursor selection**
   - Add seam invocation with timeout, projection to opaque identifiers, and the anchor rule.
   - RED→GREEN TEST-003, TEST-018, TEST-022.

4. **Single-candidate happy path**
   - Add read, eligibility, claim acquisition, checkpoint, release, and intake decision.
   - RED→GREEN TEST-004, TEST-005, TEST-014, TEST-015.

5. **Poll loop, budgets, and cancellation**
   - Add pending/resolved state, per-poll clock reading, budgets, delays, and cancellation gates.
   - RED→GREEN TEST-006, TEST-007, TEST-016, TEST-017.

6. **Claim lifecycle under contention**
   - Add the foreign-claim gate, renewal guard, indeterminate-checkpoint hold, and the release finalizer.
   - RED→GREEN TEST-008, TEST-009, TEST-010, TEST-011, TEST-013.

7. **Failure isolation and recovery**
   - Add ledger category mapping, per-candidate isolation, and restart assertions.
   - RED→GREEN TEST-019, TEST-020, TEST-023.

8. **Data minimization and package integration**
   - Add projection assertions, export through `src/index.ts`, README section, changeset, and the static dependency test.
   - RED→GREEN TEST-021, TEST-024, TEST-025.

Every step ends with passing tests before refactoring or proceeding.

#### Approved recovery sequence and traceability

W029 amended these existing artifacts only. W030 → W031 → W032 → W033 → W034 → W035 → W036 → W037 implementation is complete, with subsequent RC14 remediation and regression evidence in the review log. W038 independently FAILED and awaits fresh parent-owned re-review; green implementation tests are not an independent PASS. No factory, live clients, discovery/filtering orchestration, or outbox is added.

| Finding / additional review                           | Requirements / conformance             | Owning task / required tests                                    |
| ----------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------- |
| R14-001 unchecked ledger success/errors               | FR-059; CC-024, CC-029                 | W030 / TEST-026                                                 |
| R14-002 abort/preflight                               | FR-003, FR-051; CC-025                 | W031 / TEST-027                                                 |
| R14-003 duplicate/opaque identity                     | FR-012, FR-034–FR-035b; CC-019, CC-026 | W032 / TEST-028                                                 |
| R14-004 observation cancellation/liveness             | FR-048, FR-051–FR-053; CC-027          | W033 / TEST-029                                                 |
| R14-005 count/UTF-8 resource limits                   | FR-035b; CC-026                        | W032 / TEST-028                                                 |
| R14-006 revision semantics                            | FR-005, FR-044; CC-001, CC-002         | W035 / TEST-031                                                 |
| R14-007 contradictory W007/anchor text                | FR-035a; CC-023                        | W029 artifact correction, W032 behavior verification / TEST-028 |
| Release acknowledgement/accounting                    | FR-006, FR-029, FR-060; CC-028         | W034 / TEST-030                                                 |
| PR staleness, takeover, intake metadata, idempotency  | FR-036a, FR-038, FR-044; CC-030        | W035 / TEST-031                                                 |
| Full candidate/poll/duration/lease bounds             | FR-004; CC-015, CC-030                 | W036 / TEST-032                                                 |
| Public reason union, cleanup export, README/changeset | FR-008, FR-060; TEST-025               | W037                                                            |
| Evidence, superseded verdict, traceability            | CC-001–CC-030; TEST-001–TEST-032       | W038 independent verification                                   |

Existing matrices above cover the earlier baseline; this recovery mapping adds FR-059/060 and CC-021–CC-030. CC-021/022 are owned by W035 (TEST-012/031); CC-023 by W032 (TEST-028); CC-024 by W030 (TEST-026). Implemented tests and actual command results are recorded in the review log, separately from the failed independent W038 verdict and pending re-review.

### Engineering Practices

| Practice      | Decision                                                                                      | Reference                   |
| ------------- | --------------------------------------------------------------------------------------------- | --------------------------- |
| Public API    | Promise-based, discriminated results, JSDoc on every public member, no Effect leakage         | Repository coding standards |
| Runtime style | Plain async orchestration; Effect reserved for resource-owning modules such as ledger storage | ADR-0026                    |
| Testing       | Colocated Vitest suites through the public watcher API with injected clock, delay, and seam   | Repository coding standards |
| Determinism   | Single clock reading per poll, canonical ordering, injected delays, no wall-clock waiting     | ADR-0026                    |
| Security      | Random claim tokens, identifier-only projection, redacted diagnostics, fail-closed recovery   | ADR-0025, ADR-0026          |
| Release       | Minor changeset and README review for the new public behavior                                 | `CLAUDE.md`                 |

### Commands

Executable validation commands:

#### Focused tests

```text
npm test -- DevSquadAdoWorkflowWatcher
```

#### Full tests

```text
npm test
```

#### Type checking

```text
npm run typecheck
```

#### Build and public declaration validation

```text
npm run build
```

#### Lint and formatting

```text
npm run format:check
```

#### Diff validation

```text
git diff --check
```

#### Local execution

This feature is a package API with no standalone process. Exercise it through the focused Vitest suite:

```text
npm test -- DevSquadAdoWorkflowWatcher
```

### Implementation Handoff

#### Required artifacts

- `docs/features/devsquad-ado-workflow-watcher/spec.md`
- `docs/features/devsquad-ado-workflow-watcher/plan.md`
- `docs/adr/0026-devsquad-ado-workflow-watcher.md`
- `docs/adr/0025-devsquad-ado-workflow-ledger.md`

#### Architectural assumptions

- The host supplies the candidate set, a stable `passId`, and already-initialized ledger records.
- The injected seam returns identifiers in the tracker's authoritative order and honours the `since` contract.
- The watcher's injected clock and the ledger's clock are the same time basis in tests.
- Claims are short-lived; a host reacting to a signal reacquires if it intends to mutate.
- Intake delivery is at-most-once and never duplicating, and applies to ledger-mediated delivery only, never to external side effects. A checkpoint that becomes durable without its acknowledgement being observed advances the cursor while its signal is never returned, so hosts reconcile completeness from the durable record rather than from the signal stream.
- A pass examines at most 1,000 candidates, inside ledger schema-v1 capacity bounds.
- Ledger operations and delays settle; observation timeout assumes a valid delay. Noncooperating dependencies may remain physically active after abort; no hard runtime guarantee is implied.

#### Discarded alternatives

- Reusing `AdoReadOnlyControlPlane` as the observation seam.
- Watcher-generated or random pass identity.
- Callback or event-emitter intake delivery.
- A long-lived watcher daemon.
- Concurrent candidate processing.
- Suppressing cursor advancement when intake rules reject a record.
- Watcher-initialized ledger records.

#### Implementation gate

ADR-0026 is Proposed and ADR-0025 remains Proposed. Implementation may proceed against both only while preserving their boundaries and security controls; acceptance remains a separate review action.

### Bounded PR checkpoint identity repair — POST-SKEP-001, 2026-09-11

This amendment qualifies the retained baseline's unchanged-operation-identity statements only for newly prepared checkpoints involving PR observation. Implement FR-037b/FR-037c and the dated ADR-0026 decision without reopening completed W039–W046 or adding a later slice.

- Reproduce the real-ledger collision through the public pass in both modes before source changes: item 137, WI anchor 480, pass P, PR A's pair (1,1); authorized host acquire/checkpoint/release replaces A with B and resets the PR cursor; the same pass observes B's identical local pair. Require one signal per PR, distinct checkpoint IDs, durable B cursor, confirmed cleanup, no watcher initialization, and zero mutations/signals on unchanged reopened B.
- Preserve the legacy one-argument helper, exported generation/identity shapes and all v2 golden bytes. Add only a checkpoint overload with `{ readonly pullRequestId: string }`, using exactly the v3 generation/formula in ADR-0026. No-PR checkpoints, lifecycle IDs and discovery initialization remain unchanged.
- At the shared preparation point after the existing staleness gate, use the record's pre-acquisition observed PR ID even for WI-only cursor advances. Keep pending IDs/requests and original-submission history validation before retry-precondition refresh. Never substitute a later PR ID or mint an ID/version after conflict.
- Add focused public real-ledger namespace/retry/history/renewal/conflict tests and legacy/new helper compatibility, formula and bounds assertions. Retain the existing staleness, replay and cleanup coverage. Update README/JSDoc and add a nonduplicate patch changeset without modifying the existing minor feature entry.
- Run the focused RED/GREEN regression, combined watcher/ledger selector, focused historical-history selector, typecheck, scoped formatting/diff, canonical build and standalone Effect-free guard. Report the unchanged Windows postbuild failure separately from fresh ESM/DTS; do not claim global-suite, packaging or remote-CI PASS.
- Append the new independent FAIL and implementation evidence to the review log; W047 remains a pending independent gate, not implementer approval. Preserve all prior document sections/bytes, original severities, historical PASS/FAIL and 403 evidence.

The conductor supplied the bounded DevSquad refine decision and explicit user authorization for genuine material findings. The earlier DevSquad implementation orchestrator stopped solely on an unavailable active board-item workflow without changing files. This local worker does not invent board authorization or execute that forbidden workflow. No branch, commit, push, PR, board, authentication, network, live service, migration, fallback, admission or later-slice work is part of this repair. ADR-0025/0026 remain Proposed.
