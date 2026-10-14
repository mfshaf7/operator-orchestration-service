---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - src/delivery-art/review-evidence-acquisition.js
    - src/delivery-art/work-session-cli-adapters.js
    - src/delivery-art/lifecycle-cli-adapters.js
    - test/delivery-art-review-evidence-acquisition.test.js
    - test/delivery-art-work-session-cli-adapters.test.js
    - test/delivery-art-lifecycle-cli-adapters.test.js
    - docs/operations/delivery-workflow-operator-surface.md
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "Evidence-profile self-repair may execute only a qualifying reviewed ancestor profile; candidate commands and post-merge fallback remain denied."
---

# 2026-10-15 evidence profile ancestor repair

## Summary

An owner repository whose accepted evidence profile is invalid can now start one normal governed replacement attempt using the nearest reviewed ancestor profile that still satisfies the current merge-ready evidence contract. The candidate profile must validate before those trusted commands run, and post-merge evidence remains bound to the accepted revision without fallback.

## Classification

- area: Delivery ART configured-path and owner-evidence acquisition
- type: trusted profile self-repair
- runtime impact: removes an invalid-base dead end without trusting candidate commands or weakening accepted-source operating evidence
- landing unit decision: `child_isolated_landing_unit` because this OOS workflow-control repair has an independent owner, review, deployment, and rollback boundary from Platform work item 1291

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Epic 1275 Platform work item 1291 recovery
- related products or components: Delivery ART work sessions and owner-source executor

## Root Cause

- immediate failure: after the invalid merged Platform attempt was archived, configured-path preflight rejected the same invalid base profile and could not create a replacement session to repair it.
- actual root cause: the evidence boundary selected only the exact base or accepted head; it did not retain a bounded reviewed-ancestor selection for profile self-repair.
- why it escaped earlier controls: PR 337 added candidate validation and deterministic accepted-profile failure projection, but its tests stopped before exercising a fresh session whose accepted base was already invalid.

## Source Changes

- changed workflow, adapter, or contract: configured-path and pre-merge acquisition select the nearest qualifying exact Git ancestor profile when the current base profile fails; candidate schema and coverage validation remains mandatory before commands execute.
- tests or validator added: unit and real-Git adapter coverage proves ancestor selection, exact revision binding, candidate coverage rejection, and accepted-head no-fallback behavior.
- related change records: `2026-10-15-owner-evidence-profile-failure-projection.md` and `2026-10-02-evidence-profile-preflight.md`.

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source repair pending protected merge and active `dev-integration` reconciliation
- image tag or digest: None.
- runtime revision: None.

## Live Verification

- local validation: focused evidence, CLI adapter, controller, and work-session suites plus complete repository validation
- live or dev-integration verification: rerun work item 1291 configured-path preflight against the accepted invalid Platform base and confirm the exact earlier valid profile revision is selected
- residual risk: repositories with no qualifying reviewed ancestor remain blocked and require the separately reviewed first-profile bootstrap path

## Follow-Up

- required follow-up: merge and deploy this repair, start the replacement work item 1291 session, then prove the corrected candidate profile and operating evidence without fallback
- owner: `operator-orchestration-service` followed by `platform-engineering`
- due date or closure condition: before work item 1291 replacement source begins

## Rollback

Revert this Landing Unit to restore exact-base-only preflight. Existing evidence receipts and recovered session archives remain immutable.
