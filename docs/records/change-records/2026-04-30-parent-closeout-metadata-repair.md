# 2026-04-30 Parent Closeout Metadata Repair

## Summary

Allow a PI-committed Feature with terminal child leaf scope to receive required closeout metadata repair without reopening child work, while preserving the open-leaf guard for normal active Feature execution.

## Classification

- area: delivery ART broker workflow
- type: defect fix
- runtime impact: source-only broker behavior change pending deployment

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: `#478`
- related products or components: Workspace Delivery ART broker adapter

## Root Cause

- immediate failure: #435 could not close because it missed required Feature execution metadata.
- actual root cause: the completion and stale-open closeout routes required the metadata, but the generic update route blocked the metadata repair because the active Feature no longer had an open User story or Defect child.
- why it escaped earlier controls: the leaf-front guard covered normal active Feature work, but did not distinguish terminal-child parent closeout repair from ordinary in-progress Feature mutation.

## Source Changes

- changed workflow, adapter, or contract: `src/openproject-client.js` now allows terminal-child Feature closeout metadata repair only when all leaf children are terminal and the change set is limited to closeout metadata fields.
- tests or validator added: `test/openproject-client.test.js` covers the allowed metadata repair and the still-denied non-metadata update.
- related change records: None.

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only PR validation.
- image tag or digest: None.
- runtime revision: None.

## Live Verification

- local validation: `node --test test/openproject-client.test.js`; broader suite before merge.
- live or dev-integration verification: #435 blocker clear and closeout after merge.
- residual risk: source change must be merged before the live broker can perform the repaired #435 update path.

## Follow-Up

- required follow-up: clear #435 blocker and close #435 after the broker fix lands.
- owner: `operator-orchestration-service`
- due date or closure condition: #478 complete and #435 closeout succeeds.
