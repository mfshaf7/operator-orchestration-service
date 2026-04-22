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

# 2026-04-22 Governed Release Verification Catalogs And Build Metadata

## Summary

This repo now publishes component-owned stage and prod verification catalogs
for `operator-orchestration-service` and emits a durable build metadata artifact
from the broker image workflow.

That gives the platform release authority a reviewed source-side contract for
recording candidate, verification, readiness, and prod verification state
without guessing which checks apply or which source SHA produced a digest.

## Classification

- owner repo: `operator-orchestration-service`
- related control planes:
  - `platform-engineering`
- trust-boundary areas:
  - runtime
  - delivery

## Ownership

- component verification catalogs and source metadata artifact:
  `operator-orchestration-service`
- governed stage/prod release-state objects and platform operator workflow:
  `platform-engineering`

## Why

- `#175` needs the broker to participate in the standardized release-governance
  model as a shared control-plane component
- the platform repo should not invent the component-specific verification
  checks for this service
- stage and prod release truth is weak if the deployed digest cannot be tied
  back to a durable source metadata record

## Root Cause

The broker already produced deployable images, but the release truth for those
images stopped at an ephemeral workflow summary and a later platform-side
digest pin.

That meant the platform release authority had no component-owned source
contract for:

- which checks define broker stage readiness
- which checks define broker prod post-promotion verification
- which immutable source SHA produced the digest being recorded later

## Scope

- added stage verification catalog
- added prod post-promotion verification catalog
- documented the component release-governance role in repo architecture docs
- updated the image workflow to upload a `release-metadata.json` artifact

## Source Changes

- `verification-catalog.yaml`
- `prod-verification-catalog.yaml`
- `docs/architecture/release-governance.md`
- `README.md`
- `.github/workflows/build-image.yaml`

## Artifact And Deployment Evidence

- source change only
- no runtime rollout or digest repin was performed from this repo in this task
- build workflow now publishes `release-metadata.json` as a durable artifact for
  future governed candidate recording

## Live Verification

- `python3 scripts/validate_governance_docs.py --repo-root .`
- `git diff --check`

## Follow-Up

- `platform-engineering` now needs to record and maintain the broker stage and
  prod release-state objects against these catalogs
- later automation for broker candidate recording and readiness approval should
  keep using component-owned metadata instead of platform-side inference

## Security Evidence

```yaml
security_evidence:
  review_areas:
    - runtime
    - delivery
  reviewed_artifacts:
    - verification-catalog.yaml
    - prod-verification-catalog.yaml
    - docs/architecture/release-governance.md
    - .github/workflows/build-image.yaml
  notes: "Shared control-plane release checks now stay component-owned while platform-engineering remains the release authority."
```
