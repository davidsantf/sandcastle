# ADR-0032: Host-owned multi-project orchestration

Status: Accepted

## Context

Existing DevSquad ADO workflows provide single-task lifecycle primitives, not a
catalog scheduler. Cowork's lessons call for narrow workers, host authority,
durable state, bounded loops, and non-vacuous checks. DevSquad supplies amendable
spec/plan/tasks artifacts without eliminating human authorization.

## Decision

Compose a catalog host using DevSquad and existing Sandcastle execution APIs.
Use Node's built-in SQLite for an owner-controlled catalog journal and exclusive
host leases. Transactionally reserve invocations and append evidence before
external effects. Fence stale hosts and never redispatch unknown outcomes.
Normalize GitHub/ADO evidence independently of worker claims.

The SQLite journal is a separate trust boundary, not a replacement or weaker
fallback for the existing POSIX-only ADO ledger. It does not claim ACL privacy,
reparse-safe opens, hostile same-user protection, or network filesystem safety.

## Consequences

Node 22.13+ and trusted local storage are required. One journal must cover all
coordinated repository scopes. Workers use named branches; the host owns exact
dispatch authorization, validation, revision checks, and optional publication.
Publication is a separately authorized external process; it is not implemented
by these read-only adapters. No automatic merge/deploy or unrequested PR creation. Real sandbox guarantees
depend on the configured provider. Unknown outcomes require human reconciliation.
