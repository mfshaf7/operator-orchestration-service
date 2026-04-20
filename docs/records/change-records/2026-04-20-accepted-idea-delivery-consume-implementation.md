---
security_evidence:
  review_areas:
    - runtime
    - delivery
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-04-20 Accepted Idea Delivery Consume Implementation

## Summary

The broker now implements the internal accepted-idea consume path. An already
accepted proposal in `Workspace Proposals` can be consumed into the separate
OpenProject delivery ART project through `POST /v1/ideas/{idea_id}/consume`,
with durable backlinks preserved in both directions and idempotent reuse of an
existing delivery record when one already exists.

## Classification

- owner repo: `operator-orchestration-service`
- related control planes:
  - `platform-engineering`
  - `workspace-governance`
  - `security-architecture`
- trust-boundary areas:
  - runtime
  - delivery

## Ownership

- consume workflow contract, internal endpoint, audit, and OpenProject adapter
  logic:
  `operator-orchestration-service`
- canonical OpenProject proposal and delivery project models:
  `platform-engineering`
- profile admission, workspace contract state, and later activation truth:
  `workspace-governance`
- review authority for the widened delivery-facing runtime surface:
  `security-architecture`

## Root Cause

The accepted-idea delivery model existed only as design doctrine. The broker
could move a proposal into `accepted`, but it still had no real internal
handoff that created the linked delivery initiative, preserved backlinks, or
reused an already-created delivery record safely after a partial failure.

## Source Changes

- implemented `POST /v1/ideas/{idea_id}/consume` as an internal broker route
- extended the OpenProject client with delivery-project config, delivery record
  creation, delivery lookup by `origin_idea_ref`, and source backlog backlink
  repair through `delivery_ref`
- extended normalized idea projection so source proposals can expose
  `delivery_ref`
- updated the interface manifest, repo docs, API contracts, and delivery
  workflow notes so the internal consume step is no longer described as
  design-only
- kept the `accepted-idea-delivery` `dev-integration` profile honest as
  `proposed`; the route exists, but profile admission and local-k3s rehearsal
  still remain follow-up work

## Artifact And Deployment Evidence

- image build and rollout:
  - pending governed rebuild and later `dev-integration` activation for the
    `accepted-idea-delivery` profile

## Live Verification

- `npm test`
- `node --check src/app.js`
- `node --check src/config.js`
- `node --check src/idea-service.js`
- `node --check src/openproject-client.js`
- `node --check src/workflow-catalog.js`
- `python3 scripts/validate_governance_docs.py --repo-root .`
- `python3 scripts/validate_change_record_requirement.py --repo-root . --against-ref origin/main`
- `git diff --check`

## Follow-Up

- activate the `accepted-idea-delivery` `dev-integration` profile only after
  the OpenProject delivery runtime, platform seeding, and admission surfaces
  are fully wired
- add concrete security review evidence if the consume workflow is widened past
  the current bounded internal route
