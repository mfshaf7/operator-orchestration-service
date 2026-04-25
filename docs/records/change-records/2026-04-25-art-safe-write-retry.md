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

# 2026-04-25 ART Safe Write Retry

## Summary

Hardened the shared OpenProject PATCH helper so broker-owned ART write workflows
perform one bounded retry when OpenProject rejects a stale `lockVersion`.

## Classification

- area: delivery workflow
- type: runtime hardening
- runtime impact: shared broker write helper now retries one safe OpenProject
  update conflict

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice:
  - `#311` `Harden ART writes with safe retry, idempotency, and duplicate-note protection`
  - `#329` `Add safe lock-version retry for broker PATCH-based ART write workflows`

## Root Cause

The broker was still surfacing expected OpenProject `UpdateConflict` races
directly to the operator during PATCH-based ART writes. That made multi-step
initiative and work-item workflows feel fragile even when the correct recovery
was simply to refresh the live lock version and retry once.

## Source Changes

- hardened shared OpenProject error mapping and PATCH retry behavior:
  - `src/openproject-client.js`
- added regression coverage for both the successful retry and bounded hard-fail
  paths:
  - `test/openproject-client.test.js`
- documented the safe-write retry posture:
  - `docs/contracts/delivery-workflow-api-v1.md`
  - `docs/operations/delivery-workflow-operator-surface.md`

## Artifact And Deployment Evidence

- local broker code and contract update only
- no governed runtime promotion in this slice yet

## Live Verification

- regression coverage proves:
  - one stale lock-version conflict is retried with a refreshed lock version
  - persistent conflicts still fail after the bounded retry
- live devint evidence also produced the motivating signal while ART child work
  was created concurrently under `#311`

## Follow-Up

- extend the same hardening track to duplicate-note and duplicate-evidence
  suppression so safe retries remain idempotent for closeout workflows
