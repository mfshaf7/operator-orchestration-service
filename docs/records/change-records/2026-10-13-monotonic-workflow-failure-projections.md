---
security_evidence:
  review_areas:
    - runtime
    - delivery
  reviewed_artifacts:
    - src/workflow-progress.js
    - src/workspace-intake/service.js
    - src/workspace-inventory/service.js
    - src/workspace-inventory/lifecycle-service.js
    - src/prototype-landing/service.js
    - src/proposal-target-application/service.js
    - src/prototype-maturity/service.js
    - src/prototype-closure/service.js
    - test/workflow-progress.test.js
    - test/workspace-inventory-lifecycle.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: Failure persistence remains fail-closed and gains one non-secret progress event so canonical source projections cannot change at an unchanged sequence.
---

# Monotonic Workflow Failure Projections

## Summary

Source-backed workflows now append a durable progress event whenever a dependency
failure is persisted. Their existing public projection revision remains the history
length, so a changed failure projection always carries a later event sequence and
timestamp.

## Classification

- area: bounded source-backed workflow reconciliation
- type: corrective owner-repo maintenance
- runtime impact: retryable and non-retryable dependency failures remain visible without producing same-sequence conflicting projections

## Ownership

- owner repo: `operator-orchestration-service`
- related delivery scope: Product lifecycle maintenance under #1273
- tracking record: `workspace-governance/reviews/improvement-candidates/2026-10-12-product-publication-activation-ownership-regression.yaml`

## Root Cause

The affected services persisted `record.failure` directly while deriving the public
revision from `record.history.length`. A provider error therefore changed the public
projection without advancing its ordering evidence, and the Console correctly rejected
the result as conflicting canonical source state.

## Source Changes

- append one status-preserving, non-secret failure event before persisting the record
- apply the same invariant to every source-backed workflow using history length as its revision
- cover the shared persistence rule and the Workspace Inventory lifecycle regression that exposed it

## Artifact And Deployment Evidence

- source landing unit: `product-lifecycle-monotonic-failure-projections`
- deployment path: rebuild the existing `refinement-catalog` OOS workload from the merged owner revision
- rollback: revert the owner-repo merge and reconcile the existing composition; no durable workflow history is deleted

## Live Verification

- local validation: focused workflow tests, full repository tests, API validation, and base-aware governance validation
- dev-integration proof: reconcile the already-merged Workspace Inventory lifecycle request after an expired provider token is rotated
- residual risk: provider failures still stop advancement until their dependency is restored; this change only makes that durable state monotonic and auditable

## Follow-Up

- linked candidate: `workspace-governance/reviews/improvement-candidates/2026-10-12-product-publication-activation-ownership-regression.yaml`
- closure condition: merged source and successful live Product lifecycle continuation
