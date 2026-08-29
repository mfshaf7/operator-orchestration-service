---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - contracts/delivery-closeout
    - src/delivery-closeout/service.js
    - test/delivery-closeout-service.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-08-29 Delivery Closeout Replay Identity

## Summary

Corrected Delivery closeout replay identity so a retry with a newly issued
server acceptance timestamp replays the accepted semantic command instead of
being rejected as a payload conflict.

## Classification

- area: terminal Workspace Delivery initiative control
- type: bounded idempotency correction
- runtime impact: OOS Delivery closeout command admission only

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Defect `#1037` under Feature `#912`
- related products or components: Governance Operations Console closeout

## Root Cause

- immediate failure: Console retries preserve command identity but issue a new
  server-side `accepted_at`, while OOS v1 hashed that timestamp into identity
- actual root cause: an audit observation field was treated as semantic command
  intent
- why it escaped earlier controls: #1030 replay tests reused one fully static
  command object and did not compose with the Console server adapter

## Source Changes

- changed workflow, adapter, or contract: Delivery closeout now uses a versioned
  semantic digest that excludes only `accepted_at`
- tests or validator added: positive timestamp retry and negative changed-note
  conflict cases
- related change records: `2026-08-29-delivery-closeout-api.md`

## Artifact And Deployment Evidence

- source-only change pending reviewed pull request
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation:
  - `npm test` (858 passed)
  - `npm run validate:delivery-closeout-openapi-schemas`
  - `npm run validate:api-docs` (94 documented and implemented routes)
  - `npm run validate:governance-docs`
  - `npm run validate:change-record-requirement`
  - `npm run validate:openproject-mutation-contracts`
- dependency audit: `npm audit --omit=dev` reports the existing moderate `ajv`
  advisory; the available fix requires a forced dependency-range change and is
  outside this bounded correction
- live or dev-integration verification: required by Console `#1031` composed proof
- residual risk: pre-fix events lack semantic identity evidence and therefore
  route to explicit reconciliation rather than permissive replay

## Follow-Up

- required follow-up: complete Console closeout adapter and composed replay proof
- owner: `governance-operations-console`
- due date or closure condition: finalized Review Packets for `#1037` and `#1031`
