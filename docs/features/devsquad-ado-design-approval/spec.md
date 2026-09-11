# DevSquad/ADO Design Approval Specification

Status: Reconciled specification for planning
Date: 2026-09-11
Slice: 15
Tracking: Local only; no external work item linked

## Executive Summary

- **Objective:** Publish an immutable design proposal through a host-injected side effect and block progression until an authorized human explicitly approves that design or requests changes.
- **Primary user:** A human design reviewer, supported by a DevSquad host coordinator.
- **Value delivered:** Reviewers decide against a specific design; coordinators recover gate state without silently repeating uncertain publication or transferring approval to a changed design.
- **Scope:** Includes durable publication reservation, receipt verification, immutable design binding, and only `/devsquad approve-design` and `/devsquad request-changes`. Excludes phase execution, live tracker transport, and merge authority.
- **Primary success criterion:** Each gate occurrence permits at most one application-level publication attempt and one durable human resolution; no approval is effective without matching publication evidence and immutable design identity.

## Objective

Give DevSquad a recoverable human design gate between workflow intake and later phase execution.

The approved publication policy is Q1=A: durably reserve one attempt before external publication, never automatically repeat an uncertain attempt, and keep the gate blocked until a matching publication receipt is verified. This deliberately permits permanent publication loss.

The product human gate is independent of approvals given while developing this feature. Specification approval, phase-checkpoint approval, automated review, and requests to autoapprove development checkpoints never count as product design approval.

## Context

Slice 13 provides an offline, fenced workflow ledger. Slice 14 provides bounded watcher observation and discovery admission. The conductor reports slice 14 complete at commit `e7e46dc76597d2e16782c779e8a8eaa4dd5accca`; this specification does not reopen that work.

Actual watcher contracts establish:

- Comment intake contains historical source revision, changed kinds, phase/status, and token-free claim metadata. It contains neither claim authority nor comment bodies.
- Watcher cleanup attempts to release its claim before returning. Cleanup uncertainty does not transfer authority.
- Discovery admission has a separate signal, initialization revision one, and no comment event or claim.
- Intake is at-most-once and may be lost. It is not execution authority or an exactly-once dispatch mechanism.

Ledger schema v1 contains checkpoint operation identifiers and previous/resulting phase/status, but no generic gate payload. Branch and worktree are current values without checkpoint snapshots. Agent/session activation histories do not establish every historical execution target.

ADR-0021, ADR-0022, and ADR-0024 preserve host control-plane, scheduling, lifecycle, and execution boundaries. ADR-0025 and ADR-0026 describe ledger and watcher contracts and remain **Proposed** in this checkout.

The halted design-approval spec, plan, and proposed ADR-0027 in the old worktree are historical planning context only. Their claimed-intake handoff, five-command protocol, and non-mutating prepare/confirm publication guarantee are not adopted.

## Scope

### Included

- One gate occurrence for one canonical work item and one immutable design.
- Host-authorized gate initiation after fresh ledger inspection.
- A durable single-attempt reservation before invoking a host-injected publisher.
- Verification and durable recording of matching publication evidence.
- Explicit human approval or change request, with injected authorization.
- Durable resolution, replay-safe recovery, stable blocked outcomes, and minimized evidence.
- Offline conformance tests using injected dependencies.

### Excluded

- `reject`, `hold`, `cancel`, command aliases, implicit approval, and timeout approval.
- Autonomous design generation or execution of specification, planning, ADR, implementation, verification, review, or publishing phases.
- Live ADO/GitHub/MCP transport, credential management, query construction, or identity-provider access.
- Automatic publication retries, durable host idempotency infrastructure, and exactly-once external publication.
- Automatic acknowledgements, reminders, escalation comments, and other additional publication effects.
- Watcher redesign, synthetic discovery comments, or reconstruction of lost intake.
- Ledger schema changes, new storage sidecars/outboxes, receipt eviction, capacity changes, or cursor repurposing.
- Agent execution, worktree creation, git operations, PR approval, completion, or merge.
- External board writes and changes to ADR governance status.

