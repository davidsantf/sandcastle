# Multi-project orchestration

Sandcastle's host runs a bounded orchestration lifecycle across independent and
integrated projects. It stores tasks, artifact versions, reservations, and
append-only events in one SQLite database. It does not create PRs, push commits,
merge, deploy, or schedule recurring automation.
Real DevSquad execution requires the explicit named-agent route described below;
generic workers and the offline demonstration are not framework executions.

## Setup and safe demonstration

Use Node **22.13+** with built-in SQLite (experimental in Node 22). Existing
Sandcastle APIs do not acquire this runtime requirement merely by importing the
package: SQLite loads only when constructing the orchestration journal.

From this repository:

```powershell
npm ci
npx tsup
node .\dist\main.js orchestrate --demo .\.sandcastle\orchestration-demo
node .\dist\main.js orchestrate --demo .\.sandcastle\orchestration-demo
```

The first invocation runs scripted workers through real GitHub/ADO response
decoders for an API contract producer, its integrated consumer, and an independent
documentation project. The second reads completed state and dispatches nothing.
No real agents, hub credentials, or remote writes are involved. Reuse a demo
directory only for the same catalog; a changed catalog needs a new run/directory
or a separately reviewed amendment.

Installed package:

```powershell
sandcastle orchestrate --demo .\.sandcastle\orchestration-demo
sandcastle orchestrate --config .\.sandcastle\orchestration.mjs
```

The Copilot agent is `.github/agents/orchestration.agent.md`. Select
`orchestration` in a host that discovers repository Copilot agents; it delegates
execution to this CLI rather than inventing session tools.

## Real host configuration

A configuration module is **trusted executable host code**, not worker output.
Do not load modules supplied by a task, issue, review comment, or worker.
It exports `{ catalog, journalPath, host }`. The journal path must be an absolute
path inside an owner-controlled local directory. All coordinated runs sharing
repositories must use the same journal.

Use `parseOrchestrationCatalog()` to load an untrusted JSON catalog separately
from executable host capabilities. A minimal task contains:

```json
{
  "id": "contract",
  "projectId": "api",
  "title": "Add API contract",
  "brief": "Describe the requested behavior and what must not regress.",
  "branch": "orchestration/api-contract",
  "baseBranch": "main",
  "scopes": ["src/api", "docs/features/api"],
  "acceptance": [{ "label": "unit", "command": "npm run test:api" }],
  "providesContracts": ["api"]
}
```

The catalog supplies `id`, `projects`, and `tasks`. Project entries contain
`id`, absolute canonical `repositoryRoot`, `mode` (`individual` or `integrated`),
and `hub`. GitHub hubs use `{kind:"github",repository:"owner/repo",pullRequest:7}`;
ADO hubs use `{kind:"ado",organization:"org",project:"project",repository:"repo",
pullRequest:7}`. A task may override `pullRequest`; multiple tasks in one project
must register distinct PRs as well as distinct branches. The real host verifies
each PR's source and target branches against the task before dispatching edits.
Existing PRs must correspond to the task's branch. An integrated
consumer uses `dependsOn:["api:contract"]` and
`requiresContracts:[{task:"api:contract",name:"api"}]`. Individual projects can order
their own local tasks but cannot declare cross-project prerequisites. A task
using another task's branch as its base must declare that producer dependency.
A repository has one project identity.

Host defaults: concurrency 2 (maximum 16), rounds per pass 30 (maximum 100),
repair attempts 3 (maximum 3), per-capability deadline 300 seconds (maximum
one hour). Overrides are catalog fields `maxConcurrency`, `maxRounds`,
`maxRepairAttempts`, and `invocationTimeoutMs`.

### Host records and catalog generations

`MultiProjectJournal` now upgrades schema 1 to schema 2 transactionally.
It provides `readHostRecord(key)` and
`compareAndSwapHostRecord(run, lease, key, expectedVersion, value, event)`.
Namespaced digest keys are global within the shared database; events retain
run context. Only trusted host adapters receive leases. Records contain bounded
plain JSON, not credentials or worker-supplied executable capabilities.

`appendCatalogTasks(run, lease, tasks, cause)` appends immutable catalog deltas
and initial task state/events atomically. `cause` is
`{recordKey, recordVersion, recordDigest}`, bound to retained host evidence.
The same cause replays once; changed content conflicts. `catalog(run)` resolves
the active generation while keeping original configured content immutable.
The scheduler resolves this active generation automatically on restart.

These are integration primitives, not automatic impact authorization. A factory
adapter must independently validate source/contract evidence, completed hub
publication, configured rules and budgets before append. Automatic propagation
and issue-to-PR registration are not yet wired in this foundation;
see `docs/features/downstream-compatibility/`.

