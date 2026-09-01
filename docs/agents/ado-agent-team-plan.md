# Azure DevOps Agent-Team Plan

## Architecture

ADO integration is split into two planes:

1. Host/control plane: adapters read and write Azure Boards work items, add work item comments, create or link Azure Repos pull requests, and summarize Azure Pipelines CI status.
2. Sandcastle/local execution plane: existing Sandcastle primitives manage git worktrees, branches, sandbox providers, agent providers, command execution, tests, and commits.

The host provides an injected ADO client to Sandcastle's adapter seam. Sandcastle validates that the injected client has the capabilities required by the selected mode before returning a control plane. The fake mode remains deterministic and in-memory for tests and dry runs.

## Current Slice

- Add `src/AdoOneWorkItemFlow.ts` as a deterministic one-work-item demo/helper flow.
- Fetch one ADO work item through an injected or fake `AdoControlPlane`.
- Derive a branch with `createAdoWorkItemBranchName` unless the caller provides one.
- Build and validate a single implementer assignment with `validateAdoTeamConfig`.
- Post a start/progress comment only when validation succeeds and the caller has not requested `dryRun`/`skipComment`.
- Return typed work item, assignment, branch, validation, and optional comment context.
- Add unit tests for happy path, not-found fail-closed behavior, validation failure without comments, caller-provided branch, dry run, and injected mock control planes.
- Export public helper types and functions from `src/index.ts`.

## Guardrails

- Do not import or call real ADO MCP runtime tools in Sandcastle core.
- Do not perform live ADO, MCP, network, or secret-dependent operations in tests.
- Do not treat MCP as a sandbox issue-tracker shell command.
- Keep future real ADO bindings in host integration code that implements the injected client contract.

## Validation

Run targeted Vitest tests for ADO files, TypeScript type checking, and formatting checks for changed files.
