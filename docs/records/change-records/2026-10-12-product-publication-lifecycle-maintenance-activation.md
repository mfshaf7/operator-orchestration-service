---
security_evidence:
  review_areas:
    - identity
    - delivery
    - runtime
  reviewed_artifacts:
    - contracts/product-publication/manifest.json
    - src/product-publication/contracts.js
    - src/product-publication/runtime.js
    - src/product-publication/service.js
    - test/product-publication.test.js
    - docs/operations/product-publication-operator-surface.md
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: OOS binds the exact Security #1271 decision and activates only internal, unlisted, and archived targets plus archive and restore actions; Platform #1273 still owns live commissioning and complete sequence proof.
---

# Product Publication Lifecycle Maintenance Activation

## Summary

OOS now binds the merged lifecycle-maintenance Security decision and activates
only the target and action subset required for the complete Product
Publication maintenance sequence. The change reuses Workspace Registry and
Product Publication; it creates no direct maintenance mutation path or new
authority.

## Classification

- area: Product Publication authorization and source activation
- type: source-backed ART work item `#1272`
- runtime impact: source gate active; live use remains blocked until Platform
  `#1273` commissions the exact revision and Security configuration

## Ownership

- workflow, source scope, journal, and terminal receipt owner:
  `operator-orchestration-service`
- lifecycle owner: Workspace Registry under `workspace-governance`
- readiness and ledger owner: `workspace-governance-control-fabric`
- product evidence owner: `governance-operations-console`
- acceptance owner: `security-architecture`
- composition and operating-proof owner: `platform-engineering`

## Root Cause

The inactive capability already supported archive and restoration, but the
initial activation plan treated those actions as an isolated slice. It omitted
the prerequisite unpublish from the current internal posture, fresh owner
evidence at each Registry boundary, and exact final baseline reconciliation.
Security `#1271` corrected the accepted sequence before source activation.

## Accepted Boundary

The source manifest binds:

- Security decision
  `security-architecture://product-publication/decisions/lifecycle-maintenance-v1`;
- Security revision
  `d4486a2d37729db97017c90a6a82e4fcf12f7ce6`;
- exact Security review digest
  `sha256:34968ebef73c3b53aad02d3d4ab60f4bca2a6858748f1079a7d42f43ea6efcb2`;
- target postures `unlisted`, `internal`, and `archived`; and
- lifecycle-maintenance actions `archive` and `restore`.

Fixed action bindings continue to constrain every source and target pair.
Client and public remain rejected before readiness access or journal mutation.

## Ordered Workflow

The operating sequence must use fresh reviewed owner evidence and the existing
authoritative owners:

1. active/`internal` owner evidence, then Product Publication `unpublish`;
2. Workspace Registry `retire`;
3. fresh schema-v2 retired/`unlisted` evidence, then publication `archive`;
4. Workspace Registry `restore`;
5. fresh schema-v2 active/`unlisted` evidence, then publication `restore`;
6. independent publication back to `internal` when restoring the baseline; and
7. fresh final active/`internal` owner evidence plus cross-owner readback.

No prior `manifest_source` may be copied forward. Interruption recovery starts
from authoritative Registry and publication readback and preserves all
immutable history.

## Source Changes

- activates the existing lifecycle-maintenance source gate for `archive` and
  `restore`;
- expands only the source-approved target set needed for unpublish, archive,
  restoration, and return to the existing internal baseline;
- binds the corrected Workspace Governance sequence contract and exact
  Security decision;
- updates regression tests to exercise the source-default activation while
  preserving fail-closed denial; and
- updates the primary operator surface and repository summary.

## Validation

- Product Publication tests cover exact decision binding, approved target and
  action scope, client/public denial before WGCF, fail-closed empty maintenance
  scope, the complete publication transition chain, replay, lifecycle history,
  and cross-boundary implications;
- the full owner test suite, API documentation validation, governance-document
  validation, and source-diff validation remain required before merge; and
- the Delivery ART Review Packet must bind cases `case:1272-positive` and
  `case:1272-negative` from the current architecture packet.

## Artifact And Deployment Evidence

- source work belongs to Landing Unit
  `delivery-894-lifecycle-oos-activation`;
- Security PR #238 and merge commit
  `d4486a2d37729db97017c90a6a82e4fcf12f7ce6` provide acceptance evidence; and
- no deployment, runtime credential, owner manifest, Registry lifecycle, or
  publication state is changed by this source landing.

## Live Verification

No live-success claim is made. Platform `#1273` must bind the exact merged OOS
revision, deliver the exact Security configuration, coordinate reviewed owner
manifests, prove positive and negative orderings, survive interruption and
restart, and reconcile the final active/`internal` baseline.

## Follow-Up

Platform `#1273` must update the composition policy and primary runbook, create
or coordinate each required reviewed owner-manifest revision, commission the
exact merged OOS source, and retain the terminal operating receipt. Feature
`#924` must not close until that evidence is finalized.

## Rollback

Revert the manifest, tests, and operator guidance together to restore the prior
internal-only source scope. Runtime rollback must preserve Workspace Inventory
history, WGCF ledger entries, OOS journal entries, publication receipts, owner
source, and review evidence.
