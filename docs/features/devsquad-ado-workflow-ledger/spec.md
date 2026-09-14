# Persistent DevSquad/ADO Workflow Ledger Specification

## Executive Summary

- **Objective:** Persist enough DevSquad/ADO workflow state for a host coordinator to resume work safely after interruption without making Sandcastle the owner of the DevSquad lifecycle.
- **Primary user:** A DevSquad host coordinator processing durable ADO or GitHub work items through Sandcastle.
- **Value delivered:** Coordinators can recover branch, worktree, agent, session, pull request, observation cursor, and transition context while preventing concurrent loops from processing the same work item.
- **Scope:** Includes repository-local persistence, typed ledger operations, exclusive claims, fencing, validation, and restart recovery; excludes live ADO/network access, DevSquad lifecycle policy, agent-session contents, and pull request finalization.
- **Primary success criterion:** Every acknowledged mutation is recovered after restart, and concurrent claim attempts for one work item produce exactly one active owner.

## Objective

Add a persistent, repository-local workflow ledger under `.sandcastle/devsquad-ado/` that records the latest DevSquad/ADO coordination state for each work item.

The ledger must let a host coordinator determine where an interrupted workflow stopped, avoid repeating already-observed external events, and prevent two coordinator loops from processing the same work item concurrently.

The ledger is a durable coordination checkpoint. It is not a replacement for DevSquad lifecycle state or durable ADO/GitHub work tracking.

## Context

The existing architecture separates three responsibilities:

1. DevSquad owns intent, phase progression, approval gates, and workflow lifecycle.
2. Sandcastle owns isolated execution through branches, worktrees, sandboxes, and agent providers.
3. ADO or GitHub owns durable work-item and pull-request tracking.

The DevSquad Sandcastle execution adapter already runs one caller-selected task and returns branch, commit, validation, log, and session metadata. Existing ADO helpers operate through injected control-plane seams.

Neither boundary currently provides a durable checkpoint for a host loop that stops between selecting a work item, running an agent, publishing a pull request, and observing feedback. Without such a checkpoint, restart can lose resume context or repeat external processing.

## Scope

### Included

- Repository-local workflow state under `.sandcastle/devsquad-ado/`.
- One independently addressable ledger record per work item.
- Current DevSquad phase and caller-supplied workflow status.
- Branch and worktree identity.
- Current and historical agent and session identifiers.
- Pull request identifier and URL.
- Last-seen work-item comment identifier.
- Last-seen pull request thread and comment identifiers.
- Timestamped workflow transition history.
- Revision-based optimistic concurrency.
- Exclusive, expiring work-item claims with stale-owner fencing.
- Idempotent mutation handling.
- Restart, interrupted-write, corruption, invalid-data, and concurrency behavior.
- Typed public APIs and structured errors.
- Deterministic tests that use controlled time and filesystem boundaries.

### Excluded

- Defining or executing the DevSquad phase state machine.
- Deciding whether a DevSquad phase transition is semantically permitted.
- Selecting, polling, claiming, or updating work items through live ADO or GitHub services.
- Live ADO, GitHub, MCP, REST, Azure CLI, Azure DevOps CLI, or other network calls.
- Storing ADO comments, PR review bodies, prompts, credentials, tokens, or agent-session contents.
- Replacing agent-provider-owned session storage.
- Creating, approving, completing, or merging pull requests.
- Multi-host distributed coordination without a shared repository filesystem.
- Modernizing or replacing existing ADO control-plane, team-runner, or execution-adapter APIs.

## Actors

- **DevSquad host coordinator:** Reads external work state, decides valid lifecycle transitions, acquires a ledger claim, and records checkpoints.
- **Sandcastle execution boundary:** Produces execution metadata that the coordinator may persist, but does not own the ledger lifecycle.
- **Operator:** Diagnoses interrupted, failed, claimed, or corrupt workflows and initiates recovery.
- **External work tracker:** Remains the durable source for work-item, comment, pull-request, CI, and review data.

## User Scenarios and Tests

### Scenario 1: Resume an interrupted workflow

**Given** a coordinator has persisted a work item’s phase, status, branch, worktree, agent session, pull request, and last-seen external cursors,  
**When** the process terminates and a new process opens the same repository ledger,  
**Then** the new process receives the last acknowledged complete record and can determine the next action without repeating already-recorded observations.

### Scenario 2: Prevent concurrent processing

