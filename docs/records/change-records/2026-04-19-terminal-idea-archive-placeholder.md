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

# 2026-04-19 Terminal Idea Archive Placeholder

## Summary

The idea-workflow contract now reserves archival as a future visibility flag
for terminal records only. It does not add a new lifecycle stage, Telegram
command, broker endpoint, or list behavior.

## Classification

- owner repo: `operator-orchestration-service`
- related control planes:
  - `platform-engineering`
- trust-boundary areas:
  - runtime

## Ownership

- broker workflow-contract reservation: `operator-orchestration-service`
- canonical backlog semantics: `platform-engineering/products/openproject`

## Root Cause

The backlog will grow quickly, and the current terminal states already support
traceability without active workflow use. The contract needed an explicit place
to reserve future archival behavior without prematurely adding runtime or
operator-surface semantics.

## Source Changes

- documented archival as a future visibility-only flag rather than a workflow
  stage
- limited future archive eligibility to `rejected`, `implemented`, and
  `superseded`
- explicitly kept `captured`, `triaged`, `parked`, `owner-assigned`, and
  `accepted` out of archive eligibility
- deferred any broker endpoint, response field, or Telegram behavior

## Artifact And Deployment Evidence

- none; reserved contract only

## Live Verification

- `python3 scripts/validate_governance_docs.py --repo-root .`
- `python3 scripts/validate_change_record_requirement.py --repo-root . --against-ref origin/main`
- `git diff --check`

## Follow-Up

- add archive behavior only after terminal-record noise becomes a repeated
  operator problem
- keep archive orthogonal to lifecycle when it is eventually implemented
