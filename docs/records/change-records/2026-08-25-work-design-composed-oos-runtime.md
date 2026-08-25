---
security_evidence:
  review_areas:
    - ai
    - delivery
    - identity
    - runtime
  reviewed_artifacts:
    - dev-integration/profiles/accepted-idea-delivery/profile.yaml
    - dev-integration/profiles/accepted-idea-delivery/scripts/common.sh
    - dev-integration/profiles/accepted-idea-delivery/scripts/up.sh
    - dev-integration/profiles/accepted-idea-delivery/scripts/status.sh
    - dev-integration/profiles/accepted-idea-delivery/scripts/down.sh
    - docs/contracts/work-design-v1.md
    - src/config.js
    - src/work-design/clients.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "This OOS landing unit consumes an already registered local dev-integration composition. It does not add a provider credential, browser-to-internal-service route, stage/prod activation, or direct model mutation authority. Formal composed-boundary acceptance remains Security Architecture child #1003."
---

# 2026-08-25 Work Design Composed OOS Runtime

## Summary

Implemented Delivery ART `#1002`: the active accepted-idea delivery profile now
consumes the Platform-projected CGG endpoint, governed AI gateway endpoint, and
composition-lifetime CGG caller binding required by the governed Work Design
path.

## Classification

- area: governed Delivery Work Design
- type: local dev-integration runtime composition
- runtime impact: OOS Work Design is available only through the registered
  `work-design-advice` composition; standalone ART operation remains available
  with Work Design fail closed

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Task `#1002` under correction Defect `#998`, Feature
  `#908`, and delivery `#884`
- related components: Platform dev-integration runner, Context Governance
  Gateway, governed AI gateway, Governance Operations Console, and OpenProject

## Root Cause

- immediate failure: the Platform runner projected the accepted Work Design
  dependencies, but the OOS profile did not consume or verify them
- actual root cause: OOS profile lifecycle and credential custody had not been
  connected to the existing Work Design clients and same-origin Console API
- why it escaped earlier controls: the original source children proved each
  component separately without an executable composed-runtime landing unit

## Source Changes

- require the exact `work-design-advice` composition before accepting any Work
  Design endpoint or credential projection
- validate both endpoints as their declared cluster-local HTTP services
- project the caller credential through a dedicated optional Kubernetes Secret
  reference instead of `broker.env` or rendered YAML
- compare the live endpoint and credential bindings without printing values
- fail composed status on missing or mismatched projection and standalone
  status on stale composition state
- remove the dedicated binding on failed launch, suspension, and standalone
  reconciliation while preserving unrelated profile state
- retain the existing Console same-origin API and OOS Work Design service
- add positive, negative, fail-closed, and disclosure-focused tests

## Artifact And Deployment Evidence

- source-backed local dev-integration Landing Unit
- no governed stage or production deployment
- no provider credential, Console source, OpenProject model, or unrelated OOS
  workflow change
- exact merged source and CI evidence will be bound by the finalized Review
  Packet for ART `#1002`

## Live Verification

- focused profile tests verify complete-composition admission, partial and
  foreign denial, redacted readiness, mismatch detection, secret
  non-persistence, and teardown ownership
- existing and extended Work Design service tests verify exact CGG caller
  headers, no credential forwarding to the governed AI gateway, bounded missing
  dependency behavior, governed advice, explicit apply, replay, restart, backend
  readback, and receipts
- full owner-repo CI-equivalent validation is required before merge
- residual risk: the formal cross-component security decision remains ART
  `#1003`

## Follow-Up

- required follow-up: Security Architecture reviews the exact composed source
  heads and runtime boundary in ART `#1003`
- owner: `security-architecture`
- closure condition: the Security child records its bounded decision and the
  Feature-level composed proof can close without broadening runtime authority

## Rollback

Revert the OOS profile composition validation, endpoint projection, dedicated
caller-secret reference, readiness and teardown checks, focused tests, and
owner documentation. Platform composition generation, CGG caller admission,
the governed AI profile, Governance Console source, OpenProject state, and
unrelated OOS workflows remain unchanged.
