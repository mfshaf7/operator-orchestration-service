---
security_evidence:
  review_areas:
    - runtime
    - delivery
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-04-22 Delivery Initiative Governance and Plan Apply Brokerization

## Summary

The broker now owns the bounded delivery-initiative command slice for
`POST /v1/delivery-initiatives/{delivery_id}/governance` and
`POST /v1/delivery-initiatives/{delivery_id}/plan/apply`.

The governance route is initiative-only and keeps PM² and related fields on
the top-level delivery Epic. The plan-apply route reuses and updates existing
nodes by parent/type/subject, preserves readiness validation, and keeps the
reconcile behavior for `ignore`/`park` plus `retire`/`defer`.

## Classification

- owner repo: `operator-orchestration-service`
- related control planes:
  - `platform-engineering`
- trust-boundary areas:
  - runtime
  - delivery

## Ownership

- broker route, request validation, audit, and OpenProject adapter logic:
  `operator-orchestration-service`
- operator wrapper and canonical OpenProject runtime/schema ownership:
  `platform-engineering`

## Why

- #67 needed a bounded delivery-initiative governance update surface without
  turning the broker into generic OpenProject CRUD
- #70 needed plan/apply behavior that can reuse existing live nodes and
  reconcile missing items without disposable ART scope
- this repo already owns the broker workflow seam and the OpenProject adapter
  code path

## Root Cause

The delivery-plane migration had stopped one step short of the initiative
command surface. The broker already owned delivery execution reads and
work-item commands, but top-level governance updates and plan reconciliation
still needed to move behind the broker boundary with bounded semantics.

## Scope

- added initiative-only governance handling for:
  - `status`
  - `target_pi`
  - `pm2_phase`
  - `sponsor`
  - `business_objective`
  - `success_criteria`
  - `system_demo_evidence`
  - `inspect_and_adapt_actions`
  - `nfr_category`
  - `description`
- added plan apply handling that:
  - reuses existing nodes by `parent + type + subject`
  - updates existing nodes when fields differ
  - validates ready items before publish
  - preserves retire/defer and park/ignore reconcile semantics
- updated the broker audit events and interface manifest
- updated repo docs and the delivery workflow contract

## Source Changes

- added `POST /v1/delivery-initiatives/{delivery_id}/governance`
- added `POST /v1/delivery-initiatives/{delivery_id}/plan/apply`
- added broker-side target PI handling for delivery initiative updates
- added reuse/update/reconcile semantics for existing plan nodes
- added audit events, docs, and repo-local tests for the new workflow slice

## Artifact And Deployment Evidence

- local source change only
- no image rebuild or runtime rollout was needed for this repo-local slice

## Live Verification

- `npm test`
- `node --check src/app.js`
- `node --check src/delivery-service.js`
- `node --check src/openproject-client.js`
- `python3 scripts/validate_governance_docs.py --repo-root .`
- `python3 scripts/validate_change_record_requirement.py --repo-root . --against-ref origin/main`
- `git diff --check`

## Follow-Up

- land the dependent delivery proof for #67/#70 in the live ART lane using the
  broker-owned governance and plan-apply routes
- keep future delivery command expansion bounded to initiative/work-item
  surfaces instead of generic OpenProject CRUD
