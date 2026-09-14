# ADR-0030: Human controls are exact local ledger decisions

## Status

Proposed

## Context

The phase runner can retain an uncertain reservation, and feedback routing can
select later occurrences, but neither may infer a human finalization or control
decision. Comments and reactions are untrusted data. Live provider operations
remain outside Sandcastle core.

## Decision

Add one offline human-control API with:

1. read-only minimized status and bounded audit projections;
2. host-selected pause, resume, cancel, and finalize state transitions;
3. independent exact human-evidence verification and policy authorization;
4. current claim, fence, lease, revision, and state enforcement;
5. explicit adjudication of one retained pending slice-16 occurrence by writing
   its canonical terminal checkpoint only after fresh trusted verification of
   the human-selected outcome and immutable receipt commitment; and
6. trusted retained-decision rehydration before reporting any replayed control
   or adjudication as recorded.

Ordinary controls are rejected while a phase occurrence is pending. This keeps
the slice-16 invariant that a terminal checkpoint immediately follows its
reservation. Adjudication is not an automatic retry and never executes the
effect again.

The host owns identity, human evidence, policy, legal transitions, phase/status
vocabulary, receipt verification, and all provider actions. ADRs remain
Proposed and no merge or publication authority is added.

The earliest human, policy, and receipt-verification expiry is passed to the
ledger as a digest-bound `notAfter` precondition and checked immediately before
atomic publication. This prevents a delayed write from converting an expired
grant into durable state.

## Consequences

- Restart recovery remains deterministic and exact.
- Human decisions cannot be inferred from text or notifications.
- An uncertain effect can be closed without rotating an occurrence or
  redispatching work.
- Raw evidence stays in host storage; the ledger retains commitments only.
- Slice 19 must supply any live ADO MCP transport and map it into these injected
  contracts.

## Alternatives rejected

- **Treat comments as controls:** rejects the authentication and authority
  boundary.
- **Retry uncertain effects:** can duplicate external mutation.
- **Insert pause/cancel between reservation and terminal:** corrupts the
  consecutive slice-16 history invariant.
- **Merge or complete a PR in core:** provider-specific and outside the human
  merge gate.
