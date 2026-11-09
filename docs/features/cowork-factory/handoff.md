# Deterministic factory implementation handoff

## Delivery and boundaries

This slice implements the [spec](./spec.md), [plan](./plan.md), and
[decomposition](./tasks.md) as callable TypeScript modules. It does not own
the scheduler, CLI, central exports, live provider mappings, or task/PR registration.
No real issue, work item, PR, merge, deployment, or automation was created.

Planning was persisted through DevSquad specify, plan, and decompose before
implementation. Local evaluation uses fixture workers and fake hubs, not a
live DevSquad executor. Production execution must use the core's explicitly
configured, host-attested framework route; a generic worker stage name is
not evidence of a DevSquad/spec-kit invocation.

The review dependency is `CoworkReviewContract.ts`. The execution request and
receipt aliases consume its six-stage critic types, not parallel declarations.
Core should adapt `runCoworkStageCritic` through the execution host's `critic`
and `attestCritic` callbacks. Receipt family strings alone never establish
independence or authority.

## Callable integration surface

All source paths below are repository-relative, under `src/`.

| Module                             | Integration exports                                                                                                                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CoworkFactoryContract.ts`         | `CoworkFactoryStore`, `CoworkFactoryRecord`, `CoworkFactoryEvent`, `coworkFactoryRecordSchema`, evidence/rule/candidate schemas, `coworkDigest`, `readCoworkRecord`, `writeCoworkRecord` |
| `CoworkFactory.ts`                 | `evaluateCoworkSignal`, `intakeCoworkSignal`, `proposeCoworkItem`, `normalizeCoworkItem`, `publishCoworkItem`, `reconcileCoworkItem`, `CoworkItemHost`                                   |
| `CoworkFactoryImpact.ts`           | `CoworkContractChange`, `CoworkConsumerMapping`, `CoworkImpactHost`, `evaluateCoworkImpact`, `persistCoworkImpact`, `coworkCompatibilityTask`, `CoworkCompatibilityTask`                 |
| `CoworkMeasuredLoops.ts`           | `evaluateCoworkAcceptance`, `evaluateCoworkTestSpeed`, `coworkBottomDecile`, `evaluateCoworkDocumentQuality`, loop policy/history/reservation/completion functions                       |
| `CoworkMeasuredLoopsExecution.ts`  | `runCoworkEvidencePipeline`, `CoworkEvidenceExecutionHost`, shared critic request/receipt aliases                                                                                        |
| `CoworkMeasuredLoopsComparison.ts` | `runCoworkQualityComparison`, host comparison/provenance callback contract                                                                                                               |
| `CoworkFactoryRelease.ts`          | `createCoworkReleaseProvider`, `evaluateCoworkRelease`, `observeCoworkRelease`, `coworkReleaseRecurrenceCandidate`, normalized registration/observation contracts                        |
| `CoworkFactoryExample.ts`          | `runCoworkFactoryLocalExample(store)`                                                                                                                                                    |

The local example exercises mixed GitHub/ADO compatibility fan-out,
independent fixture criticism, isolated baseline failures/candidate passes,
speed and document decisions, and simulated exact-revision production
observation. `CoworkFactoryExample.test.ts` is its executable entry point.
Its `fixture-only` result is not a production-validation claim.

## Same-database persistence adapter

`CoworkFactoryStore` intentionally owns no storage implementation:

```ts
interface CoworkFactoryStore {
  read(key: string): Promise<{ version: number; value: unknown }>;
  compareAndSwap(
    key: string,
    expectedVersion: number,
    record: CoworkFactoryRecord,
    event: CoworkFactoryEvent,
  ): Promise<boolean>;
}
```

Core maps these directly to `journal.readHostRecord(key)` and
`journal.compareAndSwapHostRecord(run, lease, key, expectedVersion, record, event)`.
Use the initialized run's live fence and the SAME canonical FULL/WAL SQLite DB.
Keys are `factory:<sha256>`; absent state is exactly version zero/value null.
Validate records using `coworkFactoryRecordSchema`; check event intent, kind,
timestamp and `recordDigest === coworkDigest(record)` before the journal call.
No second ledger, filesystem fallback, or production in-memory adapter is supplied.

CAS acknowledgement must mean projection plus event were durably committed.
Returning false means a conflict. Exceptions propagate rather than becoming
success-shaped fallbacks. Reserved or unknown publication/measurement state
must remain non-retryable across restart; host reconciliation is required.
`CoworkMemoryStore` in test support only models shared-object replay, not
process-crash recovery, SQLite durability, or distributed exactly-once delivery.

## Impact-to-agent registration

Call `evaluateCoworkImpact(change, mappings, options)` with independently verified
source revisions/contract hashes and declared consumer mappings. Models cannot
invent dependency edges. Unchanged or already-matching consumed contracts produce
no item. Unknown consumed versions block. Fan-out divides the remaining global
propagation budget among children; lineage rejects cycles and configured depth
bounds stop cascades.

Persist each candidate through `persistCoworkImpact`, then build the canonical
proposal and call `publishCoworkItem` in approved mode. A trusted configured
route can authorize automatically without a fresh per-item prompt; authority
still binds exact destination, source, contract, content and operation. The
default call previews and invokes no host writer.

Use only a completed, independently verified item receipt to derive
`coworkCompatibilityTask`. It contains upstream origin, source/base revisions,
required contract digest, downstream project/rule, lineage/depth/budget,
optional supersedes reference, and source item target/receipt.
Its `cause` carries publication record key/version/digest.

Before `appendCatalogTasks(run, lease, tasks, cause)`, core must independently
verify the retained publication record, candidate source/mapping provenance,
current configured route authority, and exact receipt. The returned task object
is not authority. Atomically deduplicate the catalog delta by cause key and
register a narrow issue-backed task. `registration: "awaiting-change-request"`
does not assert publication, passing CI, or a PR identity. Register any later PR
separately in host state; do not mutate the running worker's frozen intent.
A later upstream revision requires explicit retained-head supersession/follow-up.

## Evidence and bounded execution

`runCoworkEvidencePipeline` reserves an attempt before execution, applies
research/design/build/verification/review/change-request-proposal criticism,
and invokes isolated baseline/candidate fixtures. Each execution has nonzero
case/assertion scope, distinct fixture/execution identities, exact revisions,
fresh observations, matched workload/environment, and protected checks.
Default two repeats must fail without the change and pass with it.
Freshness defaults to 60 seconds and is configurable by host policy.

The host authorizes each frozen invocation, attests actual execution and critic
provenance, and verifies evidence independently. Unknown dispatch retains the
reservation rather than consuming a fabricated successful result.
Bounded/cancellable calls do not authorize forcibly killing a host's process.
The isolated runner must stop or reconcile its own work on cancellation.

`runCoworkQualityComparison` requires a retained successful executed pipeline
record bound to the same project/base/candidate revisions plus independent host
attestation. Pure gate results alone are not execution proof.
Speed requires matched millisecond samples, at least 5% improvement, assertion
and behavior parity, bounded noise, and no protected metric regression.
Documents fix the benchmark/evaluator/task set, require wins greater than
losses, protect the mean of the lowest `ceil(N/10)` scores, and reject hard-check
regressions. Ties do not expand tail membership; identical outputs with changed
scores are inconclusive.

The durable policy binds ID/version/digest, target, protected metric, deadline,
human actions and attempt consumption. Defaults are three attempts and a stop
on the second repeated signature. Explicit policy-specific limits may be up to
20 attempts. Rejection is a proposal outcome, never an authorized destructive
rollback.

## Release provider and remaining limitations

`createCoworkReleaseProvider` is an executable injected boundary making four
read-only normalized resource requests: builds, artifacts, deployments, metrics.
Actual native GitHub/ADO CLI/API response translation and authentication remain
host integration responsibilities. This slice does not claim a working live
production telemetry connection.

Supply a host-attested registration tying the originating candidate/revision
to the exact merged commit and configured first production ring. Successful
build and artifact membership must contain that exact revision. Compare fresh
post-deployment objective and protected metrics from the same timestamp and
evaluated scope. Missing evidence awaits; incompatible/protected regressions
are inconclusive. Configuring `observeCoworkRelease` with `recurrenceRule`
durably creates one recurrence candidate through the same CAS store, including
on observation replay; its rule must match the originating objective.
Without a configured recurrence rule, the resurfaced result contains a stable
recurrence identity for host handling, not an invented ticket policy.

Core must still supply real same-DB crash/fence/catalog integration, public
exports and CLI composition, explicitly configured framework executors,
host/provider evidence attestation, trusted hub mappings, and release telemetry.
No platform-dependent old POSIX ledger code was changed. Central README and
public entrypoint documentation remain with the integration owner.

## Verification record

Final local results on Node 22.18.0 / Windows:

| Check                                                                                | Result                                                                 |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `npm run typecheck`                                                                  | Passed                                                                 |
| Seven owned test files plus three peer review/governance test files                  | 164 passed: 104 owned, 60 peer; no skips                               |
| `npm run build --ignore-scripts`                                                     | Existing ESM bundle and DTS build passed                               |
| `npx tsc --emitDeclarationOnly --outDir <session-files>/cowork-factory-declarations` | All source declarations, including owned modules, emitted successfully |
| `node scripts/check-public-types-effect-free.mjs`                                    | Existing public declarations contain no Effect references              |

The existing POSIX template-copy postbuild was deliberately excluded on Windows;
this is not a claim that the unmodified full postbuild ran. Central exports do not
yet include this slice, so the existing public bundle check alone is not proof of
factory public API wiring. Owned declarations were emitted separately into session
artifacts, not committed generated files.

Owned offline tests cover deterministic rules, mixed-hub preview/approved
transports, duplicates and uncertain writes, impact fan-out/follow-up/bounds,
negative controls, exact speed boundary, document tail/hard checks,
attempt/deadline/repeat stops, release provenance and recurrence, and the
local composed example.
These results verify the injectable behavior only, not real hub mutation,
production outcomes, or core SQLite integration.
