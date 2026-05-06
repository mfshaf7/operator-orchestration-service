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

# 2026-05-06 ART Landing-Unit Formatting Fix

## Summary

Fixed landing-unit submit evidence generation so changed-surface paths derived
from finalized Review Packets are code-formatted before they are sent to broker
completion and stale-open closeout routes.

## Classification

- area: Workspace Delivery ART operator workflow
- type: defect fix and evidence-format guard
- runtime impact: local ART CLI generated payloads now satisfy the existing
  completion-evidence contract before broker mutation

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: `#662` under delivery `#650`
- related products or components: Workspace Delivery ART, OpenProject delivery
  broker

## Root Cause

- immediate failure: `landing-unit submit` failed before mutating #661 because
  generated `Changed Surfaces` bullets were plain paths instead of code-formatted
  path references.
- actual root cause: the generic Review Packet evidence bullet normalizer was
  reused for completion changed-surface evidence even though that section has a
  stricter path-format contract.
- why it escaped earlier controls: unit tests verified submit sequencing but did
  not assert that generated completion payloads preserved the changed-surface
  formatting contract.

## Source Changes

- changed workflow, adapter, or contract: added changed-surface-specific
  normalization for landing-unit generated completion payloads.
- OpenProject form contract evidence: no OpenProject `allowedValues`, `form
  schema`, `PropertyIsReadOnly`, writable fields, read-only fields,
  `version_field_read_only`, or `roadmap_version_projection` semantics changed.
- tests or validator added: extended ART CLI submit sequencing coverage to prove
  generated changed-surface payloads contain code-formatted paths.
- related change records:
  - `2026-05-06-art-landing-unit-closeout-automation.md`

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only pending PR and
  ART Review Packet evidence for delivery `#650`.
- image tag or digest: None.
- runtime revision: None.

## Live Verification

- local validation: pending in the #650 formatting-fix landing unit.
- live or dev-integration verification: retry `landing-unit submit` for
  #661/#662/#663 after merge.
- residual risk: none known; broker completion-evidence validation remains the
  final fail-closed guard.

## Follow-Up

- required follow-up: retry `landing-unit submit` and close #661/#662/#663/#660.
- owner: `operator-orchestration-service`
- due date or closure condition: before continuing the remaining #650 slices.
