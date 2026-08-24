---
security_evidence:
  review_areas:
    - runtime
    - delivery
  reviewed_artifacts:
    - contracts/delivery-ingress/application-envelope.schema.json
    - contracts/delivery-ingress/target-application-result.schema.json
    - src/delivery-ingress/service.js
    - src/delivery-ingress/proposal-adapter.js
    - src/proposal-workflow/service.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "Owner-repo evidence covers source/version binding, resolved custody, deterministic ingress identity, Proposal compatibility, one-target replay, and reciprocal backlink enforcement. Prototype readiness and application remain fail-closed pending ART children #980 through #982."
---

# 2026-08-25 Neutral Delivery Ingress

## Summary

Added one source-neutral OOS Delivery ingress contract and routed the existing
Proposal handoff through it without changing the Proposal API or receipt.

## Classification

- area: Workspace Delivery ART ingress
- type: owner-repo contract and runtime boundary
- runtime impact: Proposal target application uses the neutral adapter; the
  Prototype source class is contract-admitted and runtime-disabled

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: User story `#979` under Feature `#907` and Epic `#884`
- related products or components: Workspace Proposals, Workspace Prototype
  Studio, Workspace Delivery ART, WGCF, and Governance Operations Console

## Root Cause

- immediate failure: Delivery accepted only the Proposal-specific application
  shape, so adding Prototype could have copied target mutation behavior.
- actual root cause: source identity, packet binding, custody, target identity,
  and receipt evidence were not separated from the Proposal workflow.
- why it escaped earlier controls: the Proposal path was deliberately delivered
  first, before a second accepted source class made neutrality necessary.

## Source Changes

- changed workflow, adapter, or contract: added strict neutral envelope and
  result schemas, deterministic ingress identity, registered source adapters,
  Proposal adaptation, and fail-closed Prototype admission without activation.
- tests or validator added: schema conformance, identity, custody,
  source/evidence binding, unsupported-source, context-binding, target backlink,
  and existing Proposal replay coverage.
- related change records:
  [2026-08-21-proposal-delivery-application.md](2026-08-21-proposal-delivery-application.md)

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only until the
  Landing Unit is merged and replayed in dev-integration
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation: pending CI-equivalent validation against fetched
  `origin/main`
- live or dev-integration verification: pending Proposal replay through the
  accepted-idea-delivery profile after merge-ready source validation
- residual risk: Prototype packet production, WGCF readiness, OOS target
  application, and Console projection remain assigned to `#980` through `#983`

## Follow-Up

- required follow-up: land Prototype packet, readiness, application, and
  projection Landing Units in dependency order
- owner: Workspace Prototype Studio, WGCF, OOS, and Governance Operations
  Console as recorded by Feature `#907`
- due date or closure condition: ART children `#980` through `#983` close with
  finalized Review Packets and reciprocal runtime evidence

## Rollback

Revert the `#979` Landing Unit. Proposal clients retain their current request,
response, receipt, and replay contracts throughout rollback.
