---
security_evidence:
  review_areas:
    - ai
    - delivery
    - identity
    - runtime
    - secrets
  reviewed_artifacts:
    - dev-integration/profiles/accepted-idea-delivery/profile.yaml
    - dev-integration/profiles/accepted-idea-delivery/scripts/common.sh
    - dev-integration/profiles/accepted-idea-delivery/scripts/up.sh
    - dev-integration/profiles/accepted-idea-delivery/scripts/status.sh
    - dev-integration/profiles/accepted-idea-delivery/scripts/smoke.sh
    - dev-integration/profiles/accepted-idea-delivery/scripts/down.sh
    - test/devint-refinement-catalog-composition.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "This OOS landing unit implements only the local dev-integration profile delta permitted by Security Architecture review #1012. It adds no browser-to-internal route, provider credential, repository lifecycle authority, stage/prod activation, or autonomous model action."
---

# 2026-08-26 Refinement And Catalog Composed OOS Runtime

## Summary

Implemented Delivery ART `#1016`: the accepted-idea delivery profile now
consumes the exact registered Refinement, Catalog, WGCF, governed AI gateway,
and Temporal projections, runs the dedicated Refinement worker, and mounts the
canonical Platform Catalog control source into OpenProject.

## Classification

- area: governed Delivery Refinement and Catalog
- type: local dev-integration runtime composition
- runtime impact: available only through the registered `refinement-catalog`
  composition; standalone ART operation keeps both capabilities fail closed

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: User story `#1016` under Feature `#909` and delivery
  `#884`
- related components: Platform dev-integration runner, Context Governance
  Gateway, governed AI gateway, Workspace Governance Control Fabric, Temporal,
  Governance Operations Console, and OpenProject

## Root Cause

- immediate failure: the registered composition and owner runtimes had no OOS
  profile integration boundary
- actual root cause: projected dependencies, composition credentials, Catalog
  source, dedicated worker lifecycle, readiness, smoke, and teardown had not
  been bound as one fail-closed profile capability
- why it escaped earlier controls: predecessor children intentionally proved
  contracts, runtimes, Security, and Platform support as separate Landing Units

## Source Changes

- accept only the exact registered composition and exact cluster-local endpoint,
  caller, activation, and credential relationships
- keep CGG, WGCF, and Catalog-control credentials in namespace Secrets instead
  of `broker.env`, rendered manifests, logs, status, or Git
- mount the canonical Platform Catalog extension and contract through a
  ConfigMap without copying implementation into OOS
- expose the existing OpenProject release under the composition-declared local
  service identity
- run one dedicated Refinement worker with fixed identity and existing OOS
  source, contract, Temporal, and activity boundaries
- fail status and startup on missing or mismatched live bindings and remove all
  composition-owned resources on failure, suspension, standalone launch, or
  reset
- extend read-only smoke with worker readiness and canonical Catalog projection
  without adding mutation traffic

## Artifact And Deployment Evidence

- source-backed local dev-integration Landing Unit
- no governed stage or production deployment
- no Console source, canonical Catalog value, Repository lifecycle, or
  OpenProject project-model change
- exact merged source and CI evidence will be bound by the finalized Review
  Packet for ART `#1016`

## Live Verification

- focused tests cover exact and partial composition admission, shared gateway
  compatibility, malformed endpoints, caller mismatch, activation mismatch,
  credential mismatch, redacted readiness, source mounting, worker gating,
  read-only Catalog smoke, stale state, and teardown ownership
- the complete owner-repo test suite passes with 793 tests
- chart contract inspection confirms the pinned OpenProject chart supports the
  declared environment, volume, mount, and annotation inputs
- composed runtime proof remains deferred until Workspace activates the
  composition in ART `#1017`; source tests are not presented as live proof

## Follow-Up

- required follow-up: activate the registered Workspace composition in ART
  `#1017`, then run the bounded composed-runtime proof in ART `#1013`
- owners: `workspace-governance`, then `platform-engineering`
- closure condition: each child closes through its own reviewed source or live
  evidence boundary without broadening Security review `#1012`

## Rollback

Revert the profile projection validation, namespace bindings, OpenProject
Catalog mounts, dedicated worker, readiness, smoke, teardown, tests, and owner
documentation. Canonical records, OOS workflow source, Platform Catalog source,
Workspace contracts, Security review, Console source, and unrelated profile
state remain unchanged.
