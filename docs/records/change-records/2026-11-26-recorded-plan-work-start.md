---
security_evidence:
  review_areas: [delivery]
  findings: []
  risks: []
  workstreams: [WS-007]
  reviewed_artifacts:
    - contracts/delivery-art-work-session/decision.schema.json
    - src/delivery-art/work-session-controller.js
    - test/delivery-art-work-session.test.js
  notes: Work start resolves the existing custody record and verifies the approved group before scoped source access.
---

# Recorded Technical Plan at work start

## Summary

Work preparation binds the approved Technical Plan to its exact source work
group through the existing operator review and source access workflow.

## Classification

Owner maintenance for the shared Delivery workflow. The Landing Unit Decision
is `feature_single_landing_unit` for the broker.

## Ownership

OOS resolves the current durable plan and validates its digest, group, owner
and prerequisites. The Console presents the resulting scope for review.

## Root Cause

Work start could read the current plan, but the decision contract accepted
only a repository path for required architecture. The Console's default
one-item decision also missed approved groups that covered several items.

## Source Changes

Offer the recorded plan and its complete work group during preparation.
Revalidate the approved digest, exact group and owner during source access and
work start. The existing repository artifact option retains its validation.
A planned source item cannot start as a partial unsupervised group.

## Live Verification

Verify that the real #1386 session shows the recorded plan and the approved
three-story scope. Apply normal source access only after review and confirm
the resulting session remains bound to that plan.

## Artifact And Deployment Evidence

Pair the Console revision with the broker revision and record exact composed
Security review before activating the normal runtime.

## Follow-Up

Verify stale plans and incomplete groups fail before source access. Preserve
existing plan and execution records during the change.
