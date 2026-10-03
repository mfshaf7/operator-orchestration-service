# Delivery ART Architecture V5 Activation

## Summary

OOS selects Architecture Packet v5 as the only current authoring and new-work
shape after Workspace Governance recorded the completed consumer, Security,
and active-session inventory gates.

## Classification

- area: Delivery ART architecture, work-session, and evidence lifecycle
- type: controlled dev-integration contract activation
- runtime impact: v5 packets may be persisted and authorize new work; v1-v4
  remain immutable read-only compatibility

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Epic #1203 recovery maintenance after work item #1228
- related products or components: Workspace Delivery ART work sessions,
  Review Packets, and owner evidence acquisition

## Root Cause

- immediate failure: v5 consumer behavior was present but deliberately dormant
- actual root cause: activation required coordinated Workspace Governance,
  OOS, WGCF, Security, and live-session evidence
- why it escaped earlier controls: not applicable; staged support intentionally
  failed closed until the activation gates completed

## Source Changes

- changed workflow, adapter, or contract: current architecture version changes
  from v4 to v5; v4 joins v1-v3 as historical read-only evidence
- tests or validator added: current/historical posture, persistence, cutover,
  work-start, OpenAPI, and full regression coverage
- related change records:
  `2026-10-03-delivery-art-architecture-v5-consumer-support.md` and
  `security-architecture/docs/reviews/components/2026-10-03-delivery-art-architecture-v5-evidence-ownership.md`

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source activation; joint
  OOS/WGCF dev-integration deployment is required before runtime use
- image tag or digest: pending joint dev-integration deployment
- runtime revision: pending joint dev-integration deployment

## Live Verification

- local validation: focused Delivery ART tests, generated OpenAPI validation,
  full Node suite, governance docs, and base-aware change-record validation
- live or dev-integration verification: pending joint OOS/WGCF deployment
- residual risk: mixed deployed versions fail closed; do not persist the Epic
  #1203 v5 packet until both consumers report v5 current

## Follow-Up

- required follow-up: activate WGCF, deploy both revisions together, verify
  live current-version parity, repeat the bound-session inventory, then persist
  the Epic #1203 v5 packet
- owner: `workspace-governance-control-fabric`, `platform-engineering`, and
  `operator-orchestration-service`
- due date or closure condition: Epic #1203 has a durable v5 packet and the
  activation runtime evidence is recorded

## Security Boundary

The approved Security delta permits this activation only in dev-integration.
It adds no new caller, credential, approval, merge, readiness, deployment, or
ART-close authority. Stage and production require separate review.

## Rollback

Revert the activation commit and deploy the last v4-current OOS/WGCF pair.
Existing v1-v4 artifacts remain immutable and readable throughout rollback.
