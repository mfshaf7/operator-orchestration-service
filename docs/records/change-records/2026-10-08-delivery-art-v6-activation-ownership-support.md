---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - workspace-governance/contracts/delivery-art-operator-path.yaml
    - workspace-governance/contracts/schemas/delivery-art-architecture-packet.schema.json
    - src/delivery-art/contracts.js
    - src/delivery-art/lifecycle-controller.js
    - src/delivery-art/review-evidence.js
    - src/delivery-art/work-session-controller.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "The change adds dormant fail-closed v6 validation and evidence projection. Current v5 persistence and work start remain unchanged; a separate Security delta review is an activation prerequisite."
---

# Delivery ART V6 Activation Ownership Consumer Support

## Summary

OOS now understands the staged Architecture Packet v6 source-activation chain.
V5 remains the only current authoring and new-work version until independent
WGCF parity, Security review, session inventory, and coordinated activation
complete.

## Classification

- area: Delivery ART architecture, work-session, and evidence lifecycle
- type: corrective workflow and planning-integrity maintenance
- runtime impact: dormant v6 validation and projection; no v6 persistence or
  work-start activation

## Ownership

- owner repo: `operator-orchestration-service`
- related improvement candidate:
  `workspace-governance/reviews/improvement-candidates/2026-10-08-delivery-plan-activation-ownership-regression.yaml`
- authority change:
  [workspace-governance#240](https://github.com/mfshaf7/workspace-governance/pull/240),
  merge `052261b14196d52318767e1bf371b1c156c0ac26`, plus corrective
  [workspace-governance#241](https://github.com/mfshaf7/workspace-governance/pull/241),
  merge `f81c52a45c81e24188a01d71ae54813270eebf0d`

## Root Cause

- immediate failure: an Epic plan routed directly from Security review to
  Platform commissioning while an OOS-owned embedded activation field remained
  false
- actual root cause: v5 models human gates and source order but does not bind
  the source owner, observed activation state, or required owner source change
- why it escaped earlier controls: acyclicity and temporal checks could prove
  that the declared graph was executable without proving that the graph
  contained the source-owned state transition needed by the runtime

## Source Changes

- pin the exact Workspace Governance v6 staged schema and shared activation
  parity vector
- validate exact source evidence, bind its revision to the owner's source
  snapshot, enforce source ownership, separate activation and commissioning
  Landing Units, and prove Security-to-source-to-commissioning order
- apply v5 evidence-owner projection semantics to staged v6 artifacts
- keep the current version at v5 so v6 cannot authorize persistence or work
  start
- make the contract synchronizer support auxiliary schemas without inventing
  an artifact type
- make the covered-alias continuation concurrency proof deterministic instead
  of relying on scheduler timing

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only dormant
  consumer support
- image tag or digest: None
- runtime revision: None; activation is a separate governed Landing Unit

## Live Verification

- local validation: focused Delivery ART contract, synchronization, lifecycle,
  and work-session tests plus the full Node and governance suites
- live or dev-integration verification: not claimed by dormant support
- residual risk: v6 stays unsupported until the remaining activation gates are
  complete

## Follow-Up

- required follow-up: land WGCF parity, complete Security delta review,
  inventory active sessions, and activate v6 in all three owners before
  superseding the Epic 1203 architecture packet
- owner: `workspace-governance`, `workspace-governance-control-fabric`,
  `security-architecture`, and `operator-orchestration-service`
- closure condition: a fresh v6 packet rejects missing or wrongly ordered
  source activation and both consumers report v6 current

## Rollback

Revert the v6 consumer logic, copied contract bundle, synchronizer change,
tests, docs, and this record together. Existing v1-v5 artifacts retain their
prior behavior.
