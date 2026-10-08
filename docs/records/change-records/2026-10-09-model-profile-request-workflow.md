---
security_evidence:
  review_areas:
    - identity
    - delivery
    - runtime
    - ai
  reviewed_artifacts:
    - contracts/model-profile-request
    - src/model-profile-request
    - src/app.js
    - src/config.js
    - src/runtime.js
    - docs/api/openapi.json
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: Source-complete request coordination remains runtime-inactive pending Platform fulfillment integration and Security acceptance.
---

# Governed Model Profile Request Workflow

## Summary

ART #1240 adds the bounded OOS request and review protocol for governed model
profiles, including exact operator attribution, revision and replay controls,
Platform-owned fulfillment evidence, Console-compatible projection, and
immutable receipts.

## Classification

- area: governed model-profile request coordination
- type: source-backed workflow and trust-boundary implementation
- runtime impact: inactive until Platform #1241 and Security #1243 complete

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: #1240 under Feature #1214 and Epic #1203
- related products or components: Platform Engineering governed model profiles, Governance Operations Console

## Root Cause

- immediate failure: operators had profile policy artifacts but no bounded
  request, review, fulfillment, and receipt workflow joining the current
  owners.
- actual root cause: OOS did not yet own a durable request protocol that left
  registry implementation and security acceptance with their authoritative
  repos.
- why it escaped earlier controls: the existing Platform registry and Console
  domain contract deliberately established ownership before the workflow was
  implemented.

## Source Changes

- changed workflow, adapter, or contract: added closed JSON schemas, atomic
  state custody, exact caller/operator bindings, revision-checked review and
  fulfillment transitions, deterministic replay protection, immutable receipt
  chaining, bounded HTTP routes, and generated OpenAPI custody.
- tests or validator added: positive end-to-end state flow and negative schema,
  transition, stale-revision, replay-conflict, cross-caller, unauthorized
  fulfillment, runtime configuration, HTTP, and API-doc parity tests.
- related change records: None.

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only; manifest remains source-complete-inactive
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation: focused contract/service/HTTP tests, full repository tests, generated OpenAPI parity, governance validation, and base-aware owner validation
- live or dev-integration verification: assigned to Platform #1241 after this exact source revision lands; Console integration follows in #1242
- residual risk: no operator should infer a commissioned model profile until Platform fulfillment and Security acceptance are both authoritative

## Follow-Up

- required follow-up: implement the canonical Platform fulfillment path in #1241, consume projections in Console #1242, and review/accept the exact boundary in Security #1243
- owner: the owner repos assigned by the Epic #1203 architecture packet
- due date or closure condition: before Feature #1214 closes
