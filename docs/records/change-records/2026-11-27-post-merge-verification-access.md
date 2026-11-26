---
security_evidence:
  review_areas: [delivery, runtime]
  workstreams: [WS-007]
  findings: []
  risks: []
  reviewed_artifacts:
    - src/delivery-art/work-session-service.js
    - src/delivery-art/work-session-controller.js
    - src/delivery-art/lifecycle-controller.js
    - src/delivery-art/lifecycle.js
  notes: Post-merge verification uses the authenticated work session and its retained exact merge or finalization evidence. The source effect lease and pre-merge command path continue to protect source changes.
---

# Continue exact post-merge verification after source access expires

## Summary

The live #1388 session already had merged source and a durable merge-ready
Review Packet. **Verify Runtime Results** returned a source approval expiry
before evidence acquisition entered the command journal.

## Classification

- Area is the existing governed work-session continuation.
- Type is Broker owner maintenance for the Stage 2 blocker.
- Landing Unit Decision is `feature_single_landing_unit`.

## Ownership

The Broker owns evidence acquisition and Review Packet progression. Platform
owns temporary source authorization and the reviewed runtime observations.
Console uses the existing Continue entry point.

## Root Cause

The public work-session Continue command acquired a source write lease before
the controller selected an action. That worked for pre-merge source activity
and blocked operating evidence and packet finalization after merge.

## Source Changes

- Use the normal authenticated command journal for confirmed merged evidence.
- Check the session revision under its existing lock. Read back the exact
  merge or validated finalization draft and bound worktree.
- Revalidate each transition and restrict it to operating evidence and Review
  Packet finalization. The source workflow continues through its lease.

## Artifact And Deployment Evidence

Deploy the reviewed Broker through the existing Console composition
acceptance. Use the existing command receipt and exact acquired evidence for
operator readback.

## Live Verification

Verify an expired source approval with a current merged packet. Observe one
evidence action and an idempotent replay. Verify pre-merge source activity
still requires its approved scope. Confirm the resulting evidence and next
action through the Console.

## Follow-Up

Keep the named owner evidence tied to the reviewed revision when continuing
the existing Stage 2 work sessions.
