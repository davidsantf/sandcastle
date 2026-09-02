# ADO Agent-Team Follow-up Backlog

GitHub Issues is currently disabled for `davidsantf/sandcastle`, so this file captures issue-ready follow-up slices after the ADO control-plane/team foundation.

## 1. One-work-item fake/demo flow

**Title:** Add a one-work-item fake ADO demo flow

**Body:** Build a deterministic demo that exercises one seeded ADO work item through the fake `AdoControlPlane` without requiring live ADO, MCP, network access, or secrets. The flow should demonstrate fetching the work item, assigning local execution state, adding progress/comment updates through the fake adapter, and producing a concise final status.

**Acceptance criteria:**

- Uses only fake or injected in-memory ADO control-plane behavior.
- Shows one primary work item for one implementer iteration.
- Keeps Sandcastle/local execution concerns separate from ADO control-plane metadata.
- Includes focused tests or a documented demo command that can run offline.

## 2. PR publishing helper over AdoControlPlane

**Title:** Add a PR publishing helper over `AdoControlPlane`

**Body:** Add a helper that takes local execution results and publishes PR metadata through the injected `AdoControlPlane` contract. The helper should map local branch/worktree output into the existing ADO PR/linking capability without importing live MCP tools or shelling out to ADO from Sandcastle core.

**Acceptance criteria:**

- Calls only the typed `AdoControlPlane` PR/comment/update methods.
- Fails closed when the injected control plane lacks write or PR capabilities.
- Preserves the boundary where ADO handles Boards/Repos/PR metadata and Sandcastle handles local git/sandbox execution.
- Covers fake and injected adapter behavior with targeted tests.

## 3. CI/review feedback loop

**Title:** Add CI and review feedback loop plumbing for ADO-backed runs

**Body:** Implement a loop that reads CI/review status from `AdoControlPlane`, records actionable feedback against the current work item, and hands only local execution work back to Sandcastle. The loop should support fake status transitions for tests and avoid making merge decisions in Sandcastle.

**Acceptance criteria:**

- Reads CI status through the control-plane contract, not live MCP or shell commands.
- Converts failed checks or review comments into clear next local execution actions.
- Posts progress or summary comments only through write-capable control-plane methods.
- Leaves merge approval/completion outside this slice.

## 4. Team orchestration runner

**Title:** Add an ADO agent-team orchestration runner

**Body:** Add a runner that coordinates multiple implementer iterations from ADO work item assignments while enforcing the one-primary-work-item rule and distinct branch/worktree assignments for parallel work. The runner should compose existing Sandcastle execution primitives with the ADO control-plane seam.

**Acceptance criteria:**

- Validates that parallel implementers do not share a work item unless explicitly configured.
- Assigns distinct branches/worktrees for parallel implementers.
- Uses `AdoControlPlane` only for Boards/PR/CI metadata.
- Keeps local git, sandbox, agent provider, command execution, tests, and commits in Sandcastle/local code.

## 5. Optional ADO CLI init issue-tracker template decision

**Title:** Decide whether to add an Azure DevOps CLI issue-tracker template

**Body:** Evaluate whether `sandcastle init` should offer an Azure DevOps CLI issue-tracker template. This is separate from the ADO control-plane/MCP adapter seam: init issue-tracker templates may only install and invoke a real non-interactive CLI inside generated sandboxes. Do not use MCP shell commands as template commands.

**Acceptance criteria:**

- Evaluates the Azure DevOps CLI against `docs/agents/adding-an-issue-tracker.md` must-haves.
- Documents a clear add/defer/reject decision.
- If adding, proposes only CLI-based `LIST_TASKS_COMMAND`, `VIEW_TASK_COMMAND`, and `CLOSE_TASK_COMMAND` values plus sandbox install/env guidance.
- Explicitly does not place MCP commands into Sandcastle init issue-tracker templates.
