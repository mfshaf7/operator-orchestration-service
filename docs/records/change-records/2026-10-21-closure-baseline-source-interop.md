---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - src/prototype-closure/source-client.js
    - src/prototype-closure/baseline-owner-reader.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: Existing composed acceptance must bind the actual merged adapter source before commissioning.
---

# 2026-10-21 Closure historical Baseline source interoperability

## Summary

Use Maturity's existing UTF-8 record digest when Closure verifies a historical
Baseline receipt. Preserve Closure's own ASCII source and history digests,
immutable receipt validation, exact source ancestry and owner binding.

## Classification

- area: Prototype Closure accepted Baseline owner readback
- type: source-behavior maintenance under the approved qualification exercise
- runtime impact: exact-composition acceptance and activation required

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: qualification story1298 in Epic1275; no new repair item
- related products or components: Studio Maturity, WGCF Closure, Console

## Root Cause

- immediate failure: an intact accepted Unicode Baseline receipt could not be
  resolved by WGCF through the native Closure owner reader
- actual root cause: the historical Baseline bridge reused Closure's ASCII
  digest instead of the Maturity producer's UTF-8 record digest
- why it escaped earlier controls: the prior Maturity repair did not exercise
  this downstream native reader; ASCII-only fixtures hid the incompatible codec

## Source Changes

- changed workflow, adapter, or contract: historical read only, reusing the
  existing Maturity digest; no schema, receipt, approval or authority change
- tests or validator added: independent Python Unicode record digest, real Git
  historical source through the Baseline owner reader, wrong subject, tampered
  and correctly resealed wrong source digest denials, pre-Closure write denial;
  canonical HTTP subject binding. Optional real-source tests now observe the
  current eligible lifecycle and safely move only their disposable clone's main
  rather than assuming a never-advanced record or absent main branch.
- related change records: native Prototype Delivery packet codec record

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: candidate source; local
  CI-equivalent, native integration and actual CI required before merge
- image tag or digest: None yet
- runtime revision: not activated by this record

## Live Verification

- local validation: targeted regressions reproduced unmodified failures then
  passed; all7 enabled source/HTTP tests pass without skips. Actual immutable
  Maturity receipt and historical Studio source pass the native Baseline reader;
  native OOS HTTP producer is accepted by the corrected Console cold reader.
  Closure current ASCII snapshot remains byte-identical. Full committed local
  CI-equivalent, image proof and actual provider CI are required before merge.
- live or dev-integration verification: original request retained, evaluating
  with retryable dependency failure; no new decision, PR or source event
- residual risk: local conformance is not the retained request's operating proof

## Follow-Up

- required follow-up: exact source review, dependent Security acceptance/index,
  one activation, Console cold recovery and original request continuation
- owner: mfshaf7
- due date or closure condition: before qualification story1298 completes

## Security Evidence

The existing [composed review](https://github.com/mfshaf7/security-architecture/blob/main/docs/reviews/components/2026-10-15-governance-console-platform-operation.md)
must accept the actual merged source. Refresh the generated Security index from
owner main after merge. This record grants no runtime or approval authority.
