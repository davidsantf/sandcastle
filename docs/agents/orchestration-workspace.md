# User-local orchestration workspace

Requires Node 22.13+ and Git. The local SQLite file is the configuration source
of truth and also holds service, discovery and proposal records. Use the same
absolute file for every command and the core journal; do not copy it while a
service owns it. GitHub uses the current native `gh` account. The CLI's ADO read
transport uses an existing host-only `AZURE_DEVOPS_EXT_PAT`; embedded trusted
hosts may instead inject a bearer/PAT transport. Never put credentials in
configuration or generated prompts. This command does not log in or install tools.

## Onboarding

```powershell
sandcastle orchestrate workspace init --database C:\work\orchestration.sqlite --id my-work
sandcastle orchestrate workspace add --database C:\work\orchestration.sqlite --id api --repository-root C:\work\api --github my-org/api --mode integrated
sandcastle orchestrate workspace add --database C:\work\orchestration.sqlite --id app --repository-root C:\work\app --ado-organization my-org --ado-project Apps --ado-repository app --mode integrated
sandcastle orchestrate workspace list --database C:\work\orchestration.sqlite
sandcastle orchestrate workspace validate --database C:\work\orchestration.sqlite
```

Registration requires an existing exact Git checkout root, not a subdirectory.
It does not clone, change remotes, create a PR, or grant any effect permission.
Validation checks checkout roots/origins, native command flags, exact installed
phase definitions, focus and discovery registration. Its readiness output
separates `missingConfiguration` from `missingCapabilities`; unavailable executed
identity remains blocked in the default strict mode even when every local file
and flag is valid. Trusted-local mode is a separate explicit trust policy, not
backend attestation. Add
`validate --live` only to perform explicitly granted repository read-access
preflights. Item-level team/iteration/query membership is independently checked
during intake and refresh, not established by that preflight. It never launches a worker or performs hub writes, and zero evaluated
sources is not live verification.

`remove --id api` removes local registration only. It refuses to remove a project
referenced by a contract route; first use `route-remove`. It never removes the
repository or a remote item. Associated focus grants, priorities, discovery
sources and task templates are removed from configuration. Retained evidence is
not deleted. `--revision N` on edits rejects stale intent; every edit also uses
an atomic version comparison against its initial read.

## Trusted JSON setup

Pass plain local JSON files with `--file`. These files are host configuration,
not work-item instructions. Unknown fields in focus/routes/runtime/sources fail
validation. No executable authority module is loaded by workspace onboarding.

## GitHub label workflow

Opt a GitHub issue source into `workflow: {"kind":"github-labels","approver":"exact-login"}`
with `includeReviewFeedback:false`. Native source refresh excludes host stage/comment
churn from the approval revision, but changes to title/body/assignment/unrelated
labels invalidate it. Existing assignment OR exact opt-in eligibility is unchanged.
`orchestration-ready` remains an eligibility marker when unassigned; the other
stage label represents the current lifecycle.

| Label                                | Owner/action                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `orchestration-ready`                | User makes an issue eligible; assignment also remains valid eligibility                                                  |
| `orchestration-planning`             | Agent begins actual named investigation/specification/planning                                                           |
| `orchestration-user-approval`        | User reviews the published exact source/configuration/plan digest                                                        |
| `orchestration-implementation-ready` | Configured GitHub user adds this label after that plan comment                                                           |
| `orchestration-implementing`         | Host validates approval and dispatches implementation or an approved-scope fix                                           |
| `orchestration-reviewing`            | Separate read-only reviewer examines the exact implementation commit, approved artifacts and actual local validation     |
| `orchestration-finished`             | Reserved for genuine implementation, validation and required review/proof completion; not admission, merge or deployment |

This source does **not** use automatic bounded-local policy approval. Pre-existing,
third-party or stale labels cannot approve. Approval is bound to the exact
published comment and attributed immutable label event. Removing/replacing
approval before dispatch blocks it; host stage cleanup is journaled separately.
Unknown prior invocations across issue revisions block duplicate launch.
The host may create only the seven workflow labels and post necessary plan,
status and actionable findings comments. Issue text never grants write authority.
Remote effects reserve before mutation; exact retained remote evidence can
confirm an uncertain write, otherwise it is held rather than blindly retried.

