# Native discovery and proposal intake

## Specification

Discovery reads only explicitly configured GitHub repositories or Azure DevOps
projects. A source must select an exact assignee or an explicit opt-in label/tag.
Repository access alone is not consent. The trusted focus policy must additionally
grant `discover`; `investigate`, `implement`, and publication are separate grants.
Hub descriptions, comments, relations, and model artifacts are untrusted data.

One canonical workspace CAS store retains source cursors, latest item revisions,
proposal artifacts, review decisions, dispatch reservations, and uncertain
outcomes. The service supplies its fenced store; adapters must never retain an
unguarded store or open another database. Replayed observations do not redispatch.
Changed revisions supersede earlier proposals and invalidate their approvals.

An investigation produces an investigation artifact, specification, implementation
plan, and measurable acceptance proposal using installed named DevSquad phase
routes. An approval binds the complete proposal digest, source revision, and
configuration revision. It does not publish an artifact, create an item or PR,
or grant downstream permission. Implementation additionally requires current
focus authority and the existing executor's exact intent/proof/receipt checks.
Attempted operations with unknown results are never automatically repeated.

## Implementation plan and acceptance

1. Ship bounded native GitHub CLI and ADO authenticated transports. Persist
   pagination cursors only after all observations in a page are retained. Fetch
   review feedback and dependency relations into the revision; reject partial
   evidence, invalid selectors, oversized responses, and rate-limited reads.
2. Store one source/item aggregate with latest revision and bounded proposal
   history using CAS. Reserve planning and dispatch before invoking callbacks.
   Keep unknown outcomes explicit after exceptions or process interruption.
3. Use trusted focus policy and the service operation ledger at every effect.
   Execute real named phase workers through the existing DevSquad worker adapter;
   never relabel generic workers or synthesize successful identity/validation.
4. Test page replay/restart, revision changes, stale approvals, rejected proposals,
   races, cancellation, denied policy, and real callback invocation. Live checks
   are read-only and scoped to this configured repository; fixture results are
   not evidence of live framework execution.

## Runtime and rollout boundaries

Node 22.13+ and existing authenticated `gh` are used for GitHub discovery. ADO
uses an existing host-only bearer/PAT credential supplied to its transport.
Credentials never enter source catalogs, stored intents, prompts, or diagnostics.
No runtime, Python interpreter, agent, or authentication configuration is installed
or upgraded. The reported LLMLab Python 3.14.3 requirement is independent of this
Node-based host: select an already installed matching interpreter explicitly for
LLMLab; these adapters do not bypass that requirement.

Installed agent definition hashes prove configuration integrity, not execution
identity. If the selected backend has no independent agent/model execution
evidence, setup reports that gap and dispatch remains blocked. Worker output is
never accepted as host attestation. Acceptance commands must be trusted host
configuration, not commands copied from discovered work.

## Concrete host composition

The central workspace configuration owns `discovery`, `runtime.phaseDefinitions`,
focus permissions, and trusted task templates. These modules do not write another
configuration file or workflow database. Register the source against an existing
project with the exact same hub:

```json
{
  "id": "assigned-work",
  "projectId": "api",
  "hub": { "kind": "github", "repository": "your-org/your-repo" },
  "selector": { "optedInLabel": "orchestration-opt-in" },
  "pageSize": 10,
  "maxPages": 5,
  "includeReviewFeedback": true,
  "includeDependencies": true
}
```

Use either `assignedTo` or `optedInLabel`, never an unrestricted selector. GitHub
uses the existing `gh` account. For ADO, register
`{kind:"ado",organization,project,repository}` and provide
`createOrchestrationAdoReadTransport({kind:"bearer"|"pat",token})` from the existing
trusted host credential context. The token stays in that transport closure.
There is deliberately no credential lookup from work item text or catalog data.
Native sources/items currently supply no independently verified team, iteration
or query facts. If any of those optional focus selectors is configured, native
polling, planning and dispatch fail closed **before any transport or worker
call** with an explicit unverified-mapping diagnostic. A configured focus value
is a restriction, never evidence that a discovered target satisfies it. Supporting
these selectors requires a real native source/item mapping; that capability gap
is separate from missing backend execution identity.
ADO work discovery uses the project **name**, exact identity unique name/ID rather
than ambiguous display names, and semicolon-delimited exact tags. Dependency
targets must pass a project-scoped WIQL membership check before their detail is
read; foreign-project relations block the observation. Linked PR feedback must
match the configured repository and the relation's project identity.

Host-side integration uses the actual exported factories:

```ts
const configured = createConfiguredDevsquadProposalPlanner({
  configuration,
  tasks: configuration.taskTemplates,
  evaluateFocus: evaluateOrchestrationFocus,
});
const readiness = await configured.preflight(signal);
const tick = createOrchestrationNativeTick({
  evaluateFocus: evaluateOrchestrationFocus,
  planner: configured.plan,
});
```

