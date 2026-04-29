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

# 2026-04-29 ART Mutation Drafts And Review Packets

## Summary

Added broker-owned mutation draft and Review Packet artifact workflows for
Workspace Delivery ART. Operators now have managed `npm run art -- draft ...`,
`npm run art -- review-packet ...`, and `npm run art -- scratch ...` commands
instead of relying on loose long-lived `.tmp` payload files for ART writes and
source-backed closeout evidence.

## Classification

- area: delivery workflow
- type: workflow control and operator-surface hardening
- runtime impact: caller-authenticated broker routes under `/v1/delivery-art`
  plus local ART CLI commands
- ART slice: `#378` broker-owned review packet and mutation draft workflows

## Ownership

- owner repo: `operator-orchestration-service`
- platform runtime owner: `platform-engineering`
- workspace guidance owner: `workspace-governance`
- related ART work:
  - `#378` top-level Epic
  - `#381` lifecycle contract design
  - `#382` mutation draft API lifecycle
  - `#383` Review Packet commands
  - `#386` managed scratch status and cleanup

## Root Cause

Operators were using ad hoc JSON payload files under `.tmp/` because the broker
had bounded write routes but no first-class pre-write artifact lifecycle. That
left payload intent, route selection, source evidence, and scratch cleanup
partly conversational or local-only instead of broker-owned and reviewable.

## Source Changes

- added [src/art-workflow-artifacts.js](../../../src/art-workflow-artifacts.js)
  for mutation draft, Review Packet, validation, finalization, and scratch
  classification contracts
- updated [src/app.js](../../../src/app.js) with `/v1/delivery-art/...` artifact
  routes
- updated [src/art-cli.js](../../../src/art-cli.js) with draft,
  review-packet, and scratch command families
- added [test/art-workflow-artifacts.test.js](../../../test/art-workflow-artifacts.test.js)
  plus HTTP and CLI coverage
- updated [docs/api/openapi.json](../../api/openapi.json),
  [docs/api/README.md](../../api/README.md),
  [docs/contracts/delivery-workflow-api-v1.md](../../contracts/delivery-workflow-api-v1.md),
  and [docs/operations/delivery-workflow-operator-surface.md](../../operations/delivery-workflow-operator-surface.md)
- added [.art/README.md](../../../.art/README.md) and ignore rules for generated
  draft, review-packet, archive, and legacy `.tmp/` artifacts
- updated the accepted-idea-delivery devint profile smoke and stage-handoff
  checks to include the delivery artifact mutation draft workflow

## Artifact And Deployment Evidence

- artifact:
  - mutation drafts lock a supported broker route and payload shape before
    submission
  - Review Packets map one landing unit to covered ART work items and reject
    `.tmp` scratch as final durable evidence
  - scratch status and cleanup now distinguish legacy unmanaged payloads from
    managed drafts and review packets
- deployment:
  - broker image rollout is required before live devint operators can call the
    new `/v1/delivery-art/...` routes from the running pod

## Live Verification

- local validation completed:
  - `npm test`
  - `npm run validate:api-docs`
- live devint validation completed:
  - `npm run art -- draft create work-item.complete 381 .art/drafts/live-smoke-work-item-381-complete.json`
  - `npm run art -- draft validate .art/drafts/live-smoke-work-item-381-complete.json`
  - `npm run art -- review-packet draft 378 .art/review-packets/live-smoke-delivery-378-work-item-381.json 381`
  - `npm run art -- review-packet validate .art/review-packets/live-smoke-delivery-378-work-item-381.json`
  - `DEVINT_OPENPROJECT_LOCAL_PORT=28183 DEVINT_OPENPROJECT_HOST_HEADER=localhost:18183 DEVINT_BROKER_LOCAL_PORT=28180 make devint-smoke PROFILE=accepted-idea-delivery`
- pending after merge and devint rollout:
  - rerun the same smoke from merged `main`

## Follow-Up

- complete the remaining ART children only after the branch is reviewed,
  merged, rolled into devint, and a finalized Review Packet or equivalent
  durable evidence covers the source-backed work.
