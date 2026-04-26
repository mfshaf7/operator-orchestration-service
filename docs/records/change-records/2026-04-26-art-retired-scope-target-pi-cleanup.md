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

# 2026-04-26 ART Retired Scope Target PI Cleanup

## Summary

Corrected the broker retirement paths so retired ART scope can clear stale
canonical `Target PI`, reset to the canonical uncommitted iteration, and drop
concrete schedule dates instead of remaining falsely committed or scheduled
after retirement.

## Classification

- area: delivery workflow
- type: planning-state and roadmap-truth correction
- runtime impact: bounded ART parking, quality-pack, and workflow-health surfaces

## Ownership

- owner repo: `operator-orchestration-service`
- related ART items:
  - `#251` `Activate bounded governed AI runtime assist after parity, audit, and approval gates are satisfied`
  - `#360` `Defect: Allow retired PI-committed story-shaped work to clear stale Target PI and move cleanly into Retired scope`
  - `#346` `User story: Preserve a broker-first governed triage path`
  - `#347` `User story: Preserve a broker-first operator acceptance path`

## Root Cause

The delivery taxonomy and retirement paths still treated `PI Objective`, `User
story`, `Task`, and `Milestone` as unconditionally `Target PI`-required, and
they left schedule dates behind even after PI commitment was cleared. That was
correct for active or committed execution work, but wrong for retired scope. As
a result, superseded retired work could not return fully to inactive backlog
posture through the supported broker workflow, and the broker quality/read
surfaces did not flag the stale commitment explicitly.

## Source Changes

- allow retired work to omit `Target PI` while still enforcing the canonical
  uncommitted backlog iteration:
  - `src/delivery-taxonomy.js`
- retire PI-committed work through parking by clearing `Target PI`, resetting
  `Iteration` to `Not committed to a PI iteration yet.`, and dropping stale
  schedule dates:
  - `src/openproject-client.js`
- retire initiatives by clearing stale top-level `Target PI` during the
  initiative-governance path:
  - `src/openproject-client.js`
- flag retired work that still retains `Target PI` inside broker quality-pack and
  workflow-health projection health:
  - `src/openproject-client.js`
- add regression coverage for retired planning-state validation and retire
  parking cleanup:
  - `test/openproject-client.test.js`
- document the retired cleanup semantics on the broker parking surface:
  - `docs/contracts/delivery-workflow-api-v1.md`

## Artifact And Deployment Evidence

- local broker contract and parking workflow update
- live ART cleanup should use the supported parking surface after the code lands

## Live Verification

- `npm test`
- `npm run validate:api-docs`
- `npm run validate:governance-docs`
- `python3 scripts/validate_change_record_requirement.py --repo-root . --against-ref origin/main`
- live retired cleanup should prove:
  - `#346` and `#347` clear `Target PI`
  - `#69` clears stale `startDate` and `dueDate`
  - both move into `Retired scope`
  - workflow-health and quality-pack expose zero retired PI-retention drift

## Follow-Up

- run the corrected retire path on `#346` and `#347`
- re-check scoped quality for epic `#251`
- keep the platform sweep aligned so retired-scope PI retention fails closed in
  both repos
