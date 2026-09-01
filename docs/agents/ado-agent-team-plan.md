# Azure DevOps Agent-Team Plan

## Architecture

ADO integration is split into two planes:

1. Host/control plane: adapters read and write Azure Boards work items, add work item comments, create or link Azure Repos pull requests, and summarize Azure Pipelines CI status.
2. Sandcastle/local execution plane: existing Sandcastle primitives manage git worktrees, branches, sandbox providers, agent providers, command execution, tests, and commits.

The host provides an injected ADO client to Sandcastle's adapter seam. Sandcastle validates that the injected client has the capabilities required by the selected mode before returning a control plane. The fake mode remains deterministic and in-memory for tests and dry runs.

## Current Slice

- Add `src/AdoControlPlaneFactory.ts` as the public factory seam.
- Support `fake` mode backed by `FakeAdoControlPlane`, including seeded work items and optional CI status.
- Support `injected` mode backed by typed host-provided methods matching `AdoControlPlane` operations.
- Validate required capabilities before returning an adapter.
- Add read-only mode that exposes only work item fetch and CI status methods.
- Add unit tests for fake creation, injected delegation, fail-closed validation, and read-only capability boundaries.
- Export public factory types and functions from `src/index.ts`.

## Guardrails

- Do not import or call real ADO MCP runtime tools in Sandcastle core.
- Do not perform live ADO, MCP, network, or secret-dependent operations in tests.
- Do not treat MCP as a sandbox issue-tracker shell command.
- Keep future real ADO bindings in host integration code that implements the injected client contract.

## Validation

Run targeted Vitest tests for ADO files, TypeScript type checking, and formatting checks for changed files.
