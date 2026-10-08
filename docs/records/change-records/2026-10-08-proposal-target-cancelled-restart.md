---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - security-architecture/docs/reviews/components/2026-10-08-proposal-target-application-trust-boundary.md
    - src/proposal-target-application/service.js
    - src/proposal-target-application/store.js
    - docs/operations/proposal-target-application-operator-surface.md
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: Fresh Security reacceptance is required before Platform recomposes the repaired Proposal Target recovery path.
---

# Proposal Target Cancelled Restart

## Summary

Proposal Target now supports one bounded cancel-and-restart recovery when the
target authority changes before source preparation begins. This is owner-repo
maintenance for Platform commissioning story `#1236`; it creates no new ART
child.

## Classification

- area: Proposal-to-Prototype target application
- type: durable workflow recovery repair
- runtime impact: permits the same accepted Proposal to resume after an exact
  target-authority revision changes before any target mutation

## Ownership

- workflow and durable state authority: `operator-orchestration-service`
- operator adapter: `governance-operations-console`
- existing commissioning work: `openproject://work_packages/1236`
- Security authority: `openproject://work_packages/1235`

## Root Cause

OOS correctly froze an accepted application to its prepared target-authority
binding and rejected a changed Studio revision. Cancellation safely closed the
zero-mutation application, but resubmission could not replace that stale target
binding under the deterministic application identity. The workflow therefore
had no supported recovery despite having created no files, review, target
result, Proposal acknowledgement, or canonical mutation.

## Source Changes

- permits resubmission only after explicit cancellation;
- requires the prior record to contain no preparation, review, target result,
  Proposal acknowledgement, or canonical mutation;
- requires every evaluation field except the target-authority binding, plus
  the canonical Proposal snapshot, to remain identical;
- preserves history and records the old and new authority revisions;
- enforces the same restart restriction independently in the durable store;
  and
- retains fail-closed idempotency behavior for every other conflict.

## Validation

- focused service and store tests for the allowed zero-mutation restart;
- negative tests for restart before cancellation and after preparation;
- Proposal Target OpenAPI and contract-generation checks;
- complete OOS test suite; and
- base-aware change-record validation.

## Artifact And Deployment Evidence

The reviewed OOS pull request and eventual merge are source evidence only.
Security reacceptance, Platform pinning, and live cancellation and restart of
the retained application remain required before operating completion.

## Live Verification

After the exact OOS revision is security-accepted and recomposed, cancel the
retained zero-mutation application, resubmit it through the Console against the
current Studio authority, and require the normal review, human merge, Studio
readback, and Proposal acknowledgement sequence. Source tests do not replace
that proof.

## Follow-Up

- merge and security-reaccept the exact OOS repair;
- advance the Platform activation pins and recompose `dev-integration`; and
- resume the same Proposal `idea-218` application under story `#1236`.

## Rollback

Revert this OOS change, retain the cancelled application and its history, and
keep Proposal Target unavailable for that record until an approved recovery
path exists. Do not delete durable state or reinterpret the stale binding as
success.
