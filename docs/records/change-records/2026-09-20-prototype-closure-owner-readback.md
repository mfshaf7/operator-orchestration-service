---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - src/prototype-closure/owner-readback-service.js
    - src/prototype-closure/baseline-owner-reader.js
    - src/prototype-closure/delivery-owner-reader.js
    - src/prototype-closure/runtime.js
    - src/app.js
    - docs/api/openapi.json
  workstreams:
    - WS-007
  notes: "Adds caller-bound owner evidence readback for WGCF; normal Closure activation remains false."
---

# Prototype Closure Owner Readback

## Summary

ART #1150 binds Closure's `apply-delivery` request to an already accepted
Prototype-to-Delivery ingress receipt and exact ART target. A WGCF-only OOS
read path checks the accepted baseline against Maturity custody and the
Delivery receipt against trusted OpenProject target activity.

## Classification

- area: Prototype Closure owner evidence
- type: authenticated readback and ingress-order correction
- runtime impact: new caller-specific read-only route, inactive in normal runtime

## Ownership

- owner: `operator-orchestration-service`
- work: source-backed #1150 under Feature #921 and Epic #892
- dependencies: WGCF #1149, Platform #1107, Security #1140, Console #1151

## Root Cause

Closure previously had source-only proof readers and let the request reach
`apply-delivery` before the accepted ingress receipt and exact ART target were
available. That contradicted the committed Studio and Workspace Governance
ingress-first contract.

## Source Changes

- Requires the accepted Delivery receipt and exact target in the Closure
  request; removes the unsupported existing-item route.
- Reads baseline and Delivery receipt evidence from their durable owners.
- Exposes a WGCF-only bounded evidence lookup and rejects unrelated fields.

## Security Boundary

The route accepts only a bounded lookup from a caller-specific
`workspace-governance-control-fabric` identity. It does not accept evidence
bodies, issue readiness, mutate OpenProject, or write Studio source. The
baseline reader requires the durable Maturity receipt and exact merged Studio
readback. The Delivery reader requires the trusted OOS-authored activity,
committed packet, Prototype identity, accepted receipt, and current ART target.
Missing, mismatched, or duplicate owner proof fails closed.

Normal Closure activation stays false. Studio, Platform, and durable-owner
readers plus a Platform disposition reader remain required before a Closure
transition can be available. Source-only tests are not commissioning evidence.

## Artifact And Deployment Evidence

- source: OOS draft PR #215 and WGCF draft PR #74
- deployment: none
- runtime activation: unchanged and false

## Live Verification

No live owner or Console proof is claimed. The configured identity and
cross-service route must be rehearsed under Platform #1107 before activation.

## Validation

- `npm test`: 1,066 passed, 1 skipped.
- `npm run validate:api-docs`: 138 documented and implemented routes.
- WGCF targeted tests for the corresponding owner lookup and bounded HTTP
  client: 17 passed.

## Rollback

Revert the OOS owner-readback route and readers before any activation. No
runtime identity or source-custody state changes are made by this PR.

## Follow-Up

WGCF #1149 must wire the readback with a dedicated credential. Studio,
Platform, and durable-owner proof producers and readers, Security activation,
and Console #1151 operating proof remain prerequisites for normal Closure.