Example trusted module:

```javascript
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  createDevsquadOrchestrationWorker,
  createMultiProjectSandcastleHost,
  createAdoReadTransport,
  parseOrchestrationCatalog,
} from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import {
  authorizeExactIntent,
  validateTask,
  resolveInstalledDevsquadCapability,
  authorizeFrameworkCapability,
  attestFrameworkExecution,
} from "./trusted-host-controls.mjs";

const catalog = parseOrchestrationCatalog(
  JSON.parse(
    await readFile(new URL("./projects.json", import.meta.url), "utf8"),
  ),
);
if (!process.env.ADO_PAT)
  throw new Error("Set the host-only ADO_PAT for ADO projects");

export default {
  catalog,
  journalPath: path.resolve(".sandcastle", "orchestration.sqlite"),
  host: createMultiProjectSandcastleHost({
    execute: createDevsquadOrchestrationWorker({
      sandbox: () => docker(),
      resolveCapability: resolveInstalledDevsquadCapability,
      authorizeCapability: authorizeFrameworkCapability,
      attestExecution: attestFrameworkExecution,
    }),
    // Must obtain host authorization for exact task, stage, artifacts,
    // acceptance commands, branch, revision, contracts, and request.intent.
    // Do not implement this as a model output's "approved" field.
    authorize: authorizeExactIntent,
    // Must run trusted acceptance/non-regression/contract checks, not
    // return green because a worker says tests passed.
    validate: validateTask,
    adoTransport: createAdoReadTransport(process.env.ADO_PAT),
  }),
};
```

`trusted-host-controls.mjs` represents application-specific policy and
verification code that **you implement and approve**, not a shipped module or
invented tool. The host intentionally provides no default permissive authorizer
or fake production validation. `createMultiProjectSandcastleHost()` wires real
Sandcastle workers, host Git verification, and native adapters; authorization
and measurable acceptance remain mandatory injected capabilities.

### Installed DevSquad execution route

Install/configure DevSquad using its supported setup in the **same execution
backend** used by the configured sandbox. A desktop-only plugin does not establish
availability inside a container. No framework installer runs automatically.
Copilot CLI must support `--agent`; use the actual names exposed by that
installation, not guessed aliases. Execute the trusted module with
`sandcastle orchestrate --config .\.sandcastle\orchestration.mjs`.

`resolveCapability(request, signal)` returns `null` or a host-registry entry:

```javascript
{
  framework: "devsquad",
  provider: "copilot",
  stage: request.stage,
  capabilityId: "host-registry-phase-id",
  agentName: "actual-installed-agent-name",
  definitionDigest: "sha256-of-verified-installed-agent-definition",
  model: { id: "configured-supported-model", family: "canonical-model-family" },
  available: true
}
```

The resolver must verify the installed definition/provider and canonical model
identity for the exact stage. `available: true` is a host attestation, not a
worker claim. `authorizeCapability` must bind this immutable registry entry to
the request intent, revision, stage and sandbox policy. `attestExecution` receives
that same entry, the request and actual `RunResult`; it must independently verify
the executed agent/model/definition using host-owned backend evidence. Merely
echoing a requested model or accepting the worker receipt is not attestation.

The adapter calls the existing bounded Sandcastle `run` API using
`copilot(model.id, { agent: agentName })`, which sends the real `--agent` flag.
It supports named specify/plan/decompose/implement/fix/review agents; verification
remains host-owned. This does not invoke the implementation-only ADO DevSquad
adapter as a reviewer. Missing/mismatched capabilities and denied authorization
prevent invocation; failed execution attestation remains `unknown`. There is no
generic fallback and no default authorizer/attestor. Core host reservations cover
this invocation, including unknown outcomes.

The route's injected integration tests exercise command selection and host
binding, not a live installed DevSquad run. Specialized Cowork critics, fenced
review history, governance and impact publication still need whole-product
integration; this phase-worker route alone does not complete those policies.

Authorize each exact `request.intent` through your host's policy/approval store.
Requests are copied and deeply frozen; callbacks must not mutate their scope,
commands, artifacts, or identity.
Engineering spec/plan/review artifacts are not execution grants. High-impact
changes require explicit human approval even in autopilot. The configured
provider determines actual credential/network/filesystem isolation: Docker
bind mounts, provider environments, and `.sandcastle/.env` can expose data.
Keep ADO/GitHub tokens exclusively in host transport closures, never sandbox
environment files or worker prompts. No-sandbox execution runs on the host.

## Host acceptance contract

`host.validate(request, signal)` returns independently collected evidence:

