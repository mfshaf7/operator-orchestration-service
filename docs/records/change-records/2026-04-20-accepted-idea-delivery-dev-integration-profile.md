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

# 2026-04-20 Accepted Idea Delivery Dev-Integration Profile

## Summary

Activated the `accepted-idea-delivery` local `dev-integration` profile so the
broker-owned consume flow can be rehearsed end to end on local `k3s` against a
disposable OpenProject proposal backlog and delivery ART project.

## Classification

- owner repo: `operator-orchestration-service`
- related control planes:
  - `platform-engineering`
  - `workspace-governance`
  - `security-architecture`
- trust-boundary areas:
  - runtime
  - delivery

## Ownership

- concrete profile contract, smoke flow, and broker local runtime:
  `operator-orchestration-service`
- shared local-k3s runner plus canonical OpenProject seeding:
  `platform-engineering`
- active profile lifecycle and admission truth:
  `workspace-governance`
- profile-local security review authority:
  `security-architecture`

## Root Cause

The internal consume endpoint existed, but the workspace still had no admitted
local rehearsal lane for the proposal-to-delivery handoff. That kept the
delivery-plane model half-real: source code and contracts existed, but the
operator still could not prove the local OpenProject project models, identity
scope, and backlink behavior together.

## Source Changes

- replaced the `accepted-idea-delivery` placeholder scripts with a real local
  profile runtime
- seeded both the proposal backlog and the delivery ART in the disposable local
  OpenProject runtime
- provisioned the local broker automation identity with access limited to the
  proposal and delivery projects
- added a smoke flow for accepted lookup, delivery-project verification,
  consume, and backlink verification
- updated repo guidance so this profile is described as active instead of
  design-only

## Artifact And Deployment Evidence

- no governed artifact or Argo revision is produced by this lane
- local session manifests and promotion reports live under `.dev-integration/`
- local OpenProject seed artifacts, identity payload, and broker env material
  live only inside the profile state root

## Live Verification

- `bash -n dev-integration/profiles/accepted-idea-delivery/scripts/common.sh`
- `bash -n dev-integration/profiles/accepted-idea-delivery/scripts/up.sh`
- `bash -n dev-integration/profiles/accepted-idea-delivery/scripts/status.sh`
- `bash -n dev-integration/profiles/accepted-idea-delivery/scripts/smoke.sh`
- `bash -n dev-integration/profiles/accepted-idea-delivery/scripts/down.sh`
- `bash -n dev-integration/profiles/accepted-idea-delivery/scripts/reset.sh`
- `bash -n dev-integration/profiles/accepted-idea-delivery/scripts/promote-check.sh`
- `python3 scripts/validate_governance_docs.py --repo-root .`
- `python3 scripts/validate_change_record_requirement.py --repo-root . --against-ref origin/main`
- `npm test`
- `node --check src/app.js`
- `node --check src/config.js`
- `node --check src/idea-service.js`
- `node --check src/openproject-client.js`
- `node --check src/workflow-catalog.js`
- `make -C /home/mfshaf7/projects/platform-engineering devint-up PROFILE=accepted-idea-delivery`
- `make -C /home/mfshaf7/projects/platform-engineering devint-smoke PROFILE=accepted-idea-delivery`
- `make -C /home/mfshaf7/projects/platform-engineering devint-promote-check PROFILE=accepted-idea-delivery`
- local smoke evidence:
  `.dev-integration/accepted-idea-delivery/mfshaf7/smoke-summary.txt`

## Follow-Up

- keep the active profile admission truth aligned in
  `workspace-governance/contracts/developer-integration-profiles.yaml`
- keep the platform delivery-project contract and local seed runners aligned in
  `platform-engineering`
- keep the profile-specific security review aligned if the local lane widens
  beyond its current internal-only consume shape