Pass `tick` to the local service using the service's immutable configuration,
captured cancellation signal, guarded canonical `WorkspaceStore`, and operation
admission API. Passing `configured.plan` unbound is supported. Native preflight
does not launch a worker, install an agent, or alter authentication. Readiness
contains `runtime` (provider, observed CLI version and named-agent/model flags),
`missingConfiguration`, `missingCapabilities`, `executionReady`, and the combined
`diagnostics`. CLI callers should inspect readiness before reserving a planner
effect. If callers invoke planning anyway, a known pre-effect readiness failure
is retained as `blocked`, not disguised as successful planning or a lost worker.

`runtime.phaseDefinitions` is an explicit six-stage registry for `specify`,
`plan`, `decompose`, `implement`, `review`, and `fix`. Each entry is
`{stage,agentName,definitionPath,definitionDigest,model:{id,family}}`.
Paths must be absolute canonical paths to existing named definitions; hashes are
SHA-256 of actual file bytes, not a JSON-string hash. The adapter verifies the
file, bounded size, name and current digest. These are configuration-integrity
checks, **not proof that the backend loaded that definition**. Neither the root
candidate agent name nor a model alias is an attestation.

One trusted task template per project supplies scopes, base branch and acceptance.
The configured planner rejects ambiguous templates, inherited PR/source authority,
and unresolved `dependsOn`/`requiresContracts`. It does not silently rename
dependency references. `createOrchestrationProposalTask(template,item,revision)`
derives a stable task ID/branch from the complete template, project/source/item
identity, observed revision and configuration revision. Different items, template
changes or reviewed revisions cannot borrow one shared implementation branch.
Trusted scopes/acceptance are preserved; no repository-root scope is invented.

## Proposal actions and executor boundary

`createOrchestrationProposalQueue({store,namespace:configuration.id})` exposes
`list`, `get`, `ingest`, `plan`, `review`, and `execute`. `list`/`get` return the
source snapshot for the particular proposal, including superseded revisions.
Planning actually invokes the existing DevSquad worker route three times:
investigation via `specify`, specification via `specify`, and implementation plan
via `plan`. Trusted task instructions survive, the investigation feeds
specification, and both prior artifacts feed planning. Hub text is explicitly
marked untrusted. Artifacts have this validated shape:

```ts
{
  investigation: string;
  specification: string;
  plan: string;
  acceptance: {
    criterion: string;
    verification: string;
  }
  [];
}
```

`queue.review({proposalId,proposalDigest,sourceRevision,configurationRevision,
decision:"approve"|"reject"})` binds all three revision/digest values. A stale
review fails explicitly. New source/configuration revisions supersede earlier
proposals without overwriting their source evidence; replaying old observations
cannot revive their approvals or downgrade configuration.

`createOrchestrationDiscoveryAdapter(source,transport?).refresh(item,signal)`
directly refreshes the exact item and bounded feedback/dependencies. It verifies
configured source/project identity, selectors and (for GitHub) open state.
`queue.execute({proposalId,configurationRevision},
{authorize,refresh,dispatch},signal)` checks current policy before reading,
refreshes source evidence, rechecks approval/current policy atomically before
dispatch reservation, and retains the actual dispatch receipt. Failed source
verification blocks before implementation; changed evidence supersedes approval.
`dispatching`/`unknown` outcomes suppress automatic repetition after restart.
Approval is never a publication permission.

**The default native host currently has no available framework dispatch.** Its
configured planner preflight also remains blocked on the independent identity
gap below. Supplying a sandbox, valid files, aliases or fabricated callbacks does
not unlock it. `createOrchestrationNativeTick` accepts a trusted `dispatch` bridge
for an existing **verified core lifecycle**; absent that bridge it reports an
explicit diagnostic for approved proposals rather than marking them dispatched.
The bridge must bind the canonical proposal record/version/digest to the core
task's source cause, acquire core lifecycle ownership, consume the existing exact
executor capability/proof/acceptance/receipt contracts, and return a real retained
receipt. It must not borrow a registered project's unrelated PR. Publication,
implementation and downstream effects require their separate focus grants.
This injected route is an integration surface, not evidence that default native
dispatch is live. No new central journal lifecycle is implemented here.

`createOrchestrationNativeAcceptance({checks,timeoutMs})` runs only trusted host
`executable`/`args` in an absolute configured `cwd`, without a shell or worker-
supplied command substitution. Actual process exit determines pass/fail;
missing checks fail explicitly. Process success proves a host check, not model,
framework identity, PR policy, or publication authorization.

## Bounded polling and recovery

Each poll reads one primary page, at most 20 selected items, retaining a cursor
only after observations are durably ingested. Nested GitHub evidence is bounded
by `maxPages` pages of 100; incomplete evidence fails without cursor advancement.
ADO follows bounded comments and rejects unsupported continuation/truncated
responses. Feedback ordering is normalized before revision hashing. Rate limits
use bounded retry delays; transient failures retain the cursor and exhaust the
configured attempt budget explicitly rather than retrying forever.

