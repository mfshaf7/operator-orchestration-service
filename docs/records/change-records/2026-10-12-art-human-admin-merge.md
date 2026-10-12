---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - security-architecture/docs/reviews/components/2026-10-12-oos-art-human-admin-merge.md
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: The fresh delta review approves this bounded use of the existing human repository-policy bypass after all existing managed merge gates pass.
---

# 2026-10-12 ART human admin merge

## Summary

The Delivery ART work-session merge adapter now uses the admitted human
reviewer's configured repository-policy bypass after every existing exact-head,
approval, check, identity, and durable Review Packet gate has passed.

## Classification

- area: Delivery ART source closeout
- type: workflow correction
- runtime impact: active `work merge` behavior in the accepted-idea-delivery profile

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: `openproject://work_packages/1253`
- related products or components: Delivery ART work-session source executor

## Root Cause

- immediate failure: `work merge 1253` received GitHub's base-policy rejection after the exact Agent Gary head had passed CI and received the required human approval.
- actual root cause: the executor invoked a normal squash merge even though the active workspace ruleset admits `mfshaf7` as the pull-request bypass actor for the single-human-reviewer boundary.
- why it escaped earlier controls: the adapter test asserted exact-head merge arguments but modeled a repository with no active ruleset, so it encoded the non-bypass command as the expected success path.

## Source Changes

- changed workflow, adapter, or contract: `mergePullRequest` adds `--admin` only after the existing human-identity and exact approved-head checks; operator and API guidance now state that bounded behavior.
- tests or validator added: the adapter regression assertion requires `--admin` together with `--match-head-commit` and the existing negative review cases remain intact.
- related change records: `workspace-governance/reviews/improvement-candidates/2026-10-12-delegated-source-closeout-regression.yaml`

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only until the reviewed PR merges and the accepted-idea-delivery profile refreshes OOS from merged `main`.
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation: targeted adapter tests and the OOS CI-equivalent validation suite must pass against `origin/main`.
- live or dev-integration verification: retry `npm run art -- work merge 1253` after the repaired OOS revision is active; require exact merged-head readback.
- residual risk: the human bypass remains privileged, but the executor cannot reach it before the admitted identity, exact PR/head, approval, checks, and durable Review Packet are all current.

## Follow-Up

- required follow-up: merge the source correction, activate the repaired OOS revision, finish work item 1253, and close the linked regression candidate with landed evidence.
- owner: `operator-orchestration-service`
- due date or closure condition: completed when work item 1253 merges through the repaired managed path and strict branch cleanup passes.
