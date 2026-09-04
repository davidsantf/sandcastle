# DevSquad Sandcastle Execution Adapter Specification

## Objective

Add a typed host-side adapter that lets a DevSquad host run one implementation task through Sandcastle and receive structured execution results.

## Context

DevSquad owns work item selection, phase state, approval gates, and ADO watching. Sandcastle owns local execution concerns: host repo/worktree context, source branches, sandbox providers, agent providers, prompts, validation commands, commits, logs, and session metadata.

The adapter bridges those systems for one selected implementation task. It must not become a DevSquad state machine, an ADO watcher, a multi-agent scheduler, or a merge/finalization authority.

## Requirements

- RF-001: Expose a typed host-side API for running a single implementation task through Sandcastle.
- RF-002: Adapter input must include repo/worktree context, source and target branch context, work item context, spec content, plan content, agent role, validation commands, and optional execution bounds.
- RF-003: Adapter input must let the host identify the task without requiring the adapter to discover, claim, or watch work items.
- RF-004: Adapter input must accept prompt-relevant spec/plan context without requiring the adapter to load or mutate DevSquad phase artifacts.
- RF-005: Adapter output must include status, resulting branch, commit metadata, validation summary, log/session metadata, and structured failure details.
- RF-006: Adapter output must distinguish input validation failure, execution failure, and validation failure.
- RF-007: The adapter must validate required input before starting execution and fail closed with actionable diagnostics.
- RF-008: The adapter must delegate Sandcastle execution through injected or existing seams instead of duplicating agent, sandbox, git, worktree, commit, or validation-command responsibilities.
- RF-009: Unit tests must use fake execution seams and must not run live agents, live sandboxes, live git remotes, live ADO, MCP tools, network APIs, Azure CLI, Azure DevOps CLI, or secrets.
- RF-010: Public adapter types and helpers intended for host integration must be exported from `src/index.ts`.

## Non-Goals

- Owning DevSquad phase state.
- Watching, polling, selecting, or transitioning Azure DevOps work items.
- Coordinating multiple implementers or replacing the ADO team runner.
- Approving, completing, merging, or deciding final pull request readiness.
- Refactoring Sandcastle agent providers, sandbox providers, branch strategies, or session storage.

## Input Contract

| Field Group           | Required Content                                                           |
| --------------------- | -------------------------------------------------------------------------- |
| Repo/worktree context | Host repo path, worktree path, and working directory context               |
| Branch context        | Source branch and target branch                                            |
| Work item context     | Task id, title, description, URL if available, and relevant metadata       |
| Spec/plan content     | Spec text, plan text, and optional related summaries                       |
| Agent role            | Intended execution role, expected to be an implementer role for this slice |
| Validation commands   | One or more host-approved validation commands with labels/descriptions     |
| Execution bounds      | Optional timeout/iteration bounds supported by Sandcastle                  |

## Output Contract

| Field Group           | Required Content                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------- |
| Status                | Completed, execution-failed, validation-failed, or rejected/input-invalid                                 |
| Branch                | Resulting source branch                                                                                   |
| Commits               | Commit ids and summaries when produced                                                                    |
| Validation summary    | Per-command and combined validation status with diagnostics                                               |
| Logs/session metadata | Log path or excerpt metadata, session id when available, iteration count, and timing metadata             |
| Failure details       | Error category, message, safe cause details, failed validation command when applicable, and recovery hint |

## Conformance Criteria

| ID     | Scenario                  | Expected Output                                                                                                              |
| ------ | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| CC-001 | Happy path fake execution | Adapter returns completed status, resulting branch, commits, validation summary, and log/session metadata.                   |
| CC-002 | Missing work item context | Adapter rejects input before execution and identifies the missing field.                                                     |
| CC-003 | Validation failure        | Adapter returns validation-failed status and preserves per-command diagnostics.                                              |
| CC-004 | Execution failure         | Adapter returns execution-failed status and marks validation commands as not run or skipped.                                 |
| CC-005 | No phase ownership        | Adapter does not transition DevSquad phases or watch ADO.                                                                    |
| CC-006 | Fake/test seam            | Unit tests complete without live agents, sandboxes, git remotes, ADO, MCP, network, Azure CLI, Azure DevOps CLI, or secrets. |

## Invariants

- One adapter call represents one implementation task.
- Rejected input must not start Sandcastle execution.
- Failed execution must not be reported as completed.
- Validation failure must remain distinguishable from execution failure.
- The adapter must not mutate DevSquad phase state or assume ownership of ADO watching.

## Implementation Plan

### Files and Exports

- Add `src/DevSquadSandcastleExecutionAdapter.ts` for the adapter API, validation helpers, status mapping, and default Sandcastle execution wiring.
- Add `src/DevSquadSandcastleExecutionAdapter.test.ts` for fake-seam unit coverage.
- Update `src/index.ts` to export the adapter function, validation helper, public request/result types, status unions, validation summary types, and execution seam type.
- Add a changeset because this introduces new public API surface.

### Public Types

- `DevSquadSandcastleExecutionRequest`: repo/worktree context, branch context, work item context, spec/plan content, agent role, validation commands, and optional bounds.
- `DevSquadSandcastleExecutionSeam`: fakeable async seam used by the adapter instead of directly coupling tests to live agents, sandboxes, git remotes, ADO, MCP, network APIs, Azure CLI, Azure DevOps CLI, or secrets.
- `DevSquadValidationCommandRunner`: fakeable async seam for post-execution validation commands.
- `DevSquadSandcastleExecutionStatus`: `"completed" | "input-invalid" | "execution-failed" | "validation-failed"`.
- `DevSquadSandcastleExecutionResult`: status, resulting branch, commit metadata, validation summary, log/session metadata, timing/iteration metadata, and structured failure details.
- `DevSquadValidationCommandSummary`: label, command, status, exit code, safe stdout/stderr excerpts, duration, and diagnostics.
- `DevSquadSandcastleFailureDetails`: category, message, safe cause details, failed validation command when applicable, and recovery hint.

### Adapter Flow

1. Validate the request before starting execution.
2. If validation fails, return `status: "input-invalid"` with actionable diagnostics and do not call the execution seam.
3. Build a DevSquad implementer prompt from the supplied work item, spec content, plan content, branch context, and validation expectations.
4. Delegate execution through the injected/default Sandcastle execution seam.
5. Map Sandcastle execution output into branch, commit, log, session, iteration, and timing metadata.
6. Run host-approved validation commands through the injected validation command runner only after execution succeeds.
7. Return `completed`, `validation-failed`, `execution-failed`, or `input-invalid` according to the first failed boundary.

### Input Validation

Validation should fail closed and aggregate diagnostics for missing repo/worktree paths, branches, work item id/title, spec or plan content, non-implementer role, empty validation command list, validation commands missing label or command text, invalid bounds, and invalid seam configuration.

Rejected input must never start Sandcastle execution or validation commands.

### Tests

Add focused Vitest coverage for happy path fake execution, input validation failures, no seam calls on invalid input, execution seam failure, validation command failure, metadata preservation, and public exports.

### Validation Commands

Run targeted tests, `npm run typecheck`, build when appropriate, format checks for changed files, and `git diff --check` before considering the slice complete.
