---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - docs/contracts/delivery-workflow-api-v1.md
    - docs/operations/delivery-workflow-operator-surface.md
    - src/delivery-art/agent-source-identity.js
    - src/delivery-art/work-session-controller.js
    - test/delivery-art-agent-source-identity.test.js
    - test/delivery-art-work-session.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "The repair archives an incomplete local draft but grants no approval, merge, readiness, ART closeout, or source-rebinding authority."
---

# Local-Draft Merged-Session Recovery

## Summary

Ordinary merged-session recovery now archives an incomplete local-draft Review
Packet when the lifecycle has already proven invalid pre-merge source binding.
The recovery receipt continues to record that valid pre-merge proof and the
readiness receipt are missing.

## Classification

- area: Delivery ART work-session recovery
- type: bounded evidence-preserving recovery correction
- runtime impact: one additional fail-closed state accepted by the existing authenticated recovery command

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Epic #1203 work item #1229 recovery blocker
- related products or components: Workspace Delivery ART work sessions and Review Packets

## Root Cause

- immediate failure: Console PR #49 merged while the active session still held a local-draft Review Packet
- actual root cause: lifecycle projection declared the state recoverable, but the controller rejected every ordinary recovery containing any Review Packet
- why it escaped earlier controls: recovery tests covered no packet and durable merge-ready evidence, but not the incomplete local-draft state produced immediately before merge readiness
- publication failure found during repair: Git consulted the operator's global credential helper before Agent Gary's bounded askpass, producing a 403 despite valid provider preflight

## Source Changes

- changed workflow, adapter, or contract: permits ordinary recovery only when the lifecycle projects `local-draft` or `legacy-local-draft`, archives the full session, and retains missing-proof semantics
- source identity correction: clears Git credential helpers for the bounded push so only the exact Landing Unit askpass credential can authenticate
- tests or validator added: positive local-draft recovery, credential-helper isolation, plus existing durable, finalized, readiness, PR-binding, and mode rejection coverage
- related change records: [Merged Work-Session Recovery](2026-09-20-merged-work-session-recovery.md), [Merge-Ready Session Recovery](2026-10-03-merge-ready-session-recovery.md)

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: reviewed OOS maintenance pull request followed by bounded dev-integration activation for the live #1229 recovery
- image tag or digest: None
- runtime revision: recorded after merge and local profile reconciliation

## Live Verification

- local validation: focused work-session tests, full Node suite, governance docs, and diff-aware change-record validation
- live or dev-integration verification: exact #1229 merged session archives with its local draft and a replacement Landing Unit starts with a new identity
- residual risk: the archived draft remains audit context only and cannot satisfy the replacement Landing Unit

## Follow-Up

- required follow-up: close the linked recurrence candidate after the control lands and #1229 recovery succeeds
- owner: `operator-orchestration-service`
- due date or closure condition: merged OOS control, current Security change-record index, successful live recovery, and distinct successor session

## Security Evidence

The correction relies on the already-derived lifecycle state and accepts only
an incomplete local draft. Durable or finalized Review Packets, readiness
receipts, mismatched PR evidence, callers, operators, and revisions remain
rejected. The publication correction removes ambient credential fallback and
forces the existing repository-scoped Agent Gary token. No new identity,
credential, merge, deployment, or ART mutation authority is introduced.

## Rollback

Revert the controller, source-identity environment isolation, tests, contract,
operator guidance, and change record together. Retain any already archived
session and recovery receipt as immutable audit evidence.
