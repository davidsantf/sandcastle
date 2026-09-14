# Slice 15: DevSquad/ADO Design Approval — Implementation Plan

## Status and approval provenance

- ADR-0027 path mechanically normalized to docs/adr/ per CLAUDE.md and docs/agents/domain.md under Turn-6 approval; no architectural decision changed.

- Date: 2026-09-11.
- Status: Planning complete; implementation not started.
- Specification: the existing saved specification is authoritative and unchanged.
- Tracking: local board only; no external work-item IDs.
- Worktree: `C:\repos\copilot-worktrees\sandcastle\agent-team-slice15-loop`.
- Branch: `users/davidsant/agent-team-slice15-loop`.
- Inspected HEAD: `e7e46dc76597d2e16782c779e8a8eaa4dd5accca`.
- Predecessor slice 14 is complete according to the approved planning context. Do not redo it.
- Turn-5 conductor input explicitly authorized this planning phase, persistence of recommended planning artifacts, and automatic recording of supported recommendations.
- Q1=A was separately approved: durably reserve one publication attempt, never repeat an uncertain attempt, and accept permanent publication loss.
- Development approvals do not satisfy the product human gate.
- ADR-0027 is Proposed. ADR-0025 and ADR-0026 remain Proposed. No predecessor ADR is amended or assigned an unsupported acceptance status.
- This document consolidates research, data model, normalized offline contracts, conformance mapping, and security controls. It does not create implementation code or claim an operational end-to-end workflow.

## Authoritative sources and citation key

All citations below resolve through this table. Line ranges describe the inspected HEAD or saved specification.

| Key        | Absolute path                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| S          | `C:\repos\copilot-worktrees\sandcastle\agent-team-slice15-loop\docs\features\devsquad-ado-design-approval\spec.md`              |
| L          | `C:\repos\copilot-worktrees\sandcastle\agent-team-slice15-loop\docs\features\devsquad-ado-workflow-ledger\spec.md`              |
| W          | `C:\repos\copilot-worktrees\sandcastle\agent-team-slice15-loop\docs\features\devsquad-ado-workflow-watcher\spec.md`             |
| API        | `C:\repos\copilot-worktrees\sandcastle\agent-team-slice15-loop\src\DevSquadAdoWorkflowLedger.ts`                                |
| Schema     | `C:\repos\copilot-worktrees\sandcastle\agent-team-slice15-loop\src\DevSquadAdoWorkflowLedgerSchema.ts`                          |
| Storage    | `C:\repos\copilot-worktrees\sandcastle\agent-team-slice15-loop\src\DevSquadAdoWorkflowLedgerStorage.ts`                         |
| Platform   | `C:\repos\copilot-worktrees\sandcastle\agent-team-slice15-loop\src\DevSquadAdoWorkflowLedgerPlatform.ts`                        |
| WatchGuard | `C:\repos\copilot-worktrees\sandcastle\agent-team-slice15-loop\src\DevSquadAdoWorkflowWatcherLedger.ts`                         |
| CP         | `C:\repos\copilot-worktrees\sandcastle\agent-team-slice15-loop\src\AdoControlPlaneFactory.ts`                                   |
| A21        | `C:\repos\copilot-worktrees\sandcastle\agent-team-slice15-loop\docs\adr\0021-ado-feedback-loop-control-plane-boundary.md`       |
| A22        | `C:\repos\copilot-worktrees\sandcastle\agent-team-slice15-loop\docs\adr\0022-ado-agent-team-runner-boundary.md`                 |
| A24        | `C:\repos\copilot-worktrees\sandcastle\agent-team-slice15-loop\docs\adr\0024-devsquad-sandcastle-execution-adapter-boundary.md` |
| A25        | `C:\repos\copilot-worktrees\sandcastle\agent-team-slice15-loop\docs\adr\0025-devsquad-ado-workflow-ledger.md`                   |
| A26        | `C:\repos\copilot-worktrees\sandcastle\agent-team-slice15-loop\docs\adr\0026-devsquad-ado-workflow-watcher.md`                  |
| A27        | `C:\repos\copilot-worktrees\sandcastle\agent-team-slice15-loop\docs\adr\0027-devsquad-ado-design-approval-gate.md`              |

The authoritative specification was read fully. The old halted drafts are historical context only; their claimed-intake handoff, five-command protocol, nonmutating publication assumptions, and unproved encoding are not adopted.

## System architecture and scope

Implement an offline, host-composed design-gate primitive over the existing public ledger.

The gate binds:

1. Canonical work item.
2. Explicitly host-authorized occurrence.
3. Immutable reviewed proposal and exact referenced artifact versions.
4. An independently verified execution-target commitment when a target is required.
5. Verified publication evidence.
6. One explicit, authorized human resolution.

The gate does not acquire, renew, release, or transfer claims. Watcher intake is historical notification/provenance, not current capability or an exact current revision. The host supplies current authority and authorizes each new mutation against freshly validated state.

The gate defines no phase/status vocabulary, transition sequence, phase runner, execution authority, or finalization authority. Each gate checkpoint preserves the host's current phase and status.

The following boundaries remain unchanged:

| Dependency | Boundary followed                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| A21        | Injected offline control-plane seams; no direct tracker transport or PR-finalization authority                                        |
| A22        | No agent, shell, test, git, or sandbox execution by the gate                                                                          |
| A24        | Host owns orchestration, lifecycle, selected-task delegation, and execution authority                                                 |
| A25        | Existing schema-v1 public API, fenced capabilities, exact preconditions, atomic local durability, retained receipts, fixed capacities |
| A26        | Watcher observation ownership, claim cleanup, claim-free discovery, and original-submission guards                                    |

A27 records the architecture-significant gate protocol decisions. No conflicting predecessor amendment is required for this bounded design.

## Compatibility proof against actual schema v1

### Finding 1: same-value phase/status checkpoints are supported

