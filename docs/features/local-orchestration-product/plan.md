# User-local orchestration plan

The core integration owner maintains `OrchestrationWorkspaceContract.ts`,
`OrchestrationWorkspace.ts`, `OrchestrationWorkspaceCli.ts`, central CLI/exports,
protocol/journal compatibility and whole-product verification.

The service peer owns `LocalOrchestrationService*`, `OrchestrationFocus*` and
`OrchestrationOperations*`: cancellable single-instance lifecycle, private local
control, bounded focus/actions/operations and startup artifact generation.

The discovery peer owns `OrchestrationDiscovery*`, `OrchestrationProposal*` and
`OrchestrationNativeHost*`: provider discovery, durable investigation/proposal
queue, real capability/authority controls and native execution boundaries.

Shared configuration is schema-versioned JSON retained in SQLite, not executable
configuration code. A monotonically increasing revision binds every edit. Routes
declare contract identity/digest, producer/consumer, literal scopes and acceptance.
The store atomically commits bounded JSON projections and append-only evidence;
CAS avoids concurrent overwrite, and service effect writes additionally bind its
captured ownership. Credentials never enter stored configuration or generated prompts.

Integrate ready additive commits, then exercise the actual compiled CLI through
init/register/routes/focus/setup/manual pass/service/status/pause/resume/stop.
Test unavailable capabilities and denied actions as negative controls. Update
README, unique minor changeset and retained evidence with exact commands/results.
Do not install OS startup or create remote fixture work.

## Authorized trust-policy amendment

Keep independent backend proof as the default. The user-authorized
`trusted-local` alternative trusts the installed CLI's named-agent/model
selection for native investigation/specification/planning and approved implementation. Wire the
existing runner to durable reservation, final guarded admission and bounded
result evidence; reread exact phase definitions and reject replay or uncertain
settlement. Record requested/configured identity honestly, never backend
attestation. Preserve action scope and all stronger verification, critic,
critical-approval and publication gates. Document no-sandbox limits. Exercise the real guarded
service/queue with an injected runner, rebuilt CLI policy edits and a
strict-default negative control before committing this amendment.

## Automatic implementation continuation

Register the existing core behind exact revision/digest/configuration-bound
proposal review, not a user-provided dispatch callback. Persist an atomic,
bounded admission index containing immutable approved artifacts, trusted
template/catalog and source cause. Extend core transactions with captured
same-file workspace guards; keep the core lease and original catalog checks.
Seed only known pre-implementation artifacts, recheck native scope/stop labels,
Git root/origin and implement grants, then run the installed named worker.
Retain unknown invocations, historical configurations and unverified scope holds.
Do not invent independent critic/critical proof or publication callbacks.
Exercise actual process exits at admission/initialize/bind/seed/running,
compiled manual/service projections, config mutation and isolated lane recovery.
Run a bounded actual installed named-agent no-tools probe separately from
explicitly labeled fixture implementation tests.
