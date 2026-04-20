---
security_evidence:
  review_areas:
    - delivery
    - runtime
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-04-20 accepted-idea delivery lookup retry

## Summary

Hardened the broker accepted-idea consume path again by retrying the safe
preflight delivery lookup when the OpenProject list query drops with a
recoverable network error.

This follows the second live rehearsal after backlink recovery landed:

- one fresh consume run succeeded end to end
- a later fresh run failed before delivery creation
- the failing step was the idempotency preflight lookup against the delivery
  ART project by `origin_idea_ref`

Because that lookup is read-only, retrying it is the correct bounded recovery.

## Classification

- owner repo: `operator-orchestration-service`
- related control planes:
  - `operator-orchestration-service`
  - `platform-engineering`
- trust-boundary areas:
  - delivery
  - runtime

## Ownership

- broker source fix owner: `operator-orchestration-service`
- shared runtime digest pin owner: `platform-engineering`
- governed runtime rehearsal owner: `platform-engineering`

## Root Cause

The live OpenProject boundary is still intermittently returning
`socket hang up` for some read requests. After backlink recovery was added, a
different safe request remained exposed: the delivery-project lookup that
checks whether a record already exists for the proposal before creating a new
delivery initiative.

That lookup is a read-only idempotency guard, so a bounded retry is safe and
prevents false consume failures before the create step even begins.

## Source Changes

- [src/openproject-client.js](../../src/openproject-client.js)
- [test/openproject-client.test.js](../../test/openproject-client.test.js)

## Artifact And Deployment Evidence

- source branch fix commit:
  - pending until this branch lands
- rebuilt broker image:
  - pending after merge to `main`
- shared runtime digest repin:
  - pending in `platform-engineering`

## Live Verification

- `npm test`
- `node --check src/openproject-client.js`
- `python3 scripts/validate_governance_docs.py --repo-root .`
- `python3 scripts/validate_change_record_requirement.py --repo-root . --against-ref origin/main`
- `git diff --check`

## Follow-Up

- merge and rebuild the broker image on `main`
- repin the shared runtime digest in `platform-engineering`
- rerun the governed accepted-idea delivery rehearsal against the live broker
  route and record final evidence in `platform-engineering`