The public checkpoint patch accepts phase and status [API:299–344]. A patch must be nonempty, but validation does not require values to change [Schema:615–644].

Storage checks exact revision and expected workflow state [Storage:1380–1406], constructs the resulting workflow/checkpoint without rejecting equal phase/status [Storage:1423–1434], and appends checkpoint and receipt [Storage:1481–1501].

Every gate checkpoint therefore uses exactly:

- `patch.phase = expected.phase`
- `patch.status = expected.status`

Both values come from the freshly validated record and exact host authorization.

This is a workflow-state no-op, not a storage no-op: it advances revision and consumes a checkpoint and receipt. No cursor or execution-reference patch is used.

### Finding 2: actual request deduplication includes capability equality

The ledger hashes the full normalized request with operation kind and request schema version [Schema:1047–1072]. Normalized authority includes owner, token, and fence [Schema:385–426].

Receipt lookup occurs before current authorization/precondition checks [Storage:1363–1404]. Reusing an operation ID with a different kind or normalized request digest yields `idempotency-conflict` [Storage:637–654].

Consequences:

- A replay is not fresh mutation authority.
- Changed token, owner, fence, expected revision, state, or patch is not exact replay.
- Public checkpoint history does not expose the private request digest.
- Gate history and a matching operation ID cannot prove a new caller supplied the original capability.

The gate's `J` commitment excludes the token. This deliberately supersedes the preliminary token-derived architecture proposal. The existing ledger's private full-request digest remains unchanged.

### Finding 3: public checkpoints provide retained identity history

Accepted operations retain prior checkpoint and operation histories [Storage:1498–1500]. Generation cleanup is not receipt/checkpoint eviction [Storage:777–801].

Public projection exposes checkpoint history, not private receipts [Schema:1334–1388]. Persisted validation checks operation uniqueness, revision sequencing, and checkpoint/receipt correspondence [Schema:1250–1288].

The gate reads only public records/checkpoints. It does not inspect private operation receipts, ledger files, or storage internals.

### Finding 4: fresh acceptance is distinguishable from replay

The mutation result exposes accepted revision/time, replay status, outcome, and record [API:149–161].

- Replay returns historical acceptance with `replayed: true` [Storage:656–681].
- Direct checkpoint success returns `replayed: false` and its accepted record [Storage:1527–1534].

Only the original timely, directly returned, fully validated fresh reservation acknowledgement can create invocation-local publication permission.

A direct response describes its accepted generation; it does not promise that no coordinator advanced the ledger before response delivery. Every subsequent mutation requires a new read.

### Finding 5: exact revision CAS excludes competing logical stages

Exclusive hard-link publication admits one next generation; `EEXIST` indicates a competing winner [Platform:489–516]. Commit acknowledgement includes durability checks [Platform:519–576].

A checkpoint publication race rereads and returns replay or revision conflict rather than rebasing the request [Storage:1502–1525].

For reservation, both coordinators must inspect the complete history at the same revision used in `expected`. Only one can append the next checkpoint:

- Identical losing submission: replay, zero publication permission.
- Different losing submission: conflict, zero publication permission.
- Later request: retained reservation makes a new reservation ineligible.

Resolution applies one combined slot across approval and changes requested. Different action IDs cannot create independent resolution slots.

Operation-ID deduplication alone is insufficient; safety requires complete-history eligibility plus exact-revision CAS.

### Finding 6: exact field and byte budget fits

A `B32` field is exactly 32 bytes encoded as canonical unpadded base64url: 43 ASCII characters and 43 UTF-8 bytes.

| Event                 | Operation ID grammar         | Calculation  | Bytes |
| --------------------- | ---------------------------- | ------------ | ----: |
| Reservation           | `dg15.r.<G>.<P>.<A>.<T>.<J>` | 7 + 5×43 + 4 |   226 |
| Publication confirmed | `dg15.p.<G>.<D>.<X>.<J>`     | 7 + 4×43 + 3 |   182 |
| Approval              | `dg15.a.<G>.<D>.<X>.<E>.<J>` | 7 + 5×43 + 4 |   226 |
| Changes requested     | `dg15.c.<G>.<D>.<X>.<E>.<J>` | 7 + 5×43 + 4 |   226 |

The real operation-ID limit is 256 UTF-8 bytes, not characters [Schema:31, 68–80, 104–112, 587–591]. The maximum proposed ID leaves 30 bytes of headroom.

The enclosing ledger record supplies canonical work item identity. The reservation directly retains occurrence, proposal, artifact-manifest, and target commitments. Design identity is derivable. Publication and resolution retain their evidence commitments.

A complete gate uses three checkpoints and three retained operation receipts, excluding host claim operations and other workflow activity.

### Proof boundary

This is a static contract and composition proof, not an executed test result.

Recoverable identity does not mean recoverable content. Hashes cannot reconstruct bodies, manifests, tracker evidence, or worktree descriptors. Existing host evidence sources must supply required immutable witnesses. Missing witnesses block the affected action.

Self-contained reconstruction of arbitrary evidence from schema-v1 checkpoints would not fit this design and would require an explicit scope exception. No sidecar, outbox, chunked payload scheme, schema change, eviction, capacity increase, or cursor repurposing is authorized.

Existing ceilings remain: 20,000 operation receipts, 10,000 checkpoints, and 16 MiB generation size [Schema:17–29]. Capacity is not reserved for future gate stages. A later failure can permanently block a consumed occurrence.

Corrupt highest committed state must fail closed, not fall back to an older apparent success [Storage:559–603].

## Data model and canonical identities

### Canonical representation

`H(tuple)` is full SHA-256 of UTF-8 canonical JSON for a fixed-position array, encoded as `B32`.

Canonical tuples use:

- Literal ASCII domain/version labels.
- Fixed positions and explicit `null`; no omitted members or objects.
- Compact ECMAScript JSON string escaping.
- Valid Unicode scalar strings; reject unpaired surrogates.
- Safe integers in decimal; normalize numeric negative zero to zero.
- Preserved opaque string spelling and ordered evidence.
- No trimming, case folding, line-ending changes, or silent Unicode normalization.

