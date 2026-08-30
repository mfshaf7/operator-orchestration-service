---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - src/delivery-art/work-session-cli-adapters.js
    - test/delivery-art-work-session-resource-retirement.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-08-30 Work-Session Large-Diff Cleanup

## Summary

Preserves exact squash-merge cleanup proof for reviewed Landing Units whose Git
diff exceeds Node's default child-process output limit.

## Classification

- area: Workspace Delivery ART work-session resource retirement
- type: bounded cleanup-control capacity correction
- runtime impact: local ART work-session cleanup only; source review, merge,
  ownership, dirty-state, and compare-and-delete guards are unchanged

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: cleanup of User story `#1051` under delivery `#888`
- related products or components: OOS Delivery ART work-session controller

## Root Cause

- immediate failure: terminal cleanup could not inspect a valid 1.49 MiB
  reviewed Git diff and left the work session in `cleanup-blocked`.
- actual root cause: `execFileSync` used Node's default 1 MiB output buffer
  while exact squash-equivalence proof captures two binary Git diffs.
- why it escaped earlier controls: existing real-Git tests covered squash
  equivalence and race safety, but their reviewed diffs remained below the
  child-process default.

## Source Changes

- changed workflow, adapter, or contract: set an explicit 16 MiB bound for
  work-session adapter command output without changing exact diff comparison.
- tests or validator added: real-Git squash cleanup with a reviewed diff above
  1 MiB, alongside the existing mismatch and race regressions.
- related change records:
  - `2026-08-24-squash-merge-cleanup-proof.md`

## Artifact And Deployment Evidence

- source-only maintenance change pending pull-request merge
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation: focused cleanup suite passed `13` tests; full repository
  suite passed `910` tests; deterministic bundle, API, governance, and
  base-aware mutation checks passed.
- live or dev-integration verification: retry the existing `#1051` cleanup
  after the corrected OOS revision is used by the operator path.
- residual risk: diffs above the explicit 16 MiB ceiling still fail closed for
  operator review rather than consuming unbounded memory.

## Follow-Up

- required follow-up: merge the correction, refresh the OOS operator worktree,
  and retry `work close 1051` to produce the terminal cleanup receipt.
- owner: `operator-orchestration-service`
- due date or closure condition: `#1051` cleanup reaches `complete` without
  manual branch or worktree deletion.
