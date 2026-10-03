---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - contracts/delivery-art-work-session/recovery-receipt.schema.json
    - docs/contracts/delivery-workflow-api-v1.md
    - docs/operations/delivery-workflow-operator-surface.md
    - scripts/sync_delivery_work_session_openapi.mjs
    - src/delivery-art/work-session-controller.js
    - src/delivery-art/work-session-service.js
    - test/delivery-art-work-session.test.js
    - test/delivery-art-work-session-service.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "The repair preserves and binds existing merge-ready evidence while granting no approval, merge, readiness, ART closeout, or source-rebinding authority."
---

# Merge-Ready Session Recovery

## Summary

Architecture-superseded Delivery ART sessions can now be archived after source
merge when they contain one durable, non-finalized merge-ready Review Packet.
The packet remains immutable audit evidence and the replacement source intent
must use a new Landing Unit identity under the current architecture.

## Classification

- area: Delivery ART work-session recovery
- type: bounded evidence-preserving recovery control
- runtime impact: one additional fail-closed mode on the existing authenticated recovery command

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Epic #1203 work item #1228 recovery blocker
- related products or components: Workspace Delivery ART work sessions and Review Packets

## Root Cause

- immediate failure: `work recover` rejected the merged #1228 session because a merge-ready Review Packet existed
- actual root cause: recovery supported missing-evidence merged sessions and pristine unmerged sessions, but no state where valid merge-ready evidence preceded a corrected architecture decision
- why it escaped earlier controls: the architecture-supersession tests covered pristine reconstruction and missing-evidence recovery independently, not their post-merge evidence-bearing intersection

## Source Changes

- changed workflow, adapter, or contract: extends the existing `work recover` command with explicit `archive-merged-evidence` semantics and a receipt binding for the preserved packet
- tests or validator added: positive recovery and negative packet/readiness/source-binding cases plus service command validation
- related change records: [Merged Work-Session Recovery](2026-09-20-merged-work-session-recovery.md), [Unmerged Work-Session Recovery](2026-09-21-unmerged-work-session-recovery.md)

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: reviewed OOS maintenance pull request, followed by bounded dev-integration activation for the live #1228 recovery
- image tag or digest: None
- runtime revision: recorded after merge and local profile reconciliation

## Live Verification

- local validation: focused recovery tests, full Node suite, generated OpenAPI check, governance docs, and diff-aware change-record validation
- live or dev-integration verification: exact #1228 merged session recovers only with the preserved packet digest and then admits a distinct successor Landing Unit under the current architecture
- residual risk: the preserved packet is historical evidence only and cannot satisfy the successor Landing Unit

## Follow-Up

- required follow-up: close the linked regression candidate after the control lands and #1228 recovery succeeds
- owner: `operator-orchestration-service`
- due date or closure condition: merged control, current Security change-record index, successful live recovery, and successor session start

## Security Evidence

The mode narrows recovery to a pre-existing durable packet whose source and
custody bindings match the exact merged PR. It adds no caller, credential,
approval, merge, readiness, deployment, or ART-close authority.

## Rollback

Revert the command mode, receipt schema, controller, generated API contract,
tests, and operator documentation together. Retain any already archived
session, packet, and recovery receipt as immutable audit evidence.
