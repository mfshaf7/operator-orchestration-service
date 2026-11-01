---
security_evidence:
  review_areas: [delivery, runtime, identity]
  reviewed_artifacts:
    - src/app.js
    - src/product-publication/service.js
    - src/product-publication/store.js
    - src/product-publication/wgcf-client.js
    - docs/api/openapi.json
  findings: []
  risks: []
  workstreams: [WS-003, WS-005]
  notes: Authenticated read-only source preparation and caller-owned recovery; existing publication decisions and owner credentials remain unchanged.
---

# 2026-11-01 Product publication preparation

## Summary

Repair the Console publication workflow by preparing committed source references and caller-owned publication state from a selected product.

## Classification

- area: product publication
- type: operator-approved maintenance
- runtime impact: additive authenticated read API; source-only pending exact-source acceptance

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: None — operator explicitly authorized maintenance without new ART items
- related products or components: Console; WGCF; Workspace Governance
- Landing Unit Decision: `feature_single_landing_unit`
- Landing Unit: `maintenance-portfolio-publication-broker`

## Root Cause

- immediate failure: normal publication UI required hand-entered engineering references
- actual root cause: submit/read protocol lacked product-based preparation
- why it escaped earlier controls: control-level browser assertions did not establish an understandable operator journey

## Source Changes

- changed workflow, adapter, or contract: read-only preparation; committed registered-owner discovery; current receipt and bounded recent requests
- tests or validator added: preparation identity, expiry, owner mismatch, caller privacy, non-mutation and route checks
- related change records: Console change log; WGCF primary operator surface

## Artifact And Deployment Evidence

Source only. No image, runtime activation or commissioned operating claim. Existing publication/security target scope is unchanged.

## Live Verification

- local validation: focused broker and route tests; OpenAPI generation/check; cross-owner validation recorded privately
- live or dev-integration verification: pending exact-source composition; source-reader rehearsal resolves committed Console/to-do manifests
- residual risk: preparation availability and source-owner freshness depend on the existing mounted-source profile

## Follow-Up

- required follow-up: exact-source Security delta, deployment/commissioning and operator UI acceptance before live claims
- owner: OOS, WGCF, Console, Security and Platform
- due date or closure condition: before activation of the preparation extension
