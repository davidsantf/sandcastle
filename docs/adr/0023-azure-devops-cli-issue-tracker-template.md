# Azure DevOps issue-tracker templates use Azure CLI sandbox commands, not MCP

## Context

`docs/agents/adding-an-issue-tracker.md` defines issue-tracker integrations for `sandcastle init` as scaffolded shell commands plus sandbox CLI installation snippets. Generated projects run those commands themselves; Sandcastle is not in the loop at runtime.

Azure DevOps support creates an easy boundary confusion with the ADO control-plane and MCP adapter seams covered by ADR-0021 and ADR-0022. Those ADRs govern host-side orchestration, feedback loops, runners, and test seams. They do not decide what issue-tracker shell commands `sandcastle init` may scaffold into a generated sandbox.

## Decision

Add an Azure DevOps issue-tracker template for `sandcastle init` only if it uses Azure CLI plus the first-party Azure DevOps extension as sandbox shell commands.

The template must not generate MCP commands or depend on host-side MCP runtime availability.

The template must:

1. Install Azure CLI and the Azure DevOps extension inside the generated Debian sandbox before switching away from root.
2. Authenticate non-interactively with `AZURE_DEVOPS_EXT_PAT`.
3. Require Azure DevOps organization and project context through environment variables or explicit command arguments.
4. List work items non-interactively with structured JSON output.
5. Scope listed work items through configurable WIQL.
6. View one work item by `<ID>` non-interactively with JSON output.
7. Close or update one work item by `<ID>` non-interactively.
8. Make the closed state configurable because Azure Boards workflow states vary by process.
9. Keep Sandcastle core tests free of live ADO, MCP, network, Azure CLI, Azure DevOps CLI, and secret-dependent calls.

This decision does not change the ADO control-plane, fake control plane, MCP adapter seam, team runner, PR publishing, or feedback-loop boundaries.

## Consequences

- The Azure DevOps issue-tracker integration is a generated sandbox CLI scaffold, not a Sandcastle core runtime integration.
- MCP may complement host-side workflows, but MCP commands are not valid issue-tracker template commands for `sandcastle init`.
- ADR-0021 and ADR-0022 remain intact: Sandcastle ADO orchestration code must not directly call live ADO, MCP tools, Azure CLI, Azure DevOps CLI, network APIs, or secrets.
- Tests for this feature verify generated strings, Dockerfile snippets, env examples, and guardrails without making live Azure DevOps calls.
