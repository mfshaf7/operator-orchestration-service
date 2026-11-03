---
security_evidence:
  review_areas: [identity, secrets, delivery, runtime]
  reviewed_artifacts:
    - src/config.js
    - src/repository-custody/runtime.js
    - src/repository-custody/provider-client.js
  findings: []
  risks: []
  workstreams: [WS-003, WS-005]
---

# Account metadata reader boundary

## Summary

Extend the existing read-only provider adapter so an explicitly connected
GitHub account can cover future repositories, with a server-owned account
boundary and separate provisioning credentials.

## Classification

Operator-authorized maintenance; source boundary and configuration extension.
No ART item or new service. Landing Unit: `feature_single_landing_unit`,
`maintenance-organization-repository-reader-oos`.

## Ownership

OOS owns authenticated metadata reads. Platform owns identity, grant, token
issuance, renewal and delivery. Console owns projection; Security owns the
[scope review](https://github.com/mfshaf7/security-architecture/blob/main/docs/reviews/components/2026-11-03-account-repository-reader.md).

## Root Cause

The separate reader's selected-repository grant was not extended when another
App created a repository. An installation and a readable token were treated as
if they guaranteed future access. The reusable connection must authorize the
account deliberately, not accumulate manual repository grants.

## Source Changes

Pass `OOS_REPOSITORY_PROVIDER_ACCOUNT` to the existing provider client. Reject
foreign coordinate requests before HTTP and foreign immutable-ID readback
before projection. Retain response bounds, authenticated callers, redirect
denial and distinct metadata/provisioning tokens. Source tests read a repository
appearing after setup with the same client/token/configuration and reject
another account. Primary procedure:
[Repository Custody](../../operations/repository-custody-workflow.md#account-metadata-reader).

## Artifact And Deployment Evidence

Source candidate only; source publication and normal exact-composition
activation are pending. No new OOS image has been deployed by this record.

## Live Verification

The full OOS suite passes 1,784 tests with two pre-existing skips. Native
Platform commissioning separately verified an account-wide metadata token and
an existing private-repository read, then revoked the proof token. This is not
proof of deployed OOS account enforcement or a newly created live repository.

## Follow-Up

Bind final merged sources in the existing composed Security decision, activate
normally and verify actual Console readback and credential consumption. Customer
setup qualification stays open in the product backlog; the future-repository
backend repair remains active maintenance until its operating proof completes.
