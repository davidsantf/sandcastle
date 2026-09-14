# Slice 17 tasks and evidence

Base: `79fcbecf4b44499ce9d1ee7530e6f6870f9d1528`.

Engineering artifacts and reviews are user-approved for this slice. This does not
grant runtime product approval, authenticate a comment author, accept any ADR, or
authorize an external provider mutation.

| Task | Scope                                                                            | State    |
| ---- | -------------------------------------------------------------------------------- | -------- |
| W074 | Inspect slice12-16 contracts, roadmap, ADRs, and exact base                      | Complete |
| W075 | Persist specification, plan, and Proposed ADR-0029                               | Complete |
| W076 | Add bounded comment evidence and normalization contracts                         | Complete |
| W077 | Compose exact host route authorization with slice-16 phase execution/recovery    | Complete |
| W078 | Add provenance, replay, concurrency, authority, and retirement tests             | Complete |
| W079 | Export API, README example/runbook, and minor changeset                          | Complete |
| W080 | Run affected validation and independent code/security/spec reviews; fix findings | Complete |
| W081 | Create clean commit and hand off exact head to parent                            | Complete |

## Initial evidence

- Worktree and branch were clean at the exact published slice-16 commit.
- Predecessor authority boundaries were read before implementation.
- Locked dependencies were restored only after `npm run typecheck` reported the
  repository's existing `tsgo` dependency was unavailable.

## Completion evidence

- Eight affected Vitest files passed serially: 65 tests covering comment
  feedback plus every modified phase-runner suite.
- `npm run typecheck` passed.
- Independent security review found no high-confidence vulnerability.
- Independent adversarial review found one replay-integrity defect: evidence
  commitments depended on JavaScript property insertion order. Evidence is now
  projected into a fixed canonical tuple before hashing, and a reconstructed
  replay regression test proves equivalent evidence retains the same result.
- The deterministic fixtures now expose the phase clock explicitly so route
  grants and nested phase policy use one clock without weakening production
  freshness checks.
