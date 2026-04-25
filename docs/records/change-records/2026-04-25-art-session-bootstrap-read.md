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

# 2026-04-25 ART Session Bootstrap Read

## Summary

Added one broker-native ART session bootstrap read so operators can resume the
active delivery lane from one supported route instead of stitching together
caller identity, runtime namespace, assignables, active fronts, and initiative
review backlog manually.

## Classification

- area: delivery workflow
- type: operator-surface hardening
- runtime impact: bounded read-path addition in the broker

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice:
  - `#308` `Provide broker-native ART session resume and status reads`
  - `#318` `Add one broker-native ART session bootstrap read that returns caller, namespace, assignables, active fronts, and review backlog`

## Root Cause

The broker already had the underlying initiative and assignable-principal
reads, but resuming a delivery session still required multiple separate calls
and local reconstruction. That made the normal ART workflow slower and kept
resume truth split across low-level helpers instead of one supported session
entrypoint.

## Source Changes

- added the broker-native session bootstrap read and runtime-context derivation:
  - `src/runtime.js`
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
  - the bootstrap route returns caller, runtime, assignables, active fronts,
    and review backlog
  - the route stays behind the existing broker caller-auth contract
- live devint proof should confirm:
  - derived namespace matches the active OpenProject service lane
  - assignables come from the live ART project surface
  - active fronts and review backlog align to current ART truth

## Follow-Up

- restart the devint broker from this branch before probing the new route live
- once live proof is clean, complete ART story `#318`