Findings produce one deduplicated issue comment tied to reviewed commit/plan and
local validation, then automatically return to implementing and a fresh review.
Reviewer findings prefixed `APPROVAL_REQUIRED:` or any artifact amendments stop
automatic fixes and return to user approval; they never widen approved scope.
Separate invocation means actual read-only tool enforcement, **not** independent
backend identity attestation. Missing critical/independent evidence still blocks
completion, so this native host does not currently set `orchestration-finished`.
Failed/unknown reviewers, synchronization failures and exhausted limits are
visible blocked outcomes, not successful reviews.

Optional strict `runtime.reviewLoop: {"maxIterations":10}` accepts integers1-100;
omitting it uses10 for workflow sources. One iteration is one implementation
attempt followed by review. Initial implementation counts1; at most9 further
fix/review pairs are allowed by default. Counts/deadlines bind to the issue run,
persist across restart and source/configuration revision changes, and cannot reset
an exhausted run implicitly. Remaining findings at10 block an11th implementation
and emit one limit-reached status comment. Existing per-call credits, deadlines,
concurrency, validation and unknown-outcome guards are unchanged.

Host-only `runtime.planningOverrides` can select an exact source/item
`investigationOnly:true` template with literal files and pinned base. This does
not grant implementation even if an approval label is later added. Broader work
requires a genuinely new scoped plan/configuration and user decision.

### Evidence-specific planning recovery

`workspace reconcile-planning --database <canonical-db> --file <evidence.json>`
settles the supported Windows `Filename too long` checkout failure before
model launch. Evidence names `proposalId`, `launchKey`, exact retained `logDigest`
and `baseRevision`. The owner must be released with no reserved operations.
The host verifies exact log format, branch/task binding, creation-only reflog,
unchanged base and absence of retained worktree/model output. It appends a
`not-started` settlement without deleting/resetting the original unknown launch.
Changed code, model output or uncertain retained work still fails closed.

An explicit `"kind":"read-only-invalid-receipt"` instead supports the narrow
settled specify failure where the worker returned findings as severity/evidence
objects rather than required strings. Exact single-receipt framing and normal
host process-settlement footer, schema failure limited to findings, an absent
worktree and unchanged creation-only branch are required. The settlement records
the raw receipt digest and **does not accept its artifact as a successful plan**.
It preserves the original unknown launch, does not reopen that proposal, and
permits a newly revisioned corrected planning configuration only after the
effect-free failure is independently established. Other malformed receipts,
missing settlement evidence or retained changes still block.

### Behavioral acceptance

The workflow tests exercise attributed fresh approval versus third-party,
revoked and stale decisions; journaled write uncertainty/deduplication;
cross-revision unknown holds; actual separate read-only review and real host
validation; findings/fix/fresh-review progression; scope expansion and missing
critical proof; and iteration10 versus forbidden11 across reopen. Fixture proof
is not evidence that a live issue was implemented or independently reviewed.

`focus` accepts the full focus object from `list`: `mode` (`observe`, `propose`,
`execute`), `projectIds`, optional `team`/`iteration`/`query`, `priorities`,
`maxConcurrency`, `budgets` (`maxItems`, `maxAttempts`, `maxRuntimeMs`) and exact
`permissions` (`projectId`, `action`). Actions are `discover`, `investigate`,
`implement`, `publish-item`, `publish-pr`, `downstream`. Initial mode is observe,
with no focused projects and no permissions. Changing the mode does not imply
any permission. Broader focus/grants require a trusted local configuration edit;
the service control channel may only narrow its current focus.

`discovery-add` accepts:

```json
{
  "id": "my-assigned-api",
  "projectId": "api",
  "hub": { "kind": "github", "repository": "my-org/api" },
  "selector": { "assignedTo": "my-login" },
  "pageSize": 10,
  "maxPages": 5,
  "includeReviewFeedback": true,
  "includeDependencies": true
}
```

Alternatively use `selector: {"optedInLabel":"agent-ready"}` and the exact
registered ADO hub object. Sources must match a registered project's hub.
Use `discovery-remove --id my-assigned-api` to unregister.

`route-add` accepts a producer-consumer contract route:

```json
{
  "id": "api-client",
  "version": 1,
  "producer": "api",
  "consumer": "app",
  "contract": "api",
  "consumedDigest": "<64 lowercase hex characters>",
  "scopes": ["src/client"],
  "baseBranch": "main",
  "acceptance": [{ "label": "unit", "command": "npm test" }],
  "maxDepth": 3,
  "maxTasks": 10
}
```

