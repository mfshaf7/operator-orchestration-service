# 2026-05-05 ART PI lifecycle iteration guard

## Summary

Added a lightweight PI lifecycle and iteration-alignment guard for Workspace
Delivery ART broker writes. PI creation remains driven by planning horizon,
carryover, or current-PI closure, not item volume.

## Classification

- area: Workspace Delivery ART broker planning and mutation guards
- type: workflow contract hardening
- runtime impact: source-only until the broker image is rebuilt or devint is
  redeployed

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: `#613` PI Objective, `#614` Feature, `#615` platform
  owner story, `#616` broker owner story, `#617` WGCF owner story, and `#618`
  workspace-governance owner story under reopened `#498`
- related products or components: `platform-engineering/products/openproject`,
  `workspace-governance-control-fabric`

## Root Cause

- immediate failure: operators could ask whether a large item count meant a new
  PI was required without a machine-readable lifecycle rule.
- actual root cause: existing guards enforced `Target PI`, `Iteration`, and PI
  Objective presence, but not whether the iteration label belonged to the same
  PI or an accepted program-wide planning lane.
- why it escaped earlier controls: roadmap `version` projection and
  `allowedValues`/form schema checks proved field writability and projection,
  not lifecycle interpretation.

## Source Changes

- changed workflow, adapter, or contract: added `pi_lifecycle` to the broker
  planning workflow mirror and exposed it in continuation context for WGCF ART
  readiness.
- tests or validator added: regression tests reject `Target PI = PI-2026-03`
  with `Iteration = PI-2026-02 / Iteration 1`, while allowing
  `Program-wide / planning`.
- related change records: platform OpenProject contract change in the matching
  landing unit.

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only; no live form
  `allowedValues`, form schema, `PropertyIsReadOnly`, writable/read-only, or
  `roadmap_version_projection` behavior changed.
- image tag or digest: None.
- runtime revision: None.

## Live Verification

- local validation:
  - PASS: `npm test` completed all 13 Node test files successfully.
  - PASS:
    `python3 scripts/validate_openproject_mutation_contracts.py --repo-root . --changed-file src/delivery-planning-workflow.json --changed-file test/openproject-client.test.js --changed-file docs/records/change-records/2026-05-05-art-pi-lifecycle-iteration-guard.md --changed-file docs/operations/delivery-workflow-operator-surface.md`
    accepted the mutation-contract evidence.
- live or dev-integration verification:
  - PASS: broker `initiative.plan.apply` created the governed ART tracking
    slice #613-#618 through draft validation and draft submit.
  - PASS: broker projection sync cleared the roadmap dirty checkpoint for
    #613-#618.
  - PASS: WGCF delivery-art scoped receipt
    `control-receipt:29d76942ee23c573f8f096c5` selected
    `delivery-art-broker-read` and `openproject-quality-check`; both checks
    succeeded within the 120-second hard-gate budget.
- residual risk: existing historical done items are not backfilled; the guard
  applies to new/active committed work.

## Follow-Up

- required follow-up: deploy through the accepted-idea-delivery devint profile
  before relying on the new broker-side guard in the live OOS runtime.
- owner: Operator Orchestration Service
- due date or closure condition: before relying on the guard as live runtime
  behavior.
