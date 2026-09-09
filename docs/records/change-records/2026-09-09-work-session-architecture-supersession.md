---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - contracts/delivery-art-work-session/architecture-supersession-receipt.schema.json
    - src/delivery-art/service.js
    - src/delivery-art/work-session-controller.js
    - src/delivery-art/work-session-service.js
    - src/delivery-art/work-session-store.js
    - src/openproject-client.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "The change blocks stale architecture bindings and permits explicit reconstruction only before source or evidence activity begins. It adds no stage or production authority."
---

# Work Session Architecture Supersession

## Summary

ART #1126 makes every architecture-bound Delivery work session compare its
stored packet with the current accepted immutable packet before work advances.
A mismatch fails closed and can be reconstructed only while the session is
provably pristine.

## Classification

- area: Delivery ART architecture and work-session lifecycle
- type: runtime control and recovery contract
- runtime impact: source-complete `dev-integration` behavior; no stage or
  production activation

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Defect #1126 under Feature #920 and Epic #892
- related components: Delivery ART artifact service, source executor, and work
  sessions

## Root Cause

- immediate failure: an active session could continue using an architecture
  packet after a newer packet became the accepted Delivery architecture
- actual root cause: work start validated architecture once but later session
  transitions did not resolve and compare current accepted architecture truth
- why it escaped earlier controls: architecture persistence and work-session
  lifecycle enforcement were delivered in separate Landing Units without a
  supersession transition between them

## Source Changes

- resolves the latest structured architecture reference from the Delivery Epic
  through the immutable WGCF artifact boundary
- rejects new starts against a non-current architecture packet
- projects `architecture-superseded` before continue, merge, or close can
  advance a stale session
- permits explicit reconstruction only when Git, GitHub, evidence, Review
  Packet, and readiness state prove that work has not begun
- retains a schema-validated, content-addressed supersession receipt outside
  the replaceable session directory
- adds the caller-bound API and CLI reconstruction surfaces plus positive and
  negative regression coverage

## Artifact And Deployment Evidence

- source-only change: OOS pull request for ART #1126
- image tag or digest: None
- runtime revision: None

## Live Verification

- live form contract evidence: this change adds read-only OpenProject reads for
  the current accepted architecture reference; it does not add or change any
  writable field, mutation route, or allowed-values behavior
- local validation: full OOS test suite plus API, governance-document,
  Delivery ART contract, OpenProject mutation-contract, and diff checks
- live or dev-integration verification: pending merged-source reconstruction
  of Security work item #1098
- residual risk: sessions with any source or evidence activity remain blocked
  for deliberate recovery; this change does not automate that recovery policy

## Follow-Up

- required follow-up: after this Landing Unit merges, project the superseded
  state for #1098 and explicitly reconstruct its still-pristine session against
  the current v3 packet
- owner: `operator-orchestration-service`, then `security-architecture`
- closure condition: the retained supersession receipt proves the old and new
  packet bindings before Security implementation resumes

## Rollback

Revert the current-architecture lookup, supersession gate, reconstruction
command, receipt schema, and synchronized API contract together. Existing v1,
v2, and v3 packet validation remains unchanged, but stale sessions would again
require manual suspension before any continuation.
