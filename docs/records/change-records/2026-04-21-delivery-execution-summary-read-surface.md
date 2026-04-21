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

# 2026-04-21 Delivery Execution Summary Read Surface

## Summary

The broker now exposes the first delivery-plane read model:
`GET /v1/delivery-initiatives/{delivery_id}/execution-summary`.

This route gives internal callers a bounded execution summary for one delivery
initiative without exposing raw OpenProject query semantics. It is the first
implemented surface under the new delivery API family and extends the broker
beyond proposal-plane transitions.

## Classification

- owner repo: `operator-orchestration-service`
- related control planes:
  - `platform-engineering`
- trust-boundary areas:
  - runtime
  - delivery

## Ownership

- delivery execution summary route, read projection, audit, and OpenProject API
  adapter logic: `operator-orchestration-service`
- canonical delivery project model, board model, and OpenProject admin surfaces:
  `platform-engineering`

## Root Cause

The platform already had a strong operator-facing OpenProject execution surface,
but the broker still stopped at proposal-plane transitions. That left the
delivery workflow boundary half-migrated: operators could consume and close out
ideas through the broker, but execution visibility still depended entirely on
platform-local OpenProject scripts.

## Source Changes

- added delivery-plane model and service modules:
  - `src/delivery-model.js`
  - `src/delivery-service.js`
- extended the OpenProject client with a bounded delivery execution summary
  projection that:
  - reads delivery work packages from the canonical delivery project
  - builds a recursive execution tree for one initiative
  - computes summary counts by status, type, PI, and assignee
  - exposes dependency and dependency-blocked state
- exposed the new internal route:
  - `GET /v1/delivery-initiatives/{delivery_id}/execution-summary`
- updated the runtime docs, delivery API contract, README, and interface
  manifest so the route is visible as a real broker surface

## Artifact And Deployment Evidence

- deployment artifact:
  - local source change only; no image rebuild or runtime rollout yet

## Live Verification

- `npm test`
- `node --check src/app.js`
- `node --check src/openproject-client.js`
- `node --check src/delivery-service.js`
- `node --check src/delivery-model.js`
- `python3 scripts/validate_governance_docs.py --repo-root .`
- `python3 scripts/validate_change_record_requirement.py --repo-root . --against-ref origin/main`
- `git diff --check`

## Follow-Up

- implement the first bounded delivery write surface next:
  - delivery work-item update mapping
- finish the HTTP exposure slice for the delivery work-item update command
- decide whether blocker-field detail should enter the broker read model now or
  remain platform-only until blocker field ids are admitted explicitly into the
  broker config contract
