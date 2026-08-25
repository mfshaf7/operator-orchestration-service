---
security_evidence:
  review_areas:
    - ai
    - delivery
    - identity
  reviewed_artifacts:
    - contracts/refinement/manifest.json
    - contracts/refinement/packet.schema.json
    - contracts/refinement/assist-request.schema.json
    - contracts/refinement/assist-result.schema.json
    - contracts/refinement/apply-request.schema.json
    - contracts/refinement/apply-receipt.schema.json
    - contracts/refinement/run-projection.schema.json
    - contracts/refinement/projection-result.schema.json
    - contracts/catalog/manifest.json
    - contracts/catalog/repository-readiness-reference.schema.json
    - contracts/catalog/projection-result.schema.json
    - contracts/catalog/mutation-request.schema.json
    - contracts/catalog/mutation-result.schema.json
    - docs/contracts/refinement-v1.md
    - docs/contracts/catalog-v1.md
    - src/refinement/contracts.js
    - src/catalog/contracts.js
    - test/refinement-contract.test.js
    - test/catalog-contract.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "Runtime, profile, repository-readiness implementation, activation, and Console wiring remain blocked behind their #909 dependency and Security gates."
---

# 2026-08-26 Refinement And Catalog Contracts

## Summary

Added provider-neutral OOS contracts for governed Delivery Refinement and
authoritative Delivery Catalog operation under ART `#1005`. The contracts bind
optional metadata advice, explicit operator acceptance, durable Refinement
apply, backend readback, Catalog mutation, and exact WGCF repository-readiness
references without activating runtime behavior.

## Classification

- area: governed Delivery Refinement and Catalog
- type: source contract and validator foundation
- runtime impact: none; all declared routes remain `not-implemented`, profiles
  remain inactive, and no Console adapter or canonical backend is changed

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: User story `#1005` under Feature `#909` and delivery `#884`
- downstream owners:
  - `context-governance-gateway`
  - `platform-engineering`
  - `workspace-governance-control-fabric`
  - `workspace-governance`
  - `security-architecture`
  - `governance-operations-console`

## Root Cause

- immediate gap: approved Console Refinement and Catalog surfaces were backed
  by local fixtures and mutations without one versioned cross-owner protocol
- architectural cause: Work Design contracts do not cover metadata
  finalization, durable Refinement apply, Catalog vocabulary mutation, or
  repository-readiness evidence
- control response: admit strict semantic contracts before any downstream
  owner implements context, profiles, readiness, runtime, activation, or UI
  adapters

## Source Changes

- added a versioned Refinement packet compatible with current semantic Console
  data and free of presentation tone or layout fields
- added typed metadata advice with CGG, profile, schema, and audit evidence
- added immutable operator-accepted apply input, durable run events, terminal
  readback receipt, projection, and bounded failures
- added a versioned Catalog projection and operator mutation protocol
- added an exact repository identity and WGCF readiness-reference contract
  without copying WGCF decision authority into OOS
- added semantic validators for operator identity, metadata-resolution coverage,
  repository identity alignment, mutation constraints, and completed receipts
- included both contract bundles in the runtime image for downstream consumers

## Artifact And Deployment Evidence

- source-only change; no image is published and no deployment is changed
- Docker runtime inputs include both admitted contract bundles
- no HTTP route, model profile, Temporal definition activation, WGCF evaluator,
  Console adapter, credential, egress rule, or backend mutation is enabled

## Live Verification

- focused positive and negative contract tests validate schema and semantic
  boundaries
- full OOS validation and runtime-image inclusion proof are required at the
  reviewed source head before merge
- no live Refinement advice, apply, Catalog mutation, or repository-readiness
  claim is made by this Landing Unit

## Follow-Up

- required follow-up: ART `#1006` through `#1014` in the dependency order
  recorded by the durable #909 architecture packet
- owner: the owner repo recorded on each ART child
- closure condition: each child closes through its own Review Packet or valid
  non-source Security evidence before Feature `#909` can close

## Trust And Security Posture

- models remain suggestion-only and cannot start apply
- callers cannot select providers or inject profile identities
- explicit authenticated operator acceptance is required for canonical changes
- repository binding requires exact current WGCF evidence and never grants
  repository lifecycle authority
- the Console remains same-origin to OOS and receives no internal credentials
- configured failures fail closed without fixture fallback

## Validation

- focused tests cover valid and invalid Refinement packets, advice, acceptance,
  metadata resolutions, durable completion, Catalog projection, operator
  acceptance, repository identity, retirement isolation, readback, and errors
- full tests, governance docs, change-record enforcement, base-aware mutation
  checks, and runtime image proof remain required before merge

## Rollback

Revert the two contract bundles, validators, docs, tests, Docker copy entries,
and README links. No runtime, Console, WGCF, OpenProject, repository, profile,
credential, or deployment state requires rollback because none is changed.
