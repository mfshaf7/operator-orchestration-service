---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - src/art-workflow-artifacts.js
    - test/art-workflow-artifacts.test.js
    - test/http.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "Local managed-draft validation now enforces the same completion-evidence contract as the live broker before a completion-style mutation is submitted."
---

# 2026-10-15 completion draft preflight parity

## Summary

Managed mutation drafts for initiative close, work-item completion, and stale-open closeout now validate their structured completion evidence locally with the same shared contract enforced by the live broker.

## Classification

- area: Delivery ART managed mutation drafts
- type: validation parity repair
- runtime impact: malformed completion drafts fail before broker submission; valid payload and broker behavior are unchanged

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Epic 1275 Feature 1283 closeout
- related products or components: Workspace Delivery ART operator workflow

## Root Cause

- immediate failure: `draft validate` accepted untyped Test Result Evidence and Validation Evidence bullets that `work-item.stale-open-close` rejected at the broker boundary.
- actual root cause: managed draft semantics reused the shared completion validator only for done descriptions inside bulk updates, not for the three completion-style draft operations that carry structured evidence fields directly.
- why it escaped earlier controls: tests covered route locking and bulk-update description evidence but did not compare each completion-style draft operation with the broker completion contract.

## Source Changes

- changed workflow, adapter, or contract: managed mutation-draft validation calls the shared completion-evidence builder and validator for all three completion-style operations.
- tests or validator added: parameterized parity coverage proves valid evidence passes and untyped evidence fails for initiative close, work-item complete, and stale-open close.
- related change records: None.

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only validation repair pending normal merge and dev-integration reconciliation
- image tag or digest: None.
- runtime revision: None.

## Live Verification

- local validation: focused managed-artifact tests plus the repository validation suite
- live or dev-integration verification: rerun the corrected Feature 1283 draft locally to prove preflight acceptance without another OpenProject mutation
- residual risk: no known residual gap; broker validation remains the final fail-closed boundary

## Follow-Up

- required follow-up: refresh the Security-owned generated change-record index after merge
- owner: security-architecture
- due date or closure condition: before the next Epic 1275 source Landing Unit begins
