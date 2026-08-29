---
security_evidence:
  review_areas:
    - identity
    - delivery
    - runtime
  reviewed_artifacts:
    - contracts/delivery-closeout
    - src/delivery-closeout
    - src/openproject-client.js
    - src/app.js
    - src/runtime.js
    - docs/api/openapi.json
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-08-29 Delivery Closeout API

## Summary

Added the authoritative OOS acceptance, closeout, outcome-history, and receipt
contract consumed by the Governance Operations Console.

## Classification

- area: terminal Workspace Delivery initiative control
- type: operator workflow API, optimistic concurrency, durable outcome receipt
- runtime impact: OOS API and event projection; Console consumption remains in
  work item `#1031`

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: User story `#1030` under Delivery `#886`
- governing architecture: durable architecture packet for `delivery-886`

## Root Cause

- immediate gap: lower-level readiness and guided close routes existed, but the
  Console lacked one revision-bound acceptance, replay, receipt, and history API
- actual root cause: the prototype-local Console closeout could derive an
  outcome without authoritative OOS command custody
- control response: compose existing closeout authority behind one typed OOS
  contract instead of duplicating ART mutation or adding another database

## Source Changes

- added normalized closeout readiness and outcome-history projection
- added accepted-intent and terminal-result events with idempotent replay
- serialized commands per Delivery initiative so concurrent requests reconcile
  against durable event truth before any second mutation
- added stale, not-ready, identity, evidence, and reconciliation guards
- added typed `none`, `workspace_entrant`, and `existing_product_change` outputs
  without claiming downstream mutation
- reused the existing authenticated OpenProject activities API for event
  custody; closeout writes only the proven writable activity `comment` field
  and does not add a custom field or depend on `allowedValues`
- added generated OpenAPI, operator guidance, and focused contract, service,
  replay, partial-failure, OpenProject adapter, HTTP, and runtime-image tests

## Artifact And Deployment Evidence

- source change pending pull-request review and merge
- CI-equivalent local images built successfully:
  - API image: `oos-api:delivery-closeout-1030`
  - orchestration worker image:
    `oos-orchestration-worker:delivery-closeout-1030`
- the reviewed worktree was deployed only to the local `refinement-catalog`
  dev-integration composition; no image was pushed and no stage or production
  runtime changed
- dev-integration session:
  `accepted-idea-delivery-mfshaf7-20260828T234923Z`

## Live Verification

- local validation:
  - `npm test`: `855` passed, `0` failed
  - all deterministic orchestration, Refinement, OpenAPI, governance-doc,
    change-record, and OpenProject mutation-contract validators passed
  - API and worker image smoke passed; API returned `status=live` and the
    disabled worker remained fail closed
- dev-integration proof:
  - the deployed branch projected authoritative closeout state for
    `delivery-886`, including its exact source revision, unresolved readiness
    reasons, and `resolve_delivery_closeout_gates` next action
  - a command whose accepted operator did not match the accountable operator
    was rejected with HTTP `400` and
    `delivery_closeout_operator_acceptance_mismatch` before mutation
  - no terminal closeout command was applied to the active initiative
- residual risk: accepted commands without terminal event custody require
  explicit reconciliation and are never replayed blindly

## Follow-Up

- required follow-up: Console work item `#1031` replaces prototype-local
  closeout and history truth with this contract
- owner: `governance-operations-console`
- closure condition: finalized Review Packet for `#1031`
