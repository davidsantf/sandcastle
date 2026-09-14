# DevSquad/ADO comment feedback loop (slice 17)

## Problem and authority boundary

After a bounded slice-16 phase reaches a verified terminal receipt, the host may
observe comments or review feedback and choose another phase occurrence.
Sandcastle core needs an offline, restart-observable composition that preserves
that provenance without interpreting comments as permission or taking ownership
of DevSquad lifecycle policy.

The host owns provider APIs, comment identity and authentication, immutable
evidence, phase vocabulary and ordering, legal transitions, artifact
persistence, and authorization policy. Slice 16 remains the only
reservation/execution protocol. Comments, reactions, watcher notifications, and
normalizer output are data only.

## Requirements

| ID     | Requirement                                                                                                                                                                                                                                                                                                                                |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FR-001 | Accept exactly one prior slice-16 terminal phase receipt and require trusted read-only recovery to match its work item, occurrence, intent, state, reservation revision, terminal revision, and receipt digest.                                                                                                                            |
| FR-002 | Accept 1-64 host-observed comment/review evidence items in strictly increasing authoritative ordinal order. Bind provider, container, event/version, timestamp, immutable evidence ID, kind, and exact body. Reject duplicates, malformed timestamps, accessors, cycles, custom prototypes, and excess input before host seams run.        |
| FR-003 | Treat bodies, reactions, identifiers, notification presence, and normalization output as non-authorizing evidence. Do not parse commands, authenticate actors, infer approval, auto-resolve comments, or auto-advance a phase.                                                                                                             |
| FR-004 | Invoke one injected normalizer with an immutable bounded request. Require an exact echoed request, bounded normalized content, normalizer identity, and immutable evidence identity. Commit both identities into the normalized digest. Dependency mutation or malformed output fails closed.                                              |
| FR-005 | Require a fresh exact host route grant for the source receipt, evidence digest, normalizer/output identities, normalized digest/content, selected phase, occurrence, owner/fence, and random challenge. The grant expires within five seconds and remains fresh through the slice-16 reservation only; later phase policy is independent.  |
| FR-006 | Let the host explicitly select one distinct new occurrence, plugin identity/version, expected state/revision, success/failure states, and either feedback preparation or an exact phase re-entry. Core defines no phase vocabulary or transition legality.                                                                                 |
| FR-007 | Add a fixed feedback binding to the selected phase intent: source occurrence/intent/state/revisions/receipt, evidence digest, and normalized digest. Raw comment bodies and dependency diagnostics never enter the ledger or result.                                                                                                       |
| FR-008 | Delegate all durable reservation, phase policy, design/target checks, execution, validation, terminal recording, concurrency, replay handling, and effect uncertainty to `runDevSquadAdoPhase`. Do not add a ledger namespace, sidecar, outbox, schema migration, or duplicate CAS/protocol logic.                                         |
| FR-009 | Exact replay of a selected occurrence never repeats its effect. A different occurrence is a new explicit host selection and requires a new route grant. Pending/uncertain slice-16 results remain consumed.                                                                                                                                |
| FR-010 | Provide read-only recovery that verifies the source binding and invokes `recoverDevSquadAdoPhase` for the selected input. Recovery never normalizes, authorizes, writes, dispatches, or reconstructs raw evidence.                                                                                                                         |
| FR-011 | Snapshot selected seams before awaits. Bound total input, output, calls, wall/monotonic time, and cancellation, including both reads in recovery under one deadline. Timeout/cancel retires continuations but does not claim an in-process dependency or external effect stopped. Late settlement cannot authorize or dispatch later work. |
| FR-012 | Preserve slice12-16 APIs and Proposed ADR status. Export an Effect-free public API, README example/runbook, deterministic fake tests, and a minor changeset.                                                                                                                                                                               |

## Conformance and threat cases

Tests cover:

- exact source receipt and ledger correlation;
- ordered comment/review provenance and bounded normalization;
- comments, reactions, and command-like text as non-authorizing;
- exact, denied, stale, and mutated host route grants;
- preparation and implementation re-entry through slice 16;
- stale revision, fence, lease, and source evidence;
- same/different-occurrence concurrency, exact replay, and read-only recovery;
- malformed or mutated normalizer/phase dependency output;
- settled failure, timeout, cancellation, late settlement, and restart;
- no live ADO, GitHub, MCP, network, board, shell, git, daemon, publication,
  comment-resolution, PR-finalization, or merge operation.

## Explicit deferrals

Slice 18 owns human finalization, pause/resume/cancel/status/audit UX, and
uncertain-effect adjudication. Slice 19 owns the live host-side ADO MCP adapter.
Single-call cancellation and read-only recovery are substrate safety, not those
future control-plane workflows.
