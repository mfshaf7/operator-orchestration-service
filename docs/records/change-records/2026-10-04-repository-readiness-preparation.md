---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - contracts/catalog/manifest.json
    - contracts/catalog/repository-readiness-request.schema.json
    - contracts/catalog/repository-readiness-result.schema.json
    - docs/contracts/catalog-v1.md
    - docs/operations/delivery-catalog-runtime.md
    - package-lock.json
    - src/catalog/service.js
    - src/catalog/wgcf-readiness-client.js
    - src/workspace-inventory/service.js
    - src/workspace-inventory/source-client.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "OOS mediates the existing Workspace Inventory and WGCF authorities without adding identity, secrets, repository mutation, or browser-side authority. The route requires the existing authenticated Delivery mutation caller, returns only the minimum content-addressed reference, and remains subject to composed-boundary Security acceptance in ART #1230 before Platform commissioning in #1231."
---

# 2026-10-04 Repository Readiness Preparation

## Summary

Reopened Delivery ART `#1228` completes the missing first-use step between an
active Workspace Inventory repository and the existing Delivery Catalog Owner
Repo mutation. OOS now resolves current repository authority, obtains or
idempotently reuses the exact WGCF readiness decision, and returns the bounded
reference expected by the Console and existing Catalog validator.

## Classification

- area: Delivery Catalog and Workspace Inventory composition
- type: acceptance-completion and fail-closed authority handoff
- runtime impact: source-only until Security review `#1230` and Platform
  commissioning `#1231`

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: reopened User story `#1228` under Feature `#1211` and Epic
  `#1203`
- related products or components: Governance Operations Console, Workspace
  Governance, Workspace Governance Control Fabric

## Root Cause

- immediate failure: the completed Console Repository handoff could open a
  reviewed Owner Repo add draft, but no OOS route could supply the first
  repository-readiness reference for a newly admitted repository
- actual root cause: the original Catalog slice implemented only verification
  and refresh of an already-existing reference; the browser was correctly
  prohibited from calling WGCF, leaving the first-use path disconnected
- why it escaped earlier controls: tests began with a synthetic readiness
  reference and proved mutation-time revalidation, but no acceptance case
  traversed Repository entry through authority resolution, first issuance, and
  the existing Catalog mutation boundary

## Source Changes

- add an authenticated `POST /v1/delivery-catalog/repository-readiness` route
  with bounded request and result schemas
- resolve one active repository plus the whole current `contracts/repos.yaml`
  digest through the existing Workspace Inventory source boundary
- require exact repository identity, active posture, record version/digest,
  authority revision, and inventory digest consistency before WGCF is called
- add initial WGCF issuance alongside existing reference re-verification and
  validate content-addressed receipt, ledger, generation, evaluation time,
  repository identity, and authority digest
- preserve non-mutation: the route changes neither repository nor Catalog
  state and returns only `repository_readiness_reference`
- add positive, inactive/retired, inconsistent-authority, stale-WGCF,
  authorization, and replay coverage plus real-Git source-client conformance
- refresh the lockfile to patched transitive releases of `@grpc/grpc-js`
  (`1.14.5`) and `fast-uri` (`3.1.8`) after the owner dependency gate exposed
  one high- and one moderate-severity advisory

## Artifact And Deployment Evidence

- source-only Landing Unit
- pull request, reviewed head, and merge commit: pending governed work-session
  publication
- image tag or digest: None
- runtime revision: None

## Live Verification

- local focused Catalog and Workspace Inventory protocol suite: 41 passed,
  0 failed
- real-Git Workspace Inventory source conformance: 12 checks passed
- owner repository suite: 1,208 tests, 1,206 passed, 2 skipped, 0 failed
- governance-doc, API-doc, schema-projection, change-record, OpenProject
  mutation-contract, and diff checks: passed against `origin/main`
- production dependency audit after lockfile refresh: 0 vulnerabilities
- live or dev-integration verification: assigned to Platform commissioning
  `#1231` after Security acceptance `#1230`
- residual risk: the composed runtime remains intentionally inactive until
  those downstream gates close

## Follow-Up

- required follow-up: review the exact composed authority boundary and then
  commission and verify it in the accepted-idea-delivery profile
- owner: `security-architecture` for `#1230`, then `platform-engineering` for
  `#1231`
- closure condition: both downstream ART items carry their own finalized
  evidence; source merge alone does not claim live readiness

## Rollback

Revert the readiness route, schemas, inventory authority reader, WGCF issuance
method, tests, generated OpenAPI projection, and this record together. Existing
Catalog projection and mutation-time verification remain available, and no
repository, Catalog value, WGCF receipt, or live environment state requires
reversal from the source rollback alone.
