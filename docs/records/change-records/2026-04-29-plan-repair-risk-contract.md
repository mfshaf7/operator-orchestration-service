---
security_evidence:
  review_areas:
    - runtime
    - delivery
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-04-29 Plan Repair Risk Contract

## Summary

Updated the documented API contract for delivery plan repair so the bounded
`execution_posture_correction` path accepts ROAM risk posture fields that the
service already forwards.

## Classification

- area: delivery workflow
- type: API contract correction
- runtime impact: local API probe and operator-facing delivery repair contract

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice:
  - `#362` `Introduce universal governed work-tracking home controls for meaningful changes`
  - `#372` `Risk: work-home controls become too rigid for low-risk maintenance`
  - `#376` `Defect: Plan repair contract rejects documented ROAM risk fields`

## Root Cause

The service handler and tests already supported forwarding `roam_state`,
`risk_owner`, `risk_review_date`, and `risk_disposition` through plan repair,
but `docs/api/openapi.json` did not include those fields on
`DeliveryPlanningRepairAction`. `api:probe` correctly rejected the live repair
payload before calling the broker because the request body did not match the
documented contract.

## Source Changes

- updated [docs/api/openapi.json](../../../docs/api/openapi.json) to include
  ROAM risk posture fields on `DeliveryPlanningRepairAction`
- updated [docs/api/openapi.json](../../../docs/api/openapi.json) to include
  risk posture fields on `DeliveryPlanningPosture`
- added [test/api-contract.test.js](../../../test/api-contract.test.js)
  coverage proving the plan-repair request schema accepts the documented risk
  posture fields

## Artifact And Deployment Evidence

- artifact:
  - `npm test -- test/api-contract.test.js` passes
  - `npm test` passes
  - `npm run api:probe -- POST /v1/delivery-initiatives/delivery-362/plan/repair --body-file .tmp/repair-372-risk-posture.json --show-body` passes from the fixed branch
- deployment:
  - no broker runtime restart is required for this correction because the live
    service handler already accepts the fields; the corrected local OpenAPI
    contract unblocks `api:probe`

## Live Verification

- live devint probe accepted the #372 ROAM risk posture payload through
  `POST /v1/delivery-initiatives/delivery-362/plan/repair`
- live response updated #372 assignee/responsible to `Workspace Governance`
- live response changed #372 `ROAM State` from `Owned` to `mitigated`
- live response set #372 risk review date to `2026-04-29`
- live response set the mitigation disposition explaining the proportional
  work-home controls

## Follow-Up

- complete `#376` after this PR merges
- close `#372` after the mitigation evidence is recorded
