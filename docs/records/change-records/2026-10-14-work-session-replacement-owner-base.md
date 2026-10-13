---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - src/delivery-art/work-session-controller.js
    - test/delivery-art-work-session.test.js
    - https://github.com/mfshaf7/security-architecture/blob/main/docs/reviews/components/2026-09-11-agent-gary-source-identity-boundary.md
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: The repair narrows reconstruction to one internally consistent current owner/base binding and adds a pristine-only repair for sessions persisted before that correction. It introduces no identity, credential, repository permission, review, merge, or runtime authority and preserves fail-closed provider and human-review controls.
---

# Work-session replacement-owner base resolution

## Summary

Architecture reconstruction now resolves the replacement Git base from the
current ART owner repo before it authors the replacement work-start and source
session. A superseded session can therefore move to a different owner repo
without combining the old repo's commit with the new repo's worktree.

The same existing `work reconstruct` command now repairs a session that was
persisted before that correction only when its base commit is unavailable in
the current owner repo and source plus evidence remain pristine. The durable
command result records the previous and replacement binding before source work
can begin.

## Classification

- area: Delivery ART work-session architecture reconstruction
- type: corrective owner-repo maintenance
- runtime impact: fixes the existing reconstruction path when an approved Architecture Packet changes Landing Unit ownership

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: work item #1281 under Epic #1275
- related component: Delivery ART work-session lifecycle

## Root Cause

- immediate failure: reconstruction attempted to create a Workspace Governance worktree at OOS commit `2b0ab79493939243629f3b0ae3486ab878aa24eb`, which is not a valid reference in that repo.
- actual root cause: `reconstruct()` passed `session.owner_repo` from the superseded session to `resolveBase()`, while `createDeliveryArtWorkSession()` independently derived the replacement owner from current ART truth.
- why it escaped earlier controls: the supersession tests changed packet content but kept the same owner repo, so they never exercised an ownership transfer across architecture revisions.

## Source Changes

- changed workflow, adapter, or contract: resolve the replacement base with the current continuation target's owner repo after current architecture and ART topology have been validated; detect an unavailable persisted base before worktree creation and permit the existing reconstruct action to repair only a pristine current-architecture session.
- tests or validator added: prove that an OOS-owned superseded session reconstructed to Workspace Governance resolves the Workspace Governance base and persists a matching owner/base pair; prove that a current-architecture session with an unavailable cross-repo base stops before worktree creation and records its pristine repair.
- related change records: none

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: corrective owner-repo maintenance branch `fix/work-session-reconstruct-owner-base` in PR #324 plus pristine persisted-state repair branch `fix/pristine-invalid-base-repair` in PR #325; exact reviewed heads and merge evidence are verified through the provider before deployment
- image tag or digest: recorded by the accepted-idea-delivery rebuild after merge
- runtime revision: recorded by the accepted-idea-delivery activation after merge

## Live Verification

- local validation: focused work-session regression tests, full repository tests, API contract validation, and base-aware change-record validation
- live or dev-integration verification: rebuild the existing accepted-idea-delivery composition, reconstruct work item #1281, and prove the resulting Workspace Governance worktree starts at the fetched Workspace Governance base
- residual risk: reconstruction still fails closed when current ART and architecture ownership disagree or the replacement repo/base is unavailable

## Follow-Up

- required follow-up: complete #1281 through the reconstructed Workspace Governance source session
- owner: `operator-orchestration-service`
- due date or closure condition: before #1281 source implementation resumes