## Actors

- **Human reviewer:** Reads the published design and explicitly approves it or requests changes.
- **DevSquad host coordinator:** Supplies design identity, gate occurrence, lifecycle authorization, current claim authority, and exact target states.
- **Host-injected dependencies:** Publish proposals, provide publication/decision evidence, and resolve reviewer authorization.
- **Workflow ledger:** Enforces durability, capability authorization, fencing, exact preconditions, and idempotency.
- **Operator:** Investigates blocked or uncertain gates without bypassing their safety conditions.

## User Scenarios and Tests

### Scenario 1: Publish and approve a specific design

**Given** a host-authorized gate `G1` for work item `137` and immutable design `D1`,
**When** a reservation is durably accepted, the publisher is invoked once, receipt `P1` is verified, and an authorized human submits `/devsquad approve-design` explicitly bound to `G1` and `D1`,
**Then** one approval is durably recorded and a matching decision result is returned to DevSquad without executing a phase.

### Scenario 2: Publication becomes uncertain

**Given** the reservation for `G1` is durable,
**When** the process stops before publication, or publication may have occurred but its receipt is unavailable,
**Then** restart permits no second publication attempt and the gate remains blocked. Only verified matching publication evidence can make the proposal eligible for a human resolution.

### Scenario 3: Request changes

**Given** a verified publication for `G1` and `D1`,
**When** an authorized human submits `/devsquad request-changes` bound to that occurrence and design,
**Then** one changes-requested resolution is recorded and implementation remains unapproved. Any revised design requires a separately authorized occurrence and fresh human review.

### Scenario 4: Intake supplies no claim

**Given** either a comment-observation signal or discovery-admission signal,
**When** the host considers starting a gate,
**Then** it independently obtains valid ledger authority and checks current state. It does not reuse watcher metadata as a capability, fabricate a source comment, or require historical intake revision to equal current revision.

### Scenario 5: Design or execution context changed

**Given** publication and approval evidence refer to `D1`,
**When** the proposed content is changed to `D2`, or a required execution target can no longer be verified,
**Then** the feature does not approve `D2` or return an executable resume instruction for an unverified target.

## Functional Requirements

### Identity and authority

- **FR-001:** Every gate shall bind the canonical work-item identity, a host-authorized gate-occurrence identity, and immutable design identity. Publication, receipt, decision, and recovery evidence shall preserve that binding.
- **FR-002:** Immutable design identity shall cover the reviewed proposal and the exact versions of referenced design artifacts. A mutable path, branch name, “latest” pointer, or work-item identifier alone shall not identify an approved design.
- **FR-003:** Watcher intake shall be treated only as notification/provenance. The feature shall require independently supplied current claim authority for new ledger mutations. It shall not acquire, renew, transfer, or release claims.
- **FR-004:** Fresh gate eligibility and mutation preconditions shall use current validated ledger state. Historical intake revision, accepted checkpoint revision, cleanup revision, and current revision shall remain distinct.
- **FR-005:** Every new mutation shall use ledger capability authorization, fencing, and exact revision/phase/status checks. Owner identity and fencing metadata alone shall not authorize it. Inclusive expiry shall follow the ledger contract: `now >= expiresAt` is expired.

### Single-attempt publication

- **FR-006:** Before any publication invocation, the feature shall durably reserve the occurrence's sole application-level attempt, bound to its immutable design. An indeterminate reservation shall permit no publication.
- **FR-007:** Only validated fresh reservation acceptance may permit one invocation of the host-injected publisher. Concurrent losers, reservation replay, history recovery, restart, and repeated caller requests shall permit zero additional invocations.
- **FR-008:** Once reserved, the attempt shall remain consumed even if no publication occurred, publication failed, the response was lost, or the process stopped before invocation. The feature shall not automatically create another occurrence to evade this rule.
- **FR-009:** Matching receipt verification shall establish the target work item, gate occurrence, immutable design, and published proposal identity. A bare comment identifier or an unverified caller success flag shall not suffice.
- **FR-010:** Until matching publication evidence is durably confirmed, the gate shall remain blocked and human commands shall not resolve it. Later verification may reconcile the original attempt without republishing.
- **FR-011:** Proposal output shall identify the design under review, explain both supported commands and their required target binding, and state that approval applies only to that design. Required identity and command information shall not be silently truncated.

