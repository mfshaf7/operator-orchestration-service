---
security_evidence:
  review_areas:
    - delivery
    - identity
    - runtime
  reviewed_artifacts:
    - contracts/work-design/application-event.schema.json
    - contracts/work-design/projection-result.schema.json
    - contracts/work-design/manifest.json
    - docs/contracts/work-design-v1.md
    - docs/api/openapi.json
    - src/work-design/application-adapter.js
    - src/work-design/application-event-codec.js
    - src/work-design/application-model.js
    - src/work-design/service.js
    - src/openproject-client.js
    - src/app.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "The projection trusts only strict Work Design events authored by the authenticated OOS OpenProject identity; ordinary or foreign comments cannot become receipt truth."
---

# 2026-08-25 Work Design Durable Projection

## Summary

Implemented Delivery ART `#997`. OOS now exposes the current Work Design source
revision and durable apply history, and reconstructs idempotent apply state after
process restart without adding another database or allowing direct Console
access to OpenProject.

## Classification

- area: governed Delivery Work Design
- type: source projection and durable application receipt correction
- runtime impact: OOS API and OpenProject adapter in dev-integration only

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Defect `#997` under Feature `#908` and delivery `#884`
- dependent landing unit: Governance Operations Console `#996`

## Root Cause

- the Console integration required the current OpenProject source revision but
  direct Console access to OpenProject is forbidden
- completed apply receipts existed only in OOS process memory, so restart could
  erase replay truth and make the UI claim a false result
- the initial OpenProject lock revision is `version-0`, which the first
  projection contract incorrectly rejected
- canonical Delivery reconciliation prevented duplicate records, but did not
  provide a read projection or durable receipt ledger for the Console

## Source Changes

- added strict `apply-intent` and `apply-completed` event schemas
- persisted intent before canonical mutation and completion after readback
- trusted only events authored by the authenticated OOS OpenProject identity
- added restart-safe replay and pending-intent reconciliation
- admitted the valid initial OpenProject `version-0` source revision
- added the authenticated read-only Work Design projection route
- bounded public history to the newest 100 completed applications
- added fail-closed tests for malformed, foreign, conflicting, unavailable, and
  interrupted receipt paths

## Validation

- focused Work Design contract, HTTP, service, and OpenProject adapter tests
- full OOS test suite and generated OpenAPI validation
- base-aware OpenProject mutation-contract validation
- dev-integration container proof including process restart and replay

## Artifact And Deployment Evidence

- source and image digests are recorded in the finalized Review Packet for
  `#997`
- the dev-integration proof uses the branch image and existing admitted
  OpenProject authority; it does not activate stage or production

## Live Verification

- the branch API is exercised against dev-integration dependencies
- verification records source projection, first apply, process restart, replay,
  the same `openproject://work_packages/42/activities/66` receipt, one projected
  application, and no created or updated canonical Delivery records

## Follow-Up

- `#996` consumes the projection through the Console same-origin adapter
- stage and production admission remain outside Feature `#908`

## Rollback

Revert the projection route, durable event adapter/model, event and projection
schemas, and apply event writes together. Do not leave the Console adapter live
without an authoritative source and receipt projection.
