---
security_evidence:
  review_areas:
    - runtime
    - delivery
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-04-25 ART Plan-Apply Deferred Classification Fix

## Summary

Corrected the broker create and `plan/apply` paths so delivery work can still be
created when the live OpenProject create form omits `Execution Classification`,
while avoiding false classification writes for structural types such as
`PI Objective`.

## Classification

- area: delivery workflow
- type: defect correction
- runtime impact: bounded broker ART create and planning paths

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice:
  - `#247` `Apply the extraction gate and, if justified, extract a standalone governance engine`
  - `#337` `Defect: Execution-classification create writes fail when OpenProject create forms omit the field`

## Root Cause

The broker assumed `Execution Classification` would always be present in the
initial OpenProject create form. Live `#247` decomposition proved that was not
always true. The create and `plan/apply` paths therefore failed when the field
was omitted, and separate code paths also carried an `executionClassification`
property with a null value into structural types that do not support that field.

## Source Changes

- added deferred create-field handling and merged form-schema validation for
  broker create and plan-apply flows:
  - `src/openproject-client.js`
- added regression coverage for deferred classification create and plan-apply
  behavior:
  - `test/openproject-client.test.js`

## Artifact And Deployment Evidence

- local broker code and regression update only
- devint broker was restarted from the mounted workspace checkout to prove the
  live fix before ART repair

## Live Verification

- local regression coverage now proves:
  - `createDeliveryWorkItem` defers classification when the create form omits it
  - `applyDeliveryPlan` defers classification when the create form omits it
  - structural types no longer attempt null classification writes
- live `#247` plan apply succeeded after the fix and created:
  - `#338`
  - `#339`
  - `#340`
  - `#341`
  - `#342`
  - `#343`
  - `#344`

## Follow-Up

- land the broker branch and then close `#337` through the supported work-item
  completion path with merged-code evidence
