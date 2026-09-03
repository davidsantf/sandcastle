# Azure DevOps Agent-Team Plan

## Architecture

ADO integration is split into two planes:

1. Host/control plane: adapters read and write Azure Boards work items, add work item comments, create or link Azure Repos pull requests, and summarize Azure Pipelines CI status.
2. Sandcastle/local execution plane: existing Sandcastle primitives manage git worktrees, branches, sandbox providers, agent providers, command execution, tests, and commits.

The host provides an injected ADO client to Sandcastle's adapter seam. Sandcastle validates that the injected client has the capabilities required by the selected mode before returning a control plane. The fake mode remains deterministic and in-memory for tests and dry runs.

## Current Slice

- Add an ADO agent-team orchestration runner that coordinates multiple implementer iterations from ADO work item assignments while keeping all local execution responsibilities inside Sandcastle.
- Accept explicit runner inputs:
  - assigned work items and implementer slots;
  - branch and worktree assignment data for each slot;
  - maximum parallelism;
  - duplicate primary work item policy;
  - execution bounds;
  - injected `AdoControlPlane`;
  - injected local execution seam for implementer iteration execution.
- Validate assignments before starting any local execution:
  - reject zero or negative maximum parallelism;
  - reject duplicate primary work item use across parallel implementers unless explicitly enabled for the run;
  - always reject duplicate branch or worktree assignments across parallel implementers;
  - return actionable diagnostics that identify the conflicting implementer slots and conflicting work item, branch, or worktree value.
- Enforce configured maximum parallelism by scheduling no more than the configured number of active implementer iterations at once and reporting assignments that remain pending or skipped when execution bounds are reached.
- Expose a local execution seam so tests can inject deterministic implementer results without running agents, shells, sandboxes, tests, commits, git commands, ADO, MCP, network calls, Azure CLI, or Azure DevOps CLI.
- Compose existing Sandcastle helpers instead of duplicating responsibilities:
  - local execution remains responsible for branches, worktrees, sandbox execution, agent providers, command execution, tests, and commits;
  - successful local execution results are passed to the existing PR publishing helper;
  - PR/CI/review metadata is observed through the existing feedback-loop helper.
- Use `AdoControlPlane` only for Boards, pull request, CI, and review metadata. The runner must not call live ADO, MCP, network, Azure CLI, Azure DevOps CLI, git, sandbox, test runner, or agent-provider APIs directly.
- Return a bounded runner result that includes per-implementer assignment validation results, selected branch and worktree assignments, local execution summaries, PR/CI metadata observed through the control plane, skipped assignment reasons, completed/failed/pending/skipped counts, and bounded completion status.
- Isolate local execution failures per assignment: a failed implementer iteration is recorded as failed locally, does not stop unrelated parallel assignments by default, and does not allow another implementer to reuse the failed assignment's branch, worktree, or primary work item.
- Add unit tests for duplicate primary work item rejection and opt-in allowance, duplicate branch/worktree rejection, zero or negative maximum parallelism rejection, maximum parallelism scheduling, deterministic fake local execution seam results, successful composition with PR publishing and feedback-loop helpers, local execution failure isolation, bounded pending/skipped summaries, and no live ADO/MCP/network/shell/CLI/sandbox/agent/test/git dependency.
- Export public runner types and functions from `src/index.ts`.

## Guardrails

- Do not import or call real ADO MCP runtime tools in Sandcastle core.
- Do not perform live ADO, MCP, network, or secret-dependent operations in tests.
- Do not treat MCP as a sandbox issue-tracker shell command.
- Keep future real ADO bindings in host integration code that implements the injected client contract.
- Do not push branches, create PRs, or run git commands from the PR publishing helper; callers own local execution and publishing prerequisites.

## Validation

Run targeted Vitest tests for ADO files, TypeScript type checking, diff whitespace checks, and formatting checks for changed files.
