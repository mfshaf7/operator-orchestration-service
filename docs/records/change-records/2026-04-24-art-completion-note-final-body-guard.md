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

# 2026-04-24 ART Completion-Note Final-Body Guard

## Summary

`operator-orchestration-service` now validates the final stored ART closeout
body before patching OpenProject whenever a completion or done-item update adds
a broker note. This closes the seam where a broker-added note could leak into
`Validation Evidence` even though the user-supplied completion payload had
already passed local preflight.

## Classification

- owner repo: `operator-orchestration-service`
- related control planes:
  - `workspace-governance`
- trust-boundary areas:
  - runtime
  - delivery

## Ownership

- broker write-path integrity, note placement, and final-body validation:
  `operator-orchestration-service`
- improvement-candidate closure against the repeated closeout regression:
  `workspace-governance`

## Root Cause

The earlier ART closeout guard only preflighted the user-supplied completion
sections. When a work item already contained `## Operator work notes`,
`appendOperatorWorkNote(...)` appended the new broker note to the end of the
entire description instead of back into that section. On a completed record,
that turned the broker note into a stray `Validation Evidence` bullet and
allowed malformed stored markdown even though the input payload itself was
valid.

## Source Changes

- updated [src/openproject-client.js](../../../src/openproject-client.js) to:
  - keep broker-added notes inside the existing `Operator work notes` section
  - validate completion evidence on the final stored body before `complete`
    patches OpenProject
  - validate completion evidence on the final stored body before `update`
    patches a work item that remains `done`
- extended [test/openproject-client.test.js](../../../test/openproject-client.test.js)
  with:
  - a completion-path regression test for note placement
  - a done-item update regression test for note placement
  - a done-item update rejection test for malformed stored completion evidence
- updated the broker operator and API surfaces in:
  - [README.md](../../../README.md)
  - [docs/api/README.md](../../api/README.md)
  - [docs/api/openapi.json](../../api/openapi.json)
  - [docs/contracts/delivery-workflow-api-v1.md](../../contracts/delivery-workflow-api-v1.md)
  - [docs/operations/delivery-workflow-operator-surface.md](../../operations/delivery-workflow-operator-surface.md)

## Artifact And Deployment Evidence

- artifact:
  - stronger operator-note placement logic in the broker write path
  - final-body completion-evidence validation before `complete`
  - final-body completion-evidence validation before done-item `update`
- proof:
  - unit coverage for both completion and done-item update note placement
  - contract/governance docs updated to describe final-body validation rather
    than only user-payload preflight

## Live Verification

- `node test/openproject-client.test.js`
- `npm test`
- `npm run validate:completion-evidence -- /tmp/oos-completion-evidence-sample.json`
- `npm run validate:api-docs`
- `npm run validate:governance-docs`
- `python3 scripts/validate_change_record_requirement.py --repo-root . --against-ref origin/main`
- `git diff --check`
- direct raw OpenProject read of `#217` from the active devint broker pod proved
  the malformed broker note had been stored under `Validation Evidence` before
  this fix

## Follow-Up

- repair the stored `#217` ART record so the broker note moves back into
  `Operator work notes`
- close the open completion-note preflight regression candidate after the live
  repair and local validation are both complete
