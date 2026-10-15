---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - src/delivery-art/work-session-controller.js
    - test/delivery-art-work-session.test.js
    - docs/operations/delivery-workflow-operator-surface.md
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "The repair ignores only a redundant producer Landing Unit attempt identifier when the same applicable human gate still binds the authority owner and work item. Gate, handoff, source, evidence, and acceptance changes remain fail-closed."
---

# Gated Handoff Compatibility

## Summary

Keep an active consumer Landing Unit compatible when a Security authority item
uses a new source attempt but its gate, authority, evidence contract, and
accepted handoff remain unchanged.

## Classification

- area: Delivery ART architecture supersession
- type: corrective owner-repo maintenance
- runtime impact: active work-session compatibility evaluation
- recommendation posture: extend the existing active-Landing-Unit comparison

## Ownership

- owner repo: `operator-orchestration-service`
- work home: owner-repo maintenance linked to the accepted workspace
  improvement candidate
- tracking reference:
  `workspace-governance/reviews/improvement-candidates/2026-10-14-landing-unit-architecture-supersession-regression.yaml`

## Root Cause

- immediate failure: work item 1291 became `architecture-superseded` after work
  item 1303 was reopened with a new Security Landing Unit attempt identity;
- actual root cause: the consumer compatibility fingerprint treated the
  producer attempt identifier as part of the handoff contract even when the
  applicable human gate already anchored the same authority owner and work
  item; and
- why it escaped earlier controls: compatibility tests covered unrelated
  Landing Units and changed gates, but not a recovery-only producer attempt
  rename on a gated consumer handoff.

## Source Changes

- omit `producer_landing_unit_id` only from a consumer compatibility projection
  when an applicable human gate binds the same producer owner and work item;
- retain all stable gate and handoff fields in the fingerprint; and
- prove the attempt rename refreshes compatibly while a changed acceptance
  contract still supersedes the session.

## Artifact And Deployment Evidence

- source-only until this protected owner-maintenance pull request merges
- runtime activation: refresh the existing `accepted-idea-delivery` profile
  from merged OOS source
- image tag or digest: None

## Live Verification

- local validation: focused work-session tests, full repository tests,
  governance-doc validation, and base-aware change-record validation
- dev-integration verification: work item 1291 refreshes to Architecture Packet
  digest `02840790fc36f5f8311d2d66cadec0d5e9ad98184aff3d88c6ff106a2d0afef4`
  without replacing its open Platform pull request
- residual risk: any changed authority, work item, evidence contract, handoff,
  gate, source boundary, or conformance case still requires the existing
  reconstruction or recovery controls

## Follow-Up

- required follow-up: complete the exact 1291 candidate -> 1303 acceptance ->
  1291 merge and operating-proof sequence
- owner: `operator-orchestration-service`
- closure condition: work item 1291 closes from a finalized Review Packet under
  the current Architecture Packet
