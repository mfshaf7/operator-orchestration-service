---
security_evidence:
  review_areas:
    - runtime
    - delivery
  reviewed_artifacts:
    - src/delivery-art/service.js
    - src/delivery-art/lifecycle-controller.js
    - scripts/sync_delivery_art_contracts.mjs
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-08-13 Delivery ART Terminal Truth

## Summary

Separated immutable historical evidence reads from prospective transition
freshness, made finalized lifecycle projection independent of cleaned mutable
source state, and bound the copied Delivery ART contract manifest to the commit
that supplied its exact governed bytes.

## Classification

- area: Workspace Delivery ART evidence and lifecycle status
- type: integrity correction, lifecycle projection, and contract provenance
- runtime impact: OOS dev-integration behavior changes after merge and runtime
  reconciliation; no governed stage or production activation

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Defect `#821` under delivery `#698`
- related products or components:
  - Workspace Delivery ART
  - `workspace-governance-control-fabric`
  - `workspace-governance`

## Root Cause

- immediate failure: finalized artifacts became snapshot-stale after legitimate
  ART closeout, terminal lifecycle status regressed after source cleanup, and an
  unrelated Workspace Governance commit made an unchanged OOS contract bundle
  stale.
- actual root cause: historical read, prospective freshness, terminal source
  projection, and copied-contract provenance were all derived from current
  mutable state instead of their distinct authority sources.
- why it escaped earlier controls: tests stopped at successful finalization and
  closeout. They did not re-read immutable evidence after ART mutation, inspect
  status after worktree cleanup, or advance the contract owner with unchanged
  governed bytes.

## Source Changes

- changed workflow, adapter, or contract:
  - `artifact resolve` validates immutable artifact and dependency integrity
    without a current-snapshot requirement
  - lifecycle-advancing consumers retain explicit fresh scoped ART checks
  - finalized lifecycle status derives source, pull-request, and merge truth
    from the finalized Review Packet
  - Delivery ART contract sync preserves valid content provenance across
    unrelated upstream commits and updates it when governed bytes change
- tests or validator added:
  - historical resolution after ART advancement
  - stale dependency rejection during a lifecycle transition
  - terminal status after source and architecture cleanup
  - unrelated upstream commit, schema change, and fixture change provenance
    cases
- related change records:
  - [2026-08-12-delivery-art-lifecycle-reconciliation.md](2026-08-12-delivery-art-lifecycle-reconciliation.md)
  - [2026-08-12-delivery-art-custody-owner-runtime.md](2026-08-12-delivery-art-custody-owner-runtime.md)

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source correction pending
  pull-request merge and dev-integration reconciliation
- image tag or digest: pending
- runtime revision: pending

## Live Verification

- local validation:
  - `node --test test/delivery-art-service.test.js test/delivery-art-lifecycle-controller.test.js test/delivery-art-contract-sync.test.js`:
    `24` passed, `0` failed
  - `npm test`: `540` passed, `0` failed
  - `npm run validate:orchestration-bundle`: passed
  - `npm run validate:orchestration-openapi-schemas`: synchronized
  - `npm run validate:delivery-art-contracts`: current against Workspace
    Governance
  - `npm run validate:api-docs`: `68` documented routes match `68`
    implemented routes
  - `npm run validate:governance-docs`: passed
  - `npm run validate:change-record-requirement`: passed against
    `origin/main`
  - `npm run validate:openproject-mutation-contracts`: passed against
    `origin/main`
  - completed `#819` lifecycle projection remained complete using finalized
    packet evidence after source cleanup
- live or dev-integration verification: pending post-merge reconciliation and
  `#821` post-cleanup dogfood
- residual risk: the running OOS dev-integration pod retains prior behavior
  until the merged revision is reconciled

## Follow-Up

- required follow-up:
  - merge the `#821` Landing Unit
  - reconcile the accepted-idea-delivery dev-integration runtime
  - finalize and close `#821`, clean its source worktree, and prove terminal
    status plus historical artifact resolution
  - resume `#806` only after that proof succeeds
- owner: `operator-orchestration-service`
- due date or closure condition: before `#806` dogfood closes
