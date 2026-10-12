---
security_evidence:
  review_areas:
    - runtime
    - delivery
  reviewed_artifacts:
    - src/delivery-art/lifecycle-controller.js
    - src/delivery-art/work-session-controller.js
    - test/delivery-art-lifecycle-controller.test.js
    - test/delivery-art-work-session.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: The repair changes only the status precedence for already-acquired bounded owner evidence; it does not weaken evidence fidelity, source binding, recovery eligibility, or operator authority.
---

# Operating Evidence Failure Precedence

## Summary

Delivery work-session status now reports invalid operating evidence whenever
any required operating case has a failed or fidelity-mismatched result, even if
an earlier required case has not produced a result. Missing evidence remains
`required` only when no acquired required case is invalid.

## Classification

- area: Delivery ART owner evidence and merged-session recovery
- type: corrective owner-repo maintenance
- runtime impact: the existing evidence-preserving recovery path becomes reachable after a partially completed acquisition records a later failed case

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: #1273 under Feature #924 and Epic #894
- related component: Delivery ART work-session lifecycle

## Root Cause

- immediate failure: `work continue 1273` recorded a failed operating-positive result while the operating-negative result was still absent, but status remained `operating-evidence-acquisition-required` and rejected the documented recovery action.
- actual root cause: conformance evaluation returned `required` at the first missing case instead of inspecting the remaining required cases for an already-recorded failure.
- secondary contradiction: evidence-preserving recovery checked for the obsolete `operating-evidence-invalid` projection name even though the lifecycle emits `operating-evidence-retry-required`.
- why it escaped earlier controls: tests covered fully missing, fully failed, and repaired collections, but not a partially acquired collection ordered with a missing case before a failed case; the recovery test manually supplied the obsolete state instead of the lifecycle's real projection.

## Source Changes

- changed workflow, adapter, or contract: preserve the existing states and precedence `invalid` over `required` over `ready` across the complete required-case set, and bind recovery eligibility to the lifecycle's actual retry-required projection.
- tests or validator added: prove that a later failed operating case is invalid even when an earlier case is missing, and make the recovery test use the real lifecycle state and action.
- related change record: `docs/records/change-records/2026-10-09-failed-owner-evidence-retry.md`

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: owner-repo maintenance Landing Unit `delivery-894-operating-evidence-failure-precedence`
- image tag or digest: recorded by the accepted-idea-delivery rebuild after merge
- runtime revision: recorded by the accepted-idea-delivery activation after merge

## Live Verification

- local validation: focused lifecycle-controller tests, full repository tests, API contract validation, and base-aware change-record validation
- live or dev-integration verification: rebuild the existing accepted-idea-delivery composition, confirm #1273 projects `operating-evidence-invalid`, then execute the documented evidence-preserving recovery
- residual risk: none beyond the existing fail-closed recovery and source-review controls

## Follow-Up

- required follow-up: complete the preserved-evidence recovery and close #1273, Feature #924, PI Objective #1265, and Epic #894
- owner: `operator-orchestration-service`
- due date or closure condition: before Epic #894 closes
