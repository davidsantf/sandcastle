---
"@ai-hero/sandcastle": patch
---

Fix native filesystem identity checks for safe worktree reuse and pruning,
portable recursive copying on Windows, and POSIX sandbox destination paths,
including parent git directory alias mount remapping. Package CLI templates
with a portable Node filesystem build step so `init` can scaffold from the
compiled distribution without Unix `rm` or `cp` commands. Production Windows
ledger-storage support remains unchanged.
