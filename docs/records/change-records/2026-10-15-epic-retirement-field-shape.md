---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - .github/workflows/validate-governance-docs.yaml
    - src/openproject-client.js
    - test/openproject-client.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: The change preserves fail-closed Iteration enforcement for executable non-Epic work and permits omission only for the OpenProject Epic form shape, which does not expose that field. It introduces no new identity, privilege, secret, deployment authority, or external action path.
---

# 2026-10-15 Epic retirement field shape

## Summary

The broker-owned parking workflow now retires an OpenProject Epic without
requiring the Iteration field that is not present on the Epic form. Retirement
of executable non-Epic work remains fail closed when its Iteration field is
missing.

## Classification

- area: Workspace Delivery ART parking and retirement
- type: owner-repo maintenance blocking Epic 1275 work item 1297
- landing unit decision: `child_isolated_landing_unit`
- tracking record:
  `workspace-governance/reviews/improvement-candidates/2026-10-15-art-epic-retirement-field-shape-regression.yaml`

## Ownership

- owner repo: `operator-orchestration-service`
- affected backend: OpenProject through the existing OOS broker adapter
- related ART work: Epic 1275 item 1297

## Root Cause

The retirement path correctly clears stale PI and iteration commitments from
executable work, but it treated Iteration as mandatory for every work-package
type. OpenProject Epics expose Target PI governance without exposing Iteration,
so retirement failed with `missing_iteration_field` after all descendants were
already terminal. The same failure previously affected Epic 896.

## Source Changes

- `src/openproject-client.js` permits only an Epic retirement form to omit
  Iteration; every other type retains the existing fail-closed check.
- `test/openproject-client.test.js` reproduces the real Epic form shape and
  proves retirement neither fabricates nor writes an Iteration value.
- `.github/workflows/validate-governance-docs.yaml` replaces the brittle fixed
  API-startup sleep with a bounded readiness poll and emits container logs when
  the API never becomes ready.

## Validation

- focused OpenProject client tests
- complete repository tests
- API and governance-document validation
- source diff validation

## Artifact And Deployment Evidence

This is a source-only broker adapter repair. Deployment and live replay remain
pending exact-head review and merge.

## Live Verification

The blocked managed submission for Epic 698 read the live OpenProject form
schema: Target PI remained writable, the status, Parking Decision, and
Retirement Reason fields exposed the required `allowedValues`, and Iteration
was absent. The regression test preserves that observed contract shape and
proves the patch does not fabricate or write an Iteration value.

The original PR check also reproduced a separate API-smoke race: the container
was not always ready after the workflow's fixed two-second sleep. The unchanged
image passed when retried locally. The replacement poll is bounded to fifteen
seconds and keeps the same health assertion.

After merge and dev-integration reconciliation, resubmit the managed retirement
draft for Epic 698 and confirm the broker returns `retired` without writing an
Iteration value.

## Rollback

Revert this change to restore the previous universal Iteration requirement.
That rollback would again block retirement of Epic shells but would not change
already-retired ART records.

## Follow-Up

Merge and deploy the exact reviewed head, replay Epic 698 retirement, and bind
the successful response into work item 1297 closeout evidence.
