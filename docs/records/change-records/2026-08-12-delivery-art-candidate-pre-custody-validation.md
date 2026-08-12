---
security_evidence:
  review_areas:
    - delivery
    - runtime
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-08-12 Delivery ART Candidate Pre-Custody Validation

## Summary

Aligned OOS with the approved local architecture-candidate lifecycle and added
semantic validation before Delivery ART artifacts are submitted for durable
WGCF custody.

## Classification

- area: Delivery ART workflow and evidence custody
- type: pinned contract update and broker runtime hardening
- runtime impact: prevents semantically invalid transformed candidates from
  reaching the registry; no OpenProject field or route contract changed
- ART slice: `#818` under delivery `#698`

## Ownership

- owner repo: `operator-orchestration-service`
- authoritative contract owner: `workspace-governance`
- authoritative source merge: `21381cc24d1b8d1dab3ee2d67b18ca0f40ad5e9c`
- related ART work:
  - `#817` approved the architecture-candidate contract correction
  - `#818` consumes and enforces that correction in OOS
  - `#816` remains a separate blocker-action Landing Unit

## Root Cause

- immediate failure: OOS treated an approved `architecture-ready` local packet
  as if its decision state had to imply durable custody.
- runtime gap: service transitions validated their input and the returned
  durable artifact, but did not validate the transformed semantic projection
  immediately before registry submission.
- consequence: an invalid work-start chronology could reach immutable WGCF
  custody before OOS rejected the returned artifact.

## Source Changes

- [contracts/delivery-art](../../../contracts/delivery-art) now pins the exact
  merged Workspace Governance contract source for approved local architecture
  candidates.
- [src/delivery-art/contracts.js](../../../src/delivery-art/contracts.js)
  separates semantic projection validation from durable-envelope schema
  validation and requires work-start architecture dependencies to resolve to
  durable WGCF custody.
- [src/delivery-art/service.js](../../../src/delivery-art/service.js) validates
  each transformed semantic projection before registry submission.
- [test/delivery-art-contracts.test.js](../../../test/delivery-art-contracts.test.js)
  proves approved local candidates, false persistence rejection, and
  durable-only dependency resolution.
- [test/delivery-art-service.test.js](../../../test/delivery-art-service.test.js)
  proves an invalid transformed candidate causes no registry write or
  OpenProject projection.
- [delivery-workflow-operator-surface.md](../../operations/delivery-workflow-operator-surface.md)
  documents the local-decision and durable-dependency boundary.

## Mutation Boundary

- OpenProject route, form, and writable-field behavior are unchanged.
- WGCF remains the only durable artifact registry.
- OpenProject still receives only safe artifact and custody-receipt references
  after successful custody.
- Registry failure still prevents projection, and projection failure still
  preserves durable evidence for exact replay.

## Artifact And Deployment Evidence

- source evidence:
  - the pinned bundle manifest resolves to Workspace Governance merge
    `21381cc24d1b8d1dab3ee2d67b18ca0f40ad5e9c`.
  - the `#818` Review Packet will bind the exact OOS merge commit.
- image tag or digest:
  - pending pull-request merge and dev-integration reconciliation.
- runtime revision:
  - pending pull-request merge and dev-integration reconciliation.

## Live Verification

- local validation:
  - focused contract and service tests
  - pinned bundle provenance and digest validation
  - full OOS test and governance validation set
  - exact-base pull-request validation before merge
- live or dev-integration verification:
  - the accepted-idea-delivery dev-integration profile must be reconciled to
    the merged OOS source before `#818` closes.
- residual risk:
  - the temporary single-writer dogfood admission remains bounded to this
    initiative and will be restored after the dogfood sequence completes.

## Follow-Up

- complete `#816` from the merged and reconciled OOS base.
- retain the failed first-generation `#818` work-start artifact as immutable
  failure evidence; the valid `v2` work-start is the projected source for this
  Landing Unit.
