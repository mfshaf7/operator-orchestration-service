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

# 2026-04-19 Internal Idea Evaluation Metadata

## Summary

The broker now supports an internal evaluation-metadata write path for idea
records. It stores workspace-vocabulary owner and scope suggestions plus full
free-text notes on the canonical OpenProject record without exposing a new
Telegram write command or changing lifecycle status.

## Classification

- owner repo: `operator-orchestration-service`
- related control planes:
  - `workspace-governance`
  - `platform-engineering`
  - `openclaw-telegram-enhanced`
  - `security-architecture`
- trust-boundary areas:
  - runtime
  - ai

## Ownership

- internal evaluation contract and token validation:
  `operator-orchestration-service`
- canonical workspace vocabulary source:
  `workspace-governance`
- OpenProject backlog field model:
  `platform-engineering`
- Telegram readback rendering:
  `openclaw-telegram-enhanced`
- security review authority:
  `security-architecture`

## Root Cause

The backlog model already had fields such as `Suspected Owner` and `Affected
Scope`, but the broker did not yet populate them or preserve a full AI-written
evaluation note. That left no durable internal space for later AI-assisted
owner and scope analysis, even though the canonical record model was already
close to supporting it.

## Source Changes

- added `POST /v1/ideas/{idea_id}/evaluation` as an internal metadata route
- validated `suspected_owner` and `affected_scope` against workspace-derived
  canonical tokens
- wired the OpenProject client to persist `Suspected Owner`, `Affected Scope`,
  `Trust Boundary Areas`, `Triage Confidence`, `AI Assist Lane`, and free-text
  internal evaluation notes
- extended the read projection so downstream surfaces can render the stored
  metadata
- updated the dev-integration profile to derive token vocab from live
  workspace contracts instead of hardcoded guesses

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
  - recorded evaluation metadata on `idea-37` through the internal broker route
  - confirmed the metadata later through Telegram `/idea show idea-37`

## Follow-Up

- keep the write path internal until AI-assisted owner evaluation semantics are
  formally enabled
- defer `owner-assigned` as a status move until the broker has a reviewed
  evaluation and acceptance flow
