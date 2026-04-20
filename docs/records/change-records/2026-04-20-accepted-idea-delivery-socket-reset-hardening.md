---
security_evidence:
  review_areas:
    - delivery
    - runtime
---

# 2026-04-20 accepted-idea delivery socket-reset hardening

## Summary

Hardened the broker OpenProject transport for the internal accepted-idea
delivery route by disabling pooled socket reuse in the Node HTTP request path.

This change follows a governed runtime miss discovered during the first live
accepted-idea delivery rehearsal:

- capture, triage, decision, and accepted lookup succeeded
- the broker route `POST /v1/ideas/{idea_id}/consume` failed with
  `backend_unavailable`
- the lower-level OpenProject client sequence still succeeded in a fresh
  process

That pattern pointed to stale socket reuse in the long-running broker runtime
rather than a contract mismatch in the delivery project model itself.

## Classification

- owner repo: `operator-orchestration-service`
- related control planes:
  - `operator-orchestration-service`
  - `platform-engineering`
- trust-boundary areas:
  - delivery
  - runtime

## Ownership

- broker source fix owner: `operator-orchestration-service`
- shared runtime digest pin owner: `platform-engineering`
- security review owner: `security-architecture`

## Root Cause

The broker uses direct Node HTTP requests for its OpenProject adapter.
In the admitted long-running runtime, the multi-step consume route widened the
request sequence enough to expose `socket hang up` failures that did not appear
in one-shot diagnostics.

Disabling pooled socket reuse keeps the transport simple and removes the stale
connection path from the broker-to-OpenProject boundary.

## Source Changes

- [src/openproject-client.js](../../src/openproject-client.js)
- [test/openproject-client.test.js](../../test/openproject-client.test.js)

## Artifact And Deployment Evidence

- source branch fix commit:
  - pending until this branch lands
- rebuilt broker image:
  - pending after merge to `main`
- shared runtime digest repin:
  - pending in `platform-engineering`

## Live Verification

- local source validation:
  - `npm test`
  - `node --check src/openproject-client.js`
- governed runtime verification:
  - pending after rebuilt image rollout to the shared broker deployment
  - rerun the live accepted-idea consume route and backlink proof after repin

## Follow-Up

- merge and rebuild the broker image on `main`
- repin the shared runtime digest in `platform-engineering`
- rerun the governed accepted-idea delivery rehearsal against the live broker
  route
