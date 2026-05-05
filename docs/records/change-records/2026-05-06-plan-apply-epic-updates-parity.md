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
  notes: "Delivery/runtime impact is limited to Workspace Delivery ART plan.apply initiative-governance field parity. No identity, secret, privilege, or governed AI boundary changed."
---

# 2026-05-06 plan.apply Epic updates parity

## Summary

Corrected the Workspace Delivery ART plan-apply path so `epic_updates` carries
the same initiative-governance and lineage fields as the direct initiative
governance route before child planning starts.

## Classification

- area: Workspace Delivery ART broker planning and mutation adapter
- type: workflow contract parity repair
- runtime impact: source-only until the accepted-idea-delivery dev-integration
  broker deployment is rebuilt or restarted from this source

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: `#630` Defect under `#629`
- related products or components: `platform-engineering/products/openproject`,
  `workspace-governance-control-fabric`

## Root Cause

- immediate failure: submitting the governed `#629` CGG activation plan through
  `plan.apply` returned a broker `internal_error`.
- actual root cause: `plan.apply` documented and accepted initiative-level
  `epic_updates`, but the adapter forwarded only a partial subset into
  `updateDeliveryInitiative`; lineage, owner, assignee, and responsible fields
  were dropped before validation and OpenProject mutation.
- why it escaped earlier controls: mutation-draft validation checked payload
  shape and the route contract existed, but there was no regression proving
  implementation parity for full top-level Epic governance fields.

## Source Changes

- changed workflow, adapter, or contract: `applyDeliveryPlan` now forwards
  `architecture_anchor_ref`, `assignee_login`, `initiative_family`,
  `lineage_role`, `owner_repo`, `responsible_login`, and
  `required_upstream_ref` from `epic_updates` into the initiative update path.
- changed workflow, adapter, or contract: initiative-lineage validation errors
  now surface as broker `validation_failure` responses with
  `initiative-lineage-state-invalid` details instead of unclassified internal
  errors.
- tests or validator added: regression tests cover the `#629`-shaped
  `plan.apply` payload and assert both full field forwarding and fail-closed
  validation classification.
- related change records: None.

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only at PR time;
  live dev-integration rollout is required before retrying `#629` plan submit.
- image tag or digest: None.
- runtime revision: None before dev-integration redeploy.

## Live Verification

- local validation:
  - PASS: `node --test test/openproject-client.test.js`.
  - PASS: `npm test`.
  - PASS: `npm run validate:api-docs`.
  - PASS: `npm run validate:governance-docs`.
  - PASS: `git diff --check`.
- live or dev-integration verification:
  - PASS: live OpenProject form schema for `#629` reports `status`,
    `assignee`, `responsible`, `PM² Phase`, `Owner Repo`, `Initiative Family`,
    `Lineage Role`, `Architecture Anchor Ref`, `Required Upstream Ref`, and
    `Target PI` as writable.
  - PASS: live OpenProject form `allowedValues` expose status `in-progress`,
    PM² Phase `Executing`, Initiative Family `governed-ai-control-plane`, and
    Lineage Role `bounded-activation`.
  - PASS: live assignable-principal proof exposes `Workspace Governance` for
    the top-level `#629` assignment fields.
  - PENDING: accepted-idea-delivery dev-integration broker redeploy and retry
    of the `#629` plan submit.
- residual risk: until the dev-integration broker deployment is refreshed from
  this source, the live `plan.apply` route still uses the old partial forwarding
  behavior.

## Follow-Up

- required follow-up: merge and deploy the broker repair before resubmitting
  the `#629` CGG activation plan.
- owner: `operator-orchestration-service`
- due date or closure condition: `#630` completion and successful `#629`
  plan submit through the refreshed dev-integration broker.
