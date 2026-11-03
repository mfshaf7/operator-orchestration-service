---
security_evidence:
  review_areas: [identity, secrets, delivery, runtime]
  reviewed_artifacts:
    - src/repository-custody/provider-client.js
    - src/repository-custody/service.js
    - src/proposal-workflow/service.js
    - src/repository-owner-bootstrap/credentials.js
    - src/repository-owner-bootstrap/scaffold.js
    - src/repository-owner-bootstrap/preparation.js
    - src/delivery-art/review-evidence-acquisition.js
    - src/delivery-art/review-evidence.js
  findings: []
  risks: []
  workstreams: [WS-003, WS-005]
---

# Repository onboarding, request binding and verification maturity

## Classification

Existing workflow repair; extend custody correlation and Proposal confirmation.

## Ownership

Operator-authorized maintenance of existing Proposal and repository custody
workflows. No ART item is created. Landing Unit Decision:
`feature_single_landing_unit`, owner `operator-orchestration-service`, branch
`maintenance/repository-request-binding`. Console consumer work remains in its
existing preview maintenance batch and lands after this dependency.

## Summary

Requests can be fulfilled by creating a repository or explicitly attaching one
already created for that request. Both produce an exact request-bound custody
receipt. Unrelated receipts cannot directly confirm the requirement. A bounded
Console-only provider lookup resolves human-entered GitHub coordinates with the
existing read identity; it does not issue custody or perform provider writes.
The reviewed existing-link workflow independently verifies immutable identity.
Original receipts, source-version checks and committed-history recovery remain.

## Root Cause

The selector treated a successful custody receipt as sufficient without an
explicit association to the request. Conversely, equating a new-work repository
requirement with provider creation alone would exclude a repository the operator
already created for that request. Both methods need reviewed request association
and independently verified provider identity.

The live pending requirement comes from Proposal Disposition, including API
clients that persist the same canonical decision. The Console request list is
a projection, not another creator. Standalone provisioning and existing linkage
create custody requests, not pending Proposal requirements. Prototype-to-Delivery
packet preparation and Delivery ingress consume resolved custody and do not
create a second repository-request queue. Prototype local packet fixtures remain
disconnected-preview paths, not live authority.

## Source Changes

Fresh confirmation requires successful provision-new or link-existing correlated
to the exact request. Corrections preserve the original binding. Provider lookup
accepts exact bounded GitHub coordinates, denies redirects, limits response size,
uses only read credentials and returns projected metadata. Caller-bound Console
identity is required. The Console adapter captures explicit purpose and ownership
approval before attachment; lookup alone does not grant a final decision. Tests
cover both request methods, automatic identity resolution, access/identity denial,
attachment, cold read, replay, correction and explicit final confirmation.

## Security and rollback

This narrows fresh request confirmation and adds a bounded authenticated metadata
read. There is no new caller identity, credential, provider write capability,
custody-schema authority or approval bypass. The existing
exact-version, receipt, provider identity, operator approval and replay checks
remain required. Revert workflow validation and its Console consumer together;
retain all original requests, receipts and historical outcomes.

## Artifact And Deployment Evidence

Reviewed maintenance source. Console depends on this backend repair. Source
validation does not claim runtime activation or provider creation. Exact composed
Security approval and normal activation/readback are recorded separately.

## Live Verification

The complete OOS suite passed 1,780 tests with two existing skips. The active
verification workflow passes source approval, acceptance, review, merge and cold
recovery in an isolated protocol proof. Seven Console browser cases passed.
Source-backed regression and isolated browser protocol proof precede reviewed
activation. Current working runtime remains pinned to its previously accepted
source until the preview batch is approved and activated. The additional provider
read surface needs its normal source security review before activation. No live business
mutation is used as a substitute for qualification.

## Follow-Up

Finish focused regression, operator preview review and coordinated source
publication/activation. Owner: operator-orchestration-service. Closure condition:
reviewed source, exact runtime readback and request-specific operating evidence.

## Application verification repair

Operator-approved cross-repo maintenance separates governance participation from
application testing. New owners can bootstrap with genuine source controls and
application verification explicitly unconfigured. No guessed app command, marker
or early test-plan prose is needed. Existing profiles preserve legacy evidence
requirements. Active source-only owners can load their actual profile and make
a finite verification-only change against exact Inventory authority, preserving
independent controls. Platform independently checks that new authority and
restricts its path/permission grant. Manual instructions and automated plans
never count as passed results. Merge-ready source evidence follows the reviewed
profile; explicit conformance and later operating/release evidence remain.

Dependency order: Workspace Governance policy/authority, Platform issuer and
OOS implementation, Console consumer, final Security composed review/activation.
Security source review precedes activation; its generated owner-record index is
refreshed after owner records reach main.

Review: [verification maturity delta](https://github.com/mfshaf7/security-architecture/blob/main/docs/reviews/components/2026-11-03-repository-verification-maturity.md).
Rollback reverts the coordinated implementation; retain original requests,
receipts and reviewed profiles. Existing legacy evidence is not rewritten.
