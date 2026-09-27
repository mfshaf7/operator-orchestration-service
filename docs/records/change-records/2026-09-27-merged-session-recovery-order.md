---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - src/delivery-art/lifecycle.js
    - test/delivery-art-lifecycle.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "The correction exposes the existing exact-PR recovery gate before incomplete evidence can mask it; recovery, review, merge, and closeout authority are unchanged."
---

# Merged Session Recovery Ordering

## Summary

A source-backed work session whose pull request was already merged without a
pre-merge Review Packet could remain projected at the evidence gate. That
prevented the existing bounded recovery command from recognizing the invalid
pre-merge source binding.

## Classification

- area: Delivery ART work-session recovery
- type: lifecycle projection correction
- runtime impact: changes only which existing gate is reported first

## Ownership

- owner repo: `operator-orchestration-service`
- related ART item: #1190 under Feature #930
- related components: Delivery ART lifecycle projection and merged-session recovery

## Root Cause

The general evidence checks ran before the lifecycle checked whether a
pre-merge Review Packet state was paired with an already merged or mismatched
pull request. An incomplete evidence profile could therefore hide the recovery
condition even though the source binding was already irrecoverably invalid.

## Source Changes

The lifecycle now reports `pre-merge-source-binding-invalid` before evidence
projection or evidence completeness when the Review Packet is absent or still
local and the pull request is merged or mismatched. Regression coverage proves
the ordering for missing, legacy-local-draft, and local-draft packet states.

## Artifact And Deployment Evidence

- source-only change: the reviewed #1190 OOS pull request
- image tag or digest: None
- runtime revision: exact pull-request head, pending normal merge

## Live Verification

Focused lifecycle tests and the owner evidence profile must pass at the exact
source head. The active #1188 session must then expose and complete the existing
recovery command without handcrafted completion evidence.

## Follow-Up

- required follow-up: recover and restart #1188 from the corrected Security evidence profile
- owner: Delivery ART operator for Feature #930
- closure condition: #1188 and Feature #930 close through their normal evidence paths

## Rollback

Revert the lifecycle ordering and regression test together. Existing recovery
receipts and archived sessions remain retained for audit.
