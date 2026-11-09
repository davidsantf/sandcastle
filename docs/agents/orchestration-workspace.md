# User-local orchestration workspace

Requires Node 22.13+ and Git. The local SQLite file is the configuration source
of truth and also holds service, discovery and proposal records. Use the same
absolute file for every command and the core journal; do not copy it while a
service owns it. Credentials remain in the native `gh`/Azure CLI environment,
never configuration or generated prompts.

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
Validation checks checkout roots/origins and reports missing focus, discovery
and phase registrations rather than calling an empty setup ready. It is not
proof that a backend actually executed the selected agent/model.

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
`phaseDefinitions`. Each phase binds `stage`, `agentName`, absolute
`definitionPath`, SHA256 `definitionDigest`, and `model: {id,family}`.
Installed definition checks are not backend execution identity evidence.

`task-template-add` accepts a normal orchestration task with a registered
`projectId`, trusted `branch` prefix, `baseBranch`, literal `scopes` and nonempty
`acceptance` commands. It cannot bind an existing PR or source item. Templates
are configuration, not dispatched work. Discovered work must be separately
bound to its immutable observed identity and revision; untrusted source text
cannot choose commands or broaden scopes. Remove with `task-template-remove`.

## Evidence and limits

`events --after 0` returns retained append-only workspace evidence, up to 10,000
per page. Continue with the last sequence. Configuration, discovery cursors,
proposal revisions and service fences survive process restart. Unknown external
outcomes must be reconciled from independent evidence, never retried as success.

See [service and controls](local-orchestration-service.md) for user-local
ownership, cooperative cancellation and startup-artifact boundaries. Existing
trusted-host and offline Cowork paths remain available; a fixture does not
prove live identity, hub writes, performance or deployment.
