---
security_evidence:
  review_areas:
    - runtime
    - delivery
  reviewed_artifacts:
    - contracts/workspace-intake/manifest.json
    - contracts/workspace-inventory/manifest.json
    - contracts/delivery-art-work-session/evidence-profile.json
    - src/workspace-operation-activation.js
    - src/workspace-intake/runtime.js
    - src/workspace-inventory/runtime.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: Runtime remains fail-closed until the ordered Console, Security, Platform, and operating-proof work completes.
---

# Workspace Intake And Inventory Orchestration

## Summary

Workspace Intake and Active Inventory now consume the exact merged Workspace
Governance authority and WGCF readiness revisions for Delivery ART #1203. Both
contract bundles bind the shared activation contract, the current durable
architecture packet digest, and ordered downstream work. The reviewed recovery
Landing Unit replaces the superseded packet digest without changing the
approved architecture or activating runtime early.

The OOS source state is `ready-for-console-adapter`. The workflow is eligible
only for the admitted `dev-integration` profile; normal runtime remains
uncomposed until the Console, Security, Platform, and composed operating-proof
items complete. Runtime construction still requires explicit Platform
configuration and cannot infer operating authority from source completion or a
WGCF receipt.

## Classification

- area: Workspace Intake and Active Inventory
- type: contract synchronization and source activation
- runtime impact: source eligible; normal runtime remains uncomposed and inactive

## Ownership

- Workspace Governance remains canonical source authority.
- WGCF remains readiness and custody authority.
- OOS owns durable workflow coordination and terminal receipts.
- The Console projects and submits intent; it does not infer success.
- Security and Platform remain mandatory before routine dev-integration
  availability.

- owner repo: `operator-orchestration-service`
- related ART slice: `openproject://work_packages/1208`
- related products or components: Governance Operations Console, WGCF

## Root Cause

- immediate failure: OOS bundles still referenced historical authority and WGCF revisions.
- actual root cause: source readiness and routine runtime availability were represented by inconsistent manifest shapes, and the first merged source Landing Unit retained the packet digest superseded by the approved recovery packet.
- why it escaped earlier controls: prior workflow-specific activation evidence predated the shared #1203 operation contract.

## Source Changes

- changed workflow, adapter, or contract: synchronized both bundles, added one shared exact-chain activation guard, and rebound both manifests to the current durable architecture digest.
- tests or validator added: positive exact-chain and negative stale/premature-activation cases, including an explicit current-packet digest assertion; owner evidence now binds both filesystem and real-Git conformance cases.
- related change records: None.

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only Landing Unit; runtime deployment is explicitly deferred.
- image tag or digest: None.
- runtime revision: None.

## Live Verification

- local validation: focused workflow tests, contract sync checks, and full repository validation.
- live or dev-integration verification: deferred to ART #1217 and #1210.
- residual risk: Console, Security, and Platform composition is not yet complete.

## Follow-Up

- required follow-up: complete ART #1209, #1216, #1217, and #1210 in order.
- owner: respective owner repos in the approved #1203 architecture packet.
- due date or closure condition: before routine dev-integration availability.

## Evidence

- ART: `openproject://work_packages/1208`
- Architecture packet: `architecture-packet:delivery-1203-v1`, current digest `sha256:34022576c3cbcff6e3bf09d2ac0f5689e1b2255e82cc02a1233970b7fdc03bbe`
- Authority work: `openproject://work_packages/1206`
- Readiness work: `openproject://work_packages/1207`
- Positive and negative activation tests reject stale revisions and premature
  runtime enablement.
