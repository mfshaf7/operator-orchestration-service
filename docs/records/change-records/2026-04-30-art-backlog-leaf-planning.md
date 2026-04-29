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

# 2026-04-30 ART Backlog Leaf Planning Fix

## Summary

Relaxed the delivery ART planning controls so backlog `Feature` work can carry
`new` planned `User story` children as non-executable future decomposition
without fake PI commitment or retirement.

## Classification

- area: delivery workflow
- type: defect correction
- runtime impact: broker ART create, move, planning-state, and documentation
  surfaces

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice:
  - `#420` `Build Workspace Governance Control Fabric foundation for scalable validation, evidence, and admission`
  - `#467` `Defect: Relax ART planning controls for non-executable backlog User story decomposition`

## Root Cause

The previous control treated every open `User story` without `Target PI` as
invalid and required every story move or creation to use a PI-committed parent.
That blocked a legitimate enterprise planning shape: preserving future-phase
decomposition in ART while keeping that future scope non-executable and
uncommitted.

## Source Changes

- updated [src/delivery-planning-workflow.json](../../../src/delivery-planning-workflow.json)
  to distinguish planned backlog `User story` children from executable story
  scope
- updated [src/openproject-client.js](../../../src/openproject-client.js) so
  create and move guards require a committed parent only for executable
  `User story` and `Task` work
- updated [test/openproject-client.test.js](../../../test/openproject-client.test.js)
  and [test/delivery-service.test.js](../../../test/delivery-service.test.js)
  for the relaxed planning-state and decommit behavior
- updated broker operator/API docs to state the non-executable backlog
  decomposition rule

## Artifact And Deployment Evidence

- artifact:
  - `User story` is no longer an always-`Target PI`-required structural type
  - active, executable, or PI-committed `User story` work still requires
    `Target PI`
  - executable `User story` and `Task` work still requires a PI-committed
    parent
- live form contract evidence:
  - this change does not introduce a new OpenProject writable field or
    `allowedValues` dependency
  - the live `#467` create probe exercised the existing work-package form
    schema for status, type, assignee, responsible, and delivery custom fields
  - the probe reported `version_field_read_only`, so roadmap `version`
    projection remains externally reconciled when OpenProject marks that field
    not writable
- deployment:
  - local source change only at this point
  - no devint broker rollout has been performed yet

## Live Verification

- `npm test`
- `npm run validate:api-docs`
- `npm run validate:openproject-mutation-contracts`
- `npm run validate:governance-docs`
- `npm run validate:change-record-requirement`
- `git diff --check`

## Follow-Up

- merge the broker fix before repairing the live `#420` future-phase records
- keep the platform ART quality contract synchronized with the broker planning
  workflow mirror
