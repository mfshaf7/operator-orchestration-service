---
security_evidence:
  review_areas:
    - identity
    - delivery
    - runtime
  reviewed_artifacts:
    - src/prototype-closure/source-client.js
    - src/prototype-closure/service.js
    - src/app.js
    - docs/api/openapi.json
  workstreams:
    - WS-007
  notes: "Read-only current Studio binding for Console Closure; runtime activation remains false."
---

# Prototype Closure Preparation

## Summary

ART #1148 adds a caller-bound, read-only preparation endpoint so the Console
can build Closure requests from the current committed Studio revision and
record digest. This is a prerequisite for Console #1108, not a new transition.

## Classification

- Area: Prototype Closure operator API.
- Type: source-only extension of an inactive workflow.

## Root Cause

The existing Closure submit route required the current Studio record digest
but exposed no caller-bound way for the Console to read it.

## Ownership

`operator-orchestration-service` owns this API. Studio remains source authority.

## Ownership And Boundary

- Owner: `operator-orchestration-service`.
- Source authority: `workspace-prototype-studio` committed `main`.
- The endpoint returns lifecycle, custody, revision, and digest without
  creating a request or changing Studio source.
- Existing caller authentication and Closure authorization apply. The
  workflow remains inactive until separate Security and Platform gates.

## Source Changes

Add a committed-source read, validated append-only Closure history summaries,
a bounded preparation route, generated OpenAPI, operator guidance, and
source/service/HTTP regression tests. Source events are not terminal OOS
receipts; the Console must read request-specific receipts separately.

## Artifact And Deployment Evidence

The source PR is the delivery artifact. No runtime image, deployment, or
activation is claimed by this change.

## Live Verification

No live Closure invocation is claimed. Source and local validation are listed
below; the composed check remains in ART #1109.

## Verification

- Full OOS suite and opt-in exact Studio source test.
- Generated OpenAPI route parity and governance-doc checks.
- Base-aware change-record check and an explicit inactive-runtime finding.

## Rollback

Revert this route and source read independently of the existing four-action
Closure coordinator. No Studio history or target acceptance is changed.

## Follow-Up

Console #1108 consumes the preparation. Security #1140, Platform #1107, and
composed conformance #1109 remain separate gates.
