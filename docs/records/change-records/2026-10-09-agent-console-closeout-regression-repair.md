---
security_evidence:
  review_areas:
    - runtime
    - delivery
    - ai
  reviewed_artifacts:
    - src/agent-console/service.js
    - src/delivery-art/work-session-service.js
    - test/agent-console-service.test.js
    - test/delivery-art-work-session-service.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: The repair matches CGG's existing bounded timestamp precision and redacts persisted diagnostics without expanding runtime or source authority.
---

# Agent Console Closeout Regression Repair

## Summary

Repairs two bounded OOS failures exposed by the Epic #1203 live closeout: the
Agent Console consumer now honors CGG's existing one-second timestamp precision
boundary, and work-session command records redact absolute-path-shaped error
details instead of masking the source-executor failure they are meant to retain.

## Classification

- area: Agent Console runtime and Delivery ART work-session command records
- type: owner-repo maintenance
- runtime impact: existing fail-closed behavior becomes interoperable and diagnosable without expanding authority

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: #1246 and #1248 under Feature #1215 and Epic #1203
- related products or components: Context Governance Gateway and Governance Operations Console

## Root Cause

- immediate failure: a valid whole-second CGG projection was fractionally earlier than OOS's microsecond request, and a separate provider error could not be persisted because its request path resembled an absolute filesystem path.
- actual root cause: OOS did not mirror CGG's explicit one-second timeline tolerance and did not project dependency error details into coordination-safe storage before writing the command record.
- why it escaped earlier controls: unit fixtures used timestamps safely separated by whole seconds, while command-record failure tests omitted path-shaped structured details.

## Source Changes

- changed workflow, adapter, or contract: applies the existing one-second projection tolerance at the OOS consumer and recursively redacts absolute-path-shaped strings only in persisted error diagnostics.
- tests or validator added: exact within-tolerance and outside-tolerance Agent Console tests plus command-record replay coverage retaining the original error while redacting its path.
- related change records: `docs/records/change-records/2026-10-09-agent-console-runtime-hook.md`

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: owner-repo maintenance Landing Unit `maintenance/agent-console-closeout-regressions`
- image tag or digest: None until the existing `refinement-catalog` composition rebuilds OOS from the merged source
- runtime revision: None until post-merge live verification

## Live Verification

- local validation: focused Agent Console and work-session tests, full repository tests, generated-contract checks, governance validation, and base-aware change-record validation
- live or dev-integration verification: rebuild the existing composition and repeat #1246 operating evidence acquisition
- residual risk: timestamp tolerance is bounded to the same one-second precision already enforced by CGG; stale projections beyond that boundary remain denied

## Follow-Up

- required follow-up: close both linked improvement candidates only after merge and successful live #1246 proof
- owner: `operator-orchestration-service`
- due date or closure condition: before Feature #1215 and Epic #1203 close
