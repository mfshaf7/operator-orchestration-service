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

# 2026-04-29 OpenProject Mutation Contract Gate

## Summary

Added a PR-time gate for broker OpenProject mutation changes so adapter work no
longer reaches review without changed regression coverage and change-record
evidence for the live OpenProject form contract.

## Classification

- area: delivery workflow
- type: governance validator
- runtime impact: none until a future PR changes OpenProject mutation behavior

## Ownership

- owner repo: `operator-orchestration-service`
- control-plane closure owner: `workspace-governance`
- related learning record:
  - `workspace-governance/reviews/improvement-candidates/2026-04-29-broker-openproject-writable-contract-preflight-regression.yaml`

## Root Cause

The previous roadmap projection repair sequence proved that a broker adapter
patch can look locally plausible while the live OpenProject work-package form
marks the target field read-only. A durable guard needs to fail future mutation
PRs that change OpenProject adapter or delivery mutation surfaces without
proving the live form schema evidence in tests and in the change record.

## Source Changes

- added [scripts/validate_openproject_mutation_contracts.py](../../../scripts/validate_openproject_mutation_contracts.py)
  to detect OpenProject mutation-surface changes and require matching tests plus
  change-record evidence
- added `npm run validate:openproject-mutation-contracts`
- wired the new validator into the governance-docs GitHub workflow for PRs
- documented the gate in the change-record lane README

## Artifact And Deployment Evidence

- artifact:
  - the validator checks changed OpenProject mutation surfaces against changed
    regression tests and changed change records
  - the evidence markers include `allowedValues`, form schema, writable,
    read-only, `PropertyIsReadOnly`, and roadmap projection state
- deployment:
  - no runtime deployment is required; this is a repository governance gate

## Live Verification

- `python3 scripts/validate_openproject_mutation_contracts.py --repo-root . --changed-file src/openproject-client.js --changed-file test/openproject-client.test.js --changed-file docs/records/change-records/2026-04-29-openproject-mutation-contract-gate.md`
- `npm run validate:governance-docs`
- `npm run test`

## Follow-Up

- Close the workspace-governance broker/OpenProject writable-contract
  regression candidate only after this OOS gate has landed and the
  workspace-governance record points at the merged control.
