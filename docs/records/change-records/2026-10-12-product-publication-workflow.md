---
security_evidence:
  review_areas:
    - identity
    - delivery
    - runtime
  reviewed_artifacts:
    - contracts/product-publication
    - src/product-publication
    - src/app.js
    - src/config.js
    - src/runtime.js
    - Dockerfile
    - scripts/sync_product_publication_openapi.mjs
    - docs/api/openapi.json
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: Product Publication journals exact external authority evidence and grants no source, runtime, release, Security, or lifecycle authority.
---

# Product Publication Workflow

## Summary

ART `#1255` adds the bounded OOS request journal, exact WGCF issue/readback
verification, version and replay control, publication packet, immutable owner
receipt, caller-scoped read API, and fail-closed inactive runtime gate.

## Classification

- area: Product Publication coordination
- type: source-backed workflow and trust-boundary implementation
- runtime impact: inactive until Security `#1257` and Platform `#1258`

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: `#1255` under Feature `#922` and Epic `#894`
- upstream evidence: Workspace Governance `#1253`; WGCF `#1254`
- downstream consumers: Console `#1256`; Security `#1257`; Platform `#1258`

## Root Cause

- immediate gap: the authoritative publication and readiness contracts existed,
  but no broker-owned journal or terminal receipt connected them to the Console.
- durable cause: OOS had not yet implemented its assigned request, replay,
  version, and receipt boundary for Product Publication.

## Source Changes

- added digest-pinned Product Publication command, evaluation, readiness,
  packet, and receipt contracts;
- added caller/operator authorization, exact issuer and manifest verification,
  atomic journal custody, request and idempotency conflict detection, current
  receipt/version enforcement, terminal applied/rejected receipts, and
  caller-scoped readback;
- added bounded API routes, generated OpenAPI custody, operator guidance, and
  positive and negative source/runtime tests;
- retained explicit `false` values for every cross-control-plane grant.

## Artifact And Deployment Evidence

- source-only change; runtime activation remains false
- image tag or digest: none
- runtime revision: none

## Live Verification

- focused service, client, storage, contract, and HTTP tests
- full repo and base-aware owner validation required before merge
- no image, deployment, route activation, or live operating claim in this
  Landing Unit

## Follow-Up

- Console `#1256` consumes the exact OOS projection.
- Security `#1257` reviews and accepts the exact boundary.
- Platform `#1258` commissions identity, configuration, and live proof before
  activation.
