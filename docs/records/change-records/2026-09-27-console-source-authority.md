---
security_evidence:
  review_areas:
    - runtime
    - delivery
  reviewed_artifacts:
    - contracts/console-source-authority/
    - src/console-source-authority.js
    - src/app.js
    - docs/api/openapi.json
  workstreams:
    - WS-007
  findings: []
  risks: []
  notes: "Canonical Console reads are additive, caller-authenticated projections. The change adds no mutation, approval, identity, secret, release, or deployment authority."
---

# Console Source Authority And Freshness

## Summary

OOS now offers one versioned canonical read envelope for Console consumers. The
envelope binds each projection to its authority, owner record, ordered source
revision, freshness window, and stable event cursor while retaining the
existing JSON response for compatibility.

## Classification

- area: Console source readback and event freshness
- type: additive workflow read contract and broker runtime behavior
- runtime impact: authenticated read routes can negotiate the canonical
  envelope through an explicit vendor media type; default JSON and every
  mutation path remain unchanged

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Epic #898, Feature #929, Enabler #1183
- related products or components: OOS broker, Governance Operations Console,
  Proposal, Delivery, Repository, Workspace Inventory, Prototype, and durable
  orchestration read projections

## Root Cause

- immediate failure: Console read surfaces had domain-specific payloads but no
  shared machine contract for authority, source ordering, or freshness
- actual root cause: source binding lived implicitly inside individual payloads
  and could not support a deterministic cross-workflow failover boundary
- why it escaped earlier controls: route contracts validated each domain shape
  independently and did not require a shared canonical read envelope

## Source Changes

- changed workflow, adapter, or contract: adds canonical projection and receipt
  schemas, explicit media negotiation, bounded source-order resolution, and a
  machine registry covering the admitted read routes
- tests or validator added: positive and negative conformance cases, legacy
  JSON compatibility coverage, exact route-registry coverage, and a
  compositional OpenAPI generator that keeps domain and cross-cutting ownership
  separate
- related change records: None

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only until the
  reviewed landing unit is merged and activated through the existing OOS
  dev-integration path
- image tag or digest: None
- runtime revision: exact pull-request head, pending merge to `main`

## Live Verification

- local validation: focused source-authority and HTTP suites, complete API-doc
  synchronization, governance-doc validation, full OOS tests, and CI-equivalent
  base-aware validation
- live or dev-integration verification: pending reviewed merge and accepted OOS
  runtime activation
- residual risk: Console continues using legacy JSON until #1184 deliberately
  adopts the negotiated envelope; source availability still follows each
  authoritative domain adapter

## Follow-Up

- required follow-up: #1184 consumes the negotiated contract without deriving
  source or freshness truth in the browser
- owner: Governance Operations Console product owner
- due date or closure condition: #1184 lands against the merged #1183 contract
  and passes its positive and negative conformance cases

## Rollback

Revert the source-authority contract, negotiated route handling, OpenAPI
composition support, tests, documentation, and this record together. Default
JSON consumers remain compatible throughout rollback.