**Given** two coordinator loops attempt to claim the same work item while no active claim exists,  
**When** both acquisitions overlap,  
**Then** exactly one loop receives an active claim and the other receives a structured claim-conflict result without mutating the workflow record.

### Scenario 3: Recover from an abandoned claim

**Given** a coordinator terminated without releasing its claim and the claim lease has expired,  
**When** another coordinator acquires the work item,  
**Then** the new coordinator receives a higher fencing value and may continue processing, while writes from the former claim are rejected.

### Scenario 4: Reject stale workflow updates

**Given** a coordinator read revision 8 and another valid update created revision 9,  
**When** the first coordinator submits a transition expecting revision 8,  
**Then** the ledger rejects the mutation with the current revision and leaves revision 9 unchanged.

### Scenario 5: Surface invalid or corrupt state

**Given** stored data is truncated, malformed, or incompatible with the supported schema,  
**When** the ledger is opened or the affected record is read,  
**Then** it reports a structured recovery error and does not silently replace the data with an empty record.

## Functional Requirements

### Durable Records

- **FR-001:** The feature shall persist ledger data beneath `.sandcastle/devsquad-ado/` in the host repository’s config directory.
- **FR-002:** Each work item shall have one independently readable and mutable ledger record, identified by a stable canonical work-item identifier.
- **FR-003:** Every record shall contain a schema version, work-item identifier, monotonically increasing revision, creation timestamp, and last-update timestamp.
- **FR-004:** A record shall store the current caller-supplied DevSquad phase and workflow status as non-empty values.
- **FR-005:** A record shall support the current branch, worktree path, agent identifier, and session identifier when those values are available.
- **FR-006:** Replacing the current agent or session identifiers shall not discard identifiers recorded for previous attempts.
- **FR-007:** A record shall support a pull request identifier and URL independently because either value may become available before the other.
- **FR-008:** A record shall support opaque cursors for the last-seen work-item comment and the last-seen pull request thread and comment.
- **FR-009:** The ledger shall not store external comment bodies, review bodies, credentials, authentication tokens, prompts, or agent-session contents.
- **FR-010:** Each accepted workflow checkpoint shall record its acceptance timestamp and, when phase or status changed, the previous and resulting phase and status.
- **FR-011:** Transition history shall preserve ordering across restart and shall not contain two accepted transitions with the same record revision.

### DevSquad Lifecycle Boundary

- **FR-012:** The ledger shall preserve phase and status values supplied by the DevSquad host without defining a built-in ordering of DevSquad phases.
- **FR-013:** The ledger shall reject a transition when its expected revision or expected current phase/status does not match the stored record.
- **FR-014:** The ledger shall not reject a structurally valid transition solely because the resulting phase or status is unknown to Sandcastle.
- **FR-015:** The ledger shall not initiate DevSquad transitions, approval gates, work-item updates, or external comments.

### Typed Operations and Validation

- **FR-016:** Public typed operations shall support initializing a record, reading one record, listing resumable records, applying a checkpoint, acquiring a claim, renewing a claim, releasing a claim, and inspecting recovery errors.
- **FR-017:** Mutation results shall return the accepted revision and current durable record or a structured error that callers can handle without parsing error-message text.
- **FR-018:** Inputs shall be validated before persistent state is mutated.
- **FR-019:** Validation shall reject blank or unsafe work-item identifiers, blank phase/status values, invalid timestamps, invalid revisions, malformed URLs, invalid lease durations, and incomplete PR or observation cursor values.
- **FR-020:** Work-item identifiers shall not be interpreted as relative or absolute filesystem paths and shall not permit state to be written outside `.sandcastle/devsquad-ado/`.
- **FR-021:** Unsupported future schema versions shall fail closed rather than being interpreted as the current schema.
- **FR-022:** Public APIs intended for host integration shall be exported through the package’s established public entry point.

### Atomicity, Restart, and Recovery

- **FR-023:** A successful mutation response shall mean the new record is durable and observable after reopening the ledger.
- **FR-024:** An interrupted mutation shall recover as either the complete previous revision or the complete new revision, never as a partially combined record.
- **FR-025:** Opening the ledger after a normal process restart shall not require live ADO, GitHub, MCP, network, sandbox, agent, or git operations.
- **FR-026:** Malformed or corrupt durable data shall produce a structured error identifying the affected work item or ledger artifact.
- **FR-027:** Recovery shall not silently delete, overwrite, reset, or fabricate replacement state for a corrupt record.
- **FR-028:** A failed mutation shall leave the last acknowledged record readable and unchanged.
- **FR-029:** Mutations shall accept a caller-supplied operation identifier so that retrying the same acknowledged or ambiguously completed operation returns the original outcome without adding another transition or revision.

