---
security_evidence:
  review_areas:
    - identity
    - secrets
    - runtime
  reviewed_artifacts:
    - dev-integration/profiles/accepted-idea-delivery/scripts/up.sh
    - dev-integration/profiles/accepted-idea-delivery/scripts/smoke.sh
    - test/devint-host-service-profile.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "The existing local smoke identity is narrowed from shared-secret fallback to its existing caller-specific credential; no identity, secret, route, or authority is added."
---

# Dev-Integration Smoke Caller Binding

## Summary

The persistent accepted-idea delivery profile now registers its existing smoke
caller in the broker's caller-specific credential map. Composition-aware
read-only smoke can therefore call the identity-bound Workspace Inventory
registry without weakening that route to accept the shared compatibility
secret.

## Classification

- area: accepted-idea-delivery runtime identity
- type: owner-repo maintenance
- landing unit decision: `child_isolated_landing_unit`
- runtime impact: narrows one existing local smoke caller from shared-secret
  fallback to caller-specific authentication

## Ownership

- owner repo: `operator-orchestration-service`
- work-tracking home: owner-repo-only maintenance linked to the existing
  Workspace Governance improvement candidate; no new ART item
- related products or components: `refinement-catalog` local composition

## Root Cause

- immediate failure: composition-aware read-only smoke received HTTP 403
  `caller_identity_unbound` from `/v1/workspace-inventory/registry`
- actual root cause: the profile allowed the exact smoke caller id but supplied
  its generated secret only as `CALLER_AUTH_SHARED_SECRET`; the registry
  contract requires caller-specific authentication
- why it escaped earlier controls: the old profile smoke omitted active
  composition context and therefore never called the composed Workspace
  Inventory route

## Source Changes

- changed workflow or contract: profile-generated `CALLER_AUTH_SECRETS_JSON`
  now includes the existing smoke caller id and its existing generated secret
- tests or validator added: the profile source contract test requires the exact
  caller-specific binding
- API contract: unchanged; the repair satisfies the existing identity-bound
  registry-read contract

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: focused and full local
  validation before review; merged-main profile reconciliation required
- image tag or digest: not applicable; the profile copies exact OOS source into
  the local runtime
- runtime revision: pending merge

## Live Verification

- local validation: profile regression test, Workspace Inventory HTTP tests,
  full repository validation, change-record validation, and `git diff --check`
- live verification: pending merged-main `refinement-catalog` reconciliation
  and composition-aware read-only smoke
- residual risk: the compatibility shared secret remains for other admitted
  local routes; this change does not expand its use

## Follow-Up

- required follow-up: obtain the exact-revision Security delta decision, merge,
  reconcile the live local composition, and repeat read-only smoke
- owner: `operator-orchestration-service`
- due date or closure condition: the live registry read succeeds under the
  caller-specific smoke identity and invalid callers remain denied

## Security Boundary

No new identity, secret, endpoint, mutation, or deployment authority is added.
The same generated local secret remains under the existing profile state and
Kubernetes Secret custody. The change removes shared-secret fallback for this
caller on identity-bound reads and preserves the existing 401/403 denial
behavior for invalid or unbound callers.

## Rollback

Revert the landing commit and reconcile the profile. Composition-aware smoke
would again fail closed on the Workspace Inventory registry read.
