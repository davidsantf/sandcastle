# Slice 18 implementation plan

## Architecture

`runDevSquadAdoHumanControl` is an offline coordinator over the existing
schema-v1 workflow ledger and slice-16 read-only phase recovery.

- `status` returns current revision, state, active token-free claim metadata,
  and any pending phase occurrence.
- `audit` adds at most 100 recent minimized checkpoint entries.
- pause, resume, cancel, and finalize use one `dc18` checkpoint selected by the
  host. Core defines no lifecycle vocabulary or legal transition graph.
- adjudicate verifies an already reserved slice-16 occurrence and records its
  exact `dp16.c` or `dp16.f` terminal checkpoint using the human-selected
  outcome and immutable receipt commitment.

Every mutation requires two independent fresh exact echoes: an immutable human
decision verification and host policy authorization. Both are rechecked through
the durable checkpoint acknowledgement. Their earliest expiry is also supplied
as a request-digest-bound `notAfter` precondition that the ledger checks after
loading current state and immediately before atomic publication. Current claim,
fence, lease, revision, and phase/status remain mandatory.

## Replay and uncertainty

`dc18` operation IDs commit action, occurrence, intent, expected state, and
resulting state. Retained history is validated before replay. Reusing an
occurrence for another intent fails closed.

Retained controls require a trusted host verifier to rehydrate the exact human
decision and policy evidence before the API reports them as recorded. Retained
adjudications additionally use the slice-16 terminal receipt verifier.

An ordinary control cannot be recorded while a `dp16` occurrence is pending,
because that would insert a revision between reservation and its required
terminal checkpoint. Adjudication is the sole bounded path for closing that
uncertainty. A lost acknowledgement returns pending uncertainty; exact retry
recovers the durable operation only after trusted retained-evidence
verification.

## Bounds and privacy

- timeout: 1-300,000 ms, default 10 seconds;
- audit: 1-100 entries, default 20;
- human and policy grants: canonical UTC, at most five seconds;
- inherited plain-data limit: 256 KiB, 8,192 nodes, depth 16;
- inherited ledger/history/capacity and operation-ID limits.

No raw human evidence or provider response is persisted or returned.

## Validation

Run human-control, comment-feedback, phase-runner, and ledger tests serially on
Windows, followed by typecheck, tsup/DTS, public declaration guard, formatting,
and `git diff --check`. Perform independent adversarial and security reviews
before publication.
