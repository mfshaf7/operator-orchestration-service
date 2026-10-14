---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - src/delivery-art/lifecycle-cli-adapters.js
    - test/delivery-art-lifecycle-cli-adapters.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "Owner evidence profile contract failures now produce deterministic fail-closed evidence instead of escaping the governed lifecycle as an unrecorded exception."
---

# 2026-10-15 owner evidence profile failure projection

## Summary

Delivery ART source evidence acquisition now validates a proposed candidate profile before merge and records missing, malformed, schema-invalid, or conformance-incomplete profiles as deterministic failed evidence. The same failure projection applies when a merged revision's accepted profile is invalid, preserving the governed recovery path instead of terminating outside lifecycle state.

## Classification

- area: Delivery ART owner-evidence acquisition
- type: lifecycle failure-projection repair
- runtime impact: invalid owner evidence profiles fail closed as auditable blocked evidence; valid profile execution is unchanged
- landing unit decision: `child_isolated_landing_unit` because this OOS control-plane repair has a different owner, review path, deployment, and rollback boundary from Platform work item 1291

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Epic 1275 Platform composition work item 1291
- related products or components: Workspace Delivery ART lifecycle and owner-source executor

## Root Cause

- immediate failure: post-merge operating evidence acquisition threw `delivery_art_evidence_profile_invalid` because the accepted Platform profile specified a timeout above the OOS schema limit.
- actual root cause: pre-merge acquisition executed the base-admitted profile but did not separately validate the proposed candidate profile, while post-merge profile contract failures escaped as exceptions instead of becoming failed lifecycle evidence.
- why it escaped earlier controls: tests covered valid base-profile execution and command failures, but not candidate-profile contract drift or invalid accepted-profile recovery.

## Source Changes

- changed workflow, adapter, or contract: the CLI source adapter validates the candidate evidence profile without executing candidate commands and converts profile contract failures into digest-bound failed evidence receipts.
- tests or validator added: adapter regression coverage proves invalid candidate and accepted profiles execute no evidence command, bind the failing revision, and project blocked acquisition state.
- related change records: `2026-10-14-non-architecture-owner-evidence-tests.md`, `2026-10-14-owner-evidence-retry-transition.md`, and `2026-10-13-operating-evidence-failure-precedence.md`.

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source repair pending normal review, merge, and active `dev-integration` reconciliation
- image tag or digest: None.
- runtime revision: None.

## Live Verification

- local validation: focused lifecycle adapter, evidence acquisition, controller, and work-session suites plus the complete repository test and contract validation gates
- live or dev-integration verification: reproduce work item 1291 acquisition against the immutable invalid Platform revision and confirm it projects failed operating evidence before governed recovery
- residual risk: the accepted Platform revision remains invalid until its governed work session is recovered and a corrected profile revision is reviewed

## Follow-Up

- required follow-up: reconcile the generated Security change-record index, merge and deploy this repair, then recover work item 1291 and replace the invalid Platform evidence profile through a fresh governed session
- owner: operator-orchestration-service, security-architecture, and platform-engineering in dependency order
- due date or closure condition: before work item 1291 can commission or close
