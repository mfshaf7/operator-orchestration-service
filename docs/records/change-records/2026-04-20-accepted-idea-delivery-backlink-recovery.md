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

# 2026-04-20 accepted-idea delivery backlink recovery

## Summary

Hardened the broker accepted-idea consume path so a transport-level network
error during the source backlink PATCH no longer forces a false failure when
OpenProject has already committed the desired `delivery_ref`.

This follows the live accepted-idea delivery rehearsal after the socket-reset
transport repin:

- the delivery ART record was created successfully
- the source proposal backlink write committed in OpenProject
- the broker still returned `backend_unavailable` because the PATCH response
  path ended with `socket hang up`

The durable fix is a read-after-error recovery path for `setIdeaDeliveryRef()`.
If the PATCH fails with a recoverable network error, the broker immediately
reads the source work package back and accepts the operation when the desired
`delivery_ref` is already present.

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

The accepted-idea consume path is now idempotent at the OpenProject boundary,
but the broker previously treated the source backlink PATCH as all-or-nothing.

In the live runtime, OpenProject could commit the `delivery_ref` change and
still terminate the response path with a transport-level `socket hang up`.
That left the durable state correct while the broker reported a failed consume
operation.

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
