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

# 2026-04-19 Operator-Authored Idea Triage

## Summary

The broker now supports the first durable `/idea triage` write path: an
operator can move a captured idea into `triaged` with a bounded summary from
Telegram alone, while the future AI-assisted `/idea triage discuss <idea-id>`
path remains explicitly reserved and unimplemented.

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

- triage workflow contract and OpenProject write semantics:
  `operator-orchestration-service`
- Telegram command rendering and invocation mechanics:
  `openclaw-telegram-enhanced`
- local runtime lane and OpenProject platform integration:
  `platform-engineering`
- security review authority:
  `security-architecture`

## Root Cause

The initial idea workflow could capture, list, and read records, but it had no
durable phone-friendly triage step. That left operators stuck in `captured`
unless they switched into OpenProject directly or waited for a future AI-first
workflow that would have made desktop Codex access a prerequisite.

## Source Changes

- implemented `POST /v1/ideas/{idea_id}/triage`
- added broker config and dev-integration wiring for `OPENPROJECT_TRIAGED_STATUS_ID`
- updated the OpenProject adapter to rewrite the canonical description and move
  the work package into `triaged`
- added the broker-owned `idea-triage` workflow descriptor and updated the
  `idea-command` help surface
- aligned repo docs, contracts, and interface manifest with the
  operator-authored triage model

## Artifact And Deployment Evidence

- image build and rollout:
  - pending governed rebuild and stage rehearsal through `platform-engineering`

## Live Verification

- `npm test`
- `python3 scripts/validate_governance_docs.py --repo-root .`
- `git diff --check`
- local `dev-integration` proof on `idea-workflow`:
  - refreshed the profile with `make devint-up PROFILE=idea-workflow`
  - confirmed captured backlog items through `/idea list status captured`
  - triaged `idea-37` through `/idea triage idea-37 <summary>`
  - confirmed the record moved through `/idea list status triaged`
  - confirmed the stored summary through `/idea show idea-37`

## Follow-Up

- implement the later `decision` workflow so triaged items can move into
  `parked`, `owner-assigned`, `accepted`, or `rejected`
- add the reserved AI-assisted discussion path only as an optional broker-owned
  extension, not as a prerequisite for triage
