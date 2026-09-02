# ADO feedback loops summarize status but do not finalize pull requests

Azure DevOps-backed feedback loops use a host-provided control-plane adapter to read pull request CI status and review feedback, then map those signals into local Sandcastle follow-up actions. They do not approve, complete, merge, or make final merge-readiness decisions.

## Context

ADO-backed agent-team tooling introduces a new boundary: Azure Boards, Azure Repos, and Azure Pipelines data is available through a host/control-plane integration, while Sandcastle remains responsible for local execution concerns such as worktrees, source branches, sandbox providers, agent providers, command execution, tests, and commits.

CI and review feedback sits on that boundary. It is useful for Sandcastle to turn failed checks or requested changes into a local follow-up prompt, but final PR authority belongs to ADO branch policies, reviewer approvals, and the user or host automation that owns the control plane.

## Decision

ADO feedback-loop helpers may:

1. Read CI status and review feedback through typed `AdoControlPlane` methods.
2. Convert pending/running CI into wait or no-op actions.
3. Convert failed CI or requested changes into local fix-and-test actions for Sandcastle to execute.
4. Record progress, actionable feedback, and summaries through write-capable `AdoControlPlane` comment or work-item update methods when explicitly requested.

ADO feedback-loop helpers must not:

1. Approve pull requests.
2. Complete or merge pull requests.
3. Decide final merge-readiness.
4. Import or call live ADO MCP tools, Azure CLI commands, Azure DevOps CLI commands, network APIs, or sandbox shell commands from Sandcastle core.

Tests for these helpers use fake or injected control planes. Live ADO, MCP, network, secrets, git commands, and sandbox execution stay outside this slice.

## Consequences

- The feedback loop is safe to compose into local agent retries without becoming merge automation.
