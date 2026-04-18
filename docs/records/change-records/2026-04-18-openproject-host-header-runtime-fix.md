---
security_evidence:
  review_areas:
    - delivery
    - runtime
  workstreams:
    - WS-007
---

# 2026-04-18 OpenProject host header runtime fix

## Summary

The first live `operator-orchestration-service` rollout reached runtime
readiness but still failed because the OpenProject adapter used Node `fetch`,
which did not honor the configured custom `Host` header needed by the current
OpenProject runtime.

## Classification

- owner repo: `operator-orchestration-service`
- related control planes:
  - `operator-orchestration-service`
  - `platform-engineering`
- trust-boundary areas:
  - runtime
  - delivery

## Ownership

- OpenProject adapter implementation owner: `operator-orchestration-service`
- OpenProject runtime env contract owner: `platform-engineering`

## Root Cause

The broker runtime contract already supported `OPENPROJECT_HOST_HEADER`, and the
platform deployment later supplied it, but the adapter still used Node `fetch`
for outbound API calls. In the live container, that path did not send the
requested host override, so OpenProject returned `400 Invalid host_name
configuration` and the broker stayed unready.

## Source Changes

- `src/openproject-client.js`
- `src/runtime.js`
- `test/openproject-client.test.js`

## Artifact And Deployment Evidence

- failing live runtime evidence:
  - broker `/readyz` returned `503`
  - direct in-pod `fetch(..., { headers: { Host: "127.0.0.1:32083" } })`
    against OpenProject still returned:
    - `400 Invalid host_name configuration`
- related platform runtime contract:
  - `OPENPROJECT_HOST_HEADER=127.0.0.1:32083`

## Live Verification

- pending after source promotion:
  - rebuilt broker image deployed through `platform-engineering`
  - broker `/readyz` returns `200`
  - stage `/idea` capture creates a work package in `workspace-proposals`

## Validation

- `npm test`
- live proof before the fix:
  - `fetch(..., { headers: { Host: "127.0.0.1:32083" } })` still returned
    `400 Invalid host_name configuration`
- regression test:
  - default adapter transport now proves the configured host header reaches a
    local HTTP server

## Follow-Up

- rebuild and republish the broker image
- repin the shared runtime digest in `platform-engineering`
- verify broker readiness and continue the stage `/idea` capture rehearsal
