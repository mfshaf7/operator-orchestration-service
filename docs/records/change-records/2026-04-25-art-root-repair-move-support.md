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

# 2026-04-25 ART Root-Repair Move Support

## Summary

Corrected the broker work-item move path so structural ART repairs can reattach
retired or otherwise inactive root non-Epic items under the correct parent
inside `workspace-delivery-art`.

## Classification

- area: delivery workflow
- type: defect correction
- runtime impact: bounded broker ART hierarchy-repair path

## Ownership

- owner repo: `operator-orchestration-service`
- related ART sweep:
  - `#87` `Apply cybersecurity architecture and control baseline across the AI estate`
  - `#328` `Enabler: Add safe lock-version retry for broker PATCH-based ART write workflows`

## Root Cause

The broker quality-pack correctly included retired ART items, so the global
quality sweep surfaced `#328` as a retired root `User story`. The bounded move
path did not honor that same scope. It validated project membership against the
default open-only project listing and then treated root non-Epic items as
cross-initiative moves because they had no parent chain to an Epic. That made
the supported repair route reject the exact structural drift it needed to fix.

## Source Changes

- include all delivery-project statuses when validating move membership:
  - `src/openproject-client.js`
- allow root non-Epic hierarchy repairs to attach under a valid delivery
  parent instead of failing as cross-initiative moves:
  - `src/openproject-client.js`
- allow retired root repairs to reattach under the owning parent even when the
  real sibling already exists as terminal history:
  - `src/openproject-client.js`
- add regression coverage for repairing a retired root work item:
  - `test/openproject-client.test.js`
- align the move-response contract with legitimate root-repair nullability:
  - `docs/api/openapi.json`
  - `docs/contracts/delivery-workflow-api-v1.md`
  - `scripts/validate_api_docs.mjs`

## Artifact And Deployment Evidence

- local broker code and regression update only
- live ART repair will use the supported move route after the mounted devint
  broker is restarted from the workspace checkout

## Live Verification

- `npm test`
- `npm run validate:api-docs`
- regression coverage now proves the move route can repair a retired root work
  item that still belongs to the delivery project

## Follow-Up

- restart the mounted devint broker and repair `#328` through the supported
  move path
- rerun the full ART quality sweep and keep the sweep open until it returns
  zero issues
