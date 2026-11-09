# Plan and tasks

Specification and decomposition are local; no remote work items are created.

## Design

`CoworkReviewContract.ts` is the contract layer. `CoworkReview.ts` implements
bounded orchestration over host capabilities. `CoworkGovernance.ts` evaluates
instruction proposals. `CoworkGovernanceDependencies.ts` uses the existing
TypeScript compiler API to extract dependency edges, rather than matching names.
No new runtime dependency or central export is introduced.

Review host capabilities mirror the core authorize/execute/resolveRevision
pattern. Core adapts structured review outcomes into policy, not serialized worker
permissions. Immutable snapshots protect against mutation by callbacks. Receipts
are validated at runtime, including exact scope and model binding.

## Decomposed tasks

1. Completed: specification, acceptance criteria, this plan and proposed ADR.
2. Completed: canonical family selection and typed staged review contract.
3. Completed: bounded revision-bound review and critical human gate.
4. Completed: instruction proposal and TypeScript dependency gates.
5. Completed: fake-worker examples and deliberate negative-control tests.
6. Completed: focused Vitest tests and `npm run typecheck`; see handoff evidence.

## Verification

Test aliases, missing families, mismatched receipts, all blocking categories,
advisory replies, critical grants, revision drift, history exhaustion/repetition,
scope/size/negative-controls, generated edits and entries-per-file, actual forbidden
import edges, computed imports, and legacy identity ratcheting. Do not label fake
callbacks as live execution or deployment evidence.
