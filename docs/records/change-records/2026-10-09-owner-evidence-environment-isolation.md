---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - src/delivery-art/lifecycle-cli-adapters.js
    - test/delivery-art-lifecycle-cli-adapters.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "Ordinary tests and validations lose ambient composition credentials; live verification authority and receipt semantics do not change."
---

# Owner Evidence Environment Isolation

## Summary

Prevent ordinary owner evidence from inheriting the source executor's active
runtime composition and credential environment.

## Classification

- area: Delivery ART owner evidence execution
- type: corrective owner-repo maintenance
- runtime impact: local authenticated source executor evidence subprocesses
- recommendation posture: extend the existing evidence-execution boundary
- Landing Unit decision: `feature_single_landing_unit`; source, tests, and this
  record are one independently reviewable and reversible OOS maintenance unit

## Ownership

- owner repo: `operator-orchestration-service`
- work home: owner-repo maintenance linked to the accepted workspace
  improvement candidate
- tracking reference:
  `workspace-governance/reviews/improvement-candidates/2026-10-09-secret-environment-diagnostic-and-evidence-regression.yaml`

## Root Cause

The Delivery source executor inherited the active `refinement-catalog`
composition environment. It passed that full environment to every owner
evidence command. Repository tests and validations therefore observed unrelated
`DEVINT_*`, CGG, WGCF, and credential variables. The exact CGG revision for
item `#1244` passed in an ordinary shell but failed three profile-isolation
tests under owner evidence.

## Source Changes

- non-runtime owner evidence receives only the minimal host environment needed
  to start repository tools, plus deterministic `CI=true` and `NO_COLOR=1`;
- active composition state and secret-bearing caller variables are not
  inherited by tests or validations;
- `runtime_and_live` evidence retains the active environment because its
  purpose is exact live composition verification, but only behind the existing
  explicit evidence identity and verification-only mutation boundary; and
- focused tests cover both the isolated ordinary path and explicit live path.

## Artifact And Deployment Evidence

- source-only until the owner-maintenance pull request merges
- runtime activation: reconcile the existing `refinement-catalog` composition
  from the merged OOS revision
- no schema, receipt, or ART mutation contract changes

## Live Verification

- the focused lifecycle adapter suite proves ordinary evidence cannot inherit
  composition or secret state;
- the same suite proves live evidence keeps required runtime context only with
  the explicit evidence marker;
- the complete OOS test suite and API/document validators pass; and
- the original CGG owner evidence command must pass under the repaired source
  executor before Delivery item `#1244` continues.

## Residual Risk

Runtime evidence intentionally retains its active composition context. Its
reviewed verifier must continue to avoid printing credentials, while output
custody remains digest-only and mutation remains disabled.

## Follow-Up

- merge and activate the OOS maintenance unit;
- rerun the exact `#1244` evidence acquisition; and
- close the linked regression candidate only after live proof succeeds.

## Rollback

Revert the environment helper, regression tests, and this record together.
Existing evidence receipts and work-session artifacts remain unchanged.
