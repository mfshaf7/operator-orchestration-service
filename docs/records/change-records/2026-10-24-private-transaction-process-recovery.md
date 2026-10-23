---
security_evidence:
  review_areas:
    - runtime
    - delivery
  findings: []
  risks: []
  workstreams: [WS-007]
  reviewed_artifacts:
    - src/persistence/private-file-transactions.js
    - docs/operations/private-transaction-recovery.md
    - test/private-file-transactions.test.js
  notes: Retains source-effect/revocation serialization; replaces ambiguous PID ownership with kernel-held descriptors and requires a quiesced legacy migration.
---

# 2026-10-24 Private transaction process recovery

## Summary

Release private transaction ownership when its actual process dies, including
when a replacement container reuses PID 1. Retain the same store interfaces,
asynchronous source lease boundary and fail-closed concurrent writer behavior.

## Classification

- area: private workflow persistence
- type: maintenance defect repair
- runtime impact: existing Platform Operation, Prototype Source Authoring and Repository Owner Bootstrap transaction locking; quiesced one-time migration required
- Landing Unit Decision: `child_isolated_landing_unit`; owner-repo maintenance `maintenance-private-transaction-process-recovery` has an independent OOS review and rollback boundary from Workspace Governance guidance #1299

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: #1299 continuation is blocked; repair uses the operator-approved maintenance path without adding an ART child
- related products or components: Governance Operations Console; Platform Operation source authority
- tracking record: `workspace-governance/reviews/improvement-candidates/2026-10-24-private-transaction-pid-reuse-recovery-gap.yaml`

## Root Cause

- immediate failure: the original #1299 Project Evidence action returned private `state_busy` twice after its real source publication had succeeded
- actual root cause: the source-intent lease created at 2026-10-23T21:07:22.263Z recorded only PID 1; the API replacement created at 21:09:00Z also used PID 1, so `process.kill(pid, 0)` mistook the new process for the dead original holder
- why it escaped earlier controls: asynchronous lease tests proved active-process serialization but not real process death or container PID reuse

## Source Changes

- changed workflow, adapter, or contract: the existing synchronous helper retains one descriptor-backed kernel flock throughout the entire operation, including Promise settlement; kernel ownership does not depend on PID-file inspection or a timeout
- tests or validator added: real child-process contention, graceful termination and SIGKILL recovery; same-process asynchronous contention and independent keys; sync/async exception release; unknown/live/dead legacy record refusal; missing-tool denial
- related change records: None

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: pending exact source validation, review, quiesced migration, Security readmission and normal composition activation
- image tag or digest: pending reviewed build
- runtime revision: pending activation; the currently running source is not represented as repaired

## Live Verification

- local validation: focused kernel-lock tests pass; full CI-equivalent source validation is required before publication
- live or dev-integration verification: original-session continuation and source receipt readback are required after migration, not yet claimed
- residual risk: mixed old/new protocols cannot safely share the same state root; migration and rollback must quiesce writers

## Follow-Up

- required follow-up: exact source review and activation, original-session continuation, then candidate closure with actual source and operating evidence
- owner: `operator-orchestration-service` with Platform deployment and Security acceptance owners
- due date or closure condition: resolve before Epic #1275 final acceptance