### Human decision protocol

- **FR-012:** The only supported product commands shall be `/devsquad approve-design` and `/devsquad request-changes`, with explicit binding to the occurrence and immutable design. Exact argument serialization is deferred to planning; no alias or configurable five-command vocabulary is implied.
- **FR-013:** Quoted examples, incidental prose, substring matches, malformed or conflicting commands, missing targets, and commands for another design shall not resolve a gate.
- **FR-014:** Human identity and permission shall be established through a host-injected authorization contract for the particular decision. Only an explicit grant shall authorize resolution. Missing, denied, malformed, thrown, rejected, or unresolved authorization shall never produce approval.
- **FR-015:** Decision evidence shall establish that the command answers the verified proposal in authoritative tracker order. Opaque identifiers shall be compared for equality, never numerically or lexically ordered as timestamps. Missing ordering or anchor evidence shall block resolution.
- **FR-016:** Among eligible authorized decisions in verified authoritative order, the first valid command shall determine the resolution. At most one resolution may become durable. Replay and later comments shall not replace it.
- **FR-017:** A changes-requested result shall not authorize implementation. A revised design shall require a new explicitly authorized occurrence and fresh approval; changing identity shall never be an automatic recovery mechanism for an uncertain publication.
- **FR-018:** Approval shall be reported as effective only after its resolution is confirmed durable. The result shall identify the approved design and occurrence, without initiating execution or claiming exactly-once downstream delivery.

### Recovery, boundaries, and privacy

- **FR-019:** Recovery shall distinguish reservation uncertainty, publication uncertainty, unverified receipt, pending human decision, durable approval, and durable changes requested. Stable outcomes shall explain the blocked condition without exposing dependency-controlled errors.
- **FR-020:** Ledger retries and accepted-history validation shall remain bound to the original semantic submission. Changed preconditions or capabilities shall not be disguised as exact replay, and a conflict shall not be bypassed by minting another operation identifier.
- **FR-021:** Durable encoding shall use only existing public ledger contracts and fit schema-v1 limits. Gate operations shall not patch observation cursors or execution references. Corruption, unsupported schema, capacity failures, and unrecoverable evidence shall fail closed.
- **FR-022:** Required execution context shall be verified independently of design approval. Current branch/worktree fields shall not be presented as historical snapshots. Ordinary watcher cursor checkpoints and claim renewal alone shall not be interpreted as design changes; unverifiable target integrity shall block a target-specific handoff.
- **FR-023:** Phase/status values and transition authorization shall remain host-supplied. The feature shall define no phase runner, lifecycle ordering, merge readiness, or execution authority.
- **FR-024:** Inputs and dependency results shall be structurally validated and bounded before proportional retention or side effects. Required identity evidence shall be rejected when oversized rather than truncated. Planning shall define finite budgets and dependency-liveness contracts without claiming hard termination of noncooperating dependencies.
- **FR-025:** Durable state, diagnostics, and errors shall exclude proposal/comment bodies, reviewer prose, claim tokens, credentials, and agent-session contents. Reviewer prose, if returned, shall remain bounded, explicitly untrusted, in-process data and shall never grant authority. Text normalization shall not be represented as a guarantee that arbitrary prose contains no secrets.
- **FR-026:** Publication and authorization dependencies shall be host-injected and testable offline. Core shall construct no live client or credential flow. Existing control-plane return types shall not be represented as providing receipt verification, trusted human identity, or durable external idempotency.

