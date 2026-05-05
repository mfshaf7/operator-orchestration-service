---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - src/openproject-client.js
    - test/openproject-client.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "Delivery/runtime impact is limited to OpenProject create-form handling for Workspace Delivery ART plan.apply and work-item create. No identity, secret, privilege, or governed AI boundary changed."
---

# 2026-05-06 plan.apply optional create fields

## Summary

Made delivery work-item creation form-aware for optional custom fields. Required
execution-contract fields still fail closed when absent or non-writable, while
optional fields absent from a type-specific OpenProject create form are
suppressed explicitly in broker evidence instead of crashing the plan.

## Classification

- area: Workspace Delivery ART broker planning and mutation adapter
- type: workflow contract parity repair
- runtime impact: source-only until the accepted-idea-delivery dev-integration
  broker deployment is rebuilt or restarted from this source

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: `#644` Defect under `#629`
- related products or components: `platform-engineering/products/openproject`,
  `workspace-governance-control-fabric`

## Root Cause

- immediate failure: after the `#630` plan.apply fix was merged and deployed,
  retrying the `#629` plan created `#631` through `#643` but failed before the
  milestone and risks with `backend_contract_drift`.
- actual root cause: the plan carried `Acceptance Criteria`,
  `Definition of Ready`, and `Definition of Done` for a `Milestone`, but the
  live OpenProject `Milestone` create form correctly exposes only owner,
  delivery team, iteration, Target PI, status, type, assignee, and responsible
  fields.
- why it escaped earlier controls: tests covered deferred fields such as
  execution classification and covered executable work-item create forms, but
  did not cover optional planning narrative fields on non-execution types.

## Source Changes

- changed workflow, adapter, or contract: create-form handling now checks
  whether a missing or non-writable custom field is required for the item type
  and active status before failing closed.
- changed workflow, adapter, or contract: optional missing or non-writable
  fields are recorded under `suppressed_custom_fields` with field name, input
  name, type, status, and suppression reason.
- tests or validator added: regression coverage proves a Milestone plan item
  with optional narrative fields creates successfully when the live form omits
  those fields, while broker evidence records the suppressed fields.
- related change records:
  - `2026-05-06-plan-apply-epic-updates-parity.md`

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only at PR time;
  live dev-integration rollout is required before retrying the remaining `#629`
  plan submit.
- image tag or digest: None.
- runtime revision: None before dev-integration redeploy.

## Live Verification

- local validation:
  - PASS: `node test/openproject-client.test.js`.
- live or dev-integration verification:
  - PASS: live OpenProject form schema for `Milestone` under `#629` exposes
    `Owner Repo`, `Delivery Team`, `Iteration`, `Target PI`, `status`, `type`,
    `assignee`, and `responsible` as writable.
  - PASS: the same live `Milestone` create form does not expose
    `Acceptance Criteria`, `Definition of Ready`, or `Definition of Done`,
    proving those fields are optional for this type-specific create shape.
  - PENDING: accepted-idea-delivery dev-integration broker redeploy and retry
    of the `#629` plan submit to create the remaining milestone/risk records.
- residual risk: until the dev-integration broker deployment is refreshed from
  this source, live `plan.apply` can still stop on optional create-form field
  absence.

## Follow-Up

- required follow-up: merge and deploy the broker repair, retry the `#629` plan,
  then close `#630` and `#644` with Review Packet evidence.
- owner: `operator-orchestration-service`
- due date or closure condition: `#644` completion and successful creation or
  reuse of the remaining `#629` milestone/risk records through the broker.