Every `B32` must decode and re-encode identically. Regex/length validation alone is insufficient. No padding, whitespace, extensions, or alternate encoding is accepted.

Canonical work item `W` follows the public ledger contract:

- Nonnegative safe integer becomes its decimal string.
- String identity is preserved and must satisfy the ledger's NFC, length, nonblank, and prohibited-character rules.
- Numeric `137` and string `"137"` coincide; string `"0137"` does not.
- Maximum work-item identifier length is 120 UTF-8 bytes.

All coordinators use the same explicit repository root. The host must not map different tracker-scoped work items with the same `W` into the same ledger namespace.

`scope` is the fixed nonsecret tuple `[trackerKind, tenantId, projectId]`.

### Identity definitions

| Field          | Exact definition                                                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `G`            | Host-supplied, explicitly authorized 32-byte occurrence identifier, encoded as `B32`                                                                                                              |
| `P`            | `H(["dg15.proposal.v1", W, exactReviewedContent])`                                                                                                                                                |
| Artifact entry | `[scope, artifactId, immutableVersionId, contentSha256]`                                                                                                                                          |
| `A`            | `H(["dg15.manifest.v1", W, orderedArtifactEntries])`                                                                                                                                              |
| `D`            | `H(["dg15.design.v1", W, P, A])`                                                                                                                                                                  |
| No-target `T`  | `H(["dg15.target.v1", W, ["none"]])`                                                                                                                                                              |
| Bound `T`      | `H(["dg15.target.v1", W, ["bound", repositoryScope, repositoryId, immutableSourceVersion, sourceContentSha256, branch, absoluteWorktreePath, worktreeIdentity, agentIdOrNull, sessionIdOrNull]])` |
| `B`            | `H(["dg15.envelope.v1", W, G, D, T, exactRenderedPublication])`                                                                                                                                   |
| `X`            | `H(["dg15.publication.v1", W, G, D, T, B, publicationWitnessTuple])`                                                                                                                              |
| `E`            | `H(["dg15.decision.v1", W, G, D, T, X, action, selectedEventTuple, selectedGrantTuple, selectionPrefixCommitment])`                                                                               |
| `J`            | `H(["dg15.submission.v1", eventIdentityTuple, W, expectedRevision, expectedPhase, expectedStatus, patchPhase, patchStatus, ownerId, fencingValue])`                                               |

`repositoryScope` uses the same fixed three-member scope structure for the repository's host namespace.

`eventIdentityTuple` is exactly one of:

- `["r", G, P, A, T]`
- `["p", G, D, X]`
- `["a", G, D, X, E]`
- `["c", G, D, X, E]`

`J` excludes the claim token, token digest, capability handle, arbitrary request extensions, and final operation ID. It is a nonsecret submission-metadata commitment, not a capability verifier.

Artifact entries are sorted by bytewise lexicographic order of canonical JSON for `[scope, artifactId]`. Duplicate scoped artifact identities are rejected. Every version/content binding requires independent verification. Empty manifest is valid only when no external design artifact is referenced.

Mutable paths, branches, or “latest” cannot substitute for immutable artifact versions. No target descriptor means explicit no-target binding, not permission to infer a target later.

### Retention

| Data                                                                           | Retention                                                                 |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `G,P,A,T,D,X,E,J` and accepted checkpoint metadata                             | Durable typed checkpoint identities                                       |
| Exact proposal, manifest, target descriptor, publication/event witnesses       | Bounded in-process only; retrieved from existing host sources when needed |
| Original request, including capability                                         | Private invocation-local snapshot only                                    |
| Proposal/comment bodies, reviewer prose, tokens, credentials, session contents | Never copied into gate durable state, diagnostics, or errors              |

Hashes provide commitments, not secrecy, authentication, or reversible evidence storage. Host-approved publication metadata must itself be nonsecret. Canonicalization is not secret detection.

## Public offline contracts

These are normalized injected library contracts, not live ADO/MCP or identity-provider schemas. No REST API is proposed.

### Entry points

| Operation   | Purpose                                                                                   | Maximum effects                              |
| ----------- | ----------------------------------------------------------------------------------------- | -------------------------------------------- |
| `start`     | Start an explicitly authorized occurrence; reserve and advance when evidence is available | Three checkpoints; one publisher invocation  |
| `reconcile` | Advance missing stages for an existing durable reservation                                | Two checkpoints; zero publisher invocations  |
| `recover`   | Read durable state and validate supplied/retrievable witnesses                            | Zero checkpoints; zero publisher invocations |

There is no publish-retry, bypass, replacement-occurrence, generic command-dispatch, or cross-restart original-submission retry API.

Optional watcher provenance is not authority and must not require retaining an entire intake.

### Injected dependencies

| Seam                       | Request and required response                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Existing ledger read       | Canonical `W`; existing validated public record result                                                                   |
| Existing ledger checkpoint | Separate copy of captured original request; existing method-specific mutation result                                     |
| `authorizeMutation`        | Exact event, binding, fresh revision/state, no-op patch; explicit bound grant, denial, or unavailable                    |
| `verifyDesign`             | Exact content, manifest, target descriptor; independently verified immutable artifacts and required initial target proof |
| `publishOnce`              | Exact rendering and `W,G,D,T,B`; bounded untrusted locator hint or unavailable; no application-level retries             |
| `verifyPublication`        | Expected binding/rendering and optional hint; independently verified witness, mismatch, ambiguous, or unavailable        |
| `readDecisionPage`         | Verified proposal anchor, fixed snapshot/cursor, page limit; complete authoritative immutable event page                 |
| `authorizeHumanDecision`   | Exact event/action/binding and verified actor; event-specific human grant, denial, or unresolved                         |
| `verifyCurrentTarget`      | Original witness, `T`, request challenge; independently observed current target, mismatch, or unavailable                |
| Time/cancellation          | Monotonic deadline clock plus UTC authority-time source; cooperative cancellation and late-result retirement             |

