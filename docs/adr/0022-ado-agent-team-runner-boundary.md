# ADO agent-team runners coordinate scheduling through seams

ADO agent-team runners coordinate multiple implementer iterations through injected control-plane and local-execution seams. They validate branch/worktree isolation and execution bounds before scheduling, but they do not directly perform local execution or final pull request authority actions.

## Context

ADO-backed team orchestration needs to schedule multiple implementers over Azure Boards work items while preserving Sandcastle's existing execution model. Lower-level ADRs already establish worktree locking and safe fan-out constraints: shared worktrees are not a normal coordination mechanism, and concurrent fan-out must use distinct branches/worktrees.

The runner sits above those primitives. It knows assignments, maximum parallelism, execution bounds, and which helper seams to invoke, but it should not duplicate git, sandbox, agent-provider, test, commit, pull request, CI, or review-feedback implementations.

## Decision

The ADO agent-team runner may:

1. Validate assignments before scheduling.
2. Enforce distinct branch and worktree assignments for parallel implementers.
3. Enforce maximum parallelism and bounded scheduling.
4. Invoke an injected local-execution seam for implementer work.
5. Compose PR publishing and feedback-loop helpers after local execution returns.
6. Return completed, failed, pending, and skipped assignment summaries.

The runner must not:

1. Run agents, shells, tests, git commands, or sandbox commands directly.
2. Import or invoke live ADO MCP tools, Azure CLI commands, Azure DevOps CLI commands, network APIs, or secrets.
3. Treat agent-session fork as branch/worktree isolation.
4. Approve, complete, merge, or decide final merge-readiness for pull requests.

Tests use fake or injected control planes and fake local-execution seams so runner behavior is deterministic and side-effect free.

## Consequences
