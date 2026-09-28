---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - contracts/delivery-art/fixtures/architecture-packet.valid.json
    - src/delivery-art/contracts.js
    - test/delivery-art-contracts.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "OOS remains the artifact author and submitter; WGCF remains the durable custody owner; OpenProject receives references only."
---

# Delivery ART Custody Owner Boundary

## Summary

Align the OOS Delivery ART contract bundle and semantic validation with the
canonical custody boundary: OOS authors and submits canonical artifacts, WGCF
persists them and issues receipts, and OpenProject receives safe references
only.

## Classification

- Work home: OOS owner-repo corrective maintenance linked to the accepted workspace-governance improvement candidate `2026-08-12-delivery-art-architecture-fixture-custody-regression`.
- Landing Unit Decision: `feature_single_landing_unit`; the copied contract bundle, OOS semantic validator, and focused tests share one owner, review path, and rollback boundary.
- Runtime impact: validation hardening only; no route, credential, deployment, or mutation-authority change.

## Ownership

- Owner repo: `operator-orchestration-service`.
- Contract owner: `workspace-governance`, canonical revision `18c2d68`.
- Durable artifact custody owner: `workspace-governance-control-fabric`.

## Root Cause

- Immediate failure: the valid copied architecture fixture retained retired OOS persistence and OpenProject attachment language.
- Actual root cause: fixture prose was digest-valid but lacked semantic owner-boundary assertions in both the canonical and OOS validators.
- Why it escaped earlier controls: integrity validation proved content stability, not whether the content assigned custody to the authoritative owner.

## Source Changes

- Synced the merged canonical Delivery ART schemas and fixtures, including recovered work-session identifier support and structured runtime capability IDs.
- Added semantic rejection for missing WGCF custody, non-owner artifact persistence, and canonical artifact content projection to OpenProject.
- Added focused contract tests for each rejected ownership drift.
- No OOS service write path changed; the existing service continues to register canonical content with WGCF and project only references to OpenProject.

## Artifact And Deployment Evidence

- Source PR: #246.
- Image tag or digest: None.
- Runtime revision: None; this landing unit does not deploy a runtime.

## Live Verification

- `npm run validate:delivery-art-contracts`
- `node --test test/delivery-art-contracts.test.js`
- `npm test` (1,148 tests; 1,146 passed and 2 skipped)
- Exact base-aware change-record and OpenProject mutation-contract validators pass.
- Residual risk: WGCF must consume the same canonical fixture and semantic rules before the cross-repo correction closes.

## Follow-Up

- Required follow-up: land the WGCF consumer update, then close the linked workspace-governance improvement candidate with all merged controls.
- Owner: `workspace-governance-control-fabric`, followed by `workspace-governance` for candidate closure.
- Closure condition: both consumer bundles and validators match canonical owner semantics.

## Rollback

Revert the OOS bundle, semantic guard, tests, and this record together. A
rollback must not change the actual WGCF registry write path or grant artifact
custody to OpenProject.
