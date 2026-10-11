---
security_evidence:
  review_areas:
    - runtime
    - identity
    - secrets
  reviewed_artifacts:
    - dev-integration/profiles/accepted-idea-delivery/scripts/up.sh
    - test/devint-refinement-catalog-composition.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: The Refinement worker explicitly disables the broker-only Agent Console capability and still does not receive the Agent Console credential. A delayed process-readiness probe prevents immediate runtime-construction failures from being reported as a successful rollout.
---

# Refinement Worker Capability Isolation

## Summary

The accepted-idea-delivery Refinement worker no longer inherits the Agent
Console activation state intended for the OOS API. Its pod explicitly overrides
`OOS_AGENT_CONSOLE_ENABLED=false`, and Kubernetes waits for the worker process
to remain alive through the initial runtime-construction window before the
deployment becomes Ready.

## Classification

- area: `refinement-catalog` dev-integration worker composition
- type: corrective owner-repo maintenance
- runtime impact: isolates the worker from a broker-only capability and prevents false-ready startup

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: #1246 under Feature #1215 and Epic #1203
- related products or components: accepted-idea-delivery Refinement worker and Agent Console runtime

## Root Cause

- immediate failure: the Refinement worker repeatedly entered `CrashLoopBackOff` with `agent_console_configuration_missing` while the composition command could report success.
- actual root cause: the worker consumed the API broker environment secret, including `OOS_AGENT_CONSOLE_ENABLED=true`, but intentionally did not receive the separate Agent Console CGG credential. Full OOS runtime construction therefore tried and failed to activate Agent Console inside the worker.
- false-success mechanism: without a readiness probe, Kubernetes briefly considered the new container Ready before Node exited, so rollout and aggregate readiness could race the crash.
- prior incomplete control: PR #304 correctly bound rollout evaluation to the restarted deployment generation and added bounded diagnostics, but it did not isolate the worker capability or prove that the process remained alive.

## Source Changes

- changed workflow, adapter, or contract: explicitly disable Agent Console in the Refinement worker pod while preserving its existing least-privilege credential set; require the process to survive the initial construction window before readiness.
- tests or validator added: inspect the rendered worker block for the explicit capability override, process-readiness probe, and continued absence of the Agent Console shared-secret binding.
- related change records: `docs/records/change-records/2026-10-12-refinement-catalog-rollout-generation.md`

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: owner-repo maintenance Landing Unit `maintenance-refinement-worker-capability-isolation`
- image tag or digest: None; the dev-integration profile mounts exact reviewed source
- runtime revision: pending merged source and one clean `refinement-catalog` composition start

## Live Verification

- local validation: focused composition tests passed 12/12; the full repository suite passed 1,257 tests with 2 documented skips and no failures; governance-document, base-aware change-record, OpenProject mutation-contract, and diff checks passed
- live or dev-integration verification: after merge, one composition start must succeed and the worker must remain available with zero restarts beyond the prior crash interval
- residual risk: the process-readiness probe proves startup stability, not downstream Temporal activity correctness; existing worker activity tests and live workflow evidence retain that responsibility

## Follow-Up

- required follow-up: merge this maintenance Landing Unit, rebind exact-revision Security evidence, complete one stable live composition proof, then resume Delivery item #1246 closeout
- owner: `operator-orchestration-service`
- due date or closure condition: before Feature #1215 and Epic #1203 close
