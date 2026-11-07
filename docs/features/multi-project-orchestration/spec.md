# Multi-project orchestration

## Outcome and authority

Deliver an invocable DevSquad orchestration agent and configurable host for
GitHub and Azure DevOps catalogs. Independent projects progress separately;
integrated projects declare task dependencies and shared-contract prerequisites.
The host owns credentials, authorization, audit, scheduling, and acceptance.
Worker output is evidence/proposals, never permission. No merge, deployment,
hub writes, or recurring automation is implicit.

## Acceptance criteria

1. Reject duplicate project/qualified task identities, ambiguous repository
   aliases, unknown dependencies, cycles, unsafe scopes, and missing acceptance
   checks before any dispatch. Exclude overlapping concurrent repository scopes.
2. Persist run/task state, artifacts, and append-only events in one database.
   Reserve before invocation with exclusive host leases and fencing.
   After restart, unresolved reservations become unknown/needs-input, never
   success or automatic redispatch. Independent nonconflicting lanes can proceed.
3. Execute specify -> plan -> decompose -> implement -> verify -> review using
   existing Sandcastle APIs. Keep artifact history amendable and revision-bound.
   Required checks have nonzero evaluated scope and non-regression evidence.
4. Provide injectable GitHub/ADO read-only transports with actual API requests.
   Resolve source revisions and policies; reject stale, missing, unknown, or
   vacuous checks. Capture bounded actionable failure evidence and labels.
5. Bound concurrency, invocation time, and repair attempts (default three).
   Repeated normalized failures, missing evidence, explicit needs-human labels,
   timeouts, and exhausted attempts produce durable needs-input outcomes.
6. Real workers use task branches, not automatic merge-to-head. The host approves
   exact task/stage/artifact intent immediately before each dispatch. Validate
   scope, source revision, acceptance commands, and non-regression independently.
   Document actual provider isolation, not hypothetical credential/network
   isolation.
7. Supply public APIs, a CLI entrypoint, discoverable agent, safe fake-hub demo,
   usage instructions, and behavior-specific tests, including failing fixtures.
   Preserve existing APIs and the existing ledger's POSIX storage guarantees.

## Setup constraints

The host uses Node's built-in SQLite (Node 22.13+); it has no Python dependency.
Optional LLMLab integrations require a supported Python 3.11+ bootstrap and the
single `requirements.txt`. Launchers normally install it unless
`LLMLAB_PYTHON_AUTO_SETUP=0`; explain and obtain permission before manual setup
after startup failure or when auto-setup is disabled. Do not build Polymer.
