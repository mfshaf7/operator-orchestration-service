---
security_evidence:
  review_areas:
    - runtime
    - delivery
  reviewed_artifacts:
    - contracts/proposal-workflow/manifest.json
    - contracts/proposal-workflow/command.schema.json
    - contracts/proposal-workflow/projection.schema.json
    - docs/contracts/proposal-workflow-v1.md
    - scripts/sync_proposal_openapi_schemas.mjs
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "This source-only contract admission adds no live route, caller identity, secret, privileged execution, OpenProject mutation, or governed runtime activation."
---

# 2026-08-15 Proposal Workflow Contract Parity

## Summary

Defined the versioned OOS integration boundary required by the graduated
Governance Operations Console Proposal surface while keeping every new runtime
operation explicitly unimplemented.

## Classification

- area: Workspace Proposals workflow integration
- type: API contract admission and fail-closed boundary definition
- runtime impact: source-only; existing Idea routes and OpenProject mutation
  behavior are unchanged

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Enabler `#851` under delivery `#417`
- related products or components:
  - Governance Operations Console
  - Workspace Proposals
  - Operator Orchestration Service

## Root Cause

- immediate failure: the graduated Console had typed Disposition, route,
  repository-gate, Handoff, event, and history semantics that the OOS contract
  did not expose.
- actual root cause: the original broker-owned Idea API and the later Console
  Proposal workflow matured at different times without one explicit parity
  contract separating live operations from future admitted behavior.
- why it escaped earlier controls: fixture-local Console receipts proved the
  operator workflow visually, while OOS contract validation covered only
  implemented routes. Neither boundary tested the complete future integration
  shape.

## Source Changes

- changed workflow, adapter, or contract:
  - added strict Proposal command, projection, event, and history schemas
  - recorded live, contract-admitted, and deferred capabilities in one machine
    manifest
  - generated exact OpenAPI components without adding HTTP paths
  - required canonical Workspace Proposals authority, OOS mutation custody,
    current source version, resolved repository gates, and target-owned Handoff
    receipts
- tests or validator added:
  - valid Triage, Disposition, and Handoff contract cases
  - stale projection, authority bypass, invalid transition, missing route,
    unresolved repository gate, and unsupported applied-Handoff rejection
  - deterministic Proposal schema-to-OpenAPI synchronization in CI
- related change records:
  - [2026-04-19-bounded-idea-decision.md](2026-04-19-bounded-idea-decision.md)
  - [2026-04-19-operator-authored-idea-triage.md](2026-04-19-operator-authored-idea-triage.md)
- security review:
  [OOS runtime admission](https://github.com/mfshaf7/security-architecture/blob/cd3e66c3565d48d0c9510689337c90d7df88d9c7/docs/reviews/components/2026-04-18-operator-orchestration-service-runtime-admission.md)
  remains applicable. The change narrows future integration and does not match
  a repo-rule trigger for a fresh security delta review.

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: both OOS image targets
  built from the PR source head and passed local smoke checks
- image tag or digest: local-only `oos-api:art-851` and
  `oos-orchestration-worker:art-851`; no image was published
- runtime revision: None

## Live Verification

- local validation:
  - `npm test`: `558` passed, `0` failed
  - deterministic orchestration bundle validation passed
  - Proposal and orchestration OpenAPI synchronization checks passed
  - API documentation reported `68` documented and implemented routes
  - governance, change-record, and OpenProject mutation validators passed
    against `origin/main` after this record was added
- live or dev-integration verification: not applicable because this landing
  unit adds no live Proposal operation
- residual risk: the Console cannot consume these semantics until later OOS
  runtime handlers and the separate Console adapter Landing Unit are merged

## Follow-Up

- required follow-up: implement the admitted OOS runtime operations, then wire
  the Console adapter in a separate owner-repo Landing Unit
- owner: Operator Orchestration Service first, Governance Operations Console
  second
- due date or closure condition: separately accepted ART leaves with merged
  Review Packets

## Rollback

Revert PR `#132`. Existing Idea API routes, Workspace Proposals records, and the
graduated Console fixture baseline remain unchanged because this Landing Unit
performs no backend or Console mutation.
