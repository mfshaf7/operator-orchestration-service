# 2026-08-21 Source Proposal closeout

## Summary

Bind terminal Delivery initiative closeout to an idempotent source Proposal
transition, preserve completed ART state when the source write is pending, and
provide dry-run-first historical reconciliation for exact backlinks.

## Classification

- area: Proposal-to-Delivery lifecycle integrity
- type: workflow and OpenProject adapter correction
- runtime impact: additive response fields, one internal reconciliation route,
  and a post-Delivery source closeout attempt

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Workspace Delivery ART `#873`
- related products or components: Workspace Proposals and Workspace Delivery ART

## Root Cause

- immediate failure: terminal Delivery closeout did not close its source
  Proposal, leaving accepted Proposal records after successful Delivery
- actual root cause: source closeout existed only as a separate manually
  invoked route and was not part of the terminal initiative result
- why it escaped earlier controls: consumption and closeout contracts were
  validated independently without an end-to-end terminal lifecycle assertion

## Source Changes

- changed workflow, adapter, or contract: terminal initiative closeout now
  emits a source-closeout receipt; Proposal closeout is replay-safe; historical
  reconciliation is exact-backlink and dry-run first, and apply requires the
  reviewed candidate digest before any source mutation
- tests or validator added: service, HTTP, OpenProject adapter, API-schema,
  failed-source, replay, mismatched-backlink, retired, and unauthorized cases
- related change records: None

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only Landing Unit;
  deployment remains outside ART `#873`
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation: `npm test` passed 582 tests; API docs, Proposal schema
  synchronization, Delivery ART contract synchronization, orchestration schema
  synchronization and bundle build, governance docs, change-record requirement,
  and OpenProject mutation-contract validators passed
- live or dev-integration verification: pending merge and later runtime proof
- residual risk: the source closeout can remain pending after Delivery succeeds;
  the receipt exposes the exact idempotent retry route

## Follow-Up

- required follow-up: land dependent Platform and Workspace Governance
  projections in the architecture packet merge order
- owner: Workspace Delivery ART `#870`
- due date or closure condition: Feature `#870` operating readiness
