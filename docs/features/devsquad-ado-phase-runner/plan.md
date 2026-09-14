# Slice 16 implementation plan

## Alignment

- ADR-0024: existing implementation adapter owns execution; no direct execution
  logic in the phase runner.
- ADR-0025: local claim authority is not external workflow authority; immutable
  schema-v1 exact CAS, retained receipts, and limits remain unchanged.
- ADR-0026: watcher notifications are historical signals, not current authority.
- ADR-0027 remains Proposed: recovered design approval is descriptive. A separate
  trusted host verifier rehydrates immutable human/publication/material evidence
  for execution, with exact retained commitments and actual execution context.
- ADR-0028 is Proposed and records this composition, not a new lifecycle owner.

## Design

Public `runDevSquadAdoPhase` accepts a host-selected occurrence, plugin identity,
expected state, success/failure states, either content-only preparation input or
an implementation request (without embedded provider/cancellation objects), and a
current ledger capability. Trusted provider config and execute/validation seams
are separate dependencies and only the existing adapter invokes them.

Preparation has no automatic implementation authority: its handler receives
content and an abort signal, never a claim or execution configuration. Host policy
authorizes all kinds. Implementation requires the retained approved gate,
material/human verifier, and the slice-15 current-target verifier. This trust
boundary is explicit; core cannot authenticate humans or inspect remote immutable
artifacts itself.

The selected execute/validation functions and Sandcastle provider configuration
are captured before the first await. The trusted design request includes the
captured execution mode and provider names so the host can bind its evidence to the
actual capability. A malformed validation response makes the adapter fault sticky:
later adapter iterations cannot dispatch another validation command.

The runner snapshots a bounded JSON data tree without getters, custom prototypes,
cycles, unknown provider objects, or unbounded serialization. It hashes the
canonical projection excluding authority/challenge. All dependency request and
response comparisons use independent snapshots.

State protocol:

```text
unreserved -> same-state reservation -> one dispatch -> terminal receipt
                    |                      |
                    +---- unknown --------+
                              |
                   read-only pending; no retry
```

Operation IDs (B32 is 43-byte unpadded base64url SHA-256):

| Stage     | ID               | Bytes |
| --------- | ---------------- | ----- |
| reserve   | `dp16.r.G.I.J`   | 138   |
| completed | `dp16.c.G.I.R.J` | 182   |
| failed    | `dp16.f.G.I.R.J` | 182   |

`G` is host occurrence, `I` exact semantic intent, `R` minimized receipt, `J`
domain-separated event/expected-state/transition commitment. No authority or token
digest enters these identifiers. Ledger private request receipts continue binding
the actual capability. Full retained history rejects malformed/overlapping runner
reservations and duplicate terminal receipts. All unrelated record fields remain
byte-semantically identical after a checkpoint.

The operation ID is not a signature: another holder of generic workflow-ledger
mutation authority can compute it. Recovery and repeated invocation therefore use
a trusted host terminal-receipt verifier to rehydrate the exact policy, design,
execution, and validation audit trail before returning a terminal state.

One reservation and one terminal checkpoint consume existing history/receipt
capacity. No migrations, outbox, generic metadata field, or hidden sidecar. A
terminal commitment is not an artifact store; the host retains any source
artifacts/results it needs and verifies their hashes separately.

The pass has a fixed maximum time/call budget and a caller-selected smaller
deadline. Each awaited seam races cancellation, deadline, and lease expiry;
retirement aborts the shared signal. Rechecks before each validation prevent an
adapter continuation after timeout from initiating another effect. Checkpoints
cannot prove remote effect cancellation or exactly-once delivery.

## Validation and review

Use Vitest with deterministic host fakes and the actual portable ledger fixture,
tsgo, tsup, and the public Effect-free type guard. Existing dependency restoration
was permitted only after `npm test -- src/DevSquadSandcastleExecutionAdapter.test.ts`
failed because vitest was missing; `npm ci --ignore-scripts --no-audit --no-fund`
then succeeded. New test scratch is repository-local.

Independent spec conformance, adversarial review, and security review precede the
commit. Record actual commands/findings in tasks. Do not claim global baseline
green or Windows production ledger support.
