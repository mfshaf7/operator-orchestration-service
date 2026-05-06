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

# 2026-05-06 ART CGG Default Packet Projection

## Summary

Hardened the ART CLI so large broker output no longer depends on the operator
or agent remembering to opt into CGG packet projection. Large compact outputs
now request CGG packet refs by default, and oversized `--json` responses are
stored as artifacts plus CGG packet refs instead of raw-printing into the model
context unless explicitly disabled for local debugging.

## Classification

- area: delivery workflow and context admission
- type: operator-surface control hardening
- runtime impact: source-only CLI behavior change; no OpenProject write
  semantics changed

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: #678
- related products or components: Workspace Delivery ART, CGG, WGCF

## Root Cause

- immediate failure: an oversized ART continuation-context read printed raw JSON
  because the command was not run with `ART_CGG_PACKETING=enabled`.
- actual root cause: context-behavior policy required packet admission for ART
  context, but the ART CLI default still set CGG packeting to off and relied on
  caller memory.
- why it escaped earlier controls: earlier packet work made CGG projection
  available and documented as opt-in, but did not enforce safe default behavior
  for large output or `--json` calls.

## Source Changes

- changed workflow, adapter, or contract: `src/art-cli.js` now defaults CGG
  packet projection to enabled, supports explicit `ART_CGG_PACKETING=off` raw
  debugging, and suppresses oversized `--json` output into artifact plus packet
  metadata.
- tests or validator added: `test/art-cli.test.js` covers default CGG packet
  refs for large compact output, default suppression of oversized `--json`, and
  explicit raw-debug override with `ART_CGG_PACKETING=off`.
- related change records:
  [2026-05-06 ART Optimized Context Packets](2026-05-06-art-optimized-context-packets.md)

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-backed CLI and
  operator documentation update.
- image tag or digest: None.
- runtime revision: None.

## Live Verification

- local validation: `node --test test/art-cli.test.js`, `npm test`,
  `npm run validate:api-docs`, `npm run validate:governance-docs`,
  `npm run validate:change-record-requirement`, and
  `npm run validate:openproject-mutation-contracts`.
- live or dev-integration verification:
  `npm run art -- item continuation 411 --json` returned
  `raw_json_suppressed=true`, `.art/outputs/...continuation-context.json`, and
  `cgg_packet_ref.status=projected` instead of raw continuation JSON.
- residual risk: default mode is non-fatal if CGG is unavailable; use
  `ART_CGG_PACKETING=required` when an operator needs fail-closed behavior.

## Follow-Up

- required follow-up: none expected after local validation, Review Packet
  finalization, and #678 completion.
- owner: `operator-orchestration-service`
- due date or closure condition: #678 is closed with merged source evidence.
