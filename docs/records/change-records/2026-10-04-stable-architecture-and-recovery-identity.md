---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - src/delivery-art/contracts.js
    - src/delivery-art/service.js
    - src/delivery-art/work-session-controller.js
    - docs/contracts/delivery-workflow-api-v1.md
    - docs/operations/delivery-workflow-operator-surface.md
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "The change narrows existing authority: architecture replacements require a material design change, while retry state remains in session and recovery evidence. No identity, secret, privilege, or deployment boundary changes."
---

# 2026-10-04 Stable architecture and recovery identity

## Summary

Prevents repository revisions, evidence-profile maintenance, and execution
retries from manufacturing new Delivery ART architecture versions. Recovery
now preserves the logical Landing Unit while rotating the attempt-specific
session generation and branch.

## Classification

- area: Delivery ART architecture and work-session control
- type: regression repair and control-boundary correction
- runtime impact: OOS Delivery ART local/dev-integration operator behavior; no
  governed stage or production activation

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Epic `#1203`, blocked User story `#1232`
- related products or components: OOS Delivery ART artifact persistence and
  work-session controller

## Root Cause

- immediate failure: every exact Architecture Packet replacement invalidated
  active sessions, and recovery required another logical Landing Unit ID
- actual root cause: execution facts and attempt identity were incorrectly
  coupled to the durable architecture decision
- why it escaped earlier controls: tests proved exact artifact binding and
  fail-closed supersession independently, but did not prove that source-only
  refreshes and retries leave architecture and Landing Unit identity stable

## Source Changes

- changed workflow, adapter, or contract: semantic architecture comparison,
  same-Landing-Unit recovery generations, and explicit operator/API guidance
- tests or validator added: service persistence and work-session regression
  cases for source-only refresh and same-identity recovery
- related change records: workspace improvement candidate
  `2026-10-04-owner-evidence-profile-coverage-regression`

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only until the
  accepted Delivery ART dev-integration composition is refreshed after merge
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation: `npm test`, `npm run validate:api-docs`, and
  `npm run validate:governance-docs` pass
- live or dev-integration verification: pending post-merge runtime refresh and
  `work preflight 1232`
- residual risk: historical Architecture Packets remain immutable and may show
  old recovery-suffixed identifiers; they are not rewritten

## Follow-Up

- required follow-up: merge owner evidence profiles and workspace activation
  inventory, refresh the accepted runtime, then prove `#1232` preflight
- owner: Workspace Delivery ART maintainers
- due date or closure condition: before resuming source work for `#1232`
