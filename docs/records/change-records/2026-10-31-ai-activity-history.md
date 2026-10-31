---
security_evidence:
  review_areas:
    - identity
    - runtime
    - delivery
    - ai
  reviewed_artifacts:
    - src/agent-console/activity.js
    - src/agent-console/service.js
    - src/agent-console/store.js
    - src/app.js
    - contracts/agent-console/activity-page.schema.json
    - contracts/agent-console/invocation-request.schema.json
    - test/agent-console-activity.test.js
    - test/agent-console-http.test.js
    - test/agent-console-service.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: Source-only bounded caller/operator history and native advice metadata, reviewed in Security's 2026-10-31 Console AI activity read-scope delta. The operator authorized batch publication and normal commissioning after source checks on October31.
---

# AI activity history

## Summary

Extend the existing Agent Console private store and authenticated API so Console
can inspect recorded AI request outcomes across chat and workflow advisors.
The operator approved real history wiring after reviewing the local UI trial.

## Classification

- area: existing AI request/evidence visibility
- type: operator-approved cross-owner maintenance extension
- Landing Unit Decision: `feature_single_landing_unit`
- Landing Unit: `maintenance-ai-activity-history`
- branch: `maintenance/ai-activity-history`
- base: `1eceee2afaf34dbf2fbe4bb142bcff9fba7799e0`
- Operator authorized publication of the reviewed batch on October31.

## Ownership

OOS owns durable state, authentication and read projections. Console owns
presentation and safe existing-workspace navigation. Security's source delta is
[AI activity read scope](https://github.com/mfshaf7/security-architecture/blob/main/docs/reviews/components/2026-10-31-console-ai-activity-read-scope.md).
Platform retains commissioning and deployment authority. No new ART defect or
improvement candidate is created for this approved extension.

## Root Cause

The old dock counted browser panel presence. Agent Console retained individual
invocations but exposed only individual session reads. Native Work Design and
Refinement returned governed advice evidence without a combined durable request
history. Legacy request labels were not retained and are not reconstructed.

## Source Changes

- Add a closed 1–50-row caller/operator-scoped GET and bound keyset cursor.
- Reuse existing digest-checked state; project only safe metadata and evidence.
- Bind optional closed task/record metadata into the invocation replay digest.
- Record native advice outcomes without rerouting their existing model calls.
- Require caller-specific identity and the configured operator for recording.
- Preserve completed/failed/cancelled and unconfirmed interrupted outcomes.
- Bound the metadata-page cache and invalidate it against private-state version.
- Synchronize the API schema, integrity manifest and OpenAPI route.

## Artifact And Deployment Evidence

Source-reviewed maintenance candidate. The public history route and native
recording are not commissioned into the canonical runtime by this record.
Existing approved state remains untouched. Existing OOS Proposal read extension
and this OOS history extension must land before the dependent Console batch.
Refresh Security's generated owner-record index after owner source merges.

## Live Verification

Targeted owner contract/HTTP/native regressions and generated API validation,
Console decoder/browser tests, and isolated composed HTTP proof validate the
candidate. The composed test uses disposable state and synthetic native model
stubs; it performs no real provider generation or canonical workflow mutation.
Canonical runtime and real provider operating proof remain separate from local
source verification. The UI continues to label disconnected examples explicitly.

## Follow-Up

Bind final exact source commits, complete existing review/acceptance and normal
Platform activation under the operator's October31 batch-release authorization. Verify retained
real history through the final Console and retire source branches/worktrees at
Landing Unit completion. No automatic model replay is introduced.
