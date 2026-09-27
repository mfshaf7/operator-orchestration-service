---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - Dockerfile
    - contracts/lifecycle-transition
    - src/lifecycle-transition
    - src/app.js
    - src/config.js
    - src/runtime.js
    - dev-integration/profiles/accepted-idea-delivery
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "The API fails closed on stale order, unauthorized owner roles, incomplete route receipts, corrupt persistence, and inactive runtime configuration."
---

# 2026-09-27 Lifecycle Transition Journal

## Summary

OOS now owns one durable, append-only lifecycle transition journal for the
three Workspace Governance routes admitted to the current Console architecture.
It publishes the canonical source envelope with exact next action, bounded
history, owner evidence references, freshness, and monotonic revision.

## Classification

- area: cross-domain lifecycle workflow
- type: new bounded workflow and read model
- runtime impact: adds authenticated journal routes and persistent
  dev-integration state

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Workspace Delivery ART #900, work item #1193
- related products or components: Workspace Governance Control Fabric,
  Governance Operations Console, Workspace Proposals, Workspace Prototype
  Studio, and Workspace Delivery ART
- contract authority: `workspace-governance` commit
  `aec87fd55b1669aad36012300a62f098464ac0ff`

## Root Cause

- immediate failure: the Console architecture had no canonical read and write
  surface for tracking accepted movement across Proposal, Prototype, and
  Delivery boundaries
- actual root cause: route vocabulary existed in Workspace Governance, but no
  runtime owner provided deterministic command acknowledgement, ordered owner
  evidence, exact next action, durable replay, or terminal transition receipts
- why it escaped earlier controls: prior surfaces described route intent while
  leaving cross-domain state distributed across future owner implementations

## Source Changes

- pinned the canonical lifecycle route and projection bundle
- added strict request and owner-event validation
- added atomic, integrity-checked, restart-safe journal storage
- added deterministic create/replay, revision-checked append, single read,
  bounded list/history, cancellation, retry, and supersession behavior
- added authenticated HTTP and OpenAPI surfaces
- added a dedicated persistent mount to accepted-idea-delivery
- packaged the pinned journal contract in both OOS runtime image targets and
  added a regression assertion for that image boundary

## Control Evidence

- route target fields are derived from the pinned authority contract
- caller-to-owner writer bindings are explicit runtime configuration
- stale event order and conflicting replay fail closed
- history exposes evidence references, not embedded raw artifacts or secrets
- terminal state and route completion receipts are enforced before projection

## Artifact And Deployment Evidence

- source-only change: OOS runtime, API contract, tests, and the
  `accepted-idea-delivery` dev-integration profile were updated
- image tag or digest: None
- runtime revision: None; governed runtime activation is not part of #1193

## Live Verification

- local validation: lifecycle contract synchronization, OpenAPI synchronization,
  API documentation, governance documentation, focused lifecycle tests, and
  the complete OOS test suite
- image validation: CI-equivalent API and orchestration-worker image builds,
  API health smoke, and fail-closed worker status smoke
- live or dev-integration verification: profile render and script checks only;
  no governed stage or production activation
- residual risk: WGCF evaluation and Console consumption remain owned by
  follow-on ART work and the journal is not a substitute for either owner

## Validation

- focused service, store, HTTP, authorization, ordering, replay, recovery,
  cancellation, supersession, and persistence tests
- synchronized contract and OpenAPI checks
- full OOS test and governance-document validation

## Follow-Up

- #1194 connects WGCF readiness evaluation
- #1195 consumes the source projection in the Console
- later children own attention, activity, history, and operating-proof wiring
