---
security_evidence:
  review_areas: [delivery]
  findings: []
  risks: []
  workstreams: [WS-007]
  reviewed_artifacts:
    - src/delivery-art/agent-source-identity.js
    - src/delivery-art/work-session-cli-adapters.js
    - test/delivery-art-work-session-cli-adapters.test.js
  notes: Location resolution and source access use the same reviewed core-repository provider binding and current source admission.
---

# Canonical source reads for core repositories

## Summary

The source executor supplies the reviewed core repository identity when it
checks current admission for a repository location.

## Classification

OOS owner maintenance. The Landing Unit Decision is
`feature_single_landing_unit`.

## Ownership

OOS uses the approved repository identity projection and present Workspace
Inventory to resolve source locations. Platform owns credential issuance.

## Root Cause

Source location resolution omitted the trusted core repository binding
already used by the source access adapter. Workspace Inventory correctly
rejected the incomplete admission request.

## Source Changes

Reuse the same trusted repository selector for location and source access.
The existing admission reader checks current public and private repository
records. Internally registered private repositories retain their protected
read route, and an admission rejection stops the operation.

## Live Verification

Confirm Technical Plan source revision reads and exact work-start preparation
through the normal live Console. Check that approved repository and branch
scope match the selected work.

## Artifact And Deployment Evidence

Review the exact OOS change in the current Console composition before
activation.

## Follow-Up

Keep original and corrected source preparation readback with the operating
evidence.
