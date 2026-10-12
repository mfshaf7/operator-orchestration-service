---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - security-architecture/docs/reviews/components/2026-10-12-delivery-art-architecture-v6-activation.md
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: Architecture Packet v6 becomes the only new-work version after the coordinated dev-integration activation; existing v1-v5 packets and sessions remain immutable historical evidence.
---

# Delivery ART Architecture V6 Activation

## Summary

OOS activates the already-supported Architecture Packet v6 contract for new
architecture persistence and work start. The change makes source-owned runtime
activation chains machine-enforced instead of relying on operator prose.

## Classification

- area: Delivery ART architecture persistence and work start
- type: control-plane contract activation
- runtime impact: new architecture decisions require schema v6; existing
  sessions retain their exact historical packet binding

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Epic `#894` planning-control maintenance; no new repair
  child
- related products or components: Workspace Delivery ART and Workspace
  Governance Control Fabric

## Root Cause

- immediate failure: Epic `#894` planning omitted owner-source activation
  Landing Units even though the operator skill described that requirement
- actual root cause: schema v6 machine enforcement was staged while schema v5
  remained the only version allowed to persist and authorize new work
- why it escaped earlier controls: prose guidance could be missed and schema v5
  could not reject an omitted runtime-activation ownership chain

## Source Changes

- changed workflow, adapter, or contract: current architecture schema moves
  from v5 to v6; v5 joins v1-v4 as historical read-only evidence
- tests or validator added: current-version, historical-version, persistence,
  work-start, and OpenAPI contract tests cover the v6 cutover
- related change records: the staged v6 support record from 2026-10-08 and the
  Workspace Governance activation record

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source activation followed
  by exact dev-integration deployment and consumer-version readback
- image tag or digest: recorded by the dev-integration session manifest
- runtime revision: recorded after merge and composition refresh

## Live Verification

- local validation: OOS CI-equivalent validation plus base-aware source proof
- live or dev-integration verification: persist and read a fresh v6 packet;
  reject new v5 persistence and work start; preserve historical session reads
- residual risk: stage and production remain unapproved

## Follow-Up

- required follow-up: activate the same current-version posture in WGCF, then
  land Workspace Governance authority and refresh the installed skill
- owner: Workspace Governance
- due date or closure condition: coordinated v6 activation and clean-state
  evidence are complete
