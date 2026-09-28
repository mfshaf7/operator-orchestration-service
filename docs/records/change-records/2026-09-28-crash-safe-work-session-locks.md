---
security_evidence:
  review_areas:
    - runtime
    - delivery
  reviewed_artifacts:
    - src/delivery-art/work-session-store.js
    - test/delivery-art-work-session.test.js
  workstreams:
    - WS-007
  findings: []
  risks: []
  notes: "Lock ownership remains local coordination state and grants no new authority."
---

# Crash-safe work-session locks

## Summary

Work-session locking now uses a mature atomic-directory protocol with heartbeat
and stale-lock recovery, so abrupt host loss cannot expose a new zero-byte lock.

## Classification

- area: Delivery ART work-session coordination
- type: owner-repo reliability maintenance
- runtime impact: changes only local lock acquisition and stale-lock recovery

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: None; closes the accepted crash-safe lock improvement candidate
- related products or components: Delivery ART work sessions

## Root Cause

- immediate failure: power loss left a zero-byte lock that blocked later work
- actual root cause: the exclusive lock path became visible before owner metadata was written
- why it escaped earlier controls: PID-reuse recovery was tested, but interrupted lock initialization was not

## Source Changes

- changed workflow, adapter, or contract: replace hand-rolled exclusive-file locking with `proper-lockfile` atomic directory ownership and bounded stale recovery, fronted by a synchronous same-process reservation so overlapping calls remain fail-fast
- tests or validator added: stale zero-byte recovery, fresh incomplete-lock fail-closed behavior, concurrent recovery exclusion, and repeated same-process alias concurrency proof
- related change records: None

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation: targeted work-session tests, a 30-run alias-concurrency loop, and the repository test suite
- live or dev-integration verification: not required for local coordination behavior
- residual risk: legacy malformed locks younger than five seconds fail closed before bounded recovery

## Follow-Up

- required follow-up: None
- owner: None
- due date or closure condition: None
