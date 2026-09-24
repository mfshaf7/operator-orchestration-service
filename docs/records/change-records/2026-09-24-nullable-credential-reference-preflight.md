---
security_evidence:
  review_areas:
    - runtime
    - delivery
  reviewed_artifacts:
    - src/delivery-art/work-session-store.js
    - test/delivery-art-work-session-service.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-09-24 Nullable Credential Reference Preflight

## Summary

Delivery ART coordination state now accepts an explicit null placeholder for a
non-secret `*_ref` field, so a configured-path failure can return its real
bounded blocker without weakening secret-material rejection.

## Classification

- area: Delivery ART work-session persistence
- type: workflow control correction
- runtime impact: source and local dev-integration OOS work-start behavior only

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: `#1171` under Delivery Feature `#1159`
- related products or components: Delivery ART work sessions

## Root Cause

- immediate failure: live `work start 1167` failed while persisting
  `configured_path.source.runtime.credential_ref: null`.
- actual root cause: the secret-field guard allowed a non-empty `*_ref` string
  but did not define the explicit null placeholder emitted by its own fallback
  projection.
- why it escaped earlier controls: the existing regression covered a populated
  safe reference and real credential material, but not the fallback null state.

## Source Changes

- changed workflow, adapter, or contract: treat only explicit null and non-empty
  string values as valid safe-reference states; empty or malformed references
  and credential material remain forbidden.
- tests or validator added: focused coordination-store regression for populated,
  nullable, empty, and secret-bearing credential shapes.
- related change records: workspace improvement candidate
  `2026-09-24-nullable-credential-reference-preflight-mask`

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source change followed by
  accepted-idea-delivery runtime refresh
- image tag or digest: unchanged
- runtime revision: pending merged revision

## Live Verification

- local validation: full Delivery ART work-session Node test suite
- live or dev-integration verification: rerun `work start 1167` after runtime
  refresh and verify the underlying configured-path result is returned
- residual risk: other nullable fields remain governed by their existing
  field-specific rules; this change applies only to explicit secret-reference
  key names

## Follow-Up

- required follow-up: continue Platform child `#1167` through the normal work
  session once the live regression is cleared.
- owner: `platform-engineering`
- due date or closure condition: `#1167` starts through the configured path
