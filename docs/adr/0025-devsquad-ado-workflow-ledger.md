# ADR-0025: DevSquad/ADO workflow ledger is an offline fenced coordination checkpoint

## Status

Proposed

## Priorities

1. Preserve DevSquad ownership of lifecycle meaning, gates, scheduling, and external work-item operations.
2. Recover every acknowledged local checkpoint after process interruption.
3. Prevent concurrent or stale coordinators from mutating the same workflow record.
4. Fail closed without erasing corrupt or unsupported evidence.
5. Keep Sandcastle core offline, tracker-neutral, and free of execution/control-plane coupling.
6. Protect claim capabilities and bound filesystem, storage, and recovery costs.

## Context

ADR-0024 defines the DevSquad Sandcastle execution adapter as a one-task execution boundary. DevSquad or its host owns work-item discovery, selection, claiming, watching, phase transitions, scheduling, approval gates, and pull-request authority.

A host coordinator still needs a durable repository-local checkpoint between those external decisions and Sandcastle execution. Without one, a restart can lose branch, worktree, session, pull-request, cursor, or transition context. Multiple coordinator processes can also race to update the same checkpoint.

The term “claim” creates an apparent conflict with ADR-0024. An external work-item claim selects or assigns work through DevSquad or ADO/GitHub. A ledger claim is narrower: it grants temporary authority to mutate one repository-local record. The execution adapter does not acquire ledger claims automatically.

Claim tokens, filesystem paths, and persistent histories also introduce security and availability constraints. The design must not expose a claim token through read/list APIs, rely on an unkeyed checksum as tamper protection, or permit unbounded generation growth.

## Decision

### Responsibility boundary

Sandcastle will expose an offline repository-local workflow ledger primitive.

DevSquad or the host remains responsible for:

- work-item discovery, selection, assignment, and external claiming;
- interpreting phase and status values;
- deciding transition legality and the next lifecycle state;
- scheduling implementers;
- reconciling local checkpoints with ADO or GitHub;
- approval gates, pull-request completion, and merge authority.

The ledger:

- records structurally valid caller-supplied phase and status values;
- performs exact expected-state and revision comparisons;
- has no phase allowlist, ordering, transition table, terminal-state concept, or merge-readiness logic;
- never initiates external work-item, pull-request, comment, agent, sandbox, shell, or git operations.

A **ledger claim** is only an exclusive local right to mutate one ledger aggregate. It is not an ADO/GitHub work-item claim and does not transfer lifecycle ownership from DevSquad.

### Repository identity and location

Opening a ledger requires an explicit host repository root. The ledger never invokes git or infers the root from the current worktree.

The root is:

```text
<canonical-host-repository-root>/.sandcastle/devsquad-ado/
```

The caller must pass the same host root from the main checkout and every worktree.

Canonical work-item identity is case-sensitive. Numeric safe integers use canonical decimal form; strings must be NFC-normalized, nonblank, and within the documented byte limit. Raw identifiers never enter filesystem paths. A storage key is:

```text
wi-<lowercase SHA-256 of canonical UTF-8 work-item ID>
```

Every record embeds the canonical ID, and reads verify that its digest matches its directory.

### Atomic aggregate

Workflow state, revision, transition history, claim metadata, fencing counter, and idempotency receipts form one atomic aggregate.

Schema v1 uses:

```text
.sandcastle/devsquad-ado/
  ledger.json
  records/
    wi-<digest>/
      <16-digit-revision>.json
      .<operation-digest>.<nonce>.tmp
```

A mutation:

1. Validates the input and current highest committed generation.
2. Checks idempotency before revision, state, expiry, or authorization checks.
3. Builds a complete next generation in memory.
4. Writes a same-directory candidate with exclusive creation.
5. Flushes, closes, reopens, and validates the candidate.
6. Publishes it by atomically creating an exclusive hard link at the next revision filename.
7. Flushes the required file and directory metadata.
8. Reopens and verifies the committed artifact.
9. Acknowledges success only after durability and integrity verification.

The exclusive hard link is the compare-and-publish linearization point. `EEXIST` means another process published that revision first; the loser rereads and resolves replay, conflict, or a bounded retry.

Candidates and final generations must be regular, non-reparse files on the same verified filesystem with expected identity and link counts. Unsupported hard-link or durability semantics fail closed.

Superseded complete generations may be pruned only after a newer generation is durable. Recovery never promotes a temporary file or falls back from a corrupt highest committed revision. Leftover generations and candidates remain diagnostic evidence.

### Durability scope and filesystem trust

The guarantee covers acknowledged writes across process termination and normal restart on a supported local filesystem. It does not claim distributed coordination or unconditional power-loss protection beyond the platform’s confirmed flush semantics.

The security boundary is a local repository and ledger writable only by the trusted repository owner:

- POSIX directories and files use and verify owner-only modes.
- Windows repository ACLs must exclude untrusted writers; an implementation unable to establish the required permission/capability state returns an unsupported-permissions or unsupported-filesystem error.
- Network shares, synchronized filesystems, elevated execution over a repository writable by a lower-privileged principal, hostile same-identity processes, administrators, and compromised hosts are outside the supported threat model.
- `.gitignore` prevents accidental commits but is not access control.

Path checks reject symlinks, junctions, reparse points, non-regular artifacts, unexpected hard links, and containment changes. Where handle-relative no-follow operations are unavailable, the same-user trust constraint is normative.

### Claim secrecy and authorization

The caller supplies a canonical unpadded base64url token decoding to exactly 32 cryptographically random bytes.

