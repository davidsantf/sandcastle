# Slice 18 tasks and evidence

Base: `8c032918725ebae80f54c44df31cf68e8da3a6d3`.

| Task | Scope                                                               | State    |
| ---- | ------------------------------------------------------------------- | -------- |
| W082 | Derive human-control and uncertainty contracts from slices 12-17    | Complete |
| W083 | Write specification, plan, and Proposed ADR-0030                    | Complete |
| W084 | Implement bounded status/audit and human-authorized controls        | Complete |
| W085 | Implement exact pending-phase adjudication through slice-16 history | Complete |
| W086 | Add replay, authority, uncertainty, and privacy tests               | Complete |
| W087 | Export API, README runbook, and minor changeset                     | Complete |
| W088 | Run validation and independent code/security review; fix findings   | Complete |
| W089 | Commit and hand off the exact head for stacked publication          | Complete |

Engineering phases are approved for this slice. Runtime human decisions,
provider mutations, publication, merge, and ADR acceptance are not.

## Completion evidence

- Human-control and ledger validation passed: 17 tests with two existing
  Windows-specific skips. The broader affected phase, feedback, ledger, and
  control runs passed when isolated serially; typecheck passed after the final
  changes.
- Independent reviews found and remediation closed:
  - unauthenticated retained control/adjudication replay;
  - claim-token disclosure to verifier and policy seams;
  - UTC-only grant freshness;
  - mutation-only dependencies on read actions;
  - exact replay ordered after unrelated pending isolation;
  - post-write terminal receipt verification;
  - non-atomic authorization expiry;
  - missing prior-checkpoint prefix verification;
  - expired candidate retention; and
  - source-breaking widening of the public ledger error union.
- The ledger's optional `notAfter` is request-digest-bound and checked after
  record loading and immediately before atomic publication. Expiry is reported
  through the existing validation error shape.
- Security closure review reported no remaining high-confidence vulnerability.
