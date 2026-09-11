# ADR-0027: DevSquad/ADO Design Approval Gate

## Status

Proposed

## Date

2026-09-11

## Context

Slice 15 requires a recoverable, design-specific human approval gate composed by the DevSquad host.

Authoritative specification:

`C:\repos\copilot-worktrees\sandcastle\agent-team-slice15-loop\docs\features\devsquad-ado-design-approval\spec.md`

Detailed contracts, proof, security controls, and implementation plan:

`C:\repos\copilot-worktrees\sandcastle\agent-team-slice15-loop\docs\features\devsquad-ado-design-approval\plan.md`

The existing schema-v1 ledger provides capability-authorized checkpoints, exact revision/state preconditions, atomic local generation publication, retained public checkpoint history, and private full-request idempotency receipts. It provides neither arbitrary checkpoint payloads nor historical branch/worktree snapshots.

The user approved Q1=A: durably reserve one publication attempt before the side effect; never automatically repeat an uncertain attempt; block until matching publication evidence is verified. Permanent publication loss, including a crash after reservation but before invocation, is explicitly accepted.

Turn-5 planning authorization permits recording supported recommendations. It does not accept this ADR, authorize implementation, or satisfy the product human gate.

Existing ADRs remain unchanged:

- `C:\repos\copilot-worktrees\sandcastle\agent-team-slice15-loop\docs\adr\0021-ado-feedback-loop-control-plane-boundary.md`
- `C:\repos\copilot-worktrees\sandcastle\agent-team-slice15-loop\docs\adr\0022-ado-agent-team-runner-boundary.md`
- `C:\repos\copilot-worktrees\sandcastle\agent-team-slice15-loop\docs\adr\0024-devsquad-sandcastle-execution-adapter-boundary.md`
- `C:\repos\copilot-worktrees\sandcastle\agent-team-slice15-loop\docs\adr\0025-devsquad-ado-workflow-ledger.md`
- `C:\repos\copilot-worktrees\sandcastle\agent-team-slice15-loop\docs\adr\0026-devsquad-ado-workflow-watcher.md`

ADR-0025 and ADR-0026 remain Proposed. No unsupported Accepted status is assigned to earlier documents.

This draft's directory does not relocate the repository's existing ADR collection.

## Priorities and requirements

Ranked in descending order:

1. **Approval integrity:** one immutable design/occurrence, matching verified publication, explicit authorized human decision, and confirmed durable resolution.
2. **No extra publication invocation under uncertainty:** concurrency, replay, restart, cancellation, and ambiguous results cannot recreate permission.
3. **Preserve existing authority and persistence boundaries:** schema v1, host lifecycle, capability/fencing, watcher cursor ownership, fixed capacities, and retained receipts.
4. **Recoverable bounded identity with privacy:** durable commitments without proposal/comment bodies, claim tokens, credentials, session contents, or hidden evidence stores.
5. **Deterministic offline verification:** exact commands, authoritative ordering, injected evidence, bounded processing, and testable fault schedules.
6. **Operational honesty:** explicitly accept publication loss, unavailable evidence, platform limitations, and lack of end-to-end host integration.

Availability does not outrank the first three priorities.

## Options considered