Recurring safe reads use focus evaluation plus cancellation and source CAS,
**not** one permanent service effect reservation per poll. Model invocations and
dispatch use stable exact-effect IDs. The queue retains up to 200 item entries,
20 proposals per item, and 950,000 serialized bytes. Capacity failure preserves
evidence; it never silently evicts an uncertain operation. `planning`,
`dispatching`, `unknown` and `blocked` entries do not automatically restart.
Operators must inspect retained journal evidence before any explicit recovery.
Changing source configuration creates a new source-state identity, not permission
to replay an uncertain effect. No automatic archival/reset command is implied.
GitHub polling is a repeated current-state observation, not an exhaustive event
log or a proof that no intermediate update occurred.

## Read-only runtime evidence

The bounded local probe used the explicitly scoped `davidsantf/sandcastle`
repository and existing credentials. No issue, label, work item, PR, merge,
deployment, worker, or external implementation was created or launched.

| Check                       | Observed evidence                                                                                                               | Meaning                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Existing runtime            | Node `v22.18.0`, `gh 2.102.1`, native `copilot.exe` CLI `1.0.106`                                                               | Existing tools; nothing installed or upgraded                                                   |
| Repository permission read  | `gh api repos/davidsantf/sandcastle`: pull true; push/admin/maintain/triage false                                               | Read access only; no work authorization inferred                                                |
| Native adapter preflight    | `readable:true`, `authority:"read-only"` after exact repository identity check                                                  | Actual transport read, not a fixture                                                            |
| Native adapter poll         | Opt-in label `orchestration-intake-validation`, page size 1/max pages 1; zero observations, cursor `{page:1,afterId:0,cycle:1}` | Actual bounded empty read; no opt-in label created and no live feedback/dependency item claimed |
| Native CLI help             | `--agent`, `--model`, `--session-id`, `--log-dir`, `--stream`, `--output-format` supported                                      | Invocation/transport options exist; flags alone do not prove executed identity                  |
| Native registry probe       | Empty explicitly supplied `phaseDefinitions` yields six missing-registration diagnostics                                        | Missing configuration, **not** a claim that no agents are installed                             |
| Default execution readiness | `executionReady:false` and missing independent backend identity capability                                                      | Execution remains blocked even if registry configuration is later supplied                      |
| ADO                         | No actual destination/credential scope selected for this probe                                                                  | ADO behavior has fixture coverage only; live ADO readiness remains unverified                   |

Supported integration paths inspected without launching a worker:

1. [Copilot stream handling](../../src/AgentProvider.ts) exposes text/tool/result
   events and terminal `sessionId`; it does not expose a trusted loaded-agent
   definition digest bound to the exact orchestration request.
2. [RunResult](../../src/run.ts) retains iterations, stdout, commits, branch and
   optional log path, not an independent executed framework identity receipt.
   The Copilot provider explicitly uses `captureSessions:false`; there is no
   configured session-storage attestation adapter.
3. Existing host session event **metadata field names only** were inspected:
   `session.start` exposes selected model/context; `session.usage_record.usage`
   exposes provider/model, usage and API/provider-call identifiers. Neither
   inspected metadata schema supplies the loaded named-agent definition digest
   plus exact phase/request-intent/revision binding. The observed producer was
   `copilot-agent` with event metadata version
   `1.0.102-0.unstable.r41779900948.gf482387`, distinct from native CLI `1.0.106`.
   That existing app session is not the configured worker's execution evidence.

This establishes a gap in the **currently integrated evidence paths**, not a
claim that every possible provider/backend can never expose such evidence.
No new CLI session was launched to obtain richer output because that would run
an effectful worker. The smallest external capability needed is backend-owned,
independently verifiable evidence binding the actual invocation and request
intent/revision, executed phase/named agent, loaded definition SHA-256, and
resolved model/family. A trusted host bridge must consume that evidence through
the existing executor's resolve/authorize/attest controls. Desired identity echoed
by configuration, worker text, a host-generated process receipt, selected-model
metadata alone, or a zero exit code cannot replace it. Additional configuration
alone therefore cannot make this default factory execution-ready.

## Verification scope

The additive tests use the actual canonical SQLite store for host integration,
fenced ownership, replay and retained queue events. Other tests cover bounded
GitHub/ADO reads, revision changes, stale reviews, rejection, concurrent/restarted
reservation suppression, blocked source verification, unknown dispatch, denied
policy, named-agent command generation, registry hash changes and actual trusted
argv process exit status. Named worker execution tests mock `run` and use
explicit fixture attestations: they demonstrate wiring, **not live DevSquad
identity or successful external implementation**.

Validation commands:

```text
npm run typecheck
npx vitest run src/OrchestrationDiscovery.test.ts src/OrchestrationProposal.test.ts src/OrchestrationNativeHost.test.ts src/OrchestrationWorkspace.test.ts src/MultiProjectWorker.test.ts
```

The final targeted run passed 73 tests across those five files; type checking
passed. This includes negative team/iteration/query mapping tests with zero
transport, operation-admission, sandbox or worker calls.

Central CLI/public exports, service/focus composition, full product integration
and README linking are owned by the core integration session. This slice is not
a whole-product completion claim.
