---
"@ai-hero/sandcastle": patch
---

Fix checkpoint ID collisions when a work item switches pull requests and the same pass observes identical PR-local thread/comment IDs. Newly prepared checkpoints involving PR observation now include the observed PR destination, even for work-item-only cursor advances. Add a checkpoint-only namespace overload while preserving the legacy one-argument helper, no-PR and claim-lifecycle IDs, discovery initialization, and original-ID recovery. No ledger or receipt migration is required.
