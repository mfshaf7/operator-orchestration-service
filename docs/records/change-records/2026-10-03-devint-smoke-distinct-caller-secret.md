---
security_evidence:
  review_areas:
    - identity
    - secrets
    - runtime
  reviewed_artifacts:
    - dev-integration/profiles/accepted-idea-delivery/scripts/common.sh
    - dev-integration/profiles/accepted-idea-delivery/scripts/up.sh
    - dev-integration/profiles/accepted-idea-delivery/scripts/smoke.sh
    - test/devint-host-service-profile.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "The local smoke identity receives a distinct generated caller credential because OOS correctly forbids caller-specific bindings from reusing the compatibility shared secret."
---

# Dev-Integration Smoke Distinct Caller Secret

## Summary

The accepted-idea delivery profile now keeps the existing smoke caller's
private credential distinct from the legacy compatibility shared secret. This
repairs the first caller-binding change, which correctly added a caller map but
incorrectly reused the shared-secret value and therefore caused OOS to fail
closed at startup.

## Classification

- area: accepted-idea-delivery runtime identity
- type: owner-repo maintenance repair
- landing unit decision: `child_isolated_landing_unit`
- runtime impact: restores the existing local OOS service with a distinct
  caller-specific smoke credential

## Ownership

- owner repo: `operator-orchestration-service`
- work-tracking home: owner-repo-only maintenance linked to the existing
  Workspace Governance improvement candidate; no new ART item
- related products or components: `refinement-catalog` local composition

## Root Cause

- immediate failure: the reconciled OOS pod entered `CrashLoopBackOff` with
  `CALLER_AUTH_SECRETS_JSON must use distinct secrets that differ from
  CALLER_AUTH_SHARED_SECRET`
- actual root cause: the first repair mapped the smoke caller to
  `BROKER_CALLER_SECRET` while also continuing to use that value as
  `CALLER_AUTH_SHARED_SECRET`
- why it escaped earlier controls: the profile source assertion checked that
  the caller mapping existed but did not check the existing OOS distinct-secret
  invariant before live reconciliation

## Source Changes

- changed workflow or contract: `BROKER_CALLER_SECRET` remains the private
  smoke caller credential; a separately generated `BROKER_SHARED_SECRET` now
  supplies only the compatibility shared-secret setting
- tests or validator added: the profile source contract test requires both the
  separately generated shared secret and its separate runtime projection; the
  profile rejects empty, duplicate, or shared caller credentials before its
  first Helm or Kubernetes mutation
- related change records:
  `2026-10-03-devint-smoke-caller-binding.md`

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: focused and full local
  validation before review; exact-source dev-integration reconciliation before
  final merge
- image tag or digest: not applicable; the profile copies exact OOS source into
  the local runtime
- runtime revision: pending validation and merge

## Live Verification

- local validation: profile regression test, configuration tests, Workspace
  Inventory HTTP tests, full repository validation, change-record validation,
  and `git diff --check`
- live or dev-integration verification: reconcile the exact repair worktree,
  require OOS readiness, and run composition-aware profile smoke
- residual risk: the legacy shared secret remains for compatibility routes but
  is no longer reused as the smoke caller's identity-bound credential

## Follow-Up

- required follow-up: update the exact Security delta, merge the repair,
  reconcile merged main, and repeat composition-aware smoke
- owner: `operator-orchestration-service`
- due date or closure condition: the live registry read succeeds under the
  distinct caller-specific credential and OOS startup preserves the
  distinct-secret invariant

## Security Boundary

This repair adds one generated local-only secret value to the existing private
profile state file and Kubernetes Secret projection. It adds no identity,
endpoint, permission, mutation, external listener, or deployment authority.
The value is generated locally, stored in the existing `0600` profile state,
projected through the existing Kubernetes Secret, and excluded from source and
evidence.

## Rollback

Revert the landing commit and reconcile only after restoring the predecessor
profile revision. Reapplying the first repair alone is not a safe rollback
because OOS will correctly reject its reused secret at startup.
