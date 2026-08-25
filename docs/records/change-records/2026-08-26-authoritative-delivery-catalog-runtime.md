---
security_evidence:
  review_areas:
    - delivery
    - identity
    - runtime
  reviewed_artifacts:
    - contracts/catalog/manifest.json
    - docs/contracts/catalog-v1.md
    - docs/api/openapi.json
    - src/catalog/http-client.js
    - src/catalog/service.js
    - src/catalog/wgcf-readiness-client.js
    - src/app.js
    - src/config.js
    - src/runtime.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "Catalog source is fail-closed and does not activate the privileged OpenProject control adapter, WGCF credentials, Console integration, stage, or production runtime."
---

# 2026-08-26 Authoritative Delivery Catalog Runtime

## Summary

Implemented Delivery ART `#1010`: OOS now owns canonical Delivery Catalog
projection, bounded mutation validation, current repository-readiness proof,
canonical readback, and durable-result enforcement.

## Classification

- area: authoritative Delivery Catalog
- type: bounded runtime and canonical backend integration
- runtime impact: source-complete in OOS; composition, Security approval,
  activation, and Console wiring remain deferred

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: User story `#1010` under Feature `#909` and delivery `#884`
- related components: Workspace Governance Control Fabric, Governance
  Operations Console, and OpenProject Delivery ART

## Root Cause

- immediate gap: the admitted Catalog contract had no OOS runtime.
- actual boundary: canonical projection, stale-write protection, operator
  acceptance, repository-readiness verification, privileged mutation, readback,
  and durable evidence had to remain one fail-closed service boundary.
- platform constraint: OpenProject API v3 exposes Custom Options for reading,
  not administrative value mutation, so a separately governed backend control
  adapter is required.

## Source Changes

- project canonical Catalog groups, items, values, usage, capabilities, source
  revision, and evidence without fixture fallback
- validate route identity, mutability, parent relationships, source revision,
  value usage, operator acceptance, and idempotency before mutation
- require an exact content-addressed WGCF repository-readiness reference for
  Owner Repo and re-evaluate its authority digest before linking
- delegate one mutation to the privileged backend adapter and require matching
  canonical readback plus durable receipt evidence before success
- expose bounded HTTP and exact-schema OpenAPI contracts with no direct Console
  access to OpenProject or WGCF

## Artifact And Deployment Evidence

- source-only Landing Unit; no secret, Console, deployment, stage, production,
  Catalog value, or Repository lifecycle state changed
- runtime revision: pending reviewed merge head

## Live Verification

- local validation covers canonical projection, HTTP authority, source
  conflicts, operator identity separation, currentness re-evaluation, in-use
  retirement, backend failure, readback mismatch, and inactive configuration
- live verification is intentionally deferred to composition, Security,
  activation, and Console children `#1011`-`#1014`
- residual risk: no live privileged Catalog mutation is claimed by this source
  Landing Unit

## Follow-Up

- required follow-up: Workspace Governance composition `#1011`, Security review
  `#1012`, Platform activation `#1013`, and Console integration `#1014`
- closure condition: each child closes through its own reviewed evidence
  boundary

## Rollback

Revert the Catalog service, clients, route wiring, generated OpenAPI projection,
operator guidance, and tests. Because activation remains denied, rollback
requires no live Catalog, Repository, Console, stage, or production mutation.
