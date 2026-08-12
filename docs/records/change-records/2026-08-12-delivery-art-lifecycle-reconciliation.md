---
security_evidence:
  review_areas:
    - runtime
    - delivery
  reviewed_artifacts:
    - contracts/delivery-art-lifecycle/capabilities.json
    - contracts/delivery-art-lifecycle/lifecycle-plan.schema.json
    - src/delivery-art/lifecycle.js
    - src/delivery-art/lifecycle-authoring.js
    - src/delivery-art/lifecycle-controller.js
    - src/delivery-art/lifecycle-cli-adapters.js
    - src/delivery-art/service.js
    - src/app.js
    - src/art-cli.js
    - docs/api/openapi.json
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-08-12 Delivery ART Lifecycle Reconciliation

## Summary

Replaced the fragmented manual Delivery ART source-closeout sequence with one
source-owned, resumable lifecycle state machine and CLI controller. The normal
path now authors work-start and Review Packet v2 candidates, advances eligible
durable transitions, and stops at explicit human authority boundaries.

## Classification

- area: Workspace Delivery ART source lifecycle
- type: workflow controller, broker API, local operator CLI, and contract
- runtime impact: source change only until the OOS dev-integration runtime is
  reconciled after merge; no governed stage or production activation

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Defect `#819` under delivery `#698`
- related products or components:
  - `operator-orchestration-service`
  - Workspace Delivery ART
  - `workspace-governance-control-fabric`

## Root Cause

- immediate failure: source-backed ART delivery required operators to infer and
  manually sequence architecture custody, work-start, Review Packet v2,
  readiness, source merge, finalization, and ART closeout.
- actual root cause: individual controls existed, but no source-owned lifecycle
  capability contract or adapter-independent state machine made their ordering,
  retry behavior, and human gates executable.
- why it escaped earlier controls: route and artifact tests proved each local
  transition independently. They did not prove one resumable operator path from
  work-start through finalized evidence and ART closeout.

## Source Changes

- changed workflow, adapter, or contract:
  - added machine-readable lifecycle capability truth and lifecycle-plan schema
  - added canonical work-start, Review Packet v2, and post-merge candidate
    authoring services and API routes
  - added an adapter-independent state machine with explicit architecture,
    source, evidence, pull-request, merge, exception, and ART-closeout gates
  - added filesystem, Git, GitHub, broker, and ART CLI adapters plus resumable
    `lifecycle status` and `lifecycle reconcile` commands
  - extended Landing Unit closeout to consume finalized Review Packet v2
    evidence directly while retaining explicit v1 compatibility
- tests or validator added:
  - state projection and retry-safety tests
  - canonical authoring and source-binding tests
  - controller tests from work-start through post-merge finalization
  - real Git ancestry, exact pull-request identity, process-crash recovery, and
    CLI command-boundary tests
  - durable post-merge projection tests proving that later checkout drift does
    not replace merge-ready packet and merged pull-request truth
  - native Review Packet v2 dry-run and ART-submit tests
  - OpenAPI route and example validation
- related change records:
  - [2026-08-12-wgcf-operating-readiness-integration.md](2026-08-12-wgcf-operating-readiness-integration.md)
  - [2026-08-12-delivery-art-custody-owner-runtime.md](2026-08-12-delivery-art-custody-owner-runtime.md)
  - [2026-08-11-review-packet-source-binding.md](2026-08-11-review-packet-source-binding.md)
- security review:
  [Delivery ART evidence custody and source provenance](https://github.com/mfshaf7/security-architecture/blob/ed294c05a7b7032dd5d00605af57434376237e90/docs/reviews/components/2026-08-09-art-evidence-custody-and-source-provenance.md)
  already covers the caller-bound OOS-to-WGCF evidence path. This change adds
  deterministic orchestration over that boundary without introducing a new
  identity, secret, storage authority, or autonomous approval path.

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only until pull
  request merge and separate dev-integration reconciliation
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation:
  - `npm test` (`536` passed)
  - `npm run validate:api-docs` (`68` documented routes matched implementation)
  - `npm run validate:governance-docs`
  - `npm run validate:orchestration-bundle`
  - `npm run validate:orchestration-openapi-schemas`
  - `npm run validate:delivery-art-contracts -- --source-root ../workspace-governance`
  - `npm run validate:change-record-requirement`
  - `npm run validate:openproject-mutation-contracts`
- live or dev-integration verification: pending post-merge dogfood through the
  activated workspace-governance capability contract
- residual risk: the new controller remains unavailable to shared operators
  until this OOS Landing Unit and the dependent workspace-governance activation
  item `#820` both land

## Follow-Up

- required follow-up:
  - land OOS `#819`
  - activate capability and parity validation through workspace-governance
    `#820`
  - dogfood the next source-backed ART item through the lifecycle controller
  - close the linked improvement candidate only after that dogfood succeeds
- owner: `operator-orchestration-service`, then `workspace-governance`
- due date or closure condition: before the next source-backed Delivery ART
  Landing Unit is treated as normal-path complete
