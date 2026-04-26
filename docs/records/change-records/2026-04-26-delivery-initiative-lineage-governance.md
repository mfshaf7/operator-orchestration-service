---
security_evidence:
  review_areas:
    - delivery
    - runtime
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-04-26 Delivery Initiative Lineage Governance

## Summary

Added first-class initiative-family and lineage governance to the broker-owned
delivery initiative surface so top-level ART epics no longer depend on
conversation memory to stay coherent.

## Classification

- area: delivery workflow
- type: control-plane hardening
- runtime impact: bounded initiative-governance, workflow-health, and planning
  surfaces now expose and validate initiative lineage metadata

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice:
  - `#38` `Establish the governed enterprise AI agent control plane and runtime foundation`
  - `#87` `Apply cybersecurity architecture and control baseline across the AI estate`
  - `#251` `Activate the first bounded governed AI assist path after parity and audit gates`

## Root Cause

The ART had become structurally cleaner, but top-level initiatives still lived
too flatly inside one project. The broker could enforce PI planning, closeout,
and blocker posture, yet it had no first-class machine-readable way to express
initiative family, architecture anchor, or upstream gate lineage. That left
important chains like `#38 -> #227 -> #245 -> #251` coherent only because the
operator remembered them.

## Source Changes

- added the broker mirror of the canonical lineage contract:
  - `src/delivery-initiative-lineage.json`
  - `src/delivery-initiative-lineage.js`
- extended initiative governance writes to accept and validate:
  - `initiative_family`
  - `lineage_role`
  - `architecture_anchor_ref`
  - `required_upstream_ref`
- synchronized those values into the stored `Execution Context` section so the
  human-visible epic body stays aligned with the machine fields:
  - `src/openproject-client.js`
- exposed lineage fields through broker initiative projections and workflow
  health summaries:
  - `src/openproject-client.js`
  - `src/delivery-service.js`
- added CLI support for initiative-lineage governance updates:
  - `src/art-cli.js`
- documented the bounded initiative-lineage surface:
  - `README.md`
  - `docs/contracts/delivery-workflow-api-v1.md`
  - `docs/operations/delivery-workflow-operator-surface.md`
  - `docs/api/openapi.json`
- added regression coverage for the new validation and governance payloads:
  - `test/art-cli.test.js`
  - `test/delivery-service.test.js`
  - `test/http.test.js`
  - `test/openproject-client.test.js`

## Artifact And Deployment Evidence

- local broker code, API contract, and regression update
- live ART lineage backfill will use the bounded initiative governance route
  after the mounted devint broker is restarted from the workspace checkout

## Live Verification

- `npm test`
- `npm run validate:api-docs`
- `npm run validate:governance-docs`
- lineage governance payloads now validate through:
  - `POST /v1/delivery-initiatives/{delivery_id}/governance`
- workflow health now reports portfolio counts by initiative family and lineage
  role

## Follow-Up

- provision the new lineage custom fields and managed OpenProject family views
- backfill all top-level initiatives, including `#87`, with the canonical
  lineage mapping
- rerun the full ART quality sweep and keep the slice open until it returns
  zero issues
