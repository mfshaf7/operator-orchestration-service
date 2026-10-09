---
security_evidence:
  review_areas:
    - runtime
    - delivery
  reviewed_artifacts:
    - src/delivery-art/lifecycle.js
    - src/delivery-art/lifecycle-controller.js
    - src/delivery-art/source-action-result-store.js
    - test/delivery-art-lifecycle-controller.test.js
    - test/delivery-art-lifecycle.test.js
    - test/delivery-art-source-executor.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: The repair changes only replay eligibility for failed owner evidence; passing evidence remains durable and all source mutations retain their existing idempotency behavior.
---

# Failed Owner Evidence Retry

## Summary

The Delivery lifecycle now routes failed post-merge operating evidence back to
the same bounded acquisition action, permits that retry to replace only the
prior failed rows for its exact operating-ready cases, and keeps all
merge-ready and already-passing evidence immutable. The source executor
durably replays only owner-evidence receipts whose command results all passed.
A failed acquisition is returned to its caller but is not made permanent, so
the documented repair-and-retry action executes the verifier again and a later
passing receipt becomes replay-safe.

## Classification

- area: Delivery ART owner evidence acquisition
- type: corrective owner-repo maintenance
- runtime impact: failed verification can be retried after repair without weakening successful evidence custody

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: #1246 under Feature #1215 and Epic #1203
- related products or components: Delivery source executor and Governance Operations Console operating proof

## Root Cause

- immediate failure: `work continue 1246` replayed the original failed verifier receipt after the verifier and runtime had been repaired.
- actual root cause: replay eligibility was based only on the action name and did not distinguish a passing owner-evidence receipt from a returned receipt containing failed command results; separately, the lifecycle projected that failed result as a gate instead of the existing acquisition action, and evidence merging treated the same deterministic operating evidence ID as immutable even when replacing its prior failed result.
- why it escaped earlier controls: replay tests covered successful acquisition and caller disappearance but did not cover the complete lifecycle transition from invalid operating evidence through acquisition, projection replacement, and repaired success.

## Source Changes

- changed workflow, adapter, or contract: route invalid post-merge operating evidence to the existing bounded acquisition action; allow only exact operating-ready failed rows to be replaced by the same evidence identity while merge-ready and passing evidence remain immutable; require every owner-evidence command result to pass before the source-action result store persists or replays the receipt; legacy failed records are ignored and may be replaced by a passing retry.
- tests or validator added: prove the lifecycle selects acquisition rather than a gate, failure is not cached, repair executes again, the repaired passing result replaces only its failed operating row, immutable evidence still rejects conflicts, and the passing receipt becomes durably replayed.
- related change records: `docs/records/change-records/2026-10-09-agent-console-closeout-regression-repair.md`

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: owner-repo maintenance Landing Unit `maintenance/retry-failed-owner-evidence`
- image tag or digest: None until the existing `refinement-catalog` composition rebuilds OOS from the merged source
- runtime revision: None until post-merge live verification

## Live Verification

- local validation: focused source-executor tests, full repository tests, API and governance-document validation, and base-aware change-record validation
- live or dev-integration verification: rebuild the existing composition and repeat #1246 operating evidence acquisition through `work continue`
- residual risk: an interrupted verifier still returns bounded failure evidence to the caller, but only a fully passing receipt becomes durable replay state

## Follow-Up

- required follow-up: close the linked improvement candidate only after merge and successful live #1246 proof
- owner: `operator-orchestration-service`
- due date or closure condition: before Feature #1215 and Epic #1203 close
