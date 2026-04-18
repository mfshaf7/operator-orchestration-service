# 2026-04-18 Phase-1 Capture Service Skeleton

## Summary

- change class: first executable broker runtime skeleton
- user-facing impact: none yet
- operator-facing impact: added real health, readiness, version, and capture endpoints plus OpenProject adapter and stdout audit events

## Classification

- owner repo: `operator-orchestration-service`
- related control planes:
  - `platform-engineering`
  - `security-architecture`
- trust-boundary areas:
  - identity
  - secrets
  - runtime

## Ownership

- runtime implementation: `operator-orchestration-service`
- runtime admission and secret delivery: `platform-engineering`
- security review authority: `security-architecture`

## Root Cause

The repo needed a real executable service boundary before Telegram wiring or
runtime admission could be reviewed honestly. Design-only contracts were no
longer enough.

## Source Changes

- added a capture-first HTTP runtime
- added config loading for caller auth and OpenProject contract mapping
- added an OpenProject adapter for project-scoped work package creation
- added structured audit emission for capture requests and backend writes
- added repo-local tests for payload shaping, auth enforcement, and HTTP behavior

## Artifact And Deployment Evidence

- build workflow:
  - not present at this phase
- deployment state:
  - not admitted at this phase
- artifact evidence:
  - none; the runtime remained local-only pending admission

## Live Verification

- repo-local validation:
  - `npm test`
  - `git diff --check`
- live verification:
  - none; runtime admission and Vault-delivered secret wiring were still deferred

## Follow-Up

- admit the repo and component into active workspace inventory
- add Docker/image build and deployment artifacts
- wire the runtime into shared platform delivery and stage Telegram capture
