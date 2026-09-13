# ADR-0028: Host-selected phases compose durable reservations and explicit runtime authority

## Status

Proposed

## Context

ADRs 0024-0027 provide execution, local fenced checkpoints, historical discovery,
and immutable design approval. None chooses the next DevSquad phase or grants
execution authority from a historical checkpoint. Slice 16 needs restart-observable
phase execution without importing the later feedback/finalization/live-adapter
work or turning the schema-v1 ledger into an artifact store.

## Decision

Expose one bounded host-selected phase invocation and read-only recovery. The host
supplies plugin identity, vocabulary, legal exact transitions and policy. Content
preparation runs through an injected content-only handler; implementation always
delegates the existing Sandcastle execution adapter.

A same-state schema-v1 checkpoint reserves the sole occurrence before any handler.
Only a fresh, exact direct acknowledgement can precede dispatch. Full retained
runner history prevents another occurrence from bypassing an unresolved attempt.
A terminal checkpoint commits a minimized result digest and the host-selected
success/failure state. No replay or recovery read dispatches an effect.
Because the generic ledger namespace is not an authorization boundary, a trusted
host audit verifier must rehydrate the exact policy/design/execution evidence
before recovery or a repeated call reports a retained checkpoint as terminal.

Implementation requires durable slice-15 approval, an independent trusted host
attestation rehydrating the exact immutable human/publication/material evidence
and matching the actual executable context, and a fresh slice-15 target proof.
An approved historical marker or descriptive target handoff is insufficient.
Tokens are sent only to ledger mutation methods; grants contain nonsecret
owner/fence plus exact intent and state. Engineering auto-approval is never a
runtime grant.

The runner captures supplied seams and Sandcastle provider functions/configuration
before its first await. The runtime design verifier receives the captured execution
mode and provider identity, and a failed or malformed validation response prevents
all later validation dispatches in that invocation.

Bounds and cancellation retire continuations but do not assert an external
operation stopped. Unknown effects leave a consumed reservation. The host must
not reset history or rotate IDs to retry them; future explicit adjudication belongs
to the lifecycle/control-plane scope.

## Alternatives considered

- Automatic lifecycle graph: rejected; ownership remains with DevSquad.
- Dispatch from an idempotent receipt: rejected; historical acknowledgement is not
  fresh authority and cannot prove an effect was never invoked.
- Store raw results/prompts or add a sidecar: rejected; exceeds schema-v1 purpose,
  introduces disclosure and cross-file atomicity risks.
- Treat persisted approval as a fresh grant: rejected; evidence can be unavailable,
  the current target can differ, and the executable inputs must match the review.

## Consequences

The host can resume after terminal checkpoints and prepare the next phase. Unknown
effects stop safely rather than retry automatically. Artifact storage, runtime
evidence verifiers, remote-effect settlement, phase ordering, and product
finalization remain host-owned. Existing schema and APIs remain compatible.
Windows portable tests do not expand production ledger filesystem support.

## References

- [Specification](../features/devsquad-ado-phase-runner/spec.md)
- [Plan and schema proof](../features/devsquad-ado-phase-runner/plan.md)
- [ADR-0024](0024-devsquad-sandcastle-execution-adapter-boundary.md)
- [ADR-0025](0025-devsquad-ado-workflow-ledger.md)
- [ADR-0026](0026-devsquad-ado-workflow-watcher.md)
- [ADR-0027](0027-devsquad-ado-design-approval-gate.md)
