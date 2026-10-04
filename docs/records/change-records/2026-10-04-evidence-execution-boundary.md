---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - src/delivery-art/lifecycle-cli-adapters.js
    - src/delivery-art/source-action-result-store.js
    - src/delivery-art/source-executor.js
    - src/delivery-art/source-executor-server.js
    - test/delivery-art-lifecycle-cli-adapters.test.js
    - test/delivery-art-source-executor.test.js
    - docs/operations/delivery-workflow-operator-surface.md
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "The repair removes mutation admission from runtime evidence subprocesses, adds explicit verification-only context, and durably binds completed evidence results before replying. It adds no source, merge, runtime mutation, or ART mutation authority."
---

# Delivery Evidence Execution Boundary

## Summary

Make runtime evidence explicitly verification-only and retain a digest-bound
source-executor result before replying to OOS, so replacement of the requesting
controller cannot lose or repeat completed evidence.

## Classification

- area: Delivery ART owner evidence execution
- type: corrective owner-repo maintenance
- runtime impact: local authenticated source executor and evidence subprocesses
- recommendation posture: extend the existing source-executor and evidence-profile controls
- Landing Unit decision: `child_isolated_landing_unit`; this OOS runtime and
  trust-boundary repair is independently reviewable and reversible from the
  separate Platform composition guard

## Ownership

- owner repo: `operator-orchestration-service`
- work home: owner-repo maintenance linked to the accepted workspace
  improvement candidate
- tracking reference:
  `workspace-governance/reviews/improvement-candidates/2026-10-04-work-session-merge-order-recurrence.yaml`

## Root Cause

- a `runtime_and_live` profile command ran a full commissioning sequence that
  replaced the OOS deployment awaiting its source-executor response;
- the host executor completed independently, but it had no durable result
  custody, so the replacement controller could not recover the result; and
- generic `CI=true` context was visible to every command, including unit tests,
  so it was not a safe discriminator for live evidence behavior.

## Source Changes

- runtime/live commands receive explicit acquisition and command identifiers,
  `OOS_DELIVERY_ART_EVIDENCE_MODE=verification-only`, and mutation admission is
  forced off in the subprocess;
- test and validation commands do not receive the runtime/live marker;
- the source executor persists only the typed, digest-bound result for
  `lifecycle.acquire-evidence` in an operator-private state directory before it
  replies; and
- a retry with a new command receipt but the same session-bound evidence input
  replays that result instead of executing the owner commands again.

## Artifact And Deployment Evidence

- source-only until the owner-maintenance pull request merges
- runtime activation: reconcile the existing `refinement-catalog` composition
  from the merged OOS revision
- persisted local artifact: digest-bound source-action results under the
  accepted-delivery profile state root

## Live Verification

- focused lifecycle-adapter tests prove exact verification-only environment
  projection;
- source-executor socket tests prove replay after executor restart, including
  private record mode and single execution; and
- full OOS tests, API validation, governance-document validation, and source
  diff validation remain required before merge.

## Residual Risk

The executor still relies on reviewed base-owned profile code to honor the
verification-only contract. Runtime owners must expose explicit readback or
verification commands rather than commissioning, restart, deployment, or
mutation commands in `runtime_and_live` profile entries.

## Follow-Up

- update the Workspace Governance improvement candidate with the merged OOS
  and Platform control references;
- reconcile the active composition from merged owner revisions; and
- prove a repeated evidence request replays one completed result without a
  second command execution.

## Rollback

Revert the executor result store, environment projection, profile state path,
tests, operator guidance, and this record together. Existing evidence receipts
and work-session artifacts remain valid; the local replay records can be
retained until the profile is reset.
