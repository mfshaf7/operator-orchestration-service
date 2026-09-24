---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - src/delivery-art/work-session.js
    - test/delivery-art-work-session.test.js
  workstreams:
    - WS-007
  findings: []
  risks: []
  notes: "The evidence gate now selects the finite owner-evidence action before the generic lifecycle fallback. It does not broaden source-executor authority, command allowlists, credentials, or merge authority."
---

# Owner Evidence Action Precedence

## Summary

Delivery work sessions now preserve the actionable owner-evidence transition
when the lifecycle projection reports both the evidence gate and its generic
`review-evidence-required` status.

## Classification

- area: Delivery ART work-session evidence progression
- type: workflow runtime correction
- runtime impact: changes only next-action selection at the existing evidence
  gate; no new command, identity, privilege, or deployment authority is added

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Epic #1154, Feature #1162, Defect #1177
- related products or components: Delivery ART work sessions, owner evidence
  acquisition, Governance Operations Console lifecycle projection

## Root Cause

- immediate failure: #1176 repeatedly returned the generic
  `review-evidence-required` action after its source was pushed
- actual root cause: the generic `projection.next_action` fallback ran before
  the evidence-gate translation in `deliveryArtWorkNextAction`
- why it escaped earlier controls: the evidence-action test covered only a null
  lifecycle next action, while the live lifecycle emits
  `review-evidence-required`

## Source Changes

- changed workflow, adapter, or contract: moves the existing evidence-gate
  translation ahead of the generic lifecycle fallback
- tests or validator added: extends the existing next-action regression test to
  cover both null and live `review-evidence-required` projection shapes
- related change records: `2026-09-24-automated-lifecycle-evidence.md`

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source branch is exercised
  through the supported reviewed-worktree `dev-integration` composition
- image tag or digest: None
- runtime revision: exact pull-request head, pending merge to `main`

## Live Verification

- local validation: focused work-session tests, the full OOS test suite, API
  documentation validation, governance documentation validation, and diff
  integrity pass
- live or dev-integration verification: the reviewed #1177 worktree runtime
  invoked the admitted OOS owner evidence profile and advanced the session from
  evidence-required to merge-required without handcrafted evidence
- residual risk: accepted runtime must be reconciled back to merged `main`
  before dependent Console evidence is acquired

## Follow-Up

- required follow-up: merge #1177, activate accepted OOS `main`, and replay
  #1176 through normal automated evidence acquisition
- owner: OOS runtime owner and Delivery ART operator
- due date or closure condition: #1177 closes with a finalized Review Packet,
  terminal cleanup receipt, and successful #1176 evidence replay

## Rollback

Revert the next-action branch move, regression extension, and this record
together. Existing evidence receipts and finalized Review Packets remain
authoritative and are not rewritten.
