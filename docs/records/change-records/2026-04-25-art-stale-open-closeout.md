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

# 2026-04-25 ART Stale-Open Closeout

## Summary

Added one broker-native stale-open closeout workflow for ART work items so the
broker can verify stale-open candidate shape and then reuse the normal
completion-evidence path in one bounded request.

## Classification

- area: delivery workflow
- type: operator-surface hardening
- runtime impact: bounded broker write-path addition in the normal ART workflow

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice:
  - `#310` `Brokerize guided closeout, stale-open, planning-repair, and initiative-write parity workflows`
  - `#324` `Add one broker-native stale-open closeout workflow for ART work items`

## Root Cause

The new initiative review pack can now identify stale-open candidates, but the
operator still had to reconstruct the closeout steps manually. That left the
stale-open signal informative but not yet actionable through one supported
broker workflow.

## Source Changes

- added the guarded stale-open closeout route and broker-service projection:
  - `src/openproject-client.js`
  - `src/delivery-service.js`
  - `src/app.js`
- added regression coverage for the new service and HTTP route:
  - `test/delivery-service.test.js`
  - `test/http.test.js`
- exposed the new operator and API contract surface:
  - `docs/contracts/delivery-workflow-api-v1.md`
  - `docs/operations/delivery-workflow-operator-surface.md`
  - `docs/api/openapi.json`

## Artifact And Deployment Evidence

- local broker code and contract update only
- no image build or governed runtime promotion in this slice yet

## Live Verification

- local regression coverage proves:
  - the stale-open closeout route requires explicit justification
  - the route reuses the normal completion-evidence model
  - the route returns dedicated stale-open closeout metadata
- live devint proof should confirm:
  - the route closes a real stale-open candidate through one broker request
  - the guarded validation rejects non-candidates cleanly

## Follow-Up

- restart the devint broker from this branch before probing the new route live
- use the route against a real stale-open candidate before closing ART story
  `#324`
