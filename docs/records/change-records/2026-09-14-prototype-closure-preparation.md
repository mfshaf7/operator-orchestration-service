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

## Ownership And Boundary

- Owner: `operator-orchestration-service`.
- Source authority: `workspace-prototype-studio` committed `main`.
- The endpoint returns lifecycle, custody, revision, and digest without
  creating a request or changing Studio source.
- Existing caller authentication and Closure authorization apply. The
  workflow remains inactive until separate Security and Platform gates.

## Verification

- Full OOS suite and opt-in exact Studio source test.
- Generated OpenAPI route parity and governance-doc checks.
- Base-aware change-record check and an explicit inactive-runtime finding.

## Rollback

Revert this route and source read independently of the existing four-action
Closure coordinator. No Studio history or target acceptance is changed.
