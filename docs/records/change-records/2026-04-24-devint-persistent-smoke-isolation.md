---
security_evidence:
  review_areas:
    - runtime
    - delivery
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-04-24 Devint Persistent Smoke Isolation

## Summary

Separated the persistent `accepted-idea-delivery` ART workbench from the
mutating consume/backlink smoke path so shared test traffic no longer writes
into the best current local delivery lane.

## Classification

- owner repo: `operator-orchestration-service`
- related control planes:
  - `platform-engineering`
  - `workspace-governance`
- trust-boundary areas:
  - runtime
  - delivery

## Ownership

- persistent workbench smoke split, companion profile scripts, and broker local
  runtime changes: `operator-orchestration-service`
- shared devint runner enforcement and platform acceptance truth:
  `platform-engineering`
- lifecycle contract and persistent-lane smoke policy:
  `workspace-governance`

## Root Cause

The original `accepted-idea-delivery` smoke flow reused the same persistent
OpenProject and broker lane that the operator now depends on for ongoing local
ART work. That made smoke artifacts land in the same working lane and even leak
real ART scope when cleanup was missed.

## Source Changes

- changed the persistent `accepted-idea-delivery` smoke path to read-only
- moved the original mutating consume/backlink rehearsal into the disposable
  `accepted-idea-delivery-mutation-smoke` companion profile
- parameterized the broker caller id so sibling profiles can keep isolated
  smoke attribution
- updated profile docs and repo guidance to point operators at the correct lane

## Artifact And Deployment Evidence

- no governed artifact or Argo revision is produced by this lane
- local session manifests and promotion reports live under `.dev-integration/`
- the companion disposable profile gets its own namespace, OpenProject release,
  and local state root separate from the persistent workbench

## Live Verification

- `bash -n dev-integration/profiles/accepted-idea-delivery/scripts/common.sh`
- `bash -n dev-integration/profiles/accepted-idea-delivery/scripts/smoke.sh`
- `bash -n dev-integration/profiles/accepted-idea-delivery/scripts/smoke_mutating.sh`
- `bash -n dev-integration/profiles/accepted-idea-delivery-mutation-smoke/scripts/common.sh`
- `bash -n dev-integration/profiles/accepted-idea-delivery-mutation-smoke/scripts/up.sh`
- `bash -n dev-integration/profiles/accepted-idea-delivery-mutation-smoke/scripts/status.sh`
- `bash -n dev-integration/profiles/accepted-idea-delivery-mutation-smoke/scripts/access.sh`
- `bash -n dev-integration/profiles/accepted-idea-delivery-mutation-smoke/scripts/smoke.sh`
- `bash -n dev-integration/profiles/accepted-idea-delivery-mutation-smoke/scripts/down.sh`
- `bash -n dev-integration/profiles/accepted-idea-delivery-mutation-smoke/scripts/reset.sh`
- `bash -n dev-integration/profiles/accepted-idea-delivery-mutation-smoke/scripts/promote-check.sh`
- `npm test`
- `python3 scripts/validate_governance_docs.py --repo-root .`
- `python3 scripts/validate_change_record_requirement.py --repo-root . --against-ref origin/main`

## Follow-Up

- keep the persistent-lane smoke rule aligned with
  `workspace-governance/contracts/developer-integration-policy.yaml`
- keep the shared runner enforcement aligned in `platform-engineering`
- use the disposable companion profile whenever the operator needs mutating
  consume/backlink proof before stage
