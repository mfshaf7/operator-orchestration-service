---
security_evidence:
  review_areas: [delivery]
  findings: []
  risks: []
  workstreams: [WS-007]
  reviewed_artifacts:
    - src/delivery-change/pi-planning.js
    - src/delivery-execution-navigation.js
    - test/delivery-change-pi-planning.test.js
  notes: Extends existing reviewed PI assignment to the prepared ART types that already have a canonical Iteration field.
---

# PI Planning placement for risks and milestones

## Summary

Prepared Risks and Milestones can be assigned to a dated iteration from the
same PI Planning workflow that serves other work items.

## Classification

Owner maintenance for the shared Delivery workflow. The Landing Unit Decision
is `feature_single_landing_unit` for the broker.

## Ownership

OOS owns PI assignment validation and canonical OpenProject readback. The
Console lists the eligible records in the existing Work items view.

## Root Cause

Existing Risks and Milestones can require Iteration for completion. Refinement
correctly leaves dated placement to PI Planning, but PI Planning excluded
these types from both its readiness projection and its assignment handler.

## Source Changes

Use the same eligibility for planning projection and plan submission. Check
native preparation, current item status, in-scope ownership, current calendar
dates, dependency order, and the reviewed objective. Keep the existing
delivery forecasts for Feature child work. The assignment updates the
existing work item. Source permissions, completion rules, and audit
authority continue to use their current reviewed workflow.

## Live Verification

The focused test applies a sparse plan to the existing Risk and Milestone
identities, checks native readback, and rejects a Risk still missing its
owner. The live Risk reported Iteration as its only missing required field.
The planning board did not admit the Risk type.

## Artifact And Deployment Evidence

Qualify the OOS and Console revisions together by recording exact source
reviews and completing normal composed activation. Retain the schedule and
completion readbacks for the existing live item.

## Follow-Up

Verify the operator can select the Risk in PI Planning, apply the dated
assignment, and review its completion through the existing form.
