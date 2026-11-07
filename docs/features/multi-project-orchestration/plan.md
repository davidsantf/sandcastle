# Multi-project orchestration plan

Use a separate catalog host rather than expanding the ADO watcher. Reuse `run`,
structured output, and branch strategies: the same primitives used by the
existing DevSquad execution adapter. Follow its thin spec/plan and host-validation
separation, without claiming a direct invocation of that single-task adapter.
Existing ADO ledger/phase/watcher APIs remain compatible.

## Components

- Strict catalog and receipt schemas, DAG validation, canonical repository
  identity, explicit scope conflict exclusion, and shared-contract evidence.
- A trusted-host SQLite journal: FULL synchronous transactions, append-only
  events and artifact versions, atomic reservations/state changes, exclusive
  renewable host leases, and monotonically increasing fencing.
- A bounded scheduling pass: validate, claim, recover unknown reservations,
  authorize exact intent, reserve, execute conflict-free batches, record results,
  and release. A pass never retries an unknown external outcome.
- Native read-only GitHub and Azure DevOps adapters: source revisions, branch
  requirements/policies, current checks/build evidence, and human-stop labels.
  Injectable transports retain host credentials outside worker requests.
- A Sandcastle worker factory with structured engineering artifacts and
  branch-only execution, injected host validation and source verification.
- A CLI loading a trusted host module, safe fake demo, and a Copilot agent.

## Guarantees and limits

SQLite storage is distinct from the stronger private-file ADO ledger boundary.
It assumes a trusted owner-controlled local directory and OS SQLite locking;
no protection against a malicious same-user process, ACL assertion, network
filesystem support, or claim of credential-free sandboxing. Existing ledger
Windows rejection is not changed. All hosts sharing a journal share one lease;
cross-journal repository exclusion is not provided.

Unknown invocations retain their file-scope exclusion until explicit host
reconciliation. Existing change requests are observed, never automatically
created, merged, or deployed. Publishing new commits for CI is a separately authorized external process,
not a capability of this read-only hub host.

## Verification

Run targeted Vitest tests and `npm run typecheck`. Exercise DAG/contract ordering,
both native adapters, concurrency/scopes, restart/deduplication/fencing,
revision-bound evidence, non-vacuous checks, bounded failures, and authority.
Run the fake demo twice against the same SQLite database to demonstrate
persistence and no redispatch. Live hub/agent calls require credentials and are
not implied by fake or request-contract coverage.