Claim capability is separately supplied by the host. Mutation authorization and owner/fence metadata do not replace ledger capability enforcement.

Success/denial variants must have known discriminators and fixed fields. Wrong bindings, missing fields, malformed values, thrown/rejected dependencies, and unknown variants become stable feature categories. Dependency messages, stacks, diagnostic objects, and arbitrary locators are not propagated.

The configured host verifiers are trusted integration components. Structural validation of a caller's `verified: true` cannot establish provenance. A compromised adapter or authorized arbitrary ledger writer is outside the supported trust boundary.

### Deterministic publication

Render the following in order, separated by LF:

1. `DevSquad immutable design review`
2. `Work item: ` plus canonical JSON for `[scope,W]`
3. `Occurrence: <G>`
4. `Design: <D>`
5. `Proposal: <P>`
6. `Manifest: <A>`
7. `Target: <T>`
8. `Artifacts: ` plus canonical JSON of the ordered manifest
9. `Execution target: ` plus canonical JSON of the target descriptor
10. `Approval applies only to this occurrence and immutable design; it does not execute a phase or approve revised content.`
11. `Submit exactly one of these commands as the entire comment:`
12. `/devsquad approve-design <G> <D>`
13. `/devsquad request-changes <G> <D>`
14. `Reviewed proposal UTF-8 bytes: <decimal byte count>`
15. Empty line.
16. Exact reviewed content.
17. Append one final LF.

Angle-bracket operands above denote substitution of the defined values, not literal placeholders in the published proposal.

Hash the reviewed content before rendering the envelope; the proposal therefore does not contain its own hash preimage recursively.

Publication verification requires exact expected bytes. Tracker transformations, normalization, or truncation are not silently accepted.

### Publication witness

The normalized tuple is:

`[verifierId, scope, W, G, D, T, B, proposalObjectId, proposalVersionId, authoritativeStreamId, proposalEventId, proposalOrdinal, proposalEventVersionId, immutableEvidenceId]`

The verifier establishes:

- Scoped actual proposal object and immutable version.
- Independently retrieved exact content matching the rendering.
- Work item, occurrence, design, and target binding.
- Authoritative proposal anchor.
- Attribution to the reserved original publication, not an unrelated matching-looking object.

Multiple indistinguishable publications produce `publication-ambiguous`. A bare comment ID, publisher echo, or success boolean is insufficient. The existing control-plane comment result supplies none of these guarantees by itself [CP:28–49].

The witness becomes usable for resolution only after its matching publication checkpoint is durably confirmed.

## Human decision protocol

### Exact command syntax

Only these entire-comment byte sequences are recognized:

- `/devsquad approve-design <G> <D>`
- `/devsquad request-changes <G> <D>`

Rules:

- Valid UTF-8.
- Literal lowercase command words.
- Exactly one ASCII space between tokens.
- Canonical 43-byte `G` and `D`.
- No leading/trailing whitespace or newline, tabs, CRLF, prose, quotes, fences, extra arguments, aliases, or multiple commands.
- No trimming, substring search, or model interpretation.
- Exact lengths are 112 and 113 bytes respectively.
- Verified tracker context supplies work item and proposal relationship; operands alone do not.

Development checkpoint approval, automated review, `lgtm`, `/devsquad cancel`, or a command for another occurrence/design cannot resolve the product gate.

### Immutable event-time ordering

Use an append-only immutable event-version model:

- Creation/edit events retain exact body and actual actor for that version.
- A command introduced by an edit is evaluated at the edit's authoritative position.
- Deletion is a later event, not erasure of earlier evidence.
- Later edits/deletions do not revoke an earlier valid decision or overwrite a durable resolution.
- Missing earlier versions/actors/bodies block selection.

This recommendation makes selection stable across concurrent reducers. A current-comments-only adapter cannot satisfy it.

The normalized event tuple is:

`[streamId, ordinal, eventId, eventVersionId, kind, commentId, commentVersionId, previousCommentVersionIdOrNull, actorScope, actorId, eventTime, relation, bodyOrNull, immutableEvidenceId]`

Definitions:

- `kind`: `create`, `edit`, or `delete`.
- `ordinal`: positive safe integer supplied by the authoritative verifier.
- `eventTime`: canonical UTC-millisecond timestamp; never used for sorting.
- `relation`: `[scope,W,proposalObjectId,proposalVersionId,G,D,"answers"]` or `"unrelated"`.
- Create/edit body is required even if later deleted.
- Delete body is `null` and is not a command.
- Verifier establishes event actor, immutable version chain, and proposal relationship.
- Opaque identifiers are equality-only; verified ordinals supply chronology.

### Complete-prefix pagination

Each normalized page contains:

`[verifierId, scope, W, streamId, proposalAnchor, snapshotId, snapshotEndOrdinal, requestedCursorOrNull, coveredFromOrdinal, coveredThroughOrdinal, events, nextCursorOrNull, completeThroughSnapshotEnd, immutableEvidenceId]`

`proposalAnchor` is `[streamId, proposalEventId, proposalOrdinal, proposalEventVersionId]`.

Requirements:

1. First coverage begins immediately after the verified proposal anchor.
2. The host-normalized stream has contiguous ordinals for its declared scope.
3. Pages share scope, anchor, stream, snapshot, and end ordinal.
4. Continuations have no gaps, overlap, duplicate events, repeated cursors, or silent deduplication.
5. Coverage includes all events, not only commands or currently visible comments.
6. The verifier certifies that no event can later be inserted into a certified prefix.
7. An empty terminal page must certify the genuinely empty remainder.
8. Malformed, cyclic, incomplete, or inconsistent pages block.
9. Budget exhaustion never converts a partial prefix into completeness.

