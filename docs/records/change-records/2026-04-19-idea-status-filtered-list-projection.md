---
security_evidence:
  review_areas:
    - runtime
  findings:
    - F-007
  risks:
    - R-007
  workstreams:
    - WS-007
---

# 2026-04-19 Idea Status-Filtered List Projection

## Summary

The broker now exposes canonical status-filtered list semantics for the `/idea`
command family so source adapters can focus on one lifecycle state without
inventing Telegram-local backlog filtering.

## Classification

- owner repo: `operator-orchestration-service`
- related control planes:
  - `openclaw-telegram-enhanced`
  - `platform-engineering`
  - `security-architecture`
- trust-boundary areas:
  - runtime

## Ownership

- idea list and status-filter workflow semantics: `operator-orchestration-service`
- Telegram rendering and invocation mechanics: `openclaw-telegram-enhanced`
- stage and prod rollout authority: `platform-engineering`
- security review authority: `security-architecture`

## Root Cause

The broker-owned `/idea` surface could list recent records or the full backlog,
but it could not focus the operator on one lifecycle state. That pushed
operators to scan mixed-status lists even when the workflow question was narrow,
such as "what is still captured?" or "what is currently parked?".

## Source Changes

- extended `GET /v1/ideas` to accept an optional canonical `status` filter
- made the broker validate status filters against the canonical lifecycle model
- kept status-filter semantics in the broker instead of moving them into the
  Telegram adapter
- updated the broker-owned `idea-command` descriptor and intake contract to
  advertise the new filtered list surfaces
- corrected the runtime-shape doc so `GET /v1/ideas` remains part of the
  documented phase-1 endpoint set

## Artifact And Deployment Evidence

- image build and rollout:
  - pending governed rebuild and stage rehearsal through `platform-engineering`

## Live Verification

- `npm test`
- `git diff --check`

## Follow-Up

- update Telegram to consume the new broker-owned filtered list surfaces
- rebuild and roll the broker through the governed shared runtime path
- prove `/idea list status <status>` and `/idea list all status <status>` on
  stage after rollout
