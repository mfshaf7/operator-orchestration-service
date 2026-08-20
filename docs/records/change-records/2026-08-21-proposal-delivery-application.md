---
security_evidence:
  review_areas:
    - runtime
    - delivery
  reviewed_artifacts:
    - src/proposal-workflow/service.js
    - src/proposal-workflow/state.js
    - contracts/proposal-workflow/handoff-application.schema.json
    - contracts/proposal-workflow/handoff-application-result.schema.json
    - docs/operations/proposal-workflow-operator-surface.md
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "Owner-repo evidence covers caller binding, source-version checks, repository gates, deterministic replay, and partial-success recovery. It does not replace Security Architecture child #878."
---

# 2026-08-21 Proposal Delivery Application

## Summary

Activated the OOS-owned operation that applies one prepared, accepted Proposal
handoff to canonical Delivery intake without duplicating the target on replay
or interrupted responses.

## Classification

- area: Workspace Proposals to Workspace Delivery ART integration
- type: owner-repo runtime implementation
- runtime impact: adds one authenticated Proposal target-application route and
  reuses the existing canonical Delivery intake adapter

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: User story `#875` under Feature `#874` and Epic `#868`
- related products or components: Governance Operations Console, Workspace
  Proposals, Workspace Delivery ART, Operator Orchestration Service

## Root Cause

- immediate failure: a prepared Proposal handoff had no typed operation that
  could apply it to Delivery and return target-owned evidence.
- actual root cause: the Proposal command boundary intentionally stopped at
  handoff preparation, while the older Idea consume route was not bound to the
  new Proposal source version, packet, receipt, and event contracts.
- why it escaped earlier controls: target application was explicitly deferred
  when the versioned Proposal API first went live.

## Source Changes

- changed workflow, adapter, or contract: added the source-version-bound
  `POST /v1/proposals/{proposal_id}/handoff/apply` operation, deterministic
  application receipts, applied-handoff state projection, immutable event
  evidence, exact replay, and canonical-refetch recovery for committed target,
  state, or event writes.
- tests or validator added: strict request/result schema tests, HTTP route
  coverage, service success and replay tests, stale and caller-binding guards,
  repository gate rejection, target-backlink partial-success repair, and
  committed-write socket-loss recovery.
- related change records:
  [2026-08-16-proposal-workflow-live-api.md](2026-08-16-proposal-workflow-live-api.md)

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only until the
  Console adapter and dev-integration proof children land
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation: `589` tests passed; Proposal, orchestration, and Delivery
  ART schema synchronization, API documentation, governance documentation,
  change-record, OpenProject mutation-contract, and whitespace checks passed
  against fetched `origin/main`
- live or dev-integration verification: assigned to child `#877` after OOS
  child `#875` and Console child `#876` merge in order
- residual risk: Prototype target application remains deferred; security
  review and evidence are assigned to child `#878`

## Follow-Up

- required follow-up: merge the Console adapter, run the disposable
  Console-to-OOS-to-OpenProject proof, and complete Security review
- owner: Governance Operations Console, Operator Orchestration Service, and
  Security Architecture as recorded by Feature `#874`
- due date or closure condition: children `#876`, `#877`, and `#878` close
  through finalized Review Packets or valid non-source evidence

## Rollback

Revert the `#875` OOS Landing Unit. Existing versioned Proposal command and
projection routes and the legacy Idea consume route remain available; Console
clients must stop calling the handoff application route before rollback.
