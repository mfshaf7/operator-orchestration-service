---
security_evidence:
  review_areas:
    - runtime
    - delivery
  findings:
    - F-007
  risks:
    - R-007
  workstreams:
    - WS-007
---

# Runtime Host Binding For Container Reachability

## Summary

The broker image build published successfully but failed its smoke-test
reachability probe because the service defaulted to `127.0.0.1`. That binding
is acceptable for unit tests but breaks container port publishing and Kubernetes
service reachability because the HTTP server does not listen on the pod network
interface.

## Classification

- owner repo: `operator-orchestration-service`
- change class: shared service runtime contract correction
- trust-boundary areas:
  - runtime
  - delivery

## Ownership

- runtime default binding owner: `operator-orchestration-service`
- deployment and service reachability validation owner: `platform-engineering`

## Root Cause

The service configuration inherited a loopback-friendly local default and did
not distinguish between unit-test execution and real container runtime
reachability. The image build workflow exposed that mismatch because the
published port could not reach a process bound only to container loopback.

## Change

- change the broker default bind address from `127.0.0.1` to `0.0.0.0`
- add a focused runtime-config test that locks the container-safe default

## Source Changes

- `src/config.js`
- `test/config.test.js`

## Artifact And Deployment Evidence

- failed broker build identifying the reachability defect:
  - `operator-orchestration-service` Actions run `24599621525`
- published image digest from the same run:
  - `ghcr.io/mfshaf7/operator-orchestration-service@sha256:a37c30d7eaad3d51ce684ebe958525c4d26f238d6fcdc071ef2cbe1ed2642d0c`
- replacement image build:
  - pending after this fix merges

## Live Verification

- `npm test`
- replacement image workflow smoke test:
  - pending after merge

## Follow-Up

- merge this runtime fix to `main`
- rerun the broker image build workflow
- update the platform branch with the successful replacement digest

## Why This Matters

The broker is an internal shared service. Loopback-only binding would have made
the stage runtime unreachable even if the image digest were recorded and the
deployment reconciled successfully. This is a runtime contract defect, not only
an Actions workflow issue.
