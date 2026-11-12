---
"@ai-hero/sandcastle": patch
---

Check both rename sources and destinations when verifying orchestration file
scopes and recording local edits, so Git rename detection cannot hide an
out-of-scope source deletion.
