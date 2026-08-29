---
security_evidence:
  review_areas:
    - identity
    - delivery
    - runtime
  reviewed_artifacts:
    - contracts/repository-custody
    - contracts/repository-custody-workflow
    - src/repository-custody
    - src/app.js
    - src/runtime.js
    - docs/api/openapi.json
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-08-29 Repository Custody Workflow

## Summary

Implemented the OOS-owned existing-repository custody workflow with exact WGCF
decision readback, application-identity provider readback, replay-safe state,
canonical terminal receipts, bounded API routes, generated OpenAPI, and
fail-closed activation. Security review caught and corrected the initial
GraphQL-node-ID mismatch before merge; the adapter now uses and verifies the
positive decimal GitHub REST repository `id` end to end.

## Classification

- area: repository custody
- type: operator workflow API and provider readback adapter
- runtime impact: source complete; normal runtime remains disabled

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: User story `#1042` under Delivery `#888`
- related products or components: Governance Operations Console Repository
  operation, WGCF readiness, provider application identity

## Root Cause

- immediate failure: no governed workflow could link an existing provider
  repository to workspace custody
- actual root cause: policy, workflow, provider, identity, and Console
  responsibilities had not yet been composed behind one contract
- pre-merge defect: the first fixture used a GitHub GraphQL `node_id` even
  though the adapter called the REST numeric repository-ID endpoint
- why it escaped earlier controls: the repository operation was still a
  prototype-local projection before Epic `#888`

## Source Changes

- changed workflow, adapter, or contract: added canonical contract consumer,
  WGCF and GitHub read clients, file-backed workflow state, terminal receipt
  service, bounded API routes, runtime activation gate, and generated OpenAPI
- tests or validator added: contract, clients, service, retry, storage, HTTP,
  runtime, OpenAPI synchronization, and GraphQL-node-ID rejection tests
- related change records: Workspace Governance and WGCF terminal receipt
  synchronization under the same Landing Unit

## Artifact And Deployment Evidence

- source-only change pending pull-request review and merge
- image tag or digest: pending CI-equivalent image proof
- runtime revision: no activated runtime

## Live Verification

- local validation: focused and full OOS validation pending final Review Packet
- live or dev-integration verification: injected sandbox-runtime proof only
- residual risk: Security, Platform identity, and Console composition remain
  downstream gates

## Follow-Up

- required follow-up: complete ART `#1043`, `#1044`, and `#1045` before
  activating the workflow
- owner: Security Architecture, Platform Engineering, Governance Operations
  Console
- due date or closure condition: finalized Review Packets for the remaining
  feature children
