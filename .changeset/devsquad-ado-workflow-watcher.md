---
"@ai-hero/sandcastle": minor
---

Add a bounded offline DevSquad/ADO workflow watch pass that turns injected read-only observations into durably checkpointed intake signals. Candidate ordering is deterministic; checkpoint operation identifiers are scoped to the cursor advance they publish so a retry replays instead of duplicating, while claim-lifecycle identifiers are scoped to a random per-acquisition epoch so the same `passId` always stays retryable and capability tokens stay independently random. An observation invalidated between its record read and its claim is abandoned rather than written, so a cursor never moves backwards. Injected ledger faults resolve as typed, redacted candidate failures that still release the claim. Delivery is at-most-once and never duplicating. Budgets cover poll count, poll-start elapsed time, per-observation timeouts, and cancellation; ledger recovery categories stay fail-closed and every result projection is token-free.