### Claims and Concurrency

- **FR-030:** Claim acquisition shall be atomic across concurrent host processes using the same repository ledger.
- **FR-031:** At most one unexpired claim shall exist for a work item at any instant.
- **FR-032:** A successful claim shall include the work-item identifier, owner identifier, opaque claim token, monotonically increasing fencing value, acquisition time, heartbeat time, and expiration time.
- **FR-033:** Claim acquisition shall require a positive finite lease duration.
- **FR-034:** Acquisition against an unexpired claim shall fail with structured conflict information sufficient to identify the current owner and expiration time without exposing secrets.
- **FR-035:** An expired claim may be replaced atomically by a new owner without manual deletion of the workflow record.
- **FR-036:** Every mutation of a claimed work item shall require the current claim token and fencing value.
- **FR-037:** After claim takeover, mutations, renewals, and releases using the former token or fencing value shall be rejected even if the former process resumes.
- **FR-038:** Only the current owner may renew or release an unexpired claim.
- **FR-039:** Renewing a claim shall extend it from the accepted renewal time and shall not reduce its existing fencing value.
- **FR-040:** Releasing a claim shall not delete the work-item record or its transition history.
- **FR-041:** Retrying an already accepted release with the same operation identifier shall succeed idempotently and shall not affect a later owner’s claim.
- **FR-042:** Claim conflicts, stale revisions, stale fencing values, and invalid data shall be distinguishable error categories.

### External Observation Cursors

- **FR-043:** Comment, thread, and PR identifiers shall be treated as opaque tracker-supplied identifiers.
- **FR-044:** Cursor changes shall use the same claim, revision, durability, and idempotency safeguards as other mutations.
- **FR-045:** Restarted coordinators shall be able to read the recorded cursors before requesting later external observations.
- **FR-046:** The ledger shall not infer cursor ordering from identifier text; the host coordinator remains responsible for selecting the next externally observed cursor.

## Key Entities

### Workflow Ledger Record

The latest durable coordination checkpoint for one work item.

| Attribute                | Description                                                   |
| ------------------------ | ------------------------------------------------------------- |
| Schema version           | Format version used to validate compatibility                 |
| Work-item ID             | Stable identity within the repository’s configured tracker    |
| Revision                 | Monotonically increasing optimistic-concurrency value         |
| DevSquad phase           | Current caller-supplied phase identifier                      |
| Workflow status          | Current caller-supplied status identifier                     |
| Branch                   | Current Sandcastle source branch, when assigned               |
| Worktree path            | Current host worktree path, when assigned                     |
| Agent/session references | Current and historical identifiers, without session contents  |
| Pull request             | Opaque identifier and optional URL                            |
| Observation cursors      | Last-seen work-item comment and PR thread/comment identifiers |
| Transition history       | Ordered accepted phase/status changes and timestamps          |
| Timestamps               | Creation and latest accepted mutation times                   |

### Workflow Claim

An expiring exclusive right for one coordinator loop to mutate a work-item record.

| Attribute     | Description                                        |
| ------------- | -------------------------------------------------- |
| Owner ID      | Coordinator instance identity                      |
| Claim token   | Opaque proof of ownership                          |
| Fencing value | Monotonically increasing stale-owner guard         |
| Acquired at   | Claim acceptance time                              |
| Heartbeat at  | Most recent successful acquisition or renewal time |
| Expires at    | Time after which atomic takeover is allowed        |

### Observation Cursor

An opaque pointer to the latest external event already processed by the coordinator. Work-item comments and PR thread/comments retain separate cursors.

### Transition Entry

An ordered record of an accepted phase or status change, including the resulting record revision, previous values, new values, operation identifier, and acceptance timestamp.

## Invariants

