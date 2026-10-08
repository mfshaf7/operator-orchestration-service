---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - docs/contracts/delivery-workflow-api-v1.md
    - docs/operations/delivery-workflow-operator-surface.md
    - src/delivery-art/work-session-controller.js
    - test/delivery-art-work-session.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "The extension reuses the existing evidence-preserving recovery mode and grants no approval, merge, readiness, closeout, source-rebinding, or architecture-supersession authority."
---

# Operating-Evidence Repair Recovery

## Summary

The existing `archive-merged-evidence` recovery now accepts a merged Delivery
ART attempt whose immutable merge-ready Review Packet is valid but whose
post-merge operating evidence is invalid. The repair preserves that packet and
requires a fresh reviewed attempt for the same logical Landing Unit. It does
not create another ART child or rewrite the original source history.

## Classification

- area: Delivery ART work-session recovery
- type: immediate control-plane repair attached to existing work item `#1236`
- Landing Unit decision: `child_isolated_landing_unit`
- split reason: OOS recovery semantics have an independent owner, review path,
  validation surface, and rollback boundary from the Platform commissioning
  Landing Unit
- runtime impact: one additional fail-closed eligibility state on the existing
  authenticated recovery command

## Ownership

- owner repo: `operator-orchestration-service`
- existing ART slice: Epic `#1203`, Feature `#1212`, work item `#1236`
- related component: Workspace Delivery ART work sessions and Review Packets

## Root Cause

- immediate failure: `#1236` had valid live commissioning proof, but OOS reran
  the operating verifier from the original merged PR head and rejected the
  result after reviewed verifier repairs landed separately
- actual root cause: evidence-preserving recovery accepted architecture
  supersession after merge but not the equivalent fail-closed state where a
  valid merge-ready packet precedes a necessary post-merge verifier repair
- why it escaped earlier controls: recovery tests covered corrected
  architecture and missing pre-merge proof, but not a valid merge-ready packet
  followed by invalid operating evidence

## Source Changes

- reuses `mode: archive-merged-evidence`
- admits only the exact `operating-evidence-invalid` projection with matching
  `operating_evidence: invalid`, merged PR truth, and merge-ready packet truth
- retains the existing exact packet custody, digest, scope, operator, branch,
  base, PR URL, head, no-readiness, and open-ART checks
- requires the successor attempt to use a new branch and session generation
  with the complete recovery-receipt chain

## Artifact And Deployment Evidence

- source evidence: reviewed OOS maintenance PR and merged commit
- runtime evidence: existing `accepted-idea-delivery` profile reconciled to the
  merged OOS revision before recovering `#1236`
- intervening Platform maintenance lineage for the successor `#1236` attempt:
  PRs `#274`, `#275`, and `#276`

## Live Verification

- local validation: focused work-session recovery test, full Node suite,
  generated API check, governance docs, and diff-aware change-record validation
- live verification: archive the exact merged `#1236` attempt while preserving
  its merge-ready packet, then start and close a successor attempt on the
  repaired Platform base through normal evidence and review gates
- residual risk: recovery records coordination and preserved evidence only;
  it does not certify the repair or operating outcome

## Security Evidence

The recovery expansion adds no caller, credential, provider action, approval,
merge, deployment, readiness, closeout, or default-branch authority. It accepts
only a state already blocked by invalid evidence and forces the replacement
attempt back through the normal reviewed path.

## Follow-Up

- owner: `operator-orchestration-service` and `platform-engineering`
- closure condition: merged OOS repair, current Security change-record index,
  successful `#1236` recovery, successor Review Packet finalization, and ART
  closeout

## Rollback

Revert the controller, test, contract guidance, operator guidance, and this
record together. Retain any already archived session, packet, and recovery
receipt as immutable audit evidence.
