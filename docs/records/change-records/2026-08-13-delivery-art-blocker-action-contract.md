---
security_evidence:
  review_areas:
    - runtime
    - delivery
  reviewed_artifacts:
    - src/delivery-blocker-workflow.json
    - src/delivery-blocker.js
    - src/art-workflow-artifacts.js
    - src/wgcf-art-handshake.js
    - src/openproject-client.js
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-08-13 Delivery ART Blocker Action Contract

## Summary

Made the Delivery ART blocker workflow the canonical source for blocker action
vocabulary and normalized the WGCF-only `record` recommendation alias to the
broker action `set` before managed draft validation or submission.

## Classification

- area: Workspace Delivery ART blocker recommendation handoff
- type: workflow-contract correction and validation hardening
- runtime impact: OOS dev-integration behavior changes after merge and runtime
  reconciliation; no governed stage or production activation

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Defect `#816` under delivery `#698`
- related products or components:
  - Workspace Delivery ART
  - `workspace-governance-control-fabric`
  - `operator-orchestration-service`

## Root Cause

- immediate failure: WGCF blocker recommendations produced managed drafts with
  `action=record`, while the OOS blocker route accepted only `set` or `clear`.
- actual root cause: artifact scaffolding, WGCF handoff, and the OpenProject
  adapter each carried independent blocker-action vocabulary instead of
  consuming one workflow contract.
- why it escaped earlier controls: draft validation did not enforce blocker
  action semantics, so the recommendation draft appeared valid until the later
  broker submission boundary.

## Source Changes

- changed workflow, adapter, or contract:
  - defined allowed actions, default action, and recommendation aliases in
    `src/delivery-blocker-workflow.json`
  - made managed blocker drafts default to canonical `set`
  - normalized WGCF-only `record` to `set` at the recommendation boundary
  - made draft validation and OpenProject mutation consume the same allowed
    action set
  - documented the recommendation-to-broker normalization boundary
- tests or validator added:
  - positive draft creation and WGCF alias normalization
  - negative direct `record` and unsupported `add` action validation
  - HTTP projection of the normalized managed draft
  - broker rejection before any OpenProject request
- related change records:
  - [2026-04-21-delivery-work-item-blocker-surface.md](2026-04-21-delivery-work-item-blocker-surface.md)
- security review:
  [Delivery ART evidence custody and source provenance](https://github.com/mfshaf7/security-architecture/blob/ed294c05a7b7032dd5d00605af57434376237e90/docs/reviews/components/2026-08-09-art-evidence-custody-and-source-provenance.md)
  covers the caller-bound OOS and WGCF handoff. This correction narrows that
  boundary and introduces no new identity, secret, authority, or direct ART
  mutation path.

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source correction pending
  pull-request merge and dev-integration reconciliation
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation:
  - `npm test`: `544` passed, `0` failed
  - `npm run validate:api-docs`: `68` documented routes matched implementation
  - `npm run validate:delivery-art-contracts`: passed
  - `npm run validate:governance-docs`: passed
  - `npm run validate:openproject-mutation-contracts`: passed against
    `origin/main`
  - `npm run validate:change-record-requirement`: passed against `origin/main`
- live or dev-integration verification: pending post-merge reconciliation
- residual risk: the active OOS dev-integration runtime retains the prior draft
  behavior until the merged revision is reconciled

## Follow-Up

- required follow-up:
  - merge the `#816` Landing Unit through its finalized Review Packet
  - reconcile the OOS dev-integration runtime
  - verify one WGCF blocker recommendation produces a managed `set` draft
    without submitting an ART mutation
- owner: `operator-orchestration-service`
- due date or closure condition: before `#816` is closed and `#806` resumes
