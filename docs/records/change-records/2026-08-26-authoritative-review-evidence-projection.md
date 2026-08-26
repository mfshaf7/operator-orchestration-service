---
security_evidence:
  review_areas:
    - identity
    - delivery
  reviewed_artifacts:
    - src/delivery-art/review-evidence.js
    - src/delivery-art/lifecycle.js
    - src/delivery-art/lifecycle-controller.js
    - src/delivery-art/service.js
    - src/app.js
    - docs/api/openapi.json
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-08-26 Authoritative Review Evidence Projection

## Summary

Added one authenticated, adapter-independent OOS projection that compiles
Review Packet evidence requirements from durable work-start, architecture, and
exact source truth before operator-authored results are evaluated.

## Classification

- area: Workspace Delivery ART Review Packet lifecycle
- type: workflow contract, read-only evidence projection, and lifecycle
  reconciliation
- runtime impact: source change in the active OOS dev-integration service;
  no stage or production change

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Defect `#988` under delivery `#884`
- related products or components:
  - Governance Operations Console
  - Workspace Delivery ART
  - Workspace Governance Control Fabric

## Root Cause

- immediate failure: a new work session started with blank Review Packet
  evidence and required the operator or AI to reconstruct changed surfaces,
  acceptance mappings, architecture conformance cases, and exact source refs.
- actual root cause: the lifecycle validated evidence only after local
  authoring and did not own a deterministic projection from authoritative
  work-session truth.
- why it escaped earlier controls: lifecycle tests proved artifact validation
  and custody, but did not prove that evidence requirements were generated
  before the human evidence gate or shared across CLI and future Console
  adapters.

## Source Changes

- changed workflow, adapter, or contract:
  - added `POST /v1/delivery-art/review-evidence/project`
  - resolved durable work-start and architecture truth server-side
  - derived changed surfaces, acceptance mappings, and applicable conformance
    cases from the exact Landing Unit source revision
  - preserved operator-authored results while rebinding them to the current
    source head
  - made evidence projection a required lifecycle action before evidence
    evaluation or Review Packet authoring
  - recorded the Governance Operations Console as the future primary normal
    operator workplace while keeping workflow semantics in OOS
- tests or validator added:
  - deterministic projection, stale source, missing evidence, conformance,
    service authority, HTTP authentication, and lifecycle ordering coverage
- related change records:
  - [2026-08-23-delivery-art-work-session-lifecycle.md](2026-08-23-delivery-art-work-session-lifecycle.md)

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only pending local
  validation, pull-request review, merge, and dev-integration dogfood
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation: pending full repository and base-aware validation
- live or dev-integration verification: pending exact-head work-session dogfood
- residual risk: the Console does not yet expose the full work-session UI; it
  will consume this API in its separately governed integration slice

## Follow-Up

- required follow-up: wire the Governance Operations Console ART work-session
  surface to this and the other OOS lifecycle APIs without duplicating state
- owner: `governance-operations-console`
- due date or closure condition: before Console replaces the local CLI as the
  normal Workspace Delivery ART operator surface
