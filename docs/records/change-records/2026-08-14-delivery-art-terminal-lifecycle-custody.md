---
security_evidence:
  review_areas:
    - runtime
    - delivery
  reviewed_artifacts:
    - contracts/delivery-art-lifecycle/lifecycle-plan.schema.json
    - src/delivery-art/lifecycle.js
    - src/delivery-art/lifecycle-controller.js
    - src/art-cli.js
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-08-14 Delivery ART Terminal Lifecycle Custody

## Summary

Bound finalized Review Packet custody into the lifecycle plan so terminal
status survives normal source-worktree and local-artifact cleanup.

## Classification

- area: Workspace Delivery ART lifecycle status
- type: integrity correction and terminal-state recovery
- runtime impact: local ART lifecycle CLI behavior changes after merge; no
  governed stage or production activation

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Defect `#834` under delivery `#698`
- related components:
  - Workspace Delivery ART
  - `workspace-governance-control-fabric`

## Root Cause

- immediate failure: a finalized lifecycle plan whose artifact paths were
  relative to a deleted source worktree fell back into Git inspection and
  failed with `git ENOENT`.
- actual root cause: finalization persisted the Review Packet in WGCF but did
  not bind that durable reference back into the lifecycle plan. Terminal status
  therefore still depended on local artifact files being present.
- why it escaped earlier controls: the earlier regression test removed source
  adapter availability while retaining every finalized artifact in its fake
  filesystem. It did not remove both the checkout and local artifact copies.

## Source Changes

- lifecycle plans accept a content-addressed
  `artifacts.finalized_review_packet_ref`
- reconciliation writes that reference after durable finalization
- terminal status resolves the exact packet through the broker and WGCF when
  local copies are absent
- terminal projection validates delivery, coverage, operator, Landing Unit,
  source, rollback, custody, and digest binding before trusting the packet
- pre-final lifecycle state continues to require the declared source checkout
  and fails closed when it is absent

## Validation

- focused lifecycle contract, controller, and CLI adapter suites
- exact `#832/#833` lifecycle status after its Platform worktree and all local
  lifecycle artifacts were removed
- full owner-repository validation before merge

## Artifact And Deployment Evidence

- source change pending pull-request review and merge
- no image, deployment, stage, or production mutation is part of this Landing
  Unit

## Live Verification

- current source proves the exact deleted-worktree `#832/#833` lifecycle plan
  resolves its finalized packet from WGCF and reports complete
- post-merge verification must repeat that command through the merged OOS CLI

## Follow-Up

- close `#834` with its finalized Review Packet after merge
- generate a fresh commissioning baseline and authorization cycle before
  resuming `#751`
- owner: `operator-orchestration-service`
- closure condition: merged source and post-cleanup lifecycle proof

## Rollback

Revert the OOS pull request and remove the optional terminal reference from
affected local plans. Existing immutable WGCF evidence remains retained.
