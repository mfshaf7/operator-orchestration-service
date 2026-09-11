---
security_evidence:
  review_areas:
    - runtime
    - delivery
  reviewed_artifacts:
    - src/delivery-art/work-session-runtime.js
    - test/delivery-art-work-session-runtime.test.js
  workstreams:
    - WS-007
  notes: "Reuses the existing broker-owned ART completion boundary and preserves completion-before-cleanup ordering."
---

# ART Work-Session Close Adapter

## Summary

ART #1138 composes the existing Delivery ART completion service into the
work-session runtime so normal `work close` can complete an open ART item before
resource retirement.

## Classification

- area: Delivery ART work-session runtime composition
- type: bounded defect correction
- runtime impact: existing `dev-integration` closeout path only

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: #1138 under Feature #920 and Epic #892

## Root Cause

The controller accepted a close adapter and its tests supplied one, but the
active runtime composed that dependency as `null`. Earlier closeouts completed
ART through the recovery landing-unit path before cleanup, so the missing
normal-path adapter remained latent.

## Source Changes

- Builds the completion payload from the finalized Review Packet through the
  existing payload helper.
- Calls the existing broker-owned Delivery completion service.
- Treats only authoritative `done` readback as successful closeout.
- Preserves the controller's existing rule that cleanup starts only after ART
  completion succeeds.

## Artifact And Deployment Evidence

- Source-only correction in the existing OOS work-session runtime.
- No platform, secret, identity, OpenProject schema, or deployment contract
  changes.

## Live Verification

- Focused runtime and controller suite: 45 tests passed.
- Positive composition proves finalized packet to ART completion mapping.
- Negative composition proves completion failures propagate before cleanup.

## Follow-Up

- None in this Landing Unit. CLI profile selection and broader orchestration
  redesign are explicitly outside scope.
