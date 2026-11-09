# User-local orchestration product

## Outcome and authority

Extend the durable Cowork host into a user-local, CLI-operated product using
DevSquad. Onboard repositories without a pre-existing PR, focus work explicitly,
discover GitHub/ADO work, investigate and propose acceptance-bound plans, and
execute only policy-authorized work. Hub prose is data, never authorization.
Observe is the initial mode and effect permissions start empty.

The earlier implementation merge is a separately authorized delivery action.
The earlier core was merged through PR40 at
`e9a28b245f39b33df95277e4d7676996268c597b`, using the user-authorized account
and normal repository policy. This expansion is separate from that merge.

## Acceptance

1. `orchestrate workspace` initializes versioned local state, registers/lists/removes
   local repositories and producer-consumer routes, and validates setup. Removing
   registration changes local configuration only, never repository files or hubs.
2. Empty project and task inventories are valid during onboarding/discovery.
   Project-level PR defaults remain backward compatible but become optional.
   Missing task PR cannot call an undefined hub endpoint or borrow another task's PR.
3. One user-local service supports start, stop, restart/recovery, pause/resume,
   status and optional startup artifact generation. No startup is installed implicitly.
   Single-instance ownership and durable effect reservations survive interruption.
4. Focus includes projects/team/iteration/query, priority, concurrency/budgets,
   Observe/Propose/Execute and exact per-project action permissions. Unauthorized
   downstream work becomes a handoff, not permission escalation.
5. Assigned/opt-in/review/dependency discovery uses durable cursors and identity
   dedupe. Stale, superseded and uncertain outcomes are explicit. Discovery feeds
   investigation/spec/plan/acceptance proposals before authorized implementation;
   publishing work items/PRs is independently authorized.
6. CLI exposes proposed/running/blocked/ready evidence, notifications,
   reprioritization, budgets and diagnostics. Configuration edits are versioned
   CAS; stale concurrent edits fail rather than overwrite newer intent.
7. Concrete native host controls and runtime capability diagnostics work without
   an arbitrary user-written authority module. Available live read-only scope may
   be checked; absent credentials/framework capability is a truthful blocker.
   No arbitrary live ticket/PR, broad permission request or startup installation
   is part of verification.
8. Strict independent-backend identity remains the default. Explicitly authorized
   trusted-local mode trusts installed CLI agent/model selection, labels host
   provenance honestly and atomically retains invocation/request/configuration
   launch evidence. It does not fabricate backend attestation, provide OS
   isolation or satisfy stronger-proof
   review/critical/publication gates. Lost evidence, canceled or uncertain
   invocations are not automatically replayed.
9. Public native run/service paths dispatch approved issue-backed work through
   the real existing core without a hand-authored authority module. Require exact
   proposal digest/source/configuration approval, trusted task template, current
   Execute focus and implement permission. Atomically retain admission and
   recovery index; fence core writes with workspace ownership/configuration on the
   same database. Recover pre-invocation crashes without repeating unknown
   invocations; stale lanes do not block unrelated recovery. Preserve unresolved
   file-scope holds and old configuration evidence. A native admission or local
   implementation is never fabricated review, acceptance, CI or publication.

## Non-regression and verification

Retain immutable core catalogs/generations, lease fencing, journal evidence,
unknown reservations, current revision checks, bounded loops and host-owned
critical approvals. Workspace, discovery and service state use the same local
SQLite file as core task state, in separate versioned tables; no second event
database is introduced. Existing schema-1/2 journals must open without alteration
of historical catalog identities. Test CLI manual flows and restart behavior,
wrong/stale configuration, negative authority controls, empty onboarding and
later PR registration. Distinguish injected evidence from live provider/framework
execution and report any unconfigured capability instead of fixture success.
