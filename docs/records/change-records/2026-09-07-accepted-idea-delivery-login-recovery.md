# Accepted-Idea Delivery Login Recovery

## Summary

The persistent accepted-idea-delivery profile opts into the shared Platform
operator-login recovery policy so its view reconciler and bounded source
executor are reconstructed after a host or WSL restart.

## Classification

- area: accepted-idea-delivery dev-integration runtime
- type: profile contract and resilience correction
- runtime impact: local dev-integration only; no stage or production authority

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: owner-repo maintenance outside an active initiative
- related products or components: Platform dev-integration runner

## Root Cause

- immediate failure: restart removed the private executor socket directory and
  terminated both declared host services
- actual root cause: the persistent profile had no explicit post-login
  reconstruction policy
- why it escaped earlier controls: existing supervision began only after a
  manual profile `up`

## Source Changes

- changed workflow, adapter, or contract: declare
  `runtime.resume_policy: operator-login`
- tests or validator added: profile contract assertion in the existing
  host-service profile test
- related change records: Platform operator-login recovery change record

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only profile change
- image tag or digest: None
- runtime revision: activated only after both owner changes land and the normal
  profile `up` succeeds

## Live Verification

- local validation: profile contract and shared runner tests
- live or dev-integration verification: simulated volatile-runtime loss and
  user-unit recovery, followed by normal profile status and broker bootstrap
- residual risk: recovery is operator-login scoped and does not run before a
  user session exists

## Follow-Up

- required follow-up: None after the cross-repo recovery rehearsal passes
- owner: `operator-orchestration-service` and `platform-engineering`
- due date or closure condition: both changes merged and live local recovery
  verified
