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

# 2026-04-25 ART Initiative Review Pack

## Summary

Added one broker-native initiative review pack read so operators can inspect
initiative review readiness, quality drift, and stale-open candidates from one
bounded route after session bootstrap.

## Classification

- area: delivery workflow
- type: operator-surface hardening
- runtime impact: bounded broker read-path addition in the normal ART workflow

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice:
  - `#308` `Establish broker-native ART session bootstrap, read hierarchy, and quality-readiness surfaces`
  - `#323` `Add one broker-native initiative review pack read that returns quality drift, review readiness, and stale-open candidates`

## Root Cause

The new session bootstrap route made it easier to resume the active ART lane,
but operators still needed multiple separate initiative reads to answer whether
one initiative was review-ready, carrying evidence drift, or simply stale-open.
That kept review judgment fragmented across multiple route calls.

## Source Changes

- added the initiative review pack read and stale-open candidate detection:
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
  - the review-pack route returns delivery identity, initiative review state,
    quality drift, and stale-open candidates
  - the route stays behind the existing broker caller-auth contract
- live devint proof should confirm:
  - stale-open candidates align to the real initiative tree
  - review-pack readiness matches closeout-review truth for the same initiative

## Follow-Up

- restart the devint broker from this branch before probing the new route live
- once live proof is clean, complete ART story `#323`
