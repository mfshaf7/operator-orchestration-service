---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - src/catalog/http-client.js
    - src/config.js
    - src/runtime.js
    - test/catalog-clients.test.js
    - test/config.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "This correction reuses the admitted OpenProject host configuration, retains bearer authentication and the streaming one-megabyte response budget, and adds no browser, stage, production, or mutation authority."
---

# 2026-08-26 Catalog OpenProject Host Binding

## Summary

Corrected Delivery ART `#1021`: Catalog control calls now use a host-aware Node
transport and apply the admitted OpenProject Host binding.

## Classification

- area: Delivery Catalog backend adapter
- type: dev-integration runtime correction
- runtime impact: Catalog projection and mutation calls fail closed without a
  valid Host binding and reach the existing OpenProject control route when the
  binding is valid

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Defect `#1021` under Feature `#909` and delivery `#884`
- related boundaries: OpenProject Catalog control route and OOS Catalog adapter

## Root Cause

- immediate failure: Catalog projection returned `backend_projection_failed`
  while direct host-aware OpenProject requests succeeded
- actual root cause: the Catalog adapter used Node `fetch`, which did not send
  its attempted Host override
- why it escaped earlier controls: tests injected a fetch implementation and
  asserted authentication and payload binding but did not exercise the default
  socket transport or the Host header received by a server

## Source Changes

- add a Catalog-owned streaming Node HTTP transport
- require and apply `OPENPROJECT_HOST_HEADER` for Catalog backend calls
- preserve bearer authentication, bounded error mapping, and the one-megabyte
  response limit
- add fail-closed configuration tests and a loopback transport proof

## Artifact And Deployment Evidence

- source-backed OOS Landing Unit only
- Node 22 API and orchestration-worker images build and pass their local smoke
- no stage or production deployment is claimed

## Live Verification

- local validation: all OOS tests, deterministic workflow bundles, API and
  governance validators, and container smoke pass
- dev-integration verification: exact merged runtime proof is owned by `#1020`
- residual risk: none beyond the pending merged-composition proof

## Follow-Up

- `#1020` must launch the exact merged revision and prove Catalog projection,
  Refinement execution boundaries, and reverse teardown
- owner: Workspace Delivery ART Feature `#909`
- closure condition: finalized `#1020` non-source runtime evidence

## Rollback

Revert this adapter correction, its tests, and this record together. Preserve
OpenProject data, composition namespaces, credentials, Console behavior, stage,
and production.
