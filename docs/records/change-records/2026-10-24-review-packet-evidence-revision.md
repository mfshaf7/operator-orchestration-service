---
security_evidence:
  review_areas:
    - delivery
  findings: []
  risks: []
  workstreams: [WS-007]
  reviewed_artifacts:
    - src/delivery-art/lifecycle-authoring.js
    - src/delivery-art/lifecycle-controller.js
    - test/delivery-art-lifecycle-controller.test.js
    - docs/operations/delivery-workflow-operator-surface.md
  notes: Restores the existing immutable pre-merge evidence-revision transition without changing source authority, registry mutability or post-merge lineage.
---

# 2026-10-24 Review Packet evidence revision

## Summary

Allow the existing pre-merge lifecycle to revise validation evidence at the
same source head. Name the complete reviewed payload so new proof obtains new
immutable custody while prior proof remains intact.

## Classification

- area: Delivery ART pre-merge evidence
- type: maintenance defect repair
- runtime impact: existing Review Packet authoring and local-draft classification; no API or schema change
- Landing Unit Decision: `child_isolated_landing_unit`; owner-repo maintenance `maintenance-1275-review-evidence-revision` has its own review and rollback boundary

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: final guidance #1299 is held before merge; use the operator-approved maintenance path without another ART child
- related products or components: Governance Operations Console; WGCF immutable artifact custody
- tracking record: `workspace-governance/reviews/improvement-candidates/2026-10-15-console-capability-operating-truth-regression.yaml`

## Root Cause

- immediate failure: adding completed local CI proof after automatic pre-merge sealing collided with the existing immutable packet key
- actual root cause: the lifecycle explicitly supports changed editable evidence, but packet identity covered source alone; changed proof produced a different digest under the same artifact id
- why it escaped earlier controls: source-head revision tests exercised changed code; evidence-state tests stopped before persistence, and persistence doubles did not enforce immutable-key reuse. Planning also assumed a pause between automatic continuation steps

## Source Changes

- changed workflow, adapter, or contract: existing deterministic identity includes the normalized Landing Unit, evidence and exceptions; local-draft classification uses the same payload. Authoring timestamps and custody are excluded. Existing durable historical packets remain valid, and existing legacy-local-draft reconciliation handles earlier ids
- tests or validator added: normal same-head evidence revision with production-created initial identity and append-only registry enforcement; prior custody preservation and unchanged-proof reuse. The regression failed at the actual immutable-key check before the correction
- related change records: None

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: pending exact committed full CI, provider review, composed Security source acceptance and normal activation
- image tag or digest: pending reviewed build
- runtime revision: current runtime remains at the previous accepted source until commissioning

## Live Verification

- local validation: the controller reproduction fails before the fix and passes afterward; complete native CI remains required before publication
- live or dev-integration verification: original-session evidence revision and native custody readback are required after activation; no operating completion is claimed here
- residual risk: earlier immutable artifacts must remain untouched; finalization supersession is still exclusively post-merge. Authorization, current-source checks, required evidence, exception approval and independent human source review remain enforced

## Follow-Up

- required follow-up: exact source review, Security index and pin refresh, activation, actual original-session revision, then learning closure
- owner: `operator-orchestration-service` with Security acceptance and Platform runtime owners
- due date or closure condition: resolve before #1299 source merge and Epic #1275 final acceptance
