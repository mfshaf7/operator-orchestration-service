---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - src/openproject-client.js
    - src/art-workflow-artifacts.js
    - src/work-item-create-preflight.js
    - docs/contracts/delivery-workflow-api-v1.md
    - docs/operations/delivery-workflow-operator-surface.md
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "Delivery/runtime impact is limited to broker ART mutation validation. No deployed identity, secret, or privilege boundary changed."
---

# 2026-04-30 plan apply PI Objective contract

## Summary

Added fail-closed validation so `initiative.plan.apply` cannot activate a PI
Objective without the execution-contract fields that scoped ART quality already
requires.

## Classification

- area: delivery ART broker workflow
- type: defect fix / mutation preflight hardening
- runtime impact: broker plan-apply validation and local draft validation

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: `#474`
- related products or components: `Workspace Delivery ART`

## Root Cause

- immediate failure: #473 was created as an active PI Objective without
  `PI Objective Type`, `Planned Business Value`, `Actual Business Value`,
  `Assignee`, or `Responsible`.
- actual root cause: `initiative.plan.apply` validated the tree shape and some
  planning gates, but it did not preflight the active PI Objective execution
  contract before mutation.
- why it escaped earlier controls: local draft validation accepted the payload
  shape, and scoped quality only ran after the bad record already existed.

## Source Changes

- changed workflow, adapter, or contract: plan-apply draft validation,
  OpenProject plan item validation, and plan item assignee/responsible mapping
- tests or validator added: regression tests for local draft validation and
  live broker pre-mutation rejection of the #473 failure shape
- related change records: this file

## Artifact And Deployment Evidence

- source-only change; no image, deployment, or runtime revision was produced
- image tag or digest: `None`
- runtime revision: `None`

## Live Verification

- local validation: `node --test test/art-workflow-artifacts.test.js test/work-item-create-preflight.test.js`
- local validation: `node test/openproject-client.test.js`
- live or dev-integration verification: #473 was repaired through the broker,
  and scoped #420 projection/quality returned `issue_count=0`
- residual risk: this fix is scoped to active PI Objective plan items; broader
  plan-item execution-contract parity can be expanded if future quality gates
  expose another type-specific gap

## Follow-Up

- required follow-up: none for the #473 failure shape
- owner: `operator-orchestration-service`
- due date or closure condition: #474 done with Review Packet evidence
