---
security_evidence:
  review_areas: [runtime, delivery]
  reviewed_artifacts:
    - src/delivery-history-reader.js
    - src/delivery-service.js
    - src/openproject-client.js
    - src/refinement/service.js
    - src/app.js
    - docs/api/openapi.json
    - test/delivery-history-client.test.js
    - test/delivery-history-reader.test.js
    - test/delivery-service.test.js
    - test/refinement-service.test.js
  findings: []
  risks: []
  workstreams: [WS-007]
  notes: Extend existing authenticated Delivery history reads. Exact project/root/type validation precedes evidence access; current authoring eligibility and ingress receipts do not gate inspection. Original receipts and paged activity remain independently readable with partial coverage. No business mutation, new identity, model invocation, persistence service or approval authority. Exact composed Security acceptance precedes commissioning.
---

# Delivery history fidelity and independent archive reads

## Summary

Repair existing history composition so an old handoff or unavailable current
packet does not hide item activity or otherwise verified evidence. Add bounded
pages of original OpenProject creation, edits and comments alongside receipts.

## Classification

- area: existing Delivery read projections and backend adapters
- type: operator-approved owner maintenance; no new ART scope
- landing unit decision: `feature_single_landing_unit` for this OOS repair
- runtime impact: additive GET response/query parameters; no business mutation

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: None; completed initiative records remain intact
- related products or components: Governance Operations Console and Delivery

## Root Cause

- immediate failure: archives failed or showed only selected terminal receipts.
- actual root cause: scope required ingress inspection/full current tree,
  Refinement history required a current packet, and item journals were omitted.
- why it escaped earlier controls: proof covered a modern canonical package and
  locks rather than legacy, retired, missing-packet and partial-owner cases.

## Source Changes

Validate the exact configured Delivery project, Epic type and root first. Optional
schema metadata cannot hide the validated item. Read ingress inside its section.
Read Refinement runs and trusted original OpenProject receipt events independently
of packet preparation; preserve partial verified evidence if one source fails.
Event digests keep their original identity, distinct from durable run receipts.

Activity uses the existing collection with page1 or later and limit1-50. Actor,
time and change text remain original/plain text. Structured owner payloads are
not echoed. A version1 comment is not another creation. Page bounds and metadata
are validated; no global archived-tree scan or cross-request result cache is added.

Native pre-landing inspection confirmed the provider's activity collection is
unpaginated: page parameters do not constrain its returned elements. Match the
[OpenProject activity contract](https://www.openproject.org/docs/api/endpoints/work-packages/#list-work-package-activities).
Receipt consumers receive accurate complete-collection metadata and consume it
once. The Console-facing reader slices logical pages from that exact collection;
it does not claim upstream server pagination. It still reads only the selected
item, not every project. Original actor references remain when names are absent.

OpenProject mutation-contract proof is read-only: changes use item, project,
activity and existing form/schema reads. Form preparation applies no fields.
No work-package POST/PATCH mutation, allowed field value, role, approval or command
eligibility changes. Existing caller and source-envelope checks are preserved.

## Artifact And Deployment Evidence

- source change: OOS, Console and fresh Security selection land in that order
- image tag or digest: resolved by the existing composition after merge
- runtime revision: retain previous accepted consumers until paired acceptance

## Live Verification

- local validation: scope/privacy, independent failures, paging, receipt recovery,
  complete broker suite and owner CI-equivalent gates
- live verification: modern, legacy, parked and retired reads; actual served-source
  Console inspection with no business writes
- residual limitation: absent original browser artifacts cannot be recreated from
  workflow receipts; missing data stays explicit

## Follow-Up

- required follow-up: Console merge, generated Security owner-change index, exact
  acceptance, normal commissioning, served-source proof and cleanup
- owner: OOS, Console and Security in dependency order; Platform owns activation
- closure condition: source checks, native proof and strict owner cleanup pass
