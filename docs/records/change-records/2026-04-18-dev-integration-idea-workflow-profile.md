## Summary

Added the first concrete `dev-integration` profile, `idea-workflow`, so the
broker-owned idea workflow can iterate locally on `k3s` without pushing every
change through the governed stage lane.

## Classification

- change type: local dev-integration profile
- lane: `dev-integration`
- workflow: idea capture, read projection, and command harness rehearsal

## Ownership

- shared lane standard: `workspace-governance`
- shared local-k3s runner: `platform-engineering`
- concrete profile owner: `operator-orchestration-service`

## Root Cause

The broker workflow was discovering command-shape and integration mistakes only
after entering governed stage rehearsal. That made iteration expensive and
mixed early design churn with governed runtime proof.

## Source Changes

- added [dev-integration/profiles/idea-workflow/profile.yaml](../../../dev-integration/profiles/idea-workflow/profile.yaml)
- added the concrete profile scripts under
  [dev-integration/profiles/idea-workflow/scripts](../../../dev-integration/profiles/idea-workflow/scripts)
- added the local Telegram command simulator in
  [telegram_simulator.mjs](../../../dev-integration/profiles/idea-workflow/scripts/telegram_simulator.mjs)
- updated repo guidance so operators know this repo owns the first concrete
  profile

## Artifact And Deployment Evidence

- no governed artifact or Argo revision is produced by this lane
- local session manifests and promotion reports live under `.dev-integration/`
- local OpenProject identity and broker env files are generated only inside the
  local profile state root

## Live Verification

- the profile reuses the real broker source tree, the real Telegram `/idea`
  handler, and the canonical OpenProject provisioning runners
- the profile includes a smoke flow for:
  - `/idea help`
  - `/idea <text>`
  - `/idea list`
  - `/idea list all`
  - `/idea show <idea-id>`

## Follow-Up

- complete local lane validation and promotion-check output
- keep governed stage rehearsal separate from this local runtime
- route any winning runtime or UX changes back through the normal PR and
  platform promotion path
