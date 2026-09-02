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
- RF-009: Provide a bounded CI/review feedback loop that reads CI status and review feedback only through typed `AdoControlPlane` methods for the current work item and associated pull request context.
- RF-010: Map control-plane CI and review states into local execution actions: pending or running states produce a wait/no-op result, successful CI with no actionable review feedback produces a summary-only result, failed checks produce clear local fix-and-test actions, and review comments requesting changes produce clear local update actions.
- RF-011: Record feedback-loop progress, actionable feedback summaries, and completion summaries against the current work item only through write-capable `AdoControlPlane` update or comment methods.
- RF-012: Support deterministic fake CI and review status transitions so tests can model pending, running, failed, succeeded, and review-feedback scenarios without live services.
- RF-013: Keep merge approval, merge completion, and final merge-readiness decisions outside Sandcastle; the feedback loop may summarize observed status but must not approve, complete, or merge pull requests.

## Conformance Criteria

- CC-001: Unit tests use only fake or injected mock clients; no tests require real ADO, MCP, network, secrets, Azure CLI, or Azure DevOps CLI.
- CC-002: Sandcastle source does not import runtime ADO MCP tool names or invoke live network control-plane calls in this slice.
- CC-003: Factory validation rejects incomplete injected write-capable clients.
- CC-004: Fake factory mode returns a usable deterministic control plane with optional seeded work items and CI status.
- CC-005: Public APIs are exported from `src/index.ts` when intended for host integration.
- CC-006: PR publishing helper tests cover fake control-plane behavior and injected adapter behavior without shelling out to ADO tooling.
- CC-007: PR publishing helper tests verify missing write or PR capabilities are rejected before publishing metadata.
- CC-008: Feedback-loop tests use fake or injected control planes only and verify that no live ADO, MCP, network, shell, Azure CLI, or Azure DevOps CLI calls are made.
- CC-009: Given fake CI transitions from pending to running to succeeded, the feedback loop returns wait/no-op actions until success and then returns a summary-only result with no local fix action.
- CC-010: Given a fake failed CI status with check details, the feedback loop returns a clear local execution action that identifies the failed check and the expected local validation to rerun.
- CC-011: Given fake review feedback that requests changes, the feedback loop records the feedback against the current work item through write-capable control-plane methods and returns only local update actions to Sandcastle.
- CC-012: Given repeated unchanged CI or review feedback, the feedback loop stops at its configured bound and reports a bounded summary instead of looping indefinitely.
- CC-013: Tests verify the feedback loop never calls approve, complete, merge, or equivalent pull request finalization methods.

## Non-Goals

- Implementing real Azure DevOps CLI, REST, or MCP calls.
- Moving issue tracking into sandbox shell commands.
- Building merge automation, merge approval, merge completion, or final merge-readiness decisions; these remain outside this slice.
