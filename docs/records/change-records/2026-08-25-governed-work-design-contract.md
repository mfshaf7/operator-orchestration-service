---
security_evidence:
  review_areas:
    - ai
    - delivery
    - identity
  reviewed_artifacts:
    - contracts/work-design/manifest.json
    - contracts/work-design/assist-request.schema.json
    - contracts/work-design/assist-result.schema.json
    - contracts/work-design/apply-request.schema.json
    - contracts/work-design/apply-result.schema.json
    - contracts/work-design/error.schema.json
    - docs/contracts/work-design-v1.md
    - src/work-design/contracts.js
    - test/work-design-contract.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "Live activation remains blocked until the exact CGG, Platform, OOS runtime, Security, and Console children complete."
---

# 2026-08-25 Governed Work Design Contract

## Summary

Added the provider-neutral OOS Work Design assist and operator-apply contract
for Delivery ART `#990`. The contract admits typed context and tree advice,
keeps model output suggestion-only, and requires explicit matching operator
acceptance plus backend readback for canonical apply.

## Classification

- area: governed Delivery Work Design
- type: source contract and validator foundation
- runtime impact: none; reserved routes remain `not-implemented`, the Work
  Design model profile remains inactive, and no Console adapter is changed

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: User story `#990` under Feature `#908` and delivery `#884`
- downstream owners:
  - `context-governance-gateway`
  - `platform-engineering`
  - `security-architecture`
  - `governance-operations-console`

## Root Cause

- immediate gap: OOS had no provider-neutral contract for requesting bounded
  Work Design advice or applying an accepted draft through its canonical
  backend adapter.
- architectural cause: existing AI-assist contracts are intake-specific and
  cannot truthfully represent Work Design context/tree advice or a distinct
  operator-approved apply boundary.
- control response: admit the typed OOS contract before implementing CGG
  projection, model-profile activation, runtime routes, or Console wiring.

## Source Changes

- added versioned assist request/result schemas for `context_advice` and
  `tree_advice`
- added versioned apply request/result schemas with explicit operator acceptance,
  accepted-draft digest, idempotency, backend readback, and durable receipt
- added bounded error codes for context, profile, provider, schema, operator,
  replay, apply, and backend failures
- added reusable OOS contract assertions and semantic acceptance-identity check
- added a manifest that distinguishes contract-admitted paths from live and
  deferred capability
- included the contract bundle in the runtime image for later OOS consumers

## Artifact And Deployment Evidence

- source-only change; no image was published and no deployment was changed
- the runtime Dockerfile includes the admitted contract bundle so later runtime
  implementation cannot omit the reviewed schemas
- local CI-equivalent image proof built `oos-api:work-design-990` and
  `oos-orchestration-worker:work-design-990`
- reserved HTTP paths remain unimplemented and the logical model profile is
  inactive

## Live Verification

- `npm test` passed `694/694` tests, including positive and negative
  assist/apply cases, semantic operator binding, bounded errors, and
  runtime-image inclusion
- deterministic orchestration bundle, generated OpenAPI schema, API-document,
  governance-document, change-record, and base-aware OpenProject mutation
  checks passed against fetched `origin/main`
- the local API image returned `{"ok":true,"status":"live"}` and the worker
  image retained `run_allowed: false` with all activation gates absent
- no live or dev-integration model invocation is claimed by this Landing Unit

## Follow-Up

- required follow-up: CGG projection `#991`, Platform gateway/profile
  foundation `#992`, OOS runtime and apply `#993`, Security review `#994`,
  dev-integration activation `#995`, and Console integration `#996`
- owner: the owner repo recorded on each ART child and architecture packet
- closure condition: each child closes through its own reviewed Landing Unit
  or valid non-source security evidence

## Trust And Security Posture

- model output cannot authorize or invoke apply
- callers cannot choose a provider or inject a model profile into the public
  assist request
- the Console cannot call CGG, the gateway, a provider, or OpenProject directly
- fixture fallback is prohibited in configured live mode
- this Landing Unit does not activate credentials, egress, models, routes, or
  canonical mutations

## Validation

- focused Work Design contract tests cover admitted context/tree requests,
  provider-field rejection, typed evidence, mocked-status rejection, matching
  operator acceptance, readback/receipt enforcement, bounded errors, manifest
  posture, and runtime bundle inclusion
- full OOS validation remains required at the reviewed source head before merge

## Rollback

Revert this contract bundle, validator module, documentation, tests, Docker copy,
and README link. No CGG, Platform, Security, Console, OpenProject, or live model
state requires rollback because none is changed here.
