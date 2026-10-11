---
security_evidence:
  review_areas:
    - delivery
  reviewed_artifacts:
    - src/openproject-client.js
    - test/openproject-client.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: The repair broadens only the read scope used to validate existing ART lineage references. Initiative mutations remain bounded to the requested top-level Epic and retain the existing family, role, and reference rules.
---

# Initiative Lineage Reference Scope

## Summary

OOS initiative governance now validates Architecture Anchor Ref and Required
Upstream Ref against portfolio-wide Delivery ART state. Execution summaries,
completion readiness, and mutations remain scoped to the requested initiative.

## Classification

- area: Delivery ART initiative lineage validation
- type: corrective owner-repo maintenance
- runtime impact: permits valid cross-initiative lineage references to survive governed update and closeout

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Epic #1203 guided closeout
- related products or components: OpenProject Delivery ART broker adapter

## Root Cause

- immediate failure: Epic #1203 closeout rejected Architecture Anchor Ref `openproject://work_packages/880` even though #880 exists as a top-level Epic.
- actual root cause: `updateDeliveryInitiative` built state with `initiativeRecordId`, which intentionally returned only the target root and descendants, then used that scoped map to validate external anchor and upstream references.
- why it escaped earlier controls: existing lineage tests covered field rules and local reference shapes but did not require a governance write to resolve an anchor and upstream record outside the target initiative tree.

## Source Changes

- changed workflow, adapter, or contract: use portfolio-wide read state only for lineage-reference validation; preserve target-scoped execution state and single-Epic mutation behavior.
- tests or validator added: prove one bounded-activation Epic can validate an external top-level anchor and an upstream record in that anchor family through the real update path.
- related change records: None.

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: owner-repo maintenance Landing Unit `maintenance-initiative-lineage-reference-scope`
- image tag or digest: None; the dev-integration profile mounts exact reviewed source
- runtime revision: pending merged source and unchanged Epic #1203 guided closeout replay

## Live Verification

- local validation: focused lineage and planning-path tests passed 2/2; full repository suite passed 1,260/1,260; governance-doc, change-record, mutation-contract, and diff checks passed
- live form contract evidence: this repair changes only the portfolio read scope used before an existing initiative update; it adds no field write and does not change form-schema writability or `allowedValues` handling
- live or dev-integration verification: rerun the unchanged Epic #1203 closeout payload and require terminal authoritative readback
- residual risk: portfolio-wide lineage validation reads more ART records than target-scoped execution summaries but performs no additional mutation

## Follow-Up

- required follow-up: merge, bind exact-revision Security evidence, converge the existing composition, and rerun Epic #1203 closeout
- owner: `operator-orchestration-service`
- due date or closure condition: before reporting Epic #1203 complete
