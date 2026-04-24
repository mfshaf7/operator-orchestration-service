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

# 2026-04-24 ART Taxonomy Machine Governance

## Summary

`operator-orchestration-service` now enforces the machine-readable ART taxonomy
instead of relying on title conventions alone. The broker canonicalizes
delivery work-item type and execution classification, rejects unsupported fake
types such as structural `Enabler`, accepts structural `Defect`, and now allows
top-level initiative governance updates to carry the required assignee and
responsible principals so initiative closeout can remain inside the supported
broker path.

## Classification

- owner repo: `operator-orchestration-service`
- related control planes:
  - `platform-engineering`
  - `workspace-governance`
- trust-boundary areas:
  - delivery
  - runtime

## Ownership

- ART write-path type governance, canonicalization, and initiative update
  enforcement: `operator-orchestration-service`
- OpenProject project configuration, taxonomy backfill, and quality checks:
  `platform-engineering`
- ART operator doctrine and improvement-candidate closure:
  `workspace-governance`

## Root Cause

The ART model had drifted into two conflicting taxonomies:

- machine type in OpenProject
- visible subject prefix in the item title

That allowed fake `Enabler:` work items to exist as `Feature` or `Task`,
prevented reliable filtering by true type, and left the broker unable to govern
new work consistently. During the fix, a second seam appeared: top-level Epic
completion requires assignee and responsible fields, but the supported
initiative governance route could not update them, leaving the final initiative
closeout outside the broker's normal control surface.

## Source Changes

- added [src/delivery-taxonomy.js](../../../src/delivery-taxonomy.js) as the
  broker-owned taxonomy normalizer for:
  - allowed structural types
  - execution classification
  - derived subject prefixes
- updated [src/openproject-client.js](../../../src/openproject-client.js) to:
  - reject unsupported structural types that the live OpenProject form does not
    expose
  - map structural `Defect` cleanly
  - canonicalize initiative and work-item projections against the taxonomy
  - accept `assigneeLogin` and `responsibleLogin` on initiative governance
    updates
  - surface `assignee_login` and `responsible_login` on returned initiative
    records
- updated [src/delivery-service.js](../../../src/delivery-service.js) and
  [src/app.js](../../../src/app.js) so the initiative governance route accepts
  and forwards:
  - `assignee_login`
  - `responsible_login`
- updated [test/openproject-client.test.js](../../../test/openproject-client.test.js)
  so the initiative governance test now proves:
  - assignee and responsible are resolved from the live form schema
  - the patch payload writes them through the supported route
  - the returned initiative projection exposes them
- updated the operator and API surfaces in:
  - [docs/api/openapi.json](../../api/openapi.json)
  - [docs/contracts/delivery-workflow-api-v1.md](../../contracts/delivery-workflow-api-v1.md)
  - [docs/operations/delivery-workflow-operator-surface.md](../../operations/delivery-workflow-operator-surface.md)

## Artifact And Deployment Evidence

- artifact:
  - broker-owned machine taxonomy enforcement for ART creates and updates
  - supported initiative governance path now covers required assignment fields
- proof:
  - the broker rejects unsupported structural `Enabler` inputs against the live
    OpenProject form schema
  - the initiative governance route now supports the same assignment fields that
    initiative closeout requires

## Live Verification

- `node test/openproject-client.test.js`
- `npm test`
- `npm run validate:api-docs`
- `npm run validate:governance-docs`
- `python3 scripts/validate_change_record_requirement.py --repo-root . --against-ref origin/main`
- `git diff --check`
- direct devint broker proof rejected structural `Enabler` creation with
  `validation_failure`
- direct devint broker proof now allows initiative governance assignment repair
  before Epic completion

## Follow-Up

- complete the remaining top-level initiative `#263` through the supported
  initiative governance and completion surfaces
- keep the OpenProject-side taxonomy project configuration and the broker
  taxonomy contract aligned so machine type drift remains fail-closed
