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

Baseline integrated regression before the trusted-local amendment:

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

## Strict-mode external execution capability

The native Copilot CLI reports **1.0.106** and supports named-agent/model flags.
The installed provider/result/event paths do not independently bind the executed
worker invocation, loaded agent name/definition digest and resolved model/family
to the request intent/revision. Model selections and worker assertions are not
substitutes. Backend-owned bound execution evidence is the smallest required
external capability; credentials or additional local aliases cannot create it.
See [native intake evidence](../../agents/orchestration-intake.md) for the exact
supported metadata paths, differing host producer version and setup distinction.

Consequently, the default strict native Propose/Execute path remains explicitly
blocked before model or dispatch reservation. This identity requirement was
introduced by the design, not evidence that the user already owns a missing
backend contract. The compatible trusted-host core lifecycle remains available.
The explicitly authorized alternative below does not fabricate that contract.
No live ADO reads, worker execution, startup installation, hub fixture writes or
expansion publication were performed or authorized.

## User-authorized trusted-local followup

The user explicitly approved implementing **labeled trusted-local mode** after
the distinction between local launch provenance and independent backend
evidence was explained. This authorizes a product trust-policy
alternative, not live target writes or weaker publication/critical-review gates.

`runtime.executionTrust` is optional and defaults to `independent-backend`.
Only a revisioned local edit to `trusted-local` enables the installed CLI's
requested named agent/model to be trusted for native proposal planning. Omitting
the field again restores strict mode without changing historical configuration
digests. The policy alone grants no discover/investigate/execute/publish action.

The host persists an atomic reservation, rechecks the exact registered phase
definition, and commits a second owner/configuration-fenced admission before
calling the existing runner. Bound evidence includes invocation, intent, request
digest, project/task/stage, requested agent/model, configured definition digest
and configuration revision, with `backendAttested: false`. Concurrent/restarted
replay is rejected. Cancellation, definition drift, malformed/forged receipts,
changed configuration or lost result persistence yields an unknown outcome;
unsettled evidence cannot automatically relaunch.

The integration fixture uses real phase files, canonical SQLite, adapters,
service guards and the proposal queue. Only the CLI probe and model runner are
mocked. Three authorized phases produce a ready proposal without approval or a
dispatch receipt. Negative fixtures cover missing recorder/permissions,
concurrent replay, lost persistence and configuration changes before admission
and during execution. Temporarily changing the omitted policy default to
`trusted-local` made the strict-default test fail; the production default was
restored before the build and final regression.

At that intermediate delivery the native workspace had no implementation dispatcher. Existing core
verification, independent critic, critical-change approval and publication gates
are unchanged. Trusted-local uses the existing no-sandbox backend, so host
credentials, environment, filesystem and network are not isolated. No live
worker/model invocation or hub writes are claimed by these fixtures.

Final trusted-local regression, including rebuilt public CLI policy edits and
the unchanged core/Cowork authority gates:

```powershell
npm run typecheck
& .\node_modules\.bin\tsup.cmd
New-Item -ItemType Directory -Force .\dist\templates | Out-Null
Copy-Item .\src\templates\* .\dist\templates -Recurse -Force
node .\scripts\check-public-types-effect-free.mjs
npm test -- --reporter=dot --maxWorkers=1 --testTimeout=60000 MultiProject Cowork OrchestrationWorkspace LocalOrchestration OrchestrationFocus OrchestrationOperations OrchestrationDiscovery OrchestrationProposal OrchestrationNativeHost OrchestrationTrustedLocal
```

Result: **34 files passed, 496 tests passed, one POSIX-only test skipped on
Windows**. Typecheck, production build and Effect-free public declaration gate
passed. The focused trusted-local suite accounts for 13 passing cases; the
strict-default mutation intentionally failed its one selected case before
restoration. All final results above used the restored strict default.

## Automatic implementation continuation

The original automatic-implementation requirement now uses a built-in bridge
from public `workspace run/start/restart` to the real core lifecycle.
No dispatch callback or separate hand-authored host module is required.
It binds exact approved proposal/source/configuration revisions and digest,
trusted task template, immutable catalog and issue-backed source cause.
One atomic CAS retains the entire bounded admission/recovery index. Current
Execute focus, implement permission, native facts/stop labels, installed phase
definitions and Git root/origin are checked before worker launch.

