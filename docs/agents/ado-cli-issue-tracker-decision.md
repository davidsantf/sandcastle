# Azure DevOps CLI Issue-Tracker Template Decision

## Objective

Decide whether `sandcastle init` should offer an Azure DevOps CLI issue-tracker template that installs and invokes a real non-interactive CLI inside generated sandboxes.

## Decision

Add an Azure DevOps CLI issue-tracker template, provided the template uses only Azure CLI plus the first-party Azure DevOps extension commands and never uses MCP commands as generated issue-tracker shell commands.

This decision is separate from the ADO control-plane/MCP adapter seam. The init template is a sandbox shell-command scaffold; it must not invoke MCP tools or depend on host-side MCP runtime availability.

## Scope

Included:

- Evaluate Azure DevOps CLI against the issue-tracker template must-haves.
- Define acceptable CLI-based command shapes for list, view, and close operations.
- Define sandbox install and environment guidance.
- Explicitly forbid MCP shell commands in the init issue-tracker template.

Excluded:

- Changing the ADO control-plane, fake control plane, MCP adapter seam, team runner, PR publishing, or feedback-loop design.
- Adding live Azure DevOps calls to Sandcastle core tests.
- Using MCP commands as issue-tracker template commands.

## Requirements

- RF-001: The Azure DevOps issue-tracker template must install and invoke a real CLI inside the generated sandbox.
- RF-002: The template must use Azure CLI with the first-party Azure DevOps extension, not MCP shell commands.
- RF-003: The template must authenticate non-interactively using `AZURE_DEVOPS_EXT_PAT`.
- RF-004: The template must require Azure DevOps organization and project context through environment variables or explicit command arguments.
- RF-005: The list command must be non-interactive and produce structured JSON output.
- RF-006: The list command must support backlog scoping through WIQL so generated sandboxes do not have to process an entire Azure Boards backlog.
- RF-007: The view command must be non-interactive and produce JSON for one work item identified by `<ID>`.
- RF-008: The close command must be non-interactive and update one work item identified by `<ID>`.
- RF-009: The close command must not assume MCP, host-side ADO adapters, or live agent-host tools are available inside the sandbox.
- RF-010: The template must document that Azure Boards workflow states vary by process, so the closed state must be configurable.
- RF-011: The template must include Debian sandbox install guidance for Azure CLI and the Azure DevOps extension.
- RF-012: The template must not change or weaken the existing ADO control-plane guardrail that Sandcastle core does not call live ADO, MCP, network, Azure CLI, or Azure DevOps CLI APIs directly.

## Proposed Template Values

### Environment

```sh
AZURE_DEVOPS_EXT_PAT=
AZURE_DEVOPS_ORG=
AZURE_DEVOPS_PROJECT=
AZURE_DEVOPS_TASKS_WIQL=SELECT [System.Id], [System.Title], [System.State], [System.WorkItemType] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.State] <> 'Closed' ORDER BY [System.ChangedDate] DESC
AZURE_DEVOPS_CLOSED_STATE=Closed
```

### `LIST_TASKS_COMMAND`

```sh
az boards query --org "$AZURE_DEVOPS_ORG" --project "$AZURE_DEVOPS_PROJECT" --wiql "$AZURE_DEVOPS_TASKS_WIQL" --output json
```

### `VIEW_TASK_COMMAND`

```sh
az boards work-item show --org "$AZURE_DEVOPS_ORG" --id <ID> --expand all --output json
```

### `CLOSE_TASK_COMMAND`

```sh
az boards work-item update --org "$AZURE_DEVOPS_ORG" --id <ID> --state "$AZURE_DEVOPS_CLOSED_STATE" --discussion "Closed by Sandcastle agent." --output json
```

## Sandbox Install Guidance

The generated sandbox Dockerfile snippet should install Azure CLI and the Azure DevOps extension before switching away from root. The implementation should prefer official Microsoft Debian package installation instructions and clean package-manager caches after installation.

## Evaluation Against Must-Haves

| Requirement                         | Azure DevOps CLI Evaluation                                                                                                     | Result |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Official / first-party CLI          | Azure CLI and the Azure DevOps extension are Microsoft-provided tooling.                                                        | Pass   |
| Non-interactive auth via env var    | `AZURE_DEVOPS_EXT_PAT` supports PAT-based non-interactive auth for Azure DevOps CLI operations.                                 | Pass   |
| Non-interactive list command        | `az boards query` can run WIQL non-interactively.                                                                               | Pass   |
| Non-interactive view command        | `az boards work-item show --id <ID>` can fetch one work item.                                                                   | Pass   |
| Non-interactive close command       | `az boards work-item update --id <ID> --state ...` can close/update one work item.                                              | Pass   |
| Installable inside Debian container | Azure CLI has Debian package installation guidance; the extension can be installed with `az extension add --name azure-devops`. | Pass   |
| Stable exit codes                   | Azure CLI commands return non-zero on command/auth/query/update failures.                                                       | Pass   |
| Structured JSON output for list     | `--output json` is available.                                                                                                   | Pass   |
| Filter/label support on list        | WIQL can filter by project, type, state, tags, area path, assigned user, or other fields.                                       | Pass   |

## Conformance Criteria

