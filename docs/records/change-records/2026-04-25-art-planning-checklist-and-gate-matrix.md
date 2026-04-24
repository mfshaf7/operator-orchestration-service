# 2026-04-25 ART Planning Checklist And Gate Matrix

## Summary

Mirrored the ART planning workflow into broker-owned machine-readable metadata
and updated the broker operator surfaces so the route contract now names the
same planning phases and gate ids as the OpenProject owner contract.

## Classification

- area: delivery workflow
- type: control hardening
- runtime impact: bounded broker planning metadata and contract guidance

## Ownership

- owner repo: `operator-orchestration-service`
- related platform contract:
  [`platform-engineering/products/openproject/delivery-art-planning-workflow.json`](https://github.com/mfshaf7/platform-engineering/blob/main/products/openproject/delivery-art-planning-workflow.json)

## Root Cause

The consume-to-PI planning workflow was governed in prose and code, but the
exact phase checklist and control-gate inventory were still easy to reconstruct
differently across repos. The broker was still carrying separate hardcoded
planning lists instead of an explicit mirrored contract.

## Source Changes

- added the broker planning-workflow mirror:
  - `src/delivery-planning-workflow.json`
- switched broker planning constants to derive from the mirrored contract:
  - `src/delivery-taxonomy.js`
- updated the broker operator and contract surfaces:
  - `docs/operations/delivery-workflow-operator-surface.md`
  - `docs/contracts/delivery-workflow-api-v1.md`
- added regression proof that the mirror loads through the test surface:
  - `test/openproject-client.test.js`

## Artifact And Deployment Evidence

- local broker code and contract update only
- no image build or governed runtime promotion in this slice

## Live Verification

- broker-side contract and test surfaces now prove:
  - the broker mirror exists and loads with the canonical backlog iteration
    label and gate metadata
  - the operator surface exposes the phase-to-route and gate matrix
  - the broker contract points to the same mirrored planning workflow source

## Follow-Up

- keep the broker mirror aligned through the workspace cross-repo truth
  validator
- use the active `#293` planning checklist and gate-matrix slice to prove the
  operator-facing workflow end to end
