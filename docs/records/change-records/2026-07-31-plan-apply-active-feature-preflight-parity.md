---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - src/work-item-create-preflight.js
    - test/art-workflow-artifacts.test.js
    - docs/contracts/delivery-workflow-api-v1.md
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "Delivery/runtime impact is limited to pre-mutation validation of active Feature entries in ART plan.apply drafts. No identity, secret, privilege, model-invocation, or governed runtime boundary changed."
---

# 2026-07-31 Plan Apply Active Feature Preflight Parity

## Summary

Align `initiative.plan.apply` draft validation with the active Feature
narrative contract so malformed Features fail before OpenProject mutation.

## Classification

- area: Workspace Delivery ART broker workflow
- type: defect remediation
- runtime impact: managed draft and broker plan-apply preflight validation

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: `#775`
- related products or components: Workspace Delivery ART

## Root Cause

- immediate failure: a plan draft accepted the initial active Feature shape for
  #773 even though scoped ART quality rejected its missing narrative headings.
- actual root cause: plan-item validation reused the full create preflight for
  active PI Objectives and ready leaf work, but skipped active Features.
- why it escaped earlier controls: the active Feature create contract had unit
  coverage in isolation, while plan-apply draft parity lacked the equivalent
  regression.

## Source Changes

- changed workflow, adapter, or contract: active Feature plan entries now pass
  through the existing work-item create preflight before mutation.
- tests or validator added: regressions cover the incomplete #773-shaped
  Feature and a complete active Feature.
- related change records:
  `2026-04-30-plan-apply-draft-preflight-parity.md` and
  `2026-05-06-feature-closeout-narrative-contract.md`

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation: focused preflight and mutation-draft tests plus the full
  repository validation suite
- live or dev-integration verification: not required; the correction fails
  locally before any backend mutation
- residual risk: other plan-item types continue to use their existing,
  explicitly scoped preflight rules

## Follow-Up

- required follow-up: finalize Review Packet evidence and close ART Defect #775
- owner: Operator Orchestration-Service
- due date or closure condition: merged source evidence covers #775
