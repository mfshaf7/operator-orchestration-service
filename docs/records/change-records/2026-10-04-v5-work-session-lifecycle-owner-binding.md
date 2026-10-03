---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - contracts/delivery-art-lifecycle/lifecycle-plan.schema.json
    - docs/operations/delivery-workflow-operator-surface.md
    - src/delivery-art/lifecycle-controller.js
    - src/delivery-art/work-session.js
    - test/delivery-art-lifecycle-controller.test.js
    - test/delivery-art-work-session.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "The repair preserves an already-authorized Landing Unit identity across the internal work-session boundary, grants no new authority, and rejects missing, stale, or scope-ambiguous v5 bindings before evidence selection."
---

# 2026-10-04 v5 work-session lifecycle owner binding

## Summary

Preserve the exact Landing Unit identifier when a persistent Delivery ART work
session generates its lifecycle compatibility plan, and fail closed when a
schema-v5 plan carries a missing, stale, or scope-ambiguous evidence owner.

## Classification

- area: Delivery ART work-session lifecycle
- type: defect correction and regression hardening
- runtime impact: normal `work continue` can cross the compatibility-plan handoff for valid v5 sessions; invalid v5 Landing Unit bindings remain blocked

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Defect #1249 under Feature #1211 and Epic #1203; blocker on #1229
- related products or components: Delivery ART persistent work sessions and lifecycle reconciliation

## Root Cause

- immediate failure: #1229 reached worktree preparation, then lifecycle reconciliation raised `delivery_art_conformance_owner_required`
- actual root cause: `buildDeliveryArtLifecycleCompatibilityPlan` omitted the persisted `landing_unit_id`, while the compatibility-plan schema also rejected that property and the v5 evidence selector required it
- why it escaped earlier controls: tests covered work start and lifecycle reconciliation separately but did not assert identity continuity across `work start -> worktree creation -> compatibility-plan serialization -> lifecycle reconcile`

## Source Changes

- changed workflow, adapter, or contract: serialize `landing_unit.id`, admit the optional compatibility field for historical-plan compatibility, and bind v5 plans to one exact architecture Landing Unit with identical coverage
- tests or validator added: focused serializer/schema proof, missing/stale/ambiguous v5 owner rejection, and controller continuation assertions for exact lifecycle identity
- related change records: `docs/records/change-records/2026-10-03-delivery-art-architecture-v5-consumer-support.md`

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: reviewed OOS Landing Unit followed by dev-integration activation and exact #1229 continuation proof
- image tag or digest: Pending merge and activation
- runtime revision: Pending merge and activation

## Live Verification

- local validation: focused lifecycle and work-session tests pass; full CI-equivalent evidence is recorded in the Review Packet before merge
- live or dev-integration verification: Pending merged-revision activation and exact `npm run art -- work continue 1229` proof
- residual risk: historical manually authored lifecycle plans remain schema-valid without `landing_unit.id`, but a v5 architecture binding rejects them before evidence selection

## Follow-Up

- required follow-up: clear the #1229 blocker only after merged-revision activation and successful continuation to `source-work`; close the linked regression candidate with landed control evidence
- owner: Operator Orchestration-Service
- due date or closure condition: before #1229 product implementation resumes
