---
security_evidence:
  review_areas:
    - delivery
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-04-29 ART Closeout Surface Quality Guard

## Summary

Tightened the ART completion evidence guard so `Changed Surfaces` cannot be a
bare file or PR inventory. Each changed-surface bullet now has to explain what
changed on that surface, code-format source paths, and link or URL PR
references.

## Classification

- area: delivery workflow
- type: defect correction
- runtime impact: broker completion and done-item update validation
- ART slice: `#392` closeout-quality defect under delivery `#378`

## Ownership

- owner repo: `operator-orchestration-service`
- related ART work:
  - `#378` top-level Epic
  - `#380` Review Packet and mutation draft Feature
  - `#392` Defect for generic unexplained done narrative acceptance

## Root Cause

The broker checked for required completion sections and basic evidence prefixes,
but it did not distinguish operator-readable changed-surface explanations from
bare file lists. That allowed schema-valid done bodies to pass even when the
result was materially weaker than prior accepted ART records such as `#370`.

## Source Changes

- updated [src/completion-evidence.js](../../../src/completion-evidence.js) so
  changed-surface bullets reject placeholders, bare paths, raw PR references,
  unformatted source paths, and unexplained terse entries
- extended [test/completion-evidence.test.js](../../../test/completion-evidence.test.js)
  with positive and negative coverage for explained changed surfaces
- updated the API contract, OpenAPI examples, and operator surface docs to show
  the stronger changed-surface rule

## Artifact And Deployment Evidence

- artifact:
  - completion evidence validation now rejects #378-style bare changed-surface
    inventories before broker completion or done-item update can patch
    OpenProject
  - the local completion-evidence preflight uses the same rule source as the
    broker runtime
- deployment:
  - source change is in the OOS PR for `#392`
  - live devint verification must run after merge and broker rollout

## Live Verification

- `node --test test/completion-evidence.test.js`
- `npm test`
- `npm run validate:api-docs`
- `npm run validate:governance-docs`
- `npm run validate:change-record-requirement`
- live devint completion validation after merge and broker rollout

## Follow-Up

- merge the OOS defect PR
- roll the accepted-idea-delivery devint broker deployment
- submit the #378 done-note repair draft only after the live guard is present
- complete `#392` with a finalized Review Packet covering the source change
