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

- source-only change, or build/deployment evidence: PR `#147` merged as
  `dbb35266c8cfeecc0c064c8c210c9dc03668b18a`; the accepted-idea-delivery
  profile converged successfully afterward
- image tag or digest: the profile mounts the recorded OOS source revision onto
  `node:22-bookworm-slim`; no owner image is built for this local lane
- runtime revision: dev-integration session
  `accepted-idea-delivery-mfshaf7-20260823T144951Z` recorded OOS main at
  `dbb35266c8cfeecc0c064c8c210c9dc03668b18a`

## Live Verification

- live form contract evidence: no new OpenProject field write is introduced.
  The readiness projection resolves `done` against the same live form
  `allowedValues` contract used by completion and reads execution fields through
  the same schema-derived map. It changes no writable or read-only field
  assumption.
- local validation: focused landing-unit and OpenProject tests, full repository
  suite, governance/API checks, and image builds on the exact review head
- live or dev-integration verification: live dry-run first reported all three
  missing execution fields on `#974` before mutation and showed
  `parent_covered: false` for `#954`; after bounded metadata repair, dry-run was
  ready and normal `work close` completed `#974` with cleanup receipt
  `cleanup-receipt:work-session:delivery-882:delivery-882-work-item-974`
- residual risk: old callers that omit the expanded completion-readiness
  projection fail closed until the OOS API and CLI are refreshed together; the
  accepted-idea-delivery profile has been refreshed

## Follow-Up

- required follow-up: close `#975` with its finalized Review Packet, then resume
  conformance work on `#954`
- owner: `operator-orchestration-service`
- due date or closure condition: before resuming conformance work on `#954`
