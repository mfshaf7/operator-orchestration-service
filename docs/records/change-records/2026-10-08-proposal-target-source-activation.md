---
security_evidence:
  review_areas:
    - identity
    - secrets
    - delivery
    - runtime
  reviewed_artifacts:
    - security-architecture/docs/reviews/components/2026-10-08-proposal-target-application-trust-boundary.md
    - contracts/proposal-target-application/manifest.json
    - src/proposal-target-application/runtime.js
    - test/proposal-target-boundary.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: Security work item 1235 approved the exact repaired source boundary for bounded dev-integration activation before Platform commissioning in work item 1236.
---

# Proposal Target Source Activation

## Summary

OOS activates the reviewed Proposal target application source gate for the
existing Platform commissioning story `#1236`. This is owner-repo maintenance;
it does not create another ART child or claim that Platform composition and
live operating proof are complete.

## Classification

- area: Proposal-to-Prototype target application
- type: reviewed source activation
- runtime impact: permits Platform to compose the workflow only in the
  `dev-integration` profile

## Ownership

- owner repo: `operator-orchestration-service`
- Security authority: `openproject://work_packages/1235`
- existing activation and commissioning work: `openproject://work_packages/1236`
- target contract owner: `workspace-prototype-studio`

## Root Cause

- immediate failure: the approved source gate remained `false`, so Platform
  could not commission the existing `#1236` runtime path
- actual root cause: the staged activation plan assumed another ART child even
  though the manifest already assigns activation and commissioning to `#1236`
- correction: perform the reviewed OOS source activation as owner-repo
  maintenance and retain Platform commissioning in the existing story

## Source Changes

- changes `contracts/proposal-target-application/manifest.json`
  `runtime_activation` from `false` to `true`
- preserves the exact public-safe Prototype Studio contract pin at
  `eab7af0c44de2e76eb381bf06447105ce3a28863`
- keeps stage, production, remote, shared, multi-user, and AI-driven operation
  outside the admitted boundary
- proves the runtime remains denied outside `dev-integration`

## Artifact And Deployment Evidence

- source activation only; no deployment, credential delivery, or live request
  is claimed by this change
- Platform story `#1236` still owns composition, exact credential delivery,
  loopback runtime proof, rollback, and gate-return acceptance

## Security Evidence

Security review
`docs/reviews/components/2026-10-08-proposal-target-application-trust-boundary.md`
in `security-architecture` approved the repaired Studio and OOS revisions for
this bounded activation step. The source gate remains fail-closed for every
profile except `dev-integration`.

## Validation

- focused Proposal target boundary and runtime tests
- complete owner-repo test suite
- governance documentation and security change-record validation
- CI-equivalent validation against the fetched `origin/main` base

## Live Verification

No live runtime claim is made here. Platform `#1236` must prove the composed
service, dedicated credential, loopback route, and end-to-end acceptance after
this source revision is merged.

## Follow-Up

- owner: `platform-engineering`
- work item: `openproject://work_packages/1236`
- closure condition: the exact activated OOS revision is composed and the
  Proposal-to-Prototype gate-return path passes live `dev-integration` proof

## Rollback

Revert this change to restore `runtime_activation: false`. Platform must not
commission or retain a live Proposal target runtime after that rollback.
