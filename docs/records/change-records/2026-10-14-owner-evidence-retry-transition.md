---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - src/delivery-art/lifecycle.js
    - src/delivery-art/lifecycle-controller.js
    - test/delivery-art-lifecycle.test.js
    - test/delivery-art-lifecycle-controller.test.js
    - docs/contracts/delivery-workflow-api-v1.md
    - docs/operations/delivery-workflow-operator-surface.md
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "The repair restores retry availability for failed bounded evidence acquisition. It does not widen source commands, credentials, mutation authority, reviewer authority, merge authority, or evidence replacement scope."
---

# 2026-10-14 Owner evidence retry transition

## Summary

Make failed pre-merge and post-merge owner evidence resumable through the same bounded `work continue` path. Each command performs at most one failed acquisition attempt, and the following command retries after the reported cause is repaired.

## Classification

- area: Delivery ART work-session evidence lifecycle
- type: corrective Defect implementation
- runtime impact: failed owner evidence remains visible and executable instead of becoming a permanent gate or an internal retry loop

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: `openproject://work_packages/1301`
- related products or components: Operator Orchestration Service; Governance Operations Console delivery workflow

## Root Cause

- immediate failure: Console work item 1284 recorded a transient failed production-build result, but later `work continue` calls could not reacquire it.
- actual root cause: a current blocked pre-merge acquisition projected invalid evidence as a non-executable gate, while reconciliation had no command boundary after either evidence action returned another retry state.
- why it escaped earlier controls: prior retry coverage proved failed post-merge receipt replacement and source-executor replay behavior, but did not prove the complete pre-merge lifecycle or the one-attempt-per-command boundary.

## Source Changes

- changed workflow, adapter, or contract: project invalid pre-merge evidence to `project-review-evidence`, and stop reconciliation after one failed pre-merge or operating acquisition attempt.
- tests or validator added: prove the retry projection, first failed attempt return, later reacquisition, successful advance, and retained immutable passing-evidence behavior.
- related change records: `docs/records/change-records/2026-10-09-failed-owner-evidence-retry.md`; `workspace-governance/reviews/improvement-candidates/2026-10-14-owner-evidence-retry-transition-regression.yaml`

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: Landing Unit `delivery-1275-owner-evidence-retry`
- image tag or digest: None until the existing `refinement-catalog` composition rebuilds OOS from the merged source
- runtime revision: None until post-merge live verification

## Live Verification

- local validation: focused lifecycle tests, full repository validation, and base-aware change-record validation
- live or dev-integration verification: refresh the existing composition, run `work continue 1284`, and prove the failed production-build acquisition is retried and advances
- residual risk: a repeatedly failing owner command requires one deliberate `work continue` per attempt; this prevents hidden loops and keeps each attempt observable

## Follow-Up

- required follow-up: merge this Landing Unit, refresh the existing profile, resume work item 1284, and close the linked regression candidate only after the live retry succeeds
- owner: `operator-orchestration-service`
- due date or closure condition: before Feature 1283 and Epic 1275 close
