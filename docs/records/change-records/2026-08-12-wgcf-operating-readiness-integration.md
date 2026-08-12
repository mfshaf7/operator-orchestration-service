---
security_evidence:
  review_areas:
    - identity
    - secrets
    - delivery
    - runtime
  reviewed_artifacts:
    - src/delivery-art/wgcf-transport.js
    - src/delivery-art/wgcf-readiness-client.js
    - src/delivery-art/service.js
    - src/runtime.js
    - src/app.js
    - src/art-cli.js
    - docs/api/openapi.json
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-08-12 WGCF Operating Readiness Integration

## Summary

Completed the OOS side of the approved WGCF Delivery ART readiness boundary so
an operator can issue an immutable operating-readiness receipt for an exact
post-merge Review Packet candidate and finalize only after OOS resolves that
same receipt through the trusted WGCF client.

## Classification

- area: Delivery ART Review Packet finalization
- type: broker runtime, authenticated backend adapter, API contract, and
  operator workflow
- runtime impact: source-complete and default-deny; dev-integration activation
  remains separate from this Landing Unit

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: `#814` under Feature `#800` and delivery `#698`
- related products or components:
  - `operator-orchestration-service`
  - `workspace-governance-control-fabric`
  - Workspace Delivery ART

## Root Cause

- immediate failure: schema-v2 finalization had a trusted receipt-resolver seam
  but the OOS runtime did not provide a client that could issue or read WGCF
  Delivery ART readiness receipts.
- actual root cause: WGCF readiness implementation landed after the original
  OOS custody owner runtime, leaving the approved cross-repo integration as an
  explicit downstream dependency.
- why it escaped earlier controls: source tests injected a synthetic resolver
  to prove finalization semantics while runtime activation remained denied.
  The initiative dogfood exposed the missing real service integration before
  mutation was enabled.

## Source Changes

- changed workflow, adapter, or contract:
  - added one shared bounded authenticated WGCF JSON transport used by Delivery
    ART custody and readiness clients
  - added exact operating-readiness issue/read response and reference binding
  - reject non-ready or mismatched receipts before any final artifact registry
    write
  - injected the WGCF readiness client as the finalization receipt resolver
  - added the authenticated
    `POST /v1/delivery-art/review-packets/operating-readiness` broker route
  - added
    `review-packet operating-readiness <packet.json> <receipt.json>` so the
    durable receipt is stored explicitly before finalization
  - replaced registry-only configuration names with the neutral
    `WGCF_DELIVERY_ART_*` service boundary before runtime activation
- tests or validator added:
  - authenticated issue/read transport, bounds, secret-redaction, and exact
    receipt-reference tests
  - full service issue, resolve, and finalization-chain test
  - HTTP authority and workflow-boundary coverage
  - CLI receipt persistence and finalization-reference coverage
- related change records:
  - [2026-08-12-delivery-art-custody-owner-runtime.md](2026-08-12-delivery-art-custody-owner-runtime.md)
  - [2026-08-11-review-packet-source-binding.md](2026-08-11-review-packet-source-binding.md)
- security review:
  [Delivery ART evidence custody and source provenance](https://github.com/mfshaf7/security-architecture/blob/ed294c05a7b7032dd5d00605af57434376237e90/docs/reviews/components/2026-08-09-art-evidence-custody-and-source-provenance.md)
  already approves this method-scoped OOS-to-WGCF trust edge for bounded
  implementation. This defect closes the reviewed OOS readiness-client gap; it
  introduces no new identity, secret, storage authority, or ART mutation owner.

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source change only until
  the PR lands and the approved dev-integration runtime is reconciled
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation:
  - `npm test`: 501 passed, 0 failed
  - `npm run validate:api-docs`: 65 documented routes match 65 implemented routes
  - `npm run validate:governance-docs`: passed
  - `npm run validate:orchestration-bundle`: passed
  - `npm run validate:orchestration-openapi-schemas`: passed
  - `npm run validate:delivery-art-contracts -- --source-root /home/mfshaf7/projects/workspace-governance`:
    passed against the canonical workspace contract source
  - explicit changed-file security change-record requirement: passed
- live or dev-integration verification: pending post-merge OOS and WGCF runtime
  reconciliation before `#806` dogfood resumes
- residual risk: the live WGCF image and OOS dev-integration environment remain
  stale and mutation-disabled until the separate reconciliation step completes.
  The generated Security Architecture change-record index must also land after
  this record reaches OOS `main` and before `#814` closure is claimed.

## Follow-Up

- required follow-up:
  - merge this Landing Unit through its finalized Review Packet
  - reconcile WGCF and OOS dev-integration runtime configuration
  - resume `#806` and dogfood the full initiative `#698` custody and readiness
    chain
- owner: `operator-orchestration-service`, followed by the existing Platform
  runtime owner for dev-integration reconciliation
- due date or closure condition: before unblocking `#806` or enabling schema-v2
  Delivery ART mutation in the shared dev-integration profile
