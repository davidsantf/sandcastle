# User-local orchestration service

## Specification and implementation plan

The host runs one polling service under the current OS user. Both manual passes
and service passes acquire the same workspace ownership record in the canonical
SQLite journal. There is no separate workflow database. Ownership is never stolen
from a live process, including a callback that ignores cancellation. Same-host
dead-process recovery uses compare-and-swap; another host or inaccessible process
requires operator investigation rather than automatic takeover.

Each pass receives an immutable configuration, a guarded journal, a cancellation
signal, and an operations capability. Journal writes must atomically verify the
captured ownership record. An operation reserves its exact intent before calling
the host. Interrupted or unacknowledged effects remain blocked; restarting does
not retry them. Mode, project scope, selectors, exact action grants, concurrency,
item/attempt/runtime budgets are checked before dispatch. Access is not authority.

Implementation order: focus policy and immutable snapshots; durable operation
reservations; service/manual lifecycle and controls; private local control channel;
startup artifact generation; executable negative controls and restart tests.

The service defaults to observation through configuration. Discovery adapters,
native hub transports, runtime attestation, and CLI wiring belong to the host.
This layer never downloads interpreters, installs agents, changes permissions,
registers startup, or sends remote notifications.

## Host integration

The public modules are `LocalOrchestrationService`, `OrchestrationFocus`,
`OrchestrationOperations`, and `LocalOrchestrationServiceControl`.
The shared `WorkspaceStore` is the canonical
`OrchestrationWorkspaceStore` on the same local SQLite file as the orchestration
journal. Do not retain or pass its root capability into a worker.

```typescript
const configuration = readWorkspaceConfiguration(store);
const handle = await startLocalOrchestrationService({
  configuration,
  store,
  reloadConfiguration: () => readWorkspaceConfiguration(store),
  tick: createOrchestrationNativeTick({
    evaluateFocus: evaluateOrchestrationFocus,
    // Explicit, independently attested host planner/dispatch adapters go here.
  }),
  signal: shutdown.signal,
});
const control = await startLocalOrchestrationControlChannel(handle, {
  directory: privateControlDirectory,
  workspaceId: configuration.id,
});
try {
  await handle.done;
  if (handle.status().state === "blocked") process.exitCode = 1;
} finally {
  await control.close();
}
```

Install SIGINT/SIGTERM handlers on the host's `shutdown` controller. If channel
startup fails, stop the service before closing the root store. A manual invocation
uses `runLocalOrchestrationPass` with the same options and ownership key; bypassing
this wrapper is not service/manual mutual exclusion. The wrapper returns a
structured final status, including blocked failures, rather than raw adapter
errors. The host must inspect it rather than treating a resolved promise as
success.

`tick` receives `{configuration, store, signal, ownerId, passId, operations}`.
Its configuration is deeply frozen; its store stacks owner, control-revision,
and (when present) canonical configuration-record guards. A completed pass
invalidates its captured store and signal. Every pass is serialized; a callback
must settle all its owned work and must not detach child processes. Operation
promises launched without awaiting them are also drained before releasing
ownership. No timeout or stop command forcibly kills a callback.

## Focus and budgets

`evaluateOrchestrationFocus` requires an exact project/action permission even for
discovery. Observe admits only discovery; Propose additionally admits
investigation; Execute can admit implementation/publication/downstream work only
with its independent exact grant. Team, iteration, and query selectors require
matching known facts; absent facts do not match. Out-of-focus work produces a
handoff diagnostic, never a cross-project grant. Snapshots retain exact grants
for registered but currently inactive projects; those grants cannot bypass the
active project focus. The shared configuration parser validates registration.
Priorities order known projects
deterministically. Goals and acceptance artifacts belong to the host's proposal
and task evidence, not a second service backlog.

`handle.updateFocus` permits project/selector/grant/mode/budget narrowing and
priority changes within the trusted host configuration. It cannot grant a new
action, expand scope, change model, or increase a budget. Expansion requires a new
validated host configuration revision. The host can reload such revisions before
each new pass; an in-flight old configuration cannot commit new admissions after
the configuration record changes. Pause/focus changes immediately cancel and
fence new admissions; already-dispatched effects may finish but might need host
reconciliation if their completion acknowledgement loses its fence.

Concurrency includes all unresolved durable operations, including previous
processes' unknown effects. Item/attempt budgets apply to each pass, not a
rolling/day/account spending limit. Runtime is a monotonic admission deadline and
cooperative cancellation timer, not a hard kill or remote deadline. Model
invocation counts are bounded by attempt budgets; the native host separately
attests the exact installed agent/model definition. No token-price estimator,
currency quota, provider billing enforcement, or generic-model fallback is
claimed.

Read-only polls should use focus evaluation and cancellation directly rather than
permanent effect reservations. Planner/model calls and external-effect dispatch
use `operations.perform(request, callback)`, whose stable `request.id` identifies
the provider/account, target, action, and exact material inputs across restarts.
Never include pass IDs, attempt counters, or random values in effect identities.
Include those exact inputs in `intent`; only its digest is retained. Reusing an
ID with changed intent is blocked. A ready result is not fresh authorization for
a later publication.

## Recovery and operational evidence

`status()` exposes idle/running/paused/stopping/stopped/blocked lifecycle,
immutable-focus copies, pass count, redacted proposed/running/blocked/ready
operation evidence, and aggregate completed/unsettled counts. Adapters' exception
strings, prompts, credentials, command output, and operation payloads are not
included. Only exact IDs' digests are exposed. A UI may poll this local projection
for safe notifications; no remote notification transport is installed.

