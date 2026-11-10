---
security_evidence:
  review_areas: [ai, delivery, runtime]
  reviewed_artifacts:
    - src/source-authoring/prototype-owner-preparation.js
    - scripts/sync_prototype_authoring_openapi.mjs
    - src/source-authoring/editor-assistant.js
    - src/source-authoring/prototype-realization.js
    - src/source-authoring/prototype-context.js
    - src/source-authoring/prototype-store.js
    - src/delivery-art/source-realization.js
    - src/delivery-art/lifecycle-context.js
    - src/delivery-art/work-session-service.js
    - src/app.js
    - contracts/delivery-art-work-session/source-editor-assistant-request.schema.json
    - contracts/delivery-art-work-session/source-editor-assistance.schema.json
  findings: []
  risks: []
  workstreams: [WS-007]
---

# Source-aware editor assistance

## Summary

Extends the shared source workspace with an explicit, source-aware AI proposal path.

## Classification

Operator-approved extension outside active ART, retained in the unpublished preview batch. The recorded owner Landing Unit and dependency boundaries apply.

## Ownership

Console owns presentation; OOS owns session, context and draft orchestration; Platform owns model policy and runtime; Security retains acceptance.

## Root Cause

The previous editor exposed basic text editing and a separate generation action, with no selected-file conversation and iterative proposal review. This is an approved capability extension, not a fabricated historical contract defect.

## Source Changes

Operator-approved extension of the existing shared source editor, outside active
ART work. It remains in the current unpublished owner batch; no new service,
provider route, storage subsystem or source-execution authority is introduced.
The existing OOS Landing Unit is extended explicitly for this approved batch;
Console, Platform and Security retain separate source/review/activation units.

The assistant authenticates both source owners through their normal caller and
operator binding. It captures only selected approved text paths, verifies their
base/digests and admits labelled unsaved operator buffers through CGG. Answers
cannot carry edits. Edit proposals can revise selected existing files or add owner-proven absent files inside the real source scope, and cannot
perform source effects. Immutable request/reply artifacts reuse private owner
storage without advancing source realization or silently replacing an attempt.
Exact revision and local snapshot checks precede subsequent operator draft saves.

The primary procedure is [Operator source editing](../../operations/operator-source-editing.md).
Contracts, native handler seams and generated OpenAPI cover both domains.
Tests cover original replay, denied scope/baselines, unavailable/truncated
context, source changes during inference and forbidden output/action paths.

Source tests and an explicitly isolated Console UI sample are implementation
proof only. Fresh Security delta/index and exact composed Platform commissioning
remain required before normal live operation. No OpenProject data/form mutation,
repository write, provider credential change or runtime activation is performed
by this maintenance. Existing exact-digest acceptance, Gary publication and
accountable human review/merge remain separate.

Dependency order after operator review: OOS/Platform/Console source publication,
Security source delta and generated index, exact composition acceptance, then
ordinary Platform activation and native model/source workflow qualification.
No current live model or source-delivery success is claimed.

## Artifact And Deployment Evidence

Implementation and isolated tests are recorded with the owning source batch; no deployment or account changes have been performed.

## Live Verification

Preview only. Live commissioning and native provider/source qualification remain pending exact composed acceptance.

## Follow-Up

Complete operator visual review, owner source publication, Security delta/index and exact acceptance before normal Platform activation. Keep the previous accepted live composition until then.

## Preview embedding intent

The approved release also carries the optional exact-loopback embedding choice
through the existing Preview profile preparation request. OOS binds the choice
to the original request digest and re-renders the Studio owner plan before
source application. It adds no runtime start or draft-execution authority.
Studio schema/runtime is the dependency for this optional profile field.
Source publication is authorized; composed Security acceptance and normal
Platform activation remain required before claiming live availability.
