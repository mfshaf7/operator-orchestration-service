---
security_evidence:
  review_areas:
    - delivery
    - identity
    - runtime
  reviewed_artifacts:
    - dev-integration/profiles/accepted-idea-delivery/scripts/common.sh
    - dev-integration/profiles/accepted-idea-delivery/README.md
    - test/devint-refinement-catalog-composition.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "This correction preserves the Security-reviewed operator-scoped Temporal boundary and rejects the obsolete generic namespace. It adds no credential, browser route, workflow authority, stage, or production capability."
---

# 2026-08-26 Refinement Operator-Scoped Temporal Namespace

## Summary

Corrected Delivery ART `#1018`: the accepted-idea delivery profile now checks
the composed Refinement worker namespace against its existing
operator-scoped Temporal namespace instead of the obsolete literal `default`.

## Classification

- area: governed Delivery Refinement runtime
- type: dev-integration identity-boundary correction
- runtime impact: the registered Refinement composition can start only when
  Workspace and Platform project the exact current operator namespace

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Defect `#1018` under Feature `#909` and delivery `#884`
- related boundaries: Platform composition rendering, Workspace composition
  contract, and Temporal namespace admission

## Root Cause

- immediate failure: the Refinement worker reached Temporal and received
  `Namespace default was not found`
- actual root cause: OOS already derived `governance-${OPERATOR}` for its
  durable workflow namespace but composition validation independently required
  the stale literal `default`
- rejected workaround: creating a second generic namespace would split one
  operator's workflow history and weaken identity isolation

## Source Changes

- compare the projected namespace with the profile's existing
  `TEMPORAL_WORKFLOW_NAMESPACE`
- accept the exact current operator namespace
- reject the legacy literal, another operator's namespace, and missing values
- preserve all existing endpoint, caller, activation, and credential checks

## Evidence

- focused tests cover the exact namespace and fail-closed legacy and foreign
  namespace values
- complete owner-repo validation and CI-equivalent evidence are attached to
  the finalized Review Packet for `#1018`

## Artifact And Deployment Evidence

- source-backed OOS Landing Unit only
- no governed stage or production deployment
- no new namespace, credential, service, browser route, or workflow definition

## Live Verification

The final composed-runtime proof remains owned by `#1020` after the OOS,
Platform, and Workspace corrections merge. This source item proves the OOS
consumer boundary and does not claim branch-only runtime evidence as final.

## Follow-Up

- `#1013` renders the neutral operator template in Platform
- `#1019` activates the corrected Workspace binding
- `#1020` proves the exact merged composition and reverse teardown

## Rollback

Revert only the namespace comparison, focused tests, and this owner record.
Preserve workflow definitions, Temporal history, Platform and Workspace
source, OpenProject state, Console behavior, stage, and production.
