---
security_evidence:
  review_areas: [identity, secrets, delivery, runtime]
  findings: []
  risks: []
  workstreams: [WS-007]
---

# Bound repository verification and legacy transfer

## Summary

Application Verification reads the selected repository and required control
files at an immutable provider revision. Reuse keeps its authorization check
and bounds GitHub throttling. The instance workflow adds a preparation and
acceptance route bound to an authorized Console operator.

## Classification

Owner-repo maintenance for the coordinated Console release.

## Ownership

This is Console maintenance in the broker owner repo under `console-reads-20261122-repository-verification`.
The Console consumer is reviewed in its own repo and activates through the
same Platform composition.

## Root Cause

Application Verification used broad provider reads. A retained Git-backed registration could not use the protected Source App until canonical authority transferred.

## Source Changes

Broker tests cover bounded immutable reads, throttling, caller authorization,
and transfer receipt checks. The transfer uses the commissioned instance
writer and checks for pending legacy operations. The Registry verifies the
exact policy, operator plan, reviewed Git transition, source identity and
durable receipt. The rehearsal transferred the retained registration only in
a disposable Git and database copy. A real transfer and its subsequent
authenticated Application Verification require a separate operator decision.

## Live Verification

Local and isolated evidence covers the source candidate. Live readback follows
exact-source acceptance through the existing Console composition.

## Artifact And Deployment Evidence

The broker image must be built from the reviewed merged revision.

## Follow-Up

Review the exact source and the composed Console release before activation.
Retain the previous accepted composition for rollback.
