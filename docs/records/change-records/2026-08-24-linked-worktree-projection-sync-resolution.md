---
security_evidence:
  review_areas:
    - runtime
    - delivery
  reviewed_artifacts:
    - src/art-cli.js
    - test/art-cli.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-08-24 Linked Worktree Projection Sync Resolution

## Summary

Made Delivery ART projection synchronization derive the Platform Engineering
repository from the existing linked-worktree-aware workspace resolver instead
of from the invoking process directory.

## Classification

- area: Workspace Delivery ART local operator tooling
- type: canonical dependency-path correction and close-path hardening
- runtime impact: local ART CLI behavior only; no broker API, OpenProject
  mutation contract, governed runtime, stage, or production behavior changes

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Defect `#973` under delivery `#882`
- related components:
  - Workspace Delivery ART CLI
  - Platform Engineering OpenProject projection tooling

## Root Cause

- immediate failure: `work close` launched from a managed linked worktree could
  complete durable ART mutation and then fail projection sync with
  `spawn bash ENOENT`.
- actual root cause: Platform Engineering repository discovery used
  `process.cwd()/../platform-engineering` while WGCF and CGG discovery already
  used the canonical workspace resolver.
- why it escaped earlier controls: linked-worktree tests covered the shared
  resolver and its WGCF/CGG consumers, but projection sync retained a separate
  current-directory fallback and its test supplied an explicit platform root.

## Source Changes

- changed workflow or adapter:
  - preserve explicit `PLATFORM_ENGINEERING_ROOT` and
    `ART_PLATFORM_ENGINEERING_ROOT` precedence
  - derive the default Platform Engineering path from
    `resolveWorkspaceRoot`
  - pass the Git discovery seam through direct projection commands and the
    internal `work close` projection checkpoint
- tests or validator added:
  - projection-sync dry-run proves canonical Platform Engineering discovery
    from linked-worktree Git common-directory truth
  - the source-backed `#973` closeout is the managed linked-worktree dogfood
    proof for the complete close path
- related change record:
  - `2026-08-13-linked-worktree-workspace-resolution.md`

## Artifact And Deployment Evidence

- source-only change pending pull-request merge
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation:
  - `node --test test/art-cli.test.js`: `51` passed, `0` failed
  - `npm test`: `650` passed, `0` failed
  - `npm run validate:orchestration-bundle`: passed
  - `npm run validate:orchestration-openapi-schemas`: synchronized
  - `npm run validate:api-docs`: `74` documented routes matched implementation
  - `npm run validate:delivery-art-contracts`: current
  - `npm run validate:governance-docs`: passed
  - linked-worktree projection-sync dry-run resolved
    `/home/mfshaf7/projects/platform-engineering` and its canonical sync script
    without an explicit root override
  - base-aware change-record, OpenProject mutation-contract, and pull-request
    validation remain required on the immutable source head
- live or dev-integration verification: the final `#973` work close must run
  from its managed linked worktree and complete projection synchronization plus
  owned cleanup without a canonical-checkout rerun
- residual risk: non-Git callers retain the established sibling-repository
  fallback unless an explicit workspace root is configured

## Follow-Up

- required follow-up: merge and close the `#973` Landing Unit with finalized
  evidence, then complete the remaining `#882` initiative closeout controls
- owner: `operator-orchestration-service`
- closure condition: linked-worktree `work close` completes end to end
