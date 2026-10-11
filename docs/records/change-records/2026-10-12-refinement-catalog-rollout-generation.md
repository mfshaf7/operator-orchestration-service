---
security_evidence:
  review_areas:
    - runtime
    - delivery
  reviewed_artifacts:
    - dev-integration/profiles/accepted-idea-delivery/scripts/common.sh
    - dev-integration/profiles/accepted-idea-delivery/scripts/up.sh
    - test/devint-refinement-catalog-composition.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: The repair waits for Kubernetes to observe the exact restarted worker generation before accepting rollout readiness and does not change identities, credentials, network access, or workflow authority.
---

# Refinement And Catalog Rollout Generation

## Summary

The accepted-idea-delivery profile now binds Refinement worker readiness to the
exact deployment generation created by its rollout restart. A first clean
composition start can no longer accept rollout success from the prior
generation and then fail the aggregate check while the new worker is still
unavailable. Missing aggregate resources are reported by bounded, non-secret
resource labels.

## Classification

- area: `refinement-catalog` dev-integration runtime readiness
- type: corrective owner-repo maintenance
- runtime impact: deterministic first-start convergence for the existing composed OOS worker

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: #1246 under Feature #1215 and Epic #1203
- related products or components: accepted-idea-delivery profile and Platform composition runner

## Root Cause

- immediate failure: the first clean composition start twice reported the composed Refinement and Catalog runtime as `missing` and rolled every profile back; repeating the same command succeeded.
- actual root cause: the profile restarted a newly applied worker deployment and immediately invoked `kubectl rollout status`; before the controller observed the new generation, that command could return success for the prior generation. The following aggregate check then observed the restarted worker with zero available replicas.
- why it escaped earlier controls: the test harness represented the worker as immediately available and asserted only that a restart and rollout command existed. It did not model the deployment-generation boundary or require resource-specific missing-state diagnostics.

## Source Changes

- changed workflow, adapter, or contract: capture the post-restart deployment generation, wait until Kubernetes reports that exact generation as observed, and only then evaluate rollout status; preserve existing readiness tokens while emitting bounded missing-resource labels on stderr.
- tests or validator added: prove the generation wait precedes rollout status, a failed generation wait cannot fall through to a stale rollout result, and missing worker availability is identified without credential disclosure.
- related change records: `docs/records/change-records/2026-10-09-agent-console-runtime-hook.md`

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: owner-repo maintenance Landing Unit `maintenance-refinement-catalog-rollout-generation`
- image tag or digest: None; the dev-integration profile mounts exact reviewed source
- runtime revision: pending merged source and one clean `refinement-catalog` composition start

## Live Verification

- local validation: focused composition tests passed 12/12; the full repository suite passed 1,257 tests with 2 documented skips and no failures; governance-document, structured-record, generated Security-index, and base-aware change-record validation passed
- live or dev-integration verification: required after merge; one clean composition start must succeed without replaying `up`
- residual risk: Kubernetes rollout remains bounded by the existing 180-second timeout and fails closed if the new generation cannot converge

## Follow-Up

- required follow-up: merge the maintenance Landing Unit, rebind exact-revision Security evidence, prove one clean composition start, then resume the already-passing #1246 operating-evidence closeout
- owner: `operator-orchestration-service`
- due date or closure condition: before Feature #1215 and Epic #1203 close
