# 2026-05-06 Accepted Idea Delivery Contract Drift

## Summary

Fixed accepted-idea delivery consume drift so repeated consume calls read the
linked delivery Epic and return confirmed delivery metadata instead of
synthesizing null delivery state.

## Classification

- area: accepted-idea delivery broker and OpenProject adapter
- type: workflow contract and backend adapter correction
- runtime impact: dev-integration broker behavior changed after rollout

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Workspace Delivery ART #650, #653, #654
- related products or components: OpenProject Workspace Delivery ART, OOS accepted-idea delivery workflow

## Root Cause

- immediate failure: the consume response contract did not allow intentionally blank `target_pi`, and repeated consume could return null delivery status/target/owner metadata.
- actual root cause: the broker reused the source backlink as a synthetic delivery record instead of reading the linked delivery Epic and mapping owner metadata through the delivery form schema.
- why it escaped earlier controls: earlier tests covered first-create behavior but not idempotent consume after the source idea already had a delivery backlink.

## Source Changes

- changed workflow, adapter, or contract: `POST /v1/ideas/{idea_id}/consume` response docs/schema now allow nullable `target_pi` and include `owner_repo`.
- tests or validator added: API contract, HTTP, service, and OpenProject adapter regression tests cover null target PI, owner repo echo, and linked-delivery metadata reuse.
- related change records: `2026-04-20-accepted-idea-delivery-consume-implementation.md`, `2026-04-25-art-probe-nullable-response-contracts.md`, `2026-04-25-initiative-owner-repo-parity.md`

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source branch `art-650-90-contract-alignment`; dev-integration OOS rollout completed after the source change was mounted.
- image tag or digest: None
- runtime revision: local dev-integration branch state for `operator-orchestration-service`

## Live Verification

- local validation: `npm test`; `npm run validate:api-docs`; `npm run validate:openproject-mutation-contracts`; `npm run validate:governance-docs`
- live or dev-integration verification: `npm run api:probe -- POST /v1/ideas/idea-649/consume --body-file .art/payloads/idea-649-consume-reprobe.json --show-body` passed and returned `owner_repo=operator-orchestration-service`, `target_pi=PI-2026-03`, and `delivery_created=false`.
- residual risk: no governed stage/prod OpenProject lane exists for this workflow yet; evidence is dev-integration and source validation.

## Follow-Up

- required follow-up: continue ART #650 optimized packet and landing-unit automation work so future consume/evidence checks are read from compact packets.
- owner: `operator-orchestration-service`
- due date or closure condition: close the remaining #650 OOS implementation children.
