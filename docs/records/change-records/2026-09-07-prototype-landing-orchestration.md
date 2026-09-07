---
security_evidence:
  review_areas:
    - identity
    - secrets
    - delivery
    - runtime
  reviewed_artifacts:
    - contracts/prototype-landing
    - src/prototype-landing
    - src/app.js
    - src/config.js
    - src/runtime.js
    - docs/api/openapi.json
  workstreams:
    - WS-007
  notes: "Implements the approved source-only boundary; runtime activation remains false."
---

# Prototype Landing Orchestration

## Summary

ART #1088 implements caller-bound durable Prototype Landing coordination from
readiness through reviewed source merge and canonical readback.

## Classification

- area: Prototype Landing workflow authority
- type: source-backed orchestration and trust-boundary implementation
- runtime impact: inactive until Platform work item #1090

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: #1088 under Feature #919 and Epic #892
- related products or components: Workspace Prototype Studio, WGCF, Governance Operations Console

## Root Cause

- immediate failure: Prototype Landing artifacts had no durable workflow owner.
- actual root cause: readiness and source mutation were implemented, but review wait, recovery, merge proof, and terminal receipt were not coordinated.
- why it escaped earlier controls: those responsibilities were deliberately sequenced after contract, source, and readiness authority existed.

## Source Changes

- Pins exact Governance, WGCF, Studio, and Security authority revisions.
- Adds durable caller and idempotency-bound state, readiness issue/readback,
  isolated owner-command execution, repository-scoped review publication,
  cancellation, recovery, merged readback, and value-safe projections.
- Adds focused contract, service, client, HTTP, and disposable real-Git Studio
  lifecycle conformance tests.
- Adds generated OpenAPI and the primary operator procedure.

## Artifact And Deployment Evidence

- source-only change; no deployment or runtime activation
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation: focused Node tests plus stale-source, exact-head, canonical
  merge-readback, and replay proof against a disposable clone of the pinned
  Studio authority
- live or dev-integration verification: deferred to #1090 and #1092
- residual risk: provider identity and composed crash/replay proof remain inactive until those gates complete

## Follow-Up

- required follow-up: activate the bounded identity in #1090, integrate Console projection in #1091, and run conformance in #1092
- owner: Platform Engineering, Governance Operations Console, and Product Prototyping respectively
- due date or closure condition: before Feature #919 closes
