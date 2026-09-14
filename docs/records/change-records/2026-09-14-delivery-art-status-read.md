---
security_evidence:
  review_areas:
    - runtime
    - delivery
  reviewed_artifacts:
    - src/openproject-client.js
    - src/delivery-art/work-session-runtime.js
    - src/delivery-art/lifecycle-cli-adapters.js
    - docs/api/openapi.json
  workstreams:
    - WS-007
  notes: "The status route preserves caller authentication and fails closed for non-Delivery work items or missing authoritative status."
---

# Delivery ART Status Read

## Summary

ART #1109 includes a bounded OOS work-session status read so Closure
conformance can run without rebuilding full-project evidence for each gate.
The work command family and human approval gates are unchanged.

## Classification

- area: Delivery ART work-session status and broker read path
- type: bounded performance and contract correction
- runtime impact: existing `dev-integration` lifecycle path only

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: #1109 under Feature #921 and Epic #892

## Root Cause

Both lifecycle status adapters asked for a full Delivery work-item evidence
packet per gate. Each packet rebuilt the full Delivery project state. A live
pre-fix comparison measured approximately 23-25 seconds for a packet versus
74-79 ms for a direct OpenProject work-item read. Serial repeated reads
amplified `work start`, `work continue`, and `work close` latency. These timings
are diagnostic, not proof of deployed end-to-end improvement.

## Source Changes

- Add an authenticated status route backed by one work-package read and a
  cached check of the configured Delivery project identity.
- This is a read-only OpenProject lookup; it does not submit a form or change
  writable fields or allowed values.
- Reject missing, cross-project, or status-less work items instead of falling
  back to guessed status.
- Use the status route for lifecycle gate checks while retaining full evidence
  packets for actual evidence inspection.
- Reuse the continuation already read within one `work close` command.

## Artifact And Deployment Evidence

- Source change is bound to the #1109 OOS Landing Unit and Architecture Packet
  v24. No OpenProject schema, Security approval, Platform identity, or Prototype
  source change is in this rollback unit.
- Deployment has not occurred at record creation. Reviewed source and the
  resulting PR/merge evidence must be added before ART closeout.

## Live Verification

- Focused OpenProject, service, HTTP, CLI, runtime, and work-session tests pass.
- API documentation validation passes for the new route.
- The repository test suite passes with `--test-concurrency=1`. Its first
  parallel run failed in `workspace-intake-clients`; that file passed alone.
- Post-deployment end-to-end latency and restart behavior are unverified.

## Follow-Up

- Measure `work status`, `work continue`, and `work close` in dev-integration
  after reviewed source deployment; inspect the actual receipts before claiming
  an end-to-end speedup.
- Keep #1109 open until the integrated Closure conformance demo and evidence
  expectation are met; this status correction alone does not complete it.
