---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - contracts/delivery-art-lifecycle/capabilities.json
    - contracts/delivery-art-work-session/work-session.schema.json
    - contracts/delivery-art/delivery-art-work-session-cleanup-receipt.schema.json
    - contracts/delivery-art/delivery-art-work-session-resource-manifest.schema.json
    - src/art-cli.js
    - src/delivery-art/work-session-cli-adapters.js
    - src/delivery-art/work-session-controller.js
    - src/delivery-art/work-session-resource-retirement-controller.js
    - src/delivery-art/work-session-resource-retirement.js
    - src/delivery-art/work-session-store.js
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-08-23 Delivery ART Work-Session Resource Retirement

## Summary

Extended the existing Delivery ART `work close` path with provenance-bound,
restartable retirement of session-created Git and allowlisted managed state.
The implementation remains inactive until the recorded activation work item
closes.

## Classification

- area: Workspace Delivery ART source lifecycle
- type: destructive-action authorization, reconstructable cleanup state, and
  terminal evidence retention
- runtime impact: source implementation only until Security `#969`, source
  merge, WGCF custody `#971`, and activation `#970` complete

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: User story `#968` under delivery `#958`
- related products or components:
  - `operator-orchestration-service`
  - Workspace Delivery ART
  - `workspace-governance`
  - `workspace-governance-control-fabric`
  - `security-architecture`

## Root Cause

- immediate failure: terminal work close removed coordination state but did not
  own or prove cleanup of the worktree and branches created for that session.
- actual root cause: the work-session contract had no persisted creation
  provenance, ordered cleanup state, retry boundary, or terminal cleanup
  receipt outside the active session.
- why it escaped earlier controls: prior lifecycle tests proved worktree
  reconstruction and ART closeout, but did not test destructive ownership,
  partial deletion, or crash recovery between cleanup actions.

## Source Changes

- changed workflow, adapter, or contract:
  - synced canonical resource-manifest and cleanup-receipt contracts from
    Workspace Governance
  - recorded worktree, local-branch, and remote-branch provenance when the
    session creates or first observes them
  - added fail-closed planning for dirty, mismatched, unmerged, unsafe,
    pre-existing, and ambiguous resources, including exact owner-repo, Landing
    Unit branch, base, remote, and managed-state allowlist binding
  - persisted every cleanup transition and retained a create-once terminal
    receipt before removing the active session and aliases
  - retained the existing `work close` command and gated cleanup on work item
    `#970` rather than introducing another operator surface
- tests or validator added:
  - real Git worktree, local branch, and remote branch retirement
  - dirty worktree and unsafe or inferred ownership rejection
  - cross-repo, branch, and remote locator redirection rejection
  - remote inspection failure without false branch-removal claims
  - deletion-before-persistence crash recovery without repeated deletion
  - legacy schema-v1 session migration and receipt-index crash recovery
  - `cleanup-blocked` retry, receipt replay, activation gating, and managed-state
    allowlist coverage
- related change records:
  - [2026-08-23-delivery-art-work-session-lifecycle.md](2026-08-23-delivery-art-work-session-lifecycle.md)

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only pending exact
  review head, Security acceptance, merge, custody parity, and activation
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation: focused conformance and full repository validation are
  required on the exact review head
- live or dev-integration verification: pending activation; the pre-activation
  path must keep legacy close behavior
- residual risk: remote-branch deletion depends on exact merged pull-request
  evidence and remains blocked on any GitHub inspection or head mismatch

## Follow-Up

- required follow-up:
  - obtain exact-head Security acceptance through `#969`
  - merge the OOS `#968` and WGCF `#971` Landing Units in the approved order
  - activate the owner capability projection and schema-v2 packet through
    Workspace Governance `#970`
- owner: `security-architecture`, `operator-orchestration-service`,
  `workspace-governance-control-fabric`, then `workspace-governance`
- due date or closure condition: before resource retirement is represented as
  active normal-path behavior
