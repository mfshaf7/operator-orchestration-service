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

# 2026-04-25 Accepted Idea Delivery Roadmap Projection Healer

## Summary

The persistent `accepted-idea-delivery` devint lane now keeps the OpenProject
roadmap projection healed automatically instead of relying on a manual delivery
view sync after ART changes.

## Classification

- owner repo: `operator-orchestration-service`
- related control planes:
  - `platform-engineering`
- trust-boundary areas:
  - runtime
  - delivery

## Ownership

- canonical delivery-art view projection logic and quality policy:
  `platform-engineering`
- persistent devint runtime reconciler and profile lifecycle wiring:
  `operator-orchestration-service`

## Root Cause

Even after the canonical OpenProject delivery-art sync learned how to project
ART `Target PI` into roadmap-compatible versions, the persistent devint lane
still depended on an operator manually running that sync whenever ART work
changed. That left the primary local planning UI free to drift stale again.
An attempted in-cluster CronJob proved to be the wrong model for this local
persistent lane because the runtime already depends on host-mounted repos and
direct `k3s kubectl` access.

## Source Changes

- added a host-side reconciler loop for the persistent
  `accepted-idea-delivery` profile
- configured the profile `up` path to start that minute-level loop after the
  broker and OpenProject runtime are ready
- configured the profile `down` path to stop the loop so a paused lane does
  not keep mutating OpenProject in the background
- updated profile docs and contract-facing broker docs to explain that roadmap
  is a derived projection, including the explicit backlog bucket

## Artifact And Deployment Evidence

- no governed stage/prod artifact is produced by this local lane
- the reconciler runs from the local operator host and uses direct
  `k3s kubectl` access into the persistent devint namespace
- `make devint-up PROFILE=accepted-idea-delivery` recreates the runtime and
  starts the loop

## Live Verification

- `bash -n dev-integration/profiles/accepted-idea-delivery/scripts/common.sh`
- `bash -n dev-integration/profiles/accepted-idea-delivery/scripts/up.sh`
- `bash -n dev-integration/profiles/accepted-idea-delivery/scripts/down.sh`
- `bash -n dev-integration/profiles/accepted-idea-delivery/scripts/status.sh`
- `bash -n dev-integration/profiles/accepted-idea-delivery/scripts/reconcile_delivery_art_views.sh`
- `bash -n dev-integration/profiles/accepted-idea-delivery/scripts/reconcile_delivery_art_views_loop.sh`
- `npm test`
- `npm run validate:governance-docs`
- `python3 scripts/validate_change_record_requirement.py --repo-root . --against-ref origin/main`

## Follow-Up

- keep the reconciler aligned with the canonical platform-owned
  `openproject_sync_delivery_art_views_runner.rb`
- keep the profile docs honest about the backlog-bucket projection so operators
  know why the roadmap can show work that is not yet committed to a PI
