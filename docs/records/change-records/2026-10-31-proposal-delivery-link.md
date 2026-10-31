---
security_evidence:
  review_areas: [runtime, delivery]
  reviewed_artifacts:
    - contracts/proposal-workflow/projection.schema.json
    - src/proposal-workflow/service.js
    - test/proposal-workflow-service.test.js
  findings: []
  risks: []
  workstreams: [WS-007]
  notes: Read-only existing Delivery reference projection within the existing authenticated Proposal snapshot; reviewed with the Console UI batch in the 2026-10-31 AI activity read-scope delta.
---

# Existing Delivery links in Proposal snapshots

## Summary

Expose the already-recorded canonical Delivery reference on Proposal snapshots.
Console uses existing Delivery reads to distinguish completed, retired, active
and unavailable outcomes instead of asking already-routed proposals to route again.
This changes read projection only and does not close, route or rewrite proposals.

## Classification

- Owner: Operator Orchestration Service
- Work home: operator-approved maintenance; no new ART repair item
- Landing Unit: `maintenance-proposal-delivery-link`
- Landing Unit Decision: `feature_single_landing_unit`
- Branch: `maintenance/proposal-delivery-link`
- Base: `1eceee2afaf34dbf2fbe4bb142bcff9fba7799e0`

## Ownership

OOS owns the canonical projection; Console consumes it. Existing authenticated
caller and workflow authority remain unchanged. WS-007 links the shared Console
batch's evidence/decision separation review, not a claim of new AI invocation.

## Root Cause

The existing delivery_ref was omitted from the closed Proposal snapshot schema.
That omission made already-routed proposals appear to need another route.

## Source Changes

Add the nullable existing reference to the projection, schema and OpenAPI, with
owner coverage for present and absent values. No canonical writes are added.

## Artifact And Deployment Evidence

The additive nullable schema, service projection and OpenAPI agree. Owner tests
prove missing links remain absent and existing links survive projection. Full
broker tests, API synchronization and base-aware owner validators gate landing.
[Security delta](https://github.com/mfshaf7/security-architecture/blob/main/docs/reviews/components/2026-10-31-console-ai-activity-read-scope.md)
covers the existing identity and data boundary. This source record does not
assert live deployment. Land before dependent Console, then use normal exact
Security acceptance and Platform activation. Rollback retains canonical data.

## Live Verification

Pending batch activation. Local tests prove projection behavior; they do not
stand in for the final authenticated Console readback.

## Follow-Up

After owner landing, regenerate Security's owner-record index, verify the live
Proposal/Delivery read composition, and retire the completed branch/worktree.