Routes require integrated projects and a validated acyclic graph. List with
`routes`; remove with `route-remove --id api-client`. Registration alone does
not authorize downstream work or publishing. The existing Cowork host retains
its verified producer-change and cause-bound task append gates.

`runtime` accepts `framework: "devsquad"`, `command`, `agent`, `model`, and
`phaseDefinitions`, plus optional `executionTrust` (`independent-backend`, the
default when omitted, or `trusted-local`), and optional `executionControls`
described below. Each phase binds `stage`, `agentName`, absolute
`definitionPath`, SHA256 `definitionDigest`, and `model: {id,family}`.
Installed definition checks are not backend execution identity evidence.

### Explicit trusted-local mode

This mode trusts the installed CLI to honor the host-selected DevSquad agent and
model. It does not independently observe the loaded definition or resolved model.
The workspace planner uses the existing **no-sandbox host provider**: workers can
access host credentials and network and filesystem scopes are not an OS sandbox.
Use it only for repositories and installed agents you trust. Definition hashes
are checked before admission and after execution; they identify configured local
files, not a backend-attested loaded definition.

After registering installed phase definitions and trusted task templates, opt in
with a normal revision-checked local runtime edit:

```powershell
$configuration = sandcastle orchestrate workspace list --database C:\work\orchestration.sqlite | ConvertFrom-Json
$configuration.runtime | Add-Member -NotePropertyName executionTrust -NotePropertyValue trusted-local -Force
$configuration.runtime | ConvertTo-Json -Depth 20 | Set-Content C:\work\runtime.json
sandcastle orchestrate workspace runtime --database C:\work\orchestration.sqlite --revision $configuration.revision --file C:\work\runtime.json
```

Stop an active service before editing its configuration, then restart it.
Set the property to `independent-backend` (or omit it) to restore strict policy.
The edit does not change focus, grant investigate/implement permissions, approve
a proposal, or authorize publishing. `validate` only probes readiness; it never
launches a worker. `executionReady` describes configured planning capability,
not independent backend verification, proposal approval, implementation success or live validation.
Readiness includes `executionTrust`, nonblocking `warnings`, and
`independentBackendVerified: false`.

Each local invocation atomically reserves durable host evidence, rechecks its
capability and fences admission against the captured service/configuration before
launch. Evidence binds invocation, intent, request digest, source revision (through
the request digest for intake), configuration revision, requested agent/model,
configured definition digest and branch. Append-only `trusted-local-launch-reserved`,
`trusted-local-launch-admitted` and `trusted-local-result` events distinguish
reservation/admission from the worker-reported result. They contain no raw worker
output or exception text. `backendAttested` is always false.

A retained reservation, including one left by a crash or failed result write,
prevents automatic relaunch of the same invocation. A successful worker receipt
does not prove acceptance tests passed. Critical human approvals, independent
critics, verification and separately authorized hub publication are unchanged;
local evidence cannot satisfy gates that require independent proof.

`task-template-add` accepts a normal orchestration task with a registered
`projectId`, trusted `branch` prefix, `baseBranch`, literal `scopes` and nonempty
`acceptance` commands. It cannot bind an existing PR or source item. Templates
are configuration, not dispatched work. Discovered work must be separately
bound to its immutable observed identity and revision; untrusted source text
cannot choose commands or broaden scopes. Remove with `task-template-remove`.
Use one template per project; unresolved task/contract prerequisites cannot be
renamed into discovered tasks and require the verified core lifecycle.

### Bounded local-file execution

The optional `runtime.executionControls` is trusted, revision-bound configuration,
never a field inferred from a discovered issue or worker receipt. It applies to
configured proposal phases and approved implementation/repair workers through
the public native run/service paths. Changing it changes the configuration
revision and invalidates earlier proposal approvals. It does not opt into
trusted-local mode, change focus, grant implement permission or authorize
publication. Omitting it preserves the legacy launch; focus runtime limits and
idle timers alone do not provide equivalent execution controls.

After stopping any active service, edit the existing runtime with CAS:

```powershell
$configuration = sandcastle orchestrate workspace list --database C:\work\orchestration.sqlite | ConvertFrom-Json
$configuration.runtime | Add-Member -NotePropertyName executionControls -NotePropertyValue @{
  profile = "local-files"
  maxAiCredits = 30
  maxAutopilotContinues = 0
  timeoutMs = 240000
  disabledMcpServers = @("github", "ado")
} -Force
$configuration.runtime | ConvertTo-Json -Depth 20 | Set-Content C:\work\runtime.json
sandcastle orchestrate workspace runtime --database C:\work\orchestration.sqlite --revision $configuration.revision --file C:\work\runtime.json
```

