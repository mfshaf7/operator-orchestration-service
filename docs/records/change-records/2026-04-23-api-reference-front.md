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

# 2026-04-23 API Reference Front

## Summary

`operator-orchestration-service` now carries a canonical API reference front
for the current broker route surface.

The new front uses one machine-readable OpenAPI source plus a Redoc rendering
layer so route discovery no longer depends on scanning the root README,
workflow docs, and change records separately.

The front now also explains what each endpoint is for, distinguishes
operator-facing and internal-only writes more clearly, and shows concrete
request and response examples so operators do not have to infer payload shape
from tests or source code.

## Classification

- owner repo: `operator-orchestration-service`
- related control planes:
  - `workspace-governance`
- trust-boundary areas:
  - runtime
  - delivery

## Ownership

- API reference source, route drift validation, and repo entrypoint updates:
  `operator-orchestration-service`
- workflow meaning and operator sequencing:
  existing workflow/operator docs in `operator-orchestration-service`

## Root Cause

The broker route surface is large enough now that prose-only route inventories
in the root README and workflow docs are no longer a sufficient API front.
Without one canonical route reference, new endpoints become harder to review,
internal-only routes are easier to blur with operator-facing commands, and
route-surface drift is more likely.

The first Redoc pass also exposed a second weakness: request contracts were
modeled first, but multiple response contracts were still generic or only
lightly declared. That made the rendered API front look stronger on input than
on output and left blank or vague response samples on important routes.

## Source Changes

- added `docs/api/openapi.json` as the canonical route contract source
- added a static Redoc front in `docs/api/index.html`
- added `docs/api/README.md` as the human entrypoint for the API front
- added `scripts/show_api_contract.mjs` plus `npm run api:contract -- <METHOD> <PATH>`
  so future work can start from one fast route-contract lookup instead of
  reopening the whole spec or tracing handlers first
- added `scripts/probe_api_contract.mjs` plus `npm run api:probe -- <METHOD> <PATH>`
  so live broker reads can be checked directly against the documented response
  contract from the approved `k3s kubectl` path
- added `scripts/validate_api_docs.mjs` to compare the documented route
  surface to the implemented route surface in `src/app.js`
- added `test/api-contract.test.js` so documented examples and representative
  broker responses are checked against the documented response schemas
- deepened `openapi.json` with operation-level intent, request-body guidance,
  and concrete request examples for every broker write route
- replaced generic response shells on broker write routes with explicit
  response schemas and added concrete examples for key broker reads
- corrected the `GET /v1/delivery-initiatives` response contract so it matches
  the actual broker shape (`initiatives`, `project`, `summary`, `workflow_id`)
- added machine-readable route metadata (`x-oos-surface`,
  `x-oos-primary-caller`, `x-oos-owner`, `x-oos-workflow-family`) so the API
  front can drive tooling as well as human reading
- tightened the API-doc validator so `/v1/...` routes now require an operation
  description, every broker route requires a response example, and broker
  write routes cannot fall back to `GenericObjectResponse`
- added `npm run validate:api-docs`
- updated the root README to point to the new API reference front
- updated repo guidance so existing broker route work starts from the OpenAPI
  contract and lookup command before code tracing

## Artifact And Deployment Evidence

- artifact:
  - local static API front under `docs/api/`
- proof:
  - local `npm run validate:api-docs` output

## Live Verification

- `npm run validate:api-docs`
- `npm test`
- `npm run validate:governance-docs`
- `python3 scripts/validate_change_record_requirement.py --repo-root . --against-ref origin/main`
- `git diff --check`

## Follow-Up

- keep route semantics in the workflow docs and treat the API front as the
  contract/reference layer
- continue replacing lightly declared nested response payloads with stronger
  component schemas as the broker route families stabilize
