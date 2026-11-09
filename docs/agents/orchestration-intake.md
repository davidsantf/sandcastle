# Native discovery and proposal intake

## Specification

Discovery reads only explicitly configured GitHub repositories or Azure DevOps
projects. A source must select an exact assignee or an explicit opt-in label/tag.
Repository access alone is not consent. The trusted focus policy must additionally
grant `discover`; `investigate`, `implement`, and publication are separate grants.
Hub descriptions, comments, relations, and model artifacts are untrusted data.

One canonical workspace CAS store retains source cursors, latest item revisions,
proposal artifacts, review decisions, dispatch reservations, and uncertain
outcomes. The service supplies its fenced store; adapters must never retain an
unguarded store or open another database. Replayed observations do not redispatch.
Changed revisions supersede earlier proposals and invalidate their approvals.

An investigation produces an investigation artifact, specification, implementation
plan, and measurable acceptance proposal using installed named DevSquad phase
routes. An approval binds the complete proposal digest, source revision, and
configuration revision. It does not publish an artifact, create an item or PR,
or grant downstream permission. Implementation additionally requires current
focus authority and the existing executor's exact intent/proof/receipt checks.
Attempted operations with unknown results are never automatically repeated.

## Implementation plan and acceptance

1. Ship bounded native GitHub CLI and ADO authenticated transports. Persist
   pagination cursors only after all observations in a page are retained. Fetch
   review feedback and dependency relations into the revision; reject partial
   evidence, invalid selectors, oversized responses, and rate-limited reads.
2. Store one source/item aggregate with latest revision and bounded proposal
   history using CAS. Reserve planning and dispatch before invoking callbacks.
   Keep unknown outcomes explicit after exceptions or process interruption.
3. Use trusted focus policy and the service operation ledger at every effect.
   Execute real named phase workers through the existing DevSquad worker adapter;
   never relabel generic workers or synthesize successful identity/validation.
4. Test page replay/restart, revision changes, stale approvals, rejected proposals,
   races, cancellation, denied policy, and real callback invocation. Live checks
   are read-only and scoped to this configured repository; fixture results are
   not evidence of live framework execution.

## Runtime and rollout boundaries

Node 22.13+ and existing authenticated `gh` are used for GitHub discovery. ADO
uses an existing host-only bearer/PAT credential supplied to its transport.
Credentials never enter source catalogs, stored intents, prompts, or diagnostics.
No runtime, Python interpreter, agent, or authentication configuration is installed
or upgraded. The reported LLMLab Python 3.14.3 requirement is independent of this
Node-based host: select an already installed matching interpreter explicitly for
LLMLab; these adapters do not bypass that requirement.

Installed agent definition hashes prove configuration integrity, not execution
identity. If the selected backend has no independent agent/model execution
evidence, setup reports that gap and dispatch remains blocked. Worker output is
never accepted as host attestation. Acceptance commands must be trusted host
configuration, not commands copied from discovered work.