Replace the example MCP names with **every configured/plugin MCP name to disable
in your installation**. Names are identifiers, not credentials or URLs; builtin
MCPs are disabled separately. The host does not silently infer or rewrite global
MCP configuration. Only the `local-files` profile and its documented fields are
accepted. Credit limits are integers 30-10000; continuation limits 0-100; process
deadlines 1000-3600000 milliseconds. Duplicate MCP names, unknown controls and
nonliteral/root/escaping task scopes are rejected. Roots or scopes that cannot
be represented as literal native tool approvals are refused before launch.

The generated process uses shell-free argv with the registered qualified agent
name and model, `--max-ai-credits`, `--max-autopilot-continues`, file-only
`view/read_file/apply_patch`, denied shell/URL/memory, builtin/name-specific MCP
disables, no custom instructions/updates/questions/temp access and session sync
off. Absolute read/write rules are derived from the canonical isolated worktree
and trusted task scopes; symlink scopes are refused. Broad automatic approval
environment switches and LLMLab automatic setup are disabled for this profile.
Unsupported native flags or process facilities fail before worker launch; an
unsupported sandbox cannot silently fall back to a shell. Interactive launches
are unsupported with this profile.

The CLI credit limit is **soft**, checked after responses, so a response can
overshoot it. It is not a hard financial ceiling. The separate host deadline
terminates the owned process tree (Windows `taskkill /PID ... /T /F`, or a POSIX
process group); cancellation follows the same cleanup path. Missing termination
support fails closed. A canceled, timed-out or unacknowledged invocation retains
an unknown outcome and cannot be automatically replayed.

These are CLI/tool approvals, **not an OS sandbox, revocation of previously
saved permissions, credential isolation or network isolation**. Installed plugin
hooks remain active even with custom instructions and MCPs disabled, may execute
their own host processes and can add diagnostics to the model context. Trust the
installed CLI/plugins; do not assume this profile disables hooks. Unmet runtime
setup requires separate authorized setup, not an automatic installation. The
local verification below did not install Python or other runtimes.

Because file-only workers cannot run Git, after a completed implement/fix receipt
the host may commit actual scoped edits on the exact owned repository/worktree/
branch. It verifies all changed paths (including both sides of renames) and
symlink ancestry, uses per-command
empty-hook/signing/author overrides, and requires a clean result. This runs no
repository commit hooks and is **not proof that those checks passed**. It changes
no persistent Git/permission settings and grants no remote publication.
Acceptance and independent review remain separate host gates. Out-of-scope
changes or uncertain commits retain an unknown outcome rather than success.

