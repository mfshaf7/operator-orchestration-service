---
security_evidence:
  review_areas:
    - identity
    - delivery
    - runtime
  reviewed_artifacts:
    - contracts/product-publication/manifest.json
    - src/product-publication/contracts.js
    - src/product-publication/runtime.js
    - test/product-publication.test.js
    - docs/contracts/product-publication-workflow-v1.md
    - docs/operations/product-publication-operator-surface.md
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: Security #1262 approved only internal; this Landing Unit binds that exact decision and does not widen allowed_target_postures.
---

# Product Publication Audience Security Binding

## Summary

OOS now binds its Product Publication source gate to the exact merged Security
`#1262` decision while keeping the approved target set exactly `internal`.

## Classification

- area: Product Publication audience activation
- type: Security-bound source activation
- runtime impact: no target-posture expansion; Platform `#1264` must
  recommission the exact internal-only composition

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: `#1263` under Feature `#923` and Epic `#894`
- Security decision:
  `security-architecture://product-publication/decisions/audience-internal-only-v1`

## Root Cause

- immediate failure: none; this is the planned post-Security source boundary
- actual decision: owner-manifest evidence does not prove product access, and
  the reviewed workflow cannot safely activate `unlisted`, `client`, `public`,
  or `archived` as targets
- prevention: runtime configuration must equal the decision URI, digest, and
  revision committed in the OOS source manifest

## Source Changes

- bind the exact Security decision and the `#1262`/`#1264` prerequisites in the
  Product Publication manifest
- retain `allowed_target_postures: ["internal"]`
- reject runtime configuration that contradicts the source Security authority
- prove every unapproved target fails before WGCF access or journal mutation

## Artifact And Deployment Evidence

- source-only change until Platform `#1264` recommissions the composition
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation: focused Product Publication tests and full OOS validation
- live or dev-integration verification: Platform `#1264`
- residual risk: capability support for inactive tuples is not operating
  approval and cannot broaden the manifest

## Follow-Up

- required follow-up: Platform `#1264` binds this exact OOS revision and proves
  internal success plus all denied targets, replay, restart, rollback,
  restoration, and final readback
- owner: `platform-engineering`
- closure condition: finalized `#1264` Review Packet with operating evidence
