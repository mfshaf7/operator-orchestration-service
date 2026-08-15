---
security_evidence:
  review_areas:
    - runtime
    - delivery
  reviewed_artifacts:
    - src/proposal-workflow/service.js
    - src/openproject-client.js
    - Dockerfile
    - contracts/proposal-workflow/command.schema.json
    - contracts/proposal-workflow/storage-state.schema.json
    - docs/operations/proposal-workflow-operator-surface.md
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "This owner-repo evidence verifies caller binding, optimistic concurrency, idempotency, author-filtered history, and the prepared-handoff boundary; it does not replace the separately tracked security-architecture evidence child #860."
---

# 2026-08-16 Proposal Workflow Live API

## Summary

Activated the typed OOS Proposal projection, command, event, and history API on
top of canonical Workspace Proposals persistence.

## Classification

- area: Workspace Proposals workflow integration
- type: owner-repo runtime implementation
- runtime impact: adds four authenticated OOS routes and one required
  OpenProject machine-state field configuration

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: User story `#858` under Feature `#856` and delivery `#417`
- related products or components: Governance Operations Console, Workspace
  Proposals, Operator Orchestration Service

## Root Cause

- immediate failure: the Console Proposal surface had no live typed adapter for
  canonical projection, versioned writes, receipts, or history.
- actual root cause: contract admission in `#851` intentionally stopped before
  OOS runtime implementation and Platform machine-state persistence.
- why it escaped earlier controls: it was deferred source work, not a defect in
  the legacy Idea API.

## Source Changes

- changed workflow, adapter, or contract: implemented authenticated Proposal
  routes, strict command/projection/result/event/history validation,
  optimistic-concurrency OpenProject writes, idempotent command receipts,
  durable structured event comments, and OOS-author history filtering.
- tests or validator added: service transition/replay/recovery tests, HTTP route
  and configuration tests, OpenProject transport tests, exact external-schema
  OpenAPI projection, route/documentation parity, and runtime-image contract
  bundle coverage.
- related change records:
  [2026-08-15-proposal-workflow-contract-parity.md](2026-08-15-proposal-workflow-contract-parity.md)

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: both runtime image targets
  built from the Landing Unit source and passed API health plus fail-closed
  worker smoke checks
- image tag or digest: local-only `oos-api:art-858` and
  `oos-orchestration-worker:art-858`; no image was published
- runtime revision: None

## Live Verification

- local validation: `568` tests passed; Temporal bundle, generated schema,
  OpenAPI, governance-doc, change-record, OpenProject-mutation, image-build,
  API-health, and fail-closed worker checks passed against `origin/main`
- live or dev-integration verification: full Console-to-OOS integration
  rehearsal remains intentionally assigned to #861
- residual risk: target application and Console live wiring are intentionally
  outside this Landing Unit

## Follow-Up

- required follow-up: Console adapter #859, security evidence #860, and
  dev-integration E2E #861
- owner: Governance Operations Console, Security Architecture, and OOS as
  recorded by the Feature
- due date or closure condition: each child closes through its own finalized
  Review Packet

## Rollback

Revert the #858 OOS Landing Unit. Existing `/v1/ideas` routes remain unchanged;
clients must stop using `/v1/proposals` before rollback.
