---
"@ai-hero/sandcastle": patch
---

Persist bounded, redacted local-service failure causes in the canonical journal.
Retain the latest cause across restart, expose offline failure evidence and useful
CLI diagnostics, and report unacknowledged failure persistence explicitly.
Accept exact grants for currently inactive projects without authorizing effects
outside the active focus.