Failed runs additionally commit a `service-failed` event and latest
`service-failure/<workspace-digest>` record through the captured owner fence.
`readLocalOrchestrationFailure(store,workspaceId)` returns that bounded record
offline. The record includes only schema version, owner/pass IDs, configuration
revision, an allowlisted phase/cause, and timestamp. Error prose, stack traces,
paths, unknown error codes, and adapter payloads are never copied. Fixed causes
distinguish timeout, access denial, dependency/storage unavailability, ownership
loss, cancellation, and configuration/callback/settlement/control/release failure.
Error-property getters are not executed while classifying a thrown value.

`status().lastFailure` retains the cause across a healthy restart; compare its
owner ID with the current owner before treating it as this process's failure.
`status().failureEvidence` is `none`, `acknowledged`, or `unacknowledged`. If the
journal is unavailable or ownership has already changed, failure persistence
cannot be claimed: status remains blocked with an explicit unacknowledged
diagnostic and the offline reader returns only the last actually retained cause.
CLI diagnostics use fixed cause-specific guidance rather than exception text.

At-most-once dispatch can omit an effect: the service accounts an active slot
before its permanent per-effect reservation, then invokes the callback only after
both commits acknowledge. A crash between commits consumes an unresolved slot
even if nothing was dispatched. Completion settles the tombstone before freeing
the slot; interrupted acknowledgement can likewise strand a slot. Tombstones
remain in the canonical database indefinitely, while only unresolved operations
occupy the active list. Never delete reservations to make retry work.

For `reserved-outcome`, `unsettled-operation-concurrency-limit`, or an
unacknowledged completion: inspect the native hub/backend evidence read-only.
Stop the service and independently establish settlement. The trusted host may
then call
`reconcileOrchestrationOperation({store, workspaceId, operationId, evidenceDigest})`.
The evidence digest binds the host's reconciliation decision; this helper does
not validate a remote receipt itself. It frees only the accounted slot and never
reopens the effect identity. A truly new action requires a newly approved exact
intent, not a retry nonce. Reconciliation is deliberately not exposed over the
ordinary control channel.

Same-host takeover requires a confirmed dead PID (`ESRCH`). An inaccessible
process, another machine's hostname, malformed ownership, and PID reuse all fail
closed. For stranded ownership, verify the OS process and journal evidence
offline; do not time-steal or edit the database while a host might still run.
Use machine-local, nonsynchronized storage; network/cloud-synchronized paths
violate the ownership assumptions even if they look like local drive paths.

## Private control channel

Use `sendLocalOrchestrationControl({directory, workspaceId}, command)` for
`{action:"status"|"pause"|"resume"|"stop"}` or
`{action:"focus",focus:narrowedFocus}`. Both peers prove possession of a random
secret using per-connection HMAC challenges. The bearer secret is never sent over
the channel; signed responses are bound to that connection. There is no HTTP
listener. Windows uses a randomized named pipe; POSIX uses a private Unix socket.
Requests are bounded to 64 KiB, 16 connections, and five-second idle timeouts.

The descriptor directory must be canonical, owned by the current user, and
private. POSIX requires owner-only permissions; Windows read-only .NET ACL
inspection permits the current user, SYSTEM, and Administrators and rejects other
allow grants. No ACL is changed. Privileged administrators are outside the
same-machine user isolation boundary. If privacy cannot be verified, select an
already-private user-owned directory or fix permissions explicitly outside the
service. Do not turn verification off. Channel `close()` drains admitted control
responses, including a stop response, before disconnecting remaining clients.

## Optional login startup

`createLocalOrchestrationStartupArtifact({platform,executable,args,workingDirectory})`
returns `{filename,content,diagnostic}` only. Use absolute executable/working
directory paths and an explicit service CLI invocation. Windows returns a
least-privilege interactive-logon Task Scheduler XML preview; Linux returns a
systemd **user** unit; macOS returns a current-user LaunchAgent plist. The
operator must review and register it using their OS tooling. No artifact is
automatically written or registered, no elevated service account is created, and
unsupported platforms receive an actionable error. Startup registration and live
provider/agent execution have not been performed by the local fixture tests.

## Verified local evidence

On Windows with Node 22.18, the focused service/focus/operations/control suite plus
the shared workspace-store regression suite passed **44 tests**; one
POSIX-permission-specific test was correctly skipped on Windows.
`npm run typecheck` also passed. All service fixtures use the real
`OrchestrationWorkspaceStore` (in-memory SQLite for unit cases and a disk-backed
canonical journal for subprocess cases), not a parallel persistence model.

The subprocess fixtures actually start separate Node hosts, claim journal
ownership, expose the authenticated Windows named pipe, append a synthetic local
effect marker, kill the first host, restart it against the same database, and
prove that the marker is never repeated. A competing host is rejected while the
original endpoint remains usable; a manual pass is also rejected during service
ownership. Authenticated stop exits the host cleanly. Additional checks execute
mode/scope/grant rejection, selector matching, immutable snapshots, measurable
budgets, configuration/focus fencing, pause/reprioritize/resume, safe diagnostics,
unknown-operation reconciliation, and replay protection beyond 256 settled
effects.

Reproduce the slice with:

```powershell
npm test -- --run src\OrchestrationFocus.test.ts src\OrchestrationOperations.test.ts src\LocalOrchestrationService.test.ts src\LocalOrchestrationService.process.test.ts src\LocalOrchestrationServiceControl.test.ts src\OrchestrationWorkspace.test.ts
npm run typecheck
```

These are local fixture results, not proof of whole-product readiness, installed
DevSquad model capabilities, live GitHub/ADO effects, cross-user penetration
testing, OS login-startup registration, macOS/Linux execution, or a token/currency
spending cap. No interpreter download/upgrade, persistent startup registration,
permission change, credentials change, or live hub write was performed.
