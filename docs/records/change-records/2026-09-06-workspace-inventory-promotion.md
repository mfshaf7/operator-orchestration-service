---
security_evidence:
  review_areas:
    - identity
    - secrets
    - delivery
    - runtime
  reviewed_artifacts:
    - contracts/workspace-inventory
    - src/workspace-inventory
    - src/app.js
    - src/config.js
    - src/runtime.js
    - scripts/workspace_inventory_source.py
    - docs/api/openapi.json
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# Workspace Inventory Promotion Workflow

## Summary

ART #1073 under #1070/#890 implements caller-bound preparation and a durable,
reviewed promotion from one admitted Workspace Intake entry to one active
repository, product, or component inventory record.

## Classification

- area: workspace inventory workflow
- type: source-backed workflow and API
- runtime impact: source complete and inactive pending composed proof #1075

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: #1073 under #1070/#890
- related products or components: Workspace Governance, WGCF, Governance Operations Console

## Root Cause

- immediate failure: admitted entrants had no durable operator workflow for reviewed active-inventory promotion
- actual root cause: canonical mutation and readiness contracts existed without OOS coordination, provider review, restart recovery, and terminal readback
- why it escaped earlier controls: #1071 and #1072 deliberately established owner and readiness boundaries before workflow implementation

## Source Changes

- changed workflow, adapter, or contract: added pinned contracts, caller-bound APIs, durable state, WGCF evaluation, exact-repository provider review, owner-command source mutation, merge readback, cancellation, and receipts
- tests or validator added: contract, service, client, HTTP, real-Git source, OpenAPI projection, and route parity checks
- related change records: `2026-09-05-workspace-intake-workflow.md`

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only until #1075 composes and activates the admitted profile
- image tag or digest: None
- runtime revision: `runtime_activation: false` in the pinned Workspace Inventory manifest

## Live Verification

- local validation: focused tests, full repository tests, API validation, governance-doc validation, and CI-equivalent base-aware checks are recorded in the finalized Review Packet
- live or dev-integration verification: deferred to composed proof #1075
- residual risk: runtime identity, Console use, and composed dependency behavior are not claimed by this source-only change

## Follow-Up

- required follow-up: implement Console adapter #1074, then prove and activate the composed dev-integration path in #1075
- owner: Governance Operations Console and OOS owners under #1070
- due date or closure condition: #1070 closes only after #1074 and #1075 evidence

