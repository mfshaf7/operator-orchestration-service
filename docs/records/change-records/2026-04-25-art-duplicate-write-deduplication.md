---
security_evidence:
  review_areas:
    - runtime
    - delivery
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-04-25 ART Duplicate Write Deduplication

## Summary

Hardened the broker ART adapter so bounded safe retries and equivalent replayed
closeout writes do not append duplicate initiative-review evidence or duplicate
broker-authored operator work notes.

## Classification

- area: delivery workflow
- type: adapter hardening
- runtime impact: bounded broker write-path change in the normal ART workflow

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice:
  - `#311` `Harden ART writes with safe retry, idempotency, and duplicate-note protection`
  - `#327` `Add duplicate-note and duplicate-evidence protection for retried broker closeout writes`

## Root Cause

The broker already had bounded stale lock-version retry, but replay protection
at the adapter layer was still too weak. Initiative-review evidence and
broker-authored operator notes could be appended again if the same intended
closeout write was replayed, which made the safe retry guarantee incomplete.

## Source Changes

- hardened adapter helpers to suppress duplicate broker-authored operator work
  notes and duplicate formattable initiative-review entries:
  - `src/openproject-client.js`
- added regression coverage for duplicate system-demo and duplicate
  inspect-and-adapt replay suppression:
  - `test/openproject-client.test.js`
- tightened the documented safe-write contract and operator surface:
  - `README.md`
  - `docs/contracts/delivery-workflow-api-v1.md`
  - `docs/operations/delivery-workflow-operator-surface.md`

## Artifact And Deployment Evidence

- local broker code and contract update only
- no governed runtime promotion in this slice yet

## Live Verification

- local regression coverage proves:
  - duplicate system-demo replay is a no-op
  - duplicate inspect-and-adapt replay is a no-op
  - the documented contract now states duplicate suppression explicitly
- live devint proof should confirm:
  - replaying identical initiative-review writes does not append another entry
  - the broker still returns a normal success payload for the replayed request

## Follow-Up

- restart the devint broker from this branch before replaying identical
  initiative-review writes live
- use an existing initiative with already-recorded review evidence before
  closing story `#327`
