---
security_evidence:
  review_areas:
    - identity
    - delivery
    - runtime
  reviewed_artifacts:
    - contracts/repository-custody
    - contracts/repository-custody-workflow
    - src/repository-custody
    - src/app.js
    - docs/api/openapi.json
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-08-29 Repository Provisioning Workflow

## Summary

Extended the OOS repository-custody workflow with idempotent provisioning for
new GitHub organization repositories. The workflow consumes the exact WGCF
decision, checkpoints before mutation, creates at most once without fresh
absence proof, verifies provider settings through separate readback, and emits
custody evidence without admitting the repository downstream.

## Classification

- area: repository custody
- type: operator workflow API and provider mutation adapter
- runtime impact: source complete; normal runtime remains disabled

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: User story `#1046` under Delivery `#888`
- related components: Workspace Governance authority, WGCF readiness, GitHub
  application identity, Governance Operations Console Repository operation

## Root Cause

- immediate gap: the repository-custody workflow could verify an existing
  repository but could not safely create an approved new repository
- actual root cause: provisioning authority, readiness, provider mutation,
  durable recovery, and readback had not yet been composed behind one command
- why it escaped earlier controls: the initial custody slice intentionally
  delivered link-existing first while the provisioning contract was unresolved

## Control Boundary

- Workspace Governance owns request and evidence semantics.
- WGCF owns the exact allowed or denied provisioning decision.
- OOS owns idempotency, provider command sequencing, recovery, and receipts.
- GitHub owns physical repository state and immutable provider identity.
- Platform and Security own application identity delivery and acceptance.

## Source Changes

- synchronized the `#1054` provisioning authority bundle byte-for-byte
- added applying checkpoints and request-scoped asynchronous locking
- added exact organization create, canonical lookup, immutable-ID readback, and
  README initialization proof
- added uncertain-outcome recovery without provider deletion or blind duplicate
  creation
- generalized the existing HTTP command path for link and provision actions
- added focused contract, provider, service, HTTP, storage, and replay tests

## Artifact And Deployment Evidence

- source landing evidence is carried by the finalized ART Review Packet
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation: 33 focused custody tests and 890 full-repository tests pass;
  API/docs, Temporal bundles, OpenProject guards, and container smoke pass
- live or dev-integration verification: injected sandbox-runtime proof only
- residual risk: application identity and normal runtime remain unavailable
  until the downstream gates complete

## Follow-Up

- required follow-up: complete ART `#1047`, `#1048`, and `#1049`; no provider
  credential, live organization mutation, downstream admission, or product
  ownership mutation is included here
- owner: Security Architecture, Platform Engineering, and Governance Operations
  Console
- due date or closure condition: finalized Review Packets for the three
  downstream gates
