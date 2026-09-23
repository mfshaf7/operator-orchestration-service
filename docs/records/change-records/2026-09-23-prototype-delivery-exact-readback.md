---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - src/delivery-ingress/prototype-adapter.js
    - src/openproject-client.js
  workstreams:
    - WS-007
  notes: "Uses the already-bound exact Delivery target for readback without weakening marker, receipt, actor, or version checks."
---

# Prototype Delivery Exact Readback

## Summary

Prototype Closure now reads the exact Delivery Epic named by its accepted
ingress receipt instead of scanning every Delivery Epic before verifying that
receipt.

## Classification

- area: Prototype Delivery owner evidence
- type: read-path performance correction
- runtime impact: active `dev-integration` Closure evidence readback only

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Epic #892, work item #1151
- related components: Prototype Delivery ingress and Prototype Closure

## Root Cause

The receipt reader already received an exact target reference, but the adapter
discarded that precision and performed a project-wide Epic scan. The scan took
longer than WGCF's bounded owner-read timeout even though the target and receipt
were valid.

## Source Changes

- add an exact Prototype Delivery target read to the OpenProject client
- use it when receipt verification includes a target reference
- bind the target proof's subject to the exact Delivery record it verifies
- align OOS Closure validation with the current Workspace Governance contract
- keep tentative GitHub merge SHAs out of open-review projections
- retain project-wide discovery only when no exact target is available
- cover direct readback and the retained discovery path with regression tests

## Security Boundary

The optimized path still requires the exact target marker, OOS-authored event,
Prototype ID, packet reference, receipt reference, owner repository, and record
version. It changes lookup scope only; it does not add a write path or relax an
evidence check.

The exact read uses the existing OpenProject work-package form schema only to
resolve the Owner Repo field. The existing creation contract still proves that
field writable; this change does not alter allowed values, payloads, or any
mutation route.

## Artifact And Deployment Evidence

- source: OOS PR #226 plus the follow-up target-subject binding PR
- image tag or digest: dev-integration uses the checked-out merged source
- runtime revision: `b864474b061e05d5ff6a596e1511ea44daeec703` before the
  target-subject binding follow-up

## Live Verification

- local validation: full OOS test suite passes with 1,085 tests passed and 2 skipped
- contract validation: Delivery ingress OpenAPI schemas are synchronized
- dev-integration: retry the retained #1151 Closure request and require WGCF
  readiness to resolve the exact Delivery target and receipt within its budget

## Follow-Up

- required follow-up: finish #1151 through the configured Console path
- owner: Agent Gary
- closure condition: the retained Closure request advances past WGCF readiness

## Rollback

Revert the exact-target client and adapter selection together. Receipt
verification will return to bounded project-wide discovery without changing
canonical OpenProject evidence.