A complete prefix through the first winning command is sufficient. Reporting no eligible decision requires completeness through snapshot end.

### Human authorization

The normalized authorization tuple is:

`[authorizationVerifierId, scope, W, G, D, T, X, streamId, ordinal, eventId, commentId, commentVersionId, actorScope, actorId, action, verdict, humanIdentityId, policyId, immutablePolicyVersionId, immutableEvidenceId]`

- `action`: `approve-design` or `request-changes`.
- `verdict`: explicit `granted` or `denied`.
- Grant establishes a human and permission for that exact event/action/binding.
- Evaluation uses immutable event-time facts/policy, not a mutable role snapshot that could change the winner between reducers.
- Missing, malformed, thrown, rejected, or unresolved authorization is not denial.
- An earlier unresolved eligible candidate blocks a later candidate.
- Explicitly denied candidates may be skipped.
- Invalid/nonmatching comments need no authorization call.

Define prefix commitment:

- `C0 = H(["dg15.prefix-start.v1", W, G, D, T, X, proposalAnchor])`
- `Ci = H(["dg15.prefix-step.v1", Cprevious, eventTuple, classification, authorizationTupleOrNull])`

Classification is `not-command`, `wrong-binding`, `unrelated`, `deleted`, `denied`, or `selected`. Unresolved authorization is not skippable.

`selectionPrefixCommitment` is `Ci` at the first granted valid command. Page transport metadata does not change semantic selection identity.

## Durable reducer and mutation protocol

### History reducer

Validate complete bounded public history and reduce all gate entries:

1. Structurally valid records and strictly increasing checkpoint revisions.
2. At most one reservation for `W,G`.
3. Publication follows a matching reservation.
4. Resolution follows a matching publication.
5. At most one resolution across both actions.
6. All recoverable identities agree; derive `D` from `W,P,A`.
7. Every gate checkpoint preserves previous phase/status.
8. Malformed, unsupported, duplicate, conflicting, or out-of-order gate evidence blocks.
9. Unrelated non-gate history remains unrelated.
10. Historical `J` proves neither original capability nor new-submission equivalence.

Reserve the `dg15` namespace. Entries claiming that namespace but failing its exact version/event grammar are not ignored.

Watcher cursor changes and claim renewal do not alone change design identity.

### New-stage procedure

For each new mutation:

1. Fresh read and complete validation.
2. History eligibility at the exact revision to be submitted.
3. Independent current capability and expected host state.
4. Host authorization bound to the exact event and no-op patch.
5. Private independent snapshots of pre-write record and complete original request.
6. Compute nonsecret `J`; pass a separate request copy to the ledger.
7. Validate acknowledgement against the originals.

This slice performs zero automatic checkpoint retries. Changed preconditions/capabilities or new operation IDs must not disguise a retry.

Cross-restart exact-submission retry is unsupported because the original capability is intentionally not persisted. Recovery of durable state and a newly authorized missing-stage reconciliation are different operations.

### Fresh acknowledgement guard

Require:

- Exact checkpoint-success discriminator/outcome.
- `replayed === false`.
- Accepted revision equals original expected revision plus one.
- Returned record revision equals accepted revision.
- Canonical work item, exact operation ID, recomputed nonsecret `J`.
- Exact previous/resulting state.
- Checkpoint timestamp, accepted timestamp, and record update timestamp agreement.
- Exactly one corresponding checkpoint; outcome/history equality.
- Complete gate-history consistency.
- Prior histories and unpatched claim/cursor/execution fields unchanged.
- Owner/fence consistency.
- Inclusive authority expiry respected: `now >= expiresAt` is expired.
- Deadline/cancellation path still active.

Actual capability validation remains the ledger's responsibility [Storage:815–842]. Owner/fence metadata is insufficient.

Existing watcher guards are useful precedent but cannot be reused unchanged because their checkpoint projection expects observation patches [WatchGuard:538–578, 598–625].

### Publication permission and crash behavior

Only the original validated fresh reservation response creates invocation-local permission. Consume it before entering `publishOnce`; never return a reusable ticket.

| Situation                                                                       | Publisher permission                                        |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Timely validated direct fresh reservation                                       | At most one invocation                                      |
| Reservation replay                                                              | None                                                        |
| Concurrent loser                                                                | None                                                        |
| Malformed, rejected, thrown, lost, or indeterminate reservation acknowledgement | None                                                        |
| Readback/history confirms reservation                                           | None                                                        |
| Restart/recovery/reconciliation                                                 | None                                                        |
| Crash after reservation before invocation                                       | Permanently consumed; no retry                              |
| Publisher fails or response is lost                                             | Consumed; receipt reconciliation only                       |
| Cancellation/expiry before invocation                                           | Consumed; no invocation                                     |
| Late reservation acknowledgement after timeout                                  | None                                                        |
| Late publisher completion                                                       | No retry; later explicit receipt verification may reconcile |

The publisher has no hidden application-level retries. No automatic replacement occurrence can evade uncertainty.

Ledger fencing does not atomically fence an external tracker write. The guarantee is at most one gate-mediated application invocation under the supported trust model, not exactly-once tracker storage or protection from independent host duplicate posts.

Publication/resolution writes can remain uncertain. In-memory candidates never become approval. A later validated read may recover durable state but never publication permission.

## Execution-target integrity

Target commitment is independent of design approval.

When a target is required:

1. Independently verify the initial descriptor before reservation.
2. Later recover/supply the original descriptor and recompute `T`.
3. Independently observe current repository, immutable source content, branch, worktree identity/path, and any bound agent/session identity.
4. Require exact descriptor agreement.
5. Bind proof to this request and a host-issued nonsecret challenge.
6. Require proof age at most five seconds at return.

Return descriptive verification metadata only, not an executable resume instruction. The host must revalidate at any later execution boundary; this is not a lock.

