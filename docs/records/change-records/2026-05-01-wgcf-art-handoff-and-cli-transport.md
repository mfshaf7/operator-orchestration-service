---
security_evidence:
  review_areas:
    - runtime
    - delivery
  workstreams:
    - WS-007
  reviewed_artifacts:
    - src/app.js
    - src/art-cli.js
    - src/wgcf-art-handshake.js
    - docs/contracts/wgcf-art-handoff-v1.md
    - docs/api/openapi.json
  notes: "WGCF is recommendation-only; OOS remains the ART mutation authority and large CLI broker bodies move over stdin instead of argv."
---

# 2026-05-01 WGCF ART handoff and CLI transport

## Summary

Adds the OOS-side WGCF receipt handoff so control-fabric readiness receipts and
recommendations can become managed ART mutation drafts without giving WGCF
direct mutation authority.

## Classification

- area: delivery ART broker and operator workflow
- type: workflow contract and runtime guard
- runtime impact: source-compatible API and CLI behavior change

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: #522
- related products or components: `workspace-governance-control-fabric`

## Root Cause

- immediate failure: WGCF readiness receipts had no first-class broker handoff
  into OOS drafts.
- actual root cause: the new control-fabric architecture added recommendation
  receipts before OOS had an authority-preserving adapter.
- why it escaped earlier controls: mutation draft and Review Packet controls
  existed, but their source model did not distinguish WGCF recommendation
  authority from OOS mutation authority.

## Source Changes

- changed workflow, adapter, or contract: added
  `POST /v1/delivery-art/wgcf/mutation-drafts`,
  `npm run art -- wgcf draft`, WGCF authority metadata, and direct ART mutation
  rejection for WGCF-class callers.
- tests or validator added: added unit, HTTP, and CLI tests for WGCF handoff,
  direct mutation denial, raw-context rejection, blank consume Target PI, and
  stdin transport for large broker payloads.
- related change records: None.

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only pending PR.
- image tag or digest: None.
- runtime revision: None.

## Live Verification

- local validation: pending final validation in this slice.
- live or dev-integration verification: not applicable until source PR lands.
- residual risk: WGCF receipt semantics may expand; unsupported operations must
  stay explicit instead of widening into a generic mutation proxy.

## Follow-Up

- required follow-up: use the handoff from WGCF integration work and keep OOS as
  the only ART submitter.
- owner: `operator-orchestration-service`
- due date or closure condition: Feature #522 completion.
