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
    - src/prototype-closure/source-client.js
    - src/prototype-closure/owner-evidence.js
    - src/prototype-closure/store.js
    - src/prototype-closure/service.js
    - src/runtime.js
    - src/app.js
    - docs/api/openapi.json
  workstreams:
    - WS-007
  notes: "Adds caller-bound owner evidence and source-level owner composition for WGCF; normal Closure activation remains false."
---

# Prototype Closure Owner Readback

## Summary

ART #1150 binds Closure's `apply-delivery` request to an already accepted
Prototype-to-Delivery ingress receipt and exact ART target. A WGCF-only OOS
read path checks the accepted baseline against Maturity custody and the
Delivery receipt against trusted OpenProject target activity.
The follow-on source unit also binds committed Studio retention readback and
completed OOS retirement receipt custody for the later reopen action.

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
- Reads the Studio retention plan or retained source from current committed
  `origin/main`, and refuses stale revision or changed source.
- Gives a completed retirement receipt a stable `receipt://prototype-closure/`
  reference, then serves it only when the stored terminal receipt and merged
  Studio retirement event agree.
- Builds local Studio, Delivery, and OOS readers into source composition;
  external Platform and selected durable-owner readers remain mandatory.

## Security Boundary

The route accepts only a bounded lookup from a caller-specific
`workspace-governance-control-fabric` identity. It does not accept evidence
bodies, issue readiness, mutate OpenProject, or write Studio source. The
baseline reader requires the durable Maturity receipt and exact merged Studio
readback. The Delivery reader requires the trusted OOS-authored activity,
committed packet, Prototype identity, accepted receipt, and current ART target.
Missing, mismatched, or duplicate owner proof fails closed.

Normal Closure activation stays false. Platform and durable-owner readers plus
a Platform disposition reader remain required before a Closure transition can
be available. Source-only tests are not commissioning evidence.

## Artifact And Deployment Evidence

- source: merged OOS PR #218 and WGCF #1149; the follow-on OOS source unit is
  tracked by ART #1150
- deployment: none
- runtime activation: unchanged and false

## Live Verification

No live owner or Console proof is claimed. The configured identity and
cross-service route must be rehearsed under Platform #1107 before activation.

## Validation

- `npm test`: 1,073 passed, 2 skipped on the follow-on OOS source unit.
- Isolated real-Git Studio owner-readback test: 1 passed against fetched
  Studio `origin/main` in a temporary clone.
- Cross-repo Closure conformance: all 16 source-only scenarios passed against
  fetched Studio, WGCF, and Console heads; external owner proofs remain
  synthetic fixtures, not local operating evidence.
- `npm run validate:api-docs`: 139 documented and implemented routes.
- WGCF #1149 owner-reader implementation is merged; its configured runtime
  and independent local operation remain later activation evidence.

## Rollback

Revert this OOS owner-composition unit independently of the earlier readback
route before activation. No runtime identity or source-custody state changes
are made by this PR.

## Follow-Up

Platform #1107 must commission the dedicated WGCF/OOS readback credentials,
Platform disposition and durable-owner readers, and the local runtime.
Console #1151 operating proof remains a prerequisite for normal Closure.
