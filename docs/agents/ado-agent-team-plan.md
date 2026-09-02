# Azure DevOps Agent-Team Plan

## Architecture

ADO integration is split into two planes:

1. Host/control plane: adapters read and write Azure Boards work items, add work item comments, create or link Azure Repos pull requests, and summarize Azure Pipelines CI status.
2. Sandcastle/local execution plane: existing Sandcastle primitives manage git worktrees, branches, sandbox providers, agent providers, command execution, tests, and commits.

The host provides an injected ADO client to Sandcastle's adapter seam. Sandcastle validates that the injected client has the capabilities required by the selected mode before returning a control plane. The fake mode remains deterministic and in-memory for tests and dry runs.

## Current Slice

- Add a bounded CI/review feedback loop helper that maps the current work item and associated pull request context into local Sandcastle follow-up actions through `AdoControlPlane`.
- Accept explicit current work item context, associated pull request context, optional feedback-loop bounds, and caller-provided options for recording progress, actionable feedback, and completion summaries.
- Read CI status and review feedback only through typed `AdoControlPlane` methods; do not import or call live ADO MCP tools, Azure CLI, Azure DevOps CLI, network APIs, secrets, git commands, or sandbox execution.
- Map CI states deterministically:
  - pending or running CI returns a wait/no-op action;
  - succeeded CI with no actionable review feedback returns a summary-only result;
  - failed checks return clear local fix-and-test actions that identify failed checks and expected local validation to rerun.
- Represent review feedback as typed, actionable summaries associated with the current pull request; comments requesting changes return local update actions for Sandcastle to execute.
- Record feedback-loop progress, actionable feedback summaries, and completion summaries against the current work item only through write-capable `AdoControlPlane` comment or update methods when requested.
- Fail closed before recording progress or feedback when caller-requested writes require missing comment/update capabilities.
- Stop at the configured bound when CI or review feedback remains unchanged, and return a bounded summary instead of looping indefinitely.
- Keep merge approval, merge completion, merge-readiness decisions, and equivalent PR finalization actions outside Sandcastle; the feedback loop may summarize observed status but must not approve, complete, or merge pull requests.
- Add unit tests for fake CI transitions from pending to running to succeeded, failed CI check action mapping, review feedback requiring changes, bounded repeated feedback, write-capable comment/update recording, missing capability failures, and no live ADO/MCP/network/shell/CLI dependency.
- Export public helper types and functions from `src/index.ts`.

## Guardrails

- Do not import or call real ADO MCP runtime tools in Sandcastle core.
- Do not perform live ADO, MCP, network, or secret-dependent operations in tests.
- Do not treat MCP as a sandbox issue-tracker shell command.
- Keep future real ADO bindings in host integration code that implements the injected client contract.
- Do not push branches, create PRs, or run git commands from the PR publishing helper; callers own local execution and publishing prerequisites.

## Validation

Run targeted Vitest tests for ADO files, TypeScript type checking, diff whitespace checks, and formatting checks for changed files.
