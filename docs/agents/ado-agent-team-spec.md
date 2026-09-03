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
- RF-014: Provide an ADO agent-team orchestration runner that coordinates multiple implementer iterations from ADO work item assignments while preserving Sandcastle-local execution responsibilities.
- RF-015: The runner input must include assigned work items, implementer slots, branch/worktree assignment data, a maximum parallelism limit, duplicate-work-item policy, execution bounds, and injected control-plane/local-execution dependencies.
- RF-016: The runner output must include per-implementer assignment validation results, selected branch/worktree assignments, local execution summaries, PR/CI metadata observed through the control plane, skipped assignment reasons, and bounded completion status.
- RF-017: The runner must validate before execution that parallel implementers do not share the same primary work item unless duplicate primary work item use is explicitly configured for that run.
- RF-018: The runner must validate before execution that parallel implementers receive distinct branch and worktree assignments; conflicts must fail closed with actionable diagnostics before any local execution begins.
- RF-019: The runner must enforce configured maximum parallelism and execution bounds, including rejecting non-positive parallelism, capping active implementer iterations to the configured limit, and stopping rather than looping indefinitely when bounds are reached.
- RF-020: The runner must compose existing Sandcastle helpers for local git branches, worktrees, sandbox execution, agent providers, command execution, tests, commits, PR publishing, and CI/review feedback where those helpers already exist, instead of duplicating those responsibilities.
- RF-021: The runner must use `AdoControlPlane` only for Boards, pull request, and CI/review metadata; local git, sandbox, agent provider, command execution, tests, and commits must remain in Sandcastle/local code.
- RF-022: The runner must not call live ADO, MCP, network, Azure CLI, or Azure DevOps CLI APIs directly; all control-plane behavior must flow through injected fake or adapter-backed `AdoControlPlane` contracts.
- RF-023: The runner must expose a local execution seam for implementer iteration execution so tests can inject deterministic local execution results without directly running agents, shells, sandboxes, tests, or commits.

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
- CC-014: Given two parallel implementer assignments with the same primary work item and duplicate work item use disabled, the runner rejects the run before starting local execution and reports the conflicting implementer slots and work item.
- CC-015: Given two parallel implementer assignments with the same primary work item and duplicate work item use explicitly enabled, the runner accepts the assignments only when their branch and worktree values remain distinct.
- CC-016: Given two parallel implementer assignments with duplicate branch or worktree values, the runner rejects the run before starting local execution and reports the conflicting branch or worktree.
- CC-017: Given more ready implementer assignments than the configured maximum parallelism, the runner starts no more than the configured number concurrently and reports remaining assignments as pending or skipped according to the configured bounds.
- CC-018: Given zero or negative maximum parallelism, the runner fails closed with a validation error and starts no local execution.
- CC-019: Given injected fake `AdoControlPlane` and fake local execution seam implementations, runner tests complete deterministically without live ADO, MCP, network, shell, Azure CLI, Azure DevOps CLI, sandbox, agent provider, test runner, or git side effects.
- CC-020: Given a successful local execution seam result for an implementer assignment, the runner passes local branch and worktree output to existing PR publishing and feedback-loop helpers rather than invoking ADO PR, CI, or review operations directly.
- CC-021: Given a local execution seam failure for one implementer assignment, the runner records that assignment as failed locally and does not let the failure cause another parallel implementer to reuse the failed assignment's branch, worktree, or primary work item.
- CC-022: Given execution bounds are reached before all assignments complete, the runner stops scheduling additional iterations and returns a bounded summary containing completed, failed, pending, and skipped assignment counts.

## Non-Goals

- Implementing real Azure DevOps CLI, REST, or MCP calls.
- Moving issue tracking into sandbox shell commands.
- Building merge automation, merge approval, merge completion, or final merge-readiness decisions; these remain outside this slice.
