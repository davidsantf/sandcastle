<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://res.cloudinary.com/total-typescript/image/upload/v1775033787/readme-sandcastle-ondark_2x.png">
    <source media="(prefers-color-scheme: light)" srcset="https://res.cloudinary.com/total-typescript/image/upload/v1775033787/readme-sandcastle-onlight_2x.png">
    <img alt="Sandcastle" src="https://res.cloudinary.com/total-typescript/image/upload/v1775033787/readme-sandcastle-onlight_2x.png" height="200" style="margin-bottom: 20px;">
  </picture>
</div>

## What Is Sandcastle?

A TypeScript library for orchestrating AI coding agents in isolated sandboxes:

1. You invoke agents with a single `sandcastle.run()`.
2. Sandcastle handles sandboxing the agent with a configurable branch strategy.
3. The commits made on the branches get merged back.

Sandcastle is provider-agnostic — it ships with built-in providers for Docker, Podman, and Vercel, and you can create your own. Great for parallelizing multiple AFK agents, creating review pipelines, or even just orchestrating your own agents.

## Prerequisites

- [Git](https://git-scm.com/)
- A sandbox provider — Sandcastle needs an isolated environment to run agents in. Built-in options:
  - [Docker Desktop](https://www.docker.com/) — most common for local development
  - [Podman](https://podman.io/) — rootless alternative to Docker
  - [Vercel](https://vercel.com/) — cloud-based Firecracker microVMs via `@vercel/sandbox`
  - Or [create your own](#custom-sandbox-providers) using `createBindMountSandboxProvider` or `createIsolatedSandboxProvider`

## Quick start

1. Install the package:

```bash
npm install --save-dev @ai-hero/sandcastle
```

2. Run `npx @ai-hero/sandcastle init`. This scaffolds a `.sandcastle` directory with all the files needed.

```bash
npx @ai-hero/sandcastle init
```

3. Edit `.sandcastle/.env` and fill in your default values for `CLAUDE_CODE_OAUTH_TOKEN` (run `claude setup-token` on your host to get one). To use an Anthropic API key instead, uncomment and fill in `ANTHROPIC_API_KEY`.

```bash
cp .sandcastle/.env.example .sandcastle/.env
```

4. Run the `.sandcastle/main.ts` (or `main.mts`) file with `npx tsx`

```bash
npx tsx .sandcastle/main.ts
```

```typescript
// 3. Run the agent via the JS API
import { run, claudeCode } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

await run({
  agent: claudeCode("claude-opus-4-8"),
  sandbox: docker(), // or podman(), vercel(), or your own provider
  promptFile: ".sandcastle/prompt.md",
});
```

## Persistent DevSquad/ADO workflow checkpoints

Host coordinators can persist offline resume state and serialize local workflow
updates with `openDevSquadAdoWorkflowLedger()`. The caller must provide the
canonical **host repository root** explicitly; the ledger never invokes git,
discovers a root, or contacts ADO, GitHub, MCP, a network, a sandbox, or an
agent provider.

```typescript
import { randomBytes } from "node:crypto";
import { openDevSquadAdoWorkflowLedger } from "@ai-hero/sandcastle";

const opened = await openDevSquadAdoWorkflowLedger({
  // Pass this same main-checkout root when calling from any worktree.
  repositoryRoot: "/host/repos/example",
});
if (!opened.ok) throw new Error(opened.error.kind);

const ledger = opened.value;
const initialized = await ledger.initializeRecord({
  workItemId: 137,
  operationId: "initialize-137", // stable across an ambiguous retry
  phase: "implement", // caller-defined; Sandcastle has no phase allowlist
  status: "ready",
  branch: "users/agent/137",
  worktreePath: "/host/repos/example/.sandcastle/worktrees/137",
});
if (!initialized.ok) throw new Error(initialized.error.kind);

// Supply a cryptographically random 32-byte, unpadded base64url token.
const claimToken = randomBytes(32).toString("base64url");
const acquired = await ledger.acquireClaim({
  workItemId: 137,
  operationId: "claim-137-loop-a",
  ownerId: "loop-a",
  claimToken,
  leaseDurationMs: 60_000,
});
if (!acquired.ok) throw new Error(acquired.error.kind);

const claim = acquired.value.outcome.authority;
const checkpointed = await ledger.checkpoint({
  workItemId: 137,
  operationId: "checkpoint-137-running",
  authority: {
    ownerId: claim.ownerId,
    claimToken: claim.claimToken,
    fencingValue: claim.fencingValue,
  },
  expected: {
    revision: acquired.value.record.revision,
    phase: acquired.value.record.phase,
    status: acquired.value.record.status,
  },
  patch: {
    status: "running",
    agentId: "implementer-a",
    sessionId: "session-1",
    observations: {
      workItemCommentId: "481",
      pullRequest: { threadId: "12", commentId: "29" },
    },
  },
});
```

State is stored as strict, immutable schema-v1 generations beneath
`.sandcastle/devsquad-ado/`. The generated `.sandcastle/.gitignore` excludes
that directory to prevent accidental commits, but gitignore is **not access
control**. Keep the repository writable only by its trusted owner.

The production storage boundary currently supports POSIX local filesystems only
when Node can verify owner-only ledger modes, use no-follow file opens, publish
with exclusive same-filesystem hard links, flush files, and sync directory
metadata. It probes the required hard-link and directory-sync capabilities
before creating `ledger.json` and fails closed with `unsupported-permissions` or
`unsupported-filesystem` when they cannot be established. Network shares and
synchronized filesystems remain outside the supported boundary even if a probe
appears to succeed.

On Windows, the public opener currently returns `unsupported-permissions`
before creating ledger state. Node's filesystem APIs do not provide the ACL
inspection/establishment, reparse-safe open, and directory durability controls
required by ADR-0025, and core deliberately does not fall back to shell or CLI
ACL tools. Stored Windows and UNC _worktree reference strings_ remain valid
opaque metadata; that does not imply Windows ledger-storage support.

Claim tokens are capabilities: retain them only in the coordinator that owns
the claim, do not log them, and reuse the original token plus operation ID when
retrying an ambiguous acquisition. Sandcastle persists only a SHA-256 verifier;
read, list, recovery, checkpoint, renew, and release projections are token-free.
Expired claims can be taken over with a higher fencing value. A stale authority
cannot checkpoint, renew, or release the later owner's state.

All methods return a Promise of a discriminated `{ ok, value | error }` result.
Handle categories such as `claim-conflict`, `stale-fencing`,
`revision-conflict`, `state-conflict`, `idempotency-conflict`,
`corrupt-artifact`, and `unsupported-schema-version` without parsing message
text. A `storage` error with `outcome: "indeterminate"` means publication may
have happened: retry the exact request with the same operation ID. Recovery
fails closed, preserves corrupt evidence, and never promotes a temporary file
or falls back from a corrupt highest generation. Use `inspectRecoveryErrors()`
for a bounded, deterministic read-only scan.

The ledger records structurally valid phase and status strings but defines no
phase order, transition policy, terminal state, merge readiness, or resumability
policy. DevSquad/the host remains responsible for lifecycle decisions and all
external ADO or GitHub actions. `listResumableRecords()` therefore returns every
valid initialized record; the host decides which ones should resume.

## Bounded DevSquad/ADO workflow watch passes

`runDevSquadAdoWorkflowWatchPass()` runs **one bounded offline pass** in either
**supplied mode** (default, or `mode: "supplied"`) or explicit
**discovery mode** (`mode: "discovery"`). Supplied mode takes a caller-supplied
candidate set; discovery takes bounded pages from a host-injected read-only seam.
The supplied overload and its signal/result shapes remain unchanged: supplied
consumers need not narrow a discovery union or provide an initializer. For
existing records in either mode, it reads ledger records, asks an injected seam
what is new, advances opaque observation cursors through fenced ledger
checkpoints, and returns token-free per-candidate outcomes plus at most one
intake signal per candidate. It is not a daemon: poll scheduling is bounded, and
composing passes into a loop is the host's job. Termination requires injected
ledger operations and delays to settle; observation timeouts require a valid
delay. Cancellation is cooperative and cannot forcibly stop dependencies.

```typescript
import {
  runDevSquadAdoWorkflowWatchPass,
  openDevSquadAdoWorkflowLedger,
} from "@ai-hero/sandcastle";

const opened = await openDevSquadAdoWorkflowLedger({
  repositoryRoot: "/host/repos/example",
});
if (!opened.ok) throw new Error(opened.error.kind);

const outcome = await runDevSquadAdoWorkflowWatchPass({
  ledger: opened.value,
  // The host owns transport, credentials, and ordering.
  seam: {
    observeWorkItemComments: async ({
      workItemId,
      sinceCommentId,
      signal,
    }) => ({
      commentIds: await tracker.listCommentIds(
        workItemId,
        sinceCommentId,
        signal,
      ),
    }),
    observePullRequestActivity: async ({
      pullRequestId,
      sinceCursor,
      signal,
    }) => ({
      entries: await tracker.listThreadActivity(
        pullRequestId,
        sinceCursor,
        signal,
      ),
    }),
  },
  passId: "nightly-2026-01-01-01", // stable across an ambiguous retry
  ownerId: "coordinator-a",
  candidates: [137, 42],
  // Exact-match sets. There is no wildcard and no Sandcastle phase table.
  intakeRules: { phases: ["implement", "review"], statuses: ["ready"] },
  budgets: {
    maxPolls: 5,
    maxPollStartElapsedMs: 120_000,
    observationTimeoutMs: 5_000,
  },
  clock: () => new Date(),
  delay: (ms, signal) =>
    new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    }),
});

if (!outcome.ok) throw new Error(outcome.error.kind);
for (const signal of outcome.value.signals) {
  // The host decides what a signal means and what runs next.
  await devsquad.enqueue(signal.workItemId, signal.phase, signal.status);
}
```

### Supplied mode and the shared observation seam

The supplied seam exposes exactly two read methods. `observeWorkItemComments` is
required. `observePullRequestActivity` is required only for candidates whose
record carries a pull-request identifier; a candidate that needs it while the
method is absent reports `pull-request-observation-unavailable`.

The seam owns ordering. Entries must come back in the tracker's authoritative
order, oldest first, and the window is **anchor-inclusive**: whenever you are
given a `since` anchor and have a non-empty window to return, that anchor must
appear in it. Return the anchor alone, or an empty window, when nothing is new.

Each window permits at most **1,000 entries** and **1,048,576 aggregate UTF-8
identifier bytes**, inclusive, with at most **1,024 bytes per identifier**.
Work-item IDs within a window and PR `(threadId, commentId)` pairs must be
unique. Only missing/undefined and null PR comment IDs are equivalent; blank
strings are invalid identifiers. Malformed envelopes/collections, unreadable
identifier-bearing accessors, and duplicate or oversized windows fail the entire
candidate as `invalid-observation-window`, without deduplication or truncation.
Individual invalid identifiers remain `invalid-observation-identifier`.
Windows and candidate arrays use bounded indexed traversal, ignoring custom
iterators. Observed growth or shrinkage during traversal rejects the input or
whole window, including mutation by the final getter.

The watcher never parses, sorts, or arithmetically compares identifier text; it
locates the persisted cursor by exact comparison and treats everything after it
as new. A non-empty window that omits the anchor is therefore undecidable — it
looks identical to a window in which every entry is new — so rather than
re-deliver the whole window the watcher fails that candidate closed with
`failed` / `observation-anchor-missing`. Keeping an anchored entry retrievable
for as long as it is a cursor is the seam's obligation; if the tracker really
did drop it, the host must re-anchor the record deliberately.

Only identifier fields are read. `commentIds`, `threadId`, and `commentId` are
projected out and every other property of a returned entry is discarded before
it can reach durable state, results, errors, or diagnostics. A pull-request
entry with a missing/null `commentId` is never persisted as a cursor. In mixed
windows, the newest complete pair is persisted, even if incomplete entries
follow it. Only when no new complete pair exists is `pull-request-thread`
included in `skippedCursorKinds`; it never overlaps `cursorChanges`. Without
another persistable change the reason is `incomplete-pull-request-cursor`.
The seam is never invoked to write.

### Pass identity and replay parity

`passId` is **required and caller-supplied**. Every ledger mutation the watcher
performs derives its operation identifier deterministically:

```text
legacyOperationId = "dsw2." + step + "." + sha256hex(canonicalJson(identity)).slice(0, 32)
prCheckpointOperationId = "dsw3.checkpoint." + sha256hex(canonicalJson(identity)).slice(0, 32)
```

The identity differs by step family, because the two families need opposite
properties.

A newly prepared **checkpoint** involving PR observation is scoped to the
observed PR destination as well as the anchors it starts from and the cursors
it makes durable. This includes a WI-only advance when the observed PR has no
persistable new pair. The identity is exactly
`{ v: 3, passId, workItemId, step: "checkpoint", ordinal, generation: { pullRequestId, fromWorkItemCommentId, fromPullRequest, toWorkItemCommentId, toPullRequest } }`.
It uses the PR ID read **before acquisition**, subject to the unchanged
acquisition staleness gate, never a later PR ID. Different PRs may reuse the
same local thread/comment pair; their checkpoints must have different IDs.
No-PR checkpoints retain the legacy v2 identity and bytes. Both forms use the
same canonical serializer and 32-hex-character hash truncation, producing a
48-byte checkpoint ID within the ledger's 256-byte bound.

Recovery retains the pending operation ID and submitted request. It validates
history against that submission before refreshing retry preconditions; it never
mints another ID or switches versions to bypass an `idempotency-conflict`.

A **claim-lifecycle** identifier (`claim`, `renew`, `release`) is scoped to a
random claim epoch minted per acquisition. Capability tokens are freshly random
on every acquisition and the ledger folds the token into its idempotency
digest, so an identifier that ignored the acquisition would turn a second
acquire under the same `passId` into a permanent `idempotency-conflict` that no
retry could clear. Scoping by epoch keeps tokens cryptographically random and
keeps the same `passId` retryable: a pass that acquired a claim and then failed
before its checkpoint landed can simply be run again.

Use `deriveDevSquadAdoWatcherOperationId()` to compute a **checkpoint or
claim-lifecycle** identifier yourself; the epoch and generation arms are its
unchanged public input types. The one-argument helper retains byte-for-byte v2
output and **cannot isolate PR destinations**. For PR checkpoints, use the
checkpoint-only overload
`deriveDevSquadAdoWatcherOperationId(checkpointIdentity, { pullRequestId })`.
Only newly prepared pass checkpoints involving PR observation intentionally
switch to v3; existing receipts are not migrated, reinterpreted, or used as a
fallback. Discovery initialization uses a separate private derivation
from canonical `{ step: "initialize", workItemId, submissionId, phase, status }`.
It stays stable across pass IDs and retries, excludes traversal/page/continuation
and claim identities, and never mints a replacement to bypass a conflict.

### Intake rules, budgets, leases, and backoff

Intake rules are exact-match sets. Admitting every status means listing every
status. Unknown phase names are accepted without objection when the caller lists
them, and a record whose phase or status is not admitted still has its cursor
advanced and reports `intake-suppressed` — suppression is an intake decision,
not an observation decision.

A supplied pass stops at the first of: all candidates resolved, `maxPolls` reached,
`maxPollStartElapsedMs` reached, or cancellation, and reports which in
`stopReason`.

`maxPollStartElapsedMs` bounds **scheduling, not duration**. It is checked once
per poll, before that poll begins, and the first poll always starts. Work
already in flight — candidate steps, seam observations, ledger mutations —
can overrun the value, and a single poll is not bounded by it at all. `maxPolls`
bounds the number of polls, not physical runtime. Each observation receives its
own child abort signal: timeout or parent abort cancels that signal and the
timer, and late results are ignored. Ledger methods and delays must settle.
Noncooperating dependencies may remain physically active after cancellation;
an abort signal is not a hard wall-clock ceiling.

The clock is read once per poll and that single reading drives every eligibility,
lease, and timestamp decision in that poll. Between polls the watcher asks the
injected `delay` for `min(baseIntervalMs * multiplier^(n-1), maxIntervalMs)`,
truncated to an integer; defaults are 1,000 ms, 2, and 30,000 ms. There is no
backoff randomness unless you inject `backoff.jitter`; claim epochs, capability
tokens and discovery traversal IDs are separately random.

Claims are acquired only for existing-record cursor mutations, never
initialization. The default lease is
60,000 ms (raise it up to the 24-hour ceiling with `lease.leaseDurationMs`), and
the default renewal threshold is one third of the lease. Before mutating under a
held claim the watcher renews when `now + renewalThresholdMs >= expiresAt`,
preserving the fencing value. An unexpired claim owned by someone else is a
`skipped` / `claim-conflict`, never a fault, and the watcher never force-releases,
deletes, or resets another owner's claim.

A record is read before its observation and again as part of the acquisition,
and the two are compared. If another owner advanced a cursor in that window, the
selection in hand was computed from anchors that are no longer durable, so the
watcher attempts cleanup once without writing. Only an acknowledged release
allows `no-change` / `stale-observation` and, if scheduling continues, a later
poll to re-observe from the advanced anchor. Discovery finalizes this disposition
when terminal enumeration leaves no pending mutation recovery. Unconfirmed
cleanup instead finalizes a failed candidate with
explicit cleanup evidence. The stale selection never moves a cursor backwards.

Cancellation is observed before each seam call, before each non-cleanup ledger
mutation, and at candidate completion and poll/budget exits. An aborted pass
still attempts cleanup once for every validated
claim authority and reports all acknowledged effects. A seam call that fails
because its signal aborted is reported as `cancelled`, not as an observation
fault.

Required signal getters are inspected before injected side effects; unreadable
ones return a sanitized validation error at `signal`. Listener methods are
captured once while `aborted` remains live. If abort state becomes unreadable
after preflight, the pass stops as cancelled and still performs mandatory cleanup.
Ledger acknowledgements are likewise projected into fresh method-specific public
fields before validation; unrelated response getters are never read.

Every candidate has mandatory `cleanup` evidence:

| Status          | Meaning                                                                    |
| --------------- | -------------------------------------------------------------------------- |
| `released`      | A validated release acknowledgement, with its original `acceptedRevision`. |
| `failed`        | A known release rejection, including storage `unchanged`.                  |
| `indeterminate` | Ambiguous/faulting release, or acquire without validated authority.        |
| `not-required`  | No claim acquired and no acquisition uncertainty.                          |

Cleanup includes a stable `reason` and `ledgerErrorKind`; it never includes a
capability token. No release is attempted without validated authority, and
cleanup is never retried or guessed. Inclusive lease expiry is the backstop.
An acknowledged release replay describes the original release, not the absence
of a later owner's claim.

Failed/indeterminate cleanup promotes an otherwise nonfailed candidate to
`claim-cleanup-unconfirmed` (or `ledger-unavailable` for `ledger-fault`), while
preserving an existing primary failure. It **does not retract** acknowledged
checkpoint revisions, cursor changes, or intake signals. `counts.acted` counts
returned signals, `counts.suppressed` counts acknowledged suppressed advances,
and either may overlap `counts.failed`. `cleanupReleased`, `cleanupFailed`,
`cleanupIndeterminate`, and `cleanupNotRequired` partition all candidates.

### Delivery model and the DevSquad boundary

Intake signals are **returned in the pass result**. There is no callback, queue,
retry, or transport: host code never runs inside a claimed step. A candidate's
cursor checkpoint (or discovery initialization) is acknowledged as durable before
its corresponding signal enters the result.
A crash before return can therefore lose a signal whose cursor already advanced.

Delivery is **at-most-once, and never duplicating** — it is not lossless. The
guarantee is that no observed event is delivered twice: a cursor advance is
durable before the signal derived from it is reported. The converse does not
hold. If a checkpoint becomes durable but the pass cannot confirm it
(the process dies, or storage reports an indeterminate outcome and the budget
ends first), the cursor has moved while the signal was never returned, and a
later pass sees nothing new for that window. Hosts that cannot tolerate a lost
signal must reconcile from the record, not from the signal stream.

At-most-once applies to **ledger-mediated intake delivery only**. It makes no
claim about external side effects: fencing protects ledger mutations, not
anything the host does after reading a signal.

An injected ledger that throws, rejects, or answers with something that is not a
valid method-specific result is never allowed to escape. Full public records,
original mutation metadata, request identity/authority/checkpoint consistency,
and known error variants are runtime-validated against an independent request
snapshot, never the mutable request handed to the adapter. A replay at its
accepted revision must agree with that record; an older acknowledgement can
coexist with valid later mutations. Recovery from checkpoint history uses the
same acknowledgement checks against the original submitted request, not a
refreshed retry revision: acceptance must be at the submitted expected revision
plus one, and a same-revision record must match the cursor, state, and authority.
Unknown or malformed responses
resolve as `failed` /
`ledger-unavailable` with `ledgerErrorKind: "ledger-fault"`, the candidate's
validated authority receives one cleanup attempt, and no message, stack, or
arbitrary error category reaches the result. A malformed acquire establishes
no authority; a malformed mutation acknowledgement never fabricates durability.

The host keeps everything else. In supplied mode it chooses candidates and
initializes records; missing records remain `skipped` / `record-not-found`.
In discovery mode it supplies stable bounded pages, normalized facts and explicit
item authorization/initial state; the watcher evaluates matching and can perform
claim-free authorized initialization. In both modes the host defines phase/status
meaning and transition legality, schedules execution, owns transport/credentials,
and performs every external tracker write and pull-request action. Neither mode
constructs live queries/clients, invokes agents, dispatches intake, approves or
merges PRs, or implements lifecycle orchestration.

Note that every ledger mutation advances the record revision, including claim
acquisition, renewal, and release. A candidate outcome therefore reports
`sourceRevision` (the revision the decision was derived from) alongside
`revision` (the revision the cursor checkpoint was accepted at) and
`cleanup.acceptedRevision` (the acknowledged release revision). For example,
read 4 -> acquire 5 -> checkpoint 6 -> release 7 yields source 4, checkpoint 6,
cleanup 7. An unchanged repeat leaves revision 7 unchanged with no cleanup
required. A replay may acknowledge an older revision than its latest record.
Candidate outcomes and ledger errors are reduced to stable categories —
`ledgerErrorKind` carries the ledger's own category and never raw JSON, artifact
contents, or an operating-system message.

### Discovery matching and host responsibilities

<!-- W045 / FR-061–069 / CC-031–037 -->

Discovery requests supply `mode: "discovery"`, no `candidates`, and a complete
`discovery` configuration. Its seam adds `discoverWorkItemsPage` to required WI
and optional PR observation methods. Discovery observations return
`{ kind: "window", commentIds }` / `{ kind: "window", entries }`, or explicit
`{ kind: "anchor-missing" }`. Supplied observation shapes do not change.

The host declares `scopeId`, `partitionId`, `stabilityId`,
`stableForInvocation: true`, and a policy `version`. Every page must echo the
request's exact binding, traversal ID and one-based ordinal. The watcher snapshots
configuration once; the host must provide a stable enumeration/fact view and
change policy version when meaning changes. These labels detect declaration drift;
they do **not** prove adapter honesty, integrity or authorization. Adapters are
trusted in-process dependencies, not sandboxed or cryptographically verified.

The watcher evaluates the complete policy itself, not an upstream `eligible`
boolean or query filter:

| Dimension           | Operator             | Meaning                                                               |
| ------------------- | -------------------- | --------------------------------------------------------------------- |
| `state`             | `one-of`             | Match any allowed opaque state.                                       |
| `team`              | `one-of`             | Match any allowed **host-resolved** team membership.                  |
| `tags`              | `all`, `any`, `none` | Require all, any, or none of the configured tags.                     |
| `area`, `iteration` | `exact`, `subtree`   | Equal segment paths, or a complete segment prefix including its root. |

- AND every configured predicate, including separate tag predicates. State/team
  set members are OR alternatives. At most seven predicate slots: one each of
  state, team, area, iteration, tags-all, tags-any, tags-none. Unknown operators
  and duplicate slots fail configuration before injected effects.
- Empty `filters` is unrestricted. Configured state/team/tag sets must be
  nonempty and duplicate-free; no silent deduplication or truncation.
- Values compare exactly and case-sensitively: no trimming, case folding, Unicode
  normalization, synonyms, separator splitting or `assignedTo` team inference.
  Only work-item IDs retain the ledger's canonicalization rules.
- Paths are host-normalized segment arrays, not textual prefixes. `[]` is root;
  root subtree matches every known path, exact root only root. `['A']` includes
  itself and `['A', 'B']` as a subtree, but not the sibling `['AB']`.
- Facts use optional `state`, `teams`, `tags`, `area`, `iteration` fields with
  `{ kind: "known", value }` or `{ kind: "missing" }`. Omission means missing.
  Known empty tags satisfy `none`, but not nonempty `all`/`any`; known empty teams
  fail a configured team predicate. Empty paths are known roots, not missing.
- Unconfigured fact getters and unrelated properties are not read. Required
  malformed facts invalidate the **whole page**, even in its last entry; valid
  missing facts pause just that candidate. Missing facts take precedence over
  an unmatched predicate. Validation uses bounded indexed reads, not custom
  iterators, and rejects changing arrays.

Matching precedes authorization use, ledger reads, observations and mutations.
An excluded item reports `matching-paused`; missing required facts report
`matching-facts-missing`. Both perform **zero item effects** and persist no pause
marker. Reentry uses the unchanged durable `since` anchors. It never resets to a
synthetic baseline or infers a latest event. An ordinary empty discovery window
means known no-new-events; explicit `anchor-missing` requires a supplied durable
anchor and fails even an otherwise empty response. Nonempty windows missing the
anchor also fail. Loss in either WI or PR blocks checkpointing **both** kinds;
the host must deliberately reconcile retention loss. Intake-rule suppression is
different: matched existing records still advance cursors without returning intake.

`validateDevSquadAdoWorkflowWatchPassOptions` returns a minimized discovery
summary: normalized common pass settings, `mode` and the public `binding`
(scope/partition/stability/policy version). It invokes no injected dependency and
does not return the prepared discovery configuration, policy operands or
authorization submission IDs. The running pass retains that context privately
for matching and admission. Supplied validation types and result shapes are unchanged.

Public matching evidence contains only the exact `policyVersion`, decision
`matched | excluded | facts-missing`, and fixed predicate/outcome categories in
state/team/tags-all/tags-any/tags-none/area/iteration order. Raw policy operands,
facts, authorization submission IDs, continuations, traversal IDs, capability
tokens, sensitive hashes and dependency bodies/messages are not exposed or
persisted. Necessary public IDs and explicitly authorized initial workflow values
remain public. Hosts should keep correlation labels nonsecret and bound upstream
payloads as well as the library's recognized fields.

Executable failures from supplied signal listener registration/removal are
sanitized as observation/page failures. Earlier acknowledged cursor advances and
signals remain available, and retained claims still receive final cleanup. Each
attempt retires its child/timer and attempts listener removal once, including
partially throwing registration; a throwing host adapter cannot be guaranteed to
have actually removed its listener.

### Authorized no-comment admission and signal interpretation

Only a matched item whose initial guarded record read reports missing can enter
admission. A later claim/checkpoint rejection is not admission evidence: its
existing-record failure and any failed or indeterminate cleanup remain visible.

A matched, method-valid missing record is initialized only with explicit
canonical-item authorization:
`{ workItemId, kind: "authorized", submissionId, initial: { phase, status } }`.
Omitted authorization or `{ kind: "unavailable", reason: "not-authorized" |
"initial-state-missing" }` never initializes. Matching, external state, team
membership and ledger claims are **not** authorization. The host alone defines
initial phase/status and intake rules.

Initialization submits only `workItemId`, `operationId`, `phase`, `status` to the
existing ledger. It seeds no cursors, PR/execution references, histories or claims.
No comments are needed. Requests and method-specific acknowledgements are
validated independently, including original state/acceptance when a later latest
record is returned. A fresh publisher can produce exactly one
`kind: "discovery-admission"` signal if its initial phase/status matches intake
rules. This signal carries `acceptedInitializationRevision: 1`, initial state,
minimized matching evidence and `authorization: "host-authorized"`, **not** source
revision, changed-comment kinds, checkpoint or claim metadata.

Existing-record discovery intake instead has `kind: "comment-observation"` plus
the historical comment fields. Narrow this discovery-only signal union by `kind`.
Supplied signals remain unchanged without a new discriminator. Runtime-selected
request unions return a supplied/discovery result union; validation has matching
overloads. Neither mode dispatches signals.

Initialization replay reports original acceptance (`acceptance.kind: "replayed"`)
**without redelivery**. Already-recorded initialization infers no acceptance for
this request; identity conflict is terminal. Bounded contention/indeterminate
retries retain the exact original submission. Once initialization starts there is
no same-invocation comment fallback, including replay/already-exists; genuine
comments may be observed in a later invocation. Fresh-only admission rules do not
replace existing comment checkpoint direct/replay/history recovery.

All initialization-only outcomes have `cleanup.status: "not-required"`,
`reason: "no-claim-acquired"`, and null `ledgerErrorKind`/`acceptedRevision`, even
when initialization is uncertain. This proves **no acquisition**, not successful
initialization or rollback. No release is invented. A durable initialization with
lost/malformed acknowledgement, or a crash before consumption, can **permanently
lose the admission signal**. Restart/replay/reconciliation cannot reconstruct it.
The host must reconcile durable workflow state separately; this is at-most-once
reporting, not lossless delivery or exactly-once execution. There is no outbox.

### Discovery limits, traversal and accounting

Supply the full `limits` object, usually `DEFAULT_DEVSQUAD_ADO_DISCOVERY_LIMITS`.
All configured limits are positive safe integers; actual collections may be empty
where allowed. All limits apply conjunctively and exact boundaries are inclusive.

| Limit                   |   Default |   Ceiling |
| ----------------------- | --------: | --------: |
| `maxPageCalls`          |        32 |     1,000 |
| `maxItems`              |     1,000 |     1,000 |
| `maxEntriesPerPage`     |       128 |     1,000 |
| `maxCollectionValues`   |       128 |     1,024 |
| `maxPathSegments`       |        32 |       128 |
| `maxOpaqueValueBytes`   |     1,024 |     4,096 |
| `maxContinuationBytes`  |     4,096 |    16,384 |
| `maxPolicyBytes`        |    65,536 |   262,144 |
| `maxPageBytes`          | 1,048,576 | 4,194,304 |
| `maxAuthorizationBytes` |   262,144 | 1,048,576 |

Additional limits: seven predicates, 1,000 canonical-unique authorizations,
256 UTF-8 bytes per scope/partition/stability/policy-version/submission identifier,
120-byte canonical work-item IDs, and 256-byte phase/status values. Existing
observation-window and ledger bounds also apply. New discovery strings reject
ill-formed Unicode; opaque comparisons never normalize it.

Individual lengths count actual UTF-8 bytes. Aggregate limits count canonical
JSON of recognized fields, including keys, punctuation, escaping, discriminators
and metadata: policy `{ version, filters }`, authorization array, and page
`{ binding, traversalId, pageOrdinal, items, next }`. Page items contain canonical
`workItemId` and configured `facts`; required omitted facts count as explicit
`{ kind: "missing" }`. Binding contains scope/partition/stability/policy version;
`next` includes continuation when present. Unconfigured facts/unrelated properties
are neither read nor counted. Accounting is incremental, rejecting overflow before
retention rather than serializing an oversized object. These are library
processing/retention limits, not limits on allocations an adapter already made.

Each invocation starts at **page ordinal 1 with null continuation** and a fresh
private traversal ID. Tokens are nonempty bounded opaque strings, forwarded
verbatim and compared only for repetition, never parsed/sorted or persisted.
There is no durable continuation, pause/admission marker, cursor repurposing,
sidecar or schema change. Repeated bounded **prefix rescans have no eventual tail
progress guarantee**; the host must choose stable partitions and budgets that fit.

Each poll processes pending candidates in first-discovery order, then initiates
**at most one new page** when scheduling permits. Accepted page items run
sequentially in canonical UTF-8 order; no candidate runs twice in one poll. This
is page-local ordering, not a global sort independent of partitioning. Candidate
retries never reset page/item/poll counters. `pageCalls` counts actual invocations,
including empty, failed and timed-out calls; no hidden page retry loop exists.
Empty continued pages consume a call and continue. At the item limit, only empty
pages can establish terminal evidence; another item overflows. A terminal final
permitted call can complete; a continued final call cannot.

`traversal.status: "complete"` requires both explicit terminal evidence and
finalized accepted-item dispositions. Completion does not mean every item
succeeded. `terminalPageSeen: true` alone does not erase pending mutation retries,
cancellation or exhausted budgets. Ordinary no-new-events finalize after their
observation attempt once terminal is known; genuine retries may need more polls.
Rejected/duplicate/unstable/oversized later pages preserve earlier outcomes and
acknowledged writes, but contribute no accepted item identities.

Incomplete reasons are `page-budget-exhausted`, `item-budget-exhausted`,
`poll-budget-exhausted`, `poll-start-budget-exhausted`, `page-failed`,
`page-timeout`, `invalid-page`, `duplicate-item`, `repeated-continuation`,
`unstable-scope`, or `cancelled`. Pass `stopReason` is separately `completed`,
`discovery-incomplete`, `cancelled`, `poll-budget-exhausted`, or
`poll-start-budget-exhausted`. Inspect traversal and individual dispositions, not
just `ok: true` or the stop reason.

Counts remain independent: `pagesValidated`, `discovered`, `evaluated`, `admitted`
(fresh accepted initializations, with or without intake), `paused`, `processed`
(finalized dispositions including matching, excluding unprocessed items),
and `initializationReplayed` are not aliases for `pageCalls` or `acted`.
`acted` counts both signal kinds; `eligible` keeps its observation-only meaning;
`suppressed` counts only acknowledged suppressed cursor advances, not pauses or
unmatched/replayed admission. Paused counts include validated but unscheduled
items, whose outcome is explicitly `unprocessed`. Outcomes use first-discovery
order; signals use acknowledgement order. Final failures may overlap actions;
the four cleanup counts partition all returned candidates.

Fresh abort gates precede pages, candidate effects, observations and non-cleanup
mutations. In-flight ledger writes are **awaited** and their acknowledgements
validated; permitted fresh admission or comment signals survive abort and cleanup
failure. Page/observation child controllers and timers retire late results without
late effects. Validated existing-record authority still gets exactly one cleanup
attempt. Ledger/delay dependencies must settle; page/observation timeouts use the
injected delay and are not a hard runtime guarantee. Poll-start elapsed limits
bound scheduling, not duration; the clock is read at pass start and once per poll.
Both modes snapshot each native Date timestamp; later caller mutation of a shared
Date cannot move the start baseline, poll decision or reported timestamps.

### Typed offline discovery examples

The following fixture is compiled and executed by
`src/DevSquadAdoWorkflowWatcher.discovery.test.ts`; it performs no live query,
network operation or dispatch. Supply an opened repository-local ledger, a UTC
clock and a cooperative delay (as in the supplied example). Preconditions: item
999 is absent, while item 137 is already initialized at phase `ready`, status
`open`, WI cursor `480`, with no PR. Those are fixture prerequisites, not automatic
seeding by the watcher. The calls demonstrate terminal empty discovery, authorized
no-comment admission, exclusion without observation, anchored reentry to `481`,
and a repeat with no redelivery.

```typescript
import {
  DEFAULT_DEVSQUAD_ADO_DISCOVERY_LIMITS,
  runDevSquadAdoWorkflowWatchPass,
  type DevSquadAdoWorkflowLedger,
  type DevSquadAdoDiscoveryPage,
  type DevSquadAdoWatcherDiscoverySeam,
  type RunDevSquadAdoDiscoveryWatchPassOptions,
} from "@ai-hero/sandcastle";

async function offlineDiscoveryExamples(
  ledger: DevSquadAdoWorkflowLedger,
  clock: () => Date,
  delay: RunDevSquadAdoDiscoveryWatchPassOptions["delay"],
) {
  const emptySeam: DevSquadAdoWatcherDiscoverySeam = {
    discoverWorkItemsPage: async (request) => ({
      binding: request.binding,
      traversalId: request.traversalId,
      pageOrdinal: request.pageOrdinal,
      items: [],
      next: { kind: "terminal" },
    }),
    observeWorkItemComments: async () => ({ kind: "window", commentIds: [] }),
  };
  const options: RunDevSquadAdoDiscoveryWatchPassOptions = {
    mode: "discovery",
    ledger,
    seam: emptySeam,
    passId: "offline-example",
    ownerId: "host",
    clock,
    delay,
    intakeRules: { phases: ["ready"], statuses: ["open"] },
    budgets: {
      maxPolls: 2,
      maxPollStartElapsedMs: 1000,
      observationTimeoutMs: 10,
    },
    discovery: {
      scope: {
        scopeId: "example",
        partitionId: "small-partition",
        stabilityId: "snapshot-1",
        stableForInvocation: true,
      },
      policy: { version: "policy-v1", filters: [] },
      limits: DEFAULT_DEVSQUAD_ADO_DISCOVERY_LIMITS,
    },
  };
  const empty = await runDevSquadAdoWorkflowWatchPass(options);
  const pageFor =
    (
      items: DevSquadAdoDiscoveryPage["items"],
    ): DevSquadAdoWatcherDiscoverySeam["discoverWorkItemsPage"] =>
    async (request) => ({
      binding: request.binding,
      traversalId: request.traversalId,
      pageOrdinal: request.pageOrdinal,
      items,
      next: { kind: "terminal" },
    });

  // Precondition: 999 is absent. Admission never calls the comment method.
  const admission = await runDevSquadAdoWorkflowWatchPass({
    ...options,
    seam: {
      discoverWorkItemsPage: pageFor([{ workItemId: 999, facts: {} }]),
      observeWorkItemComments: async () => {
        throw new Error("admission must not observe comments");
      },
    },
    discovery: {
      ...options.discovery,
      authorizations: [
        {
          workItemId: 999,
          kind: "authorized",
          submissionId: "host-submission-999",
          initial: { phase: "ready", status: "open" },
        },
      ],
    },
  });

  // Precondition: 137 already has phase ready/status open, WI cursor 480, no PR.
  const reentryOptions: RunDevSquadAdoDiscoveryWatchPassOptions = {
    ...options,
    seam: {
      discoverWorkItemsPage: pageFor([
        {
          workItemId: 137,
          facts: { state: { kind: "known", value: "included" } },
        },
      ]),
      observeWorkItemComments: async ({ sinceCommentId }) => {
        if (sinceCommentId !== "480" && sinceCommentId !== "481")
          throw new Error("expected the durable anchor");
        return { kind: "window", commentIds: ["480", "481"] };
      },
    },
  };
  const paused = await runDevSquadAdoWorkflowWatchPass({
    ...reentryOptions,
    discovery: {
      ...options.discovery,
      policy: {
        version: "policy-excluded",
        filters: [
          { dimension: "state", operator: "one-of", values: ["other"] },
        ],
      },
    },
  });
  const reentry = await runDevSquadAdoWorkflowWatchPass(reentryOptions);
  const repeat = await runDevSquadAdoWorkflowWatchPass(reentryOptions);
  return { empty, admission, paused, reentry, repeat };
}
```

The discovery implementation and documentation are locally implemented through
W045. W046 remains **pending independent full integration-base review** owned by
the parent. Historical W038 supplied-candidate approval is not discovery approval;
ADR-0025/0026 remain Proposed. No overall extension approval, publication or ADR
acceptance is implied by these local examples or scoped validation.

## Sandbox Providers

Sandcastle uses a `SandboxProvider` to create isolated environments. The `sandbox` option on `run()`, `interactive()`, and `createSandbox()` accepts any provider, including `noSandbox()` — opt in to running the agent directly on the host when container isolation is undesired. Built-in providers:

| Provider   | Import path                                | Type       | Accepted by                                 |
| ---------- | ------------------------------------------ | ---------- | ------------------------------------------- |
| Docker     | `@ai-hero/sandcastle/sandboxes/docker`     | Bind-mount | `run()`, `createSandbox()`, `interactive()` |
| Podman     | `@ai-hero/sandcastle/sandboxes/podman`     | Bind-mount | `run()`, `createSandbox()`, `interactive()` |
| Vercel     | `@ai-hero/sandcastle/sandboxes/vercel`     | Isolated   | `run()`, `createSandbox()`, `interactive()` |
| No-sandbox | `@ai-hero/sandcastle/sandboxes/no-sandbox` | None       | `run()`, `createSandbox()`, `interactive()` |

Worktree methods (`wt.run()`, `wt.interactive()`, `wt.createSandbox()`) accept the same providers as their top-level counterparts. `wt.interactive()` defaults to `noSandbox()` when no sandbox is specified.

```typescript
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { podman } from "@ai-hero/sandcastle/sandboxes/podman";
import { vercel } from "@ai-hero/sandcastle/sandboxes/vercel";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";

// Docker, Podman, and Vercel are interchangeable in run() and createSandbox():
await run({
  agent: claudeCode("claude-opus-4-8"),
  sandbox: docker(),
  prompt: "...",
});

// No-sandbox runs the agent directly on the host — accepted by run(),
// createSandbox(), and interactive(). Skips container isolation entirely:
await interactive({
  agent: claudeCode("claude-opus-4-8"),
  sandbox: noSandbox(),
  prompt: "...", // optional — omit to launch the TUI with no initial prompt
  cwd: "/path/to/other-repo", // optional — defaults to process.cwd()
});
```

You can also [create your own provider](#custom-sandbox-providers) using `createBindMountSandboxProvider` or `createIsolatedSandboxProvider`.

## API

Sandcastle exports a programmatic `run()` function for use in scripts, CI pipelines, or custom tooling. The examples below use `docker()`, but any `SandboxProvider` works in its place.

```typescript
import { run, claudeCode } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

const result = await run({
  agent: claudeCode("claude-opus-4-8"),
  sandbox: docker(),
  promptFile: ".sandcastle/prompt.md",
});

console.log(result.iterations.length); // number of iterations executed
console.log(result.iterations); // per-iteration results with optional sessionId
console.log(result.commits); // array of { sha } for commits created
console.log(result.branch); // target branch name
```

### All options

```typescript
import { run, claudeCode } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

const result = await run({
  // Agent provider — required. Pass a model string to claudeCode().
  // Optional second arg for provider-specific options like effort level.
  agent: claudeCode("claude-opus-4-8", { effort: "high" }),

  // Sandbox provider — required. Any SandboxProvider works (docker, podman, vercel, or custom).
  // Provider-specific config (like imageName, mounts) lives inside the provider factory call.
  sandbox: docker({
    imageName: "sandcastle:local",
    // Optional: override the UID/GID used for --user flag (defaults to host UID/GID).
    // Must match the UID baked into the image. Pre-flight check catches mismatches.
    // containerUid: 1000,
    // containerGid: 1000,
    // Optional: mount host directories into the sandbox (e.g. package manager caches)
    // hostPath supports absolute, tilde-expanded (~), and relative paths (resolved from cwd).
    // sandboxPath supports absolute and relative paths (resolved from the sandbox repo directory).
    mounts: [
      { hostPath: "~/.npm", sandboxPath: "/home/agent/.npm", readonly: true },
      { hostPath: "data", sandboxPath: "data" }, // mounts <cwd>/data → <sandbox-repo>/data
    ],
    // Optional: SELinux volume label — "z" (default, shared), "Z" (private), or false (none).
    // No-op on non-SELinux systems (Docker Desktop on macOS/Windows, Linux without SELinux).
    selinuxLabel: "z",
    // Optional: provider-level env vars merged at launch time
    env: { DOCKER_SPECIFIC: "value" },
    // Optional: attach container to Docker network(s) — string or string[]
    network: "my-network",
    // Optional: add the container user to supplementary groups via --group-add.
    // Accepts group names or numeric GIDs (e.g. for a bind-mounted Docker socket).
    groups: ["docker", 999],
    // Optional: expose host devices via --device. Each entry is a full device
    // spec in host[:container[:permissions]] form (e.g. "/dev/kvm").
    devices: ["/dev/kvm"],
    // Optional: limit CPU resources via --cpus. Fractional values allowed (e.g. 1.5).
    // cpus: 2,
  }),

  // Host repo directory — replaces process.cwd() as the anchor for
  // .sandcastle/ artifacts (worktrees, logs, env, patches) and git operations.
  // Relative paths resolve against process.cwd(). Defaults to process.cwd().
  cwd: "../other-repo",

  // Branch strategy — controls how the agent's changes relate to branches.
  // Defaults to { type: "head" } for bind-mount and { type: "merge-to-head" } for isolated providers.
  branchStrategy: { type: "branch", branch: "agent/fix-42" },

  // Prompt source — provide one of these, not both.
  // Note: promptFile resolves against process.cwd(), NOT cwd.
  promptFile: ".sandcastle/prompt.md", // path to a prompt file
  // prompt: "Fix issue #42 in this repo", // OR an inline prompt string

  // Values substituted for {{KEY}} placeholders in the prompt.
  promptArgs: {
    ISSUE_NUMBER: "42",
  },

  // Maximum number of agent iterations to run before stopping. Default: 1
  maxIterations: 5,

  // Display name for this run, shown as a prefix in log output.
  name: "fix-issue-42",

  // Lifecycle hooks grouped by where they run: host or sandbox.
  hooks: {
    host: {
      onWorktreeReady: [{ command: "cp .env.example .env" }],
      onSandboxReady: [{ command: "echo setup done" }],
    },
    sandbox: {
      onSandboxReady: [{ command: "npm install" }],
    },
  },

  // Host-relative file paths to copy into the sandbox before the container starts.
  // Not supported with branchStrategy: { type: "head" }.
  copyToWorktree: [".env"],

  // Override default timeouts for built-in lifecycle steps.
  // Unset keys keep their defaults.
  timeouts: {
    copyToWorktreeMs: 120_000, // default: 60_000
    gitSetupMs: 30_000, // default: 10_000
    commitCollectionMs: 60_000, // default: 30_000
    mergeToHostMs: 60_000, // default: 30_000
  },

  // How to record progress. Default: write to a file under .sandcastle/logs/
  logging: {
    type: "file",
    path: ".sandcastle/logs/my-run.log",
    // Optional: forward the agent's output stream to your own observability system.
    // Fires for each text chunk, tool call, and raw stdout line the agent
    // produces. Errors thrown by the callback are swallowed so a broken
    // forwarder cannot kill the run.
    onAgentStreamEvent: (event) => {
      // event is { type: "text" | "toolCall" | "raw", iteration, timestamp, ... }
      myLogger.info(event);
    },
    // Optional: append every raw stdout line the agent emits to the same
    // log file, interleaved with the human-readable output. Includes lines
    // the provider's stream parser would otherwise drop. Intended for
    // debugging stuck or unexpected agent behaviour.
    verbose: true,
  },
  // logging: { type: "stdout", verbose: true }, // OR terminal mode (verbose: raw lines to stdout)

  // String (or array of strings) the agent emits to end the iteration loop early.
  // Default: "<promise>COMPLETE</promise>"
  completionSignal: "<promise>COMPLETE</promise>",

  // Idle timeout in seconds — resets whenever the agent produces output. Default: 600 (10 minutes)
  idleTimeoutSeconds: 600,

  // Grace window in seconds after the agent emits a completion signal but
  // before its process has exited (a "hanging process" — typically a spawned
  // `gh`/git child or MCP server keeping stdout open). Resets on every
  // subsequent output line so trailing data is still captured. Default: 60
  completionTimeoutSeconds: 60,

  // Structured output — extract a typed payload from the agent's stdout.
  // Requires maxIterations === 1 and the tag must appear in the prompt.
  // output: Output.object({ tag: "result", schema: z.object({ answer: z.number() }) }),
  // output: Output.string({ tag: "summary" }),
});

console.log(result.iterations.length); // number of iterations executed
console.log(result.completionSignal); // matched signal string, or undefined if none fired
console.log(result.commits); // array of { sha } for commits created
console.log(result.branch); // target branch name
```

### `createSandbox()` — reusable sandbox

Use `createSandbox()` when you need to run multiple agents (or multiple rounds of the same agent) inside a single sandbox. It creates the sandbox once, and you call `sandbox.run()` as many times as you need. This avoids repeated container startup costs and keeps all runs on the same branch.

Use `run()` instead when you only need a single one-shot invocation — it handles sandbox lifecycle automatically.

#### Basic single-run usage

```typescript
import { createSandbox, claudeCode } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

await using sandbox = await createSandbox({
  branch: "agent/fix-42",
  sandbox: docker(),
});

const result = await sandbox.run({
  agent: claudeCode("claude-opus-4-8"),
  prompt: "Fix issue #42 in this repo.",
});

console.log(result.commits); // [{ sha: "abc123" }]
```

#### Multi-run implement-then-review

```typescript
import { createSandbox, claudeCode } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

await using sandbox = await createSandbox({
  branch: "agent/fix-42",
  sandbox: docker(),
  hooks: { sandbox: { onSandboxReady: [{ command: "npm install" }] } },
});

// Step 1: implement
const implResult = await sandbox.run({
  agent: claudeCode("claude-opus-4-8"),
  promptFile: ".sandcastle/implement.md",
  maxIterations: 5,
});

// Step 2: review on the same branch, same container
const reviewResult = await sandbox.run({
  agent: claudeCode("claude-sonnet-4-6"),
  prompt: "Review the changes and fix any issues.",
});
```

Commits from all `run()` calls accumulate on the same branch. The sandbox container stays alive between runs, so installed dependencies and build artifacts persist.

`sandbox.exec()` lets the harness run shell commands directly in the same warm sandbox — handy for gating an implement step on a quick verification before kicking off the review:

```typescript
await using sandbox = await createSandbox({
  branch: "agent/fix-42",
  sandbox: docker(),
  hooks: { sandbox: { onSandboxReady: [{ command: "npm install" }] } },
});

await sandbox.run({
  agent: claudeCode("claude-opus-4-8"),
  promptFile: ".sandcastle/implement.md",
  maxIterations: 5,
});

// Verify before review — non-zero exitCode is returned, not thrown.
const tests = await sandbox.exec("npm test");
if (tests.exitCode !== 0) {
  throw new Error(`Tests failed:\n${tests.stdout}\n${tests.stderr}`);
}

await sandbox.run({
  agent: claudeCode("claude-sonnet-4-6"),
  prompt: "Review the changes and fix any issues.",
});
```

`cwd` defaults to the sandbox repo path, matching `interactive()`. Pass `cwd` to override.

#### Automatic cleanup with `await using`

`await using` calls `sandbox.close()` automatically when the block exits. If the sandbox has uncommitted changes, the worktree is preserved on disk; if clean, both container and worktree are removed.

#### Manual `close()` with `CloseResult`

```typescript
const sandbox = await createSandbox({
  branch: "agent/fix-42",
  sandbox: docker(),
});
// ... run agents ...
const closeResult = await sandbox.close();
if (closeResult.preservedWorktreePath) {
  console.log(`Worktree preserved at ${closeResult.preservedWorktreePath}`);
}
```

#### `CreateSandboxOptions`

| Option           | Type            | Default         | Description                                                                                                         |
| ---------------- | --------------- | --------------- | ------------------------------------------------------------------------------------------------------------------- |
| `branch`         | string          | —               | **Required.** Explicit branch for the sandbox                                                                       |
| `sandbox`        | SandboxProvider | —               | **Required.** Sandbox provider (e.g. `docker()`, `podman()`)                                                        |
| `cwd`            | string          | `process.cwd()` | Host repo directory — relative paths resolve against `process.cwd()`                                                |
| `hooks`          | SandboxHooks    | —               | Lifecycle hooks (`host.*`, `sandbox.*`) — run once at creation time                                                 |
| `copyToWorktree` | string[]        | —               | Host-relative file paths to copy into the sandbox at creation time                                                  |
| `timeouts`       | Timeouts        | —               | Override built-in lifecycle step timeouts (`copyToWorktreeMs`, `gitSetupMs`, `commitCollectionMs`, `mergeToHostMs`) |

#### `Sandbox`

| Property / Method       | Type                                                                     | Description                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `branch`                | string                                                                   | The branch the sandbox is on                                                                                              |
| `worktreePath`          | string                                                                   | Host path to the worktree                                                                                                 |
| `run(options)`          | `(SandboxRunOptions) => Promise<SandboxRunResult>`                       | Invoke an agent inside the existing sandbox                                                                               |
| `interactive(options)`  | `(SandboxInteractiveOptions) => Promise<SandboxInteractiveResult>`       | Launch an interactive session in the sandbox                                                                              |
| `exec(cmd, options?)`   | `(command: string, options?: SandboxExecOptions) => Promise<ExecResult>` | Run a shell command in the sandbox. `cwd` defaults to the sandbox repo path. Non-zero `exitCode` is returned, not thrown. |
| `close()`               | `() => Promise<CloseResult>`                                             | Tear down the container and sandbox                                                                                       |
| `[Symbol.asyncDispose]` | `() => Promise<void>`                                                    | Auto teardown via `await using`                                                                                           |

#### `SandboxRunOptions`

| Option                     | Type               | Default                       | Description                                                                                                                          |
| -------------------------- | ------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `agent`                    | AgentProvider      | —                             | **Required.** Agent provider (e.g. `claudeCode("claude-opus-4-8")`)                                                                  |
| `prompt`                   | string             | —                             | Inline prompt (mutually exclusive with `promptFile`)                                                                                 |
| `promptFile`               | string             | —                             | Path to prompt file (mutually exclusive with `prompt`)                                                                               |
| `promptArgs`               | PromptArgs         | —                             | Key-value map for `{{KEY}}` placeholder substitution                                                                                 |
| `maxIterations`            | number             | `1`                           | Maximum iterations to run                                                                                                            |
| `completionSignal`         | string \| string[] | `<promise>COMPLETE</promise>` | String(s) the agent emits to stop the iteration loop early                                                                           |
| `idleTimeoutSeconds`       | number             | `600`                         | Idle timeout in seconds — resets on each agent output event                                                                          |
| `completionTimeoutSeconds` | number             | `60`                          | Grace window after the completion signal is seen but the agent process hasn't exited                                                 |
| `name`                     | string             | —                             | Display name for the run                                                                                                             |
| `logging`                  | object             | file (auto-generated)         | `{ type: 'file', path }` or `{ type: 'stdout' }`                                                                                     |
| `resumeSession`            | string             | —                             | Resume a prior session by ID for agents that support resume. Incompatible with `maxIterations > 1`. Session file must exist on host. |
| `signal`                   | AbortSignal        | —                             | Cancels the run when aborted; handle stays usable afterward                                                                          |

#### `SandboxRunResult`

| Field                      | Type                                                                                     | Description                                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `iterations`               | `IterationResult[]`                                                                      | Per-iteration results (use `.length` for the count)                                                                                 |
| `completionSignal`         | string?                                                                                  | The matched completion signal string, or `undefined` if none fired                                                                  |
| `stdout`                   | string                                                                                   | Combined agent output from all iterations                                                                                           |
| `commits`                  | `{ sha }[]`                                                                              | Commits created during the run                                                                                                      |
| `logFilePath`              | string?                                                                                  | Path to the log file (only when logging to a file)                                                                                  |
| `resume(prompt, options?)` | `(prompt: string, options?: ResumeSandboxRunResultOptions) => Promise<SandboxRunResult>` | Continue the captured session for one iteration inside the same warm sandbox. Present only when the provider captured a session id. |
| `fork(prompt, options?)`   | `(prompt: string, options?: ResumeSandboxRunResultOptions) => Promise<SandboxRunResult>` | Fork the captured session for one iteration inside the same warm sandbox. The parent session is left intact (ADR 0018).             |

#### `CloseResult`

| Field                   | Type    | Description                                                              |
| ----------------------- | ------- | ------------------------------------------------------------------------ |
| `preservedWorktreePath` | string? | Host path to the preserved worktree, set when it had uncommitted changes |

### `createWorktree()` — independent worktree lifecycle

Use `createWorktree()` when you need a worktree (git worktree) as an independent, first-class concept — separate from any sandbox. This is useful when you want to run an interactive session first and then hand the same worktree to a sandboxed AFK agent.

Only `branch` and `merge-to-head` strategies are accepted; `head` is a compile-time type error since it means no worktree.

Pass `cwd` to target a repo other than `process.cwd()`. Relative paths resolve against `process.cwd()`; absolute paths pass through. A `CwdError` is thrown if the path does not exist or is not a directory.

```typescript
import { createWorktree } from "@ai-hero/sandcastle";

await using wt = await createWorktree({
  branchStrategy: { type: "branch", branch: "agent/fix-42" },
  copyToWorktree: ["node_modules"],
  cwd: "/path/to/other-repo", // optional — defaults to process.cwd()
});

console.log(wt.worktreePath); // host path to the worktree
console.log(wt.branch); // "agent/fix-42"

// Run an interactive session in the worktree (defaults to noSandbox)
await wt.interactive({
  agent: claudeCode("claude-opus-4-8"),
  prompt: "Explore the codebase and understand the bug.",
});

// Run an AFK agent in the worktree (sandbox is required)
const result = await wt.run({
  agent: claudeCode("claude-opus-4-8"),
  sandbox: docker({ imageName: "sandcastle:myrepo" }),
  prompt: "Fix issue #42.",
  maxIterations: 3,
});
console.log(result.commits); // commits made during the run

// Create a long-lived sandbox from the worktree
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

await using sandbox = await wt.createSandbox({
  sandbox: docker(),
  hooks: { sandbox: { onSandboxReady: [{ command: "npm install" }] } },
});

// sandbox.close() tears down the container only — the worktree stays
await sandbox.close();

// wt.close() cleans up the worktree
```

`wt.close()` checks for uncommitted changes: if the worktree is dirty, it's preserved on disk; if clean, it's removed. `await using` calls `close()` automatically. The worktree persists after `run()`, `interactive()`, and `createSandbox()` complete, so you can hand it to another agent or inspect it.

With `branchStrategy: { type: "merge-to-head" }`, each `wt.run()` / `wt.interactive()` merges the agent's commits back to the host's current branch before returning, and the worktree's source branch is preserved across calls so subsequent ones can reuse the same handle. (This differs from top-level `run()`, where the temp branch is deleted after the merge.)

**Split ownership**: When a sandbox is created via `wt.createSandbox()`, `sandbox.close()` tears down the container only — the worktree remains. `wt.close()` is responsible for worktree cleanup. This differs from the top-level `createSandbox()`, where `sandbox.close()` owns both container and worktree.

#### `CreateWorktreeOptions`

| Option           | Type                   | Default | Description                                                                                                         |
| ---------------- | ---------------------- | ------- | ------------------------------------------------------------------------------------------------------------------- |
| `branchStrategy` | WorktreeBranchStrategy | —       | **Required.** `{ type: "branch", branch }` or `{ type: "merge-to-head" }`                                           |
| `copyToWorktree` | string[]               | —       | Host-relative file paths to copy into the worktree at creation time                                                 |
| `timeouts`       | Timeouts               | —       | Override built-in lifecycle step timeouts (`copyToWorktreeMs`, `gitSetupMs`, `commitCollectionMs`, `mergeToHostMs`) |

#### `Worktree`

| Property / Method        | Type                                                                  | Description                                         |
| ------------------------ | --------------------------------------------------------------------- | --------------------------------------------------- |
| `branch`                 | string                                                                | The branch the worktree is on                       |
| `worktreePath`           | string                                                                | Host path to the worktree                           |
| `run(options)`           | `(options: WorktreeRunOptions) => Promise<WorktreeRunResult>`         | Run an AFK agent in the worktree (sandbox required) |
| `interactive(options)`   | `(options: WorktreeInteractiveOptions) => Promise<InteractiveResult>` | Run an interactive agent session in the worktree    |
| `createSandbox(options)` | `(options: WorktreeCreateSandboxOptions) => Promise<Sandbox>`         | Create a long-lived sandbox backed by this worktree |
| `close()`                | `() => Promise<CloseResult>`                                          | Clean up the worktree (preserves if dirty)          |
| `[Symbol.asyncDispose]`  | `() => Promise<void>`                                                 | Auto cleanup via `await using`                      |

#### `WorktreeInteractiveOptions`

| Option       | Type                   | Default       | Description                                                                                       |
| ------------ | ---------------------- | ------------- | ------------------------------------------------------------------------------------------------- |
| `agent`      | AgentProvider          | —             | **Required.** Agent provider                                                                      |
| `sandbox`    | AnySandboxProvider     | `noSandbox()` | Sandbox provider (defaults to no sandbox)                                                         |
| `prompt`     | string                 | —             | Inline prompt (mutually exclusive with `promptFile`)                                              |
| `promptFile` | string                 | —             | Path to prompt file                                                                               |
| `name`       | string                 | —             | Optional session name                                                                             |
| `hooks`      | SandboxHooks           | —             | Lifecycle hooks (`host.*`, `sandbox.*`)                                                           |
| `promptArgs` | PromptArgs             | —             | Key-value map for `{{KEY}}` placeholder substitution                                              |
| `env`        | Record<string, string> | —             | Environment variables to inject into the sandbox                                                  |
| `signal`     | AbortSignal            | —             | Cancel the session when aborted. The worktree is preserved on disk. Rejects with `signal.reason`. |

#### `WorktreeRunOptions`

| Option                     | Type                   | Default | Description                                                                                                                          |
| -------------------------- | ---------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `agent`                    | AgentProvider          | —       | **Required.** Agent provider                                                                                                         |
| `sandbox`                  | SandboxProvider        | —       | **Required.** Sandbox provider (AFK agents must be sandboxed)                                                                        |
| `prompt`                   | string                 | —       | Inline prompt (mutually exclusive with `promptFile`)                                                                                 |
| `promptFile`               | string                 | —       | Path to prompt file                                                                                                                  |
| `maxIterations`            | number                 | 1       | Maximum iterations to run                                                                                                            |
| `completionSignal`         | string \| string[]     | —       | Substring(s) to stop the iteration loop early                                                                                        |
| `idleTimeoutSeconds`       | number                 | 600     | Idle timeout in seconds                                                                                                              |
| `completionTimeoutSeconds` | number                 | 60      | Grace window after completion signal is seen but agent process hasn't exited                                                         |
| `name`                     | string                 | —       | Optional run name                                                                                                                    |
| `logging`                  | LoggingOption          | file    | Logging mode                                                                                                                         |
| `hooks`                    | SandboxHooks           | —       | Lifecycle hooks (`host.*`, `sandbox.*`)                                                                                              |
| `promptArgs`               | PromptArgs             | —       | Key-value map for `{{KEY}}` placeholder substitution                                                                                 |
| `env`                      | Record<string, string> | —       | Environment variables to inject into the sandbox                                                                                     |
| `resumeSession`            | string                 | —       | Resume a prior session by ID for agents that support resume. Incompatible with `maxIterations > 1`. Session file must exist on host. |
| `signal`                   | AbortSignal            | —       | Cancel the run when aborted. Kills the in-flight agent subprocess; the worktree is preserved on disk. Rejects with `signal.reason`.  |

#### `WorktreeRunResult`

| Property           | Type                | Description                                            |
| ------------------ | ------------------- | ------------------------------------------------------ |
| `iterations`       | `IterationResult[]` | Per-iteration results (use `.length` for the count)    |
| `completionSignal` | string              | The matched completion signal, or undefined            |
| `stdout`           | string              | Combined stdout output from all agent iterations       |
| `commits`          | { sha: string }[]   | List of commits made by the agent during the run       |
| `branch`           | string              | The branch name the agent worked on                    |
| `logFilePath`      | string              | Path to the log file, if logging was drained to a file |

#### `WorktreeCreateSandboxOptions`

| Option           | Type            | Default | Description                                                                                                         |
| ---------------- | --------------- | ------- | ------------------------------------------------------------------------------------------------------------------- |
| `sandbox`        | SandboxProvider | —       | **Required.** Sandbox provider (e.g. `docker()`)                                                                    |
| `hooks`          | SandboxHooks    | —       | Lifecycle hooks (`host.*`, `sandbox.*`)                                                                             |
| `copyToWorktree` | string[]        | —       | Host-relative file paths to copy into the worktree at creation time                                                 |
| `timeouts`       | Timeouts        | —       | Override built-in lifecycle step timeouts (`copyToWorktreeMs`, `gitSetupMs`, `commitCollectionMs`, `mergeToHostMs`) |

## How it works

Sandcastle uses a **branch strategy** configured on the sandbox provider to control how the agent's changes relate to branches. There are three strategies:

- **Head** (`{ type: "head" }`) — The agent writes directly to the host working directory. No worktree, no branch indirection. This is the default for bind-mount providers like `docker()`.
- **Merge-to-head** (`{ type: "merge-to-head" }`) — Sandcastle creates a temporary branch in a git worktree. The agent works on the temp branch, and changes are merged back to HEAD when done. The temp branch is cleaned up after merge.
- **Branch** (`{ type: "branch", branch: "foo" }`) — Commits land on an explicitly named branch in a git worktree. Re-running with the same branch reuses the existing worktree and fast-forwards it from `origin` when safe — see [ADR 0003](docs/adr/0003-reuse-worktree-by-default.md).

For bind-mount providers (like Docker), the worktree directory is bind-mounted into the container — the agent writes directly to the host filesystem through the mount, so no sync is needed.

From your point of view, you just configure `branchStrategy: { type: 'branch', branch: 'foo' }` on `run()`, and get a commit on branch `foo` once it's complete. All 100% local.

## Prompts

Sandcastle uses a flexible prompt system. You write the prompt, and the engine executes it — no opinions about workflow, task management, or context sources are imposed.

### Prompt resolution

You must provide exactly one of:

1. `prompt: "inline string"` — pass an inline prompt directly via `RunOptions`
2. `promptFile: "./path/to/prompt.md"` — point to a specific file via `RunOptions`

`prompt` and `promptFile` are mutually exclusive — providing both is an error. If neither is provided, `run()` throws an error asking you to supply one.

**Inline prompts (`prompt: "..."`) are passed to the agent literally.** No `{{KEY}}` substitution, no `` !`command` `` expansion, no built-in `{{SOURCE_BRANCH}}` / `{{TARGET_BRANCH}}` injection. If you need values interpolated into an inline prompt, build the string in JavaScript (`` `Work on ${branch}…` ``). Passing `promptArgs` alongside an inline prompt is an error — switch to `promptFile` to use substitution.

The substitution and expansion features below apply **only** to prompts sourced from `promptFile`.

> **Convention**: `sandcastle init` scaffolds `.sandcastle/prompt.md` and all templates explicitly reference it via `promptFile: ".sandcastle/prompt.md"`. This is a convention, not an automatic fallback — Sandcastle does not read `.sandcastle/prompt.md` unless you pass it as `promptFile`.

### Dynamic context with `` !`command` ``

Use `` !`command` `` expressions in your prompt to pull in dynamic context. Each expression is replaced with the command's stdout before the prompt is sent to the agent. All expressions in a prompt run **in parallel** for faster expansion.

Commands run **inside the sandbox** after `sandbox.onSandboxReady` hooks complete, so they see the same repo state the agent sees (including installed dependencies).

```markdown
# Open issues

!`gh issue list --state open --label Sandcastle --json number,title,body,comments,labels --limit 100`

# Recent commits

!`git log --oneline -10`
```

If any command exits with a non-zero code, the run fails immediately with an error.

### Prompt arguments with `{{KEY}}`

Use `{{KEY}}` placeholders in your prompt to inject values from the `promptArgs` option. This is useful for reusing the same prompt file across multiple runs with different parameters.

```typescript
import { run } from "@ai-hero/sandcastle";

await run({
  promptFile: "./my-prompt.md",
  promptArgs: { ISSUE_NUMBER: 42, PRIORITY: "high" },
});
```

In the prompt file:

```markdown
Work on issue #{{ISSUE_NUMBER}} (priority: {{PRIORITY}}).
```

Prompt argument substitution runs on the host before shell expression expansion, so `{{KEY}}` placeholders inside `` !`command` `` expressions are replaced first:

```markdown
!`gh issue view {{ISSUE_NUMBER}} --json body -q .body`
```

A `{{KEY}}` placeholder with no matching prompt argument is an error. Unused prompt arguments produce a warning.

`` !`command` `` expansion only runs on shell blocks written in the prompt file itself. Any `` !`…` `` pattern that appears inside an argument value is treated as inert text — it won't be executed against the host shell. This makes it safe to pass user-authored content (issue titles, PR descriptions, docs excerpts) through `promptArgs`.

### Built-in prompt arguments

Sandcastle automatically injects two built-in prompt arguments into every prompt:

| Placeholder         | Value                                                             |
| ------------------- | ----------------------------------------------------------------- |
| `{{SOURCE_BRANCH}}` | The branch the agent works on (determined by the branch strategy) |
| `{{TARGET_BRANCH}}` | The host's active branch at `run()` time                          |

Use them in your prompt without passing them via `promptArgs`:

```markdown
You are working on {{SOURCE_BRANCH}}. When diffing, compare against {{TARGET_BRANCH}}.
```

Passing `SOURCE_BRANCH` or `TARGET_BRANCH` in `promptArgs` is an error — built-in prompt arguments cannot be overridden.

### Early termination with `<promise>COMPLETE</promise>`

When the agent outputs `<promise>COMPLETE</promise>`, the orchestrator stops the iteration loop early. This is a convention you document in your prompt for the agent to follow — the engine never injects it.

This is useful for task-based workflows where the agent should stop once it has finished, rather than running all remaining iterations.

You can override the default signal by passing `completionSignal` to `run()`. It accepts a single string or an array of strings:

```ts
await run({
  // ...
  completionSignal: "DONE",
});

// Or pass multiple signals — the loop stops on the first match:
await run({
  // ...
  completionSignal: ["TASK_COMPLETE", "TASK_ABORTED"],
});
```

Tell the agent to output your chosen string(s) in the prompt, and the orchestrator will stop when it detects any of them. The matched signal is returned as `result.completionSignal`.

#### Hanging processes after the completion signal

The agent process is expected to exit shortly after emitting the completion signal. When a child it spawned — a `gh`/git subprocess, a long-lived MCP server, etc. — inherits the agent's stdout pipe and keeps it open, the parent process can linger long past its logical end. Sandcastle would otherwise wait for the full `idleTimeoutSeconds` and fail with `AgentIdleTimeoutError`, throwing away the commits the agent already made.

Instead, once the completion signal is observed in the output buffer, Sandcastle swaps in a short **completion timeout** (default 60 s). When it expires, the run resolves successfully with a warning that the process was hanging; `result.commits` and `result.completionSignal` are populated as if the process had exited cleanly. The timer resets on every subsequent output line, so trailing data emitted after the signal — token-usage events, terminal `result` events, a structured-output `<tag>` — is still captured.

A clean process exit always wins the race, so healthy runs gain zero added latency. The completion timeout only matters when the process hangs.

Tune the window with `completionTimeoutSeconds`:

```ts
await run({
  // ...
  completionTimeoutSeconds: 30, // shorter grace window
});
```

This is independent of `idleTimeoutSeconds`. They cover different phases: `idleTimeoutSeconds` runs **before** any signal is seen (genuinely stuck agent → fail); `completionTimeoutSeconds` runs **after** the signal is seen (hanging process → succeed with warning). See [ADR 0019](docs/adr/0019-completion-timeout-for-hanging-process.md).

### Structured output

Use `Output.object()` to extract a typed, schema-validated JSON payload from the agent's stdout. The agent emits its answer inside an XML tag you specify, and Sandcastle parses, validates, and returns it on `result.output`. The schema can be any [Standard Schema](https://standardschema.dev) validator — the examples below use [Zod](https://zod.dev), but Valibot, ArkType, and others work identically. See [ADR 0010](docs/adr/0010-structured-output.md) for design rationale.

```ts
import { run, Output, claudeCode } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { z } from "zod";

const result = await run({
  agent: claudeCode("claude-opus-4-8"),
  sandbox: docker(),
  prompt: `Analyze the code, and output the result as JSON inside <result> tags.
    The result must match this schema:
    { summary: string; score: string }
  `,
  output: Output.object({
    tag: "result",
    schema: z.object({ summary: z.string(), score: z.number() }),
  }),
});

console.log(result.output.summary); // typed as string
console.log(result.output.score); // typed as number
```

`Output.string({ tag })` extracts the tag contents as a plain string (trimmed, no JSON parsing). Both helpers require `maxIterations` to be `1` (the default). The resolved prompt must contain the configured opening tag literal.

When extraction or validation fails, `run()` throws a `StructuredOutputError`. Alongside `tag`, `rawMatched`, `cause`, `commits`, `branch`, and `preservedWorktreePath`, the error carries the `sessionId` (and `sessionFilePath`, when the session was captured) of the run that produced the bad output.

Pass `maxRetries` to have Sandcastle handle the retry loop for you. Each retry resumes the same agent session and feeds back a token-efficient description of the error, so the agent can re-emit a corrected tag without redoing the work. Retries require an agent provider that supports session resumption (`claudeCode`, `codex`, `pi`) — calling `run()` with `maxRetries > 0` against a non-resumable provider (`cursor`, `opencode`, `copilot`) throws immediately.

```ts
const result = await run({
  agent: claudeCode("claude-opus-4-8"),
  sandbox: docker(),
  prompt: "Analyze the code and emit JSON inside <result> tags.",
  output: Output.object({
    tag: "result",
    schema: z.object({ summary: z.string(), score: z.number() }),
    maxRetries: 2, // 2 retries on top of the initial attempt
  }),
});
```

If you need to drive the retry loop manually — for example, to customise the feedback prompt or rotate models on each attempt — leave `maxRetries` at its default of `0` and resume the failed session yourself:

```ts
import { run, Output, StructuredOutputError } from "@ai-hero/sandcastle";

try {
  return await run({ ...opts, output });
} catch (e) {
  if (e instanceof StructuredOutputError && e.sessionId) {
    return await run({
      ...opts,
      output,
      resumeSession: e.sessionId,
      prompt: `Your previous output failed: ${e.message}. Re-emit it inside <${e.tag}> tags.`,
    });
  }
  throw e;
}
```

### Templates

`sandcastle init` prompts you to choose a sandbox provider (Docker or Podman), an issue tracker (GitHub Issues, Azure DevOps, Beads, or Custom), and a template, which scaffolds a ready-to-use prompt and `main.mts` suited to a specific workflow. If your project's `package.json` has `"type": "module"`, the file will be named `main.ts` instead. Choosing **Custom** scaffolds the project in a deliberately broken-until-configured state plus a `.sandcastle/SETUP_ISSUE_TRACKER.md` prompt you feed to your coding agent, which wires up your own tracker by editing the scaffolded files in place. Five templates are available:

| Template                       | Description                                                               |
| ------------------------------ | ------------------------------------------------------------------------- |
| `blank`                        | Bare scaffold — write your own prompt and orchestration                   |
| `simple-loop`                  | Picks issues one by one and closes them                                   |
| `sequential-reviewer`          | Implements issues one by one, with a code review step after each          |
| `parallel-planner`             | Plans parallelizable issues, executes on separate branches, then merges   |
| `parallel-planner-with-review` | Plans parallelizable issues, executes with per-branch review, then merges |

Select a template during `sandcastle init` when prompted, or re-run init in a fresh repo to try a different one.

## CLI commands

### `sandcastle init`

Scaffolds the `.sandcastle/` config directory and builds the container image. This is the first command you run in a new repo. You choose a sandbox provider (Docker or Podman) during init — selecting Podman writes a `Containerfile` instead of `Dockerfile` and uses `sandcastle podman build-image` for the build step.

Init detects your host package manager (npm, pnpm, yarn, or bun) from a `packageManager` field or lockfile, defaulting to npm. Templates whose `main` file imports a host dependency — the planner templates import [Zod](https://zod.dev) for their `<plan>` output schema — prompt you to install it with that package manager when it isn't already in your `package.json`, so the first `npx tsx .sandcastle/main.ts` doesn't fail with `ERR_MODULE_NOT_FOUND`.

Every interactive prompt has a paired `--flag` so the entire init can run non-interactively (e.g. in CI or a scripted setup). When stdin is not a TTY and a required flag is missing, init fails fast with a clear error rather than wedging on a prompt.

| Option                    | Required | Default                      | Description                                                                                                    |
| ------------------------- | -------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `--image-name`            | No       | `sandcastle:<repo-dir-name>` | Docker image name                                                                                              |
| `--agent`                 | No       | Interactive prompt           | Agent to use (`claude-code`, `pi`, `codex`, `cursor`, `opencode`, `copilot`)                                   |
| `--model`                 | No       | Agent's default model        | Model to use (e.g. `claude-sonnet-4-6`). Defaults to agent's default                                           |
| `--sandbox`               | No       | Interactive prompt           | Sandbox provider to use (`docker`, `podman`)                                                                   |
| `--template`              | No       | Interactive prompt           | Template to scaffold (e.g. `blank`, `simple-loop`)                                                             |
| `--issue-tracker`         | No       | Interactive prompt           | Issue tracker to use (`github-issues`, `azure-devops`, `beads`, `custom`)                                      |
| `--create-label`          | No       | Interactive prompt           | `true` / `false` — whether to create the `Sandcastle` GitHub label (only with `--issue-tracker github-issues`) |
| `--build-image`           | No       | Interactive prompt           | `true` / `false` — whether to build the sandbox image now (silently ignored with `--issue-tracker custom`)     |
| `--install-template-deps` | No       | Interactive prompt           | `true` / `false` — whether to install template host deps (e.g. `zod` for the planner templates)                |

Creates the following files:

```
.sandcastle/
├── Dockerfile      # Sandbox environment (customize as needed)
├── prompt.md       # Agent instructions
├── .env.example    # Token placeholders
└── .gitignore      # Ignores .env, logs/
```

Errors if `.sandcastle/` already exists to prevent overwriting customizations.

### `sandcastle docker build-image`

Rebuilds the Docker image from an existing `.sandcastle/` directory. Use this after modifying the Dockerfile. On Linux/macOS, the build automatically passes `--build-arg AGENT_UID=$(id -u)` and `AGENT_GID=$(id -g)` so the image's `agent` user matches the host UID — this prevents permission errors on image-built files without runtime chown.

| Option         | Required | Default                      | Description                                                                       |
| -------------- | -------- | ---------------------------- | --------------------------------------------------------------------------------- |
| `--image-name` | No       | `sandcastle:<repo-dir-name>` | Docker image name                                                                 |
| `--dockerfile` | No       | —                            | Path to a custom Dockerfile (build context will be the current working directory) |

### `sandcastle docker remove-image`

Removes the Docker image.

| Option         | Required | Default                      | Description       |
| -------------- | -------- | ---------------------------- | ----------------- |
| `--image-name` | No       | `sandcastle:<repo-dir-name>` | Docker image name |

### `sandcastle podman build-image`

Builds the Podman image from an existing `.sandcastle/` directory. Use this after modifying the Containerfile.

| Option            | Required | Default                      | Description                                                                          |
| ----------------- | -------- | ---------------------------- | ------------------------------------------------------------------------------------ |
| `--image-name`    | No       | `sandcastle:<repo-dir-name>` | Podman image name                                                                    |
| `--containerfile` | No       | —                            | Path to a custom Containerfile (build context will be the current working directory) |

### `sandcastle podman remove-image`

Removes the Podman image.

| Option         | Required | Default                      | Description       |
| -------------- | -------- | ---------------------------- | ----------------- |
| `--image-name` | No       | `sandcastle:<repo-dir-name>` | Podman image name |

### `RunOptions`

| Option                     | Type               | Default                       | Description                                                                                                                                                                                                                  |
| -------------------------- | ------------------ | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent`                    | AgentProvider      | —                             | **Required.** Agent provider (e.g. `claudeCode("claude-opus-4-8")`, `pi("claude-sonnet-4-6")`, `codex("gpt-5.4")`, `cursor("composer-2")`, `opencode("opencode/big-pickle")`, `copilot("claude-sonnet-4.5")`)                |
| `sandbox`                  | SandboxProvider    | —                             | **Required.** Sandbox provider (e.g. `docker()`, `podman()`, `docker({ imageName: "sandcastle:local" })`)                                                                                                                    |
| `cwd`                      | string             | `process.cwd()`               | Host repo directory — anchor for `.sandcastle/` artifacts and git operations. Relative paths resolve against `process.cwd()`.                                                                                                |
| `prompt`                   | string             | —                             | Inline prompt (mutually exclusive with `promptFile`)                                                                                                                                                                         |
| `promptFile`               | string             | —                             | Path to prompt file (mutually exclusive with `prompt`). Resolves against `process.cwd()`, **not** `cwd`.                                                                                                                     |
| `maxIterations`            | number             | `1`                           | Maximum iterations to run                                                                                                                                                                                                    |
| `hooks`                    | SandboxHooks       | —                             | Lifecycle hooks (`host.*`, `sandbox.*`)                                                                                                                                                                                      |
| `name`                     | string             | —                             | Display name for the run, shown as a prefix in log output                                                                                                                                                                    |
| `promptArgs`               | PromptArgs         | —                             | Key-value map for `{{KEY}}` placeholder substitution                                                                                                                                                                         |
| `branchStrategy`           | BranchStrategy     | per-provider default          | Branch strategy: `{ type: 'head' }`, `{ type: 'merge-to-head' }`, or `{ type: 'branch', branch: '…' }`                                                                                                                       |
| `copyToWorktree`           | string[]           | —                             | Host-relative file paths to copy into the sandbox before start (not supported with `branchStrategy: { type: 'head' }`)                                                                                                       |
| `logging`                  | object             | file (auto-generated)         | `{ type: 'file', path }` or `{ type: 'stdout' }`                                                                                                                                                                             |
| `completionSignal`         | string \| string[] | `<promise>COMPLETE</promise>` | String or array of strings the agent emits to stop the iteration loop early                                                                                                                                                  |
| `idleTimeoutSeconds`       | number             | `600`                         | Idle timeout in seconds — resets on each agent output event                                                                                                                                                                  |
| `completionTimeoutSeconds` | number             | `60`                          | Grace window in seconds after the completion signal is observed but the agent process has not exited (hanging process). See [Hanging processes after the completion signal](#hanging-processes-after-the-completion-signal). |
| `resumeSession`            | string             | —                             | Resume a prior session by ID for agents that support resume. Incompatible with `maxIterations > 1`. Session file must exist on host.                                                                                         |
| `signal`                   | AbortSignal        | —                             | Cancel the run when aborted. Kills the in-flight agent subprocess and cancels lifecycle hooks; the worktree is preserved on disk. Rejects with `signal.reason`.                                                              |
| `timeouts`                 | Timeouts           | —                             | Override default timeouts for built-in lifecycle steps: `copyToWorktreeMs` (60 000), `gitSetupMs` (10 000), `commitCollectionMs` (30 000), `mergeToHostMs` (30 000).                                                         |
| `output`                   | OutputDefinition   | —                             | Structured output definition (`Output.object(…)` or `Output.string(…)`). Requires `maxIterations === 1`. See [Structured output](#structured-output).                                                                        |

### `RunResult`

| Field              | Type                | Description                                                        |
| ------------------ | ------------------- | ------------------------------------------------------------------ |
| `iterations`       | `IterationResult[]` | Per-iteration results (use `.length` for the count)                |
| `completionSignal` | string?             | The matched completion signal string, or `undefined` if none fired |
| `stdout`           | string              | Agent output                                                       |
| `commits`          | `{ sha }[]`         | Commits created during the run                                     |
| `branch`           | string              | Target branch name                                                 |
| `logFilePath`      | string?             | Path to the log file (only when logging to a file)                 |
| `output`           | T?                  | Typed structured output (only present when `output` option is set) |

### `IterationResult`

| Field             | Type              | Description                                                                                                                         |
| ----------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `sessionId`       | string?           | Agent session ID from the provider stream, or `undefined` if the provider does not emit one                                         |
| `sessionFilePath` | string?           | Absolute host path to the captured session JSONL, or `undefined` when capture is off                                                |
| `usage`           | `IterationUsage`? | Token usage snapshot from the last assistant message, or `undefined` when capture is off or provider does not support usage parsing |

### `IterationUsage`

| Field                      | Type   | Description                                |
| -------------------------- | ------ | ------------------------------------------ |
| `inputTokens`              | number | Input tokens consumed                      |
| `cacheCreationInputTokens` | number | Tokens used to create prompt cache entries |
| `cacheReadInputTokens`     | number | Tokens read from prompt cache              |
| `outputTokens`             | number | Output tokens generated                    |

### Session capture

After each resumable provider iteration, Sandcastle automatically captures the agent's session file from the sandbox to the host. Claude Code sessions are stored under `~/.claude/projects/<encoded-path>/<session-id>.jsonl`; Codex sessions are stored under `~/.codex/sessions/YYYY/MM/DD/rollout-*-<session-id>.jsonl`; Pi sessions are stored under `~/.pi/agent/sessions/--<encoded-cwd>--/<timestamp>_<session-id>.jsonl`. Any provider-specific `cwd` fields are rewritten to match the host repo root, so the provider's native resume command works.

For Claude Code, any `Agent`-tool or `Workflow`-tool subagent transcripts written under `<session-id>/subagents/agent-*.jsonl` are captured alongside the main session. Subagent capture is best-effort: a failure on an individual transcript logs a warning and lets siblings and the main session through. Main-session capture failure still fails the run (see below).

Session capture is enabled by default for `claudeCode()`, `codex()`, and `pi()` and can be opted out via `captureSessions: false`. Providers without `sessionStorage` do not attempt capture. Capture failure fails the run.

### Session resume

Pass `resumeSession` to `run()` to continue a prior Claude Code, Codex, or Pi conversation inside a new sandbox:

```typescript
const result = await run({
  agent: claudeCode("claude-opus-4-8"),
  sandbox: docker(),
  prompt: "Continue where you left off",
  resumeSession: "abc-123-def",
});
```

You can also continue the last captured session from a result:

```typescript
const first = await run({
  agent: codex("gpt-5.4"),
  sandbox: docker(),
  prompt: "Draft a plan",
});

const second = await first.resume?.("Now implement the plan");
```

`resume` is present only on results from resumable providers (Claude Code, Codex, Pi) — hence the optional-chaining call.

Before the sandbox starts, Sandcastle validates that the session file exists on the host and transfers it into the sandbox with `cwd` fields rewritten to match the sandbox-side path. Claude Code receives `--resume <id>`; Codex receives `codex exec resume <id>` with the prompt piped over stdin; Pi receives `--session <id>`.

Constraints:

- `resumeSession` is incompatible with `maxIterations > 1` (throws before sandbox creation).
- The provider's host session file must exist (throws before sandbox creation).
- Only iteration 1 receives the resume flag; subsequent iterations (if any) start fresh.
- Providers without resume support reject `resumeSession`.

### Session fork

`RunResult.fork(prompt, options?)` is the sibling of `.resume()`: it continues from the last captured session but leaves the parent session JSONL untouched and writes the child under a new session id. The mechanism is the agent's native fork flag — `claude --resume <id> --fork-session` for Claude Code, `codex exec fork <id>` for Codex.

Fork enables fan-out workflows where a single parent run is the starting point for several independent children:

```typescript
const parent = await run({
  agent: claudeCode("claude-opus-4-8"),
  sandbox: docker(),
  prompt: "Read the codebase and summarise the data model",
});

const [reviewA, reviewB] = await Promise.all([
  parent.fork?.("Review the migration plan", {
    branchStrategy: { type: "branch", branch: "review-a" },
  }),
  parent.fork?.("Audit the auth layer", {
    branchStrategy: { type: "branch", branch: "review-b" },
  }),
]);
```

**Fork is session-only.** `--fork-session` and `codex exec fork` isolate the agent session JSONL — they do **not** isolate the branch, worktree, or sandbox. Safe concurrent fan-out (`Promise.all([r.fork(a), r.fork(b)])`) requires the caller to give each child a distinct `branch` via `branchStrategy: { type: "branch", branch: "..." }`. The default `head` and `merge-to-head` strategies are **not** safe for concurrent forks: `head` shares the host working directory across all children, and `merge-to-head` races `git merge` against the same HEAD. See [ADR 0018](docs/adr/0018-fork-is-session-only.md).

`fork` is present only on results from providers with `sessionStorage` (Claude Code, Codex) — hence the optional-chaining call. The same single-iteration and session-file constraints as `.resume()` apply.

### `ClaudeCodeOptions`

The `claudeCode()` factory accepts an optional second argument for provider-specific options:

```typescript
agent: claudeCode("claude-opus-4-8", { effort: "high" });
```

| Option            | Type                                                                                           | Default | Description                                                                                                                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `effort`          | `"low"` \| `"medium"` \| `"high"` \| `"xhigh"` \| `"max"`                                      | —       | Claude Code reasoning effort level (`max` is Opus only)                                                                                                                                             |
| `env`             | `Record<string, string>`                                                                       | `{}`    | Environment variables injected by this agent provider                                                                                                                                               |
| `captureSessions` | `boolean`                                                                                      | `true`  | Capture agent session JSONL to host for `claude --resume`                                                                                                                                           |
| `permissionMode`  | `"default"` \| `"acceptEdits"` \| `"plan"` \| `"auto"` \| `"dontAsk"` \| `"bypassPermissions"` | —       | Maps to Claude's `--permission-mode` flag. When set, replaces Sandcastle's default `--dangerously-skip-permissions` on AFK runs. Use `"auto"` for AI-mediated per-tool approve/deny without bypass. |

### `CodexOptions`

The `codex()` factory accepts an optional second argument for provider-specific options:

```typescript
agent: codex("gpt-5.4", { effort: "high" });
```

| Option              | Type                                           | Default | Description                                                                                                                                                                                                           |
| ------------------- | ---------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `effort`            | `"low"` \| `"medium"` \| `"high"` \| `"xhigh"` | —       | Codex reasoning effort level via `model_reasoning_effort`                                                                                                                                                             |
| `env`               | `Record<string, string>`                       | `{}`    | Environment variables injected by this agent provider                                                                                                                                                                 |
| `captureSessions`   | `boolean`                                      | `true`  | Capture Codex rollout JSONL to host for resume                                                                                                                                                                        |
| `approvalsReviewer` | `"user"` \| `"auto_review"`                    | —       | Maps to Codex's `approvals_reviewer` config. When `"auto_review"`, swaps `--dangerously-bypass-approvals-and-sandbox` for `-a on-request -s danger-full-access` so the reviewer agent evaluates each approval prompt. |

### `PiOptions`

The `pi()` factory accepts an optional second argument for provider-specific options:

```typescript
agent: pi("claude-sonnet-4-6", { thinking: "high" });
```

| Option            | Type                                                                     | Default | Description                                              |
| ----------------- | ------------------------------------------------------------------------ | ------- | -------------------------------------------------------- |
| `thinking`        | `"off"` \| `"minimal"` \| `"low"` \| `"medium"` \| `"high"` \| `"xhigh"` | —       | Pi reasoning effort level via the `--thinking` flag      |
| `env`             | `Record<string, string>`                                                 | `{}`    | Environment variables injected by this agent provider    |
| `captureSessions` | `boolean`                                                                | `true`  | Capture pi session JSONL to host for `pi --session <id>` |

### Provider `env`

Both **agent providers** and **sandbox providers** accept an optional `env: Record<string, string>` in their options. These environment variables are merged with the `.sandcastle/.env` resolver output at launch time:

```typescript
await run({
  agent: claudeCode("claude-opus-4-8", {
    env: { ANTHROPIC_API_KEY: "sk-ant-..." },
  }),
  sandbox: docker({
    env: { DOCKER_SPECIFIC_VAR: "value" },
  }),
  prompt: "Fix issue #42",
});
```

**Merge rules:**

- Provider env (agent + sandbox) overrides `.sandcastle/.env` resolver output for shared keys
- Agent provider env and sandbox provider env **must not overlap** — if they share any key, `run()` throws an error
- When `env` is not provided, it defaults to `{}`

Environment variables are also resolved automatically from `.sandcastle/.env` and `process.env` — no need to pass them to the API. The required variables depend on the **agent provider** (see `sandcastle init` output for details).

## Custom Sandbox Providers

Sandcastle ships with built-in providers for Docker, Podman, and Vercel, but you can create your own. A sandbox provider tells Sandcastle how to execute commands in an isolated environment. There are two kinds:

- **Bind-mount** — the sandbox can mount a host directory. Sandcastle creates a worktree on the host and the provider mounts it in. No file sync needed. Use this for Docker, Podman, or any local container runtime.
- **Isolated** — the sandbox has its own filesystem (e.g. a cloud VM). The provider handles syncing code in and out via `copyIn` and `copyFileOut`. Use this when the sandbox cannot access the host filesystem.

### The sandbox handle contract

Both provider types return a **sandbox handle** from their `create()` function. The handle exposes:

| Method         | Required   | Description                                                                  |
| -------------- | ---------- | ---------------------------------------------------------------------------- |
| `exec`         | Both       | Run a command, optionally streaming stdout line-by-line via `options.onLine` |
| `close`        | Both       | Tear down the sandbox                                                        |
| `copyFileIn`   | Bind-mount | Copy a single file from the host into the sandbox                            |
| `copyFileOut`  | Both       | Copy a single file from the sandbox to the host                              |
| `copyIn`       | Isolated   | Copy a file or directory from the host into the sandbox                      |
| `worktreePath` | Both       | Absolute path to the repo directory inside the sandbox                       |

### `ExecResult`

Every `exec` call returns an `ExecResult`:

```typescript
interface ExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}
```

### Bind-mount provider example

A minimal bind-mount provider that shells out to local processes (no container):

```typescript
import {
  createBindMountSandboxProvider,
  type BindMountCreateOptions,
  type BindMountSandboxHandle,
  type ExecResult,
} from "@ai-hero/sandcastle";
import { execFile, spawn } from "node:child_process";
import { copyFile as fsCopyFile, mkdir as fsMkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createInterface } from "node:readline";

const localProcess = () =>
  createBindMountSandboxProvider({
    name: "local-process",
    create: async (
      options: BindMountCreateOptions,
    ): Promise<BindMountSandboxHandle> => {
      const worktreePath = options.worktreePath;

      return {
        worktreePath,

        exec: (
          command: string,
          opts?: { onLine?: (line: string) => void; cwd?: string },
        ): Promise<ExecResult> => {
          if (opts?.onLine) {
            const onLine = opts.onLine;
            return new Promise((resolve, reject) => {
              const proc = spawn("sh", ["-c", command], {
                cwd: opts?.cwd ?? worktreePath,
                stdio: ["ignore", "pipe", "pipe"],
              });

              const stdoutChunks: string[] = [];
              const stderrChunks: string[] = [];

              const rl = createInterface({ input: proc.stdout! });
              rl.on("line", (line) => {
                stdoutChunks.push(line);
                onLine(line); // forward each line to Sandcastle
              });

              proc.stderr!.on("data", (chunk: Buffer) => {
                stderrChunks.push(chunk.toString());
              });

              proc.on("error", (err) => reject(err));
              proc.on("close", (code) => {
                resolve({
                  stdout: stdoutChunks.join("\n"),
                  stderr: stderrChunks.join(""),
                  exitCode: code ?? 0,
                });
              });
            });
          }

          return new Promise((resolve, reject) => {
            execFile(
              "sh",
              ["-c", command],
              { cwd: opts?.cwd ?? worktreePath, maxBuffer: 10 * 1024 * 1024 },
              (error, stdout, stderr) => {
                if (error && error.code === undefined) {
                  reject(new Error(`exec failed: ${error.message}`));
                } else {
                  resolve({
                    stdout: stdout.toString(),
                    stderr: stderr.toString(),
                    exitCode: typeof error?.code === "number" ? error.code : 0,
                  });
                }
              },
            );
          });
        },

        copyFileIn: async (hostPath: string, sandboxPath: string) => {
          await fsMkdir(dirname(sandboxPath), { recursive: true });
          await fsCopyFile(hostPath, sandboxPath);
        },

        copyFileOut: async (sandboxPath: string, hostPath: string) => {
          await fsMkdir(dirname(hostPath), { recursive: true });
          await fsCopyFile(sandboxPath, hostPath);
        },

        close: async () => {
          // nothing to tear down for a local process
        },
      };
    },
  });
```

### Isolated provider example

A minimal isolated provider using a temp directory:

```typescript
import {
  createIsolatedSandboxProvider,
  type IsolatedSandboxHandle,
  type ExecResult,
} from "@ai-hero/sandcastle";
import { execFile, spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";

const tempDir = () =>
  createIsolatedSandboxProvider({
    name: "temp-dir",
    create: async (): Promise<IsolatedSandboxHandle> => {
      const root = await mkdtemp(join(tmpdir(), "sandbox-"));
      const worktreePath = join(root, "workspace");
      await mkdir(worktreePath, { recursive: true });

      return {
        worktreePath,

        exec: (
          command: string,
          opts?: { onLine?: (line: string) => void; cwd?: string },
        ): Promise<ExecResult> => {
          if (opts?.onLine) {
            const onLine = opts.onLine;
            return new Promise((resolve, reject) => {
              const proc = spawn("sh", ["-c", command], {
                cwd: opts?.cwd ?? worktreePath,
                stdio: ["ignore", "pipe", "pipe"],
              });

              const stdoutChunks: string[] = [];
              const stderrChunks: string[] = [];

              const rl = createInterface({ input: proc.stdout! });
              rl.on("line", (line) => {
                stdoutChunks.push(line);
                onLine(line);
              });

              proc.stderr!.on("data", (chunk: Buffer) => {
                stderrChunks.push(chunk.toString());
              });

              proc.on("error", (err) => reject(err));
              proc.on("close", (code) => {
                resolve({
                  stdout: stdoutChunks.join("\n"),
                  stderr: stderrChunks.join(""),
                  exitCode: code ?? 0,
                });
              });
            });
          }

          return new Promise((resolve, reject) => {
            execFile(
              "sh",
              ["-c", command],
              { cwd: opts?.cwd ?? worktreePath, maxBuffer: 10 * 1024 * 1024 },
              (error, stdout, stderr) => {
                if (error && error.code === undefined) {
                  reject(new Error(`exec failed: ${error.message}`));
                } else {
                  resolve({
                    stdout: stdout.toString(),
                    stderr: stderr.toString(),
                    exitCode: typeof error?.code === "number" ? error.code : 0,
                  });
                }
              },
            );
          });
        },

        copyIn: async (hostPath: string, sandboxPath: string) => {
          const info = await stat(hostPath);
          if (info.isDirectory()) {
            await cp(hostPath, sandboxPath, { recursive: true });
          } else {
            await mkdir(dirname(sandboxPath), { recursive: true });
            await copyFile(hostPath, sandboxPath);
          }
        },

        copyFileOut: async (sandboxPath: string, hostPath: string) => {
          await mkdir(dirname(hostPath), { recursive: true });
          await copyFile(sandboxPath, hostPath);
        },

        close: async () => {
          await rm(root, { recursive: true, force: true });
        },
      };
    },
  });
```

### Branch strategies

A branch strategy controls where the agent's commits land. Configure it when constructing the provider:

| Strategy        | Behavior                                                                 | Bind-mount | Isolated  |
| --------------- | ------------------------------------------------------------------------ | ---------- | --------- |
| `head`          | Agent writes directly to the host working directory. No worktree created | Default    | N/A       |
| `merge-to-head` | Sandcastle creates a temp branch, merges back to HEAD when done          | Supported  | Default   |
| `branch`        | Commits land on an explicit named branch you provide                     | Supported  | Supported |

**When to use each:**

- **`head`** — fast iteration during development. No branch indirection, no merge step. Only works with bind-mount providers since the agent needs direct host filesystem access.
- **`merge-to-head`** — safe default for automation. The agent works on a throwaway branch; if something goes wrong, HEAD is untouched. Use this for CI or unattended runs.
- **`branch`** — when you want commits on a specific branch (e.g. for a PR). Pass `{ type: "branch", branch: "agent/fix-42" }`.

Branch strategy is now configured on `run()`, not on the provider:

```typescript
import { run, claudeCode } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

// head — direct write, bind-mount only (default for bind-mount providers)
await run({
  agent: claudeCode("claude-opus-4-8"),
  sandbox: docker(),
  prompt: "…",
});
// merge-to-head — temp branch, merge back (default for isolated providers)
await run({
  agent: claudeCode("claude-opus-4-8"),
  sandbox: tempDir(),
  prompt: "…",
});
// branch — explicit named branch
await run({
  agent: claudeCode("claude-opus-4-8"),
  sandbox: docker(),
  branchStrategy: { type: "branch", branch: "agent/fix-42" },
  prompt: "…",
});
```

### Passing to `run()`

Pass your custom provider via the `sandbox` option — it works the same as the built-in `docker()` provider:

```typescript
import { run, claudeCode } from "@ai-hero/sandcastle";

const result = await run({
  agent: claudeCode("claude-opus-4-8"),
  sandbox: localProcess(), // your custom provider
  prompt: "Fix issue #42 in this repo.",
});
```

### Reference implementations

For real-world examples, see:

- [`src/sandboxes/docker.ts`](src/sandboxes/docker.ts) — bind-mount provider using Docker containers (with SELinux label support)
- [`src/sandboxes/vercel.ts`](src/sandboxes/vercel.ts) — isolated provider using Vercel Firecracker microVMs via `@vercel/sandbox`
- [`src/sandboxes/podman.ts`](src/sandboxes/podman.ts) — bind-mount provider using Podman containers (with SELinux label support)
- [`src/sandboxes/test-isolated.ts`](src/sandboxes/test-isolated.ts) — isolated provider using temp directories (used in tests)

## Configuration

### Config directory (`.sandcastle/`)

All per-repo sandbox configuration lives in `.sandcastle/`. Run `sandcastle init` to create it.

### Custom Dockerfile

The `.sandcastle/Dockerfile` controls the sandbox environment. The default template installs:

- **Node.js 22** (base image)
- **git**, **curl**, **jq** (system dependencies)
- **GitHub CLI** (`gh`) for GitHub Issues, or the selected issue tracker CLI
- **Claude Code CLI**
- A non-root `agent` user (required — Claude runs as this user)

When customizing the Dockerfile, ensure you keep:

- A non-root user (the default `agent` user) for Claude to run as
- `git` (required for commits and branch operations)
- The selected issue tracker CLI, such as `gh` for GitHub Issues or `az` plus the Azure DevOps extension for Azure DevOps
- Claude Code CLI installed and on PATH

Add your project-specific dependencies (e.g., language runtimes, build tools) to the Dockerfile as needed.

### Hooks

Hooks are grouped by **where** they run — `host` (on the developer's machine) or `sandbox` (inside the container):

```ts
hooks: {
  host: {
    onWorktreeReady: [{ command: "cp .env.example .env" }],
    onSandboxReady:  [{ command: "echo sandbox is up" }],
  },
  sandbox: {
    onSandboxReady: [
      { command: "npm install", timeoutMs: 300_000 },
      { command: "apt-get install -y ffmpeg", sudo: true },
    ],
  },
}
```

| Hook                     | Runs on | When                                         | Working directory                           |
| ------------------------ | ------- | -------------------------------------------- | ------------------------------------------- |
| `host.onWorktreeReady`   | Host    | After `copyToWorktree`, before sandbox start | Worktree path (host repo root under `head`) |
| `host.onSandboxReady`    | Host    | After sandbox is up                          | Worktree path (host repo root under `head`) |
| `sandbox.onSandboxReady` | Sandbox | After sandbox is up                          | Sandbox repo directory                      |

**Ordering:** `copyToWorktree` -> `host.onWorktreeReady` (sequential) -> sandbox created -> `host.onSandboxReady` + `sandbox.onSandboxReady` (parallel).

- **Host hooks** accept `{ command: string; timeoutMs?: number }` — no `sudo`, no `cwd`. Use `cd` or inline env in the command string.
- **Sandbox hooks** accept `{ command: string; sudo?: boolean; timeoutMs?: number }` — set `sudo: true` for elevated privileges.
- **`timeoutMs`** overrides the default 60 s per-hook timeout. Useful for long-running setup commands like dependency installs (e.g. `timeoutMs: 300_000` for 5 minutes).
- Within each hook point, sandbox hooks run in parallel; host hooks within `onSandboxReady` also run in parallel with sandbox hooks. `host.onWorktreeReady` hooks run sequentially in declared order.
- If any hook exits non-zero, setup fails fast.
- When a `signal` is passed to `run()`, it is threaded to all hooks — aborting the signal cancels any in-flight hook commands.

## Offline immutable design approval

The slice-15 design gate is a **host-composed offline primitive**, not a daemon,
phase runner, live ADO client, or operational end-to-end workflow. It binds one
canonical work item, an explicitly host-authorized occurrence `G`, and immutable
design `D` (the exact proposal plus exact referenced artifact versions).

```ts
import {
  startDevSquadAdoDesignApproval,
  reconcileDevSquadAdoDesignApproval,
  recoverDevSquadAdoDesignApproval,
  type DevSquadAdoDesignStartRequest,
  type DevSquadAdoDesignStartDependencies,
} from "@ai-hero/sandcastle";

// The host supplies trusted offline adapters, a current ledger capability,
// exact material, and an explicitly authorized occurrence. No fake live adapter.
async function reviewOnce(
  request: DevSquadAdoDesignStartRequest,
  host: DevSquadAdoDesignStartDependencies,
) {
  const result = await startDevSquadAdoDesignApproval(request, host);
  // Inspect durableState, verificationStatus, targetHandoff, reason, binding,
  // knownRevision and checkpointRevisions separately. Do not execute a phase.
  return result;
}
```

Executable offline examples are in
[`src/DevSquadAdoDesignApproval.examples.test.ts`](src/DevSquadAdoDesignApproval.examples.test.ts).

### Effects and independent authorities

| Entry                                | Maximum checkpoints | Publisher calls | Purpose                                                                             |
| ------------------------------------ | ------------------: | --------------: | ----------------------------------------------------------------------------------- |
| `startDevSquadAdoDesignApproval`     |                   3 |               1 | Reserve one attempt, confirm publication, resolve a human decision                  |
| `reconcileDevSquadAdoDesignApproval` |                   2 |               0 | Advance missing stages of an existing reservation; no publisher dependency required |
| `recoverDevSquadAdoDesignApproval`   |                   0 |               0 | Inspect durable history and optionally verify the current target                    |

All coordinators must inject the same explicit host ledger root and namespace on
a supported trusted-owner local filesystem. A watcher comment signal or
claim-free discovery admission is **historical provenance only**. Its revision,
phase/status, owner/fence metadata, and cleanup result are not a current capability
or product approval. The gate never acquires, renews, transfers, or releases claims.

The host separately supplies: current ledger capability; exact same-state mutation
authorization; immutable design verification; independent publication verification;
immutable event-time human permission; and, when requested, current target proof.
A publisher locator/success echo is not a receipt. Existing control-plane comment
results do not supply these guarantees. Trusted adapters must not hide retries.

The published envelope shows `G`, `D`, proposal/manifest/target commitments, exact
artifact versions, and both commands. Submit exactly one of these as the **entire
comment**, substituting canonical 43-character unpadded base64url operands:

```text
/devsquad approve-design <G> <D>
/devsquad request-changes <G> <D>
```

Exactly one ASCII space separates tokens; command lengths are 112 and 113 UTF-8
bytes. No whitespace trimming, trailing newline, quotes, prose, aliases, substring
matching, `lgtm`, development checkpoint approval, or automatic approval is accepted.
Approval applies only to that occurrence and immutable design. Changes requested
never authorizes implementation. Revised material requires an independently
authorized new occurrence and fresh human review, not approval transfer.

The decision adapter must supply a certified contiguous **immutable event-version
prefix** after the verified proposal anchor: fixed snapshot/cursor, complete
coverage, event actors, bodies and version chains, including unrelated events,
edits and deletes. Current visible comments alone are insufficient. A command
introduced by an edit is evaluated at that edit's ordinal; deletion does not erase
an earlier decision. Opaque IDs are equality-only, never chronology. First eligible
explicit human grant wins; an earlier unresolved authorization blocks later
commands, while explicit denial may be skipped. Durable resolution has one shared
approval/change-request slot. In-memory selection is not effective approval.

### Uncertainty runbook

**Permanent publication loss is an accepted tradeoff.** Only the timely direct
fresh reservation acknowledgement permits the original invocation's single
`publishOnce` call. The attempt remains consumed even if the process stops before
that call. History, replay, readback, restart, timeout and late acknowledgements
never recreate permission. The guarantee is at most one gate-mediated application
invocation, **not exactly-once tracker storage** or downstream delivery.

| Condition                                        | Safe operator/host action                                                                                                                                                                                        |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reservation/write outcome unknown                | Use read-only recovery to inspect durable state. Do not repeat publication or manufacture another occurrence.                                                                                                    |
| Consumed attempt or lost publisher response      | Investigate existing host evidence. Reconcile only a verified receipt attributable to the original attempt, using current mutation authority. Permanently missing evidence may block permanently.                |
| Missing/ambiguous publication or decision prefix | Restore authoritative immutable witnesses if available; do not infer success, skip unresolved candidates, or bypass approval.                                                                                    |
| Capacity exceeded after reservation              | Keep the occurrence blocked. No reserved future capacity, sidecar, outbox, eviction, migration or automatic rollover is provided.                                                                                |
| Corrupt/unsupported ledger                       | Fail closed; preserve evidence. Do not fall back from corrupt highest state to an older apparent approval.                                                                                                       |
| Unsupported production Windows platform          | The ledger cannot currently establish required permissions/directory-sync guarantees. Portable offline test fixtures do not make production Windows durable.                                                     |
| Target missing/mismatched/stale                  | Preserve historical design approval separately, but block target-specific handoff. Restore original witnesses and independently observe current state; never infer historical target from current ledger fields. |

Optional `targetVerification` supplies the original descriptor and a host-issued
nonsecret request challenge. The target verifier checks exact repository, immutable
source/content, branch, absolute worktree path/identity and bound agent/session
references. Proof age is at most five seconds at return. `verified-current` is
**descriptive only**, not a lock, executable resume instruction or present-day human
reauthorization. The host must revalidate at any later execution boundary.

Recovered durable approval may coexist with `evidence-unavailable` or blocked target
handoff. Never treat `durableState: "approved"` alone as verification of newly
supplied material. Results and durable gate checkpoints exclude bodies, reviewer
prose, tokens, credentials, session contents and dependency diagnostics. Hashes
are commitments, not encryption or secret detection; publish only host-approved
nonsecret material.

### Bounds and liveness

Fixed ceilings (UTF-8 / canonical serialized bytes, never silent truncation):
proposal 32 KiB; manifest 16 KiB/64 artifacts; target 8 KiB; rendering 64 KiB;
evidence identifier 256 bytes; cursor 1 KiB; 8 pages/16 events each/128 total;
event body 4 KiB; normalized decision stream 256 KiB; individual publication or
selection/authorization package 16 KiB; retained non-ledger logical payload 1 MiB.
Public ledger records are at most 16 MiB, with 10,000 entries per checkpoint,
agent or session history; invocation inspection is capped at 7 records, 112 MiB,
210,000 history-entry visits and two simultaneous full projected records. These
are logical processing limits, not JavaScript heap isolation guarantees.

A start permits at most **150 dependency calls**: 4 reads, 3 checkpoints, 3 mutation
grants, 1 design verifier, 1 publisher, 1 publication verifier, 8 pages, 128 human
grants and 1 current-target verifier. Failures count; there are zero automatic
retries. Whole invocation deadline is 180,000 ms; ledger/design/publication/page/
current-target calls get at most 5,000 ms, mutation/human grants 1,000 ms and
publisher 10,000 ms, further limited by remaining invocation time. Cancellation and
timeout retire continuations and request cooperative cancellation. They cannot
cancel an unsettled ledger write or hard-terminate a noncooperating in-process
adapter; late settlement cannot launch more effects or upgrade a completed result.

Canonical Windows `npm run build` also has a **separate packaging limitation**:
POSIX `rm`/`cp` postbuild commands may fail even after ESM and DTS generation
succeeds. Successful compilation/declaration checks do not establish packaging,
global-suite or production Windows durability success.

Slice 16 still owns the plugin resumable phase runner and Sandcastle delegation;
slice 17 broader feedback routing; slice 18 human-confirmed finalization and
pause/resume/cancel/status/audit; slice 19 real host-side ADO MCP transport.
No later-slice execution, merge authority, or live integration is delivered here.

## Host-selected DevSquad/ADO phase runner

`runDevSquadAdoPhase()` executes **one phase occurrence selected by the host**.
It does not choose phase names, advance a lifecycle, acquire or renew a claim, or
contact ADO. A same-state schema-v1 checkpoint reserves the occurrence before any
handler or Sandcastle invocation, and a second checkpoint records only a minimized
terminal commitment after successful validation or a settled validation failure.

```ts
import {
  runDevSquadAdoPhase,
  recoverDevSquadAdoPhase,
  type DevSquadAdoPhaseDependencies,
  type RunDevSquadAdoPhaseRequest,
} from "@ai-hero/sandcastle";

async function runOneSelectedPhase(
  request: RunDevSquadAdoPhaseRequest,
  host: DevSquadAdoPhaseDependencies,
) {
  const result = await runDevSquadAdoPhase(request, host);
  if (result.state === "pending") {
    // Read only: never rotate occurrence IDs or retry an uncertain effect.
    return recoverDevSquadAdoPhase(request, {
      ledger: host.ledger,
      utcNow: host.utcNow,
      monotonicNow: host.monotonicNow,
      verifyTerminalReceipt: host.verifyTerminalReceipt,
    });
  }
  return result;
}
```

The host must explicitly authorize the exact reservation, every dispatch, and the
terminal mutation. Implementation also requires the retained slice-15 approval,
a fresh trusted rehydration of its actual human/publication/material evidence, and
a fresh exact target proof. The design verifier receives the captured execution
mode and provider names; Sandcastle provider functions and configuration are
snapshotted before the first await. Supplied execution seams remain supported.

A terminal `dp16` operation ID is only a public integrity commitment. Another
holder of generic workflow-ledger mutation authority can compute one, so recovery
and repeat calls return a terminal state only when `verifyTerminalReceipt`
rehydrates its exact policy/design/execution audit trail. Without that evidence
the result is `blocked` with `receipt-unverified`.

### Phase uncertainty runbook

| Condition                                                                         | Safe host action                                                                                                 |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Reservation response missing, replayed, or malformed                              | Recover read-only. Do not dispatch or create another occurrence.                                                 |
| Execution/validation timed out, was cancelled, or returned malformed evidence     | Treat the reservation as consumed. Investigate externally; do not retry automatically.                           |
| Terminal response lost                                                            | Recover with the trusted terminal receipt verifier. The original effect is never repeated.                       |
| Design, human, publication, provider, or target evidence missing/stale/mismatched | Restore authoritative evidence and invoke a new policy evaluation; never infer authority from historical labels. |
| Ledger history malformed or overlapping                                           | Preserve the ledger and fail closed. Do not rewrite history.                                                     |

Executable deterministic examples and threat cases are in
`src/DevSquadAdoPhaseRunner*.test.ts`. This slice does not add feedback comments,
finalization/adjudication, or a live ADO adapter.

## Development

```bash
npm install
npm run build    # Bundle with tsup
npm test         # Run tests with vitest
npm run typecheck # Type-check
```

## License

MIT
