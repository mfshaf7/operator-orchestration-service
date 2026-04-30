---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - src/art-cli.js
    - src/openproject-client.js
    - docs/contracts/delivery-workflow-api-v1.md
    - docs/operations/delivery-workflow-operator-surface.md
    - test/art-cli.test.js
    - test/openproject-client.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "Delivery/runtime impact is limited to ART broker projection-checkpoint behavior and plan.apply response evidence; no deployed identity, secret, privilege, or model boundary changed."
---

# 2026-04-30 plan apply projection checkpoint

## Summary

Preserved plan.apply per-item roadmap projection evidence and taught the ART CLI
to mark dirty projection state from nested plan.apply child results.

## Classification

- area: delivery ART operator workflow
- type: defect fix / operator-control hardening
- runtime impact: source change requiring dev-integration broker restart after merge

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: `#481 Defect: Mark plan.apply projection drift in broker checkpoint`
- related products or components: `Workspace Delivery ART`, OpenProject adapter

## Root Cause

- immediate failure: plan.apply child writes could receive roadmap projection
  drift from OpenProject, but the plan.apply result discarded the child-level
  projection evidence before the CLI checkpoint could see it.
- actual root cause: projection checkpoint coverage was added for direct
  mutation response bodies before plan.apply response composition preserved the
  nested create/update evidence needed by that checkpoint.
- why it escaped earlier controls: tests covered direct broker mutation and
  managed draft submit parity, but did not cover plan.apply child summaries
  carrying nested `roadmap_version_projection` reports.

## Source Changes

- changed workflow, adapter, or contract: plan.apply created entries now carry
  `creation_applied`, updated entries now carry `changes_applied`, and the CLI
  derives affected work-item ids from nested projection reports.
- tests or validator added: plan.apply response metadata assertions and a
  draft-submitted plan.apply projection checkpoint regression test.
- related change records:
  `2026-04-30-art-projection-checkpoint.md`,
  `2026-04-30-draft-submit-control-parity.md`

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-backed ART defect
  remediation; merge and any dev-integration restart evidence will be recorded
  in the #481 Review Packet and completion evidence.
- image tag or digest: None.
- runtime revision: pending merge.

## Live Verification

- local validation: pending.
- live or dev-integration verification: pending post-merge broker restart if
  the active dev-integration broker is used for subsequent ART mutations.
- residual risk: none known before validation; checkpoint state remains local
  to the operator CLI until the future control-fabric runtime owns it.

## Follow-Up

- required follow-up: complete #481 with finalized Review Packet evidence and
  verify projection checkpoint state remains visible through `npm run art --
  projection status`.
- owner: `operator-orchestration-service`
- due date or closure condition: before resuming the next #420 ART front.
