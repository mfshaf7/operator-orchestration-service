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

# 2026-08-24 Linked Worktree Self-Cleanup Execution Boundary

## Summary

Made Delivery ART resource retirement relocate its close process to the
canonical OOS checkout before planning deletion of a session-created linked
worktree.

## Classification

- area: Workspace Delivery ART work-session resource retirement
- type: cleanup execution-boundary correction
- runtime impact: local ART CLI close behavior only; deletion authority,
  resource ownership, OpenProject mutation contracts, governed runtime, stage,
  and production behavior are unchanged

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Defect `#976` under delivery `#882`
- related products or components:
  - Workspace Delivery ART work-session controller
  - OOS linked-worktree source adapter

## Root Cause

- immediate failure: the first `work close` invocation for `#973` entered
  `cleanup-blocked` because its process was still inside the managed worktree
  selected for deletion.
- actual root cause: resource retirement reused the source-work execution
  directory instead of establishing a canonical cleanup execution boundary
  before evaluating the unchanged current-process guard.
- why it escaped earlier controls: real-Git retirement tests ran from an
  external test checkout and therefore proved deletion safety without proving
  the operator command's invocation location.

## Source Changes

- changed workflow, adapter, or contract:
  - add an explicit resource-retirement execution preparation seam
  - relocate a close process started inside its managed worktree to the
    canonical OOS checkout before retirement planning
  - convert relocation failure into retryable `cleanup-blocked` state
  - retain all existing ownership, path, head, dirty-state, merged-PR, and
    operator-retention checks
- tests or validator added:
  - reproduce the original current-process block from a managed worktree
  - prove canonical relocation makes the same resource eligible
  - prove relocation failure blocks before deletion and succeeds on retry
  - retain the existing crash, dirty-worktree, remote-race, and source-binding
    regression coverage
- related change records:
  - `2026-08-24-linked-worktree-projection-sync-resolution.md`

## Artifact And Deployment Evidence

- source-only change pending pull-request merge
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation:
  - focused work-session and retirement tests: `31` passed, `0` failed
  - complete OOS test suite: `652` passed, `0` failed
- live or dev-integration verification: the final `#976` close must be invoked
  from its managed linked worktree and produce terminal cleanup evidence without
  a canonical-checkout rerun
- residual risk: an interactive parent shell can retain its own directory
  handle after the child CLI exits; normal governed execution uses bounded
  non-interactive commands, and the deletion guard remains scoped to the close
  process that owns retirement

## Follow-Up

- required follow-up: merge the `#976` Landing Unit, finalize its Review
  Packet, and dogfood the corrected close path from the managed worktree
- owner: `operator-orchestration-service`
- closure condition: one original `work close` invocation produces the terminal
  cleanup receipt and retires the session-created worktree and branches

