---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - src/app.js
    - src/art-cli.js
    - src/delivery-art/agent-source-identity.js
    - src/delivery-art/source-executor.js
    - src/delivery-art/work-session-cli-adapters.js
    - src/delivery-art/work-session-controller.js
    - src/delivery-art/work-session-service.js
    - contracts/delivery-art-work-session/agent-source-identity.json
  findings: []
  risks: []
  notes: "Configured-path preflight is read-only, and work start reuses the same fail-closed evaluation before creating source resources."
---

# Configured-Path Preflight

## Summary

Delivery work sessions now expose one read-only configured-path preflight and
reuse that evaluation in `work start`, so missing or stale prerequisites return
one deterministic blocker before session, branch, worktree, credential, or
source-resource creation.

## Classification

- area: Delivery ART work-session admission and source identity
- type: workflow contract and runtime control
- runtime impact: adds a read-only API and CLI projection; existing active
  sessions retain their current status behavior

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Epic #1154, Feature #1158, work item #1163
- related components: Delivery ART work sessions, source executor, Agent Gary
  identity projection, API, and CLI

## Root Cause

- immediate failure: operators could not inspect the complete configured path
  before invoking work start
- actual root cause: prerequisite evaluation and source-start behavior were
  coupled instead of sharing one read-only evaluator
- why it escaped earlier controls: existing tests proved individual start
  outcomes but did not require a complete pre-start projection or verify that
  every blocked result left source resources absent

## Source Changes

- changed workflow, adapter, or contract: adds the work-session preflight API,
  CLI, source-executor inspection action, deterministic blocker projection, and
  shared start evaluator
- tests or validator added: positive and negative preflight, start reuse,
  identity, API, CLI, and real-Git adapter coverage
- related change records: None

## Artifact And Deployment Evidence

- source-only change: pull request #230
- image tag or digest: None
- runtime revision: pending merge

## Live Verification

- local validation: 1,092 tests completed with 1,090 passing, zero failures,
  and two intentional skips; API, governance-doc, change-record, OpenProject
  mutation-contract, and patch-integrity validation passed
- live or dev-integration verification: Agent Gary published the exact
  `bce204f889d6cebfabcc4dd7d1e0a6dbd3b8d25f` head to pull request #230 through
  the admitted work-session path
- residual risk: no stage or production authority is introduced; live Console
  adoption remains in later Epic #1154 scope

## Follow-Up

- required follow-up: continue Feature #1158 through exact-head review, merge,
  finalized Review Packet custody, and ART closeout
- owner: Delivery ART operator
- closure condition: work item #1163 and Feature #1158 are closed with durable
  terminal evidence

## Rollback

Revert the preflight route, CLI command, shared evaluator, and source-executor
inspection action together. Existing work-session and Review Packet artifacts
remain authoritative and are not rewritten.
