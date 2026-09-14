# DevSquad/ADO phase runner (slice 16)

Engineering execution is user-authorized for this slice on base
`6c9c4c279a1aadbc1018613c90c52297d23d5219`. That authorization is not a product
ADR acceptance, runtime human design grant, or permission to publish externally.

## Problem and boundary

Slice 12 executes one selected implementation. Slice 13 retains fenced local
checkpoints. Slice 14 emits historical notifications. Slice 15 records immutable
design decisions and descriptive target provenance, deliberately without a phase
vocabulary or execution ticket. DevSquad needs to compose these primitives into
one bounded, restart-observable, host-selected phase invocation.

The host/plugin owns phase names, ordering, legality, artifact storage, runtime
policy, capabilities, and selection of the next phase. Core does not autonomously
advance spec/plan/ADR/decompose/implement/review/publish. A content-only preparation
handler supports host-selected engineering phases (including publish preparation,
not publication); implementation uses the existing execution adapter. No live
tracker, shell, git, provider, or external publication implementation is added.

## Requirements

| ID     | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FR-001 | Execute at most one explicitly selected phase occurrence per call. Require exact expected revision/phase/status and explicit host success/failure states. No lifecycle vocabulary, scheduler, claim acquisition, or renewal.                                                                                                                                                                                                                                                                                                                                                                           |
| FR-002 | Snapshot bounded serializable input before awaiting dependencies. Bind occurrence, work item, plugin identity/version, phase states, context, commands/bounds, and design/target commitments into an immutable intent digest. Capability, cancellation, and observation challenges are not semantic content.                                                                                                                                                                                                                                                                                           |
| FR-003 | Use existing schema-v1 checkpoints only: a same-state reservation and a terminal success/failure checkpoint. Retain domain-separated full SHA-256 commitments in operation IDs within 256 bytes. No sidecar, cursor abuse, schema change, eviction, or artifact bodies in the ledger.                                                                                                                                                                                                                                                                                                                  |
| FR-004 | Inspect the complete retained runner history. Any malformed namespace, conflicting receipt, or unresolved occurrence blocks a new occurrence on that item. A changed occurrence cannot bypass uncertainty. Completed occurrences are historical receipts, never dispatch tickets, and require trusted host audit rehydration before they are reported as terminal.                                                                                                                                                                                                                                     |
| FR-005 | Only a fresh direct reservation acknowledgement with exact method/outcome/record delta and current unexpired owner/fence yields a one-use dispatch opportunity. Replay, readback, lost response, forged acknowledgement, stale CAS, or a later revision never yields one.                                                                                                                                                                                                                                                                                                                              |
| FR-006 | Host policy must explicitly authorize exact reserve, dispatch, and terminal mutation requests. Grants echo a fixed snapshot of the intent, expected state, operation, transition, and nonsecret owner/fence. No permissive default or Boolean grants.                                                                                                                                                                                                                                                                                                                                                  |
| FR-007 | Implementation additionally requires a durably approved slice-15 occurrence, independently rehydrated human/publication/material authorization bound to the actual execution input and retained decision commitment, and a fresh exact current target proof. Historical `approved`, `evidence-unavailable`, and `targetHandoff` alone do not authorize execution. The trusted host verifier must check the actual spec/plan/commands against approved immutable artifacts and the human policy grant; engineering auto-approval cannot satisfy it.                                                     |
| FR-008 | Bind execution work item, branch, and absolute worktree to the approved target. Snapshot the selected execution seam and Sandcastle provider functions/configuration before the first await; expose the captured execution mode/provider identity to the trusted verifier. The host independently verifies repository/source/worktree/agent/session identities. Recheck the exact ledger revision and live owner/fence after asynchronous policy/proof work and before every execution/validation entry. No execution adapter replacement or bypass path.                                              |
| FR-009 | Use finite wall/monotonic budgets, bounded calls/input/output/history, cooperative cancellation, and lease-aware retirement. A timeout/cancel/rejected dependency or uncertain execution remains unresolved; late continuations cannot dispatch validation or checkpoint. Stopping a local continuation is not proof an external effect stopped.                                                                                                                                                                                                                                                       |
| FR-010 | Persist success only after successful execution and all requested validation; completed-but-validation-failed is a settled failure. Missing, malformed, or thrown execution outcomes are uncertain rather than falsely terminal. Return only minimized receipt commitments/status, not provider diagnostics, prompts, raw logs, tokens, or token digests.                                                                                                                                                                                                                                              |
| FR-011 | Read-only recovery returns unreserved, pending/uncertain, completed, failed, or blocked with exact retained revisions and receipt commitment. A terminal commitment is reported as completed/failed only after a trusted host verifier rehydrates its exact policy/design/execution audit trail; the generic ledger namespace is not an authority boundary. Restart never repeats a reserved occurrence. The host may proceed to another phase only after a verified terminal receipt; recovery of an uncertain external effect requires a future explicit adjudication protocol, not automatic retry. |
| FR-012 | Keep supplied-mode watcher, ledger, approval, and execution APIs compatible. Export the new Effect-free API, provide a deterministic example/runbook and minor changeset.                                                                                                                                                                                                                                                                                                                                                                                                                              |

## Acceptance and threat cases

Tests must demonstrate host preparation and approved Sandcastle completion,
success/failure state receipts and read-only restart, exact policy denial, absent
human/target evidence, mismatched design/material/target, stale revision/fence/
lease, concurrent same/different occurrences, replay and forged acknowledgements,
dependency mutation, lost reservation/terminal response, cancellation/timeouts,
late execution settlement, bounds and malformed retained history. Existing
affected suites remain required; inherited global failures are not slice failures.

## Explicit deferrals

Slice 17 comment feedback consumes minimized terminal receipts and selects a new
host-authorized phase; comments themselves never grant authority. Slice 18 owns
finalization, pause/resume/cancel/status/audit UX and uncertain-effect adjudication.
Slice 19 owns live host-side ADO MCP adapters. No such behavior is implemented here.
Single-call cooperative cancellation and read-only recovery are substrate safety,
not those future product control-plane workflows.
