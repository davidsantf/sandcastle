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
default when omitted, or `trusted-local`). Each phase binds `stage`, `agentName`, absolute
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
not independent backend verification, implementation dispatch or live validation.
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
Approval is not authority to publish, implement, push, merge or deploy.

Observe performs native read-only intake without model reservations. Propose and
Execute additionally configure the real named DevSquad planner and inspect its
preflight before reserving work. The currently installed Copilot backend does not
supply independently bound execution identity, so strict mode remains blocked
before effects. Explicit trusted-local mode can run the three proposal phases
(investigation, specification, plan) through the named CLI worker and persist
their results for review. **Native workspace implementation dispatch remains
unregistered in either mode**; approving a proposal does not silently launch an
implementation. A separately configured trusted host can use the existing core lifecycle through the compatible
`orchestrate --config` path, which now shares service/manual exclusion and retains
workspace worker-dispatch gates after host run binding.

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