Current ledger branch/worktree and activation histories are not historical target snapshots [API:77–89, 113–147]. Missing original/current proof blocks target-specific handoff without rewriting historical design approval.

Explicit no-target binding returns `not-bound`; current fields cannot supply a missing historical target.

## Bounds and dependency liveness

### Fixed feature ceilings

| Resource                                                                               |                         Maximum |
| -------------------------------------------------------------------------------------- | ------------------------------: |
| Occurrences per invocation                                                             |                               1 |
| Reviewed proposal                                                                      |                    32 KiB UTF-8 |
| Artifact manifest                                                                      |            16 KiB; 64 artifacts |
| Target descriptor                                                                      |                           8 KiB |
| Rendered publication                                                                   |                          64 KiB |
| Scalar evidence identifier                                                             |                 256 UTF-8 bytes |
| Private pagination cursor                                                              |                           1 KiB |
| Decision pages                                                                         |                               8 |
| Events per page                                                                        |                              16 |
| Total events, including unrelated/edit/delete events                                   |                             128 |
| Individual event body                                                                  |                           4 KiB |
| Aggregate normalized decision stream                                                   |                         256 KiB |
| Individual normalized publication or minimized selection/authorization witness package |                          16 KiB |
| Retained non-ledger logical payload                                                    |                           1 MiB |
| One projected public ledger record                                                     |                          16 MiB |
| Checkpoints inspected per record                                                       |                          10,000 |
| Agent history inspected per record                                                     |                          10,000 |
| Session history inspected per record                                                   |                          10,000 |
| Public records validated per invocation                                                |                               7 |
| Aggregate ledger serialized bytes inspected                                            |                         112 MiB |
| Aggregate ledger history-entry visits                                                  |                         210,000 |
| Simultaneous full public records                                                       | 2, at most 32 MiB logical bytes |
| Automatic dependency retries                                                           |                               0 |

The selection package contains the selected event/grant and prefix commitment, not a second copy of the entire prefix.

Validate counts before proportional traversal/copying. Count serialized bytes incrementally; do not serialize an unbounded object just to measure it. Combine validation/reduction passes or charge each pass to the aggregate visit limit.

These are logical payload/processing ceilings, not JavaScript heap guarantees. In-process dependencies can allocate before returning, expose getters/proxies, or block the event loop; the library cannot hard-isolate them.

### Call ceilings

Maximum per `start`:

| Dependency                         | Calls |
| ---------------------------------- | ----: |
| Ledger reads                       |     4 |
| Ledger checkpoints                 |     3 |
| Host mutation authorization        |     3 |
| Design/initial target verification |     1 |
| Publisher                          |     1 |
| Publication verification           |     1 |
| Decision pages                     |     8 |
| Human authorization                |   128 |
| Current target verification        |     1 |
| Total                              |   150 |

Reads allow one per prospective stage plus one recovery read. Other entry points use subsets. Failures consume budget. No recovery loop runs until success.

### Deadlines

| Operation                                      |      Deadline |
| ---------------------------------------------- | ------------: |
| Whole invocation                               |    180,000 ms |
| Ledger read/checkpoint                         |      5,000 ms |
| Host mutation authorization                    |      1,000 ms |
| Design/publication/current-target verification | 5,000 ms each |
| Publisher                                      |     10,000 ms |
| Decision page                                  |      5,000 ms |
| Human authorization                            |      1,000 ms |

Use the lesser of per-call deadline and remaining invocation time. Mutations and decision selection are sequential; do not speculate on later candidates.

Timeout retires the affected continuation and requests cooperative cancellation when supported. Ledger APIs do not provide cancellation; a timeout cannot prove no mutation occurred. Late settlement cannot revive publication permission, resolve silently, or launch detached work.

No hard-stop or unconditional completion-time guarantee is made for noncooperating dependencies.

## Result contract and failure behavior

Return orthogonal fields:

- `durableState`
- `verificationStatus`
- `targetHandoff`
- Stable `reason`
- Minimized binding and known checkpoint revisions

Durable states:

| State                     | Meaning                                                          |
| ------------------------- | ---------------------------------------------------------------- |
| `unreserved`              | Valid read found no reservation                                  |
| `reservation-unconfirmed` | Reservation outcome remains uncertain                            |
| `attempt-consumed`        | Reservation confirmed; invocation/publication cannot be inferred |
| `publication-confirmed`   | Matching publication checkpoint confirmed, no resolution         |
| `approved`                | Approval checkpoint confirmed durable                            |
| `changes-requested`       | Change-request checkpoint confirmed durable                      |
| `unreadable`              | Ledger state cannot be safely established                        |

Verification status is one of `verified`, `publication-unverified`, `decision-pending`, `evidence-unavailable`, `conflicting-evidence`, or `mutation-unconfirmed`.

Target handoff is `not-requested`, `not-bound`, `verified-current`, or `blocked`.

Stable reasons include:

`authority-required`, `authority-expired`, `authority-rejected`, `host-authorization-unavailable`, `revision-conflict`, `state-conflict`, `idempotency-conflict`, `reservation-outcome-unknown`, `publication-outcome-unknown`, `publication-mismatch`, `publication-ambiguous`, `publication-evidence-unavailable`, `decision-prefix-incomplete`, `decision-authorization-unresolved`, `no-eligible-decision`, `design-mismatch`, `target-proof-unavailable`, `target-mismatch`, `original-submission-unavailable`, `unsupported-platform`, `unsupported-schema`, `corrupt-ledger`, `conflicting-gate-history`, `capacity-exceeded`, `input-limit`, `dependency-limit`, `dependency-timeout`, and `cancelled`.

A recovered durable approval can be reported separately from unavailable external witnesses or blocked target handoff. It must not be reinterpreted as approval of supplied revised content, present-day reauthorization, or execution authority.

## Architectural security assessment

Verdict: APPROVED_WITH_CONTROLS at specification/architecture level.

