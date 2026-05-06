---
security_evidence:
  review_areas:
    - delivery
    - runtime
  findings: []
  risks: []
  workstreams:
    - WS-007
  reviewed_artifacts:
    - src/delivery-initiative-lineage.json
    - test/openproject-client.test.js
    - dev-integration/profiles/accepted-idea-delivery/profile.yaml
    - dev-integration/profiles/accepted-idea-delivery-mutation-smoke/profile.yaml
    - dev-integration/profiles/idea-workflow/profile.yaml
  notes: "Adds product-prototype-delivery lineage and explicit dev-integration lane classes without changing OpenProject write semantics."
---

# 2026-05-06 Product Prototype Delivery Lineage

## Summary

Added `product-prototype-delivery` to the broker initiative-lineage metadata
and backfilled dev-integration profile lane classes so Prototype Studio work is
not forced into an unrelated initiative family.

## Classification

- area: Delivery ART broker metadata and dev-integration profile declarations
- type: workflow contract metadata update
- runtime impact: source-only metadata; no OpenProject mutation semantics changed

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: #681
- related products or components: Workspace Delivery ART, Workspace Prototype Studio, accepted-idea delivery broker

## Root Cause

- immediate failure: Prototype Studio needed a valid initiative family, but the broker only knew existing workspace governance families.
- actual root cause: product/prototype incubation was not represented in the broker lineage vocabulary before #681.
- why it escaped earlier controls: the lineage catalog predated the prototype/client-app delivery lane and had no contract pressure from that class of work.

## Source Changes

- changed workflow, adapter, or contract: `src/delivery-initiative-lineage.json` now declares `product-prototype-delivery`.
- tests or validator added: `test/openproject-client.test.js` covers the new family.
- related change records: None.

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only broker metadata and profile declaration change.
- image tag or digest: None.
- runtime revision: None.

## Live Verification

- local validation: `node --test test/openproject-client.test.js`
- live or dev-integration verification: not required; no live broker mutation behavior changed.
- residual risk: workspace governance must land last so its dev-integration lane-class validator sees the owner-repo profile fields on remote `main`.

## Follow-Up

- required follow-up: none for this repo after PR merge and workspace-governance validation.
- owner: `operator-orchestration-service`
- due date or closure condition: workspace-governance #681 onboarding closes with review-packet evidence.
