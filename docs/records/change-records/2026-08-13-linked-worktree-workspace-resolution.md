---
security_evidence:
  review_areas:
    - runtime
    - delivery
  reviewed_artifacts:
    - src/art-cli.js
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-08-13 Linked Worktree Workspace Resolution

## Summary

Made ART CLI workspace dependency discovery resolve the canonical workspace
root from Git's common directory, so linked worktrees find sibling WGCF and CGG
repos without operator-specific path overrides.

## Classification

- area: Workspace Delivery ART local operator tooling
- type: dependency-path correction and regression hardening
- runtime impact: local ART CLI behavior only; no broker API, OpenProject
  mutation, governed runtime, stage, or production behavior changes

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Defect `#822` under delivery `#698`
- related products or components:
  - Workspace Delivery ART CLI
  - `workspace-governance-control-fabric`
  - `context-governance-gateway`

## Root Cause

- immediate failure: ART commands launched from a linked worktree searched for
  CGG and WGCF beside the worktree container rather than in the canonical
  workspace.
- actual root cause: the default workspace root was the parent of the process
  working directory, which is only valid for a canonical repo checkout.
- why it escaped earlier controls: ART CLI tests supplied explicit dependency
  repo paths and did not exercise the default resolver from a real Git linked
  worktree.

## Source Changes

- changed workflow, adapter, or contract:
  - preserve explicit `ART_WORKSPACE_ROOT` and `WORKSPACE_ROOT` precedence
  - derive the canonical workspace from `git rev-parse --git-common-dir`
  - retain the existing parent-directory fallback for non-Git callers
  - make CGG and WGCF consume the corrected shared resolver
- tests or validator added:
  - explicit override precedence
  - real-Git linked-worktree canonical workspace discovery
  - ART continuation execution from the active linked worktree
- related change records: None

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only local CLI
  correction pending pull-request merge
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation:
  - `node --test test/art-cli.test.js`: `46` passed, `0` failed
  - `npm test`: `546` passed, `0` failed
  - `npm run validate:orchestration-bundle`: passed
  - `npm run validate:orchestration-openapi-schemas`: synchronized
  - `npm run validate:api-docs`: `68` documented routes matched
    implementation
  - `npm run validate:delivery-art-contracts`: current
  - `npm run validate:governance-docs`: passed
  - `npm run validate:change-record-requirement`: passed against `origin/main`
  - `npm run validate:openproject-mutation-contracts`: no OpenProject mutation
    changes detected against `origin/main`
  - OpenProject mutation-contract validator self-test: passed
  - API and orchestration-worker image builds plus API health and fail-closed
    worker smoke checks: passed
  - exact `npm run art -- item continuation 822` reproduction from the linked
    worktree: passed with CGG packet projection and WGCF readiness
- live or dev-integration verification: not required; no deployed runtime path
  changes
- residual risk: callers outside Git still rely on the existing sibling-repo
  directory convention unless they set an explicit workspace root

## Follow-Up

- required follow-up: merge and close the `#822` Landing Unit with finalized
  source evidence
- owner: `operator-orchestration-service`
- due date or closure condition: before Feature `#800` closes
