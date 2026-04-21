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

# 2026-04-21 Delivery Work-Item Move Surface

## Summary

The broker now exposes `POST /v1/delivery-work-items/{work_item_id}/move` as
the bounded delivery hierarchy-mutation surface.

This route moves one delivery work item under a different parent inside the
same initiative while keeping hierarchy validation, audit, and caller identity
at the broker seam.

## Classification

- owner repo: `operator-orchestration-service`
- related control planes:
  - `platform-engineering`
  - `security-architecture`
- trust-boundary areas:
  - runtime
  - delivery

## Ownership

- broker route, request validation, audit, and OpenProject API adapter logic:
  `operator-orchestration-service`
- platform operator wrapper and OpenProject project-model provisioning:
  `platform-engineering`
- pre-implementation security delta review:
  `security-architecture`

## Root Cause

The broker already owned bounded delivery read, create, and update behavior,
but work-item hierarchy correction still depended on direct platform-local
OpenProject mutation. That left one core delivery-control command outside the
broker boundary and weakened the intent-shaped workflow seam.

## Source Changes

- added `POST /v1/delivery-work-items/{work_item_id}/move`
- added broker service projection and audit for delivery work-item moves
- extended the OpenProject client with bounded move validation that:
  - rejects cross-initiative moves
  - rejects parent loops
  - rejects unsupported parent-type relationships
  - rejects duplicate sibling placement under the new parent
- updated the delivery workflow API contract, runtime docs, README, and
  interface manifest

## Security Review Binding

This implementation follows the approved pre-implementation delta review:

- [`../../../../security-architecture/docs/reviews/components/2026-04-21-operator-orchestration-service-work-item-move-pre-implementation-review.md`](../../../../security-architecture/docs/reviews/components/2026-04-21-operator-orchestration-service-work-item-move-pre-implementation-review.md)

The landed route stays within the approved scope:

- one delivery work-item move under one allowed parent
- no generic structure editing
- no cross-initiative movement

## Artifact And Deployment Evidence

- deployment artifact:
  - dev-integration broker rollout in `devint-accepted-idea-delivery-mfshaf7`
- proof artifact:
  - `.dev-integration/accepted-idea-delivery/mfshaf7/oos-task-63-move-proof.txt`

## Live Verification

- `npm test`
- `node --check src/app.js`
- `node --check src/delivery-service.js`
- `node --check src/openproject-client.js`
- live broker proof:
  - `POST /v1/delivery-work-items/work-item-63/move`
  - work item parent changed in OpenProject as requested
- `python3 scripts/validate_governance_docs.py --repo-root .`
- `python3 scripts/validate_change_record_requirement.py --repo-root . --against-ref origin/main`
- `git diff --check`

## Follow-Up

- move the platform OpenProject helper onto the broker route so the platform
  surface becomes a thin wrapper
- brokerize blocker management next under the same `Feature #61` tranche
