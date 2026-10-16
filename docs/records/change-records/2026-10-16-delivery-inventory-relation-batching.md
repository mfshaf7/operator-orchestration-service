---
security_evidence:
  review_areas: [runtime, delivery]
  workstreams: [WS-007]
  reviewed_artifacts: [src/openproject-client.js, test/openproject-client.test.js]
  notes: Existing authenticated read-only relation API and authority are unchanged; batch size is bounded at 100 record IDs and backend errors remain failures.
---

# 2026-10-16 Delivery inventory relation batching

## Summary

Replace per-item relation reads with bounded batches through the existing
OpenProject involved-relation helper. The live Delivery register took 34–67
seconds while repeatedly reading dependencies for the entire historical ART.

## Classification

- area: canonical Delivery inventory and initiative dependency reads
- type: owner-repo maintenance for read-path latency
- runtime impact: fewer backend round trips; no cache, altered eligibility or mutation

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: existing Epic 1275 journey item 1298; maintenance repair, no new child
- related products or components: Governance Operations Console and OpenProject

## Root Cause

- immediate failure: live Delivery inventory took tens of seconds and startup reads could time out.
- actual root cause: project-state construction awaited one authenticated relation query per work package.
- why it escaped earlier controls: correctness fixtures covered dependencies but did not require batching.

## Source Changes

- changed workflow, adapter, or contract: source construction now queries up to 100 involved IDs at a time, preserving bidirectional edges, pagination, deduplication and external hydration.
- tests or validator added: canonical dependency fixture proves incoming, outgoing and external relations survive a single bounded read instead of six per-record requests.
- related change records: Platform 2026-10-16-post-crash-runtime-health.md

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: Landing Unit maintenance-1275-runtime-health-oos; exact-head CI and native images required before landing.
- image tag or digest: recorded in normal reviewed build and activation evidence; not yet operating proof.
- runtime revision: activation follows exact Security acceptance of merged owners.

## Live Verification

- local validation: full broker tests and CI-equivalent contract, documentation, source-base and image checks required before publication.
- live or dev-integration verification: compare actual Console inventory latency and canonical dependency readback after reviewed activation; do not substitute fixture timing.
- residual risk: backend outages remain visible failures; batching does not waive stale-source or authorization checks.

## Follow-Up

- required follow-up: exact-source Security acceptance, activation, operating readback and Landing Unit cleanup.
- owner: operator-orchestration-service
- due date or closure condition: before resuming the existing fixture-free to-do journey.
