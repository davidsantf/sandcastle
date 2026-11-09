# User-local product integration tasks

The accepted specification and plan are amendable. Evidence distinguishes native
reads, actual local subprocess/control behavior, injected worker/hub mappings and
missing execution capability.

| Slice                                                             | Owner                 | State                                                 |
| ----------------------------------------------------------------- | --------------------- | ----------------------------------------------------- |
| Earlier core publication/merge, excluding expansion               | Integration           | Merged PR40, `e9a28b2`                                |
| Versioned shared configuration and atomic guarded SQLite store    | Integration           | Committed `cbc03dd`                                   |
| CLI onboarding, routes, focus, sources, task templates, exports   | Integration           | Committed `cc4654d`; compiled onboarding verified     |
| User-local single-instance service, operations and controls       | Service/focus peer    | Integrated; restart-safe descriptor cleanup `023b8af` |
| Bounded native discovery, revision-bound proposals and setup      | Discovery/native peer | Integrated; native ADO scope facts `bd3b66e`          |
| Composed manual/service CLI, readiness and real-flow verification | Integration           | Implemented and verified in this integration          |

## Integrated acceptance evidence

The compiled public command path exercises init/run/start/status/pause,
authenticated live narrowing, resume, manual/second-owner exclusion, restart,
stop, startup preview and proposal list/get/review. Pass-change notifications
refer to already persisted pass evidence. A wrong source revision cannot approve
a retained fixture proposal; exact digest/source/configuration review succeeds
without granting implementation or publication.

Immediate configuration failure emits no ghost service-ready endpoint. Explicit
additive migration appends a revision without rewriting historical events;
healthy restart retains the earlier owner's allowlisted failure evidence.
Prototype/private-field trusted hosts remain compatible, including after run
binding. A configuration mutation inside host authorization advances the durable
revision but fences dispatch before any worker starts.

Mixed-source tests use actual adapters, the guarded canonical SQLite store and
the local service pass: supported ADO intake continues beside unsupported GitHub
focus selectors. A native iteration mismatch produces zero observed items and
zero model/dispatch reservations. Temporarily restoring global selector rejection
made both mixed-source regressions fail with zero evaluated sources; restoring
per-source admission made them pass.

Final integrated regression:

```powershell
npm run typecheck
npm test -- --reporter=dot --maxWorkers=1 --testTimeout=60000 MultiProject Cowork OrchestrationWorkspace LocalOrchestration OrchestrationFocus OrchestrationOperations OrchestrationDiscovery OrchestrationProposal OrchestrationNativeHost
```

Result: **33 files passed, 482 tests passed, one POSIX-only test skipped on
Windows**. The production CLI and declarations were rebuilt with the repository's
`tsup` runner, template assets copied on Windows, and
`scripts/check-public-types-effect-free.mjs` passed. Tests include actual Windows
subprocess/control/restart behavior; fixture hub/worker evidence is not live
provider execution.

## Remaining external execution capability

The native Copilot CLI reports **1.0.106** and supports named-agent/model flags.
The installed provider/result/event paths do not independently bind the executed
worker invocation, loaded agent name/definition digest and resolved model/family
to the request intent/revision. Model selections and worker assertions are not
substitutes. Backend-owned bound execution evidence is the smallest required
external capability; credentials or additional local aliases cannot create it.
See [native intake evidence](../../agents/orchestration-intake.md) for the exact
supported metadata paths, differing host producer version and setup distinction.

Consequently, native Propose/Execute remains explicitly blocked before model or
dispatch reservation. The compatible trusted-host core lifecycle remains
available; no successful default native dispatch is claimed. No live ADO reads,
worker execution, startup installation, hub fixture writes or expansion
publication were performed or authorized.
