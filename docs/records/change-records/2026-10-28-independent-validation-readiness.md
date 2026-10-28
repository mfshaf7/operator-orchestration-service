---
security_evidence:
  review_areas: [runtime, delivery]
  reviewed_artifacts:
    - src/orchestration/workflow-contracts.js
    - docs/operations/durable-orchestration-operator-surface.md
  findings: []
  risks: []
  workstreams: [WS-007]
  notes: Preserve actual independent WGCF owner outcomes, exact request and receipt bindings, and fail-closed readiness. No new execution authority. Exact composed Security source acceptance precedes activation.
---

# Preserve independent validation and repository readiness outcomes

## Summary

Retain the genuine WGCF validation receipt when validation fails while the
independent repository readiness evaluation passes. The aggregate stays blocked.

## Classification

- area: bounded durable orchestration result handling
- type: approved maintenance of the operating-verification blocker
- runtime impact: preserve independently evaluated owner evidence

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: operating verification, work item 1346
- related components: existing WGCF activity and Console run projection

## Root Cause

- immediate failure: a genuine failed validation and ready repository decision were projected as a generic contract rejection
- actual root cause: OOS required all non-ready aggregate results to contain blocked repository readiness, although WGCF evaluates the two independently
- why it escaped earlier controls: consumer tests required that assumption while producer tests already exercised the mixed outcome

## Source Changes

Validate readiness outcome and reason count independently. Non-ready results
must still contain failed validation or blocked readiness. Preserve all exact
binding checks, receipt integrity, terminal semantics and the stronger ready
requirements. Add mixed-outcome conformance cases, malformed reason-count
checks and false-ready denials. No new endpoint, workflow or permission.

## Artifact And Deployment Evidence

- source/build evidence: exact Gary head and fetched-base CI-equivalent checks in the owner PR
- image tag or digest: None; existing development source composition
- runtime revision: unchanged until exact Security acceptance and Platform commissioning

## Live Verification

- local validation: replay the real owner result through the pure decoder, plus the full owner suite and CI-equivalent checks before publication
- live verification: recover and retry the original run through the Console after reviewed commissioning
- residual risk: source checks do not establish operating completion

## Follow-Up

- required follow-up: paired finite Security source acceptance and index, normal commissioning, original-run proof and source cleanup
- owner: OOS source, Security acceptance, Platform runtime
- closure condition: valid owner evidence is retained and the original run completes with genuine receipts
