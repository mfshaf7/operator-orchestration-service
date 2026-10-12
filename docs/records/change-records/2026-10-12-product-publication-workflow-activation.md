---
security_evidence:
  review_areas:
    - identity
    - secrets
    - delivery
    - runtime
  reviewed_artifacts:
    - contracts/product-publication/manifest.json
    - src/product-publication/runtime.js
    - test/product-publication.test.js
    - docs/operations/product-publication-operator-surface.md
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: Security approved the exact Product Publication workflow boundary for internal-only, loopback, single-operator dev-integration before this source gate was enabled.
---

# Product Publication Workflow Activation

## Summary

OOS enables the source-owned Product Publication workflow gate after Security
work item `#1257` approved the exact corrected boundary and the matching WGCF
readiness gate merged. This is owner-repository maintenance linked to existing
Platform item `#1258`; it does not create another ART child or activate a
deployed runtime.

## Classification

- area: Product Publication workflow activation
- type: reviewed owner-repository source activation
- work home: maintenance linked to `openproject://work_packages/1258`
- Landing Unit Decision: `child_isolated_landing_unit`
- runtime impact: none until Platform supplies the complete exact composition

## Ownership

- workflow source gate, journal, and terminal receipt: `operator-orchestration-service`
- readiness activation and ledger: `workspace-governance-control-fabric`
- Security acceptance: `security-architecture`
- deployment, configuration, operating proof, and rollback: `platform-engineering`

## Root Cause

The OOS gate was deliberately false while Product Publication awaited
independent Security review. Security `#1257` is now merged, both implementation
corrections are present, and WGCF readiness is source-active. Retaining the
false OOS flag would incorrectly block the approved Platform commissioning
sequence.

## Security Decision

- URI: `security-architecture://product-publication/decisions/console-internal-v1`
- revision: `3dc6e0f6cc2f829b4967ac73269a409e18e0de21`
- review-file digest:
  `sha256:d1d120e1a081d29319394f70fc31b423f81039ccef9e2da0b87327241f5ba837`
- accepted scope: internal-only, loopback-only, single-operator,
  synthetic-data `dev-integration`
- activated WGCF readiness revision:
  `35270e2b5234ad291f951203b6c1f605c380a6a6`

## Source Changes

- changes only the Product Publication `runtime_activation` source gate from
  `false` to `true`;
- preserves `allowed_target_postures: [internal]`, exact Security
  URI/digest/revision matching, caller-to-operator binding, WGCF
  issue-and-readback validation, durable journal locking, replay/version
  controls, terminal receipt integrity, and all cross-boundary denials;
- preserves `dev-integration` as the only accepted runtime profile; and
- updates the primary operator surface and regression coverage so the current
  source and remaining Platform boundary are explicit.

## Validation

- focused tests must prove stage remains denied and incomplete
  `dev-integration` configuration still fails before runtime construction;
- the existing internal positive, broader-posture denial, exact Security
  decision, WGCF issuer/readback, replay, version, caller, journal, and receipt
  cases remain required; and
- full repository, API-documentation, governance-documentation, and exact-base
  validation remain required before merge.

## Artifact And Deployment Evidence

This change produces source evidence only. It does not deploy OOS, create or
expose a route, deliver a credential, contact WGCF, mutate the journal, or prove
operating acceptance. Platform `#1258` must bind the exact merged OOS and WGCF
activation revisions and perform the approved synthetic live proof.

## Live Verification

No live claim is made. OOS still requires the reviewed profile, state root,
caller/operator bindings, exact Security decision, WGCF endpoint and caller
credential, and exact WGCF service identity and implementation revision before
the runtime can be constructed.

## Follow-Up

Platform `#1258` must compose and prove the exact activated OOS revision,
WGCF revision `35270e2b5234ad291f951203b6c1f605c380a6a6`, Security decision, and
Console owner manifest. Any broader posture, caller, exposure, environment, or
data class requires another Security delta and reviewed source changes.

## Rollback

Immediate runtime rollback remains Platform-owned: disable the Console
capability, stop the composition, and remove runtime credentials. Source-level
revocation reverts this change so OOS again fails at the embedded gate. Neither
path deletes durable receipts or rewrites publication history.
