---
security_evidence:
  review_areas:
    - delivery
  reviewed_artifacts:
    - src/delivery-art/contracts.js
    - src/delivery-art/service.js
    - test/delivery-art-contracts.test.js
    - test/delivery-art-service.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-08-24 Delivery ART Architecture V2 Validator Parity

## Summary

Corrected the OOS Delivery ART semantic validator and historical freshness
comparator so architecture packet v2 uses its work dependency graph, Landing
Units, source landing graph, and human gates while architecture packet v1
retains its existing dependency merge DAG rules.

## Classification

- area: Workspace Delivery ART architecture admission
- type: fail-closed contract-validator parity correction
- runtime impact: OOS artifact preflight, persistence admission, and historical
  architecture freshness evaluation only; no workflow, custody, or canonical
  backend mutation authority changed

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Defect `#984` under delivery `#884`
- related completed lineage: work-session lifecycle delivery `#958`
- related products or components:
  - `operator-orchestration-service`
  - `workspace-governance-control-fabric`
  - Workspace Delivery ART

## Root Cause

- immediate failure: OOS rejected every schema-valid architecture packet v2
  because its semantic validator still read only v1 topology fields.
- actual root cause: the v2 schema snapshot reached OOS without the matching
  version-aware semantic validation and historical topology branches already
  implemented by WGCF.
- why it escaped earlier controls: OOS fixtures and tests exercised only the
  v1 architecture packet for both direct validation and snapshot-progress
  evaluation even though the pinned schema accepted v2.

## Source Changes

- changed workflow, adapter, or contract:
  - retained all v1 graph and owner merge-order validation
  - added v2 work graph coverage and acyclicity validation
  - added exact Landing Unit assignment and owner validation
  - added source-backed Landing Unit graph coverage and acyclicity validation
  - added human-gate authority and affected-Landing-Unit validation
  - made historical freshness compare v2 ART relations with the v2 work
    dependency graph instead of the retired v1 dependency merge DAG
- tests or validator added:
  - valid v2 separated topology
  - incomplete work graph rejection
  - Landing Unit owner mismatch rejection
  - cyclic source landing graph rejection
  - human-gate authority owner mismatch rejection
  - unchanged v2 work topology acceptance after an ordinary ART snapshot
    digest change

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-mounted
  `accepted-idea-delivery` dev-integration broker restarted against the exact
  local change
- image tag or digest: None; the active profile mounts local source
- runtime revision: branch `codex/art-984-oos-v2-architecture-validator`, base
  `ef46103edfbee60aa02e27367d8ce0194c5553d8`

## Live Verification

- local validation: the focused contract and service suites passed 32 tests;
  the full suite and `npm run validate:delivery-art-contracts` must pass again
  at the replacement PR head
- live or dev-integration verification: the active broker validated and
  durably persisted `architecture-packet:delivery-884-v2` through the normal
  OOS-to-WGCF custody path
- residual risk: future architecture packet schema versions still require an
  explicit matching semantic branch and regression fixture in both owners

## Follow-Up

- required follow-up: finalize the `#984` Review Packet and close the Defect;
  then continue prerequisite `#977`
- owner: `operator-orchestration-service`
- due date or closure condition: before source work begins on `#977`
