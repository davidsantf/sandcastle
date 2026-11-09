# Automatic downstream compatibility tasks

## Outcome

A host-verified upstream source/contract change can automatically create a
causally linked compatibility work item and focused agent task in each affected
downstream project. Use declared producer/consumer rules, not speculative code
inference. GitHub and Azure DevOps destinations use host-approved routes.
Previously authorized rules do not require a fresh human choice for each item.
No live project/rule is configured by this specification.

## Acceptance

1. Exact upstream revision, verified contract digest and evidence identify the
   change. Worker claims cannot authorize propagation. Unknown impact becomes
   explicit evidence-needed; unchanged/unaffected consumers produce no item.
2. Identity is deterministic from upstream change/contract version, downstream
   project and rule. Reserve before hub creation. Replay/restart creates no
   duplicate item or dispatch; reserved/unknown external outcomes never retry
   without independent host reconciliation.
3. Append validated tasks and their initial state atomically in durable catalog
   generations. Preserve the original immutable configured catalog and every
   prior generation. Existing running task intents, branches, scopes and
   artifacts are never silently rewritten.
4. Reject invalid/ambiguous task IDs, branches, scopes, unknown edges, cycles,
   repeated lineage and exhausted depth/task budgets. A second upstream version
   becomes an explicitly linked separate follow-up or safely reconciled
   supersession. It cannot mutate a running downstream task.
5. Each downstream task retains upstream evidence/artifact references and
   contract hashes. Its host acceptance independently proves the downstream
   matches that exact upstream version; a copied hash or successful worker
   claim alone is not evidence.
6. Issue/work-item identity and later published change-request registration are
   host-owned. A new ticket need not have a PR before narrow implementation.
   Missing publication/current-policy evidence remains pending/unknown, never
   green, and no unrelated project PR is borrowed.
7. Integrate the actual configured DevSquad phase-agent route. Missing framework
   capability fails closed; generic stage names do not prove DevSquad execution.
   Hub creation/publication/critical actions remain independently authorized.
8. Exercise A-to-B creation and readiness, no-op, fan-out, replay/restart,
   versions/supersession, cycles/budgets, GitHub-to-ADO and ADO-to-GitHub routes,
   exact acceptance matching and independent-lane isolation.

## Non-regression

Keep existing static catalogs, public host APIs and the POSIX ADO ledger
compatible. Retain lease fencing, non-vacuous checks, unknown reservations,
bounded concurrency/repair loops and host-owned authority. All factory,
review/audit and orchestration state shares one durable SQLite database.
