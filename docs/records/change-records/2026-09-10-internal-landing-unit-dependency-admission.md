---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - src/delivery-art/work-session-controller.js
    - test/delivery-art-work-session.test.js
    - docs/contracts/delivery-workflow-api-v1.md
    - docs/operations/delivery-workflow-operator-surface.md
    - docs/api/openapi.json
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "The correction preserves explicit, external, ambiguous, self-referential, and architecture-mismatched blockers. It grants no new mutation or deployment authority."
---

# Internal Landing Unit Dependency Admission

## Summary

ART #1127 aligns work-session start with the existing Landing Unit contract.
Logically ordered items may share one source session only when current durable
architecture proves their exact shared source and rollback boundary.

## Classification

- area: Delivery ART work-session admission
- type: runtime control correction
- runtime impact: source-complete local and `dev-integration` behavior; no
  stage or production activation

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Defect #1127 under Feature #920 and Epic #892
- related products or components: Delivery ART work-session controller

## Root Cause

- immediate failure: work start rejected #1095 because it depended on #1094,
  even though both were approved as one Landing Unit
- actual root cause: target admission treated every unresolved dependency as
  external before loading the accepted Architecture Packet
- why it escaped earlier controls: the contract excluded internal Landing Unit
  dependencies from later prerequisite gates, but work-start tests covered only
  independent items

## Source Changes

- loads and verifies current architecture before evaluating all covered items
- admits a dependency-blocked item only when every unresolved dependency is
  internal to one exact Landing Unit and declared in its execution plan
- preserves fail-closed behavior for explicit blockers, external or self
  dependencies, missing identity, stale architecture, and ordering mismatch
- adds positive and negative work-session regression coverage

## Artifact And Deployment Evidence

- source-only change: OOS pull request for ART #1127
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation: focused and full OOS tests, API-document validation,
  governance-document validation, change-record validation, and base-aware
  CI-equivalent validation
- live or dev-integration verification: pending merged-source rehearsal when
  the shared Prototype maturity Landing Unit starts
- residual risk: malformed or contradictory ART dependency state remains
  intentionally blocked for operator correction

## Follow-Up

- required follow-up: start the #1094/#1095 shared Landing Unit through the
  normal OOS work-session path
- owner: `workspace-prototype-studio`
- closure condition: one session covers both items while preserving the
  declared #1094 before #1095 implementation order

## Rollback

Revert the controller, tests, API and operator documentation, and this change
record together. ART dependency and Prototype source truth remain unchanged.
