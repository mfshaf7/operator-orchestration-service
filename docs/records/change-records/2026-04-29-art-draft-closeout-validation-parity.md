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

# 2026-04-29 ART Draft Closeout Validation Parity

## Summary

Fixed the ART closeout evidence guard so code-formatted changed-surface paths
are not rejected because nearby prose contains slash terms such as `read/write`
or `export/import`.

Mutation draft validation now also preflights bulk-update description changes
that carry completion sections, so malformed done-state evidence is reported by
`draft validate` before `draft submit` reaches the live write route.

## Classification

- area: delivery workflow
- type: defect correction
- runtime impact: broker mutation draft validation and done-state description
  update validation
- ART slice: `#392` closeout-quality defect under delivery `#378`

## Ownership

- owner repo: `operator-orchestration-service`
- related ART work:
  - `#378` top-level Epic
  - `#380` Review Packet and mutation draft Feature
  - `#392` Defect for closeout quality guard parity

## Root Cause

The closeout evidence guard removed code spans before scanning for raw paths,
but the remaining prose still contained normal slash terms such as `read/write`
and `export/import`. The raw-path detector treated those terms as unformatted
paths and rejected otherwise valid done-state notes.

The mutation draft validator also only checked artifact shape, route ownership,
scratch references, placeholders, and operation-level schema version. It did
not run the same completion-evidence validation for bulk-update description
payloads that the submit route runs after it previews a done item.

## Source Changes

- updated [src/completion-evidence.js](../../../src/completion-evidence.js) so
  raw path detection only catches path-like tokens, not ordinary prose slash
  terms
- updated [src/art-workflow-artifacts.js](../../../src/art-workflow-artifacts.js)
  so `work-item.bulk-update` mutation drafts validate completion sections in
  description updates before submit
- extended [test/completion-evidence.test.js](../../../test/completion-evidence.test.js)
  with slash-term false-positive regression coverage
- extended [test/art-workflow-artifacts.test.js](../../../test/art-workflow-artifacts.test.js)
  with draft-validation parity coverage for done description updates
- updated [docs/operations/delivery-workflow-operator-surface.md](../../operations/delivery-workflow-operator-surface.md),
  [docs/contracts/delivery-workflow-api-v1.md](../../contracts/delivery-workflow-api-v1.md),
  and [docs/api/openapi.json](../../api/openapi.json) to document the stronger
  mutation draft validation behavior

## Artifact And Deployment Evidence

- artifact:
  - the repaired #378 done-note draft now passes mutation-draft validation with
    explained changed surfaces that include code-formatted paths and normal
    prose slash terms
  - malformed bulk-update description evidence is now rejected before submit
- deployment:
  - source change is in the OOS PR for `#392`
  - live devint verification must run after merge and broker rollout

## Live Verification

- `node --test test/completion-evidence.test.js test/art-workflow-artifacts.test.js`
- `npm run art -- draft validate .art/drafts/delivery-378-done-note-repair.json`
- `npm test`
- `npm run validate:api-docs`
- `npm run validate:governance-docs`
- `npm run validate:change-record-requirement`
- `git diff --check`

## Follow-Up

- merge the OOS defect PR
- roll the accepted-idea-delivery devint broker deployment
- submit the #378 done-note repair draft through the live broker after rollout
- complete `#392` with a finalized Review Packet covering the source change
