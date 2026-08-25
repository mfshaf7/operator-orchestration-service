---
security_evidence:
  review_areas:
    - ai
    - delivery
    - identity
    - runtime
  reviewed_artifacts:
    - contracts/work-design/manifest.json
    - docs/contracts/work-design-v1.md
    - docs/api/openapi.json
    - src/work-design/service.js
    - src/work-design/clients.js
    - src/work-design/http-client.js
    - src/app.js
    - src/openproject-client.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "OOS source implementation is fail-closed and does not activate a model, provider, Console adapter, or stage/prod runtime."
---

# 2026-08-25 Governed Work Design Runtime

## Summary

Implemented Delivery ART `#993`: OOS now owns the typed Work Design assist and
operator-approved apply routes while preserving CGG context custody, Platform
model access, explicit operator acceptance, and the existing canonical Delivery
writer.

## Classification

- area: governed Delivery Work Design
- type: bounded runtime and backend adapter integration
- runtime impact: source-complete in OOS; profile activation and Console wiring
  remain deferred

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: User story `#993` under Feature `#908` and delivery `#884`
- related components: Context Governance Gateway, governed AI gateway,
  Governance Operations Console, and OpenProject Delivery ART

## Root Cause

- immediate failure: the admitted Work Design routes had no OOS implementation.
- actual root cause: context projection, governed invocation, operator
  acceptance, canonical apply, and readback had not yet been composed behind
  one workflow-owned boundary.
- why it escaped earlier controls: `#990` intentionally admitted only the
  versioned contract; runtime implementation was isolated to this child.

## Source Changes

- implemented fail-closed CGG and governed-gateway clients
- verified source revision and all returned CGG binding fields before model use
- validated typed model output and returned only receipt-bound advice
- required exact operator acceptance and accepted-tree digest before apply
- reused the existing Delivery plan reconciler and OpenProject lock version
  instead of introducing another writer or persistence authority
- added only a read-only `lockVersion` projection to the OpenProject client;
  no form schema, writable field, or `allowedValues` mutation contract changed
- added deterministic apply receipts, duplicate suppression, backend
  reconciliation, OpenAPI projection, and bounded error responses
- added positive and negative conformance tests for source, identity, profile,
  schema, replay, backend, and HTTP authority boundaries

## Artifact And Deployment Evidence

- source-only Landing Unit; no deployment, profile activation, provider
  credential, Console source, or external runtime was changed
- local CI-equivalent images:
  - `oos-api:work-design-993`:
    `sha256:e395f8e1cd4f5f71e8a03c0406558705ee60abbe814bb9bb6b32a1f7da95b5a1`
  - `oos-orchestration-worker:work-design-993`:
    `sha256:c26dc8d4edd4a0e1c964dda0c5bfcf04b94540d22a6ef396bd3e7b8a757a011a`
- runtime revision: pending reviewed merge head

## Live Verification

- local validation: focused Work Design contract, client, HTTP, OpenProject,
  assist, apply, replay, and failure tests; full OOS test suite (`708/708`);
  deterministic orchestration bundle; generated OpenAPI; API docs; governance
  docs; and base-aware OpenProject mutation checks
- live or dev-integration verification: profile intentionally inactive; no live
  model result is claimed
- residual risk: exact live integration requires Security delta review,
  dev-integration activation, and the Console adapter in `#994`-`#996`

## Follow-Up

- required follow-up: Security delta review `#994`, dev-integration activation
  `#995`, and Governance Operations Console adapter `#996`
- owner: owner repo declared on each ART child
- due date or closure condition: each child closes through its own reviewed
  evidence boundary

## Rollback

Revert the OOS Work Design routes, clients, service, OpenProject source-revision
adapter, generated OpenAPI projection, and tests. Because the profile remains
inactive and no Console adapter is changed, rollback does not require provider,
CGG, Console, stage, or production mutation.