| ID     | Scenario                                                                | Expected Output                                                                                            |
| ------ | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| CC-001 | List ready Azure Boards work items with all required env vars set.      | Command exits successfully and prints JSON work item data matching the WIQL result.                        |
| CC-002 | View one existing work item.                                            | Command exits successfully and prints JSON for that work item.                                             |
| CC-003 | Close one existing work item.                                           | Command exits successfully and the work item transitions to the configured closed state.                   |
| CC-004 | Missing authentication.                                                 | Command fails non-interactively with a non-zero exit code and must not prompt for browser or device login. |
| CC-005 | Generated commands contain MCP tool names or host-only MCP invocations. | Template is rejected before release.                                                                       |
| CC-006 | Project uses a closed state other than `Closed`.                        | User can set `AZURE_DEVOPS_CLOSED_STATE` without changing Sandcastle source.                               |

## Risks and Mitigations

- Risk: Azure Boards process states vary by project.
  - Mitigation: Make the closed state configurable with `AZURE_DEVOPS_CLOSED_STATE`.
- Risk: A generic ready-task query may not match every team's board conventions.
  - Mitigation: Make the WIQL query configurable with `AZURE_DEVOPS_TASKS_WIQL`.
- Risk: CLI package installation guidance changes over time.
  - Mitigation: Verify the Dockerfile snippet against current official Azure CLI Debian documentation during implementation.
- Risk: Contributors may confuse the issue-tracker template with the ADO control-plane/MCP adapter seam.
  - Mitigation: Keep this decision artifact explicit that the init template must use sandbox CLI commands only and must not use MCP commands.

## Non-Goals

- Do not call MCP tools from `sandcastle init` issue-tracker templates.
- Do not add ADO CLI calls to Sandcastle core orchestration, unit tests, fake control plane, or ADO team runner.
- Do not replace the host-side ADO control-plane adapter seam.

## Implementation Plan

1. **InitService registry**
   - Add an Azure DevOps CLI issue tracker entry to `ISSUE_TRACKER_REGISTRY` in `src/InitService.ts`.
   - Use a stable template name such as `azure-devops`.
   - Set the label to `Azure DevOps`.
   - Keep the generated commands CLI-only; do not reference MCP tools, host-side ADO adapters, Sandcastle ADO control-plane types, network helpers, or test seams.

2. **Dockerfile snippet**
   - Add an `AZURE_DEVOPS_CLI_TOOLS` snippet near `GITHUB_CLI_TOOLS` and `BEADS_TOOLS`.
   - Install Azure CLI as root before the agent `USER` switch, then install the first-party Azure DevOps extension with `az extension add --name azure-devops`.
   - Clean package-manager caches in the same snippet.
   - Follow current official Microsoft Linux/Debian Azure CLI installation guidance during implementation rather than inventing or freezing package-source steps from memory.
   - Include a short source comment that the Azure DevOps CLI extension is for Azure DevOps Services cloud; it does not support Azure DevOps Server on-premises.

3. **Template commands**
   - `LIST_TASKS_COMMAND`: `az boards query --org "$AZURE_DEVOPS_ORG" --project "$AZURE_DEVOPS_PROJECT" --wiql "$AZURE_DEVOPS_TASKS_WIQL" --output json`
   - `VIEW_TASK_COMMAND`: `az boards work-item show --org "$AZURE_DEVOPS_ORG" --id <ID> --expand all --output json`
   - `CLOSE_TASK_COMMAND`: `az boards work-item update --org "$AZURE_DEVOPS_ORG" --id <ID> --state "$AZURE_DEVOPS_CLOSED_STATE" --discussion "Closed by Sandcastle agent." --output json`

4. **Environment example**
   - Append these issue-tracker env vars to generated `.sandcastle/.env.example`: `AZURE_DEVOPS_EXT_PAT`, `AZURE_DEVOPS_ORG`, `AZURE_DEVOPS_PROJECT`, `AZURE_DEVOPS_TASKS_WIQL`, and `AZURE_DEVOPS_CLOSED_STATE`.
   - Document that PAT usage is higher-risk than Microsoft Entra authentication, but is intentionally used here because the scaffold must run non-interactively inside a sandbox via environment variables.

5. **Tests**
   - Extend `src/InitService.test.ts` to cover `listIssueTrackers()` and `getIssueTracker("azure-devops")`.
   - Verify generated Dockerfile content contains Azure CLI / Azure DevOps extension install steps and no unresolved `{{ISSUE_TRACKER_TOOLS}}`.
   - Verify generated `.env.example` contains all Azure DevOps env vars.
   - Verify generated non-blank template prompts contain `az boards query`.
   - Verify generated Azure DevOps issue-tracker content does not contain MCP command names or host-only MCP invocation language.

6. **README and contributor docs**
   - Update `README.md` where supported issue trackers and `--issue-tracker` options are listed.
   - Update `docs/agents/adding-an-issue-tracker.md` only if implementation reveals a reusable caveat for future issue trackers.
   - Add or update a changeset because this is public-facing init behavior. Since this is a pre-1.0 new feature, use a minor changeset for `@ai-hero/sandcastle`.

7. **Validation**
   - Run targeted init tests: `npm test -- src/InitService.test.ts`.
   - Run type checking: `npm run typecheck`.
   - Run formatting check for changed files.
   - Do not run live Azure DevOps commands in tests.
   - Do not add live ADO, MCP, Azure CLI, Azure DevOps CLI, network, shell, sandbox, agent, git, or secret-dependent calls to Sandcastle core tests.
