---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - src/delivery-art/review-evidence.js
    - src/delivery-art/work-session-controller.js
    - src/delivery-art/work-session.js
    - test/delivery-art-work-session.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "The correction preserves implementation and source-merge gates while preventing a later system-activation gate from holding merge-ready source work open."
---

# 2026-09-27 Transition Target Gate Order

## Summary

Delivery ART work sessions now derive the highest applicable conformance target
for each Landing Unit and apply runtime-activation or operating-readiness human
gates only to work whose target is `operating-ready`. A later system activation
gate no longer prevents closeout of a completed `merge-ready` source unit.

## Classification

- area: Delivery ART work-session control
- type: transition-order defect correction
- runtime impact: changes work-session status and closeout gate projection

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Workspace Delivery ART #900, work item #1192
- related products or components: Delivery ART work sessions and Architecture Packet v3

## Root Cause

- immediate failure: finalized `merge-ready` work item #1192 was held open by the later #1201 `before_operating_ready` platform gate
- actual root cause: work-session gate evaluation treated merged source as sufficient to reach every post-merge architecture transition and did not consider the Landing Unit's conformance target
- why it escaped earlier controls: the existing gate test covered merged source with an operating gate but did not distinguish `merge-ready` from `operating-ready` work

## Source Changes

- changed workflow, adapter, or contract: conformance target derivation and architecture human-gate applicability
- tests or validator added: merge-ready and operating-ready transition-target regression coverage
- related change records: none

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source change; dev-integration reconciliation is required before retrying #1192 closeout
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation: full Node test suite, governance-doc validation, change-record requirement, and diff check
- live or dev-integration verification: retry #1192 status and closeout after the merged OOS revision is active
- residual risk: Architecture Packets must include an `operating-ready` conformance case when a Landing Unit is intended to cross runtime or operating-readiness gates

## Follow-Up

- required follow-up: reconcile the accepted-idea-delivery runtime, close #1192, and retain operating-ready coverage for the later platform activation Landing Unit
- owner: Operator Orchestration Service and Platform Engineering
- due date or closure condition: before #1193 starts
