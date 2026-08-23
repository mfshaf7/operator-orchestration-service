---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - README.md
    - docs/api/README.md
    - docs/contracts/delivery-workflow-api-v1.md
    - docs/operations/delivery-workflow-operator-surface.md
    - src/art-cli.js
    - src/openproject-client.js
    - test/art-cli.test.js
    - test/openproject-client.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "The change tightens existing Delivery ART completion planning. It introduces no new identity, secret, privilege, model, context-projection, or deployment authority boundary."
---

# 2026-08-23 Landing-Unit Closeout Guards

## Summary

Moved all deterministic completion prerequisites into landing-unit planning and
limited automatic stale-open parent closure to parents explicitly covered by
the same finalized Review Packet.

## Classification

- area: Workspace Delivery ART source closeout
- type: defect remediation and fail-closed mutation planning
- runtime impact: OOS continuation evidence and landing-unit closeout planning

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Defect `#975` under conformance Enabler `#954`
- related products or components: Workspace Delivery ART and
  `operator-orchestration-service`

## Root Cause

- immediate failure: source-merged Defect `#974` passed landing-unit dry-run but
  failed during completion first on its done-state narrative and then on missing
  execution fields.
- actual root cause: landing-unit planning validated generated completion
  evidence but did not preflight the target state already enforced by the
  mutation route. Parent closeout eligibility also depended only on sibling
  state rather than Review Packet scope and parent readiness.
- why it escaped earlier controls: the tests encoded uncovered-parent closure
  as expected behavior and mocked target evidence without the complete
  completion-readiness projection.

## Source Changes

- changed workflow, adapter, or contract:
  - continuation evidence now projects recursive descendant count,
    completion-narrative readiness after Execution Context synchronization, and
    live `done` transition availability
  - landing-unit dry-run blocks active blockers, missing execution fields, open
    descendants, weak target narrative, and unavailable status transition
    before mutation
  - covered stale-open parents must pass the same preflight except for children
    the landing unit is about to close
  - stale-open parent closure requires explicit Review Packet coverage
- tests or validator added:
  - uncovered parents remain open
  - covered parents still close after their covered children
  - weak target narrative fails during dry-run
  - missing execution fields and unavailable `done` transitions fail during
    dry-run
  - covered-parent prerequisites fail during dry-run without treating covered
    children as premature blockers
  - continuation projection reports completion narrative, recursive descendant,
    execution-field, and status-transition readiness
- related change records:
  - [2026-05-06-feature-closeout-narrative-contract.md](2026-05-06-feature-closeout-narrative-contract.md)

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source validation and
  dev-integration verification are required before closeout
- image tag or digest: pending exact review-head build
- runtime revision: pending merge and dev-integration refresh

## Live Verification

- live form contract evidence: no new OpenProject field write is introduced.
  The readiness projection resolves `done` against the same live form
  `allowedValues` contract used by completion and reads execution fields through
  the same schema-derived map. It changes no writable or read-only field
  assumption.
- local validation: focused landing-unit and OpenProject tests, full repository
  suite, governance/API checks, and image builds on the exact review head
- live or dev-integration verification: retry `#974` through normal `work close`
  and prove `#954` remains open
- residual risk: old callers that omit the expanded completion-readiness
  projection fail closed until the OOS API and CLI are refreshed together

## Follow-Up

- required follow-up: merge and refresh OOS, close `#974`, then close `#975`
  with the same bounded Review Packet lifecycle
- owner: `operator-orchestration-service`
- due date or closure condition: before resuming conformance work on `#954`
