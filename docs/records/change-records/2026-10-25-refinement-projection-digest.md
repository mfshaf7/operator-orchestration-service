---
security_evidence:
  review_areas: [runtime, delivery, ai]
  reviewed_artifacts:
    - src/refinement/service.js
    - test/refinement-service.test.js
    - docs/operations/refinement-runtime.md
  findings: []
  risks: []
  workstreams: [WS-007]
  notes: Preserve the CGG projection-envelope digest and separate context digest; retain all caller, source, task, budget, redaction and authority checks before inference.
---

# Refinement Projection Digest

## Summary

Normal short-text Refinement advice authenticated successfully but OOS rejected
the actual ready CGG response. Compare its full projection-envelope digest using
the existing CGG construction, separately from the assist-context digest.

## Classification

- area: existing Refinement suggestion-only advice boundary
- type: corrective owner-repo maintenance under the approved Epic1313 repair scope
- runtime impact: valid existing CGG responses reach governed inference; mismatches remain denied

## Ownership

- owner repo: operator-orchestration-service
- related ART slice: non-source operating qualification1321 under Epic1313
- related products or components: Console, OOS, CGG and governed AI gateway

## Root Cause

The CGG owner hashes canonical binding plus refinement_context as request_digest.
OOS instead compared it with assist_request_digest, which belongs only to
binding.context_digest. The OOS fixture repeated that mistaken equality, so a
mocked positive case passed while the actual owner response failed.

## Source Changes

Compute the existing envelope digest and retain the separate context comparison
and all existing caller, operator, session, task, source, packet, selected-field,
redaction, budget and authority checks. Correct the fixture to the owner formula;
reject context-only receipts and tampered bindings before invoking a model.

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: maintenance Landing Unit delivery-1313-refinement-projection-digest
- image tag or digest: unchanged packaging; accepted dev-integration source rebuild is required after review
- runtime revision: exact merged source and composed Security acceptance required before operating closure

## Live Verification

- local validation: owner-formula fixture fails against the old comparison; corrected positive and five negative binding cases pass with the consumer correction
- live or dev-integration verification: repeat the unchanged actual Console short-text advice after source and composed acceptance
- residual risk: source verification is not a live provider-entitlement or canonical apply claim

## Follow-Up

- required follow-up: exact-head CI-equivalent checks, Gary publication, accountable review, composed acceptance and original normal Console proof
- owner: operator-orchestration-service
- due date or closure condition: before qualification1321 and Epic1313 close