- **INV-001 — Stable identity:** A ledger record’s work-item identifier never changes after initialization.
- **INV-002 — Monotonic revision:** Every accepted non-idempotent mutation increases the record revision; rejected and idempotently replayed mutations do not.
- **INV-003 — Single active owner:** No work item has more than one unexpired claim.
- **INV-004 — Fenced ownership:** A superseded claim can never mutate, renew, or release state owned by a later claim.
- **INV-005 — Acknowledged durability:** Every acknowledged mutation is visible after process restart.
- **INV-006 — Atomic snapshots:** Readers observe a complete validated revision, never a mixture of revisions.
- **INV-007 — Historical continuity:** Accepted transition, agent, and session history is not silently discarded by later checkpoints.
- **INV-008 — Lifecycle separation:** The ledger records DevSquad phase and status but never determines the semantic validity or next value of either.
- **INV-009 — Control-plane separation:** Ledger operations never require or perform live tracker, MCP, CLI, network, sandbox, agent, or git calls.
- **INV-010 — Session ownership:** Session identifiers may be retained, but session records and transfer behavior remain owned by the agent provider.
- **INV-011 — Fail-closed recovery:** Invalid or corrupt state is surfaced and preserved for diagnosis rather than silently reset.
- **INV-012 — Idempotent retry:** Replaying an accepted operation identifier cannot create a duplicate transition, revision, or external-observation cursor update.

## Conformance Criteria

| ID     | Scenario                             | Input                                                                                                                                                                                | Expected Output                                                                                                                       |
| ------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| CC-001 | Happy-path checkpoint                | Work item `137`, phase `implement`, status `running`, branch `users/agent/137`, worktree `C:\repo\.sandcastle\worktrees\137`, agent `agent-a`, session `session-1`, operation `op-1` | A durable revision is returned containing the exact supplied metadata and an accepted timestamp.                                      |
| CC-002 | Restart recovery                     | Close and reopen the ledger after CC-001                                                                                                                                             | Work item `137` is returned at the acknowledged revision with identical branch, worktree, agent, session, phase, status, and history. |
| CC-003 | Concurrent claim                     | Owners `loop-a` and `loop-b` concurrently claim work item `137` for 60 seconds                                                                                                       | Exactly one receives a claim; the other receives a claim-conflict result naming the active owner and expiration time.                 |
| CC-004 | Expired-claim takeover               | `loop-a` claim expires at `10:01:00Z`; `loop-b` acquires at `10:01:01Z`                                                                                                              | `loop-b` receives a higher fencing value and becomes the only active owner.                                                           |
| CC-005 | Negative: stale owner must not write | After CC-004, `loop-a` submits a checkpoint using its former token and fencing value                                                                                                 | The mutation is rejected as stale; the record, revision, cursors, and `loop-b` claim remain unchanged.                                |
| CC-006 | Stale transition                     | Stored revision is `9` with phase `review`; request expects revision `8` and phase `implement`                                                                                       | A revision/state conflict is returned with current revision `9`; no transition is appended.                                           |
| CC-007 | Unknown DevSquad phase               | Current state matches and the caller changes phase to `custom-security-gate`                                                                                                         | The structurally valid transition is accepted; Sandcastle does not impose a phase allowlist.                                          |
| CC-008 | Invalid data                         | Initialize work item `../137` with blank status and malformed PR URL `not a url`                                                                                                     | Structured validation errors are returned and no ledger artifact is created outside or inside the state directory.                    |
| CC-009 | Interrupted durable write            | Terminate a mutation at each supported persistence interruption point                                                                                                                | Reopening yields either the complete prior revision or complete accepted revision; no partial record is returned.                     |
| CC-010 | Corrupt record                       | Replace one record with truncated or malformed data and reopen the ledger                                                                                                            | A structured corruption error identifies the affected record; the original artifact is not silently overwritten or reset.             |
| CC-011 | Idempotent retry                     | Submit operation `op-9`, lose the response, then submit the identical operation again                                                                                                | Both calls resolve to the same accepted revision and only one transition exists for `op-9`.                                           |
| CC-012 | Operation-ID conflict                | Reuse `op-9` with different phase, status, or cursor data                                                                                                                            | The second request is rejected as an idempotency conflict and the original result remains unchanged.                                  |
| CC-013 | Cursor round trip                    | Record work-item comment `481`, PR thread `12`, and PR comment `29`, then restart                                                                                                    | All three opaque identifiers are recovered exactly; no comment or review body is present.                                             |
| CC-014 | Claim renewal authorization          | `loop-b` attempts to renew `loop-a`’s unexpired claim using another token                                                                                                            | Renewal is rejected and the original expiration time is unchanged.                                                                    |
| CC-015 | Release retry isolation              | Owner releases claim with `release-1`; a new owner acquires; former owner retries `release-1`                                                                                        | Retry returns the original release outcome and does not release or alter the new owner’s claim.                                       |
| CC-016 | No control-plane coupling            | Exercise initialization, claim, checkpoint, release, listing, and restart with network access unavailable                                                                            | All operations complete using repository-local state and make no ADO, GitHub, MCP, CLI, agent, sandbox, or git call.                  |

