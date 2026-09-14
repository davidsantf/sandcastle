---
"@ai-hero/sandcastle": patch
---

Fix the offline workflow watcher's runtime ledger validation, bounded unique observation windows, and cooperative cancellation. Report mandatory claim-cleanup evidence and independent cleanup counts without retracting acknowledged cursor changes or intake signals. Preserve original replay revisions, fail closed on malformed acknowledgements, and document at-most-once delivery and host reconciliation.

Isolate adapter requests from validation and pending cursors, reject contradictory replay acknowledgements, sanitize observation accessor failures as invalid windows, and report cancellation even after the final acknowledged checkpoint or during cleanup.

Enforce array ceilings during indexed traversal despite accessor mutation, ignore custom iterators, sanitize signal/configuration getters before side effects while preserving live cancellation, and snapshot only public ledger response fields without touching unrelated payload getters.

Validate ambiguous checkpoint history with the same acknowledgement guard against the original submitted request. Reject contradictory accepted revisions and same-revision cursors, state, timestamps, or authority while preserving valid historical acceptance after later mutations and renewal-aware retries.
