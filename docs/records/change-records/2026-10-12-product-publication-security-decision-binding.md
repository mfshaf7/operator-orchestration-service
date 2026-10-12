---
security_evidence:
  review_areas:
    - identity
    - secrets
    - delivery
    - runtime
  reviewed_artifacts:
    - contracts/product-publication/manifest.json
    - src/config.js
    - src/product-publication/runtime.js
    - src/product-publication/service.js
    - test/product-publication.test.js
    - docs/operations/product-publication-operator-surface.md
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: OOS now verifies the exact configured Security decision before Product Publication readiness or journal mutation; source activation remains separately gated.
---

# Product Publication Security Decision Binding

## Summary

OOS now requires the exact Security decision URI, digest, and Git revision in
private runtime configuration and rejects a Product Publication command when
its decision reference differs. This repairs the completed `#1255` boundary
before Security `#1257` decides whether the exact path may be activated.

## Classification

- area: Product Publication authorization integrity
- type: corrective owner-repo maintenance linked to `#1255`
- runtime impact: none; the bundled Product Publication activation flag remains
  `false`

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: completed Product Publication workflow `#1255`
- reviewing authority: Security `#1257`
- downstream activation: Platform `#1258`

## Root Cause

- immediate gap: command validation proved only that a Security decision had a
  valid shape and namespace;
- security effect: an authenticated caller could submit a different
  well-formed decision reference because OOS did not compare it with a
  Platform-configured accepted decision; and
- planning miss: the pre-Security implementation review checked reference
  presence but not independent authority verification at the OOS boundary.

## Source Changes

- adds three server-only Product Publication Security decision configuration
  values;
- passes one immutable decision binding into the OOS workflow service;
- rejects URI, digest, or revision mismatch before WGCF access or journal
  mutation; and
- documents the exact activation configuration requirement.

## Validation

- `case:1255-negative` proves a mismatched decision is rejected before WGCF;
- the existing positive, replay, version, caller, readiness, and receipt cases
  remain required; and
- full repository and base-aware owner validation remain required before merge.

## Artifact And Deployment Evidence

- source-only correction under owner-repo maintenance;
- no image, deployment, route, credential, or live runtime changed; and
- the Product Publication runtime manifest remains inactive.

## Live Verification

No live claim is made. The focused and full source suites prove fail-closed
decision mismatch before any WGCF request. Platform `#1258` still owns the
later exact-revision composition and bounded live proof.

## Follow-Up

Security `#1257` must review the corrected merged OOS revision. Only after that
decision lands may a separate owner-maintenance activation flip the bundled
source gate for Platform `#1258`; neither maintenance change creates another
ART child or claims live operating proof.
