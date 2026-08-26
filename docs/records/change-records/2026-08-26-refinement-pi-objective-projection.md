# 2026-08-26 Refinement PI Objective Projection

## Summary

Corrected Delivery ART `#1022`: Refinement now accepts canonical `PI Objective`
nodes in the Delivery tree and returns a bounded projection failure when an
internal source contract cannot be represented publicly.

## Classification

- area: Delivery Refinement projection and error boundary
- type: dev-integration runtime correction
- runtime impact: legitimate Delivery trees containing PI Objectives project
  successfully; unexpected internal source codes fail closed without
  terminating the OOS API process

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Defect `#1022` under Feature `#909` and delivery `#884`
- triggering proof: non-source runtime item `#1020`

## Root Cause

- the Refinement packet projects the complete canonical Delivery tree, but its
  tree-node enum omitted the valid `PI Objective` type
- the resulting internal `refinement_contract_invalid` code crossed the source
  boundary unchanged even though it is not part of the public Refinement error
  contract
- serializing that unsupported error raised a second contract exception and
  terminated the Node process

## Source Changes

- admit `PI Objective` in the Refinement packet tree-node contract and synced
  OpenAPI schema
- normalize non-public source failures to `backend_projection_failed` with a
  bounded message
- prove canonical source projection with a PI Objective child
- prove internal source-contract failure remains serializable through the
  public error contract

## Artifact And Deployment Evidence

- source-backed OOS Landing Unit only
- no image publication, stage deployment, or production deployment is claimed
- the `refinement-catalog` dev-integration composition is reconciled only after
  the reviewed source merges

## Live Verification

- focused Refinement contract, service, source-adapter, HTTP, OpenAPI, and
  Temporal bundle checks pass locally
- full OOS validation and container smoke are required at the reviewed head
- exact merged `refinement-catalog` runtime proof remains owned by `#1020`

## Follow-Up

- merge this isolated OOS correction and reconcile the composition to that
  exact revision
- resume `#1020` positive, negative, durable execution, Catalog readback, and
  reverse-teardown evidence

## Rollback

Revert the packet type addition, bounded source-error normalization, tests,
OpenAPI synchronization, and this record together. Preserve canonical ART
records, Work Design receipts, Platform composition, Console behavior, stage,
and production.