No implementation vulnerability audit, runtime validation, live transport assessment, or production integration proof was performed.

| Control                               | Required design/implementation evidence                                                                                                                        |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-001: identity integrity           | Exact domain-separated tuples, immutable witnesses, canonical encoding, exact byte-budget tests, missing/conflicting evidence fails closed                     |
| SEC-002: replay/freshness             | Independent original snapshots, separate dependency copy, method-specific fresh guard, consumed invocation-local permission, no late/replay/restart permission |
| SEC-003: separate authority           | Independent publication verification, event-specific human grant, host mutation grant, ledger capability enforcement; none substitutes for another             |
| SEC-004: authoritative first decision | Complete immutable prefix, stable edits/deletions, no opaque-ID ordering, earlier unresolved authorization blocks                                              |
| SEC-005: untrusted command handling   | Exact whole-comment two-command grammar; no model interpretation, aliases, prose execution, or development-approval bypass                                     |
| SEC-006: privacy and liveness         | Nonsecret `J`, no token/body/error persistence, fixed projections, finite budgets/deadlines, no hidden retries or hard-stop claims                             |
| SEC-007: target integrity             | Original target commitment plus independent current proof; no current-fields-as-history or approval-to-execution inference                                     |

The preliminary architecture suggestion to hash the capability into `J` is rejected. Same-ID changed-token submissions remain distinguishable through the existing ledger's private digest. Historical `J` is never treated as capability evidence.

Unresolved controls block claiming implementation conformance. Dishonest trusted adapters, hostile authorized writers, and unsupported filesystem guarantees remain outside the supported boundary.

## Engineering practices

| Practice              | Decision                                                                                                     | Reference                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| Task implementation   | Future per-task TDD; smallest independently verifiable increments                                            | User's established implementation policy |
| Commits               | Future Conventional Commits with Copilot App coauthor; no commits during planning                            | User's established policy                |
| Release documentation | Inspect existing changesets; new user-facing feature requires appropriate changeset and README consideration | Root CLAUDE.md convention                |
| Validation            | Smallest selectors, typecheck, fresh ESM/DTS output, public Effect-free guard, changed-file formatting       | Existing project/user validation context |
| CI changes            | Do not repair or redesign unrelated workflows in this slice                                                  | Scope boundary                           |
| Observability         | Stable token/body-free result categories and uncertainty/capacity runbook; no new telemetry infrastructure   | A27 and this plan                        |
| IaC                   | No new deployment or cloud service proposed                                                                  | Offline library scope                    |

No new branch-protection, deployment, or infrastructure policy is inferred. Existing CI conventions do not establish unverified enforcement guarantees.

## Implementation sequence for later decomposition

These are planning work packages, not created tasks or implementation authorization.

1. Canonical identities, manifest validation, deterministic rendering, exact command parser, and operation-ID codec.
2. Complete schema-v1 gate history reducer and structural validators.
3. Original-request snapshotting and ledger acknowledgement/privacy guards.
4. Fresh-only reservation and one-attempt publication coordinator.
5. Independent publication evidence and reconciliation.
6. Complete ordered event evidence and decision-specific human authorization.
7. Durable resolution, uncertainty recovery, and result classification.
8. Independent target proof and descriptive handoff.
9. Bounds, cancellation/fault schedules, public API validation, documentation, and changeset consideration.

Write red tests before each production change; keep each later task/commit independently green. Do not implement a daemon or leave disconnected primitives described as end-to-end delivery.

## Conformance and test strategy

No tests or builds were executed during planning.

| Conformance | Planned evidence                                                                                               |
| ----------- | -------------------------------------------------------------------------------------------------------------- |
| CC-01       | Fresh reservation, one publication, verified receipt, authorized command, one durable approval, zero execution |
| CC-02       | Crash after reservation before invocation; restart produces zero invocation and may remain permanently blocked |
| CC-03       | Lost publisher response; repeated calls/recovery never publish again                                           |
| CC-04       | Late matching receipt reconciles original occurrence without publication                                       |
| CC-05       | Wrong work item/design/target/version/content receipt rejected                                                 |
| CC-06       | Denied human authorization produces zero resolution writes                                                     |
| CC-07       | Exact parser rejects prose, quotes, aliases, malformed/conflicting commands                                    |
| CC-08       | Authorized matching change request durably resolves without implementation approval                            |
| CC-09       | Revised design/target mismatch cannot inherit approval                                                         |
| CC-10       | Both watcher intake kinds provide no mutation capability                                                       |
| CC-11       | Identical/different concurrent reservations, repeated calls, and restarts preserve publisher count ≤ 1         |
| CC-12       | Complete ordered selection plus approval/change-request CAS race preserves one durable winner                  |
| CC-13       | Inclusive expiry, stale fence, wrong token, and retired permission deny new effects                            |
| CC-14       | Missing anchor/prefix, malformed acknowledgement, corruption, capacity, and dependency uncertainty fail closed |
| CC-15       | Missing/mismatched original/current target proof blocks target-specific handoff                                |
| CC-16       | Development approvals never satisfy product commands                                                           |

Additional red-first matrices:

- Canonicalization: safe-integer/string work-item distinction, malformed Unicode, noncanonical base64url, exact byte counts, manifest sort/duplicates, boundary and boundary+1 sizes.
- Ledger integration: same-value phase/status accepted; forbidden patches absent; complete retained history; request mutation by dependency; original token changed under identical nonsecret `J`; wrong method/revision/timestamp/outcome.
- Recovery: replay/history never fresh; original capability unavailable; reservation/readback uncertainty; publication/resolution timeout followed by durable readback.
- Ordering: multi-page prefix, gap/overlap/cycle/snapshot mismatch, edited commands at edit position, deleted earlier decisions retained, missing versions, earlier denied versus unresolved authorization.
- Fault schedules: pre/post-reservation crash, pre/post-invocation crash, concurrent identical/different requests, late noncooperating dependencies, capacity after reservation, malformed highest generation.
- Privacy/boundaries: zero token/body/prose/session-content persistence; stable errors; no claim lifecycle, cursor/reference changes, live transport, agent runs, phase execution, merge, or external board actions.
- Target: no-target explicit, stale proof, source/branch/worktree/agent/session mismatch, historical approval preserved while handoff blocked.