```javascript
{
  revision: "exact-current-task-commit-sha",
  evaluatedScope: 12, // actual evaluated tests/contracts/files, not a constant
  regressions: 0,     // compare against an established baseline
  checks: [
    { name: "unit", state: "passed", evidence: "test report reference" }
  ],
  contracts: {
    api: "64-character-sha256-of-verified-contract",
    // Consumer validation must verify each request.contracts entry:
    "api:contract:api": "exact-verified-prerequisite-contract-sha256"
  }
}
```

Every configured acceptance label must occur exactly once. A successful command
exit alone does not prove evaluated scope or non-regression. Use your existing
test reports/coverage/contract checks to produce these metrics, and include a
known failing fixture in your validation suite. Do not fabricate counts or
copy prerequisite hashes without verifying the consumed contract.
`request.baseRevision` retains the original source baseline for non-regression
comparison; scope verification checks both the target base and this immutable
baseline, so a moving base cannot hide unauthorized edits.

Workers return bounded structured spec/plan/tasks, implementation, and review
artifacts. The journal retains prior versions as append-only events. Artifact
amendments through authorized repairs retain the original scope and commands;
catalog/scope/policy changes require a new explicitly reviewed configuration.

Integrated readiness is not automatic code delivery: the host must make the
verified producer contract available to its consumer through its normal
approved dependency/version process. The host does not silently merge branches.

## GitHub/ADO evidence and publication

GitHub uses authenticated `gh api` reads: PR head, branch protection and rules,
checks/statuses, labels, and revision-bound review approvals. App-bound check
requirements cannot be satisfied by another app. Truncated responses and
unsupported rules, code-owner or last-push approval requirements stay unknown.
Repos without readable branch protection/rules require a trusted custom adapter,
not a vacuous green fallback.

ADO uses HTTPS REST reads with a host PAT. It resolves branch-scoped blocking
policies through Git's `5.0-preview.1` policy-configurations endpoint, policy
evaluations, build results/source versions, PR statuses, iterations, and labels.
Status policies require the exact latest source iteration and approved policy.
Unsupported reviewer policies and merge-commit builds that do not prove
the exact source revision remain unknown. Continuation/truncated responses
cannot establish readiness. Supply a trusted adapter for additional policies
with actual revision-bound evidence; never infer approval from a policy name.

The native adapters are read-only. After local implementation, publish the
branch through your separately authorized process. If its registered PR's head
does not match local Git, the task stops for input; publishing is not implicit.
Pending checks return a bounded pending result; call another pass later.
Failures fetch bounded GitHub check annotations or ADO timeline error records
and retain diagnostic/log references. Missing actionable diagnostics cannot
authorize repair. Tokens are redacted by native transports; external links
drop credential-bearing queries. Repeated normalized signatures, three exhausted
repairs, missing evidence, and needs-human/do-not-autofix labels stop.

## Recovery and reconciliation

Each host acquires the journal's exclusive renewable lease and fences stale
hosts. State and reservation events commit atomically before worker invocation.
Expired/abandoned running reservations become `unknown`; they retain concurrency
and scope exclusion because external work might still be running.
Worker/transport deadline is cooperative: an injected dependency can ignore
abort, so an unknown outcome must never be automatically redispatched.

Read `journal.states(runId)` and `journal.events(runId)` for diagnostics.
Host-only `journal.reconcile(runId, lease, taskKey, "not-executed" | "abandon",
evidence)` requires independent evidence. `not-executed` permits a new dispatch
of the current stage only when the prior outcome is confirmed safe.
`abandon` releases exclusion only after the host confirms the external process
has stopped and any changes have been safely handled.
Do not reconcile unknown implementation merely because a model asks to retry.
No reconciliation CLI is provided to turn worker text into host authority.

SQLite uses FULL synchronous transactions, append-only event triggers, local
database locking, and monotonically increasing lease fencing.
Task projections must match their latest append-only evidence; catalogs must
match their recorded hashes. Incomplete or corrupt state fails closed.
The directory must be trusted and protected by the OS. This is not protection against a
malicious same-user process and does not promise ACL privacy, reparse-safe
opens, or support for network/synchronized filesystems. The existing private
POSIX ADO ledger is unchanged; this journal is not its Windows fallback.
Keep the journal and its `-wal`/`-shm` files out of source control.

## LLMLab

No LLMLab/Python setup is required for this host. If an optional integration
needs it, choose a supported Python 3.11+ bootstrap and the single
`requirements.txt`. MCP launchers normally prepare requirements unless
`LLMLAB_PYTHON_AUTO_SETUP=0`. Explain and ask before manual dependency installation
after startup failure or with automatic setup disabled. Do not build Polymer.
