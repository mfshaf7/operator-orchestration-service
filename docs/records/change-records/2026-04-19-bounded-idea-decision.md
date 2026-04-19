---
security_evidence:
  review_areas:
    - runtime
    - ai
  findings:
    - F-007
  risks:
    - R-007
  workstreams:
    - WS-007
---

# 2026-04-19 Bounded Idea Decision

## Summary

The broker now supports the first durable `/idea decide` write path: an
operator can move a triaged idea into `parked`, `accepted`, or `rejected` with
bounded decision notes, while `owner-assigned` and the reserved AI-assisted
discussion path remain deferred.

## Classification

- owner repo: `operator-orchestration-service`
- related control planes:
  - `openclaw-telegram-enhanced`
  - `platform-engineering`
  - `security-architecture`
- trust-boundary areas:
  - runtime
  - ai

## Ownership

- decision workflow contract and OpenProject write semantics:
  `operator-orchestration-service`
- Telegram command rendering and invocation mechanics:
  `openclaw-telegram-enhanced`
- local runtime lane and OpenProject platform integration:
  `platform-engineering`
- security review authority:
  `security-architecture`

## Root Cause

The idea workflow could capture and triage records, but triaged items still had
no first durable outcome path. That left ideas stuck in `triaged` and forced
operators to infer later handling outside the broker-owned workflow.

## Source Changes

- implemented `POST /v1/ideas/{idea_id}/decision`
- constrained the first durable outcome slice to `parked`, `accepted`, and
  `rejected`
- updated the OpenProject adapter to preserve captured text and triage summary
  while writing operator decision notes and moving status
- added the broker-owned `idea-decision` workflow descriptor and updated the
  `idea-command` help surface
- aligned repo docs, contracts, and interface manifest with the bounded
  decision model

## Artifact And Deployment Evidence

- image build and rollout:
  - pending governed rebuild and stage rehearsal through `platform-engineering`

## Live Verification

- `npm test`
- `python3 scripts/validate_governance_docs.py --repo-root .`
- `python3 scripts/validate_change_record_requirement.py --repo-root . --against-ref origin/main`
- `git diff --check`
- local `dev-integration` proof on `idea-workflow`:
  - refreshed the profile with `make devint-up PROFILE=idea-workflow`
  - decided `idea-37` through `/idea decide idea-37 parked <notes>`
  - confirmed the record moved through `/idea list status parked`
  - confirmed the stored decision notes through `/idea show idea-37`

## Follow-Up

- implement `owner-assigned` only after the owner vocabulary is explicit
- keep the reserved AI-assisted `/idea triage discuss <idea-id>` path optional
  and broker-owned when it is later implemented
