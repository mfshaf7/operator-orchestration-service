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

# 2026-04-20 OpenProject safe read retry

## Summary

Generalized recoverable network-error retries across the broker's safe
OpenProject read paths after the accepted-idea-delivery live rehearsal showed
that intermittent `socket hang up` failures were not isolated to one workflow
step.

The earlier hardening passes fixed two real subcases:

- source backlink PATCH committed before the response path dropped
- delivery preflight lookup dropped before delivery creation began

But the next live run still failed on a final broker read projection after the
consume had already succeeded. That showed the remaining issue was broader
instability on safe OpenProject reads rather than one more workflow-specific
bug.

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

The live OpenProject boundary is intermittently returning transport-level
`socket hang up` failures on safe reads. Narrow retries on one consume substep
were not enough because the same failure class later hit other projection and
lookup paths that remain read-only and idempotent.

The durable broker-side control is to retry safe OpenProject reads and safe
form fetches consistently, rather than continuing to special-case individual
workflow steps.

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
- disposable profile proof artifacts:
  - `/home/mfshaf7/projects/.dev-integration/accepted-idea-delivery/mfshaf7/smoke-summary.txt`
  - `/home/mfshaf7/projects/.dev-integration/accepted-idea-delivery/mfshaf7/promotion-report.yaml`

## Live Verification

- `npm test`
- `node --check src/openproject-client.js`
- `python3 scripts/validate_governance_docs.py --repo-root .`
- `python3 scripts/validate_change_record_requirement.py --repo-root . --against-ref origin/main`
- `git diff --check`
- `make devint-reset PROFILE=accepted-idea-delivery EXTRA_ARGS="--repo-path operator-orchestration-service=/home/mfshaf7/projects/operator-orchestration-service"`
- `make devint-up PROFILE=accepted-idea-delivery EXTRA_ARGS="--repo-path operator-orchestration-service=/home/mfshaf7/projects/operator-orchestration-service"`
- `make devint-smoke PROFILE=accepted-idea-delivery EXTRA_ARGS="--repo-path operator-orchestration-service=/home/mfshaf7/projects/operator-orchestration-service"`
- `make devint-promote-check PROFILE=accepted-idea-delivery EXTRA_ARGS="--repo-path operator-orchestration-service=/home/mfshaf7/projects/operator-orchestration-service"`

## Follow-Up

- merge and rebuild the broker image on `main`
- repin the shared runtime digest in `platform-engineering`
- prove the workflow again in the disposable `accepted-idea-delivery`
  dev-integration profile before using the shared runtime for confirmation
- rerun the governed accepted-idea-delivery rehearsal against the live broker
  route only after the cheap-lane proof is green
