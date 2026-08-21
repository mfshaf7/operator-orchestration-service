---
security_evidence:
  review_areas:
    - runtime
    - delivery
  workstreams:
    - WS-007
  reviewed_artifacts:
    - src/delivery-art/lifecycle-authoring.js
    - test/delivery-art-lifecycle-authoring.test.js
    - docs/operations/delivery-workflow-operator-surface.md
    - docs/architecture/security-model.md
  notes: "The change strengthens immutable evidence identity without widening callers, mutation authority, custody permissions, merge authority, or runtime deployment scope."
---

# 2026-08-21 Review Packet Pre-Merge Revision Identity

## Summary

Pre-merge Review Packet v2 authoring now derives a deterministic packet
identity from the exact Landing Unit source revision set. A corrected pull
request head can therefore receive new immutable custody without overwriting or
conflicting with an earlier merge-ready packet.

## Classification

- area: Delivery ART evidence lifecycle
- type: workflow-control defect correction
- runtime impact: OOS Review Packet authoring output changes only when the
  recorded repo, base, branch, pull request, or source head changes

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Defect #943 under Feature #904 and Epic #882
- related products or components: OOS Delivery ART lifecycle and WGCF artifact
  custody

## Root Cause

- immediate failure: corrected evidence for Platform work item #942 was
  rejected by WGCF custody with an artifact identity conflict
- actual root cause: pre-merge packet identity was derived only from the work
  item, so different reviewed source heads reused one immutable artifact id
- why it escaped earlier controls: tests covered replay and stale-head
  rejection, but not re-authoring after review changed an already merge-ready
  pull request

## Source Changes

- changed workflow, adapter, or contract: schema-v2 pre-merge Review Packet
  authoring and the primary Delivery ART operator procedure
- tests or validator added: deterministic same-head replay, distinct
  corrected-head identity, valid corrected evidence, and continued stale
  evidence rejection
- related change records: None

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source and test change;
  dev-integration reconciliation of work item #942 is the acceptance proof
- image tag or digest: None
- runtime revision: pending merge and dev-integration profile reconciliation

## Live Verification

- local validation: `npm test` passed 592 tests; API docs, governance docs,
  pinned Delivery ART contracts, and diff checks passed
- live or dev-integration verification: pending merge of the OOS dependency PR
  and successful regeneration of #942 merge-readiness custody
- residual risk: prior immutable packets remain independently resolvable and
  are not overwritten; the lifecycle plan continues to select only its current
  local packet path

## Follow-Up

- required follow-up: reconcile the accepted-idea-delivery dev-integration
  runtime, regenerate #942 Review Packet custody, and close Defect #943 with
  the exact source and runtime evidence
- owner: `operator-orchestration-service`
- due date or closure condition: before Platform PR #217 merges
