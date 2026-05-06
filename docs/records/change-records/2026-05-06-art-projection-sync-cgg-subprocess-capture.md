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

# 2026-05-06 ART Projection Sync CGG Subprocess Capture

## Summary

Hardened the ART CLI projection sync path so subprocess stdout/stderr from the
OpenProject view sync and scoped quality check are captured into local artifacts
and packetized through CGG instead of being streamed raw into the operator or
agent context.

## Classification

- area: delivery workflow and context admission
- type: operator-surface control hardening
- runtime impact: local ART CLI behavior change; no OpenProject write
  semantics changed

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: #679
- related products or components: Workspace Delivery ART, CGG

## Root Cause

- immediate failure: `npm run art -- projection sync --pi-names PI-2026-03
  --target-epic-id 251 --quality` streamed verbose Rails/OpenProject subprocess
  output before the compact final ART result.
- actual root cause: the projection sync implementation used a generic
  passthrough child-process helper while the #678 hardening covered broker
  responses and oversized `--json` output.
- why it escaped earlier controls: the projection sync subprocess path was not
  represented as a separate raw-context admission surface in the first default
  packet projection fix.

## Source Changes

- changed workflow, adapter, or contract: `src/art-cli.js` now captures
  projection sync subprocess stdout/stderr into `.art/outputs`, suppresses raw
  stream projection, and attaches CGG packet refs or explicit CGG failure
  metadata.
- tests or validator added: `test/art-cli.test.js` proves projection sync and
  quality subprocess output does not stream raw and is preserved in artifacts
  with CGG packet refs.
- related change records:
  [2026-05-06 ART CGG Default Packet Projection](2026-05-06-art-cgg-default-packet-projection.md)

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-backed CLI and
  operator documentation update.
- image tag or digest: None.
- runtime revision: None.

## Live Verification

- local validation: `node --test test/art-cli.test.js`, `npm test`,
  `npm run validate:api-docs`, `npm run validate:governance-docs`, and
  `npm run validate:openproject-mutation-contracts`.
- live or dev-integration verification: pending dogfood after merge using the
  real projection sync command.
- residual risk: none expected after live dogfood proves subprocess logs are no
  longer raw-streamed.

## Follow-Up

- required follow-up: close #679 with merged source evidence and live dogfood
  projection sync proof.
- owner: `operator-orchestration-service`
- due date or closure condition: #679 is closed with merged source evidence.
