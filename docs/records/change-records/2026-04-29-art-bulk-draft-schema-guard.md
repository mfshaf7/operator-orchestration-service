---
security_evidence:
  review_areas:
    - delivery
    - runtime
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-04-29 ART Bulk Draft Schema Guard

## Summary

Corrected the broker-owned mutation draft workflow so generated
`work-item.bulk-update` drafts include the required broker input schema version
and draft validation rejects that defect before submit.

## Classification

- area: delivery workflow
- type: defect correction
- runtime impact: ART mutation draft generation and validation for bulk
  work-item updates
- ART slice: `#391` bulk-update mutation draft schema-version defect under
  delivery `#378`

## Ownership

- owner repo: `operator-orchestration-service`
- related ART work:
  - `#378` top-level Epic
  - `#380` Review Packet and mutation draft Feature
  - `#391` Defect for the bulk-update mutation draft schema guard

## Root Cause

The local draft template for `work-item.bulk-update` produced a payload with
`input.updates` but omitted `input.schema_version`. The live broker route
correctly requires `input.schema_version: 1`, while mutation-draft validation
only checked artifact-level shape, route ownership, placeholders, and scratch
references. That let a generated draft validate locally and then fail at
submit time.

## Source Changes

- updated [src/art-workflow-artifacts.js](../../../src/art-workflow-artifacts.js)
  so `work-item.bulk-update` draft templates include `input.schema_version: 1`
- extended mutation-draft validation to reject missing or incorrect
  operation-required input schema versions before submit
- extended [test/art-workflow-artifacts.test.js](../../../test/art-workflow-artifacts.test.js)
  with generation and validation regression coverage

## Artifact And Deployment Evidence

- artifact:
  - generated bulk-update mutation drafts now match the live broker route
    contract
  - validation catches the same class of payload schema defect before the
    operator submits the draft
- deployment:
  - source change is in the OOS PR for `#391`
  - live devint verification must be rerun after merge and broker rollout

## Live Verification

- `node --test test/art-workflow-artifacts.test.js`
- `npm test`
- `npm run validate:api-docs`
- `npm run validate:governance-docs`
- `npm run validate:change-record-requirement`
- `git diff --check`

## Follow-Up

- merge the OOS defect PR
- roll the devint broker deployment so the live CLI uses the corrected draft
  template
- regenerate or repair the delivery `#378` metadata-repair draft through the
  managed draft workflow and complete `#391` with a finalized Review Packet
