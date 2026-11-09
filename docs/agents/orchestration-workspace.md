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
A separately configured trusted host can also use the existing core lifecycle through the compatible
`orchestrate --config` path, which now shares service/manual exclusion and retains
workspace worker-dispatch gates after host run binding.

### Built-in implementation and recovery

The host retains proposal digest, approval, exact native source/revision, original
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
