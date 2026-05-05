---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - src/delivery-taxonomy.js
    - test/work-item-create-preflight.test.js
    - packages/control_fabric_core/src/control_fabric_core/art_readiness.py
    - tests/test_art_readiness.py
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "Delivery/runtime impact is limited to Workspace Delivery ART Feature narrative validation and WGCF pre-mutation readiness. No identity, secret, privilege, model invocation, raw-context projection, or governed AI boundary changed."
---

# 2026-05-06 Feature Closeout Narrative Contract

## Summary

Align the ART Feature open-state and closeout-state narrative contracts so parent Feature closeout readiness is enforced before the last executable child is completed.

## Classification

- area: Workspace Delivery ART broker workflow
- type: defect remediation
- runtime impact: affects broker validation and WGCF readiness used before ART completion mutations

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: `#629`, `#648`
- related products or components: `Workspace Delivery ART`, `workspace-governance-control-fabric`

## Root Cause

- immediate failure: #641 was accepted as a ready Feature without `Evidence Expectation` and `Operator work notes`, then WGCF blocked stale-open closeout for the same missing headings.
- actual root cause: OOS active Feature narrative requirements did not match the WGCF Feature closeout heading contract, and WGCF checked the target item but not the parent Feature before last-child completion.
- why it escaped earlier controls: child completion evidence preflight and Review Packet validation did not prove parent Feature closeout readiness before the final child mutation.

## Source Changes

- changed workflow, adapter, or contract: OOS now requires closeout-ready Feature headings in the active Feature narrative contract, and WGCF blocks last-child completion when the parent Feature is not closeout-ready.
- tests or validator added: OOS work-item create preflight tests cover active Feature closeout-ready headings; WGCF ART readiness tests cover last-child parent Feature blocking and non-last-child allowance.
- related change records: None.

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only pending PR merge and ART Review Packet finalization.
- image tag or digest: None.
- runtime revision: None.

## Live Verification

- local validation: `npm test`, `npm run validate:api-docs`, `npm run validate:change-record-requirement`, `npm run validate:governance-docs`, `git diff --check`; WGCF `python -m unittest discover -s tests`, `scripts/validate_project.py`, and `git diff --check`.
- live or dev-integration verification: Pending after source merge and active broker/WGCF path refresh.
- residual risk: Existing active Features created before this fix can still need one-time narrative repair, but future active Feature creation and last-child completion are gated.

## Follow-Up

- required follow-up: Close ART Defect #648 with merged source evidence and sync the dirty roadmap projection checkpoint.
- owner: `Operator Orchestration-Service`
- due date or closure condition: before resuming #629 final closeout.
