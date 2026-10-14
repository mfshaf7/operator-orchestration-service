---
security_evidence:
  review_areas:
    - identity
    - secrets
    - delivery
    - runtime
  reviewed_artifacts:
    - src/platform-operation/contracts.js
    - src/platform-operation/provider-client.js
    - src/platform-operation/service.js
    - src/platform-operation/store.js
    - src/platform-operation/runtime.js
    - test/platform-operation.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "The adapter is disabled by default, dev-integration-only, bound to exact caller/operator and Security decisions, finite in action scope, persistent before dispatch, and fail-closed when Platform truth is unavailable."
---

# 2026-10-15 Platform operation adapter

## Summary

OOS now provides a bounded, restart-safe command and readback seam for the
Console's Dev Integration and Governed Releases workspaces while preserving
Platform ownership of capability truth and platform effects.

## Classification

- area: Console-to-Platform workflow orchestration
- type: source-backed feature
- runtime impact: disabled by default; activation requires the admitted
  dev-integration profile, exact identity bindings, an owner endpoint, and an
  exact Security decision

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Epic 1275 Feature 1278 User story 1288
- related products or components: Governance Operations Console,
  platform-engineering dev-integration runner and governed release surfaces

## Root Cause

- immediate failure: Console Platform workspaces had fixture-shaped controls
  but no durable OOS command, control, and readback adapter.
- actual root cause: the prior workflow surface stopped at Console projections
  and did not bind operator intent to current Platform capability truth through
  the shared orchestration owner.
- why it escaped earlier controls: earlier acceptance proved individual
  read-model surfaces, not fixture-free command execution across the OOS and
  Platform owner boundary.

## Source Changes

- changed workflow, adapter, or contract: finite versioned commands, exact
  approvals, Platform capability admission, atomic retained state, restart
  reconciliation, retry/cancel control recovery, authenticated owner client,
  safe downstream-error mapping, complete mutation/replay/reconciliation audit,
  five OOS API routes, OpenAPI generation, and one operator surface.
- tests or validator added: exact contract denial, identity binding, catalog
  freshness, idempotent replay/conflict, lost-response restart recovery,
  retry/cancel behavior, owner target restrictions, HTTP routing, runtime
  activation gates, safe error projection, audit coverage without raw command
  input, and OpenAPI route parity.
- related change records: None.

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only Landing Unit;
  Security review #1302 is required before merge and Platform implementation
  #1291 is required before activation
- image tag or digest: None.
- runtime revision: None.

## Live Verification

- local validation: focused tests, full repository tests, API documentation
  validation, governance-doc validation, and base-aware owner validators
- live or dev-integration verification: deferred by design to Platform
  composition #1291, Console recovery proof #1292, and fixture-free journey
  #1298
- residual risk: the Platform owner routes are not yet implemented or
  commissioned; OOS therefore remains disabled and cannot claim live effects

## Follow-Up

- required follow-up: Security must accept the exact OOS PR head before merge;
  Platform must implement and commission the owner side before activation
- owner: `security-architecture` #1302 and `platform-engineering` #1291
- due date or closure condition: before #1288 merge and before #1298 final
  fixture-free execution, respectively
