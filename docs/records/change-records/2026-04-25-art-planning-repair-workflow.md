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

# 2026-04-25 ART Planning Repair Workflow

## Summary

Added one broker-native planning-repair workflow so PI retarget, explicit
decommit, and execution-posture correction happen through one initiative-scoped
broker route instead of ad hoc per-item update writes.

## Classification

- area: delivery workflow
- type: operator-surface hardening
- runtime impact: bounded broker write-path addition in the normal ART workflow

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice:
  - `#310` `Brokerize guided closeout, stale-open, planning-repair, and initiative-write parity workflows`
  - `#325` `Add one broker-native planning-repair workflow for PI retarget, decommit, and execution-posture correction`

## Root Cause

The broker already exposed bounded create, update, and plan-apply surfaces, but
operators still had to stitch together ad hoc per-item writes when a PI
retarget, decommit, or execution-posture correction was needed on existing
initiative work. That left planning repair technically possible but not yet a
first-class workflow.

## Source Changes

- added the initiative-scoped planning-repair route and broker projection:
  - `src/delivery-service.js`
  - `src/app.js`
  - `src/art-cli.js`
- added regression coverage for repair success and bounded failure paths:
  - `test/delivery-service.test.js`
  - `test/http.test.js`
  - `test/art-cli.test.js`
- exposed the new operator and API contract surface:
  - `README.md`
  - `docs/contracts/delivery-workflow-api-v1.md`
  - `docs/operations/delivery-workflow-operator-surface.md`
  - `docs/api/openapi.json`

## Artifact And Deployment Evidence

- local broker code and contract update only
- no governed runtime promotion in this slice yet

## Live Verification

- local regression coverage proves:
  - the broker accepts one initiative-scoped planning-repair request
  - the route rejects cross-initiative and invalid decommit attempts cleanly
  - docs and OpenAPI remain aligned to the implemented route set
- live devint proof should confirm:
  - one real planning repair succeeds through the CLI route
  - the resulting ART note and work-item posture are stored correctly

## Follow-Up

- restart the devint broker from this branch before probing the new route live
- use the route against a real operator-owned ART item before closing story
  `#325`
