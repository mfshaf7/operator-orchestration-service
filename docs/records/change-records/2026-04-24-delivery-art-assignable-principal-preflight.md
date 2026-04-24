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

# 2026-04-24 Delivery ART Assignable Principal Preflight

## Summary

Added a first-class live assignable-principal discovery helper for Workspace
Delivery ART and documented it as the required preflight before setting
`assignee_login` or `responsible_login`.

## Classification

- owner repo: `operator-orchestration-service`
- related control planes:
  - `workspace-governance`
- trust-boundary areas:
  - runtime
  - delivery

## Ownership

- live assignable-principal discovery helper and broker-side lookup logic:
  `operator-orchestration-service`
- ART workflow doctrine update for future sessions:
  `workspace-governance`

## Root Cause

The assignable-principal rule already existed in the delivery contract, but the
operator-first workflow did not expose one explicit discovery step. That left
assignee and responsible selection vulnerable to ad hoc rediscovery and
avoidable write friction.

## Source Changes

- added `listDeliveryProjectAssignablePrincipals()` to
  [src/openproject-client.js](../../../src/openproject-client.js)
- added the operator helper
  [scripts/show_delivery_art_assignables.mjs](../../../scripts/show_delivery_art_assignables.mjs)
- added `npm run art:assignees` in [package.json](../../../package.json)
- documented the preflight in:
  - [README.md](../../../README.md)
  - [docs/operations/delivery-workflow-operator-surface.md](../../operations/delivery-workflow-operator-surface.md)
  - [docs/contracts/delivery-workflow-api-v1.md](../../contracts/delivery-workflow-api-v1.md)
- extended [test/openproject-client.test.js](../../../test/openproject-client.test.js)

## Artifact And Deployment Evidence

- artifact:
  - one fixed live command now prints the current assignable principals for
    Workspace Delivery ART
- proof:
  - the OpenProject client now has a dedicated method for the same lookup
  - the operator surface and ART skill can point to one canonical preflight
    instead of ad hoc discovery

## Live Verification

- `node --test test/openproject-client.test.js`
- `node scripts/show_delivery_art_assignables.mjs --help`
- `python3 scripts/validate_change_record_requirement.py --repo-root . --against-ref origin/main`

## Follow-Up

- keep `assignee_login` and `responsible_login` discovery routed through the
  live assignable-principal helper rather than Rails-admin or board-label
  inference
