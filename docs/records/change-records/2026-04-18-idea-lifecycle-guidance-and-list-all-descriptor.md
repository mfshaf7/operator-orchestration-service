---
security_evidence:
  review_areas:
    - runtime
    - delivery
  findings:
    - F-007
  risks:
    - R-007
  workstreams:
    - WS-007
---

# 2026-04-18 Idea Lifecycle Guidance And List-All Descriptor

## Summary

The broker now describes the full canonical idea lifecycle and the complete
Telegram command surface, including `/idea list all`, so adapters can explain
status progression without inventing local workflow truth.

## Classification

- owner repo: `operator-orchestration-service`
- related control planes:
  - `openclaw-telegram-enhanced`
  - `platform-engineering`
  - `security-architecture`
- trust-boundary areas:
  - runtime
  - delivery

## Ownership

- workflow semantics and lifecycle truth: `operator-orchestration-service`
- source-surface presentation: `openclaw-telegram-enhanced`
- stage rollout authority: `platform-engineering`
- security review authority: `security-architecture`

## Root Cause

The earlier broker-owned help descriptor still told operators too little about
how ideas progress after capture. Telegram could show current status, but the
canonical workflow contract did not explain the full backlog lifecycle or expose
the richer command set needed by the adapter.

## Source Changes

- added canonical lifecycle status entries with meaning and next-step guidance
- added broker-owned Telegram command descriptors, including `/idea list all`
- updated the intake API contract docs to describe lifecycle guidance and the
  adapter-side list-all stitching model

## Artifact And Deployment Evidence

- broker image build and stage rollout:
  - pending governed rebuild and stage rehearsal through `platform-engineering`

## Live Verification

- `npm test`
- `git diff --check`

## Follow-Up

- rebuild and roll the broker through the governed shared runtime path
- verify broker-owned lifecycle guidance reaches Telegram help on stage
- prove `/idea list all` renders cleanly through the Telegram adapter after
  rollout
