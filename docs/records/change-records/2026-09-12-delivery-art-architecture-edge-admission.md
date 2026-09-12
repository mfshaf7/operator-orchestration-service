---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - src/delivery-art/service.js
    - test/delivery-art-service.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "Packet admission checks declared ART topology before immutable custody; no new mutation authority."
---

# Architecture Packet ART Graph Admission

## Summary

Reject Architecture Packets whose declared work-item graph differs from live ART, even when the captured ART digest matches.

## Classification

- Work home: OOS owner-repo corrective maintenance, discovered while starting ART #1143.
- Landing Unit Decision: `child_isolated_landing_unit`; the OOS runtime guard has a different owner, review path, and rollback boundary from the Security review in #1143.
- Landing unit: `oos-delivery-art-architecture-edge-admission`.

## Ownership

- Owner repo: `operator-orchestration-service`.
- Contract owner: `workspace-governance`; no contract schema change.
- Security review area: delivery and runtime.

## Root Cause

The approved #892 packet declared #1101 before #1142, but the matching OpenProject relation was absent. Packet admission checked the captured ART digest without comparing the packet's declared edges to the live ART graph. A later ART update changed the digest, so the historical-material check detected the old mismatch only when #1143 started.

## Source Changes

OOS now applies its existing material scope comparison during Architecture Packet admission even when the digest matches. A declared edge absent from live ART fails before WGCF registration or OpenProject projection. The existing historical check still tolerates nonmaterial ART updates.

## Artifact And Deployment Evidence

- The ART relation was restored through the bounded OOS dependency route as OpenProject relation #313; #1143 then reached `implementation-ready`.
- Source PR and merged revision: pending landing.
- Runtime deployment: none in this source correction.

## Live Verification

- Focused service tests and the full OOS test suite cover admission rejection and ordinary progress.
- No OpenProject field contract, registry authority, credential, or deployment posture changes.

## Follow-Up

- Reconcile the OOS dev-integration runtime to the merged guard before relying on it for new packet admission.

## Rollback

Revert the OOS guard and test together. The ART relation remains canonical and must not be removed as a code rollback.
