---
security_evidence:
  review_areas:
    - identity
    - secrets
    - delivery
    - runtime
  reviewed_artifacts:
    - contracts/prototype-maturity/manifest.json
    - src/config.js
    - src/prototype-maturity
    - docs/operations/prototype-maturity-operator-surface.md
  workstreams:
    - WS-007
  notes: "Activates only the OOS source capability; Platform commissioning and Console operation remain unavailable."
---

# Prototype Maturity Orchestration Activation

## Summary

ART #1130 activates the existing OOS Candidate and Baseline Promotion
orchestration source against the exact merged Security review, WGCF readiness
activation, composed conformance packet, and dedicated identity evidence.

## Classification

- area: Prototype Maturity orchestration
- type: reviewed source activation
- runtime impact: none until Platform commissions the dedicated
  `dev-integration` composition in ART #1131
- trust-boundary impact: narrows configuration to the dedicated Prototype
  Maturity provider and WGCF identity

## Ownership

- workflow owner: `operator-orchestration-service`
- source-truth owner: `workspace-prototype-studio`
- readiness owner: `workspace-governance-control-fabric`
- identity and runtime owner: `platform-engineering`
- activation-review owner: `security-architecture`

## Root Cause

Prototype Maturity remained source-inactive after the prerequisite conformance,
identity, Security, and readiness work merged. Its configuration also retained
fallbacks to Prototype Landing identity material, which was inconsistent with
the approved dedicated Maturity identity boundary.

## Boundary

OOS remains the durable workflow coordinator. Workspace Prototype Studio owns
source truth, WGCF owns readiness, Platform owns identity and runtime
commissioning, Security owns the activation decision, and the Governance
Operations Console remains a projection-only client.

This change does not issue a credential, activate a deployment, merge a
Prototype transition, admit work to Delivery, publish Portfolio state, or
grant stage or production authority.

## Source Changes

- activate the synchronized Prototype Maturity source manifest;
- pin the merged #1129 WGCF readiness revision and finalized Review Packet;
- pin the merged #1125 Security review, composed conformance, and dedicated
  identity evidence;
- reject malformed activation evidence before constructing workflow artifacts;
- require dedicated Maturity provider and WGCF bindings instead of inheriting
  Prototype Landing identity material; and
- update focused tests and the primary operator surface.

## Remaining Gates

ART #1131 must commission the dedicated identity and exact composed runtime.
ART #1132 must then prove normal Candidate and Baseline operation, denial,
restart, review, readback, suspension, and revocation behavior through the
configured Console.

## Artifact And Deployment Evidence

- source revision: pending reviewed #1130 pull-request merge
- contract manifest: `contracts/prototype-maturity/manifest.json`
- runtime deployment: none in this Landing Unit
- activation prerequisite: finalized #1129 Review Packet pinned by the
  contract manifest

## Live Verification

No live runtime verification applies to this source-only activation. ART #1131
owns runtime commissioning, and ART #1132 owns normal-path and denial-path
operating proof.

## Follow-Up

- complete Platform commissioning in ART #1131
- complete Console operating proof and revocation rehearsal in ART #1132
- do not enable a stage or production path from this source activation

## Rollback

Revert this Landing Unit to restore `runtime_activation: false` and the prior
source manifest. No deployment or data migration is part of this change.
