---
security_evidence:
  review_areas:
    - identity
    - secrets
    - delivery
    - runtime
    - ai
  reviewed_artifacts:
    - security-architecture/docs/reviews/components/2026-10-09-model-profile-lifecycle-operating-boundary.md
    - contracts/model-profile-request/manifest.json
    - src/model-profile-request/runtime.js
    - test/model-profile-request.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: Security work item 1243 reviews the exact OOS, Platform, and Console revisions before this bounded dev-integration source activation can merge; Platform work item 1241 retains composition and live-proof ownership.
---

# Model Profile Request Source Activation

## Summary

OOS activates the reviewed model-profile request source gate for existing
Platform commissioning story `#1241`. This is owner-repo maintenance required
by the already-approved cross-repo sequence. It does not create another ART
child or claim that Platform composition and live operating proof are complete.

## Classification

- area: governed model-profile request workflow
- type: reviewed source activation
- runtime impact: permits Platform to compose the workflow only in the
  `dev-integration` profile

## Ownership

- owner repo: `operator-orchestration-service`
- Security authority: `openproject://work_packages/1243`
- existing activation and commissioning work: `openproject://work_packages/1241`
- profile registry and lifecycle owner: `platform-engineering`

## Root Cause

- immediate failure: the delivered OOS request workflow remained source-gated,
  so Platform could not commission the existing `#1241` runtime path
- actual root cause: source activation ownership was left unresolved until the
  downstream Security review even though OOS owns its runtime construction gate
- correction: review the exact cross-repo boundary first, then merge this OOS
  owner-maintenance activation and retain Platform commissioning in `#1241`

## Source Changes

- changes the model-profile request manifest activation from disabled to the
  bounded `dev-integration` profile
- requires `OOS_RUNTIME_PROFILE=dev-integration` at runtime construction
- keeps stage, production, remote, shared, multi-user, and direct provider
  operation outside the admitted boundary
- preserves Platform registry and lifecycle authority and separate Security
  acceptance for individual activation or exception requests

## Artifact And Deployment Evidence

- source activation only; no deployment, credential delivery, registry
  mutation, or live request is claimed by this change
- Platform story `#1241` still owns composition, dedicated configuration,
  loopback runtime proof, rollback, and gate-return acceptance

## Security Evidence

Security review
`docs/reviews/components/2026-10-09-model-profile-lifecycle-operating-boundary.md`
in `security-architecture` must approve the exact OOS candidate revision plus
the merged Platform and Console revisions before this source change merges.

## Validation

- focused model-profile boundary and runtime tests
- complete owner-repo test suite
- API documentation, governance documentation, and change-record validation
- CI-equivalent validation against the fetched `origin/main` base

## Live Verification

No live runtime claim is made here. Platform `#1241` must compose the exact
activated OOS revision and prove OOS, Platform, Console, and Security evidence
through the bounded `dev-integration` operating path.

## Follow-Up

- owner: `platform-engineering`
- work item: `openproject://work_packages/1241`
- closure condition: the exact activated OOS revision is composed and the
  model-profile operating path passes live `dev-integration` proof

## Rollback

Revert this change to restore a disabled source gate. Platform must not
commission or retain the live model-profile request runtime after that rollback.
