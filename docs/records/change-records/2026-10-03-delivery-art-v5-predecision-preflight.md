---
security_evidence:
  review_areas:
    - delivery
  reviewed_artifacts:
    - src/delivery-art/work-session-controller.js
    - test/delivery-art-work-session.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "The repair is read-only and preserves the existing decision, source-identity, custody, and mutation boundaries."
---

# Delivery ART v5 Pre-Decision Preflight

## Summary

Schema-v5 work preflight now returns the operator's decision draft and the
applicable outcome obligations before an evidence-owner Landing Unit has been
accepted. Evidence-owner obligations remain empty until the decision binds one
exact Landing Unit.

## Classification

- area: Delivery ART work-session preflight
- type: owner-repo maintenance
- landing unit decision: `child_isolated_landing_unit`
- runtime impact: repairs the read-only pre-decision path without changing
  work-start, mutation, or evidence acceptance

## Ownership

- owner repo: `operator-orchestration-service`
- work-tracking home: owner-repo-only maintenance; no new ART item
- related products or components: accepted-idea-delivery broker

## Root Cause

- immediate failure: `work preflight` returned an internal error after the
  current architecture advanced to schema v5
- actual root cause: work-contract projection invoked evidence-owner selection
  before a Landing Unit decision existed, while schema v5 correctly requires
  an exact owner for that selection
- why it escaped earlier controls: the no-decision preflight test used a v5
  packet without required conformance cases, so it never exercised owner
  selection

## Source Changes

- changed workflow or contract: pre-decision v5 projection returns no
  `evidence_owner_cases`, retains all applicable `outcome_cases`, and derives
  target readiness from those outcomes
- tests or validator added: a regression test covers required v5 conformance
  before a Landing Unit decision exists
- API contract: unchanged; the implementation now satisfies the existing
  read-only preflight response contract

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: focused and full local
  validation before review; merged-main runtime reconciliation remains required
- image tag or digest: not applicable; accepted-idea-delivery copies the pinned
  OOS source revision into its local runtime
- runtime revision: pending merge

## Live Verification

- local validation: focused work-session tests, full repository tests, API and
  governance documentation checks, diff-aware change-record validation, and
  `git diff --check`
- live verification: pending merged-main reconciliation and read-only #1229
  preflight
- residual risk: none beyond the existing requirement that an accepted
  decision bind one exact v5 evidence owner before source inspection

## Follow-Up

- required follow-up: merge, reconcile the accepted-idea-delivery profile to
  merged main with bounded single-writer admission, and repeat both the
  no-decision and decision-bound #1229 preflights
- owner: `operator-orchestration-service`
- due date or closure condition: merged-main preflight returns the decision
  draft without error and the accepted decision selects only #1229's owned
  cases

## Security Boundary

No caller, credential, mutation, approval, or environment authority changes.
The pre-decision path remains read-only and cannot assign evidence ownership or
start work.

## Rollback

Revert the landing commit and reconcile the accepted-idea-delivery profile.
Schema-v5 preflight without a decision would again fail before returning its
draft.
