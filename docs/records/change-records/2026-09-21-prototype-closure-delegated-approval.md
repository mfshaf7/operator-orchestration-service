---
security_evidence:
  review_areas:
    - identity
    - delivery
    - ai
  reviewed_artifacts:
    - src/prototype-closure/provider-client.js
    - src/prototype-closure/service.js
    - test/prototype-closure-clients.test.js
    - test/prototype-closure-service.test.js
    - docs/operations/prototype-closure-operator-surface.md
  workstreams:
    - WS-007
  notes: "Requires an exact-head delegated approval attestation; normal Closure activation remains false."
---

# Prototype Closure Delegated Approval

## Summary

- Date: 2026-09-21
- Short title: Prototype Closure delegated approval
- owner: `operator-orchestration-service`
- work: Platform activation dependency #1107 under Feature #921 and Epic #892
- security delta: `security-architecture/docs/reviews/components/2026-09-21-prototype-closure-delegated-approval.md`

## Classification

- area: Prototype Closure source review
- type: delegated approval boundary correction
- runtime impact: none until Closure activation

## Ownership

OOS owns the provider readback and terminal receipt. Security owns the accepted
risk decision; Platform owns credential custody and activation.

## Root Cause

The provider previously treated any exact-head GitHub `User` approval from a
different account as independent human review. That cannot distinguish the
operator's decision from Agent Gary's delegated execution.

## Source Changes

The Closure provider no longer calls a GitHub `User` approval independent
human review. A merged Studio PR must have an approval from the exact operator
account whose JSON review body attests that Agent Gary executed an explicit
operator decision for that PR number and exact head. The provider still
requires successful exact-head Studio validation and canonical merged source.
OOS keeps the review reference in the completed terminal receipt. A missing,
stale, wrong-account, or change-requested approval does not produce a completed
Closure receipt.

The review body is an agent-authored attestation, not provider-verifiable proof
of the conversation. The operator must authorize each exact PR and head in the
conversation before the delegated account action. The Security delta records
that residual risk for local `dev-integration` only.

## Artifact And Deployment Evidence

- source: this review branch; merge evidence pending
- deployment: none
- runtime activation: unchanged and false

## Live Verification

No live delegated approval, Platform credential projection, or configured
Console closure is claimed by this source change.

## Validation

- Closure provider and service tests cover accepted, absent, stale-head,
  wrong-PR, wrong-account, self-reviewed, and change-requested cases.
- Isolated Prototype Closure conformance passed all 16 scenarios against
  fetched Studio, WGCF, and Console source revisions; it includes a merged
  change without delegated approval remaining nonterminal.
- The Prototype Closure OpenAPI projection and governance docs checks pass.

## Follow-Up

Land the Security and workspace contract changes before Platform activation.
Platform #1107 and Console #1151 still own their configured operating proof.
