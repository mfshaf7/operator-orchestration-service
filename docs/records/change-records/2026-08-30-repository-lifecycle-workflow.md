---
security_evidence:
  review_areas:
    - identity
    - runtime
    - delivery
  reviewed_artifacts:
    - contracts/repository-lifecycle
    - contracts/repository-lifecycle-workflow
    - src/repository-lifecycle
    - src/app.js
    - src/runtime.js
    - docs/api/openapi.json
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-08-30 Repository Lifecycle Workflow

## Summary

Implemented the OOS-owned guarded repository lifecycle workflow for workspace
custody transfer, provider archive/unarchive, workspace retirement/restore,
recovery-safe replay, terminal receipts, and immutable audit projection.

## Classification

- area: repository lifecycle
- type: operator workflow API, provider adapter, and durable state projection
- runtime impact: source complete; normal runtime remains disabled

## Ownership

- owner repo: `operator-orchestration-service`
- ART: User story `#1051`, Feature `#915`, Delivery `#888`
- upstream authority: Workspace Governance `#1050`, Platform `#1058`, Security
  `#1052`, and WGCF readiness `#1059`

## Root Cause

- immediate failure: repository custody ended at initial link or provision, so
  operators had no bounded path for later custody transfer, provider archival,
  workspace retirement, or their supported reversals.
- actual root cause: lifecycle policy and authority existed upstream, but OOS
  did not yet own the guarded command, checkpoint, provider readback, recovery,
  immutable receipt, and repository-history boundary.
- why it escaped earlier controls: repository onboarding and post-onboarding
  lifecycle were deliberately sequenced as separate Landing Units because they
  have different state axes, provider authority, reversibility, and evidence.

## Source Changes

- added digest-pinned lifecycle contracts and OOS result contract
- added exact WGCF issue/read client and dedicated GitHub App provider client
- added per-repository serialized state, checkpoints, recovery, receipts, and
  immutable history
- added bounded authenticated command, result, and audit API routes
- added generated OpenAPI and focused positive/negative conformance tests

## Security Boundary

Provider mutation is limited to archive/unarchive using the dedicated Platform
identity. Hard delete, physical provider ownership transfer, personal
credentials, browser-to-provider access, and automatic downstream mutation are
absent. Runtime activation remains fail-closed.

## Artifact And Deployment Evidence

- source-only change pending pull-request review and merge
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation:
  - full repository test suite passed with `909` tests
  - generated OpenAPI contract matched all `99` implemented routes
  - deterministic bundle, governance-document, base-aware change-record, and
    OpenProject mutation-contract validation passed
  - API and orchestration-worker images built; API health passed and the worker
    remained fail-closed with normal runtime activation disabled
- live or dev-integration verification: None; this Landing Unit intentionally
  leaves normal lifecycle runtime activation disabled
- residual risk: Console composition and fail-closed configured-live proof are
  still required by `#1053` before the workflow can become operating-ready

## Follow-Up

Console integration `#1053` must consume these APIs and prove configured live
mode rejects unavailable or inconsistent backend truth without fixture
fallback before Feature operating readiness.
