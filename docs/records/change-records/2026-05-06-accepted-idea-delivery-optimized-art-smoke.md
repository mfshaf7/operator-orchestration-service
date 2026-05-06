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

# 2026-05-06 Accepted-Idea Delivery Optimized ART Smoke

## Summary

Extended the persistent accepted-idea-delivery dev-integration smoke so it
proves the optimized ART packet read surfaces and the first automated
landing-unit closeout evidence without mutating the persistent ART lane.

## Classification

- area: accepted-idea-delivery dev-integration profile
- type: read-only smoke expansion
- runtime impact: `make devint-smoke PROFILE=accepted-idea-delivery` now
  verifies optimized ART packet reads and #650 landing-unit closeout evidence
  through the broker

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: `#668` under delivery `#650`
- related products or components: accepted-idea-delivery dev-integration lane,
  Workspace Delivery ART, OpenProject delivery broker

## Root Cause

- immediate failure: the optimized #650 ART packet and landing-unit closeout
  path could be proven manually, but the active dev-integration smoke did not
  check those surfaces.
- actual root cause: the profile smoke still reflected the older broker
  delivery workflow shape and stopped at mutation-draft plus project reachability
  checks.
- why it escaped earlier controls: optimized packet and landing-unit closeout
  automation landed before the profile smoke was updated to include those new
  read-only operator surfaces.

## Source Changes

- changed workflow, adapter, or contract: added read-only broker probes for
  optimized active-session packets, initiative evidence packets, and the #650
  landing-unit closeout evidence packet.
- tests or validator added: dev-integration smoke itself is the live profile
  verification path; no unit-only substitute was added.
- related change records:
  - `2026-05-06-art-landing-unit-closeout-automation.md`
  - `2026-05-06-art-landing-unit-generated-payload-preflight.md`

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only pending PR,
  then live `make devint-smoke PROFILE=accepted-idea-delivery` evidence before
  ART closeout.
- image tag or digest: None.
- runtime revision: local dev-integration profile source mount.

## Live Verification

- local validation: pending.
- live or dev-integration verification: pending `make devint-smoke
  PROFILE=accepted-idea-delivery` from `platform-engineering`.
- residual risk: the read-only smoke references the current #650 dogfood
  parent as the first proof point; future profile reset may need a newer
  closed landing-unit proof id.

## Follow-Up

- required follow-up: update platform-engineering's operator-facing profile
  runbook to list the new required smoke checks.
- owner: `platform-engineering`
- due date or closure condition: before closing ART #668.
