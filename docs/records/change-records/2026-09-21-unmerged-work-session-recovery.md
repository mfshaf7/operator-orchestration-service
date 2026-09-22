---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - contracts/delivery-art/delivery-art-work-session-cleanup-receipt.schema.json
    - contracts/delivery-art/delivery-art-work-session-resource-manifest.schema.json
    - contracts/delivery-art-work-session/recovery-receipt.schema.json
    - docs/contracts/delivery-workflow-api-v1.md
    - docs/operations/delivery-workflow-operator-surface.md
    - src/delivery-art/work-session-cli-adapters.js
    - src/delivery-art/work-session-controller.js
    - src/delivery-art/work-session-service.js
    - src/delivery-art/work-session-resource-retirement.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "Unmerged recovery archives only a superseded, locally committed session with no remote branch, PR, or completion evidence; it does not approve source or ART closeout."
---

# Unmerged Work-Session Recovery

## Summary

ART #1107 has an architecture-superseded work session with one local source
commit but no remote PR or branch. Pristine reconstruction correctly rejects
it, while the existing recovery path requires a merged PR. The source commit
has been reconciled separately into the current Platform source branch; the
old worktree is retained for audit.

## Classification

- area: Delivery ART work-session recovery
- type: bounded recovery of unmerged architecture-superseded local work
- runtime impact: one authenticated broker command and retained session archive

## Ownership

- owner repo: `operator-orchestration-service`
- related ART item: #1107 under Epic #892
- source authority: local Git, remote Git, and GitHub PR readback

## Root Cause

The accepted architecture changed after a local commit. Pristine
reconstruction cannot preserve that commit, and merged-session recovery
requires a PR that does not exist. Neither path is truthful for this state.

## Source Changes

This change extends `work recover` with an explicit `archive-unmerged` mode.
OOS rechecks the current architecture, open ART item, pristine session
evidence, clean local worktree, exact branch/worktree head, absent remote
branch, and absent PR. It then archives only coordination state and writes a
digest-bound receipt. It never calls source retirement, deletes the old
worktree, fabricates a Review Packet, or claims completion.

A replacement start must use the current accepted architecture and a new
branch. OOS assigns a new session generation and worktree path, preventing
the archived session ID and retained worktree from being overwritten or reused.
The resource manifest and terminal cleanup receipt bind that same exact
generation identity, so a replacement session remains valid through eventual
resource retirement.
The existing exact merged-PR recovery shape remains compatible.

## Artifact And Deployment Evidence

- source change: this OOS branch and its eventual PR
- runtime revision: not yet commissioned
- ART completion: not claimed

## Live Verification

Focused controller, source-adapter, service, HTTP, CLI, resource-manifest, and
cleanup-receipt tests cover normal
recovery, replay, rejected remote/dirty/mismatched source, retained old source,
replacement session identity, and terminal cleanup of a recovered generation.
OpenAPI and receipt schemas are checked
against the source generator. Live #1107 recovery and commissioning remain
separate from this source proof.

## Follow-Up

After local commissioning, run exact #1107 recovery, review the ART blocker,
and start a replacement session on a new branch. Reconcile the retained
commit before implementation. Local source remains after archival until that
reconciliation is proven.

## Rollback

Revert the new request mode and source-generation handling together. Retain
any already archived sessions, receipts, and source worktrees for audit.
