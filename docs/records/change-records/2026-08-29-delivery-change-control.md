---
security_evidence:
  review_areas:
    - identity
    - delivery
    - runtime
  reviewed_artifacts:
    - contracts/delivery-change
    - src/delivery-change
    - src/openproject-client.js
    - src/app.js
    - src/runtime.js
    - docs/api/openapi.json
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-08-29 Delivery Change Control

## Summary

Added the authoritative OOS contract for reviewing and applying one in-flight
Delivery package change without allowing the Console to derive backend success,
repository authority, rollback, or receipt truth.

## Classification

- area: active Workspace Delivery package adaptation
- type: operator workflow API, optimistic concurrency, durable mutation receipt
- runtime impact: source contract and OOS runtime implementation; Console
  consumption remains in work item `#1029`

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: User story `#1028` under Delivery `#886`
- governing architecture: `.art/architecture-packet-delivery-886-v1.json`

## Root Cause

- immediate gap: the Console could edit a local execution-tree draft but had no
  coherent backend command contract for applying active-work changes
- actual root cause: work-item, blocker, dependency, parking, Catalog, and
  Repository routes existed as separate capabilities without one revision and
  evidence boundary
- control response: compose existing authorities behind one typed command
  service rather than duplicate their semantics or create another database

## Source Changes

- added canonical Delivery package projection and semantic source revision
- added typed commands for add, revise, move, remove, dependency, blocker,
  parking, repository request, Catalog repository link, and rollback rejection
- added operator acceptance, durable command identity, accepted-intent events,
  replay, stale rejection, before/after revision evidence, receipts, rollback
  disposition, and exact next action
- added explicit routed and partial-failure results across Repository and Catalog
  ownership boundaries
- added generated OpenAPI, operator contract guidance, and focused HTTP,
  contract, replay, stale, partial-failure, and rollback tests

## Artifact And Deployment Evidence

- source change pending pull-request review and merge
- local API and worker validation images built; no image was pushed or deployed
- runtime revision: None

## OpenProject Form Contract Evidence

- no new OpenProject custom-field writer was introduced; typed change commands
  compose the existing Delivery mutation services
- those services reread the live form schema, require each target field to be
  writable, validate `allowedValues` where OpenProject supplies them, and bind
  updates to the current `lockVersion`
- accepted-intent and terminal-result evidence reuse the existing activity
  comment mutation path rather than bypassing form or field controls
- the changed OpenProject client regression test proves the semantic source
  revision from the existing execution-summary fixture without deriving
  writability from Console state

## Live Verification

- local validation: focused and full-repository validation before merge
- live or dev-integration verification: deferred to Console adapter and
  end-to-end proof work after `#1029`
- residual risk: accepted commands whose terminal event cannot be persisted
  require explicit reconciliation; they are never replayed blindly

## Follow-Up

- required follow-up: Console work item `#1029` consumes the projection and
  command routes, refreshing canonical revision between reviewed commands
- owner: `governance-operations-console`
- closure condition: finalized Review Packet for `#1029`
