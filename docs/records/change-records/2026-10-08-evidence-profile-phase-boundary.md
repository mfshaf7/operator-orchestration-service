---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - docs/operations/delivery-workflow-operator-surface.md
    - src/delivery-art/work-session-controller.js
    - test/delivery-art-work-session.test.js
  findings: []
  risks:
    - "Operating-ready evidence remains fail-closed after merge and must come from the exact reviewed source revision."
  workstreams:
    - WS-007
  notes: "The change narrows only accepted-base preflight to merge-ready cases. It does not weaken pre-merge evidence, source review, merge authority, post-merge operating evidence, Security gates, or readiness finalization."
---

# Evidence Profile Phase Boundary

## Summary

Delivery ART configured-path preflight now checks only merge-ready conformance
cases against the accepted base profile. Operating-ready cases remain visible
in the work contract and are checked against the reviewed source revision after
merge, allowing a Landing Unit to introduce its own verification-only runtime
verifier without a preparatory maintenance Landing Unit.

## Classification

- area: Delivery ART configured-path and owner evidence acquisition
- type: corrective owner-repo maintenance
- runtime impact: work start no longer rejects a valid Landing Unit solely
  because its future operating verifier is not present on the old base

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Epic 1203 work item 1237
- related products or components: Delivery ART work sessions and owner evidence
  profiles

## Root Cause

- immediate failure: work item 1237 could not start because its Studio base
  profile did not yet contain the live-backend verifier that 1237 is meant to
  implement.
- actual root cause: configured-path preflight passed both merge-ready and
  operating-ready cases into accepted-base profile validation, despite the
  lifecycle contract reading the operating profile from the reviewed head
  after merge.
- why it escaped earlier controls: the earlier transport regression test
  proved that evidence requirements reached the source executor, but did not
  prove that those requirements were scoped to the lifecycle phase in which
  their evidence is acquired.

## Source Changes

- changed workflow, adapter, or contract: scope configured-path profile
  coverage to merge-ready cases while retaining all cases in the projected
  work contract.
- tests or validator added: prove an operating-ready live-backend case does not
  block source creation when the accepted base covers the merge-ready case.
- related change records:
  `docs/records/change-records/2026-10-04-configured-path-evidence-transport.md`

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only until the
  existing dev-integration composition is refreshed
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation: focused work-session tests, full Node test suite, API and
  governance-document validation
- live or dev-integration verification: work item 1237 configured-path
  preflight must start from the unchanged Studio base and preserve its later
  operating-ready obligations
- residual risk: operating evidence still fails closed after merge unless the
  accepted head profile supplies the exact live-backend verifier

## Follow-Up

- required follow-up: resume work item 1237 and prove both merge-ready and
  post-merge operating-ready evidence through the normal work-session path
- owner: `workspace-prototype-studio`
- due date or closure condition: work item 1237 reaches operating readiness
  with the accepted-head verifier

## Rollback

Revert the configured-path phase scoping, regression test, and this record
together. This restores the earlier over-constrained preflight behavior.
