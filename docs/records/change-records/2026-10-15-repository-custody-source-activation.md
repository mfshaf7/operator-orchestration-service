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

The maintenance continuation adds authenticated, bounded request enumeration
over the same retained custody records so the Console can recover its register
after reload. It preserves the existing individual request and mutation paths.

## Classification

- maintenance Landing Unit: `maintenance-1275-repository-request-readback`
- Landing Unit Decision: `child_isolated_landing_unit`; the OOS read contract
  and runtime have their own review, source landing, and rollback boundary.
  This record tracks maintenance under the existing acceptance exercise.
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
- acceptance-exposed gap: provider creation results were retained in OOS, but
  the Console could discover them only while their request IDs remained in its
  component memory. Removing live fixture fallback exposed the absent durable
  register-read path. The maintenance continuation enumerates those existing
  records rather than introducing another state owner.

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
- exposes cursor-based read pages of at most 25 integrity-validated retained
  workflow results behind the existing caller-bound credential requirement
- tests cold store reconstruction, pagination, invalid coordinates, corrupt
  records, authentication, and readback without provider side effects

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
- maintenance continuation: refresh the Security delta for the reviewed
  read-contract change, land Console consumption, then repeat the existing
  fixture-free journey before claiming operating completion

## Rollback

Revert this Landing Unit to restore the disabled source gate and prior
authority bundle. Platform must remove the runtime projections and revoke
issued tokens without deleting a repository or its retained governance
evidence.


## Canonical Repository Gate Maintenance — 2026-10-16

### Summary

Extend the existing Repository custody to Proposal handoff with an authenticated,
source-bound resolution consuming a successful retained custody receipt. Preserve
the accepted Disposition and use the existing canonical workflow-state mutation,
immutable Proposal event history, and replay recovery rather than browser-local
resolution state.

### Classification

- area: Repository to Proposal handoff
- type: maintenance; extend existing owner workflow
- runtime impact: new bounded resolution operation in the existing local lane
- Landing Unit Decision: child_isolated_landing_unit; OOS is an independent
  owner/review/rollback boundary from the dependent Console adapter.

### Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: acceptance-exposed maintenance for #1275 / #1298; no new child
- related products or components: Governance Operations Console, Repository custody

### Root Cause

- immediate failure: real accepted Proposal requested Repository Control, which
  had no canonical pending request or live gate resolution.
- actual root cause: the local cross-domain receipt path was excluded correctly
  by live fixture isolation but had not been replaced with owner-backed progression.
- why it escaped earlier controls: capability-by-capability proof omitted the
  Proposal-to-Repository-to-Proposal handoff and cold-browser continuity.

### Source Changes

- changed workflow, adapter, or contract: bounded repository-resolution operation;
  OOS derives resolved custody from exact successful owner evidence, never from
  browser-supplied owner/ref or a re-recorded Disposition.
- tests or validator added: positive, invalid receipt, wrong identity, stale
  source, replay, interrupted mutation/event write, and canonical cold-read cases.
- related change records: existing repository-custody workflow and list repairs.

### Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source candidate; not operating proof
- image tag or digest: None
- runtime revision: None
- exact-revision consumers: complete-runtime policy and controlled Security
  acceptance pin current OOS 5c75a8d and Console 8b7eac7. Both need reacceptance
  and ordered activation after this OOS change and its Console adapter land.
- sequence: OOS contract/service, Console adapter, exact Security acceptance,
  Platform composition reconciliation, browser acceptance and operating proof.

### Live Verification

- local validation: pending; do not interpret planned cases as passing evidence
- live or dev-integration verification: OpenProject work package 1305 form schema
  returned HTTP 200 at lockVersion 2; description, status, and Proposal Workflow
  State customField57 each writable=true. Read-only form inspection used the
  existing Node transport and configured Host/authentication. No record mutation.
- residual risk: source integration is not accepted runtime availability until
  exact Security acceptance and activation are refreshed.

### Follow-Up

- required follow-up: prove the browser can resolve and refresh the accepted
  Proposal without fixtures, direct backend writes, or hidden CLI product work.
- owner: operator-orchestration-service and governance-operations-console
- due date or closure condition: before final #1298 acceptance.

Security review boundary: the existing [controlled Console runtime review](https://github.com/mfshaf7/security-architecture/blob/main/docs/reviews/components/2026-10-15-governance-console-platform-operation.md) must accept the exact repair sources before activation. This source candidate is not operating acceptance.