| Option                                                                              | P1: integrity                                         | P2: uncertain publication                          | P3: existing boundaries                      | P4: identity/privacy                                | P5: deterministic verification               | P6: operational honesty                          |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------- | -------------------------------------------- | --------------------------------------------------- | -------------------------------------------- | ------------------------------------------------ |
| Same-value checkpoints, typed commitments, fresh-only reservation permission        | Supports durable ordered stages                       | Supports Q1=A                                      | Uses existing public schema and CAS          | Fixed-width identities; external witnesses required | Fully injected and bounded                   | Exposes loss and platform/evidence gaps          |
| Nonmutating preparation, then publication, then confirmation                        | Cannot durably exclude competing attempts             | Fails prepublication crash/concurrency requirement | No new schema, but insufficient coordination | Insufficient reservation evidence                   | Cannot prove required invocation bound       | Conceals a reservation gap if called recoverable |
| Durable host-idempotent publisher with uncertain retries, Q1B                       | Could be designed separately                          | Different policy from approved Q1=A                | Requires an additional host guarantee        | Requires durable external identity behavior         | No verified live contract currently supplied | Not selected by the user                         |
| Replay/history acceptance as publication ticket                                     | Historical state can be mistaken for fresh permission | Fails Q1=A                                         | Misuses replay semantics                     | Identity does not establish freshness               | Unsafe restart/concurrency behavior          | Overstates guarantees                            |
| New payload/schema, sidecar/outbox, cursor/reference encoding, or expanded capacity | Potentially expressive                                | Requires new design                                | Outside approved scope                       | Adds storage/privacy obligations                    | Requires separate contracts                  | Must be an explicit exception, not a workaround  |
| Full arbitrary evidence or chunked payload in operation IDs                         | Unnecessary content coupling                          | Does not itself solve freshness                    | Misuses bounded identity fields              | Violates intended minimization and bounds           | Complex recovery/capacity behavior           | Hides evidence-storage requirements              |

The first option is recommended. Q1B is recorded as an explicitly unselected alternative, not reopened.

## Decision

Propose a host-invoked offline gate using only public ledger reads and phase/status-only checkpoints.

### Authority and lifecycle

- Bind canonical work item, explicitly host-authorized occurrence, immutable reviewed content, exact artifact versions, and any required target.
- Treat watcher intake as historical provenance only.
- Require independently current claim capability and exact host mutation authorization.
- Acquire, renew, transfer, and release no claims.
- Preserve the current phase/status in every gate checkpoint.
- Define no phase runner, lifecycle vocabulary, execution authority, or PR-finalization authority.

### Durable protocol

Use the exact canonical tuple definitions in the implementation plan and this operation grammar:

| Stage             | Grammar                      | Exact UTF-8 bytes |
| ----------------- | ---------------------------- | ----------------: |
| Reservation       | `dg15.r.<G>.<P>.<A>.<T>.<J>` |               226 |
| Publication       | `dg15.p.<G>.<D>.<X>.<J>`     |               182 |
| Approval          | `dg15.a.<G>.<D>.<X>.<E>.<J>` |               226 |
| Changes requested | `dg15.c.<G>.<D>.<X>.<E>.<J>` |               226 |

Every variable is canonical unpadded base64url for exactly 32 bytes. Hashes use full domain-separated SHA-256. The enclosing ledger record supplies canonical work item identity.

`J` commits nonsecret submission metadata and explicitly excludes the capability/token and token digest. It does not prove original capability equality. The existing ledger's private full-request digest remains responsible for exact deduplication, including token equality.

Before each call, retain an independent invocation-local snapshot of the complete original request and pre-write record; pass a separate copy to the dependency. Never persist that snapshot or reconstruct an original-submission retry after capability loss.

A complete gate consumes three checkpoints and three retained operation receipts. No future capacity reservation is implied.

### Publication permission

Complete-history eligibility and exact-revision CAS provide one logical reservation slot.

Only the original timely, method-specifically validated direct `replayed: false` reservation acknowledgement can create permission. Consume permission before publisher invocation.

Replay, history, readback, concurrent losers, restart, cancellation, malformed results, uncertainty, and late acknowledgement create no permission.

The publisher performs no hidden application-level retries. No automatic replacement occurrence may evade uncertainty.

The guarantee is at most one gate-mediated application invocation under the supported trust boundary, not exactly-once tracker storage.

### Publication and human evidence

- Independently verify actual publication identity/version, exact rendered content, binding, and authoritative proposal anchor.
- A bare comment ID or publisher success flag is insufficient.
- Confirm the publication checkpoint before resolving.
- Accept only entire-comment `/devsquad approve-design <G> <D>` or `/devsquad request-changes <G> <D>` using the exact plan grammar.
- Select the first eligible explicitly authorized command in a certified complete immutable event prefix.
- Order by verified authoritative ordinal, never opaque identifier spelling.
- Evaluate edits at their edit position; retain earlier deleted/edited evidence.
- Bind authorization to immutable event-time human/policy facts.
- Earlier unresolved authorization blocks later selection.
- Maintain one combined durable resolution slot across both actions.
- Approval is effective only after confirmed durable resolution.

