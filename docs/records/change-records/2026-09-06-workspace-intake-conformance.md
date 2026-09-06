---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - contracts/workspace-intake/manifest.json
    - src/workspace-intake
    - src/delivery-closeout/service.js
    - src/app.js
    - src/runtime.js
    - docs/api/openapi.json
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# Workspace Intake Conformance

## Summary

ART #1069 under #1061/#890 closes the source-candidate authenticity finding
from Security review #1066 and admits Workspace Intake only for the reviewed
`dev-integration` profile.

## Ownership

Workspace Governance remains canonical classification authority. Source owners
emit exact candidates, OOS retains immutable attestations and coordinates the
review workflow, WGCF evaluates readiness without mutation, Platform owns the
bounded GitHub App identity, and the Console remains an OOS client.

## Classification

This is the source-backed Landing Unit `delivery-890-intake-conformance`. It
changes delivery and runtime behavior for Workspace Intake in
`dev-integration`; it does not grant stage or production authority.

## Root Cause

The previous implementation validated browser-supplied candidate syntax and
decision binding but did not resolve non-direct source fields against
authenticated Delivery or Prototype owner truth. A validly re-digested browser
change could therefore claim provenance that its source owner had not emitted.

## Source Changes

- Added a strict source-candidate contract and caller-to-source-owner binding.
- Persisted immutable candidate attestations beside durable intake workflow
  state and bound accepted non-direct requests to exact source, target, record,
  and evidence identities.
- Published Delivery workspace entrants through the same attestation boundary,
  including replay recovery after a retained closeout result.
- Added the caller-bound attestation API and OpenAPI projection.
- Replaced the inactive flag with exact Security #1066 and Platform #1082
  activation evidence for `dev-integration` only.
- Preserved direct entries as operator-authored requests without false upstream
  provenance.

## Artifact And Deployment Evidence

- Security source: `security-architecture@884b6a426765e483d5c1a8ca152c51129fcb4ec0`
- Platform activation source: `platform-engineering@59e8661fe954ae726e0b522acbaf8f6788f0ab8f`
- Provider proof digest:
  `sha256:49af782d8fa2c15fa0a7ac43b0cb5be405ace5fc2987c3e63a544d0831bf42f1`
- OOS source and Review Packet evidence are bound to pull request #188.

No credential value is present in source, tests, API examples, or this record.

## Live Verification

The complete OOS test suite passes with 928 tests. Focused Workspace Intake and
Delivery closeout tests cover caller binding, immutable retention, altered
source/target/record denial, restart-safe replay, and retryable publication
failure. The real-Git conformance runner passes seven scenarios covering an
authenticated Prototype candidate, browser alteration denial, review-only
source mutation, changed-head denial, exact human-merge readback, process death
recovery, and cancellation.

The previously completed Platform proof establishes the exact repository App
scope and provider-enforced merge/main-write denial. This change does not claim
a stage, production, external, or multi-user deployment.

## Follow-Up

If conformance fails, disable `OOS_WORKSPACE_INTAKE_ENABLED` and revoke the
Platform token projection while retaining source reviews, workflow state, and
receipts. Active inventory and lifecycle actions remain owned by #1070 and
#1076 rather than this intake workflow.
