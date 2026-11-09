# Multi-project orchestration tasks

- [x] Strict catalog, receipt, DAG, and scope validation.
- [x] Transactional journal, append-only events/artifacts, leases, fencing,
      recovery, and explicit reconciliation.
- [x] Bounded scheduler and DevSquad lifecycle, contract prerequisites, host
      authorization, repair limits, and independent-lane isolation.
- [x] Native GitHub/ADO evidence adapters with injected transports.
- [x] Sandcastle worker integration and host-owned validation.
- [x] Public API, CLI, agent, demo, docs, and changeset.
- [x] Targeted behavior tests, typecheck, persistent demo, and review evidence.

Schemas precede journal/scheduler; hub adapters are independent after schemas.
Worker integration requires scheduler contracts. Entry points require runtime
components. Verification follows implementation.

## Expanded Cowork request

The core checklist above is complete, not the expanded whole-product request.
Review/model routing/governance and signal-factory/measured-loop/release
observation slices are being specified and implemented separately. Their ready
revisions must be integrated into this host and exercised through one runnable
entrypoint before the expanded request is complete. See [core review](./review.md)
for the precise core-only coverage boundary.
