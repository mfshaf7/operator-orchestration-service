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
  notes: "The repair changes only the process-group boundary for runtime/live evidence commands. It adds no source, merge, runtime-mutation, ART-mutation, or secret authority; non-runtime evidence retains the existing child-process boundary."
---

# Operating Evidence Executor Survival

## Summary

- Date: 2026-10-15
- Short title: Keep live evidence commands outside the source-executor process group
- Environment: `dev-integration`
- Severity: Delivery completion blocker

## Classification

- Type: owner-evidence execution repair
- User-facing impact: A full-runtime operating proof can tear down and restore
  the runtime that hosts its source executor without the executor terminating
  the proof command itself.

## Ownership

- Owning repo or layer: `operator-orchestration-service`
- Related repos: `platform-engineering`, `workspace-governance`
- Related ADR: None; this preserves the accepted executor and evidence-custody
  boundary.

## Root Cause

- Immediate failure: The complete Console runtime proof tears down the
  `accepted-idea-delivery` profile, whose host-service lifecycle terminates the
  source executor's process group.
- Actual root cause: `runtime_and_live` evidence commands inherited that same
  process group even though their declared lifecycle may include the
  supervising executor.
- Why it escaped earlier controls: Durable result replay and runtime lifecycle
  proof were tested independently; no test asserted the process-group boundary
  for a live evidence command.

## Source Changes

- Repo: `operator-orchestration-service`
- Commit(s): Pending protected pull request.
- Guardrail added: `runtime_and_live` commands execute in a distinct process
  group, while tests and validations keep the default child boundary. Focused
  tests assert both cases.

## Artifact And Deployment Evidence

- Build workflow run: Pending pull request validation.
- Published image tag: None; local source composition only.
- Published digest: None.
- Recorded prod revision: None.
- Argo application revision: None.

## Host Or Runtime Recovery

- Required host/runtime action: Restart the existing `refinement-catalog`
  composition after the paired Platform idempotency repair is accepted.
- Why it was environment drift instead of source defect: Not applicable; the
  process-group inheritance was a source defect.
- Recovery command or procedure: Use the normal Delivery ART recovery and
  successor path for work item `#1291`; do not retry the pending proof before
  both repairs land.

## Live Verification

- App health: Current composition restored from merged source before repair.
- Deployed image: Existing local dev-integration composition.
- Pod: Existing `refinement-catalog` workloads.
- Functional verification: Final proof remains owned by the governed successor
  for work item `#1291`.
- Residual risk: Detachment alone does not make a completed proof replayable;
  Platform must also return an exact-revision cached receipt after restore.

## Follow-Up

- Required follow-up: Land the paired Platform idempotency repair, obtain the
  exact Security delta, and rerun the proof through the governed successor.
- Optional hardening: Add a dedicated integration test whose target lifecycle
  includes the supervising executor.
- Owner: `operator-orchestration-service`
