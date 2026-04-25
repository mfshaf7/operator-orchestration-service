---
security_evidence:
  review_areas:
    - delivery
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-04-25 ART Probe Nullable Response Contracts

## Summary

Corrected the documented ART response contracts so the supported probe accepts
legitimate nullable projection fields that the live broker already returns for
parking, completion, stale-open closeout, move responses, and initiative/work-item
projection reads.

## Classification

- area: delivery workflow
- type: contract correction
- runtime impact: bounded broker API documentation and validation only

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice:
  - `#247` `Apply the extraction gate and, if justified, extract a standalone governance engine`

## Root Cause

The runtime projections already allowed nulls for states such as uncommitted
`Target PI`, cleared `PM² Phase`, retired parking `review_date`, and absent
operator-note application, but `docs/api/openapi.json` still declared several of
those fields as non-null strings or omitted them entirely. `npm run api:probe`
therefore surfaced false contract failures even when the live broker write had
succeeded.

## Source Changes

- updated the OpenAPI component schemas and examples for nullable projection
  fields and note-application metadata:
  - `docs/api/openapi.json`
- documented the nullable response behavior in the primary delivery API
  contract:
  - `docs/contracts/delivery-workflow-api-v1.md`
- added an API-doc validator guard so those response fields stay nullable in
  future edits:
  - `scripts/validate_api_docs.mjs`

## Artifact And Deployment Evidence

- local contract and validator update only
- no runtime code or deployment behavior changed

## Live Verification

- `npm run validate:api-docs`
- `npm run api:probe -- POST /v1/delivery-work-items/343/parking --body-file /tmp/art-343-retire.json`
- `npm run api:probe -- POST /v1/delivery-work-items/344/parking --body-file /tmp/art-344-retire.json`

## Follow-Up

- close the nullable-response improvement candidates in `workspace-governance`
  once the contract update is landed on `main`
