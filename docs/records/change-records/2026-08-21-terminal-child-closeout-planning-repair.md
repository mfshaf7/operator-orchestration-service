---
security_evidence:
  review_areas:
    - runtime
    - delivery
  reviewed_artifacts:
    - src/delivery-service.js
    - src/openproject-client.js
    - test/delivery-service.test.js
    - test/openproject-client.test.js
    - docs/contracts/delivery-workflow-api-v1.md
    - docs/operations/delivery-workflow-operator-surface.md
    - docs/api/openapi.json
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "The change does not add mutation authority. The existing authenticated planning-repair route may restore only closeout planning metadata for a Feature whose User story and Defect children are all terminal. The OpenProject adapter independently verifies the terminal child state and allowed fields before submitting the existing writable form contract. Generic Feature PI commitment remains denied."
---

# 2026-08-21 Terminal-child closeout planning repair

## Summary

Allow the existing Delivery planning-repair workflow to restore missing Target
PI and Iteration metadata on a stale-open Feature only when its executable leaf
children are already terminal, so normal stale-open closeout can proceed without
weakening active Feature commitment controls.

## Classification

- area: Workspace Delivery ART closeout readiness
- type: bounded workflow and OpenProject adapter correction
- runtime impact: extends the authenticated planning-repair path with one
  internal, route-scoped terminal-child closeout signal

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Epic `#880`, Feature `#902`, and Defect `#935`
- related products or components: Workspace Delivery ART and OpenProject

## Root Cause

- immediate failure: stale-open Features `#699` and `#742` could not close
  because closeout readiness required Target PI, while the repair path was
  rejected by the generic Feature PI-commitment guard
- actual root cause: planning repair and stale-open closeout had compatible
  operator intent but no shared, bounded terminal-child repair contract at the
  OpenProject adapter boundary
- why it escaped earlier controls: the pre-commit base-aware validator was run
  before the source commit existed, so it did not inspect the actual Landing
  Unit diff; CI correctly detected that the mutation-adapter change required
  this record

## Source Changes

- changed workflow, adapter, or contract: the planning-repair service forwards
  an internal closeout signal only for execution-posture correction with no open
  child work; the adapter then rechecks that at least one User story or Defect
  child exists, every such child is terminal, Target PI is part of the repair,
  and no fields outside description, Target PI, Iteration, and work note are
  changed
- tests or validator added: regression coverage proves the OpenProject form
  schema exposes Target PI and Iteration as `writable`, proves successful repair
  with terminal children, and proves denial for an open child, unrelated field,
  or generic Feature update
- related change records: None

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source commit and local
  container smoke evidence only until the Landing Unit merges and the
  dev-integration runtime is refreshed
- image tag or digest: local API
  `sha256:f55e7253453031f9412032541075bbde2e59e193c2185cecbe3a1f4dafab7796`;
  local worker
  `sha256:68050cdcc21c3c37aa3f5ba16bbcd6692ed7981a04a19a6a11ffb9014e57ec21`
- runtime revision: None

## Live Verification

- local validation: `npm test` passed 592 tests; API, Proposal,
  orchestration, Delivery ART, governance-document, change-record, and
  OpenProject mutation-contract validation are required against fetched
  `origin/main`; API health and fail-closed worker container smokes passed
- live or dev-integration verification: pending merge; then submit the managed
  planning repair for `#699` and `#742`, prove the OpenProject form accepts the
  writable Target PI and Iteration projection, and run normal stale-open
  closeout
- residual risk: a Feature with no executable leaf child, any open executable
  leaf child, or an unrelated requested field remains blocked and requires an
  explicit operator decision rather than this repair path

## Follow-Up

- required follow-up: merge PR `#138`, refresh the dev-integration runtime,
  repair `#699` and `#742`, close them through stale-open closeout, and finalize
  the Review Packet with live evidence
- owner: Operator Orchestration Service through Defect `#935`
- due date or closure condition: `#935` closes only after the merged runtime and
  OpenProject state transition are proven

## Rollback

Revert the Landing Unit and do not submit the stale-parent planning-repair
draft. The generic Feature PI-commitment guard and existing stale-open closeout
behavior then remain unchanged.
