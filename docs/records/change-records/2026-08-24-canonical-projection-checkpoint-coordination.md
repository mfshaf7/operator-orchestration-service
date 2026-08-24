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

# 2026-08-24 Canonical Projection Checkpoint Coordination

## Summary

Made every linked OOS worktree resolve one canonical Delivery ART projection
checkpoint and prevented synchronization from clearing newer or failed state.

## Classification

- area: Workspace Delivery ART local operator tooling
- type: checkpoint ownership and retry correction
- runtime impact: local ART CLI coordination only; no broker API, OpenProject
  mutation contract, governed runtime, stage, or production behavior changes

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Defect `#977` under delivery `#884`
- related components:
  - Workspace Delivery ART CLI
  - Platform Engineering OpenProject projection tooling

## Root Cause

- immediate failure: a mutation in one linked worktree could mark a relative
  `.art/projection-state.json` while status or sync in another worktree read a
  different file.
- additional failure: successful platform sync deleted the checkpoint before
  scoped quality completed and without proving no newer mutation had arrived.
- correction: derive the default checkpoint from linked-worktree Git common
  directory truth, write it atomically, and clear it only when its canonical
  digest remains unchanged after all requested checks pass.

## Source Changes

- changed workflow or adapter:
  - all linked worktrees share the canonical owner-repo checkpoint
  - explicit `ART_PROJECTION_STATE_FILE` precedence remains unchanged
  - sync rejects stale clear attempts and retains newer dirty state
  - failed scoped quality retains dirty state for deterministic retry
  - a second sync after successful clear remains a no-op
- tests or validator added:
  - real-Git canonical and linked worktrees resolve and observe one checkpoint
  - concurrent newer state is retained and stale clear fails closed
  - quality failure retains the checkpoint
  - successful retry is idempotent

## Artifact And Deployment Evidence

- source change pending pull-request merge
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation:
  - `node --test test/art-cli.test.js`: `53` passed, `0` failed
  - `npm test`: `660` passed, `0` failed
  - `npm run validate:orchestration-bundle`: passed
  - `npm run validate:orchestration-openapi-schemas`: synchronized
  - `npm run validate:proposal-openapi-schemas`: synchronized
  - `npm run validate:delivery-art-contracts`: current
  - `npm run validate:api-docs`: `74` documented routes matched implementation
  - `npm run validate:governance-docs`: passed
  - `npm run validate:change-record-requirement`: passed against `origin/main`
  - `npm run validate:openproject-mutation-contracts`: no mutation-contract changes
- live or dev-integration verification: pending immutable source-head proof
- residual risk: simultaneous independent mutation writers remain serialized by
  normal operator workflow; this change guards synchronization cleanup rather
  than introducing a new distributed locking subsystem

## Follow-Up

- required follow-up: finalize Review Packet evidence, merge the Landing Unit,
  and close `#977` before `#907` source work begins
- owner: `operator-orchestration-service`
- closure condition: linked-worktree status, sync, retry, and cleanup remain
  coherent through governed closeout
