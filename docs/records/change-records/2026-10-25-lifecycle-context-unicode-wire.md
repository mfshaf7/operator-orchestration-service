---
security_evidence:
  review_areas: [runtime, delivery, ai]
  reviewed_artifacts:
    - src/source-authoring/context-contract.js
    - src/source-authoring/prototype-context.js
    - src/delivery-art/lifecycle-context.js
    - src/delivery-art/lifecycle-context-client.js
    - test/prototype-authoring-context.test.js
    - test/delivery-art-lifecycle-context.test.js
    - docs/operations/operator-source-editing.md
  findings: []
  risks: []
  workstreams: [WS-007]
  notes: Honor the existing CGG lifecycle canonical-byte contract across both authoring producers and shared response validation. Retain content bytes, internal custody and all context/model/source authority. Preserve typed owner denials and require exact source reacceptance plus native linked retry before operating closure.
---

# Lifecycle context Unicode wire compatibility

## Summary

Match the existing CGG lifecycle format for both Prototype and Delivery
source-list digests and their shared CGG projection-envelope validator. Preserve
source bytes and all other protocols. Surface CGG's native nested error code
through the existing bounded error projection.

## Classification

- area: existing lifecycle context wire boundary for source authoring
- type: corrective maintenance authorized under Epic1323 operating acceptance
- runtime impact: valid Unicode context can be admitted for optional model drafting; incorrect or unauthorized context remains denied

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Epic1323, non-source operating acceptance1328; no new ART child
- related products or components: Console, CGG lifecycle projection and existing governed model drafting

## Root Cause

- immediate failure: the native Console Prototype source session succeeded, but its generation failed with `lifecycle_context_rejected` before model dispatch.
- actual root cause: exact retained-request replay through the commissioned OOS CGG client returned HTTP400 with `context_projection_invalid` and `sources_digest does not match the canonical source list`. Both OOS producers hashed Unicode source frames using the ART UTF-8 codec; the established CGG lifecycle implementation uses compact sorted ASCII-escaped JSON. The shared OOS response validator also expected the wrong envelope bytes. The client looked for a top-level error code while the actual API returns its typed reason inside `detail`.
- why it escaped earlier controls: context fixtures computed producer and response hashes in JavaScript on ASCII samples, omitting the actual Python Unicode boundary and native error envelope.

## Source Changes

- changed workflow, adapter, or contract: add the existing CGG wire digest in the shared lifecycle boundary module, use it in both source-list producers, retained Prototype request validation and shared response-envelope verification. No dual-hash acceptance, CGG protocol change, source normalization or ART/internal digest change. Parse the actual nested CGG error code and retryability while retaining bounded outward errors.
- tests or validator added: both real producer paths use an independent Python serializer oracle with accented, CJK, astral, DEL, BOM and CRLF data. Validate the response envelope, preserve source bytes and immutable replay, and reject an ART-format envelope. A native nested-error test preserves the reason without exposing internal detail. All36 focused context, realization and operator-draft cases pass after repair; the three new cases fail before correction.
- related change records: [source ref freshness](2026-10-25-prototype-source-ref-freshness.md) is separately resolved; this repair preserves its automatic source observation.

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source repair requires full owner CI-equivalent checks, API/worker image smoke and actual cross-owner request/result/replay/tamper proof before merge. Fresh composed Security acceptance and normal Platform commissioning precede live retry.
- image tag or digest: None at source preparation; final build and commissioning evidence belongs to the exact-head PR and runtime receipts.
- runtime revision: None at source preparation; the active prior revision does not include this repair.

## Live Verification

- local validation: all three new failures reproduce before repair; all36 focused cases pass afterward. Full suite passes1637 tests with two existing optional skips and no failures. Nine additional isolated cases execute actual OOS producers/client/response validation and actual CGG FastAPI/Python pipeline with private local stores: both authoring routes and immutable replay, old ART-frame denial, changed-content replay conflict, caller denial, wrong response-envelope denial and typed owner-error propagation. Work/session/source and caller credentials are synthetic; this is actual protocol proof, not live model or runtime qualification. Build and remaining exact-head CI-equivalent results belong in the PR evidence.
- live or dev-integration verification: original generation `prototype-generation:e62f57f2d5eeba737ec9b881f513024a1b08a366` is retained as failed. Its exact context request confirms the owner400 reason. There was no model draft, source application or commit. New operating proof requires an explicitly linked generation retry after commissioning, not a changed replay or replacement source request.
- residual risk: failed context remains fail closed; no raw fallback, provider dispatch, permission expansion or changed custody is authorized by serialization compatibility.

## Follow-Up

- required follow-up: include this security-tagged record in the generated Security index, accept the actual merged OOS source in the existing composed decision, commission once and prove native linked model drafting followed by editor/import/cancellation and actual Delivery source work.
- owner: OOS for the existing wire adapter; Security and Platform retain their acceptance and commissioning authority.
- due date or closure condition: positive native retry and linked learning closure, followed by1328/1329 operating completion.
