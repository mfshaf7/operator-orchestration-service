---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - contracts/delivery-art-work-session/agent-source-identity.json
    - src/delivery-art/agent-source-identity.js
    - src/delivery-art/source-executor.js
    - src/delivery-art/work-session-cli-adapters.js
    - src/delivery-art/work-session-controller.js
    - docs/operations/delivery-workflow-operator-surface.md
  workstreams:
    - WS-007
  findings: []
  risks: []
  notes: "Configured-path and continuation checks fail closed against the exact merged Platform active-owner projection before source resources are accessed or created."
---

# Agent Source Owner Admission Preflight

## Summary

ART `#1169` makes the merged Platform Agent-source repository projection an
executable precondition for Delivery work sessions. OOS now admits the exact
eleven active governed owner repositories before local Git inspection and
rechecks that admission before continuation can reconstruct source resources.

## Classification

- area: Delivery ART configured-path and Agent source identity
- type: trust-boundary correction
- runtime impact: fail-closed owner admission in `dev-integration`; no stage or
  production activation

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Epic `#1154`, Feature `#1159`, Defect `#1169`
- upstream authority: Platform change `#1168`, merged as
  `58c66e6320484fba3eb9f46de5461863b835f71d`
- final activation authority: Security work item `#1166`

## Root Cause

OOS still consumed the closure-era seven-repository snapshot. Configured-path
inspection also resolved the local checkout before Agent-source admission, and
continuation could reconstruct a worktree before repeating the owner check.
This allowed the correct Platform installation scope and the OOS work-session
scope to disagree.

## Source Changes

- pins the merged Platform definition and Workspace Governance inventory
- adopts the exact eleven active owner repository names and provider ids
- rejects unadmitted, stale, inactive, mismatched, or unavailable projections
  with one actionable Platform-owned blocker
- checks admission before local repo inspection and before continuation
  reconstruction
- exposes the finite admission check through the source executor

## Validation

- focused identity, configured-path, source-executor, and work-session tests
- positive and negative real-Git configured-path coverage
- full OOS test and CI-equivalent validation before merge

## Artifact And Deployment Evidence

This is a source-only `dev-integration` correction. It does not build or
activate a new runtime image, alter stage or production, or change the GitHub
App permission set. The finalized Review Packet binds the merged OOS commit to
the already merged Platform definition.

## Live Verification

The Platform source and provider commissioning proof are already merged under
`#1168`. OOS validation proves the positive admitted path and every required
negative projection path without creating source resources. Normal lifecycle
activation remains disabled pending the final Security decision.

## Follow-Up

- close `#1169` through exact-head review, merge, and durable Review Packet
- recover CGG Feature `#1164` only after this prerequisite closes
- retain Security work item `#1166` as the final activation authority

## Rollback

Revert the OOS projection pin, owner-admission action, configured-path ordering,
and continuation recheck together. The merged Platform installation scope and
all existing work-session, Review Packet, and Git evidence remain unchanged.
