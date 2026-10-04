---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - src/delivery-art/source-executor.js
    - test/delivery-art-source-executor.test.js
    - docs/operations/delivery-workflow-operator-surface.md
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "The repair preserves existing accepted-base evidence-profile requirements across the authenticated source-executor transport; it adds no source, merge, evidence, readiness, or ART mutation authority."
---

# Configured-Path Evidence Requirement Transport

## Summary

Preserve configured-path conformance cases and required evidence kinds across
the Delivery source-executor boundary so accepted-base profile validation runs
before a work session can create source resources.

## Classification

- area: Delivery ART configured-path preflight
- type: corrective owner-repo maintenance
- runtime impact: local OOS source-executor request forwarding

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: none; corrective maintenance linked to the active
  workspace improvement candidate
- related components: Delivery ART work sessions and source executor

## Root Cause

- immediate failure: Epic 1203 item 1231 merged before OOS discovered that the
  accepted Platform base profile lacked its required `runtime_and_live`
  command and `live-backend` fidelity.
- actual cause: configured-path evaluation derived the complete evidence
  requirements, but the source-executor client and dispatcher forwarded only
  the session object. The host adapter therefore received empty requirement
  arrays and skipped profile coverage validation.
- why it escaped earlier controls: controller and host-adapter tests proved
  the preflight behavior directly, while source-executor tests exercised only
  a requirement-free configured-path request.

## Source Changes

- forward `conformance_cases` and `required_evidence_kinds` in the finite
  `work.inspect-configured-path` request;
- reconstruct the host adapter's existing camel-case requirement object at the
  authenticated dispatcher boundary; and
- prove the exact live-backend case and runtime evidence kind survive a real
  client/server socket round trip.

## Artifact And Deployment Evidence

- source-only change until the owner-maintenance pull request merges and the
  existing `refinement-catalog` composition is reconciled
- image tag or digest: none
- runtime revision: recorded by the post-merge composition session

## Live Verification

- local validation: focused source-executor, configured-path adapter, and work
  session tests; full Node test suite; API and governance-document validation
- dev-integration verification: item 1231 replacement preflight must read the
  now-base-owned Platform live-backend command before creating its fresh
  session
- residual risk: the already merged recovery-4 session remains incomplete and
  must be archived through the existing evidence-preserving recovery contract

## Follow-Up

- required follow-up: archive recovery 4 without claiming operating readiness,
  start the replacement from the merged Platform base, and close item 1231 only
  after OOS acquires the base-owned live-backend evidence
- owner: `operator-orchestration-service`
- closure condition: merged maintenance change, refreshed dev-integration
  runtime, successful configured-path preflight, and finalized item 1231 Review
  Packet

## Rollback

Revert the client, dispatcher, tests, operator guidance, and this record
together. Existing sessions, receipts, and archived evidence remain retained.
