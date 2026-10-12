---
security_evidence:
  review_areas:
    - identity
    - runtime
    - delivery
  reviewed_artifacts:
    - contracts/product-publication
    - src/product-publication
    - scripts/sync_product_publication_openapi.mjs
    - docs/api/openapi.json
    - test/product-publication.test.js
    - docs/contracts/product-publication-workflow-v1.md
    - docs/operations/product-publication-operator-surface.md
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: Schema-v2 archive and restore remain source-inactive; the existing internal publication path remains active and unchanged in scope.
---

# Product Lifecycle Maintenance Capability

## Summary

OOS now validates the landed Workspace Governance and WGCF schema-v2 lifecycle
bindings and returns one bounded maintenance projection without activating
archive or restore.

## Classification

- area: Product Publication lifecycle maintenance
- type: inactive workflow capability and operator read projection
- runtime impact: existing internal publication remains active; lifecycle-maintenance actions remain disabled

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: `#1268` under Feature `#924` and Epic `#894`
- related products or components: Workspace Inventory, Product Publication, Governance Operations Console

## Root Cause

- immediate failure: none; this is planned capability work
- actual root cause: OOS v1 could not preserve canonical lifecycle history or distinguish it from publication and product-health state
- why it escaped earlier controls: v2 authority contracts and WGCF evaluation had not yet landed

## Source Changes

- changed workflow, adapter, or contract: exact v2 schema mirrors, inactive archive/restore gate, lifecycle-aware readback, and bounded immutable publication history
- tests or validator added: activation negatives, full archive/restore chain, replay, contradiction, history, API, and existing-v1 compatibility coverage
- related change records: Workspace Governance and WGCF Product Publication lifecycle contract/readiness records

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only Landing Unit `delivery-894-lifecycle-oos-capability`
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation: focused Product Publication tests, generated OpenAPI check, governance-doc validation, and full OOS test suite
- live or dev-integration verification: deferred until Security `#1271`, OOS activation `#1272`, and Platform commissioning `#1273`
- residual risk: no lifecycle-maintenance runtime action is authorized by this change

## Follow-Up

- required follow-up: Platform health source `#1269`, Console composition `#1270`, Security review `#1271`, OOS activation `#1272`, Platform commissioning `#1273`
- owner: respective ART owner repositories
- due date or closure condition: each dependent Landing Unit closes with its finalized Review Packet
