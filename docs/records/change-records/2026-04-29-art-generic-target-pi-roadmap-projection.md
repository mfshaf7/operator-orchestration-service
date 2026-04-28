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

# 2026-04-29 ART Generic Target-PI Roadmap Projection Fix

## Summary

Corrected the broader broker roadmap-projection defect exposed after closing
`#374`: generic delivery work-item create, update, and completion writes now
keep canonical `Target PI` and roadmap-compatible `version` aligned instead of
leaving PI-committed work dependent on a later platform view-sync repair.

Correction: follow-up live preflight showed the public OpenProject form can mark
`version` read-only even when it exposes matching allowed values. The durable
contract is corrected in
[2026-04-29-art-roadmap-projection-readonly-form-correction.md](2026-04-29-art-roadmap-projection-readonly-form-correction.md):
the broker writes `version` only when the live form marks it writable and
otherwise reports `external_reconciler_required`.

## Classification

- area: delivery workflow
- type: defect correction
- runtime impact: broker delivery work-item create, update, and completion
  paths

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice:
  - `#362` `Introduce universal governed work-tracking home controls for meaningful changes`
  - `#366` `Enabler: Enforce shell-to-execution and work-home declaration gates`
  - `#375` `Defect: generic work-item writes leave Target PI roadmap version drift`

## Root Cause

The previous broker fix correctly covered `plan/apply`, but the generic
work-item create path still set only the custom `Target PI` field. The generic
update and completion paths also had no shared projection repair, so a
PI-committed item could remain or become done with `version=null` even though
`Target PI` was present.

## Source Changes

- updated [src/openproject-client.js](../../../src/openproject-client.js) to:
  - centralize Target PI to roadmap `version` projection in one helper
  - apply the helper from `plan/apply`, generic work-item create, generic
    update, and completion writes
  - keep validation ordering intact so planning and done-narrative errors are
    still reported before backend projection resolution errors
- extended [test/openproject-client.test.js](../../../test/openproject-client.test.js)
  with explicit create, update, and completion assertions for the outgoing
  roadmap `version` payload
- updated broker contract and operator docs so platform view sync is documented
  as backfill/repair, not the normal substitute for coherent broker writes

## Artifact And Deployment Evidence

- artifact:
  - broker create/update/complete paths now share the same projection helper as
    `plan/apply`
  - regression tests assert `version` is written on the concrete OpenProject
    request payloads
- deployment:
  - devint broker rollout is required after merge because the active lane mounts
    this repository checkout into the running pod

## Live Verification

- `npm test -- test/openproject-client.test.js`
- pending after merge: restart accepted-idea devint broker from merged `main`
- superseded by follow-up correction: repair live `#374` and `#375` through the
  platform-owned projection sync because live OpenProject marks `version`
  read-only for the broker form
- pending after merge: rerun scoped `#362` ART quality with `INCLUDE_DONE=true`

## Follow-Up

- complete `#375` only after merged source is loaded in devint and the scoped
  ART quality gate proves the live roadmap projection drift is gone
