---
security_evidence:
  review_areas:
    - runtime
    - delivery
    - identity
  reviewed_artifacts:
    - dev-integration/profiles/accepted-idea-delivery/scripts/common.sh
    - dev-integration/profiles/accepted-idea-delivery/scripts/up.sh
    - test/config.test.js
    - test/devint-host-service-profile.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "Security acceptance #1025 already requires distinct Console caller, accountable operator, OOS service, and source-executor identities. This correction restores the missing caller-specific host operator credential without widening the accepted boundary."
---

# 2026-08-29 Delivery ART Operator Credential

## Summary

Corrected the accepted-idea-delivery profile so profile creation and refresh
retain the caller-specific credential required by host Delivery ART work
sessions.

## Classification

- area: Delivery work-session execution
- type: dev-integration identity and secret-delivery correction
- runtime impact: restores schema-v2 artifact mutation for the existing host
  operator; no new caller role or action is introduced

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Defect `#1033` under Feature `#910` and Epic `#886`
- security acceptance: User story `#1025`
- blocked consumer work: Governance Operations Console User story `#1032`

## Root Cause

- schema-v2 artifact writes require an authenticated caller-specific credential
  whose caller id matches `artifact.operator.id`
- the host work-session path uses `operator:workspace-owner`
- the profile rendered a Console caller-specific secret but omitted the host
  operator secret, so profile recreation removed the operator's mutation path

## Source Changes

- generate one persistent local host-operator secret alongside existing profile
  secrets
- admit `operator:workspace-owner` with that caller-specific secret
- keep the operator, Console, and compatibility shared secrets distinct
- document the identity boundary and add focused profile regression assertions

## Validation

- shell syntax validation for the changed profile scripts
- focused host-service profile and caller-secret configuration tests
- full OOS test and governance validation before merge
- base-aware change-record and mutation-contract checks before merge

## Live Verification

- recreate the accepted-idea-delivery composition from the exact merged OOS
  revision
- inspect only redacted caller ids and secret-distinctness results
- resume #1032 through `work continue` and `work close`

## Artifact And Deployment Evidence

- source commit: pending reviewed pull-request head
- runtime revision: pending exact merged OOS revision
- credential evidence: caller ids and distinctness only; secret values are not
  recorded

## Follow-Up

- merge and redeploy this bounded correction before resuming #1032
- retain #1025 as the governing Security acceptance for the commissioning
  boundary

## Rollback

Revert this landing unit and recreate the profile. Existing Console and shared
broker credentials remain independently owned, while host schema-v2 artifact
mutation returns to fail-closed behavior.
