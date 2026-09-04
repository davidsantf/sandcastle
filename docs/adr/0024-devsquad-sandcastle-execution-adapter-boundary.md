# DevSquad Sandcastle execution adapter runs one selected task

## Context

DevSquad integration needs a host-side way to run one already-selected implementation task through Sandcastle and receive a typed result.

Existing ADRs define adjacent boundaries:

- ADR-0021 keeps Azure DevOps feedback loops behind host-provided control-plane seams and prevents Sandcastle core from directly calling live ADO, MCP, Azure CLI, Azure DevOps CLI, network APIs, or secrets.
- ADR-0022 allows ADO agent-team runners to coordinate scheduling through injected local-execution seams, but prevents runners from directly running agents, shells, tests, git commands, or sandbox commands.
- ADR-0023 keeps Azure DevOps issue-tracker templates as generated sandbox CLI scaffolding, not host-side MCP runtime coupling.
- ADR-0012 keeps agent session storage owned by agent providers.

The DevSquad adapter is the local-execution boundary that ADR-0022 expects a runner or host to invoke. Without an explicit decision, the adapter could drift into DevSquad phase orchestration, ADO watching, multi-agent scheduling, merge authority, or duplicated Sandcastle execution logic.

## Decision

Add a typed DevSquad Sandcastle execution adapter as a host-side API for exactly one selected implementation task.

DevSquad or the host owns:

1. Phase state and approval gates.
2. Work item discovery, selection, claiming, watching, and transitions.
3. ADO control-plane interactions.
4. Multi-agent scheduling.
5. Final pull request approval, completion, merge, and merge-readiness authority.
6. Supplying prompt-relevant spec and plan context to the adapter.

The adapter owns:

1. Validating its request before execution starts.
2. Building the prompt/context needed for one implementation task from caller-supplied inputs.
3. Delegating Sandcastle execution through injected or existing execution seams.
4. Running host-approved validation commands only after execution succeeds.
5. Returning a typed result with status, resulting branch, commit metadata, validation summary, log/session metadata, timing/iteration metadata, and structured failure details.

The adapter must not:

1. Discover, claim, watch, or transition work items.
2. Mutate DevSquad phase artifacts or own DevSquad phase state.
3. Coordinate multiple implementers or replace the ADO team runner.
4. Approve, complete, merge, or decide final pull request readiness.
5. Duplicate Sandcastle agent, sandbox, git, worktree, commit, validation-command, log, or session-storage responsibilities.
6. Import or call live ADO MCP tools, Azure CLI commands, Azure DevOps CLI commands, network APIs, or secrets.

Unit tests for the adapter use fake execution and validation seams. They must not run live agents, live sandboxes, live git remotes, live ADO, MCP tools, network APIs, Azure CLI, Azure DevOps CLI, or secrets.

## Consequences

- The adapter is safe for DevSquad runners to call as a one-task local execution seam.
- DevSquad orchestration remains outside Sandcastle execution code.
- Existing ADO feedback-loop, runner, issue-tracker-template, and agent-session-storage boundaries remain intact.
- Input validation failures are reported before any Sandcastle execution or validation command starts.
- Execution failures and validation failures remain distinguishable in the public result contract.
- Tests remain deterministic and side-effect free through fake seams.
