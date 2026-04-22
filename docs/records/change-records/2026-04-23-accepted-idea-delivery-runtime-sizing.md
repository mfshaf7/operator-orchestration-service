---
security_evidence:
  review_areas:
    - runtime
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-04-23 accepted-idea-delivery runtime sizing

## Summary

Bounded the local `accepted-idea-delivery` OpenProject runtime to one Puma web
worker and a GoodJob `maxThreads` value of `10`, and fixed the profile runner
to copy the delivery-art support files that the OpenProject seed scripts now
require. The active dev-integration lane now uses materially less memory while
still completing the real broker-to-OpenProject consume bootstrap flow.

## Classification

- owner repo: `operator-orchestration-service`
- related control planes:
  - `platform-engineering`
  - `security-architecture`
- trust-boundary areas:
  - runtime

## Ownership

- concrete profile contract and runtime bootstrap: `operator-orchestration-service`
- shared local-k3s runner plus OpenProject seed runners: `platform-engineering`
- profile-local security review authority: `security-architecture`

## Root Cause

The local OpenProject app tier was the largest remaining intentional memory
consumer after stale prod OpenProject and observability were released.

The profile also carried a latent bootstrap defect: the delivery-art runner and
view-sync runner had picked up helper-module dependencies in
`platform-engineering`, but the profile `up.sh` script still copied only the
top-level runner files into the OpenProject pod.

## Source Changes

- changed the rendered Helm values in
  [dev-integration/profiles/accepted-idea-delivery/scripts/up.sh](../../../dev-integration/profiles/accepted-idea-delivery/scripts/up.sh)
  so the local OpenProject release now sets:
  - `OPENPROJECT_WEB__WORKERS=1`
  - `workers.default.maxThreads=10`
- copied `openproject_delivery_art_home_support.rb` and
  `openproject_delivery_art_custom_field_support.rb` into the OpenProject pod
  before running the delivery-art bootstrap and view-sync runners
- updated the profile README to describe that bounded OpenProject runtime shape
- trust-boundary impact is limited to runtime posture; the profile still uses
  the same local-only identity, broker caller-auth seam, and OpenProject token
  custody model

## Artifact And Deployment Evidence

- no governed artifact or Argo revision is produced by this lane
- the live devint session was reconciled through:
  - `make -C /home/mfshaf7/projects/platform-engineering devint-up PROFILE=accepted-idea-delivery`
- local session manifests and promotion reports remain under `.dev-integration/`

## Live Verification

- `bash -n dev-integration/profiles/accepted-idea-delivery/scripts/up.sh`
- live proof in the existing devint OpenProject pods:
  - `OPENPROJECT_WEB__WORKERS=1 bundle exec rails runner "puts OpenProject::Configuration.web_workers"` returned `1`
  - `bundle exec rails runner "puts %{good_job_max_threads=#{GoodJob.configuration.max_threads}}"` returned `good_job_max_threads=10`

## Follow-Up

- keep the devint OpenProject runtime sizing aligned with the platform-managed
  OpenProject contract when future throughput tuning changes land
- if the platform seed runners add more helper-module dependencies later, copy
  those support files into the pod in the same change instead of rediscovering
  the missing-file failure during `devint-up`