## Conformance Criteria

Fixture identifiers below are opaque test values, not external board links.

| ID    | Scenario                        | Input                                                                              | Expected Output                                                             |
| ----- | ------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| CC-01 | Happy path                      | `137/G1/D1`, fresh reservation, verified `P1`, authorized matching approve-design  | One publisher invocation; one durable approval; no phase execution          |
| CC-02 | Crash before publication        | Durable reservation for `G1`; stop before publisher invocation; restart            | Zero restart invocations; publication may be permanently lost; gate blocked |
| CC-03 | Lost publication receipt        | Publisher invoked once; response unavailable; same request replayed                | No second invocation; publication-unverified outcome                        |
| CC-04 | Late matching receipt           | CC-03 plus verified receipt for `137/G1/D1`                                        | Original attempt reconciled; gate awaits human decision; no republication   |
| CC-05 | Wrong receipt                   | Reservation for `D1`; receipt binds `D2` or another work item                      | Receipt rejected; gate blocked; no resolution                               |
| CC-06 | Unauthorized command            | Verified `P1`; matching approve-design; authorization denied                       | Zero resolution writes; gate remains pending                                |
| CC-07 | Unsupported or ambiguous input  | `lgtm`, `/devsquad cancel`, quoted approval, or conflicting commands               | Must NOT approve, resolve, or execute                                       |
| CC-08 | Changes requested               | Verified `P1`; authorized matching request-changes                                 | One changes-requested resolution; no implementation approval                |
| CC-09 | Changed design                  | Approval for `D1`; caller presents content identified as `D2`                      | Must NOT transfer approval; fresh review required                           |
| CC-10 | Claim boundary                  | Comment intake has metadata only; discovery intake has no claim                    | Neither authorizes mutation; host must supply valid authority               |
| CC-11 | Concurrent/replayed reservation | Two coordinators contend for `G1`; later restart repeats request                   | At most one permitted publisher invocation across all attempts              |
| CC-12 | Resolution race                 | Verified ordered approval followed by change request; concurrent resolution/replay | At most one durable resolution; later command cannot overwrite              |
| CC-13 | Stale or expired authority      | Mutation at inclusive expiry, stale fence, or wrong token                          | Ledger rejection; no new publication permission or resolution               |
| CC-14 | Missing evidence                | Missing anchor/order evidence, malformed acknowledgement, or corrupt ledger        | Explicit blocked/failure outcome; no inferred success                       |
| CC-15 | Target integrity                | Required branch/worktree binding cannot be verified                                | No target-specific executable resume instruction                            |
| CC-16 | Development approval            | Development checkpoint approved; no matching human product command                 | Product gate remains unresolved                                             |

## Invariants

- **INV-001:** Application-level publication attempts per gate occurrence are at most one across concurrency, replay, and restart.
- **INV-002:** Reservation without verified matching publication never authorizes human resolution.
- **INV-003:** Approval belongs to exactly one immutable design within one work-item gate occurrence.
- **INV-004:** At most one human resolution is durable for an occurrence.
- **INV-005:** Watcher signals, ledger metadata, and development-run approvals grant no product approval or execution authority.
- **INV-006:** Gate operations preserve watcher cursor ownership and ledger schema/lifecycle boundaries.
- **INV-007:** Uncertainty reduces permitted action; it never creates another publication attempt or implicit approval.

## Key Entities

| Entity                    | Meaning                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------- |
| Gate occurrence           | One explicitly authorized review occurrence for one work item and immutable design |
| Immutable design identity | Identity binding the proposal and exact referenced artifact versions               |
| Publication reservation   | Durable consumption of the occurrence's only application-level attempt             |
| Publication receipt       | Verified evidence linking the actual published proposal to the reserved binding    |
| Human decision            | Authorized explicit command answering the matching published proposal              |
| Resolution                | Durable approval or changes-requested outcome                                      |
| Execution context         | Host-owned branch, worktree, agent, and session references, separate from approval |

