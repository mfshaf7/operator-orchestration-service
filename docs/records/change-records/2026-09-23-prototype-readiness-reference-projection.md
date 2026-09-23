---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - src/delivery-ingress/prototype-application-model.js
    - test/prototype-delivery-application.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "The durable Delivery event now receives only the contract-owned URI and digest from the WGCF readiness reference."
---

# Prototype Readiness Reference Projection

## Summary

Prototype-to-Delivery application events now project the WGCF readiness receipt
reference into the exact durable contract shape instead of copying
client-internal parsing metadata.

## Classification

- area: Prototype-to-Delivery ingress
- type: runtime defect correction
- runtime impact: configured Console ingress can create its Delivery target

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Epic #892, work item #1151
- related components: WGCF readiness client and Prototype Delivery application

## Root Cause

- immediate failure: the application event failed schema validation because
  `readiness.receipt_ref` contained an additional `token` field
- actual root cause: the durable event copied the readiness client's internal
  parsed reference instead of projecting the public reference contract
- why it escaped earlier controls: application tests used the public reference
  shape and did not include the internal parser token returned by the live client

## Source Changes

- changed workflow, adapter, or contract: the event projection emits only
  `uri` and `digest`; the external contract is unchanged
- tests or validator added: regression coverage includes and excludes the
  client-internal token at the durable boundary
- related change records: None

## Artifact And Deployment Evidence

- source change: pull request #223
- image tag or digest: pending merge
- runtime revision: pending merge

## Live Verification

- local validation: focused Prototype Delivery tests pass and Delivery ingress
  OpenAPI schemas remain synchronized
- live or dev-integration verification: replay the existing #1151 configured
  Console ingress after deployment
- residual risk: none beyond the existing fail-closed event schema validation

## Follow-Up

- required follow-up: complete the #1151 Console Closure proof
- owner: Agent Gary
- closure condition: the configured Console records the Delivery ingress and
  subsequent Closure evidence

## Rollback

Revert the projection and regression test together. The external schema and
existing stored events are unchanged.
