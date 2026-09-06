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

ART #1073 and conformance #1075 under #1070/#890 implement caller-bound
preparation, canonical registry projection, and a durable reviewed promotion
from one admitted Workspace Intake entry to one active repository, product, or
component inventory record.

## Classification

- area: workspace inventory workflow
- type: source-backed workflow and API
- runtime impact: source complete; routine mutation remains inactive pending a separate Security and Platform activation decision

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: #1073 and #1075 under #1070/#890
- related products or components: Workspace Governance, WGCF, Governance Operations Console

## Root Cause

- immediate failure: admitted entrants had no durable operator workflow for reviewed active-inventory promotion
- actual root cause: canonical mutation and readiness contracts existed without OOS coordination, provider review, restart recovery, and terminal readback
- why it escaped earlier controls: #1071 and #1072 deliberately established owner and readiness boundaries before workflow implementation

## Source Changes

- changed workflow, adapter, or contract: added pinned contracts, caller-bound APIs, a read-only registry projection, durable state, WGCF evaluation, exact-repository provider review, owner-command source mutation, merge readback, cancellation, and receipts
- tests or validator added: strict registry schema and digest checks, contract, service, client, HTTP, v1 migration, real-Git source, OpenAPI projection, and route parity checks
- related change records: `2026-09-05-workspace-intake-workflow.md`

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only until #1075 proves the composed path; normal activation requires a separate Security and Platform decision
- image tag or digest: None
- runtime revision: `runtime_activation: false` in the pinned Workspace Inventory manifest

## Live Verification

- local validation: #1075 adds nine-case temporary-Git conformance covering migration preservation, digest-bound candidate projection, exact two-file preparation, changed-head denial, human-merge readback, replay, restart recovery, and the atomic intake-to-active transition; full repository, API, docs, and image checks are recorded in the finalized Review Packet
- live or dev-integration verification: sandbox composition passes without live canonical mutation; no live mutation activation is implied
- residual risk: normal inventory mutation remains unavailable until an explicit Security and Platform activation decision exists

The positive proof maps to `case:integrated-conformance-positive`. Altered
projection content, changed review head, missing human review, stale authority,
replay conflict, and restart recovery map to
`case:integrated-conformance-negative`.

## Follow-Up

- required follow-up: lifecycle work remains under #1076; normal mutation activation requires a separate explicit Security and Platform decision
- owner: Governance Operations Console and OOS owners under #1070
- due date or closure condition: #1075 closes when merged OOS source and finalized Review Packet cover the conformance proof