### Recovery and target integrity

Retained commitments recover identities and recorded state, not arbitrary content. Required immutable witnesses come from existing host evidence sources. Missing, ambiguous, conflicting, or unverifiable evidence fails closed.

Bind required target identity independently. Current branch/worktree fields and activation histories are not historical snapshots. Require independent current target proof before descriptive target-specific handoff.

Historical approval is not execution permission. Revised content requires a new explicitly authorized review occurrence, not approval transfer or uncertainty bypass.

### Bounds and privacy

Adopt the plan's explicit input, history, dependency-call, and deadline ceilings.

Store no bodies, reviewer prose, capabilities, credentials, or session contents in gate evidence or diagnostics. Use stable error categories instead of dependency messages.

Timeout retires continuations but cannot cancel an already unsettled ledger write or guarantee termination of an in-process dependency. Late settlement cannot recreate publication permission.

No schema changes, sidecars, outboxes, cursor/reference patches, receipt eviction, capacity changes, or claim-lifecycle changes are permitted.

## Evidence and compatibility conclusion

The detailed plan cites the inspected source paths and line ranges establishing:

- Nonempty same-value phase/status patches are accepted.
- Full normalized ledger request digests include capability equality.
- Public checkpoint histories remain retained.
- Fresh and replay acknowledgements are distinguishable.
- Exact-revision generation publication supplies CAS.
- Maximum proposed operation ID is 226 UTF-8 bytes under the actual 256-byte limit.

The resulting static schema-v1 compatibility proof passes for bounded identity/state recovery with host-supplied witnesses.

It does not prove self-contained recovery of arbitrary evidence bodies. Such a requirement would need an explicit architecture/scope exception.

No implementation or test result is asserted.

## Consequences

| Priority              | Consequence                                                                                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Integrity             | Publication and human resolution require distinct verified durable stages; uncertainty cannot produce in-memory approval                                    |
| Single-attempt safety | A reservation may permanently lose publication, including before the publisher is invoked                                                                   |
| Existing boundaries   | No storage migration or lifecycle takeover; each complete gate nevertheless consumes three retained checkpoints/receipts                                    |
| Privacy and recovery  | Commitments minimize durable data, but unavailable immutable witnesses can permanently block verification or target handoff                                 |
| Determinism           | Exact syntax and immutable ordered events simplify conformance; a current-comments-only host adapter is insufficient                                        |
| Operational honesty   | Current production ledger Windows support is unavailable; offline fixtures are not production proof; live integration and orchestration remain later slices |

The production Windows limitation is established by:

`C:\repos\copilot-worktrees\sandcastle\agent-team-slice15-loop\src\DevSquadAdoWorkflowLedgerPlatform.ts:629–646`

Fixing it requires separately authorized predecessor/platform work, not a slice-15 workaround.

Different ledger roots, dishonest injected verifiers, or arbitrary authorized writers fall outside the cross-coordinator safety guarantee.

## Security and review requirements

Architectural assessment is APPROVED_WITH_CONTROLS, not implementation certification.

The plan's SEC-001–SEC-007 controls are required: canonical identity, fresh-only permission, independent authorities, complete ordering, exact parser, privacy/resource/liveness limits, and independent target proof.

Before claiming conformance, require all specification CC-01–CC-16 plus encoding boundaries, request-mutation guards, changed-token deduplication, CAS races, crash/replay/cancellation schedules, malformed/late acknowledgements, capacity/corruption behavior, evidence gaps, and zero prohibited side effects.

This ADR remains Proposed until reviewed under project governance. Planning authorization, implementation success, and development checkpoint approval do not themselves make it Accepted.

## Follow-up boundary

Return the planning handoff to the conductor for the separate `/devsquad.decompose` checkpoint.

Do not create work items, implement, commit, call live trackers, publish a PR, merge, accept ADRs, or start later-slice orchestration from this ADR.
