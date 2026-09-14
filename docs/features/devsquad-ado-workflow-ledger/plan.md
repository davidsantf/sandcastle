# Persistent DevSquad/ADO Workflow Ledger Implementation Plan

## Summary

Implement an Effect-backed, Effect-free-at-the-public-boundary workflow ledger under `.sandcastle/devsquad-ado/`.

The ledger stores one logical aggregate per canonical work-item ID and exposes typed operations for initialization, reading, listing checkpoint candidates, checkpointing, claims, renewal, release, and recovery inspection.

The implementation follows [ADR-0025](../../adr/0025-devsquad-ado-workflow-ledger.md). It also preserves ADRs 0007, 0012, 0017, 0021, 0022, and 0024.

## Architectural Boundary

### DevSquad and host responsibilities

- Discover, select, assign, and externally claim work items.
- Define phase and status meaning.
- Decide whether a lifecycle transition is permitted.
- Schedule implementers and call the execution adapter.
- Read and write ADO/GitHub state.
- Approve, complete, or merge pull requests.
- Generate stable operation IDs and secure claim tokens.

### Ledger responsibilities

- Store structurally valid caller-supplied phase and status values.
- Compare expected revision, phase, and status exactly.
- Persist execution references and opaque external cursors.
- Serialize local record mutations.
- Enforce lease, token-verifier, and fencing checks.
- Recover acknowledged local state after restart.
- Report corruption and unsupported storage without repairing evidence.

### Explicit non-responsibilities

The ledger will not import or invoke ADO, GitHub, MCP, HTTP, CLI, git, agent, sandbox, shell, scheduler, team-runner, feedback-loop, or execution-adapter implementations.

It will not define a phase allowlist, phase order, state-transition graph, completed phase, merge-ready state, or resumability policy.

## Implementation Surfaces

### New source files

