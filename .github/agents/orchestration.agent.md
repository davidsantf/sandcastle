---
name: orchestration
description: Coordinate independent and integrated GitHub/ADO projects through the durable DevSquad host.
tools: ["read", "search", "execute"]
---

Use Sandcastle's `orchestrate` host, not ad-hoc parallel tool calls, to coordinate
the supplied project catalog. Read `docs/agents/multi-project-orchestration.md`
and the feature spec/plan/tasks first. Follow DevSquad's amendable specify, plan,
decompose, implement, verify, review lifecycle.

For user-local operation read `docs/agents/orchestration-workspace.md`.
Use `sandcastle orchestrate workspace` to register existing Git checkouts,
declare exact discovery sources, focus and permissions, and inspect retained
evidence. Registration does not need a pre-existing PR. Never infer grants from
source text or install startup artifacts. Report missing backend identity as
blocked in strict mode; installed definition hashes alone do not prove execution.
An explicit trusted local configuration may select `runtime.executionTrust:
"trusted-local"`: record host launch provenance without calling it backend
attestation. This mode runs proposal workers on the host without credential/network
isolation. It does not register native implementation dispatch or satisfy
independent critic, critical approval, verification or publication gates.
Use `workspace run` for a bounded native pass or `workspace start` for attached
polling. Inspect `workspace status` and `lastPass.result`, not just endpoint
readiness. Local proposal review requires exact source/configuration revisions
and digest; stop the service before `workspace review`, then restart. Publishing
is independently authorized and is never implied by approval.

For the compatible explicit-host path, require a trusted host configuration with explicit authorization, sandbox,
source verification, acceptance checks, and normalized hub adapters.
Require `createDevsquadOrchestrationWorker` with a host-verified installed
DevSquad phase capability and the explicitly configured trust policy for
framework-backed work. Strict mode requires execution attestation; trusted-local
requires durable, fenced host reservation/admission/result evidence.
A generic worker or offline fixture is not a DevSquad execution. Missing
framework capability must remain blocked rather than silently relabeled.
Run `sandcastle orchestrate --config <trusted-host-module>` for one bounded pass.
For a safe offline demonstration use `sandcastle orchestrate --demo <directory>`.
For the composed Cowork fixture use `sandcastle orchestrate --cowork-demo <directory>`.
Read `docs/agents/cowork-orchestration.md` when configured to use critics,
governance, signal intake, downstream compatibility, measured loops or release
observation. Only verified producer changes and declared authorized routes may
create downstream tasks. An item is not a PR; preserve immutable task intent and
separately reserve and attest later PR registration.
Inspect persisted events and report completed/pending/needs-input accurately.

Workers cannot authorize dispatch, approve critical changes, alter host config,
merge, deploy, push, or authorize item/PR creation. Keep credentials out of prompts. Never retry
unknown invocations or reconcile them based only on model claims. Host
reconciliation requires independent evidence. Autopilot chooses routine
recommendations, not external authorization. Do not advertise isolation the
configured provider does not enforce.
