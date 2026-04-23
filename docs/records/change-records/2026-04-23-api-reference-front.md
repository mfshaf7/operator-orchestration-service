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
request examples so operators do not have to infer payload shape from tests or
source code.

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

## Source Changes

- added `docs/api/openapi.json` as the canonical route contract source
- added a static Redoc front in `docs/api/index.html`
- added `docs/api/README.md` as the human entrypoint for the API front
- added `scripts/validate_api_docs.mjs` to compare the documented route
  surface to the implemented route surface in `src/app.js`
- deepened `openapi.json` with operation-level intent, request-body guidance,
  and concrete request examples for every broker write route
- tightened the API-doc validator so `/v1/...` routes now require an operation
  description and every broker write route requires request-body examples
- added `npm run validate:api-docs`
- updated the root README to point to the new API reference front

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
- keep enriching response schemas and examples as more broker route families
  stabilize
