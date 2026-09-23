---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - src/delivery-art/work-session.js
    - src/delivery-art/work-session-cli-adapters.js
    - src/delivery-art/work-session-store.js
    - test/delivery-art-work-session-cli-adapters.test.js
    - test/delivery-art-work-session.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "Retry generations now use one validated worktree-path derivation for source access and resource custody."
---

# Work-Session Retry Path Binding

## Summary

Delivery work-session retry generations now derive their worktree path through
one shared function, so source reconstruction and resource-manifest validation
agree on the `-rN` path suffix.

## Classification

- area: Delivery ART work-session resource custody
- type: runtime defect correction
- runtime impact: retry sessions can resume without weakening path ownership

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Epic #892, work item #1107
- related components: Delivery ART work sessions and owned worktree cleanup

## Root Cause

- immediate failure: a retry session created an `-r1` worktree that its resource
  manifest validator rejected
- actual root cause: source reconstruction and manifest validation independently
  derived the same owned path but only the source adapter handled retry generations
- why it escaped earlier controls: manifest tests covered the initial session path
  but not a replacement generation

## Source Changes

- changed workflow, adapter, or contract: source reconstruction and manifest
  validation use one retry-aware path derivation
- tests or validator added: adapter and store regression coverage for an `:r1`
  session
- related change records: None

## Artifact And Deployment Evidence

- source-only change: pull request #222
- image tag or digest: None
- runtime revision: pending merge

## Live Verification

- local validation: targeted adapter tests, full work-session tests, and the
  complete repository test suite pass
- live or dev-integration verification: repeat `work continue 1107` after the
  merged revision is active
- residual risk: none beyond the existing fail-closed checks for malformed
  generation suffixes and non-owned paths

## Follow-Up

- required follow-up: finish #1107 through the normal work-session path
- owner: Delivery ART operator
- closure condition: #1107 has finalized evidence and a retained cleanup receipt

## Rollback

Revert the shared derivation and its two callers together. Existing worktrees
and retained receipts remain audit evidence.