See [actual default Windows launch and fixture boundaries](orchestration-intake.md#shipped-default-launch-validation-with-explicit-controls).

## Polling and local control

```powershell
sandcastle orchestrate workspace run --database C:\work\orchestration.sqlite
sandcastle orchestrate workspace start --database C:\work\orchestration.sqlite
```

`run` performs one bounded native pass. `start` stays attached and polls until
stopped; run the following in another terminal. Use the same database and
optional `--control-directory` for every control command:

```powershell
sandcastle orchestrate workspace status --database C:\work\orchestration.sqlite
sandcastle orchestrate workspace pause --database C:\work\orchestration.sqlite
sandcastle orchestrate workspace narrow-focus --database C:\work\orchestration.sqlite --file C:\work\narrowed-focus.json
sandcastle orchestrate workspace resume --database C:\work\orchestration.sqlite
sandcastle orchestrate workspace restart --database C:\work\orchestration.sqlite
sandcastle orchestrate workspace stop --database C:\work\orchestration.sqlite
sandcastle orchestrate workspace startup --database C:\work\orchestration.sqlite
```

`restart` is a new attached service process: it first authenticates and drains the
previous same-host owner, then starts. It does not kill a noncooperative worker.
The default control directory is `.<workspace-id>-control` beside the database;
it must be private to the current user. Control descriptors contain a secret:
do not print, share or commit them. Startup returns OS-specific artifact content
only; it does not write or register startup.

`start` emits JSONL `workspace-pass` notifications after durable pass evidence
changes; identical repeated projections are not re-announced. It emits a final
status on shutdown. `service-ready` means the control endpoint is live, not that worker execution is
available. `status` distinguishes authenticated process state from released/dead
ownership and retained evidence. `lastPass.result` includes explicit evaluated
scope, proposal statuses and diagnostics. Empty/ungranted setups produce blocked
pass evidence; the service stays controllable while awaiting configuration.
Supported ADO sources continue when an optional focus selector is unsupported
for another source. Such a pass reports `partial` with per-source diagnostics,
not global authorization or fabricated matching facts.
`run` exits nonzero for blocked or partial passes. Immediate service failures do not advertise
a ghost endpoint. Retained `lastFailure` is allowlisted phase/cause evidence;
historical failures keep their original owner ID across healthy restarts.

Use `focus --file` for a new trusted configuration revision, including expansion
or reprioritization. `narrow-focus` is an authenticated live control that cannot
grant new authority. Configuration/focus changes fence old admissions; already
started effects may need independent reconciliation. Item/attempt/runtime and
concurrency limits are not token-price or currency spending limits.

Older records may omit newly defaulted fields. Stop the service and run
`migrate` to append a normalized configuration revision before restarting.
Migration preserves prior event bytes and IDs; it never rewrites history or
weakens ownership/configuration guards.

## Proposal queue and execution readiness

```powershell
sandcastle orchestrate workspace proposals --database C:\work\orchestration.sqlite
sandcastle orchestrate workspace proposal --database C:\work\orchestration.sqlite --id <proposal-id>
sandcastle orchestrate workspace review --database C:\work\orchestration.sqlite --id <proposal-id> --proposal-digest <digest> --source-revision <revision-digest> --revision <configuration-revision> --decision approve
```

Review is a trusted local action requiring the current proposal digest, source
revision and configuration revision. Use `--decision reject` to reject. Stop the
service before reviewing: review acquires the same exclusive owner as manual
passes and cannot race live planning. Then restart to observe the new decision.
Approval alone is not authority to implement, publish, push, merge or deploy.

Observe performs native read-only intake without model reservations. Propose and
Execute additionally configure the real named DevSquad planner and inspect its
preflight before reserving work. The currently installed Copilot backend does not
supply independently bound execution identity, so strict mode remains blocked
before effects. Explicit trusted-local mode can run the three proposal phases
(investigation, specification, plan) through the named CLI worker and persist
their results for review. With Execute mode, an exact implement grant and one
trusted template per project, `workspace run/start/restart` automatically binds
an approved issue/work-item proposal to the existing core lifecycle. No executable
host module or dispatch callback is needed. Observe/Propose never admit or recover
implementation workers. Pull requests are not accepted as implementation sources.
An explicitly configured [bounded-local policy](./orchestration-intake.md#automatic-bounded-local-policy)
can authorize that exact trusted template automatically instead of requiring
manual per-stage proposal approval. It records distinct host policy authority,
not a human approval or independent review, and retains the same needs-input,
scope, current-source and publication boundaries.
A separately configured trusted host can also use the existing core lifecycle through the compatible
`orchestrate --config` path, which now shares service/manual exclusion and retains
workspace worker-dispatch gates after host run binding.

### Built-in implementation and recovery

The host retains proposal digest, approval or policy decision, exact native source/revision, original
configuration, trusted template, approved artifacts and immutable single-task
catalog in one atomic bounded `native-dispatch-index/<workspace-digest>` record.
Admission is all-or-nothing, including its recovery index. The core cause is
`native-proposal:<binding-digest>`; deterministic run/task identities prevent
duplicate admission. Source text cannot choose scopes, commands, branch bases,
permissions or publication callbacks. Installed plugin definitions can use the
registered name `devsquad:devsquad.implement` while declaring `devsquad.implement`.

The same SQLite file holds workspace and core events. Every core transaction
checks the captured workspace owner, control and configuration guards inside
its write transaction, in addition to the existing core lease. Binding and approved
artifact seeding are idempotent. Current approval, actual source scope/labels,
Git root/origin, trust policy and implementation permission are rechecked before
launch. `needs-human`/`do-not-autofix` labels block work.

### Trusted local code validation

The public native lifecycle can run optional `runtime.localValidation` after
the actual local implementation commit, before retaining its independent-proof
gate. Register through the existing revision-checked `workspace runtime` CLI:

```json
"localValidation": [{
  "projectId": "api",
  "label": "offline-regression",
  "executable": "C:\\trusted-tools\\python.exe",
  "args": ["-I", "-B", "C:\\trusted-tools\\check-offline.py"],
  "timeoutMs": 120000
}]
```

The project's sole trusted template must cover every registered check and have
exact matching acceptance `command: JSON.stringify([executable,...args])`.
Executables are absolute; argv is data, never shell text or issue/model commands.
Explicit bounded execution controls are required. Omitting this registry
preserves the legacy independent-proof stop without claiming tests ran.

Checks run shell-free on a host-created detached snapshot of the exact verified
implementation SHA. Source revision, configuration, current permission and
exclusive owner are checked around execution. Hard deadlines/cancellation use
the existing owned-process-tree runner. Credential environment variables are
not inherited; only OS/path/temp environment plus offline/no-bytecode settings
are forwarded. This reduces exposure, **not** filesystem/network isolation:
tests execute code on the trusted host and must be appropriate for this lane.
Keep the checker and pinned baseline test bodies outside worker-editable scope.
Do not grant credential, security, infrastructure, deployment or destructive
work merely because it fits a file path; configure conservative request
exclusions and require trusted decisions for unsupported intent.

The check's last stdout line must be JSON exactly shaped as:

```json
{ "schemaVersion": 1, "state": "passed", "evaluatedScope": 45 }
```

Scope is a positive actual evaluated-test count, not the number of configured
commands. `passed` requires exit zero; `failed` requires nonzero. Empty, malformed,
inconsistent or zero-scope receipts cannot be green. A failing check records
failure and stops the lane. Timeout, interruption, lost binding, or a mutated
snapshot records unknown evidence. Each proposal gets a same-journal admission
before execution plus exact configuration/revision/command bindings, bounded
output digests, exit codes and counts in its lifecycle summary. A reserved crash
outcome is held, never automatically rerun. Checks cannot edit their snapshot,
grant implementation/review/publication authority or claim independent evidence.
Passing local tests still leaves needs-input for unavailable independent
phase-critic/critical proof; no CI, remote policy or publication is fabricated.

### Retained lifecycle recovery

`lastPass.result.lifecycles` retains old configurations and actual core task
states even when discovery/focus is removed. An admission receipt is not a
completion receipt. After local implementation the built-in host records
`needs-input`: independent critic/critical-change proof is unavailable, so it
does not claim acceptance, review, CI, publication or completion.
The host supplies no native push/PR/merge/deployment authority. The no-sandbox
worker still has host access: prompt restrictions are not network or credential
enforcement.

Restart resumes known pre-invocation checkpoints, but a reserved/running
invocation becomes unknown and is never automatically repeated. Stale retained
lanes report reconciliation diagnostics without preventing other ready lanes
from recovery. Queue status, workspace operation reservations and core lifecycle
state are separate evidence: recovering the core does not rewrite an old
`dispatching`/`unknown` queue entry or erase its operation reservation.
Inspect `events`, operation summaries and core events together.
Use `reconcileOrchestrationOperation` only after releasing the workspace owner
and obtaining independent evidence; it never retries the same operation ID.

Native unknown and implemented-but-unverified tasks retain file-scope holds,
including across runs. A trusted host may use `MultiProjectJournal.reconcile`
only with independent evidence. To abandon a native hold, first establish that
the worker has settled and that retained branch/worktree changes have been safely
settled or cleaned up; record that evidence with outcome `abandon`. Worker prose
or process termination alone is insufficient. Reconciliation does not grant
publication authority or prove acceptance.
The admission index is bounded at 200 entries and the store's 1 MiB JSON limit;
capacity failure is explicit and does not authorize deleting unresolved history.

See [native intake](orchestration-intake.md) for precise supported selector forms,
provider/version evidence, missing backend fields, verified factory seams,
bounded queue capacity and recovery. No injected fixture proves live execution.

## Evidence and limits

`events --after 0` returns retained append-only workspace evidence, up to 10,000
per page. Continue with the last sequence. Configuration, discovery cursors,
proposal revisions and service fences survive process restart. Unknown external
outcomes must be reconciled from independent evidence, never retried as success.

See [service and controls](local-orchestration-service.md) for user-local
ownership, cooperative cancellation and startup-artifact boundaries. Existing
trusted-host and offline Cowork paths remain available; a fixture does not
prove live identity, hub writes, performance or deployment.
