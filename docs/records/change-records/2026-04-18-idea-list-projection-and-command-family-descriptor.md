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

# 2026-04-18 Idea List Projection And Command-Family Descriptor

## Summary

The broker now exposes a bounded idea-list projection and a broker-owned
`idea-command` descriptor so source adapters can render the full `/idea`
command family without inventing their own workflow semantics.

## Classification

- owner repo: `operator-orchestration-service`
- related control planes:
  - `openclaw-telegram-enhanced`
  - `platform-engineering`
  - `security-architecture`
- trust-boundary areas:
  - runtime

## Ownership

- idea list/read/write workflow APIs: `operator-orchestration-service`
- Telegram rendering and invocation mechanics: `openclaw-telegram-enhanced`
- stage and prod rollout authority: `platform-engineering`
- security review authority: `security-architecture`

## Root Cause

The earlier broker-owned read work closed single-record lookup, but the
operator surface still lacked a broker-owned way to list recent submitted ideas.
That left Telegram unable to show the current backlog state clearly and pushed
too much operator interpretation onto raw record references.

## Source Changes

- added `GET /v1/ideas` with bounded pagination and status-bearing list items
- added broker audit for idea listing
- added broker-owned `idea-command` workflow descriptor for command-family help
- preserved `idea-capture` as the workflow-specific descriptor for direct API
  consumers

## Artifact And Deployment Evidence

- image build and rollout:
  - pending governed rebuild and stage rehearsal through `platform-engineering`

## Live Verification

- `npm test`
- `git diff --check`

## Follow-Up

- rebuild and roll the broker through the governed shared runtime path
- update Telegram to consume the new command-family descriptor and list/read
  surfaces
- prove `/idea list` and `/idea show <idea-id>` on stage after rollout
