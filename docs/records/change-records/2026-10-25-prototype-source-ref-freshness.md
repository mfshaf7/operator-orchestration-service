---
security_evidence:
  review_areas: [runtime, delivery]
  reviewed_artifacts:
    - src/source-authoring/prototype-source-adapter.js
    - test/prototype-authoring-source.test.js
    - docs/operations/operator-source-editing.md
  findings: []
  risks: []
  workstreams: [WS-007]
  notes: Refresh only the admitted owner's fixed origin/main ref before read-only inspection. Preserve commissioned executable custody, canonical ancestry, exact source selection and all source/model/credential authorization boundaries. Exact composed Security acceptance remains required before runtime commissioning.
---

# Prototype source ref freshness

## Summary

Refresh the canonical Studio main ref before inspecting the exact source
selected by the broker. A native Landing can advance remote main while the
commissioned host checkout correctly remains on its accepted code revision.
Preparation must observe that new source without an operator Git command.

## Classification

- area: existing Prototype authoring preparation
- type: corrective maintenance authorized under Epic1323 operating acceptance
- runtime impact: source preparation observes merged owner data without moving the commissioned executable checkout

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Epic1323, non-source operating acceptance1328
- related products or components: Console, Prototype Studio, existing typed source executor

## Root Cause

- immediate failure: the Console received `prototype_source_inspection_unavailable` after successful native Landing; no source request was retained.
- actual root cause: the inspector tested the selected revision against stale local `origin/main`, then cloned only locally available objects. Canonical record authority had already observed the remote merged commit.
- why it escaped earlier controls: inspection tests used already-fetched owner objects, so they did not reproduce separate remote publication and stale commissioned checkout state.

## Source Changes

- changed workflow, adapter, or contract: use the existing hardened, bounded Git helper to fetch fixed `origin main` before the existing ancestry guard and detached inspection. Execute the commissioned owner control against the selected snapshot; never pull or reset the executable checkout. Update the primary operator procedure.
- tests or validator added: a real Git publisher advances remote main with Unicode data while the owner lacks that object. Inspection must fetch it and leave HEAD and files unchanged. Unmerged branch selection and unavailable origin remain denied before owner inspection or source credential preparation. Existing realization and operator-draft tests cover the downstream session, edit/import, provenance, acceptance and cancellation boundaries.
- related change records: existing [source editing procedure](../../operations/operator-source-editing.md) remains the primary operator surface; no new workflow or ART child is introduced.

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source repair; local CI-equivalent tests, validators and API/worker image smoke are required before merge. Fresh exact composed Security acceptance and normal Platform activation are required before live proof.
- image tag or digest: None; final built artifacts are recorded in PR and commissioning evidence.
- runtime revision: None at source preparation; do not describe the uncommissioned candidate as active.

## Live Verification

- local validation: the new regression fails before the fix; all28 focused source, realization and operator-draft tests pass afterward. The full suite passes1634 tests with two existing optional skips and no failures; all13 remaining working-tree CI-equivalent checks pass. Six additional isolated checks execute actual Studio Python and actual broker preparation against the real merged Landing data, proving missing-object refresh, immutable replay, exact credential metadata planning and untouched commissioned files. Executor authorization and provider metadata are explicitly synthetic in that sandbox; it neither issues a credential nor qualifies the live workflow. Exact-head base-aware validation and image smoke belong in the PR evidence.
- live or dev-integration verification: native Landing merged Studio PR43 at `32e5b40a4198ee8a468697502dc73324334cac70`; canonical records selected it, while the host accepted checkout at `84b7e7a596ce3d6f1c5853bbf1c348611ed9cdb6` lacked the object. The original immutable source request failed without retained state. Recommissioned positive preparation and actual editor/import acceptance remain pending.
- residual risk: unavailable canonical origin is a visible preparation failure. There is no cached-success fallback, arbitrary ref fetch, authority expansion or source/model effect during inspection.

## Follow-Up

- required follow-up: include this security-tagged record in the generated Security index; accept the actual merged OOS source in the existing composed decision, activate once and retry the original request. Complete Prototype and Delivery operating proofs before closing Epic1323.
- owner: OOS for the repair; Security and Platform retain their existing acceptance and commissioning authority.
- due date or closure condition: operating acceptance1328 and its linked source-ref regression learning record are complete only after native proof succeeds.