Host, agent, sandbox, worktree, and agent session follow `CONTEXT.md`. The additional terms above are feature-local definitions; this specification creates no glossary file.

## Assumptions and Approved Tradeoffs

- **Approved Q1=A:** Permanent publication loss is acceptable after reservation. There is no automatic retry, even when publication probably did not occur. Owner: product/workflow owner.
- **Separate predecessor tradeoff:** Watcher intake can already be lost after durable observation or admission. This feature neither repairs that loss nor treats it as approval of the distinct publication-loss tradeoff.
- **Host publication obligation:** The single application-level invocation must not conceal application-level retries. The guarantee is not exactly-once tracker storage or protection against a host independently posting duplicates. Owner: host integration owner.
- **Host evidence obligation:** Publication provenance, authoritative command ordering, human authorization, immutable artifact versions, and lifecycle targets must be supplied and verified. Missing evidence blocks; no identity-provider, receipt, or lifecycle policy is invented. Owner: DevSquad host owner.
- **Recovery limit:** If publication or its matching evidence is permanently unavailable, this slice may remain blocked permanently. Operator investigation does not grant a retry or bypass command.

## Success Criteria

- **SC-001:** Every conformance case passes with deterministic injected inputs.
- **SC-002:** Publisher invocation count remains at most one per occurrence across concurrent calls, replay, restart, and each interrupted-publication case.
- **SC-003:** Effective approval count is zero for missing publication evidence, unauthorized decisions, mismatched designs, and development-only approvals.
- **SC-004:** Every acknowledged gate checkpoint is recoverable within the ledger's supported durability scope; recovery never grants another publication attempt.
- **SC-005:** Reviewers are shown the immutable target and both supported commands in every valid proposal; every blocked result identifies its evidence or authority deficiency.
- **SC-006:** Offline verification performs zero live tracker calls, phase executions, agent runs, or merge actions and stores zero prohibited body/capability fields.

## Technical Decisions Requiring Planning

| Decision                                        | Status                                    | Required planning outcome                                                                                                                                                               |
| ----------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Durable gate binding and recovery encoding      | [DEFERRED: architecture selection]        | Prove reservation, design, receipt, resolution, and required target evidence fit schema v1, including the 256-byte operation-ID limit; no adoption of old `dsg1.` grammar by assumption |
| Publication boundary and acknowledgement guards | Q1=A fixed; contracts deferred            | Prove fresh-only invocation permission and suppression on every ambiguous/replayed path; define original-submission validation                                                          |
| Immutable identity and command binding          | [DEFERRED: public contract design]        | Define canonical identity, artifact version binding, exact command syntax, authoritative ordering, and malformed-input behavior                                                         |
| Host evidence and authorization seams           | [DEFERRED: offline integration contracts] | Define normalized verification evidence without inventing live ADO/MCP schemas; state dependency trust and liveness                                                                     |
| Execution-context handoff                       | [DEFERRED: host composition]              | Prove target integrity without treating current fields as historical snapshots or giving Sandcastle lifecycle authority                                                                 |

Owners: architecture lead for durable encoding and public contracts; DevSquad host owner for evidence, authorization, and lifecycle composition. An infeasible proof must return as an explicit scope/architecture exception before implementation, not as a silent schema change.

## Integration Gaps and Next Boundary

Slice 15 specifies an offline gate, not an end-to-end autonomous workflow.

- Slice 16 remains responsible for the plugin-owned resumable phase runner and delegation to Sandcastle.
- Slice 17 remains responsible for broader feedback classification and routing.
- Slice 18 remains responsible for human-confirmed merge/finalization and pause/resume/cancel/status/audit controls.
- Slice 19 remains responsible for real host-side ADO MCP transport; offline contracts do not establish live integration.

Later implementation must follow `CLAUDE.md`, including `npm run typecheck`, a user-facing feature changeset, and README consideration. This specification does not authorize those edits or advance to another phase.
