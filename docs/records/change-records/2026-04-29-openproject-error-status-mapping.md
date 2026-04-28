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

# 2026-04-29 OpenProject Error Status Mapping

## Summary

Corrected broker HTTP error mapping so operator-resolvable OpenProject/domain
errors preserve their client-actionable status instead of being flattened to
`502`. This is required for the ART Epic-shell continuation guard: requesting a
top-level delivery `Epic` must return HTTP `422` with
`initiative_epic_not_executable`.

## Classification

- area: delivery workflow
- type: API error contract
- runtime impact: operator-facing delivery API responses

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice:
  - `#362` `Introduce universal governed work-tracking home controls for meaningful changes`
  - `#366` `Enabler: Enforce shell-to-execution and work-home declaration gates`
  - `#367` `Enabler: Fail closed when an ART Epic shell is treated as executable`

## Root Cause

The broker already carried `OpenProjectError.statusCode`, but the HTTP adapter
always returned `502` for every `OpenProjectError`. That was correct for backend
authentication or availability failures, but wrong for broker/domain validation
failures that operators can fix directly.

## Source Changes

- updated [src/app.js](../../../src/app.js) to preserve 4xx statuses for
  operator-resolvable error classes while keeping upstream authentication
  failures as `502`
- extended [test/http.test.js](../../../test/http.test.js) with route-level
  coverage for `422` validation errors and retained `502` upstream auth failures
- documented `422` on the continuation-context OpenAPI route and delivery
  workflow API contract
- updated the API probe tooling to resolve OpenAPI response `$ref`s before
  validating non-`200` live responses

## Artifact And Deployment Evidence

- artifact:
  - `validation_failure` with status `422` remains a typed operator-facing
    failure instead of a backend failure
  - upstream auth failures remain backend failures to avoid confusing broker
    caller authorization with OpenProject service authorization
  - `npm run api:probe` can validate the documented `422` response through the
    shared `ValidationError` response component
- deployment:
  - devint broker rollout is required after merge before live verification

## Live Verification

- pending after merge: restart accepted-idea devint broker from merged `main`
- pending after merge: `GET /v1/delivery-work-items/work-item-362/continuation-context`
  returns HTTP `422` with `initiative_epic_not_executable`
- pending after merge: `GET /v1/delivery-work-items/work-item-367/continuation-context`
  still returns the child execution context

## Follow-Up

- complete `#367` only after the corrective PR is merged, devint is restarted,
  and the live negative probe validates the documented `422` response
