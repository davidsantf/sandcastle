# DevSquad/ADO human control and finalization (slice 18)

## Problem

Slices 16 and 17 execute one explicitly selected phase and route comment
feedback, but intentionally cannot finalize, pause, resume, cancel, report
status/audit, or adjudicate an uncertain effect. Sandcastle needs a bounded
offline control surface without interpreting human text or calling a provider.

## Requirements

| ID     | Requirement                                                                                                                                                                                                                                                                                                                      |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-001 | Provide read-only `status` and bounded `audit` projections without requiring mutation authority or calling host authorization seams.                                                                                                                                                                                             |
| FR-002 | Require an exact current revision/state, current claim capability, immutable human-decision evidence, and fresh exact host policy for every pause, resume, cancel, finalize, or adjudicate mutation.                                                                                                                             |
| FR-003 | Treat actor IDs, decision labels, comments, reactions, and verifier output as evidence only. Only the injected verifier and policy may authorize the exact operation.                                                                                                                                                            |
| FR-004 | Keep phase/status vocabulary and legal transitions host-owned. Core validates structure and exact echoes but does not infer lifecycle legality.                                                                                                                                                                                  |
| FR-005 | Persist control transitions through the schema-v1 ledger using exact CAS, fencing, lease, idempotency, and direct acknowledgement checks.                                                                                                                                                                                        |
| FR-006 | Reject same-occurrence equivocation and recover exact accepted operations without repeating mutation, but only after a trusted host verifier rehydrates the original human decision and policy evidence.                                                                                                                         |
| FR-007 | Do not interleave ordinary controls with a pending slice-16 occurrence. An uncertain occurrence must first be explicitly adjudicated.                                                                                                                                                                                            |
| FR-008 | Adjudication requires the exact retained pending phase input, read-only phase recovery, a human-selected completed/failed outcome, and fresh trusted verification of the proposed immutable terminal receipt before writing. It records the corresponding slice-16 terminal checkpoint so normal recovery remains authoritative. |
| FR-009 | Bound input, audit output, calls, wall/monotonic time, cancellation, and fresh grants. Late settlement cannot start a later operation.                                                                                                                                                                                           |
| FR-010 | Persist only commitments and minimized state. Never persist raw comments, prompts, tokens, provider diagnostics, or human evidence bodies.                                                                                                                                                                                       |
| FR-011 | Add no live ADO, GitHub, MCP, network, merge, approval, or business-publication operation. Slice 19 owns the host-side adapter.                                                                                                                                                                                                  |
| FR-012 | Preserve prior APIs and Proposed ADR status; export an Effect-free public API, README runbook, deterministic tests, and minor changeset.                                                                                                                                                                                         |

## Conformance

Tests cover read-only status/audit, exact replay, denied human evidence, stale
fencing, occurrence equivocation, pending-phase isolation, and explicit
completed/failed adjudication. All provider and human systems remain injected
fakes.
