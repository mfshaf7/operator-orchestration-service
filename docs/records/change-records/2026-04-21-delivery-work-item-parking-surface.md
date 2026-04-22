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

# 2026-04-21 Delivery Work-Item Parking Surface

## Summary

The broker now exposes `POST /v1/delivery-work-items/{work_item_id}/parking`
as the bounded inactive-scope workflow surface.

This route parks or resumes one delivery work item without exposing raw
OpenProject custom-field semantics to callers. It also converges the broker
execution-summary model with the current delivery status model by treating both
`parked` and `retired` as inactive scope.

## Classification

- owner repo: `operator-orchestration-service`
- related control planes:
  - `platform-engineering`
- trust-boundary areas:
  - runtime
  - delivery

## Ownership

- broker route, request validation, audit, and OpenProject API adapter logic:
  `operator-orchestration-service`
- platform operator wrapper and runbook:
  `platform-engineering`

## Root Cause

Delivery parking and resume were already part of the stabilized OpenProject
operator model, but they still lived behind a direct Rails-runner surface.
That left another workflow-shaped delivery command outside the broker boundary
and left the broker execution summary behind the current `parked` vs `retired`
inactive-scope model.

## Source Changes

- added `POST /v1/delivery-work-items/{work_item_id}/parking`
- added broker service support for:
  - `park_decision=defer`
  - `park_decision=retire`
  - `resume_status`
  - optional work-note append
- added OpenProject adapter logic for:
  - parking custom-field resolution from the work-package form schema
  - inactive status transitions to `parked` and `retired`
  - blocker-field clearing during park
  - normalized parking projection in the broker response
- updated execution-summary logic so `retired` items are counted and treated as
  inactive alongside `parked`
- updated the delivery workflow API contract, repo README, runtime-shape doc,
  and interface manifest

## Artifact And Deployment Evidence

- deployment artifact:
  - active devint broker rollout in `devint-accepted-idea-delivery-mfshaf7`
- proof artifact:
  - `.dev-integration/accepted-idea-delivery/mfshaf7/oos-task-66-parking-proof.txt`

## Live Verification

- `npm test`
- `node --check src/app.js`
- `node --check src/delivery-service.js`
- `node --check src/openproject-client.js`
- live devint proof on one disposable work item:
  - `action=park` moved the task to `parked`
  - broker execution summary hid the parked task from active scope by default
  - `action=resume` returned the task to active scope cleanly
- `python3 scripts/validate_governance_docs.py --repo-root .`
- `python3 scripts/validate_change_record_requirement.py --repo-root . --against-ref origin/main`
- `git diff --check`

## Follow-Up

- brokerize delivery initiative-governance update next under the same active
  feature
