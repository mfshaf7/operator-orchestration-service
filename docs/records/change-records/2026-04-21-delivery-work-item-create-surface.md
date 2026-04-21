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

# 2026-04-21 Delivery Work-Item Create Surface

## Summary

The broker now exposes `POST /v1/delivery-work-items` as the first delivery
work-item creation surface.

This route creates one child delivery work item below an existing parent while
keeping the broker bounded to workflow-shaped fields. It uses the live
OpenProject form schema to resolve delivery custom fields by name instead of
expanding the broker config into a large static field-id registry.

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
- PI board/view convergence and platform operator wrappers:
  `platform-engineering`

## Root Cause

The first broker tranche proved read and update surfaces, but child work-item
creation still depended entirely on platform-local OpenProject runners. That
left the delivery workflow boundary incomplete and forced operators back onto a
parallel create path when the work queue expanded.

## Source Changes

- added `POST /v1/delivery-work-items`
- added broker service support for delivery work-item creation with:
  - parent-scoped duplicate detection
  - priority inheritance
  - `Target PI` inheritance from the parent work item
  - ready-gate validation for type-specific required fields
  - schedule/progress field handling
  - WSJF score computation when all WSJF inputs are supplied
- kept the broker config bounded by resolving delivery custom fields from the
  OpenProject create-form schema rather than adding a large new config surface
- updated the delivery workflow API contract, repo README, and interface
  manifest

## Artifact And Deployment Evidence

- deployment artifact:
  - dev-integration broker rollout in `devint-accepted-idea-delivery-mfshaf7`
- proof artifact:
  - `.dev-integration/accepted-idea-delivery/mfshaf7/oos-task-62-create-proof.txt`

## Live Verification

- broker identity reprovision in the active devint lane added:
  - `Reader`
  - `Work package creator`
  - `Work package editor`
  - `Work package structure editor`
- live broker proof:
  - `POST /v1/delivery-work-items`
  - created `work-item-70` / `openproject://work_packages/70`
  - parent preserved as `work-item-61`
  - `Target PI` preserved as `PI-2026-02`
- `npm test`
- `node --check src/app.js`
- `node --check src/delivery-service.js`
- `node --check src/openproject-client.js`
- `python3 scripts/validate_governance_docs.py --repo-root .`
- `python3 scripts/validate_change_record_requirement.py --repo-root . --against-ref origin/main`
- `git diff --check`

## Follow-Up

- migrate delivery work-item move behind the broker next
- keep PI board/view behavior aligned to the writable `Target PI` signal in
  `platform-engineering`
