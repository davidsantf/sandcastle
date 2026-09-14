# ADR-0029: Comment feedback is provenance for an explicitly authorized phase

## Status

Proposed

## Context

Slices 12-16 provide one-task execution, a fenced local ledger, historical
watcher discovery, immutable design approval, and one host-selected phase. They
do not define how terminal phase receipts and later comment feedback select a
new phase occurrence.

Comments cross an external trust boundary. Their text, reactions, notification
presence, author labels, and provider identifiers cannot grant execution,
design, transition, or lifecycle authority. At the same time, replaying the
same selected occurrence after a lost response must not repeat its effect.

The host owns provider authentication, immutable evidence acquisition, comment
identity, phase vocabulary and ordering, legal transitions, artifact
persistence, and policy. ADR-0028 already provides the only local
reservation/execution protocol required by this slice.

## Decision

Add an offline comment-feedback coordinator that:

1. verifies one minimized terminal slice-16 receipt through the existing
   read-only phase recovery API and trusted terminal-receipt verifier;
2. validates and hashes a bounded, host-observed, ordinally ordered evidence
   prefix;
3. invokes an injected content normalizer whose exact request, bounded output,
   normalizer identity, and immutable output-evidence identity are verified and
   committed but never treated as authority;
4. requires a fresh host route grant that echoes the exact source receipt,
   evidence and normalization commitments, selected phase, occurrence,
   owner/fence, and challenge;
5. adds a non-authorizing feedback commitment to the selected slice-16 phase
   intent and delegates reservation, execution, terminal recording, replay
   protection, and recovery to slice 16.

Legacy slice-16 inputs without feedback retain the exact `dp16.intent.v1`
digest. Feedback-bearing inputs use `dp16.intent.v2`, preventing the extension
from invalidating retained predecessor reservations or terminal receipts.

No `df17` ledger namespace or sidecar is added. The selected `dp16` occurrence
remains the durable unit. Replaying that exact occurrence can only recover or
report its retained result; it cannot redispatch. Choosing a different
occurrence is a new host decision requiring a new exact route grant.

The route grant is capped into the slice-16 reserve policy grant so it must
remain fresh until reservation. It does not stay authoritative for the duration
of execution. Later slice-16 dispatch and terminal policy, design, target, claim,
fence, lease, and receipt checks remain independently authoritative.

Read-only feedback recovery verifies the source binding and delegates selected
phase recovery to slice 16 under one shared deadline. It does not normalize
comments, request route authorization, or execute a phase.

## Alternatives considered

### Parse comments as commands in core

Rejected. Comment text and reactions are untrusted evidence, and Sandcastle
does not authenticate provider identities or own lifecycle policy.

### Add a separate feedback ledger protocol

Rejected. It would duplicate slice-16 reservation, CAS, fencing, receipts,
uncertainty, and recovery logic while consuming another checkpoint namespace.

### Call the legacy ADO feedback loop

Rejected for this boundary. That helper owns an older control-plane polling and
comment-writing workflow, carries body/author-oriented provider types, and does
not provide slice-16 receipt correlation or exact phase occurrence authority.

### Let the normalizer choose and execute the next phase

Rejected. Normalization is content processing only. The host must explicitly
select the occurrence and grant the exact route; slice 16 remains the executor.

## Consequences

- Comments can be converted into bounded feedback preparation or an explicitly
  selected phase re-entry without becoming authorization.
- Exact source, evidence, normalization, and selected occurrence provenance is
  committed into the phase intent while raw comment bodies stay out of ledger
  history and results.
- The coordinator is offline and deterministic under injected host fakes.
- Missing, stale, malformed, mutated, or unverifiable evidence fails closed.
- An uncertain selected phase remains consumed under ADR-0028; slice 17 does
  not adjudicate or retry it.
- The host must retain raw evidence and normalized artifacts needed by its
  verifiers. A digest is not an artifact store.

## Deferrals

Slice 18 owns human finalization and pause/resume/cancel/status/audit UX,
including uncertain-effect adjudication. Slice 19 owns live host-side ADO MCP
transport. This ADR adds no provider call, daemon, publication, external
mutation, comment resolution, PR approval, merge, or automatic phase advance.

## References

- [ADR-0024](0024-devsquad-sandcastle-execution-adapter-boundary.md)
- [ADR-0025](0025-devsquad-ado-workflow-ledger.md)
- [ADR-0026](0026-devsquad-ado-workflow-watcher.md)
- [ADR-0027](0027-devsquad-ado-design-approval-gate.md)
- [ADR-0028](0028-devsquad-ado-phase-runner.md)
- [Specification](../features/devsquad-ado-comment-feedback/spec.md)
- [Plan](../features/devsquad-ado-comment-feedback/plan.md)
