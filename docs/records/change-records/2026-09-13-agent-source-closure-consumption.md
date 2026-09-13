---
security_evidence:
  review_areas:
    - identity
    - secrets
    - runtime
    - delivery
  reviewed_artifacts:
    - contracts/delivery-art-work-session/agent-source-identity.json
    - test/delivery-art-agent-source-identity.test.js
    - docs/operations/delivery-workflow-operator-surface.md
  notes: "Exact seven-repository consumer scope remains one-repository-per-session; Platform owns custody and Security #1145 owns the scope decision."
---

# Agent Source Closure Consumption

## Summary

ART #1147 admits Control Fabric and Console as Agent Gary source-work owners in
OOS, after Security #1145 and Platform #1146 merged their separate boundaries.

## Classification

- area: Delivery ART source identity and pull-request publication
- type: source-backed consumer contract extension
- runtime impact: existing `accepted-idea-delivery` dev-integration profile only

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: #1147 under Feature #921 and Epic #892
- related components: Platform source identity, Security review, GitHub App

## Root Cause

- immediate failure: OOS still admitted five repositories while the provider and Platform definition now admit seven.
- actual root cause: consumer activation was intentionally sequenced after the Security decision and Platform provider proof.
- why it escaped earlier controls: this is a planned gated extension, not an earlier runtime defect.

## Source Changes

- Pin the merged Platform definition and Security #1145 review in the OOS consumer contract.
- Add the two exact repository names and provider IDs without changing the one-repository-per-session rule or the denied powers.
- Test both new owners and an unapproved owner against the existing adapter; update the operator surface.

## Artifact And Deployment Evidence

- Source-only contract and test change; no stage or production deployment.
- Image tag or digest: None.
- Runtime revision: None until the admitted dev-integration profile consumes the merged source.

## Live Verification

- Local validation: focused Agent source identity and source-executor tests, contract validation, and OOS docs validation required before review.
- Dev-integration verification: inspect one-repository projection and reject unapproved owners after the merged source is activated.
- Residual risk: Platform provider installation and key custody remain separate authorities; OOS must not infer authorization from GitHub installation membership alone.

## Follow-Up

- required follow-up: activate and verify the merged OOS consumer in dev-integration, then unblock the exact next Closure source work.
- owner: OOS and Platform Engineering.
- closure condition: #1147 Review Packet finalized with merged source and scoped runtime evidence.
