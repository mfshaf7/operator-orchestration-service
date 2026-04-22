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

# 2026-04-21 Delivery Work-Item Dependency Surface

## Summary

The broker now exposes `POST /v1/delivery-work-items/{work_item_id}/dependency`
as the bounded dependency workflow surface.

This route records or clears explicit predecessor relationships between
delivery work items without exposing raw OpenProject relation semantics to
callers.

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

Delivery dependency management was already part of the stabilized OpenProject
operator model, but it still lived behind a direct Rails-runner surface. That
left another workflow-shaped delivery command outside the broker boundary even
after execution summary, create, update, move, and blocker management were
broker-owned.

## Source Changes

- added `POST /v1/delivery-work-items/{work_item_id}/dependency`
- added broker service support for dependency set and clear flows
- added OpenProject adapter logic for:
  - predecessor-scoped `follows` relation creation
  - bounded lag and description mutation
  - duplicate relation collapse
  - normalized dependency projection in the broker response
- updated the delivery workflow API contract, repo README, runtime-shape doc,
  and interface manifest

## Artifact And Deployment Evidence

- deployment artifact:
  - active devint broker rollout in `devint-accepted-idea-delivery-mfshaf7`
- proof artifact:
  - `.dev-integration/accepted-idea-delivery/mfshaf7/oos-task-65-dependency-proof.txt`

## Live Verification

- `npm test`
- `node --check src/app.js`
- `node --check src/delivery-service.js`
- `node --check src/openproject-client.js`
- live devint proof on one disposable dependency pair
  - `action=set` created the predecessor-scoped relation
  - broker execution summary reflected the unresolved dependency
  - `action=clear` removed the relation cleanly
- `python3 scripts/validate_governance_docs.py --repo-root .`
- `python3 scripts/validate_change_record_requirement.py --repo-root . --against-ref origin/main`
- `git diff --check`

## Follow-Up

- brokerize delivery parking and initiative-governance commands next under the
  same active feature
