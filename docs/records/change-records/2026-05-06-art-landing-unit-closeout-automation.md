---
security_evidence:
  review_areas:
    - delivery
    - runtime
    - ai
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-05-06 ART Landing-Unit Closeout Automation

## Summary

Added broker-owned local ART CLI automation for finalized Review Packet landing
units: operators can inspect status, dry-run the closeout plan, and submit child
completion plus eligible parent stale-open closeout without rebuilding payloads
by hand.

## Classification

- area: Workspace Delivery ART operator workflow
- type: workflow automation and token-burn reduction
- runtime impact: local dev-integration ART CLI invokes existing broker routes
  for completion and stale-open closeout

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: `#660`, `#661`, `#662`, `#663` under delivery `#650`
- related products or components: Workspace Delivery ART, WGCF readiness,
  OpenProject delivery broker

## Root Cause

- immediate failure: operators still had to manually reread child state, hand
  build completion payloads, complete children one by one, then reread parent
  state to decide stale-open closeout.
- actual root cause: Review Packet finalization proved source evidence, but no
  command consumed finalized packet coverage as an executable landing-unit
  closeout plan.
- why it escaped earlier controls: Review Packet readiness/finalization guarded
  source landing quality, not the repetitive operator closeout sequence after
  merge.

## Source Changes

- changed workflow, adapter, or contract: added `npm run art -- landing-unit
  status|dry-run|submit <packet.json>` to the local ART CLI and documented the
  operator contract.
- OpenProject form contract evidence: this change does not add or alter
  OpenProject `allowedValues`, `form schema`, `PropertyIsReadOnly`, writable
  fields, read-only fields, `version_field_read_only`, or
  `roadmap_version_projection` semantics; it reuses existing broker completion
  and stale-open closeout routes.
- tests or validator added: added ART CLI tests for dry-run planning and submit
  sequencing from finalized Review Packet coverage.
- related change records:
  - `2026-05-06-art-optimized-context-packets.md`

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only pending PR and
  ART Review Packet evidence for delivery `#650`.
- image tag or digest: None.
- runtime revision: None.

## Live Verification

- local validation: pending in the #650 landing unit.
- live or dev-integration verification: pending until the command is dogfooded
  on #661/#662/#663 closeout.
- residual risk: parent closeout still depends on live broker evidence refresh;
  if the parent has uncovered open children, the command must skip parent
  closeout instead of guessing.

## Follow-Up

- required follow-up: dogfood `landing-unit dry-run` and `landing-unit submit`
  for the #660 landing unit, then complete #661/#662/#663/#660 with finalized
  Review Packet evidence.
- owner: `operator-orchestration-service`
- due date or closure condition: before closing delivery `#650`.
