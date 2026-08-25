---
security_evidence:
  review_areas:
    - runtime
    - delivery
    - identity
  reviewed_artifacts:
    - contracts/delivery-ingress/prototype-application-request.schema.json
    - contracts/delivery-ingress/prototype-application-result.schema.json
    - contracts/delivery-ingress/prototype-application-event.schema.json
    - src/delivery-ingress/prototype-application-service.js
    - src/delivery-ingress/prototype-adapter.js
    - src/delivery-ingress/wgcf-prototype-readiness-client.js
    - src/openproject-client.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "The target write remains behind authenticated operator binding and a durable WGCF allow receipt. WGCF has no mutation authority, the Console remains a client, and replay derives from trusted OpenProject evidence rather than process memory."
---

# 2026-08-25 Prototype Delivery Application

## Summary

Activated the governed OOS application path from one exact Prototype Delivery
packet to one Workspace Delivery ART Epic.

## Classification

- area: Prototype to Delivery ingress
- type: source-backed operator workflow and target mutation adapter
- runtime impact: adds authenticated Prototype application and read routes;
  Proposal compatibility remains unchanged

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: User story `#982` under Feature `#907` and Epic `#884`
- upstream evidence: Prototype packet `#980` and WGCF readiness `#981`
- downstream projection: Governance Operations Console `#983`

## Architecture Decision

OOS does not own a new database for this workflow. Prototype Studio owns source
packet truth, WGCF owns readiness custody, OpenProject owns the Delivery target
and immutable OOS-authored application activity, and OOS owns application logic
and projection contracts. Durable replay reconstructs from those authorities.

## Root Cause

- immediate gap: Prototype Studio could emit an approved source packet and
  WGCF could evaluate it, but no admitted owner could apply that evidence to
  Delivery.
- structural cause: target mutation, source truth, readiness authority, and
  durable replay evidence had to stay separate instead of being copied into the
  Console or Prototype Studio.
- correction: OOS now composes those authorities through one authenticated,
  deterministic application boundary.

## Source Changes

- added exact request, result, event, pinned source packet, and pinned readiness
  receipt schemas
- added deterministic application identity and packet identity verification
- added authenticated POST and read-only GET routes
- added WGCF allow-before-mutation enforcement
- added OpenProject target creation/reuse, structured target markers, trusted
  immutable activity receipts, and bounded replay recovery
- proved the live OpenProject form schema before mutation, including the
  writable Owner Repo field and its `allowedValues` contract
- added canonical OpenAPI projection and sync validation
- retained the existing Proposal request, response, mutation, and receipt path

## Validation

- focused contract, service, adapter, API, and WGCF client tests: passed
- API documentation validation: passed
- full repository validation: `686` passed, `0` failed
- base-aware validation: pending final Landing Unit proof

## Artifact And Deployment Evidence

- source change pending pull-request merge
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation:
  - focused Prototype Delivery tests: `18` passed, `0` failed
  - `npm test`: `686` passed, `0` failed
  - `npm run validate:api-docs`: `76` documented routes matched implementation
- live or dev-integration verification: pending merged source and downstream
  Console projection work
- residual risk: process-local serialization assumes the admitted single-replica
  OOS dev-integration topology; multi-writer activation requires a separately
  admitted durable coordination boundary

## Follow-Up

- required follow-up: merge this Landing Unit, publish its finalized Review
  Packet, then allow Console projection work `#983` to consume the API
- owner: `operator-orchestration-service`, followed by
  `governance-operations-console`
- closure condition: `#982` has merged source evidence and a finalized Review
  Packet

## Rollback

Disable the Prototype routes and adapter together. Do not delete source packets,
WGCF receipts, created Delivery Epics, or immutable OpenProject activities;
those remain audit evidence. Proposal ingress remains independently live.
