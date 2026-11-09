# Cowork policy in the multi-project core

`createCoworkOrchestrationHost(options)` wraps an existing trusted
`MultiProjectHost`. It calls the existing `runCoworkReview` and
`runCoworkStageCritic`; it does not implement another review engine, governance
evaluator, measurement runner, or source-control pipeline.

## Explicit injectable requirements

There is **no permissive production default**. The caller must provide:

- An existing trusted host with independent authorization, source resolution,
  measurable acceptance/contract validation, and hub observation.
- An explicit review policy with canonical model families, required diversity,
  the actual selected framework and available executor capability, two or three
  bounded attempts, and a repeated-signature limit. An unavailable matching
  executor blocks or requests human input; there is no framework fallback.
- `classify(request, revision, signal)`, independently identifying the actual
  author model/family, ordinary or critical risk, and the complete changed-file
  inventory. Worker prose cannot supply these facts.
- Review authorization, executed review, independent provider attestation, and
  independent exact-context human-approval callbacks. Each receives the concrete
  review contract arguments followed by the immutable original core request,
  including its actual phase artifacts.
- Stage authorization, executed critic, and independent provider attestation
  callbacks. Their concrete stage contract arguments are followed by immutable
  producer evidence `{ request, artifact, revision }`. This gives the executor
  the real producer output, not merely an opaque digest or simulated count.

Existing concrete review/stage callbacks accepting fewer arguments remain
usable. Callbacks must actually execute the declared model through the declared
framework/provider; echoing the requested identity is not attestation.
Authorization is independent of all returned receipts. A review result never
grants permission for worker, hub, configuration, merge, or other effects.

Where governance applies, also inject `governance.collect(request, acceptance,
signal)` and the **existing** evaluator as `governance.evaluate(collected,
signal)`. The collector determines applicability from trusted host inventory.
Collection and evaluation evidence are retained. A missing optional collector
means this adapter performs no governance evaluation; the caller must not
represent this as governance coverage. An applicable evaluation must have
positive scope, nonempty unique checks, concrete evidence, and a disposition
consistent with those checks. Zero-scope or inconsistent results are unknown,
never a vacuous pass.

## Core binding and evidence flow

The core initializes and loads its active catalog, then calls `bindRun` once
for the pass. The adapter creates a fresh closure, copies and freezes the
original lease, and composes the underlying host's own binding. It resolves
against the real accepted project from that catalog, including its real hub
and mode, rather than inventing a project or provider. Rebinding always starts
from the original trusted host, not an earlier bound closure.
Existing inherited policy hooks remain gates: known blocks are preserved,
malformed/vacuous passing evidence is rejected, and passing inherited checks
and evidence accompany the Cowork result.

The policy and routing registry are snapshotted. The stable review intent binds
the run, qualified task key, immutable accepted task/project data, and accepted
policy. Repaired artifact versions and current source revisions do not reset
review history. Changing accepted task/policy data in an existing history scope
requires explicit reconciliation.
For issue-backed tasks, immutable `sourceItem` data remains part of that accepted
task identity. The catalog task is loaded by qualified key from the journal;
its host-registered PR comes separately from `OrchestrationTaskState.pullRequest`.
Only that independently recorded PR may augment the effective request task.
Legitimate planning-to-registration-to-verification transitions do not reset or
invalidate history. Forged PRs, omitted registered PRs, and all other changes to
the effective task are rejected. The original effective PR-bearing request is
still retained in invocation evidence and passed to executors, authorizers, and
human approvals.

The dynamic invocation remains separately bound to its exact original request,
revision, artifacts, and prerequisite contract hashes. Review context uses
`projectId = project.id` and `taskId = task.id`; qualified contract keys such as
`api:one:api` remain intact. Independent tasks may have `contracts: {}`. Phase
artifact references are SHA256 digests of the actual artifact values;
`artifacts["host-request"]` retains the core's dynamic `request.intent`.
Critical approvals see this exact dynamic context and the executed reviewers,
not merely the stable history intent.

Stage gates cover specify/research, plan and decompose/design, and implement
and fix/build. The producer's original completed receipt and independently
resolved source are persisted **before** critic dispatch. The core also
checkpoints its original producer artifact/source while the phase is running.
Review is handled by the execute wrapper, not assessed twice. Verification
uses the verification critic after actual acceptance/contracts are collected.
Its returned scope preserves the real acceptance scope; governance and critic
checks supplement, rather than replace, those acceptance checks. A phase
critic's positive scope refers to the one exact, independently attested
producer artifact it evaluated, not a worker count.

Only an independently attested, audited `blocked / blocking-findings` outcome
with nonempty blocking findings becomes a completed worker receipt containing
canonical `category:signature evidence:reference` blockers for the core's
existing bounded repair loop. Advisory findings stay in the full audit/artifact
but never enter that blocker array. Ready review returns complete evidence with
no blockers. Authorization denial or invalid input with empty findings,
critical human gates, and known stops return failed receipts, never empty
completed success or repair proposals. Unknown or stale outcomes preserve
uncertainty. Change-request-proposal critics and factory integration belong to
the separate peer pipeline, outside this adapter.

## Atomic durability and conservative recovery

One versioned `cowork-policy:<SHA256 scope>` projection in the core journal
contains **both** contiguous review history and all invocation reservations,
receipts, attestation dispositions, audits, and final outcomes. Adapter-owned
schema validation checks the unknown journal value before use; it is not cast
to trusted state. Values must be bounded plain JSON within the journal's 1 MiB
limit.

Before external review/critic execution, a single fenced CAS atomically
allocates the attempt and reserves the invocation in that same projection.
Each returned receipt is saved as **unverified** evidence before attestation;
the independent attestation disposition is saved before another external step.
The terminal update includes both the full final result and history signature.
Projection plus append-only event are committed by the journal in the **same
SQLite database** with its original live fence. There is no terminal/history
split-record crash gap, history prefix truncation, or second adapter database.

Signal abort, lost fence, stale revision, CAS conflict, malformed or oversized
evidence, and unconfirmed external outcomes cannot become success. Reserved and
unknown entries block new dispatch/attempts until explicitly reconciled.
Completed exact-invocation replay also refuses redispatch or cached authority.
The adapter intentionally supplies no automatic reconciliation or cached
approval reuse: a trusted operator must establish the actual external outcome
and repair the journal/core state through an appropriate reconciliation path.
A late callback from an old pass cannot adopt a later pass's lease.

The worker protocol's existing artifact/findings bounds remain unchanged.
If complete evidence cannot fit a worker artifact, the adapter returns unknown
and retains the available full journal evidence; it does not truncate evidence
or claim successful completion.

## Focused validation

`src/MultiProjectCoworkPolicy.test.ts` exercises the real core with independent
and contract-integrated tasks, repair across revisions, source checkpoints,
same-database reservations/history, injected CAS failures, critical approval,
blocking/advisory outcomes, stale fences, restart/abort/core deadlines,
governance applicability and zero-scope rejection, actual callback context, and
framework/identity rejection.

**All executors, attesters, collectors, acceptance commands, and approvals in
these tests are fixtures.** They prove adapter/core behavior, not that a
production framework executed a critic or that production governance passed.
The caller must supply and validate real host capabilities separately.

```powershell
npm run typecheck
npm test -- --reporter=dot --maxWorkers=2 --testTimeout=30000 src\MultiProjectCoworkPolicy.test.ts
```
