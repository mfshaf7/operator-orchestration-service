---
security_evidence:
  review_areas:
    - delivery
    - runtime
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-08-11 Review Packet Source Binding

## Summary

Hardened pre-merge Review Packet readiness so one packet represents one
owner-repo Landing Unit and cannot report ready from stale, unpushed, dirty, or
already-merged source evidence.

## Classification

- area: delivery workflow
- type: workflow control and evidence-integrity hardening
- runtime impact: broker readiness adds static packet checks; the local ART CLI
  adds live Git and GitHub source verification
- ART slice: `#812` review-authority regression under delivery `#698`

## Ownership

- owner repo: `operator-orchestration-service`
- related ART work:
  - `#698` durable governance orchestration Epic
  - `#800` ART work-start, evidence, and closeout hardening Feature
  - `#812` bounded advisory review and stale Review Packet evidence Defect

## Root Cause

- immediate failure: the #811 Review Packet retained early heads for three
  repos and one PR URL after those PRs had moved and merged, but readiness still
  reported `ready=true`.
- actual root cause: readiness validated self-declared packet completeness but
  did not bind that declaration to one clean owner checkout, its pushed branch,
  or the live open PR head.
- why it escaped earlier controls: the v1 packet allowed several repos under one
  PR field and delegated current-source verification to operator memory.

## Source Changes

- changed workflow, adapter, or contract:
  - [src/art-workflow-artifacts.js](../../../src/art-workflow-artifacts.js)
    restricts source-backed packets to one owner repo and validates current
    local, remote, and GitHub source binding.
  - [src/art-cli.js](../../../src/art-cli.js) runs live source binding after the
    broker accepts the packet shape and fails closed before merge.
  - [docs/contracts/delivery-workflow-api-v1.md](../../contracts/delivery-workflow-api-v1.md)
    and
    [docs/operations/delivery-workflow-operator-surface.md](../../operations/delivery-workflow-operator-surface.md)
    define the one-repo packet and exact-head proof.
- tests or validator added:
  - static cross-repo packet rejection
  - clean exact-source acceptance
  - stale local and PR head rejection
  - CLI fail-closed integration after successful broker shape validation

## Artifact And Deployment Evidence

- source-only change before merge:
  - broker static readiness rejects ambiguous cross-repo source evidence
  - local CLI readiness requires a clean checkout, recorded full head and merge
    base, matching changed files, matching pushed branch, and an open non-draft
    GitHub PR at the same head
- image tag or digest:
  - None
- runtime revision:
  - no deployment is required for the CLI source-binding proof; broker static
    checks use the normal OOS rollout path when activated

## Live Verification

- local validation:
  - `node --test test/art-workflow-artifacts.test.js`
  - `node --test test/art-cli.test.js`
- live or dev-integration verification:
  - pending exact-head PR readiness proof for this Landing Unit
- residual risk:
  - the broker API cannot independently inspect an operator's local checkout;
    immutable cross-service custody remains owned by the #810/#802 control path

## Follow-Up

- required follow-up:
  - reconcile #811 with separate finalized owner-repo evidence instead of the
    stale multi-repo v1 packet
- owner:
  - `operator-orchestration-service`
- due date or closure condition:
  - before closing `#812`
