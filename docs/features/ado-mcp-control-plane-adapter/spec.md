# Host-side Azure DevOps MCP control-plane adapter (slice 19)

## Problem

Sandcastle already defines provider-neutral ADO control-plane interfaces and
offline DevSquad workflow protocols. Hosts need a bounded bridge to an ADO MCP
runtime without importing MCP packages, discovering tools, reading credentials,
or allowing sandbox code to invoke provider operations directly.

## Requirements

| ID     | Requirement                                                                                                                                                                                                                                    |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-001 | Accept only an explicitly injected MCP transport; never discover a runtime, credential, organization, project, repository, or tool dynamically.                                                                                                |
| FR-002 | Allow only the declared ADO work-item, comment, pull-request, review-thread, and pipeline tool names. Reject every other tool before transport invocation.                                                                                     |
| FR-003 | Map work-item reads/updates, comments, and PR creation to explicit typed requests containing configured organization/project/repository scope.                                                                                                 |
| FR-004 | Keep CI and review topology host-owned through bounded selector builders because build definitions and policy layouts vary. The adapter fixes each read tool/action and protected scope; builders cannot select a write or another repository. |
| FR-005 | Require explicit access and separate read-only and write-capable adapters so a read-only instance exposes no update, comment, or PR creation method.                                                                                           |
| FR-006 | Require explicit response decoders, then independently bound, validate, and canonically project decoded public `AdoControlPlane` values before returning them.                                                                                 |
| FR-007 | Snapshot bounded plain-data inputs and outputs, reject accessors/cycles/custom prototypes/oversize data, execute once, and never retry an uncertain transport effect.                                                                          |
| FR-008 | Bound each call with cooperative cancellation and an actual timeout race. Ignore late settlement and return only sanitized errors.                                                                                                             |
| FR-009 | Do not expose secrets, tokens, raw provider diagnostics, or transport objects through results or errors.                                                                                                                                       |
| FR-010 | Do not approve, complete, merge, or finalize PRs. Human-control decisions remain slice 18 and provider mutation requires a separately configured write adapter.                                                                                |
| FR-011 | Use injected fakes in tests; perform no live ADO, MCP, network, Azure CLI, or Azure DevOps CLI invocation.                                                                                                                                     |
| FR-012 | Export the Effect-free API, README runbook, Proposed ADR, deterministic tests, and minor changeset.                                                                                                                                            |

## Conformance

Tests cover read-only capability shape, exact request mapping, write mapping,
allowlist rejection, malformed output, input bounds, accessors, timeout,
cancellation propagation, late settlement, and sanitized transport failure.