Every core write checks captured workspace owner/control/configuration guards
inside its own SQLite transaction, retaining the existing core lease.
Deterministic cause binding and approved artifact seeding resume known
pre-invocation checkpoints. Running/uncertain invocations never automatically
repeat. Historical configuration evidence and native scope holds remain visible;
stale retained lanes cannot prevent recovery of another ready lane.
Independent critic/critical proof is unavailable in this built-in path:
actual local implementation records needs-input, not fabricated acceptance,
CI, review, publication or completion.

The new fixture suite uses real Git repositories, actual core/service/SQLite,
both native hub adapters and explicitly labeled model/hub fixtures. It covers
Observe/Propose denial, missing implement grant, forged/stale approval, source
stop labels, Git mismatch, configuration mutation between reservation/admission,
unknown outcomes, independent-lane recovery and scope holds with evidence-backed
host release. Actual child processes exit at admission/initialize/bind/seed/running;
restart resumes only pre-invocation work and never repeats uncertain effects.
Compiled public manual/service commands retain actual lifecycle projections.

Separately, the actual installed DevSquad plugin-qualified named agent completed
the bounded read-only/local-only no-tools launch probe documented in
[native intake](../../agents/orchestration-intake.md#actual-installed-named-agent-launch-probe).
That was one real authenticated model request, not the fixture runner.
It establishes launch/parsing only, not independent identity, full live
implementation, ADO access, CI or publication. Strict independent-backend mode
remains the default; no live hub writes or new publication were performed.

Final continuation verification:

```powershell
npm run typecheck
& .\node_modules\.bin\tsup.cmd
Copy-Item .\src\templates\* .\dist\templates -Recurse -Force
node .\scripts\check-public-types-effect-free.mjs
npm test -- --reporter=dot --maxWorkers=1 --testTimeout=60000 MultiProject Cowork OrchestrationWorkspace LocalOrchestration OrchestrationFocus OrchestrationOperations OrchestrationDiscovery OrchestrationProposal OrchestrationNativeHost OrchestrationTrustedLocal OrchestrationNativeDispatch
```

Result: **35 files passed, 515 tests passed, one POSIX-only test skipped on
Windows**. Typecheck, production build and public declaration gate passed.
The new native-dispatch suite contributes 19 cases. Temporarily skipping the
core transaction's workspace guards made its dedicated test fail as intended;
guards were restored before the successful rebuilt regression. Assertions are
outside service callbacks so caught callback failures cannot masquerade as
passing tests. Initial runtime tests also exposed an order-sensitive task digest
comparison; expected tasks now use the canonical task parser before comparison,
preserving exact binding rather than weakening it.

## Actual local implementation execution evidence

The follow-up authorized bounded model-driven editing, not just another launch
marker. A disposable local Git fixture exercised the exported native tick,
same-journal service/core admission, exact approved proposal and narrow trusted
template with the actual installed `devsquad:devsquad.implement` agent.
Fixture hub/proposal/planning artifacts remained explicitly labeled; the
implementation was a real authenticated Copilot session, not the test runner.

The real `run`, worker prompt, stream parser, structured receipt and branch/commit
collection were preserved. A validation-only trusted invocation bridge supplied
shell-free bounded native argv with exact-file write approval, no model shell/
MCP/delegation/publication tools, 30-credit ceiling, zero continuations and a
240-second process timeout. This verifies that constrained integration, not the
unmodified default process launcher, backend identity or an unrestricted
DevSquad workflow. No production trust or proof gate changed.

The successful invocation made one actual `apply_patch` edit, changing only
`src/value.txt` to the required exact content. The host committed the
model-origin change as local fixture commit
`7b26651b918669da6ebc27847de06958552a935a` and independently ran
`node acceptance.mjs`: **baseline exit 1, implemented exit 0**. The durable lifecycle correctly retained
**needs-input, implementationRecorded:true**, with independent critic/critical
proof, native verification, CI and publication still unavailable.

Two earlier fixtures exposed validation setup errors: the missing native editor
tool name, then Windows CRLF checkout bytes against an exact LF assertion.
Their unknown outcomes were preserved rather than retried. The final fixture
used explicit fixture-local LF checkout configuration, not a weakened assertion.
A fresh process reopened all three databases and ran the native pass: **zero
additional model invocations**, one retained launch per fixture, the two unknown
states unchanged and the successful implementation still needs-input.
See [detailed execution boundaries and measured results](../../agents/orchestration-intake.md#actual-local-implementation-through-the-native-lifecycle).
No live ADO destination, target rollout, remote writes, pushes, PRs, runtime
installation, credential changes or startup registration were involved.
