---
security_evidence:
  review_areas:
    - ai
    - delivery
    - identity
    - runtime
  reviewed_artifacts:
    - contracts/refinement/manifest.json
    - docs/contracts/refinement-v1.md
    - docs/api/openapi.json
    - src/refinement/service.js
    - src/refinement/source-adapter.js
    - src/refinement/temporal-adapter.js
    - src/refinement/workflows.js
    - src/refinement/activities.js
    - src/app.js
    - src/openproject-client.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "OOS source implementation is fail-closed and does not activate a model, provider, Console adapter, worker, or stage/prod runtime."
---

# 2026-08-26 Governed Refinement Runtime

## Summary

Implemented Delivery ART `#1009`: OOS now owns canonical Refinement packet
projection, receipt-bound metadata advice, immutable operator acceptance, and
versioned durable apply execution with canonical readback.

## Classification

- area: governed Delivery Refinement
- type: bounded runtime and canonical backend integration
- runtime impact: source-complete in OOS; composition, Security approval,
  activation, and Console wiring remain deferred

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: User story `#1009` under Feature `#909` and delivery `#884`
- related components: Context Governance Gateway, governed AI gateway,
  Temporal, Governance Operations Console, and OpenProject Delivery ART

## Root Cause

- immediate gap: the admitted Refinement contracts had no OOS runtime.
- actual boundary: packet derivation, model-safe advice, accepted-draft
  custody, durable execution, canonical mutation, readback, and receipts had
  to be composed behind one OOS-owned workflow.
- isolation: contract, CGG, Platform profiles, runtime, composition, Security,
  activation, and Console work remain separate Landing Units.

## Source Changes

- derive Refinement packets from trusted Work Design completion plus canonical
  Delivery tree truth, with no fixture fallback
- validate exact CGG request/response and governed model bindings before
  returning one suggestion-only field result
- require explicit authenticated acceptance, matching packet/source revisions,
  complete required values, exact apply plan, and immutable draft digest
- start one deterministic Temporal workflow with fixed workflow and activity
  queues, idempotent replay binding, ordered events, retry, and queryable state
- execute only existing OOS Delivery mutation authorities, read canonical state
  back, and persist a digest-bound trusted OpenProject receipt
- expose bounded HTTP and OpenAPI contracts plus activation-denied worker entry
  and primary operator guidance

The live OpenProject form contract is unchanged. Refinement metadata writes
reuse existing Delivery service operations, which retain their form-schema,
`writable`, and `allowedValues` enforcement. The new durable receipt uses an
authenticated work-package activity comment and introduces no new custom field
or writable form property.

## Artifact And Deployment Evidence

- source-only Landing Unit; no profile, secret, Console, deployment, stage, or
  production state changed
- runtime revision: pending reviewed merge head

## Live Verification

- local validation covers contract, HTTP authority, CGG and gateway binding,
  stale input, invalid advice, activity routing, canonical packet derivation,
  receipt replay, Temporal duplicate/conflict behavior, and worker gates
- live verification is intentionally deferred to composition, Security, and
  activation children `#1011`-`#1013`
- residual risk: no live model or Temporal execution is claimed by this source
  Landing Unit

## Follow-Up

- required follow-up: Catalog runtime `#1010`, composition `#1011`, Security
  review `#1012`, Platform activation `#1013`, and Console adapter `#1014`
- closure condition: each child closes through its own reviewed evidence
  boundary

## Rollback

Revert the Refinement service, clients, source adapter, workflow, activities,
worker, OpenProject adapter additions, generated OpenAPI projection, and tests.
Because activation remains denied, rollback requires no provider, CGG,
Temporal, Console, stage, or production mutation.
