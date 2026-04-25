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

# 2026-04-25 ART Guided Initiative Closeout

## Summary

Added one broker-native guided initiative closeout workflow so an operator can
record system-demo evidence, enter PM2 Closing, record inspect-and-adapt
actions, append final completion evidence, and finish the initiative through
one bounded broker route.

## Classification

- area: delivery workflow
- type: operator-surface hardening
- runtime impact: bounded broker write-path addition in the normal ART workflow

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice:
  - `#310` `Brokerize guided closeout, stale-open, planning-repair, and initiative-write parity workflows`
  - `#326` `Add one guided initiative closeout workflow that records system demo, enters Closing, records inspect-and-adapt, and finishes the initiative through one broker command`

## Root Cause

The broker already had the primitive initiative-review routes, but the normal
closeout path still required multiple manual writes in a fragile sequence. That
left initiative closeout correct in theory but still too manual for normal ART
workflow use.

## Source Changes

- added the guided initiative closeout route and broker projection:
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
- no governed runtime promotion in this slice yet

## Live Verification

- local regression coverage proves:
  - the broker accepts one guided initiative closeout request
  - the route returns one explicit initiative-close projection
  - docs and OpenAPI remain aligned to the implemented route set
- live devint proof should confirm:
  - one real initiative closes through the guided route
  - the resulting initiative review state is clean

## Follow-Up

- finish the remaining open features under epic `#304` so one real initiative
  is ready for the guided closeout proof path
- use the route against that real initiative before closing ART story `#326`
