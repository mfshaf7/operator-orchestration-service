---
security_evidence:
  review_areas:
    - identity
    - secrets
    - delivery
    - runtime
  reviewed_artifacts:
    - contracts/prototype-maturity
    - src/prototype-maturity
    - src/app.js
    - src/config.js
    - src/runtime.js
    - docs/api/openapi.json
  workstreams:
    - WS-007
  notes: "Implements the approved source-only boundary; runtime activation remains false."
---

# Prototype Maturity Orchestration

## Summary

ART #1097 implements caller-bound durable Candidate Promotion and Baseline
Promotion coordination from current source preparation through explicit
operator decision, reviewed source merge, canonical readback, and terminal
receipt.

## Classification

- area: Prototype maturity workflow authority
- type: source-backed orchestration and trust-boundary implementation
- runtime impact: inactive until the later security, platform, and conformance gates

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: #1097 under Feature #920 and Epic #892
- related products or components: Workspace Prototype Studio, WGCF, Governance Operations Console

## Root Cause

- immediate failure: Candidate and Baseline Promotion had contracts but no durable workflow owner.
- actual root cause: readiness, operator decision, source preparation, review wait, exact merge proof, and completion custody were not coordinated by one bounded service.
- why it escaped earlier controls: implementation was deliberately sequenced after the source and readiness authorities landed.

## Source Changes

- Pins exact Governance, WGCF, Prototype Studio, and Security authority revisions.
- Adds durable caller and idempotency binding, WGCF readiness issue and
  readback, explicit operator decisions, bounded source preparation,
  repository-scoped review publication, cancellation, recovery, reviewed
  merged readback, and terminal receipts.
- Keeps block and closeout decisions non-mutating and prevents unfinished or
  failed readiness from producing promotion receipts.
- Adds focused contract, service, client, HTTP, restart, provider-boundary,
  and disposable real-Git source conformance tests.
- Adds generated OpenAPI and the primary operator procedure.

## Artifact And Deployment Evidence

- source-only change; no deployment or runtime activation
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation: full Node suite plus deterministic contract and OpenAPI checks, base-aware policy checks, and disposable-clone source lifecycle proof
- live or dev-integration verification: deferred to the later Feature #920 activation and conformance children
- residual risk: composed identity, crash/replay, Console projection, and runtime activation remain gated by those children

## Follow-Up

- required follow-up: complete the remaining Feature #920 security, platform, Console, and conformance gates before activation
- owner: Security Architecture, Platform Engineering, Governance Operations Console, and Product Prototyping according to the approved architecture
- due date or closure condition: before Feature #920 closes
