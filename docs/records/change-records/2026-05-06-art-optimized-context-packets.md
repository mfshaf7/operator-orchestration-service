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

# 2026-05-06 ART Optimized Context Packets

## Summary

Added compact ART active-session and evidence packet reads so operators can
resume, inspect, and close ART work without repeatedly rereading full execution
trees or full Review Packet bodies. Large local ART outputs can now be projected
through CGG as model-safe packet references when enabled.

## Classification

- area: delivery workflow
- type: operator-surface and API-contract optimization
- runtime impact: delivery read routes and local ART CLI output can expose new
  compact packet shapes; no OpenProject write semantics changed

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: #650, #657, #658, #659, #666
- related products or components: Workspace Delivery ART, WGCF, CGG

## Root Cause

- immediate failure: normal ART sessions still required too many repeated
  planning, continuation, Review Packet, and validation rereads.
- actual root cause: the broker had individual bounded reads, but not a compact
  packet layer that joined session, evidence, WGCF-readiness, and CGG packet
  references into operator-safe outputs.
- why it escaped earlier controls: prior controls optimized single command
  output size, not the number of repeated context reads in a landing unit.

## Source Changes

- changed workflow, adapter, or contract: added initiative active-session,
  initiative evidence, and work-item evidence packet read routes plus local CLI
  commands.
- local artifact hygiene: ignored `.cgg/` so dogfooded CGG packet artifacts do
  not become source evidence by accident.
- tests or validator added: API, service, HTTP, OpenAPI, and ART CLI tests are
  updated for the new packet contracts.
- related change records:
  [2026-04-29 ART CLI Compact Output](2026-04-29-art-cli-compact-output.md)

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-backed delivery
  workflow change; dev-integration dogfood and Review Packet evidence will be
  attached to the #650 landing unit.
- live form contract evidence: read-only packet routes do not add or change
  OpenProject mutation fields, writable custom-field behavior, `allowedValues`,
  or `roadmap_version_projection` semantics.
- image tag or digest: None.
- runtime revision: None.

## Live Verification

- local validation: pending in the #650 landing unit.
- live or dev-integration verification: pending dogfood through active ART CLI.
- residual risk: closed by
  [2026-05-06 ART CGG Default Packet Projection](2026-05-06-art-cgg-default-packet-projection.md);
  CGG packet projection is now the default for large ART CLI output, with
  explicit `ART_CGG_PACKETING=off` reserved for local debugging.

## Follow-Up

- required follow-up: complete the remaining #650 landing-unit automation slice
  for final closeout reuse after packet dogfood.
- owner: `operator-orchestration-service`
- due date or closure condition: #657, #658, #659, and #666 closed with a
  finalized Review Packet.
