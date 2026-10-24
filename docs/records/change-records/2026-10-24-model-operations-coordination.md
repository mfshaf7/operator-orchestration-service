---
security_evidence:
  review_areas: [identity, delivery, runtime, ai]
  reviewed_artifacts:
    - src/model-operations
    - src/app.js
    - src/config.js
    - src/runtime.js
    - contracts/governed-ai/effective-selection.schema.json
    - docs/api/openapi.json
    - docs/operations/model-operations-operator-surface.md
  findings: []
  risks: []
  workstreams: [WS-007]
  notes: Source implementation only. The accepted architecture assigns actual composed Security acceptance to 1319 and commissioning to 1320; this record does not accept or activate provider access.
---

# Model Operations Coordination

## Summary

ART 1317 extends OOS with authenticated operator intent and progress for the
Platform-owned model-management API. Console can discover admitted backends and
models, request registration and native sign-in, save defaults/task overrides
and explicit fallbacks, and recover the same operation after interruption.
Existing AI consumers retain actual model-selection metadata without changing
their business output or allowing a model to approve or apply its own output.

## Classification

- area: governed AI selection and shared operator coordination
- type: source-backed ART Landing Unit `delivery-1313-ai-routing-oos-coordination`
- runtime impact: disabled by default; separately commissioned dev-integration only

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: 1317 under Feature 1315 and Epic 1313
- related products or components: Platform governed AI gateway, Governance Operations Console, CGG
- architecture: `architecture-packet:delivery-1313-v1`, schema 6, digest `sha256:7715729bdb3420a790ff816d204c4c9c96a94745265444c517b2d02cb3e316b6`

## Root Cause

- capability gap: the existing Model Profile Request workflow handles purpose and permission changes; it intentionally does not expose ordinary runtime model registration or routing settings
- extension: coordinate the already merged Platform owner API rather than mutate its source-locked permission workflow or create a second configuration authority
- upstream source: Platform PR334 merged as `08c34986050963796246d4bb5f243524a2138e35`; bounded custody-classification repair PR335 merged as `bac16095276eb777e7c71797f39da5e13d30a488`

## Source Changes

- new bounded API routes, private durable intent/progress, configured caller/operator bindings and fixed Platform endpoint with a separate management credential file
- known effect-free failure permits explicit next attempt; unknown completion reconciles the original command; accepted receipts are retained before historical readback
- request and control revisions, immutable idempotency input, caller-owned list/read/cancel and native login cancellation with actual owner terminal readback
- serial dispatch and short serialized store transactions reuse the existing private atomic record store; no new workflow engine, database or provider secret store
- actual backend/model/native effort/fallback evidence is opt-in owner metadata and optional for historical records; wrong-task, incomplete or secret-bearing metadata fails closed
- Work Design, Refinement, Agent Console, Delivery source realization and Prototype source authoring preserve canonical task outputs and existing source-policy bindings
- a retained Prototype model request preserves its original wire version across recovery
- tests cover persisted lost responses, concurrent later configuration edits, stale controls, cancellation, private caller scope, tampered owner evidence and consumer compatibility
- related change records: Platform model-management foundation and custody-classification maintenance records; existing Model Profile Request source activation

## Artifact And Deployment Evidence

Source-only candidate. No new runtime, image, account, provider registration or
configuration is activated by this Landing Unit. Platform commissioning consumes
the actual OOS source after composed Security review. Existing live execution
checkouts remain on their accepted revisions until that commissioning.

## Live Verification

- local owner proof: focused model operations and consumer tests exercise actual OOS services and private persisted state with bounded owner test doubles; API and full owner checks remain required before merge
- live or dev-integration verification: assigned to commissioning and operating qualification; no live completion is claimed here
- residual risk: actual Codex sign-in, provider entitlement, egress, custody, resources and every consumer route require the accepted composed runtime proof

## Follow-Up

- required follow-up: Console 1318, actual-source Security review 1319, Platform commissioning 1320 and non-source operating qualification 1321
- owner: assigned owner of each existing child
- closure condition: source review/merge with finalized native Review Packet for 1317; Feature/Epic completion requires the subsequent operating demonstration