## Success Criteria

- **SC-001:** In restart testing, 100% of acknowledged mutations are recovered with the same work-item ID, revision, phase, status, execution references, cursors, and transition history.
- **SC-002:** Across at least 1,000 repeated simultaneous two-owner claim trials, exactly one active claim is produced per work item in every trial.
- **SC-003:** In stale-owner testing, 0% of mutations using a superseded token or fencing value alter durable state.
- **SC-004:** Every injected interrupted-write case recovers either the complete previous revision or the complete new revision; no malformed mixed revision is observable.
- **SC-005:** A coordinator can open and identify resumable state among 1,000 records within one second on a typical developer workstation.
- **SC-006:** 100% of malformed, unsupported-version, or corrupt record fixtures produce explicit structured errors and are never silently reset.
- **SC-007:** Retrying an accepted operation identifier 100 times produces one durable revision and one corresponding transition.
- **SC-008:** An operator can determine the current phase, status, claim owner/expiry, branch, worktree, active agent/session, pull request, and last-seen cursors from one record without inspecting agent-session contents.
- **SC-009:** Deterministic tests complete without live ADO, GitHub, MCP, network, Azure CLI, Azure DevOps CLI, sandbox, agent-provider, or git dependencies.

## Assumptions

- **Repository scope:** One ledger belongs to one host repository, and work-item identifiers are unique within that repository’s configured tracker. **Owner:** DevSquad host integration.
- **Concurrency boundary:** Concurrent coordinators share the same repository filesystem; cross-machine coordination without shared filesystem semantics is outside this slice. **Owner:** Sandcastle/DevSquad deployment owner.
- **Lifecycle authority:** The DevSquad host supplies semantically valid phase and status values and decides which transition should occur. **Owner:** DevSquad.
- **Operation identity:** The host can generate a stable unique operation identifier and reuse it when retrying an ambiguous mutation. **Owner:** DevSquad host integration.
- **Time basis:** Persisted timestamps use UTC, while tests control the accepted current time deterministically. **Owner:** Sandcastle planning.
- **Target workload:** A repository contains no more than 1,000 active or resumable workflow records under normal use. **Owner:** Product maintainer.
- **Session references:** Agent session identifiers are stable references supplied by existing Sandcastle execution results; the ledger does not validate or move session contents. **Owner:** Agent provider and execution adapter.

## Dependencies and ADR Alignment

- **ADR-0007 — Worktree locking:** Provides precedent for atomic host-side ownership and stale-process recovery. Workflow claims require separate semantics because they need leases, renewals, idempotency, and fencing.
- **ADR-0012 — Agent-provider-owned session storage:** The ledger stores session identifiers only and does not assume a session file format or location.
- **ADR-0017 — Sandbox-owned sync base:** Resume metadata must not replace or reinterpret sandbox synchronization bookkeeping.
- **ADR-0021 — ADO feedback-loop control-plane boundary:** The ledger remains independent of live ADO, MCP, network, CLI, and secrets.
- **ADR-0022 — ADO agent-team runner boundary:** The ledger may support a host coordinator or runner but does not execute agents or perform scheduling itself.
- **ADR-0024 — DevSquad Sandcastle execution adapter boundary:** DevSquad remains responsible for work-item and phase lifecycle; Sandcastle records execution references and checkpoints without taking ownership of intent.

## Technical Decisions Identified

| Decision                                                 | Status                                  | Impact                                                                                                                       |
| -------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Durable ledger ownership and boundary                    | Partially defined by ADR-0024           | A new ADR should establish that repository-local coordination checkpoints do not transfer lifecycle ownership to Sandcastle. |
| Atomic record persistence and interrupted-write recovery | Not defined                             | Requires planning and likely an ADR because durability behavior is externally observable.                                    |
| Lease, fencing, renewal, and takeover semantics          | Not defined; ADR-0007 is only analogous | Requires an ADR to prevent incompatible claim implementations.                                                               |
| Schema evolution and unsupported-version behavior        | Required by this specification          | Planning must define compatibility and migration policy before public release.                                               |
| DevSquad phase legality                                  | Defined outside Sandcastle by ADR-0024  | No Sandcastle phase-transition table may be introduced.                                                                      |
| Agent-session data ownership                             | Defined by ADR-0012                     | Only identifiers may enter the ledger.                                                                                       |
| Live work-tracker integration                            | Defined outside Sandcastle by ADR-0021  | Core ledger tests and APIs remain offline and injected at external boundaries.                                               |
