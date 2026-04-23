---
security_evidence:
  review_areas:
    - runtime
    - delivery
  workstreams:
    - WS-007
  reviewed_artifacts:
    - src/openproject-client.js
    - src/delivery-service.js
    - src/app.js
    - docs/contracts/delivery-workflow-api-v1.md
    - docs/operations/delivery-workflow-operator-surface.md
  notes: "Adds a read-only broker resumption surface on the existing caller-auth seam."
---

# 2026-04-23 broker continuation context helper

## Summary

Added a broker-owned continuation-context read for ART work items so active
delivery can resume from one bounded packet instead of scanning the full
initiative execution summary by hand. The broker now returns target-item
context, parent chain, related open siblings, previously completed related
items, and target dependency context behind the normal delivery read path.

## Classification

- owner repo: `operator-orchestration-service`
- related control planes:
  - `workspace-governance`
- trust-boundary areas:
  - runtime
  - delivery

## Ownership

- broker delivery read model and caller-auth seam:
  `operator-orchestration-service`
- ART resumption workflow doctrine and installed skills:
  `workspace-governance`

## Root Cause

Active ART continuation was still too dependent on manual reconstruction from
large planning and execution-summary payloads. The existing broker could expose
that truth, but it lacked a bounded resumption read that returned only the
target work item, its parent chain, nearby open work, and the already-finished
related items that matter when a session resumes.

## Source Changes

- added `GET /v1/delivery-work-items/{work_item_id}/continuation-context`
  through `src/app.js`, `src/delivery-service.js`, and
  `src/openproject-client.js`
- composed the continuation packet from the existing delivery-project state so
  the broker stays workflow-shaped instead of becoming a raw OpenProject proxy
- updated the delivery workflow API contract, operator surface, and repo README
- added test coverage for the new broker projection and HTTP route

## Artifact And Deployment Evidence

- no new artifact family or deployment lane was introduced
- the continuation helper rides the existing broker runtime and caller-auth
  seam in the active `accepted-idea-delivery` devint profile

## Live Verification

- `node --test`
- `python3 scripts/validate_governance_docs.py --repo-root .`
- `python3 scripts/validate_change_record_requirement.py --repo-root . --changed-file src/openproject-client.js --changed-file src/delivery-service.js --changed-file src/app.js --changed-file docs/contracts/delivery-workflow-api-v1.md --changed-file docs/operations/delivery-workflow-operator-surface.md --changed-file README.md --changed-file docs/records/change-records/2026-04-23-broker-continuation-context-helper.md`
- live broker read proof against `delivery-38` in the active
  `accepted-idea-delivery` devint profile

## Follow-Up

- keep the ART skill aligned with the continuation-context route so future
  sessions resume from the bounded packet instead of falling back to manual
  execution-summary scanning
- extend the same continuation pattern to additional broker-owned workflow
  surfaces only if the active ART resume path proves too narrow in practice
