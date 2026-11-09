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
selection for native investigation/specification/planning only. Wire the
existing runner to durable reservation, final guarded admission and bounded
result evidence; reread exact phase definitions and reject replay or uncertain
settlement. Record requested/configured identity honestly, never backend
attestation. Preserve action scope and all stronger verification, critic,
critical-approval and publication gates. Document no-sandbox limits and the
unregistered native implementation dispatcher. Exercise the real guarded
service/queue with an injected runner, rebuilt CLI policy edits and a
strict-default negative control before committing this amendment.
