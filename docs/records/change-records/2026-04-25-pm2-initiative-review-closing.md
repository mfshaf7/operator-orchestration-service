# 2026-04-25 PM2 Initiative Review Closing Workflow

## Summary

The broker now treats PM² initiative closeout as a governed workflow instead of
a loose board label. `Closing` is now an enforced initiative-review transition,
final initiative `done` requires both initiative-review evidence and clean
execution closeout state, and initiative `retired` is now a separate
fail-closed terminal path rather than an implicit PM²-board blind spot.

## Classification

- area: delivery workflow
- type: control hardening
- runtime impact: bounded broker validation and initiative-summary read-model changes

## Ownership

- owner repo: `operator-orchestration-service`
- related platform contract:
  [`platform-engineering/products/openproject/delivery-art-contract.md`](https://github.com/mfshaf7/platform-engineering/blob/main/products/openproject/delivery-art-contract.md)
- related platform runbook:
  [`platform-engineering/products/openproject/runbooks/review-delivery-initiative.md`](https://github.com/mfshaf7/platform-engineering/blob/main/products/openproject/runbooks/review-delivery-initiative.md)

## Root Cause

The PM² board existed, but `Closing` was only a stored label. The broker had
system-demo and inspect-and-adapt write routes, but no enforced initiative
review transition model tied those fields to PM² phase or final completion.

## Source Changes

- added broker-side initiative-review workflow mirror and evaluation logic in:
  - `src/delivery-initiative-review-workflow.json`
  - `src/delivery-initiative-review.js`
  - `src/openproject-client.js`
- updated operator and contract surfaces:
  - `docs/operations/delivery-workflow-operator-surface.md`
  - `docs/contracts/delivery-workflow-api-v1.md`
  - `docs/api/openapi.json`
  - `docs/api/README.md`
- added regression coverage in `test/openproject-client.test.js`

## Security Evidence

```yaml
security_evidence:
  review_areas:
    - workflow-control
    - delivery-governance
  concerns:
    - initiative closeout must not become a free-form status change
    - initiative review evidence must stay bounded to explicit operator routes
  follow_up:
    - keep future PM² automation aligned to the same bounded broker transition model
```

## Artifact And Deployment Evidence

- local broker code and contract update only
- no image build or runtime promotion in this slice

## Live Verification

- unit and contract validation prove:
  - `Closing` now requires recorded system-demo evidence and clean execution state
  - final initiative `done` now requires `PM² Phase = Closing`
  - final initiative `done` now requires recorded inspect-and-adapt evidence
  - initiative `retired` now fails closed if open descendants would be left behind
  - closeout-readiness reads now distinguish readiness for `Closing`, final readiness for `done`, and terminal readiness for `retired`

## Follow-Up

- backfill existing ART initiatives through the governed review workflow so the PM² board becomes truthful
- keep the platform-side ART quality checker aligned to the same initiative-review rules
- keep the managed PM² board in sync so retired initiatives stay visible in the separate terminal lane
