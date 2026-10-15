---
security_evidence:
  review_areas:
    - identity
    - secrets
    - delivery
    - runtime
  reviewed_artifacts:
    - security-architecture/docs/reviews/components/2026-10-15-repository-custody-controlled-activation.md
    - contracts/repository-custody
    - src/repository-custody
    - test/repository-custody-contract.test.js
    - test/repository-custody-runtime.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: Security work item 1302 accepts the existing custody and provisioning boundary for bounded dev-integration source activation; Platform 1291 retains credential commissioning and live-proof ownership.
---

# Repository Custody Source Activation

## Summary

OOS activates the existing repository-custody workflow for the reviewed local
`dev-integration` composition. The same Landing Unit synchronizes the current
Workspace Governance authority bundle so OOS and WGCF evaluate identical
policy and schema bytes.

## Classification

- area: repository custody and provisioning
- type: reviewed source activation and authority synchronization
- runtime impact: permits Platform to compose the workflow only in the local
  `dev-integration` profile

## Ownership

- owner repo: `operator-orchestration-service`
- Security authority: `openproject://work_packages/1302`
- source activation work: `openproject://work_packages/1288`
- Platform commissioning: `openproject://work_packages/1291`
- fixture-free operating proof: `openproject://work_packages/1298`

## Root Cause

- immediate failure: repository provisioning from the Console reported that
  the live custody integration was unavailable
- actual root cause: the implemented OOS workflow remained `contract-only` and
  pinned an authority digest older than the current WGCF readiness contract
- correction: synchronize the current canonical bundle, bind the exact
  Security decision, activate only the two reviewed actions, and deny runtime
  construction outside `dev-integration`

## Source Changes

- synchronizes the current Workspace Governance repository-custody authority
  and schema bundle byte-for-byte
- changes the OOS runtime gate from disabled to the Security-reviewed local
  `dev-integration` posture
- activates only `link-existing` and `provision-new`; repository lifecycle
  remains separately gated
- binds Security `#1302`, Platform `#1291`, and operating proof `#1298`
- requires `OOS_RUNTIME_PROFILE=dev-integration` whenever the runtime is
  enabled
- preserves distinct read-only and provisioning credentials, pinned provider
  destination, redirect denial, idempotency, recovery, readback, and receipts

## Validation

- exact upstream bundle digest comparison
- focused repository-custody contract, client, runtime, workflow, HTTP, store,
  replay, recovery, and denial tests
- generated OpenAPI synchronization
- complete owner-repository test and governance validation
- CI-equivalent validation against fetched `origin/main`

## Artifact And Deployment Evidence

- source evidence: this Landing Unit's finalized Review Packet
- image or deployment revision: none; Platform `#1291` owns the exact-source
  deployment and runtime evidence
- Security decision: merged Security review for `#1302`

## Live Verification

No current live availability is claimed by this source change. Platform
`#1291` must deploy the exact merged revision, mint and project fresh tokens
for both dedicated GitHub Apps, and prove rollback and revocation. Console
`#1298` must then complete the real fixture-free repository gate.

## Follow-Up

- owner: `platform-engineering` for commissioning and
  `governance-operations-console` for the final Console-only proof
- work items: `#1291` and `#1298`
- closure condition: fresh dedicated credentials, exact deployed revisions,
  real repository provisioning, canonical readback, denial, restart, rollback,
  revocation, and restored normal availability all pass

## Rollback

Revert this Landing Unit to restore the disabled source gate and prior
authority bundle. Platform must remove the runtime projections and revoke
issued tokens without deleting a repository or its retained governance
evidence.
