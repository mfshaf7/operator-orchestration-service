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

# 2026-04-29 ART Broker Target-PI And Context-Placement Fixes

## Summary

Corrected two broker delivery-control defects found while decomposing `#362`:

- `plan/apply` created committed child items without persisting canonical
  `Target PI` or the derived roadmap `version` on the first write
- broker markdown rewrites could repair malformed `Execution Context` bullets
  after the fact while still allowing the section to move behind later
  sections such as `Operator work notes`

## Classification

- area: delivery workflow
- type: defect correction
- runtime impact: broker ART planning and work-item description rewrite paths

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice:
  - `#362` `Introduce universal governed work-tracking home controls for meaningful changes`
  - `#373` `Defect: plan/apply create path drops Target PI on new planned child items`
  - `#374` `Defect: broker appends or repairs Execution Context instead of preserving section placement`

## Root Cause

The `plan/apply` create path handled normal delivery custom fields but did not
apply the dedicated `Target PI` field handling used by other broker write
paths. Existing children could later be updated, which made a second
`plan/apply` appear to repair the issue.

The markdown section helper removed a section and appended the replacement to
the end of the description. That made cleanup tests pass for some malformed
records, but it was not a first-class fix because broker notes and execution
context synchronization in the same write could still reorder the narrative
sections.

## Source Changes

- updated [src/openproject-client.js](../../../src/openproject-client.js) to:
  - set `Target PI` during `plan/apply` create and update writes
  - set the matching roadmap `version` whenever a planned child write sets
    `Target PI` and the version is already provisioned
  - replace existing markdown sections in place and remove duplicates instead
    of deleting and appending the replacement at the end
- extended [test/openproject-client.test.js](../../../test/openproject-client.test.js)
  with:
  - create-path `plan/apply` Target PI plus version projection regression
  - update-path `plan/apply` Target PI plus version projection regression
  - execution-context position regression when broker work notes and context
    synchronization happen in one write
- updated broker operator and contract docs to define the first-class ownership
  split:
  - broker writes keep committed planned children internally coherent
  - platform sync remains the provisioning, backfill, and repair surface

## Artifact And Deployment Evidence

- artifact:
  - broker `plan/apply` create and update paths now write `Target PI` and the
    matching roadmap `version` together for planned child writes
  - markdown section replacement is order-preserving and de-duplicates repeated
    section headings
  - broker docs describe the ownership split between live coherent writes and
    platform-owned projection repair
- deployment:
  - local source change only at this point
  - no devint broker rollout has been performed yet

## Live Verification

- `npm test -- test/openproject-client.test.js`
- `npm test`
- `npm run validate:api-docs`
- `npm run validate:governance-docs`
- `npm run validate:change-record-requirement`
- `git diff --check`

## Follow-Up

- complete `#373` and `#374` through the ART completion workflow after this
  branch is reviewed and merged
- keep the platform roadmap sync as the repair path for historical records,
  not as a substitute for coherent broker writes
