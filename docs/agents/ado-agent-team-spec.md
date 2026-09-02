# Azure DevOps Agent-Team Specification

## Objective

Add Azure DevOps (ADO) agent-team tooling to Sandcastle without coupling Sandcastle core to a live ADO MCP runtime, network access, or secrets. Sandcastle remains responsible for local execution concerns such as git worktrees, branches, sandbox providers, agent providers, command execution, tests, and commits. ADO remains a host-side control-plane adapter.

## Requirements

- RF-001: Provide typed ADO work item context, update, comment, pull request, CI status, team assignment, and control-plane contracts.
- RF-002: Support a fake ADO control plane for tests, local dry runs, and deterministic orchestration without real ADO services.
- RF-003: Provide a host-side adapter/factory seam that accepts an injected client object for ADO control-plane operations instead of importing or invoking MCP runtime tools directly.
- RF-004: Validate capabilities before creating write-capable adapters. Missing required methods must fail closed with helpful errors.
- RF-005: Distinguish read-only control-plane use from write-capable use so read-only adapters do not advertise update, comment, or pull request creation capabilities.
- RF-006: Keep one primary work item per implementer iteration and require distinct branch/worktree assignments for parallel implementers unless duplicate work item use is explicit.
- RF-007: Provide a PR publishing helper that accepts local execution results, including branch and worktree output, and publishes PR metadata through the injected `AdoControlPlane` contract.
- RF-008: The PR publishing helper must call only typed `AdoControlPlane` PR, comment, and update methods, and must fail closed when the injected control plane lacks write or PR capabilities.

## Conformance Criteria

- CC-001: Unit tests use only fake or injected mock clients; no tests require real ADO, MCP, network, secrets, Azure CLI, or Azure DevOps CLI.
- CC-002: Sandcastle source does not import runtime ADO MCP tool names or invoke live network control-plane calls in this slice.
- CC-003: Factory validation rejects incomplete injected write-capable clients.
- CC-004: Fake factory mode returns a usable deterministic control plane with optional seeded work items and CI status.
- CC-005: Public APIs are exported from `src/index.ts` when intended for host integration.
- CC-006: PR publishing helper tests cover fake control-plane behavior and injected adapter behavior without shelling out to ADO tooling.
- CC-007: PR publishing helper tests verify missing write or PR capabilities are rejected before publishing metadata.

## Non-Goals

- Implementing real Azure DevOps CLI, REST, or MCP calls.
- Moving issue tracking into sandbox shell commands.
- Building merge automation; merge decisions remain outside this slice.
