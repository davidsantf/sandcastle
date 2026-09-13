# Slice 16 tasks and evidence

Base: `6c9c4c279a1aadbc1018613c90c52297d23d5219`.
Engineering specification/plan/implementation/review approval was supplied by the
user for slices 16-19. This does not grant runtime human design authorization or
change Proposed ADR status.

| Task | Scope                                                                          | State    |
| ---- | ------------------------------------------------------------------------------ | -------- |
| W066 | Inspect predecessor contracts; persist spec/plan/Proposed ADR and schema proof | Complete |
| W067 | Implement bounded input, history and acknowledgement protocol                  | Complete |
| W068 | Compose host-selected phases, runtime design/target proofs and adapter         | Complete |
| W069 | Add recovery, concurrency, stale-authority and retirement coverage             | Complete |
| W070 | Export API, example/runbook, minor changeset                                   | Complete |
| W071 | Targeted suites, typecheck/build/public type guard                             | Complete |
| W072 | Independent conformance/adversarial/security review and fixes                  | Complete |
| W073 | Commit clean slice 16 and hand off exact head for parent publication           | Complete |

## Initial evidence

- Isolated branch verified at exact base; tracked worktree initially clean.
- Existing chosen test command failed with missing `vitest`.
- Locked dependency restore: `npm ci --ignore-scripts --no-audit --no-fund`, 507
  packages installed; no manifest change.
- Slice-15 recovery deliberately returns historical approval with unavailable
  publication evidence. It is not used as a runtime grant.

## Completion evidence

- Added bounded plain-data input/response projection, immutable intent and
  namespace commitments, full retained-history reduction, exact direct
  acknowledgement checks, and lease/deadline/call retirement.
- Added one preparation or implementation dispatch per reserved occurrence.
  Implementation composes `runDevSquadSandcastleExecution`, captures supplied
  seams and provider configuration before awaits, rehydrates exact design/human/
  publication/material authority, proves the current target, and performs a fresh
  exact policy/CAS check before execution, each validation command, and terminal
  mutation.
- Recovery has read-only ledger capability, never retries, and reports terminal
  history only after a trusted host rehydrates the exact policy/design/execution
  audit trail. A public ledger commitment alone is not treated as authority.
- Deterministic suites cover prepare/implement success, settled failure and
  recovery; exact policy denial for reserve/dispatch/complete/fail; missing,
  mismatched and stale design/target/receipt evidence; work-item/branch/worktree
  binding; CAS/fence/lease; same/different-occurrence concurrency; replay/forged/
  lost acknowledgements; dependency mutation; malformed/uncertain responses;
  cancellation, timeout and late settlement; input limits and malformed history.
- `npm test --` with the four phase-runner suites plus the execution-adapter and
  current-target suites: **7 files, 84 tests passed**.
- `npm run typecheck`: passed.
- `npx tsup`: ESM and DTS builds passed. `npm run build` reached the same
  successful ESM/DTS output, then the inherited POSIX `rm` postbuild command was
  unavailable on Windows; template copy was completed with PowerShell.
- `node scripts/check-public-types-effect-free.mjs`: passed.
- Targeted Prettier check: passed.
- Independent security review found three high-confidence blockers: forgeable
  unaudited terminal history, mutable provider configuration after authorization,
  and continued validation dispatch after malformed evidence. All three were
  fixed and regression-tested. Independent code review then reported no
  significant issues.
- ADR-0027 and ADR-0028 remain Proposed. No live calls, external writes,
  publication, PR, push, or merge were performed.
