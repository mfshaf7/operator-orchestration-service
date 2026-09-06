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
    - scripts/workspace_inventory_source.py
    - docs/api/openapi.json
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# Workspace Inventory Lifecycle Workflow

## Summary

ART #1079 under #1076/#890 implements the OOS-owned durable workflow for
reviewed updates, suspension, restoration, and retirement of one existing
Workspace Inventory record with append-only canonical history.

## Classification

- area: workspace inventory lifecycle
- type: source-backed workflow and API
- runtime impact: source complete; routine mutation remains inactive pending a separate Security and Platform activation decision

## Ownership

- owner repo: `operator-orchestration-service`
- canonical source owner: `workspace-governance`
- readiness owner: `workspace-governance-control-fabric`
- related ART slice: #1079 under #1076/#890

## Root Cause

- immediate gap: active inventory records had canonical lifecycle contracts but no durable operator workflow
- architectural cause: owner mutation and WGCF readiness existed without OOS request custody, provider review coordination, restart recovery, or merged-state reconciliation
- correction: extend the existing Workspace Inventory domain as a sibling lifecycle capability while retaining source ownership and review boundaries

## Source Changes

- added pinned lifecycle request, readiness, mutation, readback, receipt, policy, history, and WGCF evaluation contracts
- added caller-bound preparation, submit, read, continue, and cancel APIs
- reused the existing durable store, exact-repository provider, isolated owner-command bridge, and review reconciliation boundary
- constrained each review to one inventory file plus append-only history
- added exact merged inventory and history reconciliation before canonical success
- retained `runtime_activation: false`; this change does not claim Security approval or live authority

## Verification

- contract, service, client, HTTP, source bridge, OpenAPI, and route parity tests
- real-Git conformance covers lifecycle preparation, exact two-file review, changed-head denial, human-reviewed merge, restart-safe continuation, and canonical history readback

## Artifact And Deployment Evidence

- source-only change; no image or runtime deployment is claimed
- runtime revision remains gated by `runtime_activation: false` in the pinned Workspace Inventory manifest

## Live Verification

- local verification uses temporary Git repositories and a simulated provider; no live canonical repository is changed
- normal mutation remains unavailable until a later explicit Security and Platform activation decision

## Follow-Up

- ART #1080 adds canonical lifecycle history projection for operators
- ART #1081 provides integrated conformance and activation-boundary proof
