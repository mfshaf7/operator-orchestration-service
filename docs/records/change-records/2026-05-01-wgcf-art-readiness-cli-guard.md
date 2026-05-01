# 2026-05-01 WGCF ART Readiness Guard

## Summary

The local ART operator CLI and broker completion-style mutation service now invoke WGCF ART readiness instead of leaving WGCF as a manual sidecar.

## Classification

- area: Workspace Delivery ART operator workflow
- type: workflow-control hardening
- runtime impact: local ART CLI and required dev-integration broker mutation paths preflight completion-style work-item mutations through WGCF before OpenProject writes

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: `openproject://work_packages/540`
- related products or components: Workspace Delivery ART, Workspace Governance Control Fabric

## Root Cause

- immediate failure: WGCF ART validation existed, but normal `npm run art -- ...` work did not visibly invoke it.
- actual root cause: OOS only exposed a manual WGCF handoff and had not wired WGCF readiness into the default local operator or broker mutation path.
- why it escaped earlier controls: #536 proved validator cutover and ART catalog checks, but did not prove automatic use during ordinary ART continuation and mutation commands.

## Source Changes

- changed workflow, adapter, or contract: `src/art-cli.js` now runs WGCF readiness after continuation reads and before completion or stale-open closeout dispatch.
- changed workflow, adapter, or contract: `src/delivery-service.js` now runs required WGCF readiness before server-side `complete` and `stale-open-close` OpenProject mutations when the active profile enables `WGCF_ART_READINESS_MODE=required`.
- changed runtime profile: `dev-integration/profiles/accepted-idea-delivery/scripts/up.sh` configures the broker to call the `governance-control-fabric` dev-integration WGCF API.
- tests or validator added: `test/art-cli.test.js` covers automatic readiness projection and fail-closed CLI mutation blocking; `test/delivery-service.test.js` covers server-side WGCF allow/block behavior; `test/config.test.js` covers required WGCF readiness configuration.
- related change records: None.

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source and dev-integration profile change proven in the local accepted-idea-delivery profile after broker restart.
- image tag or digest: None.
- runtime revision: `devint-accepted-idea-delivery-mfshaf7` broker deployment restarted from local source.

## Live Verification

- local validation: `npm test`
- live or dev-integration verification: `make devint-up PROFILE=accepted-idea-delivery`; `DEVINT_OPENPROJECT_LOCAL_PORT=28183 DEVINT_OPENPROJECT_HOST_HEADER=localhost:18183 DEVINT_BROKER_LOCAL_PORT=28180 make devint-smoke PROFILE=accepted-idea-delivery`
- residual risk: local shell users outside the dev-integration profile must either use `npm run art` or set `WGCF_ART_READINESS_MODE=required` with `WGCF_ART_READINESS_BASE_URL`; the active dev-integration broker profile is configured fail-closed.

## Follow-Up

- required follow-up: complete #540 child API/operator-surface work so WGCF readiness, receipts, and evidence packets remain discoverable through documented operator and API surfaces.
- owner: Workspace Governance Control Fabric and Operator Orchestration-Service
- due date or closure condition: before #540 is closed.
