---
security_evidence:
  review_areas:
    - delivery
    - identity
    - runtime
    - secrets
  reviewed_artifacts:
    - scripts/api_probe_auth.mjs
    - scripts/probe_api_contract.mjs
    - test/api-probe-auth.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "The live API probe now pairs the selected caller with its identity-bound secret and retains the shared secret only as the documented compatibility fallback."
---

# API Probe Caller-Specific Authentication

## Summary

The live API contract probe now uses the credential bound to its selected
caller. Previously it always supplied the compatibility shared secret, so a
runtime with caller-specific authentication correctly rejected the probe with
`401 caller_auth_invalid` even while the target route was healthy.

## Classification

- area: live API contract probe authentication
- type: corrective owner-repo maintenance
- landing unit decision: `feature_single_landing_unit`; the probe repair,
  regression tests, and evidence record share one owner, review path, and
  rollback boundary
- runtime impact: none; this changes the diagnostic client, not OOS service
  authentication or authorization

## Ownership

- owner repo: `operator-orchestration-service`
- work-tracking home: owner-repo-only maintenance; no new ART item
- related operator surface: live API contract probe

## Root Cause

- immediate failure: `npm run api:probe` received `401 caller_auth_invalid`
- actual root cause: the probe selected an allowed caller identity but always
  paired it with `CALLER_AUTH_SHARED_SECRET`
- contract mismatch: OOS service authentication and the ART CLI already select
  the exact `CALLER_AUTH_SECRETS_JSON` entry before the compatibility fallback

## Source Changes

- resolve the selected caller's identity-bound credential first
- retain the shared credential only for callers without a specific mapping
- fail closed on malformed caller-secret configuration
- cover specific-secret precedence, compatibility fallback, and malformed
  configuration with focused tests

## Artifact And Deployment Evidence

- source evidence: owner-repo maintenance Landing Unit
  `maintenance-api-probe-caller-specific-auth`
- deployment impact: none; the probe executes from the owner checkout against
  the existing active runtime

## Live Verification

- focused test: `node --test test/api-probe-auth.test.js`
- live proof: probe one bounded Delivery ART route in the active
  `accepted-idea-delivery` profile
- repository validation: `npm test`, governance-doc validation,
  change-record validation, and `git diff --check`

## Security Boundary

No secret value is added to source, logs, test fixtures, or evidence. The probe
continues to read credentials only inside the target pod and returns only the
caller identity, status, and response body. This repair changes neither the
allowed caller set nor any caller's permission.

## Follow-Up

- required follow-up: merge the reviewed repair and remove its source branch
- owner: `operator-orchestration-service`
- closure condition: the merged probe passes focused, full, governance, API,
  and live bounded-route validation

## Rollback

Revert the Landing Unit. The previous probe will again fail against runtimes
that bind the selected identity to a caller-specific secret.
