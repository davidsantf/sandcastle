# Cowork multi-project host

## Runnable offline composition

Node 22.13+ is required. With existing dependencies restored:

```powershell
npx tsup
node .\dist\main.js orchestrate --cowork-demo .\.sandcastle\cowork-demo
node .\dist\main.js orchestrate --cowork-demo .\.sandcastle\cowork-demo
```

The public `runMultiProjectCoworkDemo(directory)` uses one real SQLite journal.
It completes independent API/docs lanes, publishes a synthetic ADO compatibility
item for the API consumer, dispatches its scoped worker and independently
registers its PR. It consumes the real review/stage-critic adapter, instruction
and AST dependency evaluators (including invalid fixtures), executed isolated
fail-before-fix pairs, >=5% timing/assertion-parity comparisons, fixed-document
wins/tail/hard-check comparisons and read-only first-ring observer.

Everything external is **fixture-only**: scripted workers, configured framework
identities, independent attestations, native item responses, timing/document
scores and release data. No installed DevSquad execution, network write, merge
or deployment occurs. Named DevSquad invocation is exercised separately by
injected worker integration tests, not claimed as live evidence.
Restart dispatches no completed workers and republishes no item/PR. Read-only
release observations may be refreshed and appended on later passes.

## Real configured host

A trusted module exports `{catalog, journalPath, host}`:

```powershell
sandcastle orchestrate --config .\.sandcastle\orchestration.mjs
```

Compose the actual exported adapters:

```javascript
import {
  createMultiProjectSandcastleHost,
  createDevsquadOrchestrationWorker,
  createCoworkOrchestrationHost,
  createCoworkOrchestrationFactory,
} from "@ai-hero/sandcastle";
import {
  catalog,
  journalPath,
  executionControls,
  sandbox,
  baseControls,
  reviewControls,
  factoryControls,
} from "./trusted-host-controls.mjs";

const base = createMultiProjectSandcastleHost({
  ...baseControls,
  execute: createDevsquadOrchestrationWorker({
    ...executionControls,
    sandbox,
  }),
});
const reviewed = createCoworkOrchestrationHost({
  ...reviewControls,
  host: base,
});
export default {
  catalog,
  journalPath,
  host: createCoworkOrchestrationFactory({
    ...factoryControls,
    base: reviewed,
  }),
};
```

`trusted-host-controls.mjs` is deliberately site-specific, not supplied authority.
It must resolve the installed DevSquad capability in the selected worker runtime,
bind named agent/definition/model-family/provider identity, authorize execution
and independently attest the result. Copilot CLI `--agent` is the actual executor
route. Missing/mismatched capabilities have no generic fallback. Review requires
an exact available framework capability and a different canonical model family.
Critical changes require independently verified human approval. The existing ADO
phase adapter does not accept reviewers; do not bypass it or relabel generic work.

Factory configuration supplies producer/consumer contract mappings, scopes,
acceptance commands and exact destinations. `inspectChange` verifies the completed
upstream task's actual revision/contract artifacts. `impactHost` independently
verifies change/mapping, `itemHost` verifies evidence/authority/receipt, and
`authorizeRegistration` authorizes scheduling. `createCoworkNativeItemHost` maps
GitHub POST issue JSON and ADO work-item PATCH JSON through an injected native
transport. Credentials belong only in that transport, never generated prompts.

An issue-backed task starts `awaiting-change-request`; it never borrows the
project's default PR. `changeRequests` reserves, creates and independently attests
the exact PR/revision. State records the PR for verification/review, preserving
the catalog and original implementation intent.

Optional `signals` supplies trusted evidence/versioned rules and distinct
scheduling authorization. Optional `validateTask` executes
`runCoworkEvidencePipeline` and applicable `runCoworkQualityComparison` gates
against isolated fixtures with independent attestations. Generated work blocks
when this capability is missing; pure gates alone are not execution proof.
Optional governance collectors cover only supplied scope; absence is not coverage.
Optional `observeRelease` consumes `observeCoworkRelease` with
`createCoworkReleaseProvider`. Exact merged SHA/build/artifact/first configured
production ring and same-window protected metrics are mandatory. Native telemetry
JSON translation is a configured read transport, not a bundled live integration.

## Durability and limits

Each bound adapter captures an immutable fence. `createCoworkJournalStore`
atomically commits validated records/events in the same journal DB. Critic
reservations, attestations, outcomes and contiguous review history use fenced
CAS projections. Catalog generation, cause and new task state append atomically.
Unknown/reserved external outcomes never redispatch; independent receipt-bound
reconciliation is required.

Factory `coworkDigest` canonicalizes object keys; historical journal `digest`
preserves JSON serialization order. The adapter validates the canonical receipt,
then derives the journal cause from retained JSON. These are not interchangeable.

Routes validate project identity, DAG and literal scopes. Impact provenance retains
revision, contract hashes, rule/destination, lineage and divided global budget.
Cycles, repeated lineage and exhausted budgets cannot broaden dispatch. Later
versions require explicit supersession/follow-up, never changes to B's running
intent. Unknown impact produces evidence-needed; independent lanes still finish.

Host callbacks are trusted boundaries. Policy checks are not OS-level enforcement;
backend credential/network isolation is not universally guaranteed. Validation
does not provision cloud hosts or perform live tickets/PRs, merges, deployments
or recurring automation. The existing POSIX production ADO ledger is unchanged.
