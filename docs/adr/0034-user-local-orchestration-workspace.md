# ADR 0034: Versioned user-local workspace and fenced service

Status: accepted.

## Context

The original durable multi-project host requires an explicitly supplied catalog
and host module. Continuous user-local discovery must onboard projects without
unrelated existing PRs, preserve authority across restart, and share state with
the core without changing historical catalog digests.

## Decision

Store strict, revisioned plain-JSON configuration and append-only workspace
events in additional versioned tables in the core SQLite file. Use synchronous
CAS and atomic stacked owner/configuration guards. Configuration edits invalidate
old guarded writers; service ownership is stable until callbacks settle or
same-host process death is independently confirmed. Do not steal ownership
merely because a callback exceeded a time budget.

Start with observe mode and no effect permissions. Separate project registration,
discovery source, accepted task intent, and later change-request registration.
Project-level PR defaults remain backward compatible but are optional. Missing
change requests yield unknown evidence, not undefined hub requests or green
zero-check evaluation. Removal affects local registration only.

Trusted local CLI edits may widen grants; remote text and service control may
not. Backend capability and identity evidence remain independent prerequisites
in the default strict execution policy.
Installed definition hashes and a successful command are not invented model
attestation. Optional startup generation produces artifacts without OS changes.

The user explicitly authorized a second, opt-in `trusted-local` execution policy.
It trusts the installed CLI to honor the requested named agent and model, while
retaining exact definition checks and durable owner/configuration-fenced launch
reservations. Its evidence is host provenance, never independent backend proof.
The workspace uses the existing no-sandbox provider only under this explicit
policy; credential/network isolation is not provided. Unknown outcomes and
unacknowledged result writes retain their reservations and cannot automatically
replay. Existing independent critics, critical approvals, verification and
publication gates are not weakened.

The subsequent automatic-implementation requirement adds a built-in native
bridge to the existing core, not a second lifecycle. Exact approved proposals
and trusted templates determine immutable issue-backed catalogs and cause records.
Persist the complete admission index in one CAS so crashes cannot orphan a run.
Check captured workspace owner/control/configuration guards inside every core
transaction on the same connection. Deterministic binding and artifact seeding
allow known pre-invocation recovery; running invocations remain unknown without
retry. Recheck native source facts, Git registration and implement permission
before launch. Isolate stale retained lanes and preserve historical evidence
after configuration edits. Implemented-but-unverified native tasks retain scope
holds until independent host reconciliation. No native publication callback or
independent critic proof is fabricated.

## Consequences

Public CLI setup no longer needs an executable authority module for read-only
discovery/service operation. Strict native execution remains blocked when the
installed backend cannot provide the required identity evidence. Explicit local
trust permits native proposal planning and approved scoped implementation through
public run/service commands, not independent verification or completed acceptance.
Report these distinct limits instead of treating local
provenance as backend proof or granting authority through worker assertions.
