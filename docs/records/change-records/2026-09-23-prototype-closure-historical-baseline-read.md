---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - src/prototype-closure/baseline-owner-reader.js
    - src/prototype-closure/source-client.js
  workstreams:
    - WS-007
  notes: "Limits pre-Closure source access to read-only baseline registry evidence already bound by the durable Maturity receipt."
---

# Prototype Closure Historical Baseline Read

## Summary

ART #1151 found that a valid accepted baseline receipt can predate the commit
that introduced Prototype Closure. The baseline owner reader now verifies that
historical `prototypes.yaml` record without treating the later Closure feature
bootstrap as a prerequisite for the earlier baseline.

## Classification

- area: Prototype Closure baseline evidence
- type: owner-readback compatibility correction
- runtime impact: active `dev-integration` Closure evaluation only

## Ownership

- owner: `operator-orchestration-service`
- work: source-backed #1151 under Feature #921 and Epic #892
- dependencies: the accepted Prototype Maturity receipt and committed Studio history

## Root Cause

The shared source sandbox applied Closure's minimum implementation commit to
every read. That is correct for Closure execution, but not for owner-backed
verification of a baseline receipt created before Closure existed.

## Source Changes

- Adds a baseline-only historical registry reader.
- Keeps the existing minimum revision check on current snapshots and mutation
  paths.
- Routes the baseline owner reader through the narrower API.

## Security Boundary

The historical path accepts only an exact 40-character revision that is an
ancestor of Studio `origin/main`, then reads one Prototype record from
`prototypes.yaml`. It cannot execute Closure source tooling, prepare a branch,
write Studio source, or bypass the accepted Maturity receipt checks. Current
Closure snapshots and every mutation path continue to require the Closure
authority minimum revision.

## Validation

- `node --test test/prototype-closure-source.test.js test/prototype-maturity-service.test.js`
- regression coverage proves the historical read succeeds while the same
  pre-Closure revision remains rejected by the mutation-capable reader

## Artifact And Deployment Evidence

- source: OOS PR for ART #1151
- deployment: the normal OOS image build and controlled `dev-integration`
  rollout after merge

## Live Verification

Retry the retained Console Closure request and require WGCF to resolve its
accepted baseline receipt through OOS before the request advances.

## Rollback

Revert this change to restore the stricter minimum on baseline reads. That
rollback makes baselines accepted before the Closure bootstrap unavailable to
Closure, but does not mutate source or existing receipts.

## Follow-Up

Complete the remaining #1151 Closure actions and negative case through the
configured Console path.
