# Slice 17 implementation plan

## Alignment

- ADR-0024: implementation re-entry delegates the existing execution adapter.
- ADR-0025: the schema-v1 ledger, claim capability, exact CAS, fencing, retained
  receipts, capacities, and filesystem boundary are unchanged.
- ADR-0026: watcher observations are historical signals only.
- ADR-0027 remains Proposed: comment evidence is not design approval.
- ADR-0028 remains Proposed: slice 16 owns one selected phase occurrence,
  execution authority, terminal receipts, replay safety, and recovery.
- ADR-0029 is Proposed and records only this feedback composition.

## Public composition

`runDevSquadAdoCommentFeedback` accepts:

1. one exact minimized source phase receipt plus its original phase input;
2. a bounded authoritative evidence prefix supplied by the host;
3. one explicit host-selected occurrence and transition;
4. either `feedback-prepare` or `phase-reentry`;
5. the existing current ledger capability.

The coordinator first uses read-only slice-16 recovery and its trusted receipt
verifier. It then calls an injected normalizer. Normalization receives comments
but no claim capability and cannot execute or choose a phase. Core hashes the
exact evidence plus normalized content, normalizer identity, and immutable
normalization-output evidence identity.

The host route authorizer receives the exact source, commitments, normalizer and
output-evidence identities, normalized content, selected phase, challenge, and
nonsecret owner/fence. Its echo must be byte-semantically exact and its grant
fresh for at most five seconds. That expiry caps only the slice-16 reserve policy
grant. After durable reservation, slice 16's independent dispatch and terminal
policies govern the selected occurrence without requiring the short route grant
to remain alive for the duration of execution.

For `feedback-prepare`, normalized content becomes the slice-16 content-only
preparation input. For `phase-reentry`, the host-supplied phase is preserved.
Both receive the same fixed feedback provenance binding in their phase intent.

`recoverDevSquadAdoCommentFeedback` accepts the host-retained selected phase
input. It verifies the source binding and calls slice-16 recovery. It has no
normalizer or route-authorizer dependencies, and both source and selected-phase
reads share one bounded coordinator deadline.

## Persistence and replay

No new operation namespace is introduced. The selected phase uses existing
`dp16` reservation and terminal checkpoints. Therefore:

- one selected occurrence consumes two existing checkpoints/receipts;
- exact repeat and restart use retained slice-16 history;
- same/different occurrence races use existing exact-revision CAS;
- an uncertain reservation is never reset or retried;
- raw evidence remains in host storage, not ledger history.

Inputs without feedback preserve the exact slice-16 `dp16.intent.v1` digest.
Feedback-bearing inputs use the versioned `dp16.intent.v2` digest and include the
phase feedback binding. Changing any source/evidence/normalization commitment
changes intent and cannot reuse a retained occurrence.

## Bounds

| Item                                      |                                 Limit |
| ----------------------------------------- | ------------------------------------: |
| Evidence items                            |                                    64 |
| One evidence body                         |                           4 KiB UTF-8 |
| All evidence bodies                       |                         128 KiB UTF-8 |
| Normalized content                        |                          32 KiB UTF-8 |
| Plain-data snapshot                       |        256 KiB, 8,192 nodes, depth 16 |
| Coordinator timeout                       |          1-300,000 ms; default 30,000 |
| Route grant freshness                     |                     at most 5 seconds |
| Coordinator awaited seams before slice 16 | source recovery, normalize, authorize |

Slice-16 call, history, command, ledger, claim, lease, and execution bounds still
apply independently. Limits reject; they never truncate.

## Failure and recovery

- Source mismatch/unavailable evidence: block before normalization.
- Malformed/mutated normalizer output: block before route authorization.
- Denied/stale/mutated route grant: block before slice-16 reservation.
- Slice-16 blocked/pending/terminal result: return it without reinterpretation.
- Timeout/cancel before delegation: retire without starting a selected phase.
- Timeout/cancel after delegation: slice 16 owns the consumed reservation and
  returns its bounded result.
- Late dependency settlement cannot trigger a later coordinator step.

No error includes comment bodies, claim tokens, token digests, provider
diagnostics, prompts, logs, or session contents.

## Validation and review

Use deterministic host fakes and the portable ledger fixture. Run slice17 suites
plus affected phase/approval/ledger/watcher/adapter suites, `npm run typecheck`,
`npx tsup`, and the public declaration guard. `npm run build` may reach successful
ESM/DTS generation and then fail on Windows because the inherited postbuild uses
POSIX `rm`/`cp`; copy templates with PowerShell and run the guard separately
without weakening the script.

Perform independent specification/adversarial review and mandatory authorization-
boundary security review. Fix all high-confidence findings before the clean
commit. Do not claim the global baseline is green.
