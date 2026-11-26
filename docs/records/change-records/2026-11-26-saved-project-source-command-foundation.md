---
security_evidence:
  review_areas: [delivery]
  workstreams: [WS-007]
  findings: []
  risks: []
  reviewed_artifacts:
    - src/project-runtime/saved-source.js
    - src/project-runtime/commands.js
    - src/project-runtime/source-commands.js
    - src/delivery-art/source-executor.js
  notes: Source snapshots are private and bind existing source session leases, custody, exact setup and the original command. Platform begins any execution only through its separately reviewed runtime boundary.
---

# Exact saved project source and original runtime commands

## Summary

Capture the complete admitted saved source and retain one scope-bound Run
intent before Platform dispatch. Reconcile subsequent effects using the
original snapshot, setup and operation identity.

## Classification

- Area is shared project development runtime.
- Type is source-backed Delivery under the accepted Technical Plan.
- Landing Unit Decision is `feature_single_landing_unit`.

## Ownership

Operator Orchestration Service owns source capture and coordination for
Delivery #1386, #1387 and #1392. Registry owns repository custody and Platform
owns runtime setup, execution, and observed outcomes.

## Root Cause

The existing source editor and preview were built around bounded text edits
and committed preview source. A separately retained complete snapshot is
needed to run the exact authorized saved source with assets and dependencies.
An acknowledgement needs its own durable boundary so transport uncertainty
can be reconciled against the original operation.

## Source Changes

- Extend the authenticated source executor to capture from the pinned base and
  the acknowledged owner-store draft. Write the manifest and content-addressed
  blobs into a dedicated private volume.
- Retain exact Run intent under the existing durable file transaction mechanism
  with command identity and project revision checks. Read the original
  Platform operation after uncertain dispatch.
- Keep source approval, existing editing budgets and owner scope as the
  inputs to capture. Carry bounded metadata over the broker connection.

## Artifact And Deployment Evidence

Source candidate for the existing Stage 2 Landing Unit. Deployment depends on
the later Platform runtime owner and final activation decisions in the
approved Technical Plan.

## Live Verification

Prove exact pinned Git assets and drafts, source scope denial, runtime
acknowledgement, and preservation of the original operation after a lost reply
in the owner tests. Qualify actual configured storage and the production
Platform adapter in isolated Dev Integration before live activation.

## Follow-Up

Stage 2 Platform work owns verified materialization, isolated execution, setup
and owner observation. Carry the exact snapshot and operation protocol into
that rehearsal and the existing Stage 7 publication review.
