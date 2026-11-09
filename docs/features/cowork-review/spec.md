# Cowork review and architecture governance

## Specification

Add host-side, TypeScript review and governance modules. Core scheduler, worker
receipt schemas, journal, CLI and exports remain core-owned. These modules do not
grant merge, deployment, configuration or instruction-edit authority.

## Acceptance criteria

1. A fast review precedes spec/call-path wiring, meaningful tests, operational/docs,
   complete changed-file, and compatibility passes. Each receipt binds the exact
   intent, revision, pass and executed model identity; changed-file coverage is exact.
2. Host-attested canonical model families allow independent critics at research,
   design, build, verification, review and change-request proposal stages. Missing
   required diversity blocks or requests human review; aliases do not count.
3. Correctness, security, data-loss and missing meaningful tests block. Advisory
   findings may be fixed or answered without causing another mandatory round.
4. Host-classified critical changes require a current, independently verified human
   grant. Worker prose cannot approve or downgrade risk. Revision drift invalidates
   evidence, including during approval/audit. Attempts and repeated signatures stop.
5. Versioned root/component instruction proposals enforce bounded content, scope,
   one entry per file, generated-file regeneration, nonzero evaluated scope and a
   deliberately failing negative control. Host authorization is required to apply;
   this module only evaluates proposals.
6. Real TypeScript import/export/dynamic-import/require edges enforce scoped
   contract/kit/implementation/binary roles. Implementations cannot depend on other
   implementations; binaries contain wiring, not exported reusable logic. Unknown
   local dependencies and computed imports fail closed. Legacy identities may
   ratchet only outside governed components; no governed exceptions.
7. Fake workers and invalid fixtures prove blocking and fail-closed behavior.

## Boundaries

Host owns credentials, identity registry, policies, human approvals, tool execution
and durable audit. Prompts contain only bounded nonsecret identifiers/hashes/files,
not arbitrary source/task prose or credentials. Existing sandbox providers are not
claimed credential-free or network-isolated. Injected host callbacks are trusted
in-process capabilities, not a sandbox. Core must persist review attempts/evidence
in its existing journal and reverify before any downstream action.
