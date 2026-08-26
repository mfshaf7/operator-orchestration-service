---
security_evidence:
  review_areas:
    - identity
    - delivery
    - runtime
  reviewed_artifacts:
    - src/app.js
    - src/art-cli.js
    - src/delivery-art/work-session-controller.js
    - src/delivery-art/work-session-service.js
    - src/delivery-art/work-session-store.js
    - docs/api/openapi.json
    - docs/contracts/delivery-workflow-api-v1.md
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-08-27 Delivery Work-Session API

## Summary

Exposed the existing Delivery work-session semantics as a versioned,
caller-bound API suitable for the Governance Operations Console without giving
the browser or the OOS API pod source-execution authority.

## Classification

- area: Workspace Delivery ART execution
- type: operator workflow API, coordination state, source-observation boundary
- runtime impact: source contract only; executor activation remains blocked on
  the separate Security review and dev-integration binding

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: User story `#1024` under delivery `#886`
- governing architecture:
  `wgcf://artifacts/delivery-art/sha256/09618912836c6ce253fabdac4f7944736efed0b22d61676a2ca04dc6f76b0927`

## Root Cause

- immediate gap: the reconstructable work-session lifecycle was available only
  through a local CLI adapter
- actual cause: OOS had a reusable controller but no caller-bound application
  service or public transport contract for the Console
- control response: preserve the controller as workflow authority and add a
  bounded API layer instead of duplicating lifecycle logic in the Console

## Source Changes

- added one application service used by HTTP and the existing CLI adapter
- added caller binding, command identity, exact session revisions, durable
  replay receipts, stale-write rejection, and incomplete-command containment
- added browser-safe projections that remove host commands while retaining
  exact next-action and bounded source-observation truth
- added versioned read, start, continue, and close routes plus generated OpenAPI
- kept runtime execution fail closed until an explicit source executor is
  configured and admitted

## Validation

- focused controller, service, CLI, HTTP, replay, stale, caller, and unavailable
  executor tests
- generated OpenAPI synchronization and API documentation validation
- full repository and base-aware validation evidence is recorded in the
  finalized Review Packet for the Landing Unit

## Artifact And Deployment Evidence

- source-only change pending pull-request review and merge
- no image, cluster deployment, executor activation, or governed runtime change
  is claimed by this Landing Unit

## Live Verification

- local focused and full-repository validation is required before merge
- HTTP executor activation remains unavailable until Security work item `#1025`
  approves the exact boundary and a later dev-integration proof configures it

## OpenProject Mutation Contract

- the work-session API adds no OpenProject field, form schema, or
  `allowedValues` contract
- terminal `close` reuses the existing bounded ART completion path; that path
  reads the live work-package form before PATCH, requires the selected status
  to appear in `allowedValues`, and requires the existing completion fields to
  remain `writable`
- the OpenProject regression asserts that live form-schema read occurs before
  the completion PATCH, so the new caller cannot bypass established mutation
  authority

## Follow-Up

- Security work item `#1025` reviews the exact Console-to-OOS and source-executor
  trust boundary before mutable dev-integration activation
- Console work item `#1026` consumes this API without deriving Git, progress,
  receipt, or completion truth in the browser
