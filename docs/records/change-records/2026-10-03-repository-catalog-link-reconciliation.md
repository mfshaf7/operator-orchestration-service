---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - contracts/delivery-change/manifest.json
    - contracts/delivery-change/command.schema.json
    - docs/contracts/delivery-change-control-v1.md
    - src/delivery-change/contracts.js
    - src/delivery-change/service.js
    - src/delivery-art/work-session-cli-adapters.js
    - src/delivery-art/work-session-controller.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "The change reuses the existing Catalog and Delivery authorities, adds no caller identity or secret, and fails closed when either correlation or canonical Delivery readback is incomplete. Exact composed-boundary Security acceptance remains in ART #1230."
---

# 2026-10-03 Repository And Catalog Link Reconciliation

## Summary

Delivery ART `#1228` tightens the existing `link_repository` command so one
Delivery command identity binds Catalog mutation, Delivery work-item update,
and canonical Delivery readback. A repository link is successful only when the
readback proves the expected work item and owner repository.

## Classification

- area: Delivery Change Control and Delivery Catalog composition
- type: fail-closed reconciliation hardening
- runtime impact: source-only until the separately governed Repository and
  Catalog composition is commissioned by ART `#1231`

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: User story `#1228` under Feature `#1211` and Epic `#1203`
- related authorities: OpenProject Delivery ART, OOS Delivery Change Control,
  and OOS Delivery Catalog

## Root Cause

- Catalog already verified its own canonical mutation readback.
- Delivery Change Control applied the subsequent work-item owner update and
  projected a new package revision, but did not assert that the exact target
  work item contained the expected owner repository.
- The nested Catalog request also could carry a correlation identity different
  from its enclosing Delivery command, weakening end-to-end reconciliation.
- During recovery, the lifecycle inspector supplied pull-request identity but
  not Agent-source review evidence to the work-session merge gate. The gate
  consequently treated a valid exact-head human approval as missing.

## Source Changes

- require the Catalog mutation correlation ID to equal the enclosing Delivery
  command ID
- read the Delivery package after the owner update and verify the exact work
  item and owner repository
- bind the Catalog receipt, Delivery record, source revision, work-item
  reference, and owner repository into one reconciliation result
- return explicit `partial_failure` and `reconcile_repository_link` when
  Catalog succeeded but Delivery readback is missing or mismatched
- cover positive correlation/readback and negative mismatch behavior in tests
- refresh exact-head review evidence from the Agent-source adapter at the
  source-merge gate instead of relying on the narrower lifecycle projection
- consume paginated GitHub reviews as bounded newline-delimited JSON so the
  review readback works with the admitted GitHub CLI version

## Artifact And Deployment Evidence

- source-only Landing Unit; no Catalog value, Delivery item, repository,
  credential, deployment, stage, or production state was changed
- repository and Catalog reconciliation implementation:
  - reviewed head: `a3f1e1d3f2fb5584dbf487b80c7655bbc1fe7c51`
  - merge commit: `d65a4566324db480dcc614c98f71ef24795a4435`
  - pull request: `https://github.com/mfshaf7/operator-orchestration-service/pull/264`
- exact-head review projection and portable GitHub review readback repair:
  - reviewed head: `26cd794b14c42c9a66f600d2181596efbd564bde`
  - merge commit: `b8f50b52cd9bb75f2cbdb5f386d1d356c8d3a2b6`
  - pull request: `https://github.com/mfshaf7/operator-orchestration-service/pull/265`
- evidence-preserving recovery control:
  - merge commit: `12afbad59ed09f4f01b26f24d2f84a0f4e520173`
  - pull request: `https://github.com/mfshaf7/operator-orchestration-service/pull/266`

## Recovery Reconciliation

- The first work session was bound to architecture digest
  `sha256:bfe66f8a01d4f1ab5ffa7d6a55284ac85793246de801af0d832c7d6d31f30ab1`,
  whose merge-ready conformance case used a fidelity not admitted by the
  owner-repository evidence profile.
- The source was reviewed and merged, then the incomplete session was archived
  through recovery receipt
  `work-session-recovery:work-session:delivery-1203:delivery-1203-repository-catalog-oos`;
  the recovery does not claim a missing Review Packet.
- The first replacement Landing Unit merged through pull request `#265` and
  produced a durable merge-ready Review Packet. Finalization then proved that
  the prior architecture incorrectly assigned Feature-level live-backend cases
  to supporting source child `#1228`.
- The corrected initiative architecture digest is
  `sha256:215b8363f7bf0be55e26b73c8b76eb805cf631d00187f85725e7b4cbb60b0eb4`.
  It assigns Repository and Catalog operating cases only to Feature `#1211`
  and Platform activation child `#1231`; this OOS source child carries the
  initiative protocol and real-Git merge-ready cases that its owner can prove.
- Recovery receipt
  `work-session-recovery:work-session:delivery-1203:delivery-1203-repository-catalog-oos-recovery-1`
  preserves the earlier merge-ready packet at digest
  `sha256:1c71ac9a863ea30235587113ab6d0ffc70eabbacc943bcebd50bcd73b0202864`
  without rewriting or treating it as current completion evidence.
- Landing Unit `delivery-1203-repository-catalog-oos-recovery-2` is the sole
  successor source intent. It binds the complete recovery chain, this corrected
  architecture, and fresh exact-base/head evidence before ART closeout; it
  does not reattribute the implementation away from pull requests `#264` and
  `#265`.

## Live Verification

- focused Delivery Change tests: `19` passed, `0` failed
- owner repository suite: `1180` passed, `0` failed, `2` skipped
- Delivery Change OpenAPI synchronization check passed
- governance documentation validation passed
- base-aware OpenProject mutation validation reported no mutation-contract
  changes
- live backend verification remains assigned to the Feature-level operating
  conformance and Platform commissioning children

## Follow-Up

- Security reviews the exact composed boundary in ART `#1230`.
- Platform commissions the routine composition in ART `#1231` only after the
  Security gate is satisfied.

## Rollback

Revert the correlation guard, Delivery readback assertion, reconciliation
projection, tests, and this record together. Existing Catalog and Delivery
authorities remain independently available and no live state needs reversal.
