---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - src/delivery-art/work-session-controller.js
    - test/delivery-art-work-session.test.js
    - docs/contracts/delivery-workflow-api-v1.md
    - docs/operations/delivery-workflow-operator-surface.md
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "The repair preserves the existing exact merged-PR, durable merge-ready packet, absent readiness-receipt, operator, and successor supersession gates. It permits replacement when an interrupted acquisition recorded no result, but does not claim readiness or bypass repeated evidence in the successor."
---

# Interrupted Operating Evidence Recovery

## Summary

Allow the existing evidence-preserving recovery path to archive a merged work
session when operating evidence is still required because an interrupted
executor could not record a result and a reviewed verifier source repair is
needed.

## Classification

- area: Delivery ART merged-session recovery
- type: corrective owner-repo maintenance
- runtime impact: existing `work recover` eligibility only
- recommendation posture: extend the existing evidence-preserving recovery
  path

## Ownership

- owner repo: `operator-orchestration-service`
- work home: owner-repo maintenance linked to the accepted workspace
  improvement candidate
- tracking reference:
  `workspace-governance/reviews/improvement-candidates/2026-10-15-operating-evidence-profile-self-validation-gap.yaml`

## Root Cause

- immediate failure: complete-runtime teardown stopped the executor supervising
  the operating proof before OOS could retain its result;
- actual root cause: evidence-preserving recovery admitted invalid evidence but
  not an acquisition that remained required after an outcome-unknown command;
- why it escaped earlier controls: recovery tests covered explicit failed
  evidence and architecture supersession, but not executor replacement before
  the first result reached the lifecycle.

## Source Changes

- extend `archive-merged-evidence` eligibility to the exact
  `operating-evidence-acquisition-required` plus `required` state;
- retain the exact merged PR, durable merge-ready Review Packet, open ART item,
  original owner/operator, and absent readiness-receipt checks; and
- prove the interrupted-acquisition state archives the old session without
  claiming completion or altering its preserved packet.

## Artifact And Deployment Evidence

- source-only until the protected owner-maintenance pull request merges
- runtime activation: restore the existing `accepted-idea-delivery` profile
  from merged OOS source
- image tag or digest: None

## Live Verification

- local validation: focused work-session recovery tests, full repository tests,
  governance-doc validation, and base-aware change-record validation
- dev-integration verification: recover #1291 r3 with its exact merged PR and
  preserved Review Packet, then start the r4 successor
- residual risk: recovery can archive coordination but cannot finalize work;
  the successor must repeat normal source, review, merge, and operating proof

## Follow-Up

- required follow-up: complete the Platform receipt-replay repair and close the
  governed #1291 successor
- owner: `operator-orchestration-service`
- closure condition: #1291 reaches operating-ready and closes from a finalized
  successor Review Packet
