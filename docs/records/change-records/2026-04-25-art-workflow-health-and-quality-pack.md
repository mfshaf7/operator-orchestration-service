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

# 2026-04-25 ART Workflow Health And Quality Pack

## Summary

Added broker-native ART workflow-health and quality-pack reads so the normal
operator path can inspect roadmap projection health, PM² projection health, and
broker-owned quality state without falling back to direct OpenProject Rails
query.

## Classification

- area: delivery workflow
- type: operator-surface hardening
- runtime impact: bounded broker read-path expansion in the normal ART workflow

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice:
  - `#304` `Establish seamless broker-owned ART workflow and zero-Rails normal operator path`
  - `#313` `Surface workflow health and roadmap or PM2 projection drift through broker and compatible OpenProject views`
  - `#314` `Separate OpenProject platform-admin control from normal ART operator flow and eliminate direct Rails from normal quality-readiness execution`

## Root Cause

The broker already owned the normal ART read and write surface, but there was
still no first-class session health read for roadmap and PM² compatibility, and
the platform quality wrapper still depended on a Rails-backed OpenProject dump.
That left the broker contract directionally right while the real operator path
still depended on admin-only internals for normal quality and readiness reads.

## Source Changes

- added broker-native session reads for:
  - `GET /v1/delivery-session/workflow-health`
  - `GET /v1/delivery-session/quality-pack`
- added delivery-service projections and app handlers for those new reads
- updated the ART CLI, operator docs, and OpenAPI to expose the new session
  health path
- fixed the quality-pack wrapper bug so the live route returns the actual
  `quality_pack` payload instead of only the top-level project envelope

## Artifact And Deployment Evidence

- local broker code and contract update only
- devint broker restarted from the working branch so the new session health and
  quality-pack routes were exercised live before closeout

## Live Verification

- `npm test`
- `npm run validate:api-docs`
- `npm run validate:governance-docs`
- live `npm run art -- workflow-health`
- live broker `GET /v1/delivery-session/quality-pack` returns:
  - `quality_pack.compatible_views`
  - `quality_pack.projection_health`
  - `quality_pack.summary`
  - `quality_pack.work_packages`

## Follow-Up

- keep the platform quality wrapper on the broker-native quality-pack path
  instead of reintroducing a direct Rails dump for normal ART sessions
- continue using the platform-admin surface only for board, projection, and
  runtime repair rather than normal broker-led ART reads
