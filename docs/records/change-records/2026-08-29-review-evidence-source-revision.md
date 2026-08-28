---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - src/delivery-art/review-evidence.js
    - test/delivery-art-review-evidence.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "Security decision #805 already requires exact source base and head provenance. This correction prevents prior-head result evidence from being automatically relabeled as current without adding authority or a new trust path."
---

# Review Evidence Source Revision Binding

## Summary

- Date: 2026-08-29
- Owner repo: `operator-orchestration-service`
- ART item: `#1034`
- Security authority: `openproject://work_packages/805`

Corrected Review Packet evidence projection so a result already bound to one
source revision cannot be silently relabeled as proof of a newer revision.

## Classification

- area: Delivery review evidence
- type: source-provenance integrity correction
- runtime impact: Review Packet authoring stops on stale result evidence and
  requires exact current-head evidence before merge readiness
- trust-boundary impact: none; this enforces the already approved exact-source
  provenance boundary

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Defect `#1034` under Feature `#910` and Epic `#886`
- blocked consumer work: Governance Operations Console User story `#1032`
- existing Security authority: `openproject://work_packages/805`

## Root Cause

`resultEntries` retained prior test, validation, runtime, and security results
but replaced every non-applicable entry's `source_revisions` with the current
Landing Unit head. A source change could therefore make old evidence appear
current while its summary and artifact digest still described the prior head.

The defect was proven during the same-Landing-Unit recovery for Console work
item `#1032`: old PR `#10` validation was projected onto follow-up PR `#11`.
The Console PR remained open and was not merged from that invalid packet.

## Source Changes

- preserve non-empty result source bindings during projection
- bind only first-authored, unbound result evidence to the current head
- emit `evidence_source_revision_stale` for every prior-head result
- cover first authoring, unchanged projection, and changed-source rejection
  with focused tests

## Validation

- `node --test test/delivery-art-review-evidence.test.js`
- `node --test test/delivery-art-lifecycle-controller.test.js`
- `node --test test/delivery-art-work-session.test.js`
- full OOS validation before merge
- Console `#1032` negative replay before exact PR `#11` evidence replacement

## Security Alignment

The Delivery ART Evidence Custody And Source Provenance security decision at
`openproject://work_packages/805` requires exact source base and head
provenance. This correction narrows implementation to that accepted invariant;
it adds no identity, credential, privilege, storage, or deployment authority.

## Artifact And Deployment Evidence

- source commit: pending reviewed pull-request head
- runtime revision: pending exact merged OOS revision
- Review Packet proof: pending exact-head #1034 packet

## Live Verification

- activate the exact merged OOS revision in the `refinement-catalog`
  composition
- replay the stale #1032 evidence document and prove projection remains blocked
- replace #1032 evidence with exact PR #11 proof and complete its normal
  Review Packet lifecycle

## Follow-Up

- merge and activate this correction before merging Console PR #11
- retain the existing source-provenance Security decision; no new acceptance is
  required unless the evidence or authority boundary expands

## Rollback

Reverting this Landing Unit restores automatic source-revision replacement and
must therefore also restore a fail-closed external guard before Review Packet
authoring. No runtime data migration is required.
