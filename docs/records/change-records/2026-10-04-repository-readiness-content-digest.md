---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - docs/contracts/catalog-v1.md
    - scripts/test_workspace_inventory_source.mjs
    - src/workspace-inventory/service.js
    - src/workspace-inventory/source-client.js
    - test/workspace-inventory-service.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "The repair preserves the existing OOS-to-WGCF authority boundary and makes the digest input explicit. It adds no authority, mutation, identity, secret, or browser-side capability. Exact successor acceptance remains assigned to Security before Platform recommissions the boundary."
---

# 2026-10-04 Repository Readiness Content-Digest Repair

## Summary

- Repair the Workspace Inventory to WGCF Repository readiness handoff by
  sending the SHA-256 digest of the exact committed `contracts/repos.yaml`
  bytes that WGCF independently verifies.
- Preserve the existing canonical semantic digest for Inventory projections.

## Classification

- area: Delivery Catalog and Workspace Inventory composition
- type: owner-repo maintenance and cross-repo protocol correction
- runtime impact: the real Repository readiness request can pass exact
  authority verification after Security accepts and Platform activates this
  source successor

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: maintenance repair required to complete User story `#1231`
  under Feature `#1211` and Epic `#1203`; no additional ART child
- related products or components: Workspace Inventory, Delivery Catalog, and
  Workspace Governance Control Fabric Repository readiness

## Root Cause

- immediate failure: every real Repository readiness evaluation returned
  `authority-version-stale` before any Catalog mutation occurred
- actual root cause: OOS supplied its canonical semantic Inventory digest as
  `expected_authority_digest`, while WGCF independently hashes the exact
  committed `contracts/repos.yaml` bytes; both values were valid but described
  different digest inputs
- why it escaped earlier controls: isolated OOS and WGCF tests used locally
  consistent fixtures and never exercised the exact cross-repo digest handoff

## Source Changes

- changed workflow, adapter, or contract: project both
  `active_inventory_digest` and `active_inventory_content_digest`; validate
  both; send only the exact source-content digest to WGCF; document their
  distinct purposes
- tests or validator added: assert exact-byte SHA-256 calculation, whitespace
  sensitivity, real-Git source projection, service validation, and the
  outbound WGCF request value
- related change records:
  `docs/records/change-records/2026-10-04-repository-readiness-preparation.md`

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only maintenance
  Landing Unit until reviewed, merged, Security-accepted, and activated in
  `dev-integration`
- image tag or digest: None
- runtime revision: Pending merge and activation

## Live Verification

- local validation: focused Workspace Inventory and Catalog tests, full OOS
  suite, API/schema projections, governance validation, change-record control,
  and OpenProject mutation checks before review
- live or dev-integration verification: pending exact Security successor
  acceptance followed by Platform Repository Catalog commissioning for `#1231`
- residual risk: a future consumer could again confuse the two digests unless
  cross-repo conformance is retained; that missing composed test is tracked as
  a control improvement rather than hidden inside this repair

## Follow-Up

- required follow-up: merge the OOS repair, accept its exact revision in
  Security, update Platform pins, and rerun the full Repository Catalog
  commissioning path
- owner: `security-architecture`, then `platform-engineering`
- due date or closure condition: before `#1231` can close

## Rollback

Revert the source-content projection, service use, tests, contract wording, and
this record together. The pre-repair runtime remains fail-closed because WGCF
will continue to reject the mismatched digest; no Catalog mutation needs
reversal.
