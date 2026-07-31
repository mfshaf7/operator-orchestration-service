---
security_evidence:
  review_areas:
    - delivery
    - runtime
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-07-31 ART Landing-Unit Covered-Parent Order

## Summary

Corrected landing-unit planning so a finalized Review Packet that covers both a
parent Feature and its children completes the children first and reserves the
parent for the existing stale-open closeout route.

## Classification

- area: Workspace Delivery ART operator workflow
- type: defect fix and completion-order guard
- runtime impact: local ART CLI changes the sequence of existing broker
  completion calls; OpenProject mutation authority and schemas are unchanged

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: `#787` under security Feature `#742` and delivery `#698`
- related components: Workspace Delivery ART, OpenProject delivery broker, and
  WGCF ART readiness

## Root Cause

- immediate failure: the finalized #742 Review Packet passed readiness, but
  `landing-unit submit` attempted to complete #742 while #743-#749 were open;
  OpenProject rejected the request with `completion_open_descendants`.
- actual root cause: the planner preserved `covered_work_item_ids` order and
  treated every covered open item as a direct completion target, even when live
  child evidence proved that a covered item was the parent closeout target.
- why it escaped earlier controls: tests covered packets containing child items
  whose parent was discovered from evidence, but not a packet that explicitly
  listed both that parent and its children.
- containment evidence: the rejected parent mutation was first in the plan, so
  no child or parent work item changed during the failed submission.

## Source Changes

- changed workflow or contract: the planner derives covered parent ids from
  live child evidence, canonicalizes covered ids, reports
  `parent_closeout_after_children`, excludes those parents from direct
  completion, orders nested closeouts deepest-first, and keeps the existing
  refreshed `work-item.stale-open-close` path.
- OpenProject form contract evidence: no form schema, writable field,
  `allowedValues`, read-only field, status transition, or roadmap projection
  behavior changed.
- tests added: ART CLI coverage now uses finalized packets containing a parent
  and its children, numeric-form covered ids, and a three-level hierarchy; it
  asserts the exact leaf-first completion and deepest-first closeout sequence.
- operator guidance: the API contract and primary delivery workflow surface now
  explain the parent-plus-children packet projection.

## Artifact And Deployment Evidence

- source evidence: operator-orchestration-service PR #116 and its finalized
  Review Packet for #787
- runtime revision: None
- deployment impact: None

## Live Verification

- local validation: `npm test` passed 299 tests; API docs reported 50
  documented and 50 implemented routes; governance docs passed.
- live or dev-integration verification: the pre-fix #742 submit was rejected
  before partial mutation; post-fix proof is the required retry after PR #116
  and #787 land.
- contract validation: `npm run validate:openproject-mutation-contracts`
  reported no mutation contract
  changes detected
- validator proof: the OpenProject mutation-contract validator self-test passed
- residual risk: parent closeout still depends on refreshed live child evidence
  and remains guarded by the broker and OpenProject descendant checks

## Follow-Up

- required follow-up: merge PR #116, complete #787 from its Review Packet, then
  retry the finalized #742 packet through the corrected landing-unit path
- owner: `operator-orchestration-service`
- closure condition: #742 and #743-#749 close through the governed packet
  without bypassing descendant or readiness guards
