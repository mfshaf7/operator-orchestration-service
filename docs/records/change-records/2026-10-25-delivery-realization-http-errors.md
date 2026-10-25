---
security_evidence:
  review_areas: [runtime, delivery]
  reviewed_artifacts:
    - src/app.js
    - test/delivery-art-work-session-service.test.js
    - docs/operations/operator-source-editing.md
  findings: []
  risks: []
  workstreams: [WS-007]
  notes: Restore the existing typed source-realization HTTP contract. Preserve absence404, conflict409, authentication and unknown-failure500 boundaries without a fake draft, model invocation, source effect, new authority or schema. Exact composed source reacceptance and same-session first-use proof follow normal commissioning.
---

# Delivery source-realization HTTP errors

## Summary

Preserve the existing typed Delivery source-realization error response at the
broker HTTP boundary. A first manual editor session must observe its native
missing-draft404, then read existing source; it must not need model generation
or a manufactured saved draft to open.

## Classification

- area: existing ordinary Delivery source-authoring HTTP boundary
- type: required corrective maintenance under the approved Epic1323 operating exercise
- runtime impact: first-use absent draft and typed save conflicts become their declared error responses; unexpected errors remain bounded500

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: active1329 real LittleList editor/import delivery; no new ART child
- related products or components: Console source editor, existing broker realization and private draft kernel

## Root Cause

- immediate failure: actual Console first-use draft GET returned500/internal_error while the current owner realization was not-started and its source session/base/worktree/approved scope were valid. No draft or model invocation existed.
- actual root cause: the real realization service deliberately throws `DeliveryArtSourceRealizationError` with404 for no retained draft. New draft/file/save handlers forward that typed class, but the shared application exception projection did not recognize it. The same omission also converted real revision conflicts to500. The Console correctly accepts only404 as absence and therefore refused to open its first editable source view.
- why it escaped earlier controls: the existing actual private-kernel HTTP test saved a draft before reading it and did not assert first-use absence or stale-save rejection at the transport boundary. Service-level rejection tests alone did not prove the declared HTTP status.

## Source Changes

- changed workflow, adapter, or contract: include this existing typed error class beside the existing lifecycle typed errors in the shared HTTP projection. Use its existing `toResponse`; leave unknown-error500 and all authorization, draft CAS, command identity, content bytes, source/model effects and schemas unchanged.
- tests or validator added: the actual private-kernel HTTP test now starts with absent-draft404 and zero attempts, then proves existing file reads, save200, exact replay200, stale-save409 with unchanged retained digest, malformed selectors/extra authority400, wrong operator403 and bounded unknown-error500 without sentinel detail. The first-use case fails500-versus404 before correction and passes after the exact mapping repair.
- related change records: [operator source drafts](2026-10-25-operator-source-drafts.md) owns the unchanged source contract.

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: exact owner CI-equivalent checks and API/worker image proof precede merge. Fresh Security composition and one normal activation/status precede same-session native Console first-use acceptance.
- image tag or digest: None at source preparation; exact build proof and commissioning receipts supply the deployed result.
- runtime revision: the currently accepted8827eaa does not contain this correction.

## Live Verification

- local validation: actual native-kernel HTTP regression fails before repair and passes afterward. Full owner checks and base-aware validation are recorded in exact-head PR evidence.
- live or dev-integration verification: same actual1329 source request remains not-started at discovery. Read-only Console/server-client diagnostics both record owner500/internal_error at the draft endpoint, while identity-bound work-session and realization reads succeed. Preserve the current approved app scope, base and worktree through repair; no app source was uploaded or changed.
- residual risk: only the existing typed class is serialized. Unexpected exceptions stay bounded500; missing/stale/error responses never become successful canonical source envelopes or source effects.

## Follow-Up

- required follow-up: land exact owner source, update the generated security change-record index and composed acceptance, commission once, clear the existing1329 blocker and prove the same actual first edit/import/save/reload/accept/delivery path before closing the linked lesson.
- owner: OOS implementation; Security source acceptance and Platform commissioning retain their existing authority.
- due date or closure condition: linked native first-use proof and regression-candidate closure before Epic1323 completion.
