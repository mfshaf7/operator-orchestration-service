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

# 2026-04-24 ART Done-State Narrative Guard

## Summary

`operator-orchestration-service` now fail-closes on weak done-state ART
narrative quality before broker completion or post-close update writes patch
OpenProject. The same closeout signal now surfaces in execution-summary reads
so downstream quality checks can use the identical rule.

## Classification

- owner repo: `operator-orchestration-service`
- related control planes:
  - `platform-engineering`
  - `workspace-governance`
- trust-boundary areas:
  - runtime
  - delivery

## Ownership

- done-state narrative rule source, broker write enforcement, and
  execution-summary signal: `operator-orchestration-service`
- ART quality-gate alignment and runbook use of the new signal:
  `platform-engineering`
- skill and improvement-candidate closure against the stronger guard:
  `workspace-governance`

## Root Cause

The earlier closeout repair only fail-closed on completion-evidence bullet
syntax. Done work could still carry weak narrative structure, especially an
underspecified `Execution Context`, and the broker would not stop it before the
OpenProject write. The markdown-section parser also treated blank lines as
section boundaries, which masked normal paragraph-style narrative bodies as if
they were empty.

## Source Changes

- added the shared narrative rule module in
  [src/delivery-narrative.js](../../../src/delivery-narrative.js)
- updated [src/openproject-client.js](../../../src/openproject-client.js) to:
  - validate a simulated patched payload before `update` writes
  - reject weak done-state narrative during `complete`
  - expose `done_narrative_contract_*` fields in execution-summary nodes
- added [test/delivery-narrative.test.js](../../../test/delivery-narrative.test.js)
- extended [test/openproject-client.test.js](../../../test/openproject-client.test.js)
  with pre-patch rejection coverage for weak done-state narrative
- updated the operator and contract surfaces in:
  - [README.md](../../../README.md)
  - [docs/api/README.md](../../api/README.md)
  - [docs/api/openapi.json](../../api/openapi.json)
  - [docs/contracts/delivery-workflow-api-v1.md](../../contracts/delivery-workflow-api-v1.md)
  - [docs/operations/delivery-workflow-operator-surface.md](../../operations/delivery-workflow-operator-surface.md)

## Artifact And Deployment Evidence

- artifact:
  - shared done-state narrative validator
  - pre-patch broker enforcement on `complete` and `update`
  - execution-summary closeout signal fields for done nodes
- proof:
  - unit coverage for accepted and rejected done-state narrative bodies
  - API and governance doc validation against the updated contract text

## Live Verification

- `node --test test/delivery-narrative.test.js test/completion-evidence.test.js test/openproject-client.test.js`
- `npm test`
- `npm run validate:api-docs`
- `npm run validate:governance-docs`
- `python3 scripts/validate_change_record_requirement.py --repo-root . --against-ref origin/main`
- `git diff --check`

## Follow-Up

- make the platform ART quality checker treat `done_narrative_contract_*`
  issues as hard failures for done items
- close the open ART narrative-style improvement candidate and update the
  delivery skill so future sessions expect the stronger done-state guard
