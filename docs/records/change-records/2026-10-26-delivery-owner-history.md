---
security_evidence:
  review_areas: [runtime, delivery]
  reviewed_artifacts:
    - src/delivery-history-reader.js
    - src/delivery-ingress/prototype-adapter.js
    - src/delivery-ingress/prototype-application-service.js
    - src/app.js
    - contracts/console-source-authority/manifest.json
    - docs/api/openapi.json
  findings: []
  risks: []
  workstreams: [WS-007]
  notes: Add authenticated bounded read-only native Delivery Intake and package history. Reuse existing owner evidence validation; preserve current command authorization, trusted automation authorship, exact target scope and canonical source envelope. No mutation, source publication, external execution, new persistence or credentials. Fresh exact composed Security acceptance precedes commissioning.
---

# Native Delivery Intake and retained owner history

## Summary

Expose original admitted-source consumption, Work Design application,
Refinement runs and closeout outcomes through bounded authenticated owner
reads. The Console can discover completed packages and their actual evidence
without reopening work or manufacturing history.

## Classification

- area: existing Delivery read projections
- type: approved owner maintenance for cross-surface operating truth
- runtime impact: two additive GET projections; no business-state mutation

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: None; completed initiative state is preserved
- related products or components: Governance Operations Console and existing Delivery owner workflows

## Root Cause

- immediate failure: a completed product's native application, Work Design, Refinement and closeout evidence existed, while the Console excluded completed packages and projected no admitted sources or activity.
- actual root cause: the shared current register substituted an active-only ART collection for retained workflow history. Native trusted owner evidence had no coherent bounded read composition for its consumer.
- why it escaped earlier controls: live acceptance followed application commands and terminal outcomes, but did not cold-read the same actual product across all Delivery surfaces after it left the active queue.

## Source Changes

- changed workflow, adapter, or contract: add paginated target-backed Intake and exact-package history GETs to the existing source-authority contract. Preserve original receipt custody independently from later current owner changes. Require exact Delivery scope before history disclosure and original trusted automation evidence for Prototype consumption. Proposal consumption requires its applied reciprocal target and resolved native custody; absent historical time stays unprojected.
- tests or validator added: authenticated API absence/foreign-scope cases; original evidence chain, section outage and foreign owner, missing application, Proposal backlink, bounded pagination, duplicate trusted activity and historical ownership change. Console consumer tests separately cover Current/History, partial/unavailable evidence and source-revision refresh.
- related change records: None

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source preparation; exact-head validation and API/worker build smoke are recorded with the review. Platform commissioning follows fresh exact Security acceptance.
- image tag or digest: None at source preparation
- runtime revision: None at source preparation; current runtime remains the previously accepted source until commissioning

## Live Verification

- local validation: focused original-chain, owner failure, caller authentication and activity-trust regression tests pass; full CI-equivalent and fetched-base validation precede publication.
- live or dev-integration verification: pre-repair read-only inspection confirmed retained native Intake, applied Work Design, completed Refinement and done closeout on the same actual product. Post-commissioning cold Console proof is required before maintenance closure.
- residual risk: projections depend on available native owners; independent unavailable sections and explicit page/history bounds prevent missing proof from becoming successful or empty history. Inventory and history do not authorize commands.

## Follow-Up

- required follow-up: land OOS then Console, update the Security generated index and exact composed acceptance, activate through the existing complete-runtime path, prove all six Delivery surfaces and the original product chain, then close the accepted regression candidate.
- owner: OOS source; Console product; Security acceptance; Platform commissioning
- due date or closure condition: successful actual product history proof and linked candidate closure
