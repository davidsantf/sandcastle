# Azure DevOps Agent-Team Plan

## Architecture

ADO integration is split into two planes:

1. Host/control plane: adapters read and write Azure Boards work items, add work item comments, create or link Azure Repos pull requests, and summarize Azure Pipelines CI status.
2. Sandcastle/local execution plane: existing Sandcastle primitives manage git worktrees, branches, sandbox providers, agent providers, command execution, tests, and commits.

The host provides an injected ADO client to Sandcastle's adapter seam. Sandcastle validates that the injected client has the capabilities required by the selected mode before returning a control plane. The fake mode remains deterministic and in-memory for tests and dry runs.

## Current Slice

- Add a PR publishing helper that maps local Sandcastle execution output into Azure Repos pull request metadata through `AdoControlPlane`.
- Accept explicit source branch, target branch, title, optional description, linked work item IDs, draft flag, and optional progress/completion metadata from the local execution plane.
- Call only typed `AdoControlPlane` methods: `createPullRequest`, and optionally `addWorkItemComment` / `updateWorkItem` when caller-provided options request work item updates.
- Fail closed before publishing when the provided control plane does not expose required write or PR capabilities.
- Keep the helper independent of live ADO MCP tool names, Azure CLI commands, network calls, secrets, git pushes, and sandbox execution.
- Return a typed result containing the created PR context and any work item comments/updates performed through the injected control plane.
- Add unit tests for fake control-plane publishing, injected adapter delegation, missing PR capability failure, missing comment/update capability failure when requested, and no live ADO/shell dependency.
- Export public helper types and functions from `src/index.ts`.

## Guardrails

- Do not import or call real ADO MCP runtime tools in Sandcastle core.
- Do not perform live ADO, MCP, network, or secret-dependent operations in tests.
- Do not treat MCP as a sandbox issue-tracker shell command.
- Keep future real ADO bindings in host integration code that implements the injected client contract.
- Do not push branches, create PRs, or run git commands from the PR publishing helper; callers own local execution and publishing prerequisites.

## Validation

Run targeted Vitest tests for ADO files, TypeScript type checking, diff whitespace checks, and formatting checks for changed files.
