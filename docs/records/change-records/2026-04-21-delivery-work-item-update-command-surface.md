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

# 2026-04-21 Delivery Work-Item Update Command Surface

## Summary

The broker now exposes the first delivery-plane command surface:
`POST /v1/delivery-work-items/{work_item_id}/update`.

This route extends the already-landed execution-summary read model with a
bounded write seam for delivery execution work. It updates one existing work
item without turning `operator-orchestration-service` into a generic
OpenProject patch proxy.

## Classification

- owner repo: `operator-orchestration-service`
- related control planes:
  - `platform-engineering`
- trust-boundary areas:
  - runtime
  - delivery

## Ownership

- broker delivery command contract, caller validation, audit, and OpenProject
  adapter mapping: `operator-orchestration-service`
- canonical OpenProject work-item schema, completion workflow, and ART operator
  runbooks: `platform-engineering`

## Root Cause

The delivery-plane migration was still half-complete. The broker had a bounded
read model through `execution-summary`, but all work-item mutation still
depended on platform-local OpenProject commands. That left the first internal
delivery API family incomplete and kept the broker one step short of owning the
first execution command seam.

## Source Changes

- extended the delivery identity model with broker-shaped work-item ids
- added bounded work-item update mapping in `src/delivery-service.js`
- extended `src/openproject-client.js` to support a bounded patch surface for:
  - `status`
  - `target_pi`
  - `clear_target_pi`
  - `assignee_login`
  - `clear_assignee`
  - `description`
  - `clear_description`
  - `work_note`
- rejected `status=done` through this generic route so completion remains an
  evidence-backed workflow
- exposed the new internal route in `src/app.js`
- updated:
  - `README.md`
  - `docs/architecture/runtime-shape.md`
  - `docs/contracts/delivery-workflow-api-v1.md`
  - `contracts/interface-manifest.json`
- added unit coverage for:
  - service projection
  - HTTP route behavior
  - OpenProject client mapping and guardrails

## Artifact And Deployment Evidence

- deployment artifact:
  - local source change only; no image rebuild or runtime rollout yet

## Live Verification

- `npm test`
- `node --check src/app.js`
- `node --check src/delivery-service.js`
- `node --check src/openproject-client.js`
- `node --check src/config.js`
- `node --check src/delivery-model.js`
- `python3 scripts/validate_governance_docs.py --repo-root .`
- `python3 scripts/validate_change_record_requirement.py --repo-root . --against-ref origin/main`
- `git diff --check`

## Follow-Up

- prove the new route through the `accepted-idea-delivery` devint lane and
  attach completion evidence back into the active ART tasks
- decide the next broker-owned delivery command after this first bounded update
  seam:
  - move
  - blocker
  - dependency
  - parking
