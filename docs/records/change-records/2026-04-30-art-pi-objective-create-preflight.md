---
security_evidence:
  review_areas:
    - delivery
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-04-30 ART PI Objective Create Preflight

## Summary

Added a deterministic local preflight for delivery work-item create payloads so
active PI Objective narrative and execution-field failures are caught before a
live broker mutation attempt.

## Classification

- area: delivery workflow
- type: operator-surface hardening
- runtime impact: local validation and API probe behavior only

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice:
  - `#420` `Build Workspace Governance Control Fabric foundation for scalable validation, evidence, and admission`
  - `#470` `Defect: Add PI Objective create preflight and validation-error surfacing`

## Root Cause

The broker create route already enforced the active execution narrative
contract, but operators had no local work-item create preflight equivalent to
completion-evidence validation. A PI Objective create payload could therefore
reach the live broker before missing `Outcome`, `Why This PI`, `Success Signal`,
and `Execution Context` sections were caught. The probe helper also hid the
response body when a live status was not documented by the OpenAPI contract.

## Source Changes

- added reusable create-payload preflight logic:
  - `src/work-item-create-preflight.js`
- exposed the local validator:
  - `scripts/validate_work_item_create.mjs`
  - `package.json`
- wired mutation-draft validation to the same preflight:
  - `src/art-workflow-artifacts.js`
- made probe failures print undocumented live response status and body:
  - `scripts/probe_api_contract.mjs`
- documented create validation failure and the operator preflight:
  - `docs/api/openapi.json`
  - `docs/contracts/delivery-workflow-api-v1.md`
  - `docs/operations/delivery-workflow-operator-surface.md`

## Artifact And Deployment Evidence

- source-level broker/operator tooling change only
- no governed runtime promotion in this slice

## Live Verification

- local tests cover invalid and valid active PI Objective create payloads
- local mutation-draft tests cover the same semantic guard for
  `work-item.create`
- API docs validation covers the documented `422` response

## Follow-Up

- complete #470 only after the branch is merged and the Review Packet maps the
  source-backed evidence to the defect