Verification must cover FR-001–FR-026, CC-01–CC-16, INV-001–INV-007, and SC-001–SC-006 from S:109–207.

Use pure tests, deterministic injected seams, and supported isolated public-ledger integration fixtures. Portable ledger test capabilities are not proof of production Windows support.

## Commands

These commands are documented for later authorized validation; none was run during planning. Run from the named worktree.

### Build

```powershell
Set-Location -LiteralPath 'C:\repos\copilot-worktrees\sandcastle\agent-team-slice15-loop'
npm run build
```

The canonical build has a preexisting Windows POSIX `rm`/`cp` postbuild limitation. Do not fix unrelated packaging or label the whole build successful when postbuild fails.

### Typecheck

```powershell
Set-Location -LiteralPath 'C:\repos\copilot-worktrees\sandcastle\agent-team-slice15-loop'
npm run typecheck
```

### Tests

```powershell
Set-Location -LiteralPath 'C:\repos\copilot-worktrees\sandcastle\agent-team-slice15-loop'
npm test
```

Decomposition must bind smallest test selectors to the actual created test files. Do not invent currently nonexistent selectors or claim they ran.

### Lint and formatting

```powershell
Set-Location -LiteralPath 'C:\repos\copilot-worktrees\sandcastle\agent-team-slice15-loop'
npm run format:check
```

For later changed-planning-file verification:

```powershell
Set-Location -LiteralPath 'C:\repos\copilot-worktrees\sandcastle\agent-team-slice15-loop'
npm exec --no -- prettier --check docs/features/devsquad-ado-design-approval/plan.md docs/adr/0027-devsquad-ado-design-approval-gate.md
```

Use existing dependencies; do not install packages merely to perform planning validation.

### Local execution

No slice-15 daemon, CLI execution command, or live-host entry point exists or is authorized by this plan. Exercise the offline primitive through the test harness after implementation. Do not substitute unrelated Sandcastle application execution for end-to-end gate validation.

## Operational limitations and roadmap

1. Production ledger Windows support is currently blocked: the system platform selects unsupported permission/directory-sync capabilities on Windows [Platform:629–646]. Do not substitute the portable test platform or fix the predecessor platform within this slice.
2. Host evidence must supply immutable publications, artifact versions, original target witnesses, authoritative event history, and event-specific authorization. Missing evidence can permanently block progress.
3. Reservation may permanently lose publication, including a crash before invocation. Investigation and original-receipt reconciliation are allowed; repeat publication and automatic replacement occurrence are not.
4. Capacity may run out after reservation. No compaction, eviction, rollover, or future capacity reservation is introduced.
5. Coordinators must share the same explicit ledger root and supported local durability/trusted-owner boundary.
6. No live ADO/MCP transport, credentials, host daemon, automatic polling, or deployed operational service is delivered.
7. Slice 16 owns plugin-driven resumable phase execution from spec through publish and Sandcastle delegation.
8. Slice 17 owns broader feedback routing.
9. Slice 18 owns human-confirmed merge/finalization and pause/resume/cancel/status/audit controls.
10. Slice 19 owns real host-side ADO MCP transport; these contracts remain offline until that integration is separately available and verified.

The operational runbook must explain consumed attempts, unavailable evidence, capacity exhaustion, unsupported platform, and target mismatch without offering an approval bypass.

## Reasoning log

| Decision                               | Basis                                               | Alternative not selected                        | Confidence                                                   |
| -------------------------------------- | --------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------ |
| Reuse same-value public checkpoints    | Actual API/schema/storage behavior                  | New payload/schema/cursor encoding              | High, static contract evidence                               |
| Typed fixed-width commitments          | Exact 226/182-byte accounting                       | Full evidence/chunked payload storage           | High for identity fit; host witness availability conditional |
| Fresh-only one-attempt permission      | Settled Q1=A and actual replay distinction          | Retry/idempotent publisher policy Q1B           | High under supported host/CAS model                          |
| Nonsecret `J`                          | Data minimization plus actual private ledger digest | Public token-derived gate identifier            | High with strict original-request guard                      |
| Immutable ordered event-time decisions | First-valid stability under concurrency             | Mutable current-comments/current-role selection | Conditional on host evidence contract                        |
| Independent target proof               | No historical target snapshots in checkpoint API    | Current branch/worktree as historical evidence  | High                                                         |
| Preserve platform/integration gaps     | Actual Windows platform behavior and offline scope  | Hidden workaround or end-to-end claim           | High                                                         |

Assumptions: trusted configured host verifiers, supported ledger platform/storage, shared namespace/root, immutable evidence availability when required, and collision-resistant SHA-256.

Missing production evidence is explicit; it is not filled with a fictional MCP schema.

## Handoff envelope

- Completed phase: plan and ADR alignment.
- Authoritative input: S, unchanged.
- Planning artifact: this plan.
- Proposed decision: A27.
- Referenced predecessors: A21, A22, A24, A25, A26.
- Data model/contracts: embedded in this plan.
- Architectural assumptions and discarded alternatives: recorded above and in A27.
- Security: conditional architectural approval with SEC-001–SEC-007 requirements.
- Validation: read-only source inspection and static proof only; no executed tests/builds.
- Scope exclusions: implementation, commits, external boards, live writes, PRs, merge, ADR acceptance, and later-slice orchestration.
- Persistence boundary: preserve saved specification and all old drafts; no blanket staging of untracked directories.
- Next action: return a discrete `/devsquad.decompose` checkpoint to the conductor after artifact persistence verification.
- Do not launch decomposition or implementation from this planning handoff.
