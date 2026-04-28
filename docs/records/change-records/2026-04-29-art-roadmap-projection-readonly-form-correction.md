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

# 2026-04-29 ART Roadmap Projection Read-Only Form Correction

## Summary

Corrected the broker roadmap-projection fix after live OpenProject preflight
proved the public work-package form exposes roadmap `version` allowed values but
marks the field read-only. The broker now keeps canonical `Target PI` writes
working and reports when the derived roadmap projection requires platform sync
instead of failing the operator workflow.

## Classification

- area: delivery workflow
- type: defect correction and contract clarification
- runtime impact: delivery work-item create, update, plan/apply, and completion
  writes that carry `Target PI`

## Ownership

- owner repo: `operator-orchestration-service`
- platform projection owner: `platform-engineering`
- related ART slice:
  - `#362` `Introduce universal governed work-tracking home controls for meaningful changes`
  - `#366` `Enabler: Enforce shell-to-execution and work-home declaration gates`
  - `#375` `Defect: generic work-item writes leave Target PI roadmap version drift`

## Root Cause

The previous broker patch assumed that if OpenProject exposed matching roadmap
version values, the broker could write `_links.version` through the public
work-package API. Live devint form validation disproved that assumption: the
form schema exposed `_embedded.allowedValues` for `version`, but
`version.writable` was `false`, and validation rejected `_links.version` with
`PropertyIsReadOnly`.

## Source Changes

- updated [src/openproject-client.js](../../../src/openproject-client.js) to:
  - parse allowed values from both `_links.allowedValues` and
    `_embedded.allowedValues`
  - keep canonical `Target PI` writes independent from roadmap `version`
    writability
  - write `_links.version` only when the live form marks `version` writable and
    exposes the desired value
  - return `roadmap_version_projection.status =
    external_reconciler_required` when platform projection is required
- extended [test/openproject-client.test.js](../../../test/openproject-client.test.js)
  with read-only roadmap version coverage
- updated the delivery API contract and operator surface to state that
  `Target PI` is canonical and roadmap `version` is a derived projection

## Artifact And Deployment Evidence

- artifact:
  - broker writes no longer fail normal delivery work-item mutation when
    OpenProject marks `version` read-only
  - response payloads expose the projection state instead of hiding derived
    roadmap drift behind a successful canonical write
- deployment:
  - accepted-idea devint broker rollout is required after merge before live
    `#375` repair is complete

## Live Verification

- live preflight proved `version._embedded.allowedValues` includes
  `PI-2026-02`, while `version.writable` is `false`
- live form validation rejected `_links.version = /api/v3/versions/5` with
  `PropertyIsReadOnly`
- pending after merge: restart accepted-idea devint broker from merged `main`
- pending after merge: run the platform-owned delivery ART view sync to repair
  the derived roadmap projection for `#374` and `#375`
- pending after merge: rerun scoped `#362` ART quality with `INCLUDE_DONE=true`

## Follow-Up

- complete `#375` only after the merged broker tolerates read-only roadmap
  forms, platform projection sync repairs live drift, and the scoped ART quality
  gate passes