| File                                                 | Responsibility                                                                                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/DevSquadAdoWorkflowLedger.ts`                   | Effect-free public contracts, factory, result mapping, and JSDoc.                                                                                 |
| `src/DevSquadAdoWorkflowLedgerSchema.ts`             | Strict schema-v1 validation, canonical request serialization, integrity digests, work-item canonicalization, and public projection.               |
| `src/DevSquadAdoWorkflowLedgerStorage.ts`            | Effect implementation for opening, reading, immutable-generation publication, recovery, claims, fencing, idempotency, and bounds.                 |
| `src/DevSquadAdoWorkflowLedgerPlatform.ts`           | Internal filesystem capability, permission, hard-link, file-sync, directory-sync, no-follow, and artifact-identity boundary.                      |
| `src/DevSquadAdoWorkflowLedger.test.ts`              | Public behavior, validation, checkpoint, listing, history, cursor, idempotency, and restart cases.                                                |
| `src/DevSquadAdoWorkflowLedger.concurrency.test.ts`  | Claims, contention, expiry, fencing, renewal, release isolation, and retry bounds.                                                                |
| `src/DevSquadAdoWorkflowLedger.recovery.test.ts`     | Interrupted publication, corrupt generations, future schemas, integrity, limits, and fail-closed recovery.                                        |
| `src/DevSquadAdoWorkflowLedger.path.test.ts`         | POSIX/Windows identifiers, symlinks, junctions, reparse points, sibling-prefix escapes, artifact swaps, permissions, and unsupported filesystems. |
| `src/DevSquadAdoWorkflowLedger.dependencies.test.ts` | Static dependency assertion preventing control-plane and execution coupling.                                                                      |
| `src/DevSquadAdoWorkflowLedgerTestSupport.ts`        | Shared test runtime, deterministic clock, and persistence-fault helpers.                                                                          |
| `src/DevSquadAdoWorkflowLedger.child-process.ts`     | Child-process fixture for cross-process claim contention tests.                                                                                   |

### Modified files

| File                                           | Change                                                                                                                                             |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                                 | Export the factory and Effect-free public ledger contracts.                                                                                        |
| `src/InitService.ts`                           | Ignore local `devsquad-ado` runtime state and clarify that ignore rules are not access control.                                                    |
| `src/InitService.test.ts`                      | Verify scaffolded ignore rules include `devsquad-ado` and the access-control clarification.                                                        |
| `.sandcastle/.gitignore`                       | Add `devsquad-ado`; document that this is not access control.                                                                                      |
| `README.md`                                    | Document explicit host-root use, offline behavior, claim/checkpoint sequence, token handling, storage path, failure modes, and lifecycle boundary. |
| `.changeset/offline-fenced-workflow-ledger.md` | Add one nonduplicate minor changeset for the public feature.                                                                                       |

No new subpath export is required. Public imports continue through `@ai-hero/sandcastle`.

## Public API

All public functions and properties receive JSDoc. No public declaration may import `effect` or `@effect/*`.

```ts
export type DevSquadAdoWorkItemId = string | number;

export interface OpenDevSquadAdoWorkflowLedgerInput {
  readonly repositoryRoot: string;
}

export type DevSquadAdoLedgerResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: DevSquadAdoLedgerError };

export interface DevSquadAdoClaimMetadata {
  readonly workItemId: string;
  readonly ownerId: string;
  readonly fencingValue: number;
  readonly acquiredAt: string;
  readonly heartbeatAt: string;
  readonly expiresAt: string;
}

export interface DevSquadAdoClaimAuthority extends DevSquadAdoClaimMetadata {
  readonly claimToken: string;
}

export interface DevSquadAdoWorkflowRecord {
  readonly schemaVersion: 1;
  readonly workItemId: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly phase: string;
  readonly status: string;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly agent: DevSquadAdoReferenceHistory;
  readonly session: DevSquadAdoReferenceHistory;
  readonly pullRequest: DevSquadAdoPullRequestReference;
  readonly observations: DevSquadAdoObservationCursors;
  readonly checkpoints: readonly DevSquadAdoCheckpointEntry[];
  readonly activeClaim: DevSquadAdoClaimMetadata | null;
  readonly fencingCounter: number;
}

export interface DevSquadAdoMutationSuccess<TOutcome> {
  readonly acceptedRevision: number;
  readonly acceptedAt: string;
  readonly replayed: boolean;
  readonly outcome: TOutcome;
  readonly record: DevSquadAdoWorkflowRecord;
}
```

Operation inputs:

```ts
export interface InitializeDevSquadAdoWorkflowRecordInput {
  readonly workItemId: DevSquadAdoWorkItemId;
  readonly operationId: string;
  readonly phase: string;
  readonly status: string;
  readonly branch?: string;
  readonly worktreePath?: string;
  readonly agentId?: string;
  readonly sessionId?: string;
  readonly pullRequest?: {
    readonly id?: string;
    readonly url?: string;
  };
  readonly observations?: {
    readonly workItemCommentId?: string;
    readonly pullRequest?: {
      readonly threadId: string;
      readonly commentId: string;
    };
  };
}

export interface AcquireDevSquadAdoWorkflowClaimInput {
  readonly workItemId: DevSquadAdoWorkItemId;
  readonly operationId: string;
  readonly ownerId: string;
  readonly claimToken: string;
  readonly leaseDurationMs: number;
}

export interface RenewDevSquadAdoWorkflowClaimInput {
  readonly workItemId: DevSquadAdoWorkItemId;
  readonly operationId: string;
  readonly authority: {
    readonly ownerId: string;
    readonly claimToken: string;
    readonly fencingValue: number;
  };
  readonly leaseDurationMs: number;
}

export interface ReleaseDevSquadAdoWorkflowClaimInput {
  readonly workItemId: DevSquadAdoWorkItemId;
  readonly operationId: string;
  readonly authority: {
    readonly ownerId: string;
    readonly claimToken: string;
    readonly fencingValue: number;
  };
}

export interface CheckpointDevSquadAdoWorkflowInput {
  readonly workItemId: DevSquadAdoWorkItemId;
  readonly operationId: string;
  readonly authority: {
    readonly ownerId: string;
    readonly claimToken: string;
    readonly fencingValue: number;
  };
  readonly expected: {
    readonly revision: number;
    readonly phase: string;
    readonly status: string;
  };
  readonly patch: {
    readonly phase?: string;
    readonly status?: string;
    readonly branch?: string | null;
    readonly worktreePath?: string | null;
    readonly agentId?: string | null;
    readonly sessionId?: string | null;
    readonly pullRequest?: {
      readonly id?: string | null;
      readonly url?: string | null;
    };
    readonly observations?: {
      readonly workItemCommentId?: string | null;
      readonly pullRequest?: {
        readonly threadId: string;
        readonly commentId: string;
      } | null;
    };
  };
}
```

Ledger handle:

```ts
export interface DevSquadAdoWorkflowLedger {
  readonly initializeRecord: (
    input: InitializeDevSquadAdoWorkflowRecordInput,
  ) => Promise<
    DevSquadAdoLedgerResult<
      DevSquadAdoMutationSuccess<{
        readonly kind: "initialized";
      }>
    >
  >;

  readonly readRecord: (
    workItemId: DevSquadAdoWorkItemId,
  ) => Promise<DevSquadAdoLedgerResult<DevSquadAdoWorkflowRecord>>;

  readonly listResumableRecords: () => Promise<
    DevSquadAdoLedgerResult<{
      readonly records: readonly DevSquadAdoWorkflowRecord[];
      readonly recoveryErrors: readonly DevSquadAdoRecoveryError[];
    }>
  >;

  readonly checkpoint: (input: CheckpointDevSquadAdoWorkflowInput) => Promise<
    DevSquadAdoLedgerResult<
      DevSquadAdoMutationSuccess<{
        readonly kind: "checkpointed";
        readonly checkpoint: DevSquadAdoCheckpointEntry;
      }>
    >
  >;

  readonly acquireClaim: (
    input: AcquireDevSquadAdoWorkflowClaimInput,
  ) => Promise<
    DevSquadAdoLedgerResult<
      DevSquadAdoMutationSuccess<{
        readonly kind: "claim-acquired";
        readonly authority: DevSquadAdoClaimAuthority;
      }>
    >
  >;

  readonly renewClaim: (input: RenewDevSquadAdoWorkflowClaimInput) => Promise<
    DevSquadAdoLedgerResult<
      DevSquadAdoMutationSuccess<{
        readonly kind: "claim-renewed";
        readonly claim: DevSquadAdoClaimMetadata;
      }>
    >
  >;

  readonly releaseClaim: (
    input: ReleaseDevSquadAdoWorkflowClaimInput,
  ) => Promise<
    DevSquadAdoLedgerResult<
      DevSquadAdoMutationSuccess<{
        readonly kind: "claim-released";
        readonly releasedClaim: {
          readonly ownerId: string;
          readonly fencingValue: number;
          readonly releasedAt: string;
        };
      }>
    >
  >;

  readonly inspectRecoveryErrors: () => Promise<
    DevSquadAdoLedgerResult<readonly DevSquadAdoRecoveryError[]>
  >;
}

export const openDevSquadAdoWorkflowLedger: (
  input: OpenDevSquadAdoWorkflowLedgerInput,
) => Promise<DevSquadAdoLedgerResult<DevSquadAdoWorkflowLedger>>;
```

Structured errors include:

- `validation`
- `repository-not-found`
- `repository-not-directory`
- `path-boundary`
- `unsupported-filesystem`
- `unsupported-permissions`
- `record-not-found`
- `record-already-exists`
- `claim-conflict`
- `claim-not-held`
- `claim-expired`
- `stale-fencing`
- `claim-authorization`
- `revision-conflict`
- `state-conflict`
- `idempotency-conflict`
- `corrupt-artifact`
- `unsupported-schema-version`
- `capacity-exceeded`
- `scan-limit`
- `contention`
- `storage`, with outcome `unchanged` or `indeterminate`

No caller must parse message text.

## Validation Rules

| Value                            | Rule                                                                                                                                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work-item ID                     | Number must be a nonnegative safe integer. String must be NFC-normalized, nonblank, 1–120 UTF-8 bytes, and contain no slash, backslash, NUL, control character, or line/paragraph separator. |
| Phase/status                     | Nonblank after whitespace inspection, no control characters, at most 256 UTF-8 bytes. Preserve exact accepted value; do not interpret it.                                                    |
| Operation/owner/agent/session ID | Nonblank, no control characters, at most 256 UTF-8 bytes.                                                                                                                                    |
| Claim token                      | Canonical unpadded base64url decoding to exactly 32 bytes.                                                                                                                                   |
| Branch                           | Nonblank when present, no control characters, at most 1,024 UTF-8 bytes.                                                                                                                     |
| Worktree path                    | Absolute POSIX, Windows drive, or UNC path; nonblank, no NUL, at most 4,096 UTF-8 bytes. Store only; do not access it.                                                                       |
| PR ID                            | Opaque nonblank string, at most 1,024 UTF-8 bytes.                                                                                                                                           |
| PR URL                           | Absolute HTTP(S), at most 4,096 bytes, no username, password, query, or fragment. ID and URL remain independently optional.                                                                  |
| Cursor                           | Each opaque component is nonblank and at most 1,024 bytes. PR cursor requires both thread and comment IDs.                                                                                   |
| Revision                         | Positive safe integer.                                                                                                                                                                       |
| Lease                            | Positive safe integer milliseconds, no more than 86,400,000.                                                                                                                                 |
| Checkpoint patch                 | Must contain at least one recognized field. Equal values still produce an accepted metadata checkpoint.                                                                                      |
| Unknown keys                     | Reject at every public and persisted object boundary.                                                                                                                                        |
| Timestamp                        | Generated internally as strict UTC ISO milliseconds from one injected clock read.                                                                                                            |

Validation completes before any work-item-specific directory or candidate artifact is created.

## Schema-v1 Storage Format

`ledger.json`:

```json
{
  "kind": "devsquad-ado-workflow-ledger",
  "schemaVersion": 1,
  "createdAt": "2026-09-08T16:58:24.105Z"
}
```

Each committed generation is strict canonical JSON with:

```ts
interface PersistedDevSquadAdoWorkflowRecordV1 {
  readonly kind: "devsquad-ado-workflow-record";
  readonly schemaVersion: 1;
  readonly workItemId: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly workflow: {
    readonly phase: string;
    readonly status: string;
  };
  readonly execution: {
    readonly branch: string | null;
    readonly worktreePath: string | null;
    readonly agent: PersistedReferenceHistoryV1;
    readonly session: PersistedReferenceHistoryV1;
  };
  readonly pullRequest: {
    readonly id: string | null;
    readonly url: string | null;
  };
  readonly observations: {
    readonly workItemCommentId: string | null;
    readonly pullRequest: {
      readonly threadId: string;
      readonly commentId: string;
    } | null;
  };
  readonly checkpoints: readonly PersistedCheckpointV1[];
  readonly claim: {
    readonly fencingCounter: number;
    readonly active: {
      readonly ownerId: string;
      readonly tokenVerifier: string;
      readonly fencingValue: number;
      readonly acquiredAt: string;
      readonly heartbeatAt: string;
      readonly expiresAt: string;
    } | null;
  };
  readonly operations: readonly PersistedOperationReceiptV1[];
  readonly previousGenerationDigest: string | null;
  readonly integrity: {
    readonly algorithm: "sha256";
    readonly digest: string;
  };
}
```

The plaintext claim token is never persisted. Acquisition receipts store only token-free claim metadata. Request fingerprints are SHA-256 digests of normalized, versioned semantic requests.

Invariants:

- Generation filename equals the zero-padded revision.
- Revision 1 is initialization.
- Every accepted non-replayed mutation adds exactly one revision and receipt.
- Operation IDs are unique within a work item.
- Checkpoint revisions are unique and strictly increasing.
- `updatedAt` equals the last accepted receipt timestamp.
- Agent/session changes append activation history; clearing a current value does not erase history.
- `active.fencingValue <= fencingCounter`.
- The embedded work-item ID hashes to the containing directory.
- The integrity digest covers canonical JSON excluding the `integrity` property.
- Digests detect accidental corruption, not malicious same-user modification.

## Atomic Publication Algorithm

For current revision `N`:

1. Resolve and validate the canonical record directory without following links.
2. Read and strictly validate the highest committed generation.
3. Check operation ID and request digest first.
4. Evaluate claim, fence, revision, state, expiry, and capacity rules.
5. Build complete generation `N + 1`.
6. Serialize deterministic canonical JSON plus one trailing newline.
7. Create a unique same-directory candidate using exclusive creation.
8. Write completely, handling short writes.
9. Sync and close the candidate.
10. Reopen and validate its size, type, device, identity, schema, digest, and bytes.
11. Hard-link it to absent `<N+1>.json`.
12. Treat successful linking as the compare-and-publish linearization point.
13. On `EEXIST`, reread:
    - return replay if the same operation won;
    - return semantic conflict when appropriate;
    - retry only eligible claim operations, up to 32 attempts.
14. Flush the final file and directory metadata according to verified platform capabilities.
15. Reopen and verify final type, device, inode/file identity, link count, revision, digest, and exact bytes.
16. Remove the candidate and sync cleanup metadata.
17. Return success only after durability verification.
18. Best-effort prune superseded complete generations only after the new one is durable.

Failure before publication returns storage outcome `unchanged`. Failure after publication but before durability confirmation returns `indeterminate`; the caller retries the exact operation and token using the same operation ID.

## Claim Algorithm

### Acquire

1. Require an initialized record.
2. Resolve idempotency before current-claim checks.
3. Read `now` once.
4. If `active.expiresAt > now`, return token-free `claim-conflict`.
5. Otherwise increment `fencingCounter`.
6. Verify the caller-supplied token and persist only its SHA-256 verifier.
7. Set acquisition, heartbeat, and expiry timestamps.
8. Publish the next revision atomically.
9. Return the caller-held token only in `ClaimAuthority`.

Expiry is inclusive: takeover is permitted at `now >= expiresAt`.

### Checkpoint

After idempotency lookup:

1. Require an active, unexpired claim.
2. Compare fencing values first.
3. Compare the supplied token verifier in constant time.
4. Verify owner ID without treating it as the capability.
5. Compare expected revision.
6. Compare expected phase and status exactly.
7. Apply the patch without lifecycle interpretation.
8. Append activation and checkpoint history.
9. Publish exactly one revision.

A lost compare-and-publish race returns a revision conflict rather than rebasing the caller’s lifecycle decision.

### Renew

1. Resolve idempotency first.
2. Require an active, unexpired current fence.
3. Verify token and owner.
4. Preserve acquisition time and fencing.
5. Set heartbeat to accepted `now`.
6. Set expiry to `now + leaseDurationMs`.
7. Publish one revision.
8. Retry only while the same authority remains current and within the 32-attempt bound.

### Release

1. Resolve idempotency before inspecting the current claim.
2. Require an active, unexpired current fence for a new release.
3. Verify token and owner.
4. Persist a token-free release receipt.
5. Clear the active claim while preserving the fencing counter.
6. Publish one revision.

An old release retry returns its original accepted outcome and latest public record without inspecting or clearing a later claim.

## Restart and Recovery

Opening validates the manifest, filesystem capabilities, permissions, root containment, and directory structure.

For each record:

1. Reject symlink, junction, reparse, non-directory, and unexpected artifacts.
2. Enforce entry and file-size limits before parsing.
3. Identify the numerically highest committed generation.
4. Require valid schema, work-item identity, revision filename, semantic invariants, and integrity.
5. Never fall back to a lower revision when the highest committed generation is corrupt.
6. Never promote a temporary candidate.
7. Report leftover candidates and superseded generations as deterministic relative-path warnings.
8. Preserve all corrupt artifacts unchanged.

`readRecord` fails for a corrupt target. `listResumableRecords` returns every valid initialized record and isolated recovery errors for invalid records. It does not filter phases or statuses.

`inspectRecoveryErrors` performs a bounded, read-only deep scan in deterministic artifact-path order.

## Security Controls

- No plaintext claim token in storage, receipts, records, listing, conflicts, recovery output, logs, or diagnostics.
- Constant-time token-verifier comparison.
- Token reference lifetime minimized after verification.
- Explicit local same-user filesystem trust boundary.
- Fail closed on unsupported permission, no-follow, hard-link, or durability capabilities.
- Reject symlinks, junctions, reparse points, non-regular files, unexpected links, and path identity swaps.
- Verify candidate and final artifact identity before and after publication.
- Reject credential-bearing PR URLs and unknown metadata/body fields.
- Bound inputs, snapshots, histories, directory entries, scans, leases, and retry loops.
- Redact caller data and operating-system error text from stable structured diagnostics.
- Capture-based tests search diagnostics for token values, URL credentials, external-body markers, and raw JSON.
- Static dependency tests reject control-plane and execution imports.
- `.sandcastle/devsquad-ado` is ignored by git, but gitignore is not treated as confidentiality.

## Requirement Traceability

| Requirements | Implementation                                                                            | Tests                                                      |
| ------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| FR-001–003   | Explicit repository root, fixed ledger path, hashed record directory, schema-v1 aggregate | API restart and path tests                                 |
| FR-004–011   | Workflow/execution/PR/cursor fields, activation history, revision-keyed checkpoints       | Public round-trip and history tests                        |
| FR-012–015   | Structural strings and exact expected-state checks; no lifecycle policy or external calls | Unknown-phase and dependency tests                         |
| FR-016–022   | Ledger handle, structured result/error unions, strict validation, root exports            | Public import, validation, build, and Effect-leak tests    |
| FR-023–024   | Candidate sync, hard-link publication, durability barrier, immutable generation           | Fault-point recovery tests                                 |
| FR-025–029   | Storage-only opening, isolated recovery errors, no repair, durable operation receipts     | Offline restart, corruption, and idempotency tests         |
| FR-030–035   | Exclusive next-generation publication, lease expiry, monotonic acquisition fence          | 1,000 contention trials and takeover tests                 |
| FR-036–042   | Authority inputs, fence-first checks, renewal/release rules, distinct errors              | Stale-owner, unauthorized renewal, release-isolation tests |
| FR-043–046   | Opaque bounded cursors through checkpoint aggregate                                       | Cursor restart and no-order-inference tests                |

## Invariant Traceability

| Invariant | Enforcement                                                         | Test                               |
| --------- | ------------------------------------------------------------------- | ---------------------------------- |
| INV-001   | Immutable embedded identity plus hashed directory verification      | Identity mismatch fixtures         |
| INV-002   | One generation and receipt per accepted mutation                    | Revision and retry tests           |
| INV-003   | One authoritative `claim.active` in highest generation              | Contention tests                   |
| INV-004   | Persistent increasing fence and fence-first validation              | Takeover/stale-owner tests         |
| INV-005   | Acknowledge after durability barrier                                | Restart fault matrix               |
| INV-006   | Complete immutable generation publication                           | Interrupted-write fixtures         |
| INV-007   | Append-only checkpoint/reference histories in the current aggregate | Restart history tests              |
| INV-008   | No phase/status policy beyond structure and equality                | `custom-security-gate` test        |
| INV-009   | Storage-only dependency graph                                       | Static dependency test             |
| INV-010   | Session identifiers only                                            | Strict schema and projection tests |
| INV-011   | No repair, fallback, promotion, or reset                            | Corruption recovery tests          |
| INV-012   | Operation receipt lookup before mutable-state checks                | Retry and release-isolation tests  |

## Conformance Test Matrix

| Case   | Test                                                                                        |
| ------ | ------------------------------------------------------------------------------------------- |
| CC-001 | Initialize, acquire, and checkpoint complete metadata; assert accepted revision/time.       |
| CC-002 | Reopen the same explicit repository root and compare the full public record.                |
| CC-003 | Run 1,000 synchronized two-owner acquisitions; assert exactly one authority each time.      |
| CC-004 | Advance controlled clock beyond expiry; assert higher fence and one active owner.           |
| CC-005 | Use former token/fence after takeover; assert no revision or field changes.                 |
| CC-006 | Submit stale revision and expected state; assert structured conflict and no generation.     |
| CC-007 | Checkpoint to `custom-security-gate`; assert acceptance without allowlist.                  |
| CC-008 | Submit unsafe ID, blank status, and malformed URL; assert no ID artifact.                   |
| CC-009 | Interrupt at every named persistence point and reopen; assert complete old or new revision. |
| CC-010 | Truncate/corrupt highest generation; assert fail closed and artifact preservation.          |
| CC-011 | Retry one operation 100 times; assert one accepted revision and checkpoint.                 |
| CC-012 | Reuse operation ID with changed request/token/kind; assert idempotency conflict.            |
| CC-013 | Round-trip three opaque cursors; assert no external body field exists.                      |
| CC-014 | Renew with wrong token/owner; assert unchanged expiry and revision.                         |
| CC-015 | Release, reacquire, retry old release; assert replay and preservation of new claim.         |
| CC-016 | Run complete flow with external capabilities absent; assert no external dependency.         |

## Success Verification

| Criterion | Verification                                                                                                                            |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| SC-001    | Equality assertions over all public fields after every acknowledged restart fixture.                                                    |
| SC-002    | 1,000 deterministic two-owner contention trials.                                                                                        |
| SC-003    | Zero state mutations across stale checkpoint, renewal, and release trials.                                                              |
| SC-004    | Fault matrix over candidate creation, write, sync, close, validation, link, durability, verification, cleanup, and pre-response points. |
| SC-005    | Timed listing of 1,000 valid local records under one second on a supported local filesystem.                                            |
| SC-006    | Fixture table for malformed JSON, unknown fields, impossible invariants, digest mismatch, identity mismatch, and future schema.         |
| SC-007    | 100 retries produce one receipt, one revision, and one checkpoint.                                                                      |
| SC-008    | One token-free public record exposes all operator recovery metadata.                                                                    |
| SC-009    | Test suite runs without ADO, GitHub, MCP, network, CLI, sandbox, agent, or git operations.                                              |

## Vertical Implementation Sequence

1. **Public contracts and strict validation**
   - Add Effect-free public types and structured errors.
   - Add canonical IDs, token validation, URL minimization, and request schemas.
   - RED→GREEN validation and unknown-phase tests.

2. **Ledger opening and path boundary**
   - Add explicit repository-root handling and ledger manifest.
   - Add hashed work-item paths and permission/capability checks.
   - RED→GREEN POSIX, Windows-path, symlink, junction, reparse, and swap tests.

3. **Initialization and reading**
   - Add schema-v1 aggregate, canonical JSON, integrity validation, and revision-one publication.
   - RED→GREEN initialization, read, invalid-data, and restart tests.

4. **Claim acquisition**
   - Add verifier-only token storage, expiry, fencing, and atomic contention handling.
   - RED→GREEN conflict, 1,000-race, expiry, and takeover tests.

5. **Checkpointing**
   - Add expected revision/state checks, execution metadata, activation history, cursors, and transition history.
   - RED→GREEN happy-path, stale-state, unknown-phase, and cursor tests.

6. **Renewal, release, and idempotency**
   - Add operation receipts and replay-before-authorization ordering.
   - RED→GREEN renewal authorization, 100 retries, operation conflict, and release-isolation tests.

7. **Recovery and limits**
   - Add bounded listing, deep inspection, interruption hooks, corruption categories, and fail-closed handling.
   - RED→GREEN fault-point, corrupt-generation, future-schema, disk-full, scan-limit, and capacity tests.

8. **Package integration**
   - Export through `src/index.ts`.
   - Add README documentation, `.sandcastle/.gitignore`, and a nonduplicate minor changeset.
   - Run public declaration Effect-leak and static dependency checks.

Every step ends with passing tests before refactoring or proceeding.

## Engineering Practices

| Practice         | Decision                                                                                               | Reference                   |
| ---------------- | ------------------------------------------------------------------------------------------------------ | --------------------------- |
| Public API       | Promise-based, discriminated results, JSDoc, no Effect declaration leakage                             | Repository coding standards |
| Internal effects | Effect services and tagged errors for filesystem, clock, persistence faults, and platform capabilities | Repository coding standards |
| Testing          | Colocated Vitest behavior tests through the public ledger API                                          | Repository coding standards |
| Security         | Verifier-only capabilities, strict minimization, redaction, fail-closed storage, bounded work          | ADR-0025                    |
| Release          | Minor changeset and README review for the new public behavior                                          | `AGENTS.md` / `CLAUDE.md`   |

## Commands

Executable validation commands:

### Focused tests

```text
npm test -- DevSquadAdoWorkflowLedger
```

### Full tests

```text
npm test
```

### Type checking

```text
npm run typecheck
```

### Build and public declaration validation

```text
npm run build
```

### Lint and formatting

```text
npm run format:check
```

### Diff validation

```text
git diff --check
```

### Local execution

This feature is a package API and has no standalone process. Exercise it through the focused Vitest suite:

```text
npm test -- DevSquadAdoWorkflowLedger
```

## Implementation Handoff

### Required artifacts

- `docs/features/devsquad-ado-workflow-ledger/spec.md`
- `docs/features/devsquad-ado-workflow-ledger/plan.md`
- `docs/adr/0025-devsquad-ado-workflow-ledger.md`

### Architectural assumptions

- Coordinators share one supported local repository filesystem.
- The caller supplies the canonical host repository root.
- The caller generates stable operation IDs and 32-byte base64url claim tokens.
- DevSquad supplies semantically valid lifecycle values.
- ADO/GitHub remains authoritative for external work tracking.
- Schema-v1 capacity ceilings are fail-closed boundaries.

### Discarded alternatives

- Lifecycle-aware filtering or transition tables.
- Reusing ADR-0007 worktree locks.
- Mutable records guarded by stale PID locks.
- SQLite.
- Append-only journals.
- Live tracker-backed storage.
- Plaintext persisted claim tokens.

### Implementation gate

ADR-0025 is Proposed. Implementation may proceed against it only while preserving its boundary and security controls; acceptance remains a separate review action.
