---
security_evidence:
  review_areas:
    - runtime
    - delivery
  reviewed_artifacts:
    - src/delivery-art/landing-unit-completion.js
    - src/delivery-art/work-session-controller.js
    - src/delivery-art/work-session-runtime.js
    - scripts/sync_delivery_work_session_openapi.mjs
    - docs/api/openapi.json
    - docs/contracts/delivery-workflow-api-v1.md
    - docs/operations/delivery-workflow-operator-surface.md
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-09-30 Landing Unit Closeout Scope

## Summary

The normal Delivery ART work-session close action now completes the entire
Landing Unit named by its finalized Review Packet instead of only the selected
work-item alias. OOS returns the covered scope and structured result to the
Console, preserves partial failure for retry, and begins cleanup only after the
complete scope is terminal.

## Classification

- area: Delivery ART work-session lifecycle
- type: workflow control correction
- runtime impact: source-only OOS closeout orchestration and public projection; no credential, deployment, or activation change

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: None; tracked through the Workspace Governance improvement system
- related products or components: Governance Operations Console Delivery Execution work sessions

## Root Cause

- immediate failure: normal work-session close sent completion for only the route's selected work-item alias.
- actual root cause: Landing Unit closeout logic existed only in the recovery-oriented CLI path instead of one shared application service used by both CLI and Console-backed runtime adapters.
- why it escaped earlier controls: single-item close tests proved the route but did not assert multi-item Review Packet coverage, parent reconciliation, or cleanup suppression after partial completion.

## Source Changes

- changed workflow, adapter, or contract: extract shared Landing Unit analysis and submission, use it from CLI and work-session runtime, project covered scope and closeout results, and retain incomplete sessions.
- tests or validator added: multi-item completion, authoritative resume, non-terminal response rejection, partial retry, controller cleanup suppression, OpenAPI synchronization, and full repository tests.
- related change records: Workspace Governance candidate `2026-09-30-delivery-art-landing-unit-closeout-console-gap`

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only change
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation: full OOS test suite, generated OpenAPI validation, API documentation validation, governance documentation validation, and diff-aware change controls
- live or dev-integration verification: not activated by this change
- residual risk: a real backend partial failure still requires operator retry, but it can no longer report complete or retire the work session early

## Follow-Up

- required follow-up: activate through the existing Delivery work-session release path when its current Security and Platform gates permit
- owner: `operator-orchestration-service`
- due date or closure condition: normal runtime activation gate
