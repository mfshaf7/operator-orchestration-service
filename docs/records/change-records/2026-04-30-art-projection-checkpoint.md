---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - src/art-cli.js
    - docs/operations/delivery-workflow-operator-surface.md
    - docs/contracts/delivery-workflow-api-v1.md
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "Delivery/runtime impact is limited to the local ART operator CLI checkpoint; no deployed service runtime, identity, secret, or privilege boundary changed."
---

# 2026-04-30 ART projection checkpoint

## Summary

Added a broker-owned projection checkpoint so ART mutations that need external
roadmap reconciliation mark local dirty state instead of forcing operators to
remember when to run expensive view sync.

## Classification

- area: delivery ART operator workflow
- type: defect fix / operator-control hardening
- runtime impact: local ART CLI behavior; no service API route or deployed
  runtime shape changed

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: `#472`
- related products or components: `platform-engineering/products/openproject`

## Root Cause

- immediate failure: projection sync was being run after each child closeout
  because there was no broker-visible dirty/checkpoint state.
- actual root cause: the platform sync step was documented as mandatory after
  projection-affecting mutations, but the OOS operator CLI did not record when
  OpenProject returned `external_reconciler_required`.
- live form contract evidence: the current OpenProject work-package form can
  return `roadmap_version_projection.status=external_reconciler_required` with
  `reason=version_field_read_only`; the broker must keep the canonical work
  mutation and route derived `version` repair to the platform sync surface.
- why it escaped earlier controls: workflow-health and scoped quality could
  detect drift, but they did not provide a cheap pre-quality checkpoint that
  made batching safe.

## Source Changes

- changed workflow, adapter, or contract: `src/art-cli.js`,
  `src/delivery-planning-workflow.json`, delivery workflow docs, and platform
  OpenProject planning guidance
- tests or validator added: `test/art-cli.test.js`
- related change records: this file

## Artifact And Deployment Evidence

- source-only change; no image, deployment, or runtime revision was produced
- image tag or digest: `None`
- runtime revision: `None`

## Live Verification

- local validation: `node --test test/art-cli.test.js`
- live or dev-integration verification: pending PR landing and #472 completion
  evidence
- residual risk: projection sync still calls the platform-owned OpenProject
  admin surface; this change governs when operators run it, not the underlying
  sync implementation

## Follow-Up

- required follow-up: none for this defect; future control-fabric work can move
  the dirty-state ledger into the runtime fabric when that system is ready
- owner: `operator-orchestration-service`
- due date or closure condition: #472 done with Review Packet evidence
