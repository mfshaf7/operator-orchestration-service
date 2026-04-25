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

# 2026-04-25 ART Retired Roadmap Bucket

## Summary

Corrected the broker roadmap projection model so retired ART scope without
canonical `Target PI` no longer appears in the backlog bucket `Not yet
committed to a PI`. It now projects to the separate derived roadmap bucket
`Retired scope`.

## Classification

- area: delivery workflow
- type: contract and projection correction
- runtime impact: bounded ART quality-pack and workflow-health read surfaces

## Ownership

- owner repo: `operator-orchestration-service`
- related ART items:
  - `#247` `Apply the extraction gate and, if justified, extract a standalone governance engine`
  - `#343` `Feature: Package and consume a standalone governance engine after the extraction gate is approved`
  - `#344` `Feature: Activate bounded governed AI runtime assist after extraction is approved`

## Root Cause

The broker and platform admin surfaces both treated blank `Target PI` as a
single derived bucket with no inactive-scope exception. That made retired
superseded scope project into the uncommitted backlog bar even though it was no
longer backlog work.

## Source Changes

- mirror the canonical retired roadmap bucket in the broker workflow contract:
  - `src/delivery-planning-workflow.json`
- project retired blank-`Target PI` work into `Retired scope` inside the broker
  quality-pack and workflow-health surfaces:
  - `src/openproject-client.js`
- expose the additional roadmap bucket in surfaced tests and API examples:
  - `test/delivery-service.test.js`
  - `test/http.test.js`
  - `docs/api/openapi.json`
- document the retired roadmap bucket in the broker API and operator surface:
  - `docs/contracts/delivery-workflow-api-v1.md`
  - `docs/operations/delivery-workflow-operator-surface.md`
  - `dev-integration/profiles/accepted-idea-delivery/README.md`

## Artifact And Deployment Evidence

- local broker code and contract update only
- live devint verification depends on the platform-owned delivery-art view sync
  projecting retired scope into the new bucket

## Live Verification

- `npm test`
- `npm run validate:api-docs`
- `npm run validate:governance-docs`
- live workflow-health and quality-pack reads should expose:
  - `unassigned_bucket = Not yet committed to a PI`
  - `retired_bucket = Retired scope`

## Follow-Up

- run the platform-owned delivery-art view sync against devint
- confirm `#343` and `#344` leave the roadmap backlog bar and land in
  `Retired scope`
