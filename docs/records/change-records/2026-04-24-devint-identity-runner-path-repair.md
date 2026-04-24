---
security_evidence:
  review_areas:
    - runtime
    - delivery
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-04-24 Devint Identity Runner Path Repair

## Summary

Repaired the `accepted-idea-delivery` and `idea-workflow` dev-integration
profiles after the OpenProject identity provisioning runner was generalized in
`platform-engineering`. Both profiles now copy and execute the stable generic
runner and parse the generic identity markers, so `devint-up` can converge the
broker identity and continue to broker rollout.

## Classification

- owner repo: `operator-orchestration-service`
- related control planes:
  - `platform-engineering`
- trust-boundary areas:
  - runtime
  - delivery

## Ownership

- active dev-integration profile repair and broker rollout recovery:
  `operator-orchestration-service`
- generic OpenProject identity runner contract:
  `platform-engineering`

## Root Cause

The dev-integration profile scripts still referenced the deleted
`openproject_provision_operator_orchestration_identity_runner.rb` file and the
older operator-specific marker names. When the merged ART done-state guard was
reconciled into the active devint lane, `make devint-up PROFILE=accepted-idea-delivery`
failed during identity provisioning before the broker refresh step.

## Source Changes

- updated
  [dev-integration/profiles/accepted-idea-delivery/scripts/up.sh](../../../dev-integration/profiles/accepted-idea-delivery/scripts/up.sh)
  to:
  - copy `openproject_provision_identity_runner.rb`
  - invoke the generic runner path inside the OpenProject pod
  - parse `__OPENPROJECT_IDENTITY_PROVISION_*` markers
- updated
  [dev-integration/profiles/idea-workflow/scripts/up.sh](../../../dev-integration/profiles/idea-workflow/scripts/up.sh)
  to use the same stable runner path and markers

## Artifact And Deployment Evidence

- artifact:
  - both active dev-integration profiles now use the stable generic OpenProject
    identity runner contract
- proof:
  - `accepted-idea-delivery` reconciled successfully after the patch
  - the broker deployment rolled to a fresh pod and served the new
    `done_narrative_contract_*` execution-summary fields

## Live Verification

- `bash -n dev-integration/profiles/accepted-idea-delivery/scripts/up.sh dev-integration/profiles/idea-workflow/scripts/up.sh`
- `make devint-up PROFILE=accepted-idea-delivery`
- `make devint-smoke PROFILE=accepted-idea-delivery`
- direct broker read in devint showed:
  - `done_narrative_contract_applicable: true`
  - `done_narrative_contract_satisfied: true`
  for `work-item-213`

## Follow-Up

- keep the dev-integration profiles on the generic identity runner contract so
  future platform-side identity generalization does not strand one lane on a
  deleted script path
