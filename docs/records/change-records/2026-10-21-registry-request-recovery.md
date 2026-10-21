---
security_evidence:
  review_areas: [delivery, runtime]
  workstreams: [WS-007]
  reviewed_artifacts:
    - docs/reviews/components/2026-10-15-governance-console-platform-operation.md
  notes: Existing caller-bound Inventory request discovery; no new mutation authority.
---

# 2026-10-21 Registry original-request discovery

## Summary

Extend the existing Promotion and Lifecycle services with read-only, bounded
caller/target/family discovery so the Console can recover original requests
after restart or lost acknowledgement. No new workflow or ART child.

## Classification

- area: existing Workspace Inventory adapters.
- type: approved1298 maintenance, source-change.
- runtime impact: exact OOS/Console source reacceptance and commissioning.
- Landing Unit: maintenance-1275-registry-request-recovery,
  child_isolated_landing_unit for the OOS review/rollback boundary.

## Ownership

- owner repo: `operator-orchestration-service`.
- related ART slice: Epic1275/qualification1298, existing operating-truth candidate.
- related products or components: Console adapter, WG canonical Inventory,
  WGCF readiness, Platform composition and Security acceptance.

## Root Cause

- immediate failure: promotion UI cannot check review-required and cannot
  rediscover acknowledged requests; lifecycle actions work but discovery is absent.
- actual root cause: backend read/continue/cancel exist, but no retained list
  feeds cold adapters. Browser-only result was mistaken for durable recovery.
- why it escaped earlier controls: previous evidence checked API/source readiness,
  not actual operator completion and cold reconstruction at the next live seam.

## Source Changes

- changed workflow, adapter, or contract: existing store/service GET discovery,
  authenticated routes and generated OpenAPI. Primitive locators only, max25
  rows/32KiB, opaque caller/family/target cursor, total pending count and revision.
- tests or validator added: real persistent-store restart and no-write proof,
  auth/target/family isolation, pagination/offpage pending, corruption denial,
  original acknowledgement replay and HTTP selector validation.
- related change records: existing composed Console decision; generated actual
  owner index follows this source merge before completion.

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: committed full local
  CI-equivalent and actual PR checks required before exact human merge.
- image tag or digest: actual accepted composition after ordered source landing.
- runtime revision: not inferred from this change record or unit tests.

## Live Verification

- local validation: focused protocol/store/HTTP proof plus complete owner checks.
- live or dev-integration verification: actual Console Inventory with retained
  original ID and cold browser reconstruction after normal commissioning.
- residual risk: public synthetic local lane only; no new user/secret/merge
  authority. Existing generic mutation/idempotency/concurrency semantics remain.

## Follow-Up

- required follow-up: Console consumer, exact Security decision/index, normal
  commissioning and actual same-product Inventory witness.
- owner: mfshaf7.
- due date or closure condition: before qualification1298 closes.
