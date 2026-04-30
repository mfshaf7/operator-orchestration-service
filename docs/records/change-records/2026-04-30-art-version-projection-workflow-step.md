---
security_evidence:
  review_areas:
    - delivery
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-04-30 ART Version Projection Workflow Step

## Summary

Codified version-projection reconciliation as a required delivery workflow step
after any ART mutation that can change OpenProject roadmap `version`
projection.

## Classification

- area: delivery workflow
- type: operator workflow doctrine
- runtime impact: documentation and planning-workflow metadata only

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice:
  - `#420` `Build Workspace Governance Control Fabric foundation for scalable validation, evidence, and admission`
  - `#426` `Enabler: Define the control-fabric architecture, operating model, and threat boundary`

## Root Cause

The existing workflow knew that `Target PI` is canonical and `version` is a
derived roadmap projection, but operator guidance still let projection repair be
discovered after the quality gate. That made normal projection reconciliation
look like an unexpected gap when the plan/apply workflow committed #426-#429
and OpenProject required platform view sync before roadmap projection became
truthful.

## Source Changes

- updated the broker planning workflow mirror:
  - `src/delivery-planning-workflow.json`
- documented projection reconciliation as a normal post-mutation workflow step:
  - `docs/contracts/delivery-workflow-api-v1.md`
  - `docs/operations/delivery-workflow-operator-surface.md`
- repaired the change-record template and validator so future OOS records start
  from the required closure heading shape instead of a stale template:
  - `docs/records/change-records/TEMPLATE.md`
  - `scripts/validate_governance_docs.py`

## Artifact And Deployment Evidence

- source-level workflow doctrine and governance-template guard change only
- no governed runtime promotion in this slice
- live form contract evidence: broker writes canonical `Target PI`; roadmap
  `version` projection can be read-only or otherwise not immediately writable
  through the broker mutation form, so platform view sync remains the supported
  projection repair path after projection-affecting ART mutations

## Live Verification

- #426-#429 were committed through broker `initiative.plan.apply`
- platform view sync reconciled four roadmap `version` projections into
  `PI-2026-03`
- scoped ART quality for #420 passed afterward with `issue_count=0` and
  `roadmap_projection_drift_count=0`

## Follow-Up

- keep the platform OpenProject planning workflow and workspace ART operator
  skill synchronized with this rule
