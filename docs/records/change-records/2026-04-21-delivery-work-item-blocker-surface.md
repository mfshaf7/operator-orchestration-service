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

# 2026-04-21 Delivery Work-Item Blocker Surface

## Summary

The broker now exposes `POST /v1/delivery-work-items/{work_item_id}/blocker`
as the bounded blocker workflow surface.

This route records or clears delivery blocker governance without exposing raw
OpenProject custom-field semantics to callers.

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

Delivery blocker management was already part of the stabilized OpenProject
operator model, but it still lived behind a direct Rails-runner surface. That
left a workflow-shaped delivery command outside the broker boundary even after
execution summary, create, update, and move were broker-owned.

## Source Changes

- added `POST /v1/delivery-work-items/{work_item_id}/blocker`
- added broker service support for blocker set and clear flows
- added OpenProject adapter logic for:
  - blocker custom-field resolution from the work-package form schema
  - blocked-status transition on `action=set`
  - non-`blocked` resume-status transition on `action=clear`
  - normalized blocker projection in the broker response
- updated the delivery workflow API contract, repo README, runtime-shape doc,
  and interface manifest

## Artifact And Deployment Evidence

- deployment artifact:
  - active devint broker rollout in `devint-accepted-idea-delivery-mfshaf7`
- proof artifact:
  - `.dev-integration/accepted-idea-delivery/mfshaf7/oos-task-75-execution-summary-proof.txt`
  - `.dev-integration/accepted-idea-delivery/mfshaf7/oos-task-64-blocker-proof.txt`

## Live Verification

- `npm test`
- `node --check src/app.js`
- `node --check src/delivery-service.js`
- `node --check src/openproject-client.js`
- live devint proof on `work-item-64`
  - `action=set` moved the task to `blocked`
  - direct OpenProject backend readback confirmed blocker fields persisted
  - `action=clear` returned the task to `in-progress`
  - direct OpenProject backend readback confirmed blocker fields cleared
- `python3 scripts/validate_governance_docs.py --repo-root .`
- `python3 scripts/validate_change_record_requirement.py --repo-root . --against-ref origin/main`
- `git diff --check`

## Follow-Up

- brokerize delivery dependency management next under the same active feature
- keep the platform blocker command as a thin wrapper over the broker route
