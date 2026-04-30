---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - src/work-item-create-preflight.js
    - test/art-workflow-artifacts.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "Delivery/runtime impact is limited to local and broker-side ART plan.apply draft preflight validation. No deployed identity, secret, or privilege boundary changed."
---

# 2026-04-30 plan apply draft preflight parity

## Summary

Aligned `initiative.plan.apply` draft validation with the live broker contract
so malformed plan items fail locally before a submit reaches OpenProject-backed
mutation handling.

## Classification

- area: delivery ART broker workflow
- type: defect fix / mutation draft preflight hardening
- runtime impact: local ART draft validation and broker plan-apply preflight

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: `#477`
- related products or components: `Workspace Delivery ART`

## Root Cause

- immediate failure: local plan.apply draft validation accepted payloads that
  live submit rejected for unsupported snake-case actor keys and ready User
  story execution-contract gaps.
- actual root cause: `validatePlanApplyInput` only preflighted active PI
  Objective creation and did not reuse the supported plan-item key contract or
  ready leaf execution/narrative requirements.
- why it escaped earlier controls: the draft validator was narrower than the
  live broker path, and the change-record requirement check was initially run
  before the source commit existed, so it did not compare the final PR diff.

## Source Changes

- changed workflow, adapter, or contract: plan.apply mutation draft validation
  now rejects unsupported item keys and validates ready User story and Defect
  items through the create preflight contract before live submit.
- tests or validator added: regression tests cover snake-case actor-key
  rejection, ready User story required fields/narrative rejection, and a valid
  ready User story payload.
- related change records: this file

## Artifact And Deployment Evidence

- source-only change; no image, deployment, or runtime revision was produced
- image tag or digest: `None`
- runtime revision: `None`

## Live Verification

- local validation: `node --test test/art-workflow-artifacts.test.js`
- local validation: `npm test`
- local validation: `npm run validate:openproject-mutation-contracts`
- local validation: `npm run validate:change-record-requirement`
- local validation: `git diff --check`
- live or dev-integration verification: PR #89 CI runs the same broker unit and
  governance validators before merge.
- residual risk: the ready leaf parity guard is scoped to `User story` and
  `Defect`, which are the leaf types observed in the #435/#436 planning
  failure; broader plan-item type parity can be expanded if another concrete
  live-submit mismatch is observed.

## Follow-Up

- required follow-up: record the broader workflow-control miss in the
  workspace-governance self-improvement lane so future validation checks run
  against committed PR diff state, not pre-commit working-tree assumptions.
- owner: `workspace-governance`
- due date or closure condition: improvement candidate recorded and triaged
  before #420 continues past the #477 blocker.
