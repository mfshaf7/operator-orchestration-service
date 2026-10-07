---
security_evidence:
  review_areas:
    - identity
    - secrets
    - delivery
    - runtime
  reviewed_artifacts:
    - contracts/proposal-target-application
    - src/proposal-target-application
    - src/proposal-workflow/service.js
    - src/app.js
    - src/config.js
    - src/runtime.js
    - docs/api/openapi.json
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: Source implementation remains fail-closed and runtime-inactive pending exact Security and Platform approval.
---

# Proposal Target Application

## Summary

ART #1233 adds the bounded OOS workflow that applies one accepted Proposal
routed to Prototype Studio, coordinates an exact reviewed Git change, verifies
the target-owned merge and receipt, and then acknowledges that receipt on the
canonical Proposal.

## Classification

- area: Proposal-to-Prototype target application
- type: source-backed orchestration and trust-boundary implementation
- runtime impact: inactive until Security #1235 and Platform #1236

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: #1233 under Feature #1212 and Epic #1203
- related products or components: Workspace Prototype Studio, Governance Operations Console

## Root Cause

- immediate failure: the accepted Proposal workflow stopped at a prepared
  Prototype route and could not apply the target-owner contract from #1232.
- actual root cause: no OOS workflow yet joined the resolved repository gate,
  reviewed Studio source mutation, target receipt, and canonical Proposal
  acknowledgement.
- why it escaped earlier controls: the target-owner contract was deliberately
  sequenced first and merged in #1232.

## Source Changes

- changed workflow, adapter, or contract: synchronized the exact Studio target
  contract; added caller/idempotency-bound orchestration, repository-gate
  enforcement, deterministic review publication, cancellation/recovery,
  exact-head merge proof, and Proposal acknowledgement.
- tests or validator added: contract synchronization, focused service and HTTP
  tests, negative gate and stale-state cases, and disposable real-Git source
  preparation through the pinned Studio contract boundary.
- related change records: None.

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only; activation remains false
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation: synchronized contract checks, focused protocol tests,
  OpenAPI/route parity, full repository tests, and base-aware owner validation
- live or dev-integration verification: assigned to Platform #1236 after Console #1234 and Security #1235
- residual risk: the dedicated installation identity and composed runtime are unavailable until the ordered activation work completes

## Follow-Up

- required follow-up: connect the Console projection in #1234, review this exact revision in #1235, and commission the bounded dev-integration runtime in #1236
- owner: the owner repos assigned by the Epic #1203 architecture packet
- due date or closure condition: before Feature #1212 closes
