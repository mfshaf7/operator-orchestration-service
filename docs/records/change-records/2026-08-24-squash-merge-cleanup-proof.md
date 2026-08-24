---
security_evidence:
  review_areas:
    - runtime
    - delivery
  reviewed_artifacts:
    - src/delivery-art/work-session-cli-adapters.js
    - src/delivery-art/work-session-resource-retirement-controller.js
    - test/delivery-art-work-session-resource-retirement.test.js
    - test/delivery-art-work-session.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-08-24 Squash-Merge Cleanup Proof

## Summary

Allows Delivery ART work-session cleanup to retire a reviewed local branch
after a GitHub squash merge only when the landed single-parent commit preserves
the exact reviewed branch change.

## Classification

- area: Workspace Delivery ART work-session resource retirement
- type: destructive-action proof correction
- runtime impact: local ART CLI close behavior only; ownership, path, dirty
  state, pull-request identity, and atomic branch-deletion guards remain intact

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Defect `#987` under delivery `#884`
- related products or components:
  - Workspace Delivery ART work-session controller
  - OOS linked-worktree source adapter

## Root Cause

- immediate failure: terminal cleanup for source work merged through GitHub's
  squash strategy blocked because the reviewed branch head is not an ancestor
  of the resulting `main` commit.
- actual root cause: local-branch retirement recognized only
  ancestry-preserving merges even though the finalized Review Packet already
  binds the exact PR URL, reviewed head, and merge commit.
- why it escaped earlier controls: resource-retirement tests covered direct
  ancestry and branch races, but did not exercise the repository's accepted
  squash-merge path.

## Source Changes

- changed workflow, adapter, or contract:
  - retain direct ancestry as the normal local-branch cleanup proof
  - accept the non-ancestry path only for an exact merged PR with a
    single-parent merge commit already present on the recorded base
  - compare canonical binary Git diffs from the session base to the reviewed
    head and from the merge parent to the landed commit
  - block cleanup when landed changes are missing, additional, rewritten,
    unlanded, or represented by a multi-parent merge
  - refresh the resource locator to the reviewed PR head before recording
    eligibility or a blocker
- tests or validator added:
  - exact squash-merge eligibility
  - rejection of additional unreviewed landed changes
  - rejection of missing, unlanded, and multi-parent merge evidence
  - regression coverage for finalized Review Packet binding, dirty worktrees,
    branch races, crash recovery, and ancestry-preserving cleanup
- related change records:
  - `2026-08-23-delivery-art-work-session-resource-retirement.md`
  - `2026-08-24-linked-worktree-self-cleanup-execution-boundary.md`

## Artifact And Deployment Evidence

- source-only change pending pull-request merge
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation:
  - focused work-session and resource-retirement tests: `33` passed, `0` failed
  - complete OOS test suite: `665` passed, `0` failed
  - API and worker images built and passed API-health and fail-closed-worker
    smoke checks
- live or dev-integration verification: after merge, retry terminal cleanup for
  `#986` and require one terminal cleanup receipt with its session-created
  worktree, local branch, and remote branch retired
- residual risk: legitimate squash merges with rewritten conflict resolution
  remain blocked for operator review; cleanup never infers equivalence from
  commit messages, patch IDs, or tree similarity alone

## Follow-Up

- required follow-up: merge Defect `#987` with an ancestry-preserving merge,
  deploy the corrected OOS source to the active dev-integration profile, and
  dogfood it by closing the blocked `#986` work session
- owner: `operator-orchestration-service`
- closure condition: `#986` produces terminal cleanup evidence without manual
  deletion or a weakened resource guard