Only the acquisition result returns `ClaimAuthority`, containing the caller-held token. Persisted state stores only `SHA-256(token)` as a verifier.

Read, list, recovery, conflict, renewal, release, and checkpoint projections expose token-free `ClaimMetadata`. Plaintext tokens, verifiers, request payloads, and reconstructed authority must not appear in snapshots, receipts, logs, telemetry, errors, or diagnostics.

Authorization compares verifiers in constant time. Owner ID is diagnostic identity; the token is the capability. Idempotent acquisition replay requires the original token and binds work-item ID, operation ID, operation kind, and normalized request digest.

### Lease and fencing rules

- A record must exist before it can be claimed.
- Initialization does not require a claim.
- Checkpoint, renewal, and release require the current unexpired claim authority.
- Expiry is inclusive: `now >= expiresAt` means expired.
- The injected UTC clock is read once per operation.
- Every successful acquisition increments the persistent fencing counter, including acquisition after release or expiry.
- Renewal preserves fencing and sets expiration from accepted renewal time.
- Release clears only the active claim and preserves the fencing counter and record history.
- Stale fencing is checked before token/owner authorization.
- A taken-over, expired, or released owner cannot mutate, renew, or release later state.
- Idempotent release replay is resolved before inspecting a later active claim.

Fencing protects ledger mutations only. It does not make ADO/GitHub side effects exactly once.

### Idempotency

Every mutation requires a caller-supplied operation ID.

Accepted operations store:

- operation ID and kind;
- a versioned digest of the normalized semantic request;
- accepted revision and timestamp;
- a token-free operation outcome sufficient to replay the result.

Operation IDs are scoped to one work item across operation kinds. An identical retry returns the original accepted revision without mutation. Different reuse returns `idempotency-conflict`. Rejected operations create no receipt.

Schema v1 does not silently evict receipts. Reaching a capacity ceiling fails closed. Compaction, rollover, archival, or receipt eviction requires a later explicit migration decision.

### Schema and recovery

Schema v1 is strict:

- unknown fields are rejected;
- missing, malformed, impossible, or future versions fail closed;
- reads do not migrate or repair data;
- unsupported or corrupt records cannot be checkpointed, claimed, or reset through normal APIs;
- a corrupt record is isolated from other valid records during listing;
- checksum and digest-chain validation detect accidental corruption only; filesystem permissions are the tamper boundary.

Normal listing returns every valid initialized record. Sandcastle does not infer resumability from phase or status names. The DevSquad host decides which records are semantically resumable.

### Bounds

Schema v1 enforces before proportional allocation:

- 10,000 records per ledger;
- 20,000 operation receipts per record;
- 10,000 checkpoints per record;
- 10,000 agent activations and 10,000 session activations per record;
- 16 MiB maximum committed generation;
- 64 generation/candidate entries per record directory;
- 100,000 artifacts per deep recovery scan;
- 32 compare-and-publish retries;
- 24-hour maximum claim lease.

Limit failures use distinct `capacity-exceeded`, `scan-limit`, or `contention` errors.

### Data minimization and diagnostics

PR identifiers and observation cursors are bounded opaque strings. A PR cursor is either absent or contains both thread and comment identifiers.

PR URLs must be absolute HTTP(S) URLs without user information, query strings, or fragments. The ledger accepts no generic metadata/body field.

Unknown fields and fields containing credentials, external bodies, prompts, or session contents are rejected before artifact creation.

Errors and recovery diagnostics use stable categories and paths relative to `.sandcastle/devsquad-ado/`. They never include claim tokens, token verifiers, operation payloads, raw JSON, credential-bearing URLs, external bodies, or unredacted operating-system messages containing caller data.

## Alternatives Considered

### Mutable snapshots plus PID transaction locks

Rejected because lock recovery introduces PID reuse and stale-lock races and conflates process-liveness locking with workflow leases. Immutable generation publication provides a clearer compare-and-publish point.

### Append-only journal

Rejected because torn-tail recovery, replay, checksums, framing, compaction, and snapshot coordination add complexity beyond the target workload.

### SQLite

Rejected because it adds a database/native dependency, creates a broader corruption blast radius, and complicates direct per-record diagnosis.

### Store state only in ADO or GitHub

Rejected because it violates offline operation and couples recovery to credentials, network availability, tracker semantics, and rate limits.

### Make Sandcastle lifecycle-aware

Rejected because phase interpretation, completion rules, scheduling, and transition legality belong to DevSquad.

## Consequences

- The host gains restart-safe local coordination without moving lifecycle authority into Sandcastle.
- Claims and checkpoints are serialized by atomic generation publication and protected by fencing.
- Lost responses can be resolved through durable idempotency receipts.
- Claim tokens are never disclosed through read-oriented APIs or stored in plaintext.
- Unsupported filesystems and insecure permission configurations fail closed rather than receiving weaker guarantees.
- Storage is inspectable but deliberately bounded.
- Future schema migration, receipt compaction, or distributed coordination requires another explicit decision.
- The execution adapter, ADO control plane, agent providers, sandbox synchronization, and worktree locks retain their existing responsibilities.

## References

- `docs/adr/0007-worktree-locking.md`
- `docs/adr/0012-agent-provider-owned-session-storage.md`
- `docs/adr/0017-sandbox-owned-sync-base-ref.md`
- `docs/adr/0021-ado-feedback-loop-control-plane-boundary.md`
- `docs/adr/0022-ado-agent-team-runner-boundary.md`
- `docs/adr/0024-devsquad-sandcastle-execution-adapter-boundary.md`
- `docs/features/devsquad-ado-workflow-ledger/spec.md`
